"""Database repository factory and entry points."""
from __future__ import annotations

import os

from app.db.base import DatabaseRepository
from app.db.sqlite import SQLiteRepository


def get_repository() -> DatabaseRepository:
    """Return the configured DatabaseRepository instance.

    If DATABASE_URL is set and points to PostgreSQL (e.g. Supabase or Neon),
    returns a PostgresRepository with connection pooling.
    Otherwise, defaults to SQLiteRepository.
    """
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url.startswith(("postgres://", "postgresql://")):
        from app.db.postgres import PostgresRepository

        return PostgresRepository(db_url)
    return SQLiteRepository()


__all__ = ["DatabaseRepository", "SQLiteRepository", "get_repository"]
