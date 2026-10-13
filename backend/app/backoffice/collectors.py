"""Supervised background collectors that keep every market feed live.

Each source has its own refresh interval. A single loop wakes every ``TICK_SECONDS`` and runs whichever sources are
due, so intraday NSE data refreshes every few minutes while daily sources are polled hourly (AMFI every six hours).
Request handlers can also call ``refresh_source`` for an on-demand refresh.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from app.backoffice.providers.amfi import AmfiProvider
from app.backoffice.providers.base import FetchResult
from app.backoffice.providers import amfi_ter, apmi, rss
from app.backoffice.providers.cboe import CboeProvider
from app.backoffice.providers.ecb import EcbProvider
from app.backoffice.providers.fred import FredProvider
from app.backoffice.providers.india_yields import IndiaYieldsProvider
from app.backoffice.providers.nse import NseError, get_nse_client
from app.backoffice.providers.treasury import TreasuryProvider
from app.backoffice.repository import BackofficeRepository

logger = logging.getLogger("backoffice.collectors")

_REPO = BackofficeRepository()
_REFRESH_LOCK = asyncio.Lock()
_IN_PROGRESS: set[str] = set()

TICK_SECONDS = 60
# source id -> minimum seconds between automatic refreshes
REFRESH_INTERVALS: dict[str, int] = {
    "SRC_NSE_FNO": 300,
    "SRC_ECB": 3600,
    "SRC_CBOE": 3600,
    "SRC_TREASURY": 3600,
    "SRC_FRED": 3600,
    "SRC_AMFI": 6 * 3600,
    "SRC_AMFI_TER": 24 * 3600,
    "SRC_IN_YIELDS": 1800,
    "SRC_RSS": 600,
    "SRC_APMI": 12 * 3600,
}
_LAST_RUN: dict[str, float] = {}

# NSE index names we persist as observations (instrument id -> NSE index name)
NSE_INDEX_SERIES = {
    "VOL:IN:INDIAVIX": "INDIA VIX",
    "INDEX:IN:NIFTY50": "NIFTY 50",
    "INDEX:IN:NIFTYBANK": "NIFTY BANK",
}


def _plan_of(scheme_name: str) -> str:
    return "Direct" if "direct" in scheme_name.lower() else "Regular"


def _ingest(source_id: str, res: FetchResult) -> dict[str, Any]:
    if not res.success:
        _REPO.update_source_health(source_id, res.status, error_message=res.error_message, success=False)
        return {"status": res.status, "source_id": source_id, "error": res.error_message}
    saved = _REPO.upsert_observations(res.observations)
    if source_id == "SRC_AMFI":
        schemes = [
            {**s, "plan": _plan_of(s.get("scheme_name", ""))} for s in (res.metadata or {}).get("schemes", [])
        ]
        _REPO.replace_mf_schemes(schemes)
    _REPO.update_source_health(source_id, "ready", success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": saved}


def refresh_ter() -> dict[str, Any]:
    source_id = "SRC_AMFI_TER"
    rows = amfi_ter.fetch_latest()
    if not rows:
        _REPO.update_source_health(source_id, "unavailable", error_message="AMFI TER API returned no rows", success=False)
        return {"status": "unavailable", "source_id": source_id, "error": "AMFI TER API returned no rows"}
    saved = _REPO.replace_mf_ter(rows)
    _REPO.update_source_health(source_id, "ready", success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": saved}


def refresh_apmi() -> dict[str, Any]:
    source_id = "SRC_APMI"
    try:
        snap = apmi.fetch_snapshot()
    except Exception as e:  # network/HTTP errors must not crash the loop
        _REPO.update_source_health(source_id, "unavailable", error_message=str(e)[:300], success=False)
        return {"status": "unavailable", "source_id": source_id, "error": str(e)}
    if snap is None:
        _REPO.update_source_health(source_id, "unavailable", error_message="APMI returned no providers or strategies", success=False)
        return {"status": "unavailable", "source_id": source_id, "error": "APMI returned no data"}
    saved = _REPO.replace_pms_universe(snap.as_on, snap.providers, snap.strategies)
    _REPO.update_source_health(source_id, "ready", success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": saved, "as_on": snap.as_on}


def refresh_rss() -> dict[str, Any]:
    source_id = "SRC_RSS"
    items, errors = rss.fetch_all()
    if not items:
        msg = "; ".join(f"{k}: {v}" for k, v in errors.items()) or "no items"
        _REPO.update_source_health(source_id, "unavailable", error_message=msg[:500], success=False)
        return {"status": "unavailable", "source_id": source_id, "error": msg}
    saved = _REPO.upsert_news(items)
    warn = "; ".join(f"{k}: {v}" for k, v in errors.items())[:500] or None
    _REPO.update_source_health(source_id, "ready", error_message=warn, success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": saved, "feed_errors": errors}


def refresh_nse() -> dict[str, Any]:
    """Pull India VIX / index levels and the latest FII-DII session from NSE (blocking; run in an executor)."""
    source_id = "SRC_NSE_FNO"
    client = get_nse_client()
    ingested = 0
    errors: list[str] = []
    status = "ready"

    try:
        snap = client.fetch_indices()
        obs = []
        for inst_id, index_name in NSE_INDEX_SERIES.items():
            row = snap["indices"].get(index_name)
            if row:
                obs.append({
                    "instrument_id": inst_id,
                    "observed_at": snap["as_of"],
                    "value_numeric": row["last"],
                    "frequency": "intraday",
                    "provenance": "NSE",
                })
        ingested += _REPO.upsert_observations(obs)
    except NseError as e:
        errors.append(f"indices: {e}")
        status = e.status

    try:
        ingested += _REPO.replace_flows(client.fetch_fii_dii())
    except NseError as e:
        errors.append(f"flows: {e}")
        status = e.status

    if errors and not ingested:
        _REPO.update_source_health(source_id, status, error_message="; ".join(errors), success=False)
        return {"status": status, "source_id": source_id, "error": "; ".join(errors)}
    _REPO.update_source_health(source_id, "ready", error_message="; ".join(errors) or None, success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": ingested, "warnings": errors}


RETRY_AFTER_FAILURE_SECONDS = 300


async def refresh_source(source_id: str) -> dict[str, Any]:
    """Run one source, then schedule the next automatic run (soon after a failure, a full interval after success)."""
    result = await _refresh_source(source_id)
    interval = REFRESH_INTERVALS.get(source_id)
    if interval and result.get("status") not in ("success", "coalesced", "manual_only"):
        # A network blip must not delay a daily/12-hourly feed by its whole interval.
        _LAST_RUN[source_id] = time.monotonic() - interval + min(interval, RETRY_AFTER_FAILURE_SECONDS)
    return result


async def _refresh_source(source_id: str) -> dict[str, Any]:
    """Execute collection for a single source outside of request event loop."""
    async with _REFRESH_LOCK:
        if source_id in _IN_PROGRESS:
            return {"status": "coalesced", "source_id": source_id, "message": "Refresh already in progress"}
        _IN_PROGRESS.add(source_id)

    try:
        loop = asyncio.get_running_loop()

        if source_id == "SRC_NSE_FNO":
            return await loop.run_in_executor(None, refresh_nse)

        if source_id == "SRC_AMFI_TER":
            return await loop.run_in_executor(None, refresh_ter)
        if source_id == "SRC_APMI":
            return await loop.run_in_executor(None, refresh_apmi)
        if source_id == "SRC_RSS":
            return await loop.run_in_executor(None, refresh_rss)

        providers = {
            "SRC_IN_YIELDS": IndiaYieldsProvider,
            "SRC_AMFI": AmfiProvider,
            "SRC_ECB": EcbProvider,
            "SRC_CBOE": CboeProvider,
            "SRC_TREASURY": TreasuryProvider,
        }
        if source_id in providers:
            res = await loop.run_in_executor(None, providers[source_id]().fetch)
            return await loop.run_in_executor(None, _ingest, source_id, res)

        if source_id == "SRC_FRED":
            # Broad-dollar index plus India monthly yields (fallback behind the daily scraped curve).
            res = await loop.run_in_executor(None, FredProvider().fetch_all)
            return await loop.run_in_executor(None, _ingest, source_id, res)

        return {"status": "manual_only", "source_id": source_id, "message": "Manual import required for this source"}

    except Exception as e:
        logger.error("Collector run failed for %s: %s", source_id, e, exc_info=True)
        _REPO.update_source_health(source_id, "unavailable", error_message=str(e), success=False)
        return {"status": "failed", "source_id": source_id, "error": str(e)}
    finally:
        _IN_PROGRESS.discard(source_id)
        _LAST_RUN[source_id] = time.monotonic()


def _due_sources() -> list[str]:
    now = time.monotonic()
    due = []
    for src, interval in REFRESH_INTERVALS.items():
        if src == "SRC_FRED" and not os.environ.get("FRED_API_KEY", "").strip():
            continue  # keyless deployments skip FRED instead of reporting a permanent failure
        if now - _LAST_RUN.get(src, float("-inf")) >= interval:
            due.append(src)
    return due


async def run_collector_loop(interval_seconds: int = TICK_SECONDS) -> None:
    """Supervised periodic background loop running during FastAPI lifespan."""
    logger.info("Starting Fund Horizon supervised backoffice collector loop...")
    while True:
        try:
            for src in _due_sources():
                result = await refresh_source(src)
                if result.get("status") not in ("success", "coalesced"):
                    logger.warning("Refresh %s -> %s", src, result)
                await asyncio.sleep(1.0)  # rate pacing
        except asyncio.CancelledError:
            logger.info("Collector loop cancelled gracefully.")
            break
        except Exception as e:
            logger.error("Unhandled error in collector loop: %s", e, exc_info=True)

        try:
            await asyncio.sleep(min(interval_seconds, TICK_SECONDS))
        except asyncio.CancelledError:
            break


__all__ = ["refresh_source", "run_collector_loop", "refresh_nse"]
