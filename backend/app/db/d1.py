from __future__ import annotations
"""Cloudflare D1 persistence adapter for Fund Horizon.

Implements the DatabaseRepository interface using Cloudflare D1 (env.DB binding)
when running in Cloudflare Python Workers, falling back seamlessly to SQLite
when running locally or in tests.
"""

import json
import logging
import os
import uuid
from datetime import UTC, datetime
from typing import Any

from app.db.sqlite import SQLiteRepository, expires_at

logger = logging.getLogger(__name__)

_GLOBAL_D1_DB: Any = None


def set_d1_database(db: Any) -> None:
    """Register the Cloudflare D1 database binding."""
    global _GLOBAL_D1_DB
    _GLOBAL_D1_DB = db


def get_d1_database() -> Any:
    """Return the active Cloudflare D1 database binding if registered."""
    return _GLOBAL_D1_DB


def on_workers() -> bool:
    """Return True if running in Cloudflare Workers."""
    if os.environ.get("CF_WORKER") == "1" or os.environ.get("WORKERS_RUNTIME") == "1":
        return True
    import sys
    if "pyodide" in sys.modules:
        return True
    try:
        import js  # Cloudflare Workers Python environment has js module
        return True
    except ImportError:
        pass
    try:
        import _pyodide
        return True
    except ImportError:
        pass
    return False


class D1Row(dict):
    """Simulate sqlite3.Row with both dict and integer index access."""

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)

    def get(self, key: Any, default: Any = None) -> Any:
        if isinstance(key, int):
            vals = list(self.values())
            return vals[key] if 0 <= key < len(vals) else default
        return super().get(key, default)


class D1Result:
    """Result set wrapper from D1 statement execution."""

    def __init__(self, rows: list[dict] | None = None, meta: Any = None) -> None:
        self._rows = [D1Row(r) for r in rows] if rows else []
        self._index = 0
        self.lastrowid = getattr(meta, "last_row_id", None) if meta else None
        self.rowcount = getattr(meta, "changes", 0) if meta else len(self._rows)

    def fetchone(self) -> D1Row | None:
        if self._index < len(self._rows):
            r = self._rows[self._index]
            self._index += 1
            return r
        return None

    def fetchall(self) -> list[D1Row]:
        rem = self._rows[self._index :]
        self._index = len(self._rows)
        return rem

    def __iter__(self):
        return iter(self.fetchall())


async def execute(sql: str, params: tuple | list = ()) -> D1Result:
    """Execute SQL with ? params on env.DB binding."""
    db = get_d1_database()
    if db is None:
        raise RuntimeError("D1 database binding not registered")

    stmt = db.prepare(sql)
    if params:
        stmt = stmt.bind(*params)
    res = await stmt.all()

    results = getattr(res, "results", res)
    if hasattr(results, "to_py"):
        raw_rows = results.to_py()
    else:
        raw_rows = results or []

    meta = getattr(res, "meta", None)
    return D1Result(raw_rows, meta)


async def fetchone(sql: str, params: tuple | list = ()) -> D1Row | None:
    res = await execute(sql, params)
    return res.fetchone()


async def fetchall(sql: str, params: tuple | list = ()) -> list[D1Row]:
    res = await execute(sql, params)
    return res.fetchall()


async def executemany(sql: str, seq_of_params: list | tuple) -> None:
    db = get_d1_database()
    if db is None:
        raise RuntimeError("D1 database binding not registered")

    for p in seq_of_params:
        stmt = db.prepare(sql)
        if p:
            stmt = stmt.bind(*p)
        await stmt.run()


class D1Repository(SQLiteRepository):
    """D1 repository adapter for Cloudflare Workers."""

    def __init__(self, db: Any = None) -> None:
        self.d1 = db or get_d1_database()
        if not on_workers():
            super().__init__()

    def get_db_info(self) -> dict[str, Any]:
        return {
            "backend": "d1",
            "d1_connected": self.d1 is not None or get_d1_database() is not None,
        }
