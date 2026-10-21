from __future__ import annotations
"""Supervised background collectors that keep every market feed live.

Each source has its own refresh interval. A single loop wakes every ``TICK_SECONDS`` and runs whichever sources are
due, so intraday NSE data refreshes every few minutes while daily sources are polled hourly (AMFI every six hours).
Request handlers can also call ``refresh_source`` for an on-demand refresh.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.backoffice.providers import amfi_ter, apmi, factsheets, rss
from app.backoffice.providers.amfi import AmfiProvider, classify_plan_option
from app.backoffice.providers.base import FetchResult
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
    "SRC_FACTSHEETS": 6 * 3600,
    "SRC_SCREENING": 24 * 3600,
}
_LAST_RUN: dict[str, float] = {}

# NSE index names we persist as observations (instrument id -> NSE index name)
NSE_INDEX_SERIES = {
    "VOL:IN:INDIAVIX": "INDIA VIX",
    "INDEX:IN:NIFTY50": "NIFTY 50",
    "INDEX:IN:NIFTYBANK": "NIFTY BANK",
}


def _ingest(source_id: str, res: FetchResult) -> dict[str, Any]:
    if not res.success:
        _REPO.update_source_health(source_id, res.status, error_message=res.error_message, success=False)
        return {"status": res.status, "source_id": source_id, "error": res.error_message}
    saved = _REPO.upsert_observations(res.observations)
    if source_id == "SRC_AMFI":
        schemes = []
        for s in (res.metadata or {}).get("schemes", []):
            plan, option = classify_plan_option(s.get("scheme_name") or "", s.get("plan"), s.get("option"))
            schemes.append({**s, "plan": plan, "option": option})
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
    backfilled = _backfill_apmi_history()
    _REPO.update_source_health(source_id, "ready", success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": saved, "as_on": snap.as_on, "backfilled_months": backfilled}


APMI_HISTORY_MONTHS = 48
APMI_BACKFILL_PER_RUN = 12  # bounds one run; the 12-hourly loop finishes the rest


def _backfill_apmi_history() -> int:
    """Fill month-ends APMI has published but we never stored, so strategy history keeps growing without manual runs."""
    have = _REPO.pms_as_on_months()
    done = 0
    for as_on in apmi.candidate_months(count=APMI_HISTORY_MONTHS):
        if as_on in have:
            continue
        if done >= APMI_BACKFILL_PER_RUN:
            break
        try:
            snap = apmi.fetch_snapshot([as_on])
        except Exception as e:  # one bad month must not fail the whole refresh
            logger.warning("APMI backfill %s failed: %s", as_on, e)
            continue
        # shortcut: months before APMI's first publication re-fetch every run (~2s each), cap this if the window grows
        if snap:
            _REPO.replace_pms_universe(snap.as_on, snap.providers, snap.strategies)
            done += 1
    return done


FACTSHEET_BACKFILL_MONTHS = 96  # first run per source; afterwards only the newest months are re-checked
FACTSHEET_RECENT_MONTHS = 4


def factsheet_archive_dir() -> Path:
    from app.db import sqlite

    return Path(os.environ.get("FH_FACTSHEET_DIR") or Path(sqlite.get_default_db_path()).parent / "factsheets")


def factsheet_links_file() -> Path:
    from app.data.loader import data_dir

    return data_dir().parent / "factsheet_links" / "browser.json"


def refresh_factsheets() -> dict[str, Any]:
    """Look for newly released official factsheets for every curated source and record the ones that verify."""
    source_id = "SRC_FACTSHEETS"
    new, failed = 0, []
    try:
        browser_links = json.loads(factsheet_links_file().read_text())
    except (OSError, ValueError):
        browser_links = {}  # file absent or unreadable: browser-only sources simply keep what they already have
    with factsheets.new_client() as client:
        for src in factsheets.SOURCES.values():
            have = _REPO.factsheet_periods(src.key)
            try:
                found = factsheets.discover_links_file(src, browser_links)  # whatever the CI browser scraper recorded
                if src.templates:
                    count = FACTSHEET_RECENT_MONTHS if have else FACTSHEET_BACKFILL_MONTHS
                    months = [(y, m) for y, m in factsheets.recent_months(count) if f"{y}-{m:02d}" not in have]
                    found += factsheets.discover_templates(client, src, months)
                elif src.listing_url:
                    found += factsheets.discover_listing(client, src)
                elif src.fixed_url:
                    found += factsheets.discover_fixed(client, src, factsheet_archive_dir(), have)
            except Exception as e:  # one broken publisher must not stop the others
                logger.warning("factsheets %s failed: %s", src.key, e)
                failed.append(src.key)
                continue
            new += sum(_REPO.upsert_factsheet(src.key, f) for f in found)
    if failed and len(failed) == len(factsheets.SOURCES):
        _REPO.update_source_health(source_id, "unavailable", error_message="all factsheet sources failed", success=False)
        return {"status": "unavailable", "source_id": source_id, "error": "all factsheet sources failed"}
    _REPO.update_source_health(source_id, "ready", error_message=("failed: " + ", ".join(failed)) if failed else None, success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": new, "failed_sources": failed}


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


IST = ZoneInfo("Asia/Kolkata")
_LAST_FLOW_FETCH: float = 0.0


def should_fetch_flows(force: bool = False) -> tuple[bool, str]:
    """Determine whether NSE FII/DII cash flows should be polled.

    Weekdays only, 17:30-22:30 IST, every 15 minutes, stopping once today's row exists.
    """
    if force:
        return True, "forced_manual_refresh"
    now_ist = datetime.now(IST)
    if now_ist.weekday() >= 5:
        return False, "weekend"
    hm = (now_ist.hour, now_ist.minute)
    if not ((17, 30) <= hm <= (22, 30)):
        return False, f"outside_window ({now_ist.strftime('%H:%M')} IST)"
    today_iso = now_ist.strftime("%Y-%m-%d")
    if _REPO.has_flow_for_date(today_iso):
        return False, f"today_already_ingested ({today_iso})"
    global _LAST_FLOW_FETCH
    if time.monotonic() - _LAST_FLOW_FETCH < 900:
        return False, "throttled_15min"
    return True, "due"


def refresh_nse(force_flows: bool = False) -> dict[str, Any]:
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

    fetch_flows, flow_reason = should_fetch_flows(force=force_flows)
    if fetch_flows:
        try:
            global _LAST_FLOW_FETCH
            _LAST_FLOW_FETCH = time.monotonic()
            ingested += _REPO.replace_flows(client.fetch_fii_dii())
        except NseError as e:
            errors.append(f"flows: {e}")
            status = e.status
    else:
        logger.debug("Skipping NSE flows fetch: %s", flow_reason)

    if errors and not ingested:
        _REPO.update_source_health(source_id, status, error_message="; ".join(errors), success=False)
        return {"status": status, "source_id": source_id, "error": "; ".join(errors)}
    _REPO.update_source_health(source_id, "ready", error_message="; ".join(errors) or None, success=True)
    return {"status": "success", "source_id": source_id, "records_ingested": ingested, "warnings": errors}


RETRY_AFTER_FAILURE_SECONDS = 300


async def refresh_source(source_id: str, force: bool = False) -> dict[str, Any]:
    """Run one source, then schedule the next automatic run (soon after a failure, a full interval after success)."""
    try:
        result = await _refresh_source(source_id, force=force)
    except TypeError:
        result = await _refresh_source(source_id)
    interval = REFRESH_INTERVALS.get(source_id)
    if interval and result.get("status") not in ("success", "coalesced", "manual_only"):
        # A network blip must not delay a daily/12-hourly feed by its whole interval.
        _LAST_RUN[source_id] = time.monotonic() - interval + min(interval, RETRY_AFTER_FAILURE_SECONDS)
    return result


async def _refresh_source(source_id: str, force: bool = False) -> dict[str, Any]:
    """Execute collection for a single source outside of request event loop."""
    async with _REFRESH_LOCK:
        if source_id in _IN_PROGRESS:
            return {"status": "coalesced", "source_id": source_id, "message": "Refresh already in progress"}
        _IN_PROGRESS.add(source_id)

    try:
        loop = asyncio.get_running_loop()

        if source_id == "SRC_NSE_FNO":
            return await loop.run_in_executor(None, refresh_nse, force)

        if source_id == "SRC_AMFI_TER":
            return await loop.run_in_executor(None, refresh_ter)
        if source_id == "SRC_APMI":
            return await loop.run_in_executor(None, refresh_apmi)
        if source_id == "SRC_RSS":
            return await loop.run_in_executor(None, refresh_rss)
        if source_id == "SRC_FACTSHEETS":
            return await loop.run_in_executor(None, refresh_factsheets)
        if source_id == "SRC_SCREENING":
            from app.backoffice.screening.jobs import refresh_screening
            return await loop.run_in_executor(None, refresh_screening)

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
        # Screening reads AMFI schemes and TER: wait for both, or it runs once on deploy with an empty TER table.
        if src == "SRC_SCREENING" and not all(s in _LAST_RUN for s in ("SRC_AMFI", "SRC_AMFI_TER")):
            continue
        if now - _LAST_RUN.get(src, float("-inf")) >= interval:
            due.append(src)
    return due


async def run_collector_loop(interval_seconds: int = TICK_SECONDS) -> None:
    """Supervised periodic background loop running during FastAPI lifespan."""
    logger.info("Starting Fund Horizon supervised backoffice collector loop...")
    while True:
        try:
            screening_ok = False
            for src in _due_sources():
                result = await refresh_source(src)
                if src == "SRC_SCREENING" and (result.get("success") or result.get("status") == "success"):
                    screening_ok = True
                elif result.get("status") not in ("success", "coalesced"):
                    logger.warning("Refresh %s -> %s", src, result)
                await asyncio.sleep(1.0)  # rate pacing
            # A brief built earlier today used the previous screening run: rebuild it (idempotent upsert) so its
            # "Screening changes" never lag the refreshed data.
            if screening_ok and not briefing_due():
                from app.backoffice.analytics.briefing_builder import ist_today

                if _REPO.get_briefing_by_date(ist_today()) is not None:
                    await asyncio.to_thread(build_daily_briefing)
                    logger.info("Daily briefing rebuilt after screening refresh")
            # Daily briefing: once at/after 08:00 IST, after the prerequisite
            # collectors ran today; idempotent so a repeat tick is a no-op.
            if briefing_due():
                built = await asyncio.to_thread(build_daily_briefing)
                logger.info("Daily briefing built: %s", built)
        except asyncio.CancelledError:
            logger.info("Collector loop cancelled gracefully.")
            break
        except Exception as e:
            logger.error("Unhandled error in collector loop: %s", e, exc_info=True)

        try:
            await asyncio.sleep(min(interval_seconds, TICK_SECONDS))
        except asyncio.CancelledError:
            break


__all__ = ["refresh_source", "run_collector_loop", "refresh_nse", "build_daily_briefing", "briefing_due"]


# ---------------------------------------------------------------------------
# Daily briefing job (08:00 IST, idempotent)
# ---------------------------------------------------------------------------

def briefing_due() -> bool:
    """True when the daily briefing should be built now.

    Conditions: IST time is at/after 08:00, today's briefing row is missing,
    and the prerequisite collectors (AMFI, NSE, RSS, yields) have each logged a
    successful run today. Synchronous and DB-light; safe to call every loop tick.
    """
    from zoneinfo import ZoneInfo

    from app.backoffice.analytics.briefing_builder import (
        BRIEFING_HOUR_IST,
        BRIEFING_PREREQ_SOURCES,
        ist_date_of,
        ist_today,
    )

    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    if now_ist.hour < BRIEFING_HOUR_IST:
        return False
    today = ist_today()
    if _REPO.get_briefing_by_date(today) is not None:
        return False
    ready = set()
    for s in _REPO.list_sources():
        if s["id"] in BRIEFING_PREREQ_SOURCES and s.get("last_success_at"):
            if ist_date_of(s["last_success_at"]) == today:
                ready.add(s["id"])
    return all(src in ready for src in BRIEFING_PREREQ_SOURCES)


def build_daily_briefing(brief_date: str | None = None) -> dict[str, Any]:
    """Build and store the daily briefing (idempotent upsert keyed by brief_date)."""
    from app.backoffice.analytics.briefing_builder import build_daily_briefing as _build

    return _build(_REPO, brief_date)
