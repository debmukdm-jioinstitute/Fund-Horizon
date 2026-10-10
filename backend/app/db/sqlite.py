"""Tiny SQLite store: plans keyed by random UUID. No auth in the MVP.

Plans expire after FH_PLAN_TTL_DAYS (default 30) and can be deleted by id.

# EXTENSION: add a user_id column once authentication exists.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path


def db_path() -> Path:
    return Path(os.environ.get("FH_DB_PATH", Path(__file__).resolve().parents[2] / "plans.db"))


def ttl_days() -> int:
    raw = os.environ.get("FH_PLAN_TTL_DAYS", "30")
    try:
        days = int(raw)
    except ValueError:
        days = 30
    return max(days, 0)


def _parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def expires_at(created_at: str) -> str:
    return (_parse_dt(created_at) + timedelta(days=ttl_days())).isoformat()


def _is_expired(created_at: str) -> bool:
    return datetime.now(UTC) >= _parse_dt(created_at) + timedelta(days=ttl_days())


def _conn() -> sqlite3.Connection:
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(p)
    c.execute(
        "CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, created_at TEXT NOT NULL,"
        " request TEXT NOT NULL, result TEXT NOT NULL)"
    )
    return c


def purge_expired() -> int:
    cutoff = (datetime.now(UTC) - timedelta(days=ttl_days())).isoformat()
    with _conn() as c:
        cur = c.execute("DELETE FROM plans WHERE created_at < ?", (cutoff,))
        return cur.rowcount


def save_plan(request: dict, result: dict) -> dict:
    purge_expired()
    plan_id = str(uuid.uuid4())
    created = datetime.now(UTC).isoformat()
    with _conn() as c:
        c.execute(
            "INSERT INTO plans VALUES (?,?,?,?)",
            (plan_id, created, json.dumps(request), json.dumps(result)),
        )
    return {"id": plan_id, "created_at": created, "expires_at": expires_at(created)}


def get_plan(plan_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT id, created_at, request, result FROM plans WHERE id=?", (plan_id,)).fetchone()
    if not row:
        return None
    if _is_expired(row[1]):
        delete_plan(plan_id)
        return None
    return {
        "id": row[0],
        "created_at": row[1],
        "expires_at": expires_at(row[1]),
        "request": json.loads(row[2]),
        "result": json.loads(row[3]),
    }


def delete_plan(plan_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM plans WHERE id=?", (plan_id,))
        return cur.rowcount > 0
