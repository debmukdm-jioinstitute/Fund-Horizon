"""Staff Equities API: NSE stock search + live quotes from Yahoo Finance (free, unofficial)."""

from __future__ import annotations

import json
import re
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
UA = "Mozilla/5.0 (compatible; FundHorizon/1.0)"
SYMBOL = re.compile(r"^[A-Z][A-Z0-9&-]{0,20}$")
TTL = 15.0
_cache: dict[str, tuple[float, Any]] = {}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < TTL:
        return hit[1]
    val = fn()
    if len(_cache) > 2000:
        _cache.clear()
    _cache[key] = (time.monotonic(), val)
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
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}{suffix}?range=1d&interval=1d"
    try:
        m = _get(url)["chart"]["result"][0]["meta"]
    except Exception:
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


@router.get("/search")
def equities_search(staff: Annotated[dict, Depends(require_staff)], q: Annotated[str, Query(min_length=1, max_length=40)]):
    try:
        return {"data": _cached("s:" + q.lower(), lambda: _search(q))}
    except Exception:
        raise HTTPException(502, "Yahoo Finance search unavailable")


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


@router.delete("/baskets/{basket_id}")
def delete_basket(basket_id: str, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    verify_csrf(request)
    if not _REPO.delete_equity_basket(staff["id"], basket_id):
        raise HTTPException(404, "basket not found")
    _REPO.log_audit(staff["id"], "equity_basket_deleted", "equity_basket", basket_id)
    return {"success": True}
