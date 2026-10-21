"""Cloudflare Python Workers entry point for Fund Horizon API."""
from __future__ import annotations

import logging
import os
from typing import Any

from workers import WorkerEntrypoint, asgi

from app.db.d1 import set_d1_database
from app.main import app
from app.storage.r2 import set_worker_files

logger = logging.getLogger(__name__)


class Default(WorkerEntrypoint):
    """Cloudflare Worker ASGI entry point with D1, R2, and cron triggers."""

    async def fetch(self, request: Any) -> Any:
        os.environ["CF_WORKER"] = "1"
        os.environ["WORKERS_RUNTIME"] = "1"

        if hasattr(self.env, "DB"):
            set_d1_database(self.env.DB)
        if hasattr(self.env, "FILES"):
            set_worker_files(self.env.FILES)

        return await asgi.fetch(app, request, self.env)

    async def scheduled(self, event: Any) -> None:
        os.environ["CF_WORKER"] = "1"
        if hasattr(self.env, "DB"):
            set_d1_database(self.env.DB)
        if hasattr(self.env, "FILES"):
            set_worker_files(self.env.FILES)

        try:
            from app.backoffice.collectors import build_daily_briefing

            build_daily_briefing()
        except Exception:
            logger.exception("Scheduled briefing build failed")

        try:
            from app.backup import backup_sqlite

            backup_sqlite()
        except Exception:
            logger.exception("Scheduled backup failed")
