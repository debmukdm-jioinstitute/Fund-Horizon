"""Database repository factory and entry points with process-wide caching."""
from __future__ import annotations

import os
from functools import lru_cache

from app.db.base import DatabaseRepository
from app.db.sqlite import SQLiteRepository

_CACHED_REPO: DatabaseRepository | None = None
_CACHED_DB_PATH: str | None = None


def get_repository() -> DatabaseRepository:
    """Return the process-wide cached DatabaseRepository instance.

    If DATABASE_URL is set and points to PostgreSQL (e.g. Supabase or Neon),
    returns a PostgresRepository with connection pooling.
    Otherwise, defaults to SQLiteRepository.
    """
    global _CACHED_REPO, _CACHED_DB_PATH
    db_url = os.environ.get("DATABASE_URL", "").strip()
    current_sqlite_path = os.environ.get("FH_DB_PATH", "").strip()

    if _CACHED_REPO is not None:
        if not db_url and isinstance(_CACHED_REPO, SQLiteRepository):
            if _CACHED_DB_PATH == current_sqlite_path:
                return _CACHED_REPO
        else:
            return _CACHED_REPO

    if db_url.startswith(("postgres://", "postgresql://")):
        from app.db.postgres import PostgresRepository

        _CACHED_REPO = PostgresRepository(db_url)
    else:
        _CACHED_REPO = SQLiteRepository()
        _CACHED_DB_PATH = current_sqlite_path
    return _CACHED_REPO



def reset_repository_cache() -> None:
    """Test helper to reset process-wide repo cache when swapping DB configs."""
    global _CACHED_REPO
    _CACHED_REPO = None


__all__ = ["DatabaseRepository", "SQLiteRepository", "get_repository", "reset_repository_cache"]
