from __future__ import annotations
"""Provenance metadata helper for backoffice API responses."""

from datetime import UTC, datetime, timedelta, timezone
from typing import Any

# Indian Standard Time (IST) is UTC+05:30
IST = timezone(timedelta(hours=5, minutes=30))

DEFAULT_SOURCE_URLS: dict[str, str] = {
    "amfi": "https://www.amfiindia.com",
    "apmi": "https://www.apmiindia.org",
    "nse": "https://www.nseindia.com",
    "fbil": "https://www.fbil.org.in",
    "fred": "https://fred.stlouisfed.org",
    "ecb": "https://data.ecb.europa.eu",
    "cboe": "https://www.cboe.com",
    "mfapi": "https://www.mfapi.in",
    "advisorkhoj": "https://www.advisorkhoj.com",
    "treasury": "https://home.treasury.gov",
    "derived": "",
}


def format_ist_timestamp(dt_val: str | datetime | None) -> str | None:
    """Format any date or timestamp string/datetime into an ISO IST timestamp."""
    if not dt_val:
        return None
    if isinstance(dt_val, str):
        val = dt_val.strip()
        if not val or val.lower() in ("none", "null"):
            return None
        # Handle 'YYYY-MM-DD'
        if len(val) == 10 and val.count("-") == 2:
            try:
                d = datetime.strptime(val, "%Y-%m-%d").replace(tzinfo=IST)
                return d.isoformat()
            except ValueError:
                pass
        # Handle ISO strings
        try:
            iso_str = val.replace("Z", "+00:00")
            dt = datetime.fromisoformat(iso_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(IST).isoformat()
        except Exception:
            return val
    elif isinstance(dt_val, datetime):
        dt = dt_val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(IST).isoformat()
    return None


def with_meta(
    payload: dict[str, Any],
    source_key: str,
    fetched_at: str | datetime | None,
    source_url: str | None = None,
    field_or_group: str = "_default",
    stale: bool = False,
) -> dict[str, Any]:
    """Attach provenance metadata to a backoffice GET response payload."""
    if not isinstance(payload, dict):
        return payload

    url = source_url if source_url is not None else DEFAULT_SOURCE_URLS.get(source_key, "")
    formatted_time = format_ist_timestamp(fetched_at)

    meta_entry: dict[str, Any] = {
        "source": source_key,
        "fetched_at": formatted_time,
        "source_url": url,
        "stale": bool(stale),
    }

    current_meta = payload.get("meta")
    if not isinstance(current_meta, dict):
        current_meta = {}

    current_meta[field_or_group] = meta_entry
    if "_default" not in current_meta:
        current_meta["_default"] = meta_entry

    payload["meta"] = current_meta
    return payload
