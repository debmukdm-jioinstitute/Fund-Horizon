"""SQLite persistence repository for Fund Horizon.

Provides fast, zero-dependency local storage for development and unit testing.
Implements DatabaseRepository interface.
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
from typing import Any

from app.db.base import DatabaseRepository


def get_default_db_path() -> Path:
    return Path(os.environ.get("FH_DB_PATH", Path(__file__).resolve().parents[2] / "plans.db"))


<<<<<<< HEAD
def db_path() -> Path:
    return get_default_db_path()


class SQLiteRepository(DatabaseRepository):
    """SQLite implementation of DatabaseRepository."""

    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path else get_default_db_path()
        self._init_schema()

    def _get_connection(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        conn = self._get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS plans (
                        id TEXT PRIMARY KEY,
                        created_at TEXT NOT NULL,
                        request TEXT NOT NULL,
                        result TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cas_sessions (
                        session_id TEXT PRIMARY KEY,
                        created_at TEXT NOT NULL,
                        investor_name TEXT,
                        total_value REAL NOT NULL DEFAULT 0.0,
                        xirr REAL,
                        payload TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS funds (
                        scheme_code TEXT PRIMARY KEY,
                        scheme_name TEXT NOT NULL,
                        amc TEXT NOT NULL,
                        category TEXT NOT NULL,
                        plan TEXT NOT NULL DEFAULT 'Regular',
                        option TEXT NOT NULL DEFAULT 'Growth',
                        isin TEXT,
                        latest_nav REAL,
                        latest_nav_date TEXT,
                        data_quality TEXT NOT NULL DEFAULT 'ok'
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS metrics (
                        scheme_code TEXT PRIMARY KEY,
                        ret_1m REAL,
                        ret_3m REAL,
                        ret_6m REAL,
                        ret_1y REAL,
                        cagr_3y REAL,
                        cagr_5y REAL,
                        cagr_7y REAL,
                        cagr_10y REAL,
                        vol_3y REAL,
                        sharpe_3y REAL,
                        sortino_3y REAL,
                        max_drawdown_3y REAL,
                        max_drawdown_all REAL,
                        data_asof TEXT NOT NULL DEFAULT '2026-10-09'
                    )
                    """
                )
        finally:
            conn.close()

    def save_plan(self, request: dict[str, Any], result: dict[str, Any], plan_id: str | None = None) -> str:
        pid = plan_id or str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO plans (id, created_at, request, result) VALUES (?, ?, ?, ?)",
                    (pid, now, json.dumps(request), json.dumps(result)),
                )
            return pid
        finally:
            conn.close()

    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT id, created_at, request, result FROM plans WHERE id = ?",
                (plan_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "created_at": row["created_at"],
                "request": json.loads(row["request"]),
                "result": json.loads(row["result"]),
            }
        finally:
            conn.close()

    def list_plans(self, limit: int = 50, offset: int = 0, search: str | None = None) -> list[dict[str, Any]]:
        conn = self._get_connection()
        try:
            if search:
                pattern = f"%{search}%"
                rows = conn.execute(
                    "SELECT id, created_at, request, result FROM plans WHERE id LIKE ? OR request LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (pattern, pattern, limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, created_at, request, result FROM plans ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
            plans = []
            for r in rows:
                req = json.loads(r["request"])
                res = json.loads(r["result"])
                client = req.get("client", {})
                first_name = client.get("first_name", "Anonymous")
                last_name = client.get("last_name", "")
                name = f"{first_name} {last_name}".strip()
                plans.append({
                    "id": r["id"],
                    "created_at": r["created_at"],
                    "client_name": name or "Anonymous",
                    "age": client.get("age"),
                    "risk_band": res.get("profile", {}).get("band"),
                    "risk_score": res.get("profile", {}).get("score"),
                    "target_corpus": sum(g.get("future_cost", 0) for g in res.get("goals", [])),
                    "total_sip": res.get("sip", {}).get("total_monthly_sip"),
                    "goals_count": len(res.get("goals", [])),
                    "request": req,
                    "result": res,
                })
            return plans
        finally:
            conn.close()

    def count_plans(self) -> int:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT COUNT(*) AS c FROM plans").fetchone()
            return int(row["c"]) if row else 0
        finally:
            conn.close()

    def delete_plan(self, plan_id: str) -> bool:
        conn = self._get_connection()
        try:
            with conn:
                cur = conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
                return cur.rowcount > 0
        finally:
            conn.close()


    def save_cas_session(
        self,
        payload: dict[str, Any],
        investor_name: str | None = None,
        total_value: float = 0.0,
        xirr: float | None = None,
        session_id: str | None = None,
    ) -> str:
        sid = session_id or str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO cas_sessions (session_id, created_at, investor_name, total_value, xirr, payload)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (sid, now, investor_name, total_value, xirr, json.dumps(payload)),
                )
            return sid
        finally:
            conn.close()

    def get_cas_session(self, session_id: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT session_id, created_at, investor_name, total_value, xirr, payload FROM cas_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "session_id": row["session_id"],
                "created_at": row["created_at"],
                "investor_name": row["investor_name"],
                "total_value": row["total_value"],
                "xirr": row["xirr"],
                "payload": json.loads(row["payload"]),
            }
        finally:
            conn.close()

    def list_cas_sessions(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT session_id, created_at, investor_name, total_value, xirr, payload FROM cas_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            sessions = []
            for r in rows:
                payload = json.loads(r["payload"])
                sessions.append({
                    "session_id": r["session_id"],
                    "created_at": r["created_at"],
                    "investor_name": r["investor_name"] or "Anonymous",
                    "total_value": r["total_value"],
                    "xirr": r["xirr"],
                    "holdings_count": len(payload.get("holdings", [])),
                    "direct_pct": payload.get("allocation_split", {}).get("direct_pct", 0),
                    "regular_pct": payload.get("allocation_split", {}).get("regular_pct", 0),
                    "payload": payload,
                })
            return sessions
        finally:
            conn.close()

    def count_cas_sessions(self) -> int:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT COUNT(*) AS c FROM cas_sessions").fetchone()
            return int(row["c"]) if row else 0
        finally:
            conn.close()


    def upsert_funds(self, funds: list[dict[str, Any]]) -> int:
        if not funds:
            return 0
        conn = self._get_connection()
        count = 0
        try:
            with conn:
                for f in funds:
                    conn.execute(
                        """
                        INSERT INTO funds (scheme_code, scheme_name, amc, category, plan, option, isin, latest_nav, latest_nav_date, data_quality)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(scheme_code) DO UPDATE SET
                            scheme_name=excluded.scheme_name,
                            amc=excluded.amc,
                            category=excluded.category,
                            plan=excluded.plan,
                            option=excluded.option,
                            isin=excluded.isin,
                            latest_nav=excluded.latest_nav,
                            latest_nav_date=excluded.latest_nav_date,
                            data_quality=excluded.data_quality
                        """,
                        (
                            str(f.get("scheme_code")),
                            f.get("scheme_name", ""),
                            f.get("amc", ""),
                            f.get("category", ""),
                            f.get("plan", "Regular"),
                            f.get("option", "Growth"),
                            f.get("isin"),
                            f.get("latest_nav"),
                            f.get("latest_nav_date"),
                            f.get("data_quality", "ok"),
                        ),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    def get_fund(self, scheme_code: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT * FROM funds WHERE scheme_code = ?", (str(scheme_code),)).fetchone()
            if not row:
                return None
            return dict(row)
        finally:
            conn.close()

    def list_funds(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM funds ORDER BY scheme_name LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def upsert_metrics(self, metrics: list[dict[str, Any]]) -> int:
        if not metrics:
            return 0
        conn = self._get_connection()
        count = 0
        try:
            with conn:
                for m in metrics:
                    conn.execute(
                        """
                        INSERT INTO metrics (
                            scheme_code, ret_1m, ret_3m, ret_6m, ret_1y,
                            cagr_3y, cagr_5y, cagr_7y, cagr_10y, vol_3y,
                            sharpe_3y, sortino_3y, max_drawdown_3y, max_drawdown_all, data_asof
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(scheme_code) DO UPDATE SET
                            ret_1m=excluded.ret_1m,
                            ret_3m=excluded.ret_3m,
                            ret_6m=excluded.ret_6m,
                            ret_1y=excluded.ret_1y,
                            cagr_3y=excluded.cagr_3y,
                            cagr_5y=excluded.cagr_5y,
                            cagr_7y=excluded.cagr_7y,
                            cagr_10y=excluded.cagr_10y,
                            vol_3y=excluded.vol_3y,
                            sharpe_3y=excluded.sharpe_3y,
                            sortino_3y=excluded.sortino_3y,
                            max_drawdown_3y=excluded.max_drawdown_3y,
                            max_drawdown_all=excluded.max_drawdown_all,
                            data_asof=excluded.data_asof
                        """,
                        (
                            str(m.get("scheme_code")),
                            m.get("ret_1m"),
                            m.get("ret_3m"),
                            m.get("ret_6m"),
                            m.get("ret_1y"),
                            m.get("cagr_3y"),
                            m.get("cagr_5y"),
                            m.get("cagr_7y"),
                            m.get("cagr_10y"),
                            m.get("vol_3y"),
                            m.get("sharpe_3y"),
                            m.get("sortino_3y"),
                            m.get("max_drawdown_3y"),
                            m.get("max_drawdown_all"),
                            m.get("data_asof", "2026-10-09"),
                        ),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    def get_metrics(self, scheme_code: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT * FROM metrics WHERE scheme_code = ?", (str(scheme_code),)).fetchone()
            if not row:
                return None
            return dict(row)
        finally:
            conn.close()

    def get_db_info(self) -> dict[str, Any]:
        return {
            "provider": "SQLite",
            "connected": True,
            "path": str(self.path),
            "size_bytes": self.path.stat().st_size if self.path.exists() else 0,
        }


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


# Module-level convenience functions ensuring full backwards compatibility
def purge_expired() -> int:
    from app.db import get_repository

    repo = get_repository()
    if hasattr(repo, "purge_expired"):
        return repo.purge_expired()
    return 0


def save_plan(request: dict, result: dict) -> dict:
    from app.db import get_repository

    repo = get_repository()
    if hasattr(repo, "purge_expired"):
        repo.purge_expired()
    plan_id = str(uuid.uuid4())
    created = datetime.now(UTC).isoformat()
    repo.save_plan(request, result, plan_id=plan_id)
    return {"id": plan_id, "created_at": created, "expires_at": expires_at(created)}


def get_plan(plan_id: str) -> dict | None:
    from app.db import get_repository

    return get_repository().get_plan(plan_id)


def list_plans(limit: int = 50, offset: int = 0, search: str | None = None) -> list[dict[str, Any]]:
    from app.db import get_repository

    return get_repository().list_plans(limit=limit, offset=offset, search=search)


def count_plans() -> int:
    from app.db import get_repository

    return get_repository().count_plans()


def delete_plan(plan_id: str) -> bool:
    from app.db import get_repository

    return get_repository().delete_plan(plan_id)


def list_cas_sessions(limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    from app.db import get_repository

    return get_repository().list_cas_sessions(limit=limit, offset=offset)


def count_cas_sessions() -> int:
    from app.db import get_repository

    return get_repository().count_cas_sessions()


def get_db_info() -> dict[str, Any]:
    from app.db import get_repository

    return get_repository().get_db_info()


def save_cas_session(
    payload: dict,
    investor_name: str | None = None,
    total_value: float = 0.0,
    xirr: float | None = None,
    session_id: str | None = None,
) -> str:
    from app.db import get_repository

    return get_repository().save_cas_session(
        payload=payload,
        investor_name=investor_name,
        total_value=total_value,
        xirr=xirr,
        session_id=session_id,
    )


def get_cas_session(session_id: str) -> dict | None:
    from app.db import get_repository

    return get_repository().get_cas_session(session_id)

