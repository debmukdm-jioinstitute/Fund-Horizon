"""Per-staff paper Trade desk state in SQLite (JSON blob)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from app.backoffice.trade.session import DEFAULTS
from app.db import sqlite


def _ensure_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS trade_desk (
            staff_id TEXT NOT NULL,
            desk_id TEXT NOT NULL DEFAULT 'default',
            state TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (staff_id, desk_id)
        )
        """
    )


def default_state() -> dict[str, Any]:
    return {
        "config": dict(DEFAULTS),
        "universe": "nifty50",
        "watchlist": None,
        "entry": None,
        "plan": None,
        "timemachine": None,
        "orders": None,
        "risk": None,
        "alerts": [],
        "alert_fired": [],
        "news": None,
        "portfolio": {"cash": float(DEFAULTS["budget"]), "positions": {}, "currency": "INR"},
        "broker": {"orders": []},
        "bars_cache": {},  # symbol -> chart dict (injected / last fetch)
        "bars_60d": {},  # symbol -> list of {date,slot,o,h,l,c}
        "updated_at": None,
    }


def load_desk(staff_id: str, desk_id: str = "default") -> dict[str, Any]:
    conn = sqlite.get_default_connection()
    try:
        _ensure_table(conn)
        row = conn.execute(
            "SELECT state FROM trade_desk WHERE staff_id=? AND desk_id=?",
            (staff_id, desk_id),
        ).fetchone()
        if not row:
            return default_state()
        data = json.loads(row["state"] if isinstance(row, dict) or hasattr(row, "keys") else row[0])
        base = default_state()
        base.update(data)
        # merge config defaults for new keys
        cfg = dict(DEFAULTS)
        cfg.update(base.get("config") or {})
        base["config"] = cfg
        return base
    finally:
        conn.close()


def save_desk(staff_id: str, state: dict[str, Any], desk_id: str = "default") -> dict[str, Any]:
    state = dict(state)
    state["updated_at"] = datetime.now(UTC).isoformat()
    # Never persist huge sample_paths forever — keep verdict payload lean
    tm = state.get("timemachine")
    if isinstance(tm, dict) and isinstance(tm.get("mc"), dict):
        mc = dict(tm["mc"])
        mc.pop("sample_paths", None)
        mc.pop("bands", None)
        tm = {**tm, "mc": mc}
        state["timemachine"] = tm
    conn = sqlite.get_default_connection()
    try:
        _ensure_table(conn)
        with conn:
            conn.execute(
                """
                INSERT INTO trade_desk (staff_id, desk_id, state, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(staff_id, desk_id) DO UPDATE SET
                    state=excluded.state,
                    updated_at=excluded.updated_at
                """,
                (staff_id, desk_id, json.dumps(state), state["updated_at"]),
            )
    finally:
        conn.close()
    return state
