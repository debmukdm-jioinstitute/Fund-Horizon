"""Optional Yahoo Finance chart fetch for NSE (.NS) / BSE (.BO). Offline-first.

Yahoo's chart endpoint is unofficial and can lag or rate-limit. Prefer injecting
bars in tests. Live fetches are gated by FH_TRADE_LIVE=1.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.backoffice.trade.session import TradeError, yahoo_symbol

UA = "Mozilla/5.0 (compatible; FundHorizon-Trade/1.0; +https://fundhorizon.website)"
HOSTS = ("query2", "query1")
PAUSE = 0.35
BACKOFF = 5.0


def live_enabled() -> bool:
    return os.environ.get("FH_TRADE_LIVE", "").lower() in ("1", "true", "yes")


def _get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def fetch_chart(symbol: str, *, range_: str = "1d", interval: str = "5m", exchange: str = "NS") -> dict[str, Any]:
    if not live_enabled():
        raise TradeError("live Yahoo fetches are off (set FH_TRADE_LIVE=1 to enable)")
    ysym = yahoo_symbol(symbol, exchange)
    last_err: Exception | None = None
    for host in HOSTS:
        url = (
            f"https://{host}.finance.yahoo.com/v8/finance/chart/"
            f"{urllib.parse.quote(ysym)}?range={urllib.parse.quote(range_)}&interval={interval}"
        )
        try:
            text = _get(url)
            data = json.loads(text)
            result = (data.get("chart") or {}).get("result") or []
            if not result:
                raise TradeError(f"no chart data for {ysym}")
            r0 = result[0]
            ts = r0.get("timestamp") or []
            q = (r0.get("indicators") or {}).get("quote") or [{}]
            q0 = q[0] if q else {}
            meta = r0.get("meta") or {}
            return {
                "symbol": symbol.upper().replace(".NS", "").replace(".BO", ""),
                "yahoo": ysym,
                "t": ts,
                "o": q0.get("open") or [],
                "h": q0.get("high") or [],
                "l": q0.get("low") or [],
                "c": q0.get("close") or [],
                "v": q0.get("volume") or [],
                "meta": {
                    "regularMarketPrice": meta.get("regularMarketPrice"),
                    "regularMarketVolume": meta.get("regularMarketVolume"),
                    "previousClose": meta.get("chartPreviousClose") or meta.get("previousClose"),
                    "exchangeName": meta.get("exchangeName"),
                    "currency": meta.get("currency") or "INR",
                    "timezone": meta.get("exchangeTimezoneName") or "Asia/Kolkata",
                },
            }
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, TradeError) as e:
            last_err = e
            if isinstance(e, urllib.error.HTTPError) and e.code == 429:
                time.sleep(BACKOFF)
            continue
    raise TradeError(f"Yahoo chart failed for {symbol}: {last_err}")


def parse_offline_chart(doc: dict, symbol: str | None = None) -> dict[str, Any]:
    """Accept either our shape or a raw Yahoo v8 chart JSON."""
    if "t" in doc and "c" in doc:
        out = dict(doc)
        out["symbol"] = (symbol or doc.get("symbol") or "UNKNOWN").upper()
        return out
    result = ((doc.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise TradeError("offline chart has no result")
    ts = result.get("timestamp") or []
    q0 = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    meta = result.get("meta") or {}
    sym = symbol or (meta.get("symbol") or "UNKNOWN")
    sym = str(sym).upper().replace(".NS", "").replace(".BO", "")
    return {
        "symbol": sym,
        "t": ts,
        "o": q0.get("open") or [],
        "h": q0.get("high") or [],
        "l": q0.get("low") or [],
        "c": q0.get("close") or [],
        "v": q0.get("volume") or [],
        "meta": {
            "regularMarketPrice": meta.get("regularMarketPrice"),
            "regularMarketVolume": meta.get("regularMarketVolume"),
            "previousClose": meta.get("chartPreviousClose") or meta.get("previousClose"),
            "currency": meta.get("currency") or "INR",
        },
    }
