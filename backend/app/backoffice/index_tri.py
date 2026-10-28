"""Total-return index (TRI) ingestion for MF Research V2.

Source: NSE Indices' public historical-data service (the same endpoint the
open-source nsepython/jugaad-data libraries use; no login, no key). It is a
POST to ``https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString``
with the index name and a date range, returning TRI values. CRISIL, BSE and
composite benchmarks have no equivalent free machine-readable endpoint, so
they are NOT ingested here — their categories keep the tracker-fund proxy
line and its disclosure until a real series exists for them.

WALL OBSERVED 2026-10-28: the Backpage endpoint now answers every POST
with a 302 to the Sitefinity login page (``WWW-Authenticate: Bearer``),
for both the flat payload this module used and nsepython's nested
``cinfo`` payload, with and without XHR headers. Anonymous TRI ingestion
is therefore NOT possible from this endpoint until NSE restores
anonymous access; ``fetch_tri`` raises :class:`TriLoginRequiredError`
on that redirect instead of storing anything. The scheduled job
(``backend/scripts/refresh_tri.py``, workflow ``tri-refresh.yml``) is
kept manual-trigger only until the wall lifts — a daily cron that
deterministically fails would only be noise. No PRI series is ever
substituted for a TRI series: a price-return index is not a
total-return index, and labelling one as the other would be fabrication.

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


class TriLoginRequiredError(RuntimeError):
    """The TRI endpoint redirected to a login page: anonymous access is
    walled. Callers must report this, never fall back to another series."""


def fetch_tri(index_name: str, start: str, end: str, timeout: float = 60.0) -> list[dict[str, Any]]:
    """Download TRI points [{date, value}] for one NSE index.

    Dates are ``dd-Mon-yyyy`` (e.g. "01-Jan-2020"). Raises on HTTP errors,
    empty payloads or unparseable rows so callers never store a half series.
    Raises TriLoginRequiredError when the endpoint redirects to a login
    page (observed 2026-10-28: Sitefinity login, Bearer challenge).
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
        redirect_chain = [str(h.url) for h in resp.history] + [str(resp.url)]
        if any("login" in u.lower() for u in redirect_chain):
            raise TriLoginRequiredError(
                f"NSE TRI endpoint redirected to a login page for {index_name} "
                f"(final URL {resp.url}); anonymous TRI ingestion is walled."
            )
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
            # No truncation: NSE dates arrive as "01-Jan-2020" (11 chars) or
            # ISO; chopping to 10 chars would corrupt the former.
            out.append({"date": str(date).strip(), "value": float(value)})
        except (TypeError, ValueError):
            continue
    if not out:
        raise ValueError(f"No parseable TRI rows for {index_name}")
    return out


def instrument_id_for(index_name: str) -> str:
    """Stable mf_benchmark_nav instrument id for an NSE TRI index."""
    slug = index_name.upper().replace(" ", "_")
    return f"INDEX:TRI:{slug}"


_DATE_FORMATS = ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%B-%Y")


def parse_tri_date(text: str):
    """Parse an NSE TRI date string to a ``datetime.date`` (None if unknown)."""
    from datetime import datetime

    text = (text or "").strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def to_month_end_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resample daily TRI points to month-end points.

    The fund series in ``mf_research_v2.index_metrics`` is month-end
    labelled (calendar month-end dates), and beta / tracking error align
    on exact common dates — so a daily index series would compare daily
    index moves against monthly fund moves. Each month is therefore
    represented by its LAST trading value, dated to that month's CALENDAR
    month-end, matching the fund series convention exactly. Unparseable
    rows are dropped; months with no rows are absent, never interpolated.
    """
    import calendar as _calendar
    from datetime import date as _date

    by_month: dict[tuple[int, int], tuple[_date, float]] = {}
    for p in points:
        d = parse_tri_date(str(p.get("date") or ""))
        if d is None:
            continue
        try:
            value = float(p["value"])
        except (TypeError, ValueError):
            continue
        key = (d.year, d.month)
        if key not in by_month or d > by_month[key][0]:
            by_month[key] = (d, value)
    out = []
    for (year, month) in sorted(by_month):
        _, value = by_month[(year, month)]
        month_end = _date(year, month, _calendar.monthrange(year, month)[1])
        out.append({"date": month_end.isoformat(), "value": value})
    return out


# ---------------------------------------------------------------------------
# Seed file (deploy transport): the production mf_benchmark_nav SQLite
# lives on the EC2 host, which a GitHub Actions job cannot write. The
# scheduled job therefore commits this seed file; the API loads it when
# the database has no series for an index (see backoffice.py
# _ensure_benchmark_seed) and upserts it into mf_benchmark_nav there.
# ---------------------------------------------------------------------------

_TRI_SEED_CACHE: dict[str, Any] = {}


def tri_seed_path(data_dir=None) -> Any:
    """Path of the committed TRI seed file.

    Same layout rule as the holdings snapshot: the seed lives at
    ``data/mf_benchmark_tri.json``, a sibling of the dataset directory,
    not inside it (see ``mf_holdings.holdings_dir``).
    """
    if data_dir is not None:
        from pathlib import Path

        return Path(data_dir) / "mf_benchmark_tri.json"
    from app.data.loader import data_dir as _data_dir

    base = _data_dir()
    if base.name == "fundhorizon_mf_rag_dataset":
        base = base.parent
    return base / "mf_benchmark_tri.json"


def load_tri_seed(data_dir=None) -> dict[str, Any]:
    """Committed TRI seed ({instrument_id: {index_name, points}}), cached
    per file mtime. Empty dict when no seed file is on file."""
    import json as _json

    path = tri_seed_path(data_dir)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {}
    cached = _TRI_SEED_CACHE.get(str(path))
    if cached is not None and cached.get("mtime") == mtime:
        return cached["seed"]
    try:
        seed = _json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    indices = seed.get("indices") if isinstance(seed, dict) else None
    out = indices if isinstance(indices, dict) else {}
    _TRI_SEED_CACHE[str(path)] = {"mtime": mtime, "seed": out}
    return out


def clear_tri_seed_cache() -> None:
    """Test helper: drop the cached TRI seed."""
    _TRI_SEED_CACHE.clear()
