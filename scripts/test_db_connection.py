"""Verify DATABASE_URL in backend/.env. Does not create tables.

    python scripts/test_db_connection.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")


def _hint(message: str, url: str) -> str:
    host = urlsplit(url).hostname or ""
    if "password authentication failed" in message:
        return "Database password in DATABASE_URL does not match the project password."
    if "tenant or user not found" in message.lower() or "Tenant or user not found" in message:
        return "Pooler user must be postgres.<project-ref>, copied from the URI tab."
    if host.startswith("db.") and host.endswith(".supabase.co"):
        return "Direct host is often IPv6-only on the free tier. Use URI tab, Mode: Transaction, port 6543."
    if "could not translate host" in message or "Name or service not known" in message:
        return "Host in DATABASE_URL did not resolve. Copy the URI again from Project Settings, Database."
    return "Copy a fresh URI from Project Settings, Database, Connection string, URI, Transaction."


def main() -> int:
    from app.db.postgres import connect, database_url, normalize_database_url

    raw = database_url()
    if not raw:
        print("DATABASE_URL is not set in backend/.env.")
        print("Paste the Supabase Transaction URI (port 6543) as DATABASE_URL, then re-run.")
        return 1

    url = normalize_database_url(raw)
    parts = urlsplit(url)
    user = parts.username or ""
    if "pooler.supabase.com" in (parts.hostname or "") and not user.startswith("postgres."):
        print(f"Pooler user is {user!r}. It needs to be postgres.<project-ref>.")
        return 1

    try:
        with connect() as conn:
            row = conn.execute("SELECT current_database(), current_user").fetchone()
    except Exception as exc:
        print(f"Connection failed: {exc}")
        print(_hint(str(exc), url))
        return 1

    print(f"Connected to database {row[0]!r} as {row[1]!r} on {parts.hostname}:{parts.port}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
