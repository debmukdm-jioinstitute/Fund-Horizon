from __future__ import annotations
"""AMFI total expense ratios (TER), read from the JSON API behind amfiindia.com/ter-of-mf-schemes.

The API serves one row per scheme per day in 100-row pages, with separate Regular (R_TER) and Direct (D_TER)
columns. We keep the latest row per scheme name for the newest month that has data.
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger("backoffice.providers.amfi_ter")

TER_URL = "https://www.amfiindia.com/api/populate-te-rdata-revised"
TER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Referer": "https://www.amfiindia.com/ter-of-mf-schemes",
    "Accept": "application/json",
}
PAGE_SIZE = 100  # the API caps pageSize at 100


def base_key(scheme_name: str) -> str:
    """Normalized scheme identity shared by NAV names and TER names (drops the ' - Direct Plan - Growth' tail)."""
    head = re.split(r"\s+-\s+", scheme_name or "", maxsplit=1)[0]
    return re.sub(r"[^a-z0-9]+", "", head.lower())


def _ter(value: Any) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if 0 < v < 10 else None


def _get_page(client: httpx.Client, month: str, page: int) -> dict[str, Any] | None:
    try:
        res = client.get(
            TER_URL,
            params={"MF_ID": "All", "Month": month, "strCat": "-1", "strType": "-1", "page": page, "pageSize": PAGE_SIZE},
            headers=TER_HEADERS,
        )
        if res.status_code != 200:
            return None
        body = res.json()
        return body if isinstance(body, dict) else None
    except (httpx.HTTPError, ValueError):
        return None


def fetch_month(month: str, workers: int = 6, budget_seconds: float = 180.0) -> list[dict[str, Any]]:
    """Latest TER per scheme for ``month`` (``MM-YYYY``). Empty list if the month has no data."""
    with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
        first = _get_page(client, month, 1)
        if not first or not first.get("data"):
            return []
        pages = int((first.get("meta") or {}).get("pageCount") or 1)
        rows: list[dict[str, Any]] = list(first["data"])
        if pages > 1:
            deadline = time.monotonic() + budget_seconds

            def _page(p: int) -> dict[str, Any] | None:
                return _get_page(client, month, p) if time.monotonic() < deadline else None

            with ThreadPoolExecutor(max_workers=workers) as pool:
                for body in pool.map(_page, range(2, pages + 1)):
                    if body:
                        rows.extend(body.get("data") or [])

    latest: dict[str, dict[str, Any]] = {}
    for r in rows:
        name = r.get("Scheme_Name")
        date = str(r.get("TER_Date") or "")[:10]
        if not name or not date:
            continue
        prior = latest.get(name)
        if prior is None or date > prior["as_of"]:
            latest[name] = {
                "scheme_name": name,
                "base_key": base_key(name),
                "regular_ter_pct": _ter(r.get("R_TER")),
                "direct_ter_pct": _ter(r.get("D_TER")),
                "as_of": date,
            }
    return list(latest.values())


def fetch_latest() -> list[dict[str, Any]]:
    """Try the current month, then the previous one (the new month's data appears on its first day)."""
    now = datetime.now(UTC)
    months = [now.strftime("%m-%Y")]
    prev_year, prev_month = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    months.append(f"{prev_month:02d}-{prev_year}")
    for month in months:
        rows = fetch_month(month)
        if rows:
            return rows
    return []
