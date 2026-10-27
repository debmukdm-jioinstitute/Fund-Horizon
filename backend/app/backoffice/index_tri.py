"""Total-return index (TRI) ingestion for MF Research V2.

Source: NSE Indices' public historical-data service (the same endpoint the
open-source nsepython/jugaad-data libraries use; no login, no key). It is a
POST to ``https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString``
with the index name and a date range, returning TRI values. CRISIL, BSE and
composite benchmarks have no equivalent free machine-readable endpoint, so
they are NOT ingested here — their categories keep the tracker-fund proxy
line and its disclosure until a real series exists for them.

This module is deliberately NOT wired to a public endpoint: a staff-triggered
fetch would let anyone hammer NSE from the server. Run it from a scheduled
job or a one-off backend task; ``fetch_tri`` only downloads, ``store_tri``
only writes. Both are no-ops on failure (raise, never write partial data).
"""

from __future__ import annotations

import json
from typing import Any

import httpx

NIFTY_TRI_URL = "https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString"
NIFTY_HOME = "https://www.niftyindices.com/"

# Category key (screener) -> NSE TRI index name, for the categories whose
# SEBI benchmark is a single NSE TRI. Composite / CRISIL / BSE benchmarks
# are intentionally absent: no free series, no proxy substitution.
NSE_TRI_BY_CATEGORY: dict[str, str] = {
    "flexi_cap": "NIFTY 500", "elss": "NIFTY 500", "focused": "NIFTY 500",
    "value": "NIFTY 500", "contra": "NIFTY 500",
    "large_cap": "NIFTY 100", "mid_cap": "NIFTY Midcap 150",
    "small_cap": "NIFTY Smallcap 250", "large_mid_cap": "NIFTY LargeMidcap 250",
    "multi_cap": "NIFTY 500 Multicap 50:25:25",
    "dividend_yield": "NIFTY Dividend Opportunities 50",
}


def fetch_tri(index_name: str, start: str, end: str, timeout: float = 60.0) -> list[dict[str, Any]]:
    """Download TRI points [{date, value}] for one NSE index.

    Dates are ``dd-Mon-yyyy`` (e.g. "01-Jan-2020"). Raises on HTTP errors,
    empty payloads or unparseable rows so callers never store a half series.
    """
    payload = {"indexName": index_name, "fromDate": start, "toDate": end}
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Referer": NIFTY_HOME,
    }
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        client.get(NIFTY_HOME, headers={"User-Agent": "Mozilla/5.0"})
        resp = client.post(NIFTY_TRI_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    inner = data.get("d") if isinstance(data, dict) else None
    rows = json.loads(inner) if isinstance(inner, str) else inner
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"No TRI rows returned for {index_name}")
    out = []
    for r in rows:
        date = r.get("HistoricalDate") or r.get("date")
        value = r.get("TRI") or r.get("IndexValue") or r.get("value")
        if date is None or value is None:
            continue
        try:
            out.append({"date": str(date)[:10], "value": float(value)})
        except (TypeError, ValueError):
            continue
    if not out:
        raise ValueError(f"No parseable TRI rows for {index_name}")
    return out


def instrument_id_for(index_name: str) -> str:
    """Stable mf_benchmark_nav instrument id for an NSE TRI index."""
    slug = index_name.upper().replace(" ", "_")
    return f"INDEX:TRI:{slug}"
