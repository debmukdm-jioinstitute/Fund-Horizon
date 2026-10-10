"""Tiny SQLite store: plans keyed by random UUID. No auth in the MVP.

# EXTENSION: add a user_id column once authentication exists.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path


def db_path() -> Path:
    return Path(os.environ.get("FH_DB_PATH", Path(__file__).resolve().parents[2] / "plans.db"))


def _conn() -> sqlite3.Connection:
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(p)
    c.execute(
        "CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, created_at TEXT NOT NULL,"
        " request TEXT NOT NULL, result TEXT NOT NULL)"
    )
    return c


def save_plan(request: dict, result: dict) -> str:
    plan_id = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            "INSERT INTO plans VALUES (?,?,?,?)",
            (plan_id, datetime.now(UTC).isoformat(), json.dumps(request), json.dumps(result)),
        )
    return plan_id


def get_plan(plan_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT id, created_at, request, result FROM plans WHERE id=?", (plan_id,)).fetchone()
    if not row:
        return None
    return {"id": row[0], "created_at": row[1], "request": json.loads(row[2]), "result": json.loads(row[3])}
