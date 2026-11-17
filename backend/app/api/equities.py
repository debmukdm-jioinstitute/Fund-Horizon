"""Staff Equities API: NSE stock search + live quotes from Yahoo Finance (free, unofficial)."""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_staff

router = APIRouter(prefix="/api/backoffice/equities", tags=["equities"])

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


def _quote(sym: str) -> dict:
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}.NS?range=1d&interval=1d"
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


@router.get("/quotes")
def equities_quotes(staff: Annotated[dict, Depends(require_staff)], symbols: Annotated[str, Query(max_length=1500)]):
    syms = list(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))[:50]
    if any(not SYMBOL.match(s) for s in syms):
        raise HTTPException(422, "invalid NSE symbol")
    with ThreadPoolExecutor(max_workers=8) as ex:
        data = list(ex.map(lambda s: _cached("q:" + s, lambda: _quote(s)), syms))
    return {"data": data, "source": "Yahoo Finance", "as_of": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
