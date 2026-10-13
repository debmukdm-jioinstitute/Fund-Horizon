"""Supervised background collector loop for independent market refresh."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from app.backoffice.providers.amfi import AmfiProvider
from app.backoffice.providers.cboe import CboeProvider
from app.backoffice.providers.ecb import EcbProvider
from app.backoffice.providers.fred import FredProvider
from app.backoffice.providers.mfapi import MfapiProvider
from app.backoffice.repository import BackofficeRepository

logger = logging.getLogger("backoffice.collectors")

_REPO = BackofficeRepository()
_REFRESH_LOCK = asyncio.Lock()
_IN_PROGRESS: set[str] = set()


async def refresh_source(source_id: str) -> dict[str, Any]:
    """Execute collection for a single source outside of request event loop."""
    async with _REFRESH_LOCK:
        if source_id in _IN_PROGRESS:
            return {"status": "coalesced", "source_id": source_id, "message": "Refresh already in progress"}
        _IN_PROGRESS.add(source_id)

    started_at = datetime.now(UTC).isoformat()
    try:
        loop = asyncio.get_running_loop()

        if source_id == "SRC_AMFI":
            provider = AmfiProvider()
            res = await loop.run_in_executor(None, provider.fetch)
            if res.success:
                saved = await loop.run_in_executor(None, _REPO.upsert_observations, res.observations)
                _REPO.update_source_health(source_id, "ready", success=True)
                return {"status": "success", "source_id": source_id, "records_ingested": saved}
            else:
                _REPO.update_source_health(source_id, res.status, error_message=res.error_message, success=False)
                return {"status": res.status, "source_id": source_id, "error": res.error_message}

        elif source_id == "SRC_ECB":
            provider = EcbProvider()
            res = await loop.run_in_executor(None, provider.fetch)
            if res.success:
                saved = await loop.run_in_executor(None, _REPO.upsert_observations, res.observations)
                _REPO.update_source_health(source_id, "ready", success=True)
                return {"status": "success", "source_id": source_id, "records_ingested": saved}
            else:
                _REPO.update_source_health(source_id, res.status, error_message=res.error_message, success=False)
                return {"status": res.status, "source_id": source_id, "error": res.error_message}

        elif source_id == "SRC_CBOE":
            provider = CboeProvider()
            res = await loop.run_in_executor(None, provider.fetch)
            if res.success:
                saved = await loop.run_in_executor(None, _REPO.upsert_observations, res.observations)
                _REPO.update_source_health(source_id, "ready", success=True)
                return {"status": "success", "source_id": source_id, "records_ingested": saved}
            else:
                _REPO.update_source_health(source_id, res.status, error_message=res.error_message, success=False)
                return {"status": res.status, "source_id": source_id, "error": res.error_message}

        elif source_id == "SRC_FRED":
            provider = FredProvider()
            res = await loop.run_in_executor(None, provider.fetch, "DGS10")
            if res.success:
                saved = await loop.run_in_executor(None, _REPO.upsert_observations, res.observations)
                _REPO.update_source_health(source_id, "ready", success=True)
                return {"status": "success", "source_id": source_id, "records_ingested": saved}
            else:
                _REPO.update_source_health(source_id, res.status, error_message=res.error_message, success=False)
                return {"status": res.status, "source_id": source_id, "error": res.error_message}

        return {"status": "manual_only", "source_id": source_id, "message": "Manual import required for this source"}

    except Exception as e:
        logger.error(f"Collector run failed for {source_id}: {e}", exc_info=True)
        _REPO.update_source_health(source_id, "unavailable", error_message=str(e), success=False)
        return {"status": "failed", "source_id": source_id, "error": str(e)}
    finally:
        _IN_PROGRESS.discard(source_id)


async def run_collector_loop(interval_seconds: int = 3600) -> None:
    """Supervised periodic background loop running during FastAPI lifespan."""
    logger.info("Starting Fund Horizon supervised backoffice collector loop...")
    while True:
        try:
            # Refresh automated sources sequentially with bounded concurrency
            for src in ("SRC_ECB", "SRC_CBOE", "SRC_FRED"):
                await refresh_source(src)
                await asyncio.sleep(2.0)  # Rate pacing
        except asyncio.CancelledError:
            logger.info("Collector loop cancelled gracefully.")
            break
        except Exception as e:
            logger.error(f"Unhandled error in collector loop: {e}", exc_info=True)

        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            break
