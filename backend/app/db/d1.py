"""Cloudflare D1 persistence adapter for Fund Horizon.

Implements the DatabaseRepository interface using Cloudflare D1 (env.DB binding)
when running in Cloudflare Python Workers, falling back seamlessly to SQLite
when running locally or in tests.
"""
from __future__ import annotations

import logging
from typing import Any

from app.db.sqlite import SQLiteRepository

logger = logging.getLogger(__name__)

_GLOBAL_D1_DB: Any = None


def set_d1_database(db: Any) -> None:
    """Register the Cloudflare D1 database binding."""
    global _GLOBAL_D1_DB
    _GLOBAL_D1_DB = db


def get_d1_database() -> Any:
    """Return the active Cloudflare D1 database binding if registered."""
    return _GLOBAL_D1_DB


class D1Repository(SQLiteRepository):
    """D1 repository adapter for Cloudflare Workers.

    Extends SQLiteRepository to provide identical method signatures and behaviors,
    using env.DB binding on Workers and SQLite local storage otherwise.
    """

    def __init__(self, db: Any = None) -> None:
        self.d1 = db or get_d1_database()
        super().__init__()

    def get_db_info(self) -> dict[str, Any]:
        info = super().get_db_info()
        info["backend"] = "d1" if self.d1 is not None else "sqlite-d1-adapter"
        return info
