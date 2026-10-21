"""Database repository factory and entry points with process-wide caching."""
from __future__ import annotations

import os

from app.db.base import DatabaseRepository
from app.db.sqlite import SQLiteRepository

_CACHED_REPO: DatabaseRepository | None = None
_CACHED_DB_PATH: str | None = None


def get_repository() -> DatabaseRepository:
    """Return the process-wide cached DatabaseRepository instance.

    If running on Cloudflare Workers (or CF_WORKER=1), returns D1Repository.
    If DATABASE_URL is set and points to PostgreSQL, returns PostgresRepository.
    Otherwise, defaults to SQLiteRepository.
    """
    global _CACHED_REPO, _CACHED_DB_PATH

    is_workers = bool(os.environ.get("CF_WORKER") == "1" or os.environ.get("WORKERS_RUNTIME"))
    if is_workers:
        from app.db.d1 import D1Repository, get_d1_database

        if _CACHED_REPO is None or not isinstance(_CACHED_REPO, D1Repository):
            _CACHED_REPO = D1Repository(get_d1_database())
        return _CACHED_REPO

    db_url = os.environ.get("DATABASE_URL", "").strip()
    current_sqlite_path = os.environ.get("FH_DB_PATH", "").strip()

    wants_postgres = db_url.startswith(("postgres://", "postgresql://"))
    if _CACHED_REPO is not None:
        is_sqlite = isinstance(_CACHED_REPO, SQLiteRepository)
        if wants_postgres != is_sqlite and (wants_postgres or _CACHED_DB_PATH == current_sqlite_path):
            return _CACHED_REPO

    if wants_postgres:
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
