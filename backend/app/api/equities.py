"""Staff Equities API: NSE stock search + live quotes from Yahoo Finance (free, unofficial)."""

from __future__ import annotations

import http.cookiejar
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.auth import require_staff, verify_csrf
from app.backoffice.repository import BackofficeRepository

router = APIRouter(prefix="/api/backoffice/equities", tags=["equities"])

_REPO = BackofficeRepository()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
SYMBOL = re.compile(r"^[A-Z][A-Z0-9&-]{0,20}$")
TTL = 15.0
_cache: dict[str, tuple[float, float, Any]] = {}


def _raw(v: Any, default=None):
    if v is None:
        return default
    if isinstance(v, dict):
        return v.get("raw", default)
    return v


def _fmt_inr_short(val: float | None) -> str:
    if val is None or not isinstance(val, (int, float)):
        return "—"
    if val >= 1e12:
        return f"₹{val / 1e12:.2f}T"
    if val >= 1e7:
        return f"₹{val / 1e7:,.2f} Cr"
    if val >= 1e5:
        return f"₹{val / 1e5:.2f} Lakh"
    return f"₹{val:,.2f}"


class YahooSession:
    """Manages Yahoo Finance cookie & crumb acquisition for quoteSummary."""

    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.crumb: str | None = None
        self.crumb_time: float = 0
        self.lock = threading.Lock()

    def get_crumb(self, force: bool = False) -> str | None:
        with self.lock:
            now = time.monotonic()
            if self.crumb and not force and (now - self.crumb_time < 3600):
                return self.crumb
            try:
                self.opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": UA}))
            except Exception:
                pass
            for host in ("query2", "query1"):
                try:
                    req = urllib.request.Request(f"https://{host}.finance.yahoo.com/v1/test/getcrumb", headers={"User-Agent": UA})
                    with self.opener.open(req, timeout=8) as r:
                        c = r.read().decode("utf-8").strip()
                        if c and "error" not in c.lower() and "<" not in c:
                            self.crumb = c
                            self.crumb_time = now
                            return self.crumb
                except Exception:
                    pass
            return self.crumb

    def get_json(self, url: str) -> dict:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with self.opener.open(req, timeout=12) as r:
            return json.loads(r.read().decode("utf-8", "replace"))


_YS = YahooSession()


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _cached(key: str, fn, ttl: float = TTL):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < hit[1]:
        return hit[2]
    val = fn()
    if isinstance(val, dict) and val.get("error"):
        return val  # never cache a failed quote/detail: retry on next request
    if len(_cache) > 3000:
        _cache.clear()
    _cache[key] = (time.monotonic(), ttl, val)
    return val


def _search(q: str) -> list[dict]:
    q = re.sub(r"[^\w&.\- ]", "", q).strip()  # Yahoo 400s on emoji/odd chars
    if not q:
        return []
    url = "https://query2.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode(
        {"q": q, "quotesCount": 15, "newsCount": 0, "listsCount": 0}
    )
    out = []
    for r in _get(url).get("quotes", []):
        sym = str(r.get("symbol", ""))
        if r.get("quoteType") == "EQUITY" and sym.endswith(".NS"):
            out.append({"symbol": sym[:-3], "name": r.get("longname") or r.get("shortname") or sym[:-3]})
    if not out and SYMBOL.match(q.upper()):  # Yahoo name search misses tickers like M&M
        hit = _quote(q.upper())
        if hit.get("price") is not None:
            out.append({"symbol": hit["symbol"], "name": hit["name"]})
    return out


def _quote(sym: str, suffix: str = ".NS") -> dict:
    path = f"/v8/finance/chart/{urllib.parse.quote(sym)}{suffix}?range=1d&interval=1d"
    m = None
    for host in ("query2", "query1", "query2"):  # fall back to the other host, then one retry
        try:
            m = _get(f"https://{host}.finance.yahoo.com{path}")["chart"]["result"][0]["meta"]
            break
        except Exception:
            time.sleep(0.3)
    if m is None:
        return {"symbol": sym, "error": "unavailable"}
    price, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose") or m.get("previousClose")
    chg = price - prev if price is not None and prev else None
    return {
        "symbol": sym,
        "name": m.get("longName") or m.get("shortName") or sym,
        "price": price,
        "prev_close": prev,
        "change": chg,
        "change_pct": chg / prev * 100 if chg is not None else None,
        "day_high": m.get("regularMarketDayHigh"),
        "day_low": m.get("regularMarketDayLow"),
        "high_52w": m.get("fiftyTwoWeekHigh"),
        "low_52w": m.get("fiftyTwoWeekLow"),
        "volume": m.get("regularMarketVolume"),
        "currency": m.get("currency") or "INR",
    }


VALID_RANGES = ("1d", "5d", "1mo", "6mo", "1y", "5y", "max")
INTERVAL_MAP = {
    "1d": "5m",
    "5d": "15m",
    "1mo": "1d",
    "6mo": "1d",
    "1y": "1d",
    "5y": "1wk",
    "max": "1mo",
}


def _chart(sym: str, range_str: str = "1y", suffix: str = ".NS") -> dict:
    sym = sym.strip().upper()
    if sym.endswith(".NS"):
        sym = sym[:-3]
    if not SYMBOL.match(sym):
        return {"symbol": sym, "error": "invalid symbol"}
    if range_str not in VALID_RANGES:
        range_str = "1y"

    interval = INTERVAL_MAP.get(range_str, "1d")
    path = f"/v8/finance/chart/{urllib.parse.quote(sym)}{suffix}?range={range_str}&interval={interval}"
    d = None
    for host in ("query2", "query1", "query2"):
        try:
            d = _get(f"https://{host}.finance.yahoo.com{path}")["chart"]["result"][0]
            break
        except Exception:
            time.sleep(0.2)

    if d is None:
        return {"symbol": sym, "error": "chart unavailable"}

    meta = d.get("meta", {})
    timestamps = d.get("timestamp", [])
    q = d.get("indicators", {}).get("quote", [{}])[0]
    closes = q.get("close", [])
    opens = q.get("open", [])
    highs = q.get("high", [])
    lows = q.get("low", [])
    volumes = q.get("volume", [])

    points = []
    for i in range(len(timestamps)):
        c = closes[i] if i < len(closes) else None
        if c is not None and not (isinstance(c, float) and (c != c or c <= 0)):
            points.append({
                "time": timestamps[i],
                "close": round(c, 2),
                "open": round(opens[i], 2) if i < len(opens) and opens[i] is not None else round(c, 2),
                "high": round(highs[i], 2) if i < len(highs) and highs[i] is not None else round(c, 2),
                "low": round(lows[i], 2) if i < len(lows) and lows[i] is not None else round(c, 2),
                "volume": volumes[i] if i < len(volumes) and volumes[i] is not None else 0,
            })

    first_px = points[0]["close"] if points else None
    last_px = points[-1]["close"] if points else None
    chg = (last_px - first_px) if first_px and last_px else 0
    chg_pct = (chg / first_px * 100) if first_px and first_px > 0 else 0
    p_high = max((p["high"] for p in points), default=None)
    p_low = min((p["low"] for p in points), default=None)

    return {
        "symbol": sym,
        "name": meta.get("longName") or meta.get("shortName") or sym,
        "range": range_str,
        "interval": interval,
        "currency": meta.get("currency") or "INR",
        "prev_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
        "current_price": meta.get("regularMarketPrice") or last_px,
        "period_change": round(chg, 2),
        "period_change_pct": round(chg_pct, 2),
        "period_high": round(p_high, 2) if p_high is not None else None,
        "period_low": round(p_low, 2) if p_low is not None else None,
        "candles": points,
    }


def _detail(sym: str) -> dict:
    sym = sym.strip().upper()
    if sym.endswith(".NS"):
        sym = sym[:-3]
    if not SYMBOL.match(sym):
        return {"symbol": sym, "error": "invalid symbol"}

    base = _quote(sym)
    modules = "assetProfile,summaryDetail,defaultKeyStatistics,financialData,earnings,majorHoldersBreakdown"
    summary_res = None

    crumb = _YS.get_crumb()
    if crumb:
        for _ in range(2):
            try:
                url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}.NS?crumb={crumb}&modules={modules}"
                summary_res = _YS.get_json(url)["quoteSummary"]["result"][0]
                break
            except Exception:
                crumb = _YS.get_crumb(force=True)

    ap = (summary_res or {}).get("assetProfile", {})
    sd = (summary_res or {}).get("summaryDetail", {})
    ks = (summary_res or {}).get("defaultKeyStatistics", {})
    fd = (summary_res or {}).get("financialData", {})
    ea = (summary_res or {}).get("earnings", {})
    mh = (summary_res or {}).get("majorHoldersBreakdown", {})

    cmp_price = base.get("price") or _raw(fd.get("currentPrice"))
    prev_close = base.get("prev_close") or _raw(sd.get("previousClose"))
    chg = (cmp_price - prev_close) if (cmp_price is not None and prev_close is not None) else None
    chg_pct = (chg / prev_close * 100) if (chg is not None and prev_close) else None

    day_high = base.get("day_high") or _raw(sd.get("dayHigh"))
    day_low = base.get("day_low") or _raw(sd.get("dayLow"))
    high_52w = base.get("high_52w") or _raw(sd.get("fiftyTwoWeekHigh"))
    low_52w = base.get("low_52w") or _raw(sd.get("fiftyTwoWeekLow"))
    volume = base.get("volume") or _raw(sd.get("volume"))
    avg_volume = _raw(sd.get("averageVolume"))
    mcap = _raw(sd.get("marketCap"))

    pe_trailing = _raw(sd.get("trailingPE"))
    pe_forward = _raw(sd.get("forwardPE"))
    pb_ratio = _raw(ks.get("priceToBook"))
    ps_ratio = _raw(sd.get("priceToSalesTrailing12Months"))
    peg_ratio = _raw(ks.get("pegRatio"))
    ev = _raw(ks.get("enterpriseValue"))
    ev_to_ebitda = _raw(ks.get("enterpriseToEbitda"))

    roe = _raw(fd.get("returnOnEquity"))
    roa = _raw(fd.get("returnOnAssets"))
    op_margin = _raw(fd.get("operatingMargins"))
    net_margin = _raw(ks.get("profitMargins"))
    gross_margin = _raw(fd.get("grossMargins"))
    debt_to_equity = _raw(fd.get("debtToEquity"))
    total_debt = _raw(fd.get("totalDebt"))
    total_cash = _raw(fd.get("totalCash"))
    free_cashflow = _raw(fd.get("freeCashflow"))
    revenue = _raw(fd.get("totalRevenue"))
    revenue_growth = _raw(fd.get("revenueGrowth"))
    earnings_growth = _raw(fd.get("earningsGrowth"))
    ebitda = _raw(fd.get("ebitda"))

    eps_trailing = _raw(ks.get("trailingEps"))
    eps_forward = _raw(ks.get("forwardEps"))
    book_value = _raw(ks.get("bookValue"))

    div_yield = _raw(sd.get("dividendYield"))
    div_rate = _raw(sd.get("dividendRate"))
    ex_div = _raw(sd.get("exDividendDate"))

    insiders_pct = _raw(mh.get("insidersPercentHeld"))
    institutions_pct = _raw(mh.get("institutionsPercentHeld"))
    institutions_float_pct = _raw(mh.get("institutionsFloatPercentHeld"))

    target_mean = _raw(fd.get("targetMeanPrice"))
    target_high = _raw(fd.get("targetHighPrice"))
    target_low = _raw(fd.get("targetLowPrice"))
    rec_key = fd.get("recommendationKey")
    rec_opinions = _raw(fd.get("numberOfAnalystOpinions"))

    fc = ea.get("financialsChart", {})
    yearly_earnings = [
        {"year": y.get("date"), "revenue": _raw(y.get("revenue")), "earnings": _raw(y.get("earnings"))}
        for y in fc.get("yearly", [])
    ]
    quarterly_earnings = [
        {"date": q.get("date"), "revenue": _raw(q.get("revenue")), "earnings": _raw(q.get("earnings"))}
        for q in fc.get("quarterly", [])
    ]

    officers = [
        {"name": o.get("name"), "title": o.get("title"), "age": o.get("age")}
        for o in ap.get("companyOfficers", [])[:6]
        if o.get("name")
    ]

    ext_links = {
        "screener": f"https://www.screener.in/company/{urllib.parse.quote(sym)}/consolidated/",
        "tradingview": f"https://www.tradingview.com/symbols/NSE-{sym}/",
        "nse": f"https://www.nseindia.com/get-quotes/equity?symbol={urllib.parse.quote(sym)}",
        "google": f"https://www.google.com/finance/quote/{sym}:NSE",
        "yahoo": f"https://finance.yahoo.com/quote/{sym}.NS",
    }

    return {
        "symbol": sym,
        "name": base.get("name") or ap.get("longBusinessSummary", "")[:30] or sym,
        "currency": base.get("currency") or "INR",
        "price": cmp_price,
        "prev_close": prev_close,
        "change": chg,
        "change_pct": chg_pct,
        "day_high": day_high,
        "day_low": day_low,
        "high_52w": high_52w,
        "low_52w": low_52w,
        "volume": volume,
        "avg_volume": avg_volume,
        "market_cap": mcap,
        "market_cap_fmt": _fmt_inr_short(mcap),
        "pe_trailing": pe_trailing,
        "pe_forward": pe_forward,
        "pb_ratio": pb_ratio,
        "ps_ratio": ps_ratio,
        "peg_ratio": peg_ratio,
        "ev": ev,
        "ev_fmt": _fmt_inr_short(ev),
        "ev_to_ebitda": ev_to_ebitda,
        "beta": _raw(sd.get("beta")),
        "roe": roe,
        "roa": roa,
        "operating_margin": op_margin,
        "profit_margin": net_margin,
        "gross_margin": gross_margin,
        "debt_to_equity": debt_to_equity,
        "total_debt": total_debt,
        "total_debt_fmt": _fmt_inr_short(total_debt),
        "total_cash": total_cash,
        "total_cash_fmt": _fmt_inr_short(total_cash),
        "free_cashflow": free_cashflow,
        "free_cashflow_fmt": _fmt_inr_short(free_cashflow),
        "revenue": revenue,
        "revenue_fmt": _fmt_inr_short(revenue),
        "revenue_growth": revenue_growth,
        "earnings_growth": earnings_growth,
        "ebitda": ebitda,
        "ebitda_fmt": _fmt_inr_short(ebitda),
        "eps_trailing": eps_trailing,
        "eps_forward": eps_forward,
        "book_value": book_value,
        "dividend_yield": div_yield,
        "dividend_rate": div_rate,
        "ex_dividend_date": ex_div,
        "shareholding": {
            "promoter_pct": round(insiders_pct * 100, 2) if insiders_pct is not None else None,
            "institutions_pct": round(institutions_pct * 100, 2) if institutions_pct is not None else None,
            "float_pct": round(institutions_float_pct * 100, 2) if institutions_float_pct is not None else None,
        },
        "analyst": {
            "recommendation": rec_key.replace("_", " ").title() if rec_key else None,
            "target_mean": target_mean,
            "target_high": target_high,
            "target_low": target_low,
            "opinions_count": rec_opinions,
            "upside_pct": round(((target_mean - cmp_price) / cmp_price) * 100, 2) if (target_mean and cmp_price and cmp_price > 0) else None,
        },
        "profile": {
            "sector": ap.get("sector"),
            "industry": ap.get("industry"),
            "website": ap.get("website"),
            "city": ap.get("city"),
            "country": ap.get("country"),
            "employees": ap.get("fullTimeEmployees"),
            "summary": ap.get("longBusinessSummary"),
            "officers": officers,
        },
        "earnings_history": yearly_earnings,
        "quarterly_earnings": quarterly_earnings,
        "external_links": ext_links,
        "as_of": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


@router.get("/search")
def equities_search(staff: Annotated[dict, Depends(require_staff)], q: Annotated[str, Query(min_length=1, max_length=40)]):
    try:
        return {"data": _cached("s:" + q.lower(), lambda: _search(q))}
    except Exception as e:
        raise HTTPException(502, "Yahoo Finance search unavailable") from e


INDICES = (("^NSEI", "NIFTY 50"), ("^NSEBANK", "BANK NIFTY"), ("^BSESN", "SENSEX"))


@router.get("/indices")
def equities_indices(staff: Annotated[dict, Depends(require_staff)]):
    with ThreadPoolExecutor(max_workers=3) as ex:
        rows = list(ex.map(lambda i: _cached("q:" + i[0], lambda: _quote(i[0], "")), INDICES))
    return {"data": [{**r, "symbol": sym, "name": label} for (sym, label), r in zip(INDICES, rows)]}


@router.get("/quotes")
def equities_quotes(staff: Annotated[dict, Depends(require_staff)], symbols: Annotated[str, Query(max_length=1500)]):
    syms = list(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))[:50]
    if any(not SYMBOL.match(s) for s in syms):
        raise HTTPException(422, "invalid NSE symbol")
    with ThreadPoolExecutor(max_workers=8) as ex:
        data = list(ex.map(lambda s: _cached("q:" + s, lambda: _quote(s)), syms))
    return {"data": data, "source": "Yahoo Finance", "as_of": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


@router.get("/detail")
def equities_detail(
    staff: Annotated[dict, Depends(require_staff)],
    symbol: Annotated[str, Query(min_length=1, max_length=20)],
):
    sym = symbol.strip().upper()
    if sym.endswith(".NS"):
        sym = sym[:-3]
    if not SYMBOL.match(sym):
        raise HTTPException(422, "invalid NSE symbol")
    try:
        res = _cached("d:" + sym, lambda: _detail(sym), ttl=300.0)
        return {"data": res, "source": "Yahoo Finance"}
    except Exception as e:
        raise HTTPException(502, f"Scrip detail fetch failed: {e}") from e


@router.get("/chart")
def equities_chart(
    staff: Annotated[dict, Depends(require_staff)],
    symbol: Annotated[str, Query(min_length=1, max_length=20)],
    range: Annotated[str, Query()] = "1y",
):
    sym = symbol.strip().upper()
    if sym.endswith(".NS"):
        sym = sym[:-3]
    if not SYMBOL.match(sym):
        raise HTTPException(422, "invalid NSE symbol")
    rng = range.lower()
    if rng not in VALID_RANGES:
        rng = "1y"
    ttl = 60.0 if rng in ("1d", "5d") else 3600.0
    try:
        res = _cached(f"c:{sym}:{rng}", lambda: _chart(sym, rng), ttl=ttl)
        return {"data": res, "source": "Yahoo Finance"}
    except Exception as e:
        raise HTTPException(502, f"Chart data fetch failed: {e}") from e


# --- Baskets: staff-private, stored in the server database (survives devices/browsers) ---
def _clean(symbols: list[str]) -> list[str]:
    out = list(dict.fromkeys(s.strip().upper() for s in symbols))
    if len(out) > 50 or any(not SYMBOL.match(s) for s in out):
        raise HTTPException(422, "max 50 valid NSE symbols per basket")
    return out


class BasketCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    symbols: list[str] = Field(default_factory=list, max_length=50)


class BasketSymbols(BaseModel):
    symbols: list[str] = Field(..., max_length=50)


# One-off backfill (buy price, qty) from the user's smallcase screenshot; applied once to the staff member's "Abhijit*" basket.
_ABHIJIT_SEED = [
    ("TECHNOE", 22, 975.0), ("NETWEB", 6, 4124.0), ("WAAREEENER", 13, 2585.5), ("GVT&D", 9, 4399.5),
    ("POLYCAB", 5, 8139.0), ("BEL", 106, 404.5), ("PERSISTENT", 8, 6062.5), ("DIXON", 4, 12940.0),
]


class HoldingBody(BaseModel):
    qty: float | None = Field(None, ge=0, le=1e9)
    buy_price: float | None = Field(None, ge=0, le=1e9)


@router.put("/baskets/{basket_id}/holdings/{symbol}")
def set_holding(basket_id: str, symbol: str, body: HoldingBody, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    verify_csrf(request)
    sym = symbol.strip().upper()
    if not SYMBOL.match(sym):
        raise HTTPException(422, "invalid NSE symbol")
    if not _REPO.set_equity_holding(staff["id"], basket_id, sym, body.qty, body.buy_price):
        raise HTTPException(404, "basket or symbol not found")
    _REPO.log_audit(staff["id"], "equity_holding_set", "equity_basket", basket_id, {"symbol": sym, "qty": body.qty, "buy_price": body.buy_price})
    return {"success": True}


@router.get("/baskets")
def list_baskets(staff: Annotated[dict, Depends(require_staff)]):
    _REPO.seed_equity_basket_once(staff["id"], "abhijit", _ABHIJIT_SEED)
    return {"data": _REPO.list_equity_baskets(staff["id"])}


@router.post("/baskets", status_code=201)
def create_basket(body: BasketCreate, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    verify_csrf(request)
    b = _REPO.create_equity_basket(staff["id"], body.name.strip(), _clean(body.symbols))
    if not b:
        raise HTTPException(409, "You already have a basket with this name")
    _REPO.log_audit(staff["id"], "equity_basket_created", "equity_basket", b["id"], {"name": b["name"], "symbols": b["symbols"]})
    return b


@router.put("/baskets/{basket_id}")
def set_basket_symbols(basket_id: str, body: BasketSymbols, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    verify_csrf(request)
    syms = _clean(body.symbols)
    if not _REPO.set_equity_basket_symbols(staff["id"], basket_id, syms):
        raise HTTPException(404, "basket not found")
    _REPO.log_audit(staff["id"], "equity_basket_symbols_set", "equity_basket", basket_id, {"symbols": syms})
    return {"success": True}


class BasketRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


@router.patch("/baskets/{basket_id}")
def rename_basket(basket_id: str, body: BasketRename, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    verify_csrf(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "name required")
    res = _REPO.rename_equity_basket(staff["id"], basket_id, name)
    if res == "missing":
        raise HTTPException(404, "basket not found")
    if res == "dup":
        raise HTTPException(409, "You already have a basket with this name")
    _REPO.log_audit(staff["id"], "equity_basket_renamed", "equity_basket", basket_id, {"name": name})
    return {"success": True}


@router.delete("/baskets/{basket_id}")
def delete_basket(basket_id: str, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    verify_csrf(request)
    if not _REPO.delete_equity_basket(staff["id"], basket_id):
        raise HTTPException(404, "basket not found")
    _REPO.log_audit(staff["id"], "equity_basket_deleted", "equity_basket", basket_id)
    return {"success": True}
