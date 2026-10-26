from __future__ import annotations
"""SQLite persistence repository for Fund Horizon.

Provides fast, zero-dependency local storage for development and unit testing.
Implements DatabaseRepository interface.
Plans expire after FH_PLAN_TTL_DAYS (default 30) and can be deleted by id.

# EXTENSION: add a user_id column once authentication exists.
"""

import json
import logging
import os
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.db.base import DatabaseRepository

logger = logging.getLogger(__name__)


def get_default_db_path() -> Path:
    return Path(os.environ.get("FH_DB_PATH", Path(__file__).resolve().parents[2] / "plans.db"))


def db_path() -> Path:
    return get_default_db_path()


def get_default_connection() -> sqlite3.Connection:
    from app.db.d1 import on_workers
    if on_workers():
        raise RuntimeError("SQLite filesystem access is not supported on Cloudflare Workers; use D1.")
    path = get_default_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


class SQLiteRepository(DatabaseRepository):
    """SQLite implementation of DatabaseRepository."""

    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path else get_default_db_path()
        self._init_schema()

    def _get_connection(self) -> sqlite3.Connection:
        from app.db.d1 import on_workers
        if on_workers():
            raise RuntimeError("SQLite filesystem access is not supported on Cloudflare Workers; use D1.")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        try:
            conn = self._get_connection()
        except sqlite3.OperationalError as e:
            logger.error("Failed to connect to SQLite in _init_schema (disk full or DB error): %s", e)
            return
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
                cols = [r["name"] for r in conn.execute("PRAGMA table_info(plans)").fetchall()]
                if "customer_id" not in cols:
                    conn.execute("ALTER TABLE plans ADD COLUMN customer_id TEXT")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS customers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL UNIQUE,
                        mobile TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'customer',
                        assigned_rm_id TEXT,
                        is_staff INTEGER NOT NULL DEFAULT 0,
                        status TEXT NOT NULL DEFAULT 'active',
                        must_change_password INTEGER NOT NULL DEFAULT 0,
                        revoked_before TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                cust_cols = [r["name"] for r in conn.execute("PRAGMA table_info(customers)").fetchall()]
                for col_name, col_def in [
                    ("is_staff", "INTEGER NOT NULL DEFAULT 0"),
                    ("status", "TEXT NOT NULL DEFAULT 'active'"),
                    ("must_change_password", "INTEGER NOT NULL DEFAULT 0"),
                    ("revoked_before", "TEXT"),
                    ("pages", "TEXT"),
                ]:
                    if col_name not in cust_cols:
                        conn.execute(f"ALTER TABLE customers ADD COLUMN {col_name} {col_def}")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sessions (
                        token_sha256 TEXT PRIMARY KEY,
                        customer_id TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL
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
                # CRM tables (each init fn is idempotent CREATE TABLE IF NOT EXISTS).
                # Imported here (not at module top): app.db_crm_products imports
                # from app.db.sqlite, so top-level imports would be circular.
                from app.backoffice.db import init_backoffice_schema
                from app.db_crm_core import init_crm_core_schema
                from app.db_crm_products import init_crm_products_schema

                init_crm_core_schema(conn)
                init_crm_products_schema(conn)
                init_backoffice_schema(conn)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        id TEXT PRIMARY KEY,
                        customer_id TEXT NOT NULL,
                        sender_id TEXT NOT NULL,
                        from_staff INTEGER NOT NULL DEFAULT 0,
                        body TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        read_at TEXT
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS ix_chat_customer ON chat_messages (customer_id, created_at)")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS holdings (
                        id TEXT PRIMARY KEY,
                        contact_id TEXT NOT NULL,
                        folio TEXT NOT NULL,
                        scheme_code TEXT NOT NULL,
                        scheme_name TEXT,
                        units REAL NOT NULL,
                        cost_paise INTEGER NOT NULL DEFAULT 0,
                        as_of TEXT NOT NULL,
                        source TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT,
                        created_by TEXT,
                        updated_by TEXT,
                        UNIQUE (contact_id, folio, scheme_code)
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sip_schedules (
                        id TEXT PRIMARY KEY,
                        contact_id TEXT NOT NULL,
                        scheme_code TEXT NOT NULL,
                        scheme_name TEXT,
                        type TEXT NOT NULL DEFAULT 'sip',
                        amount_paise INTEGER NOT NULL,
                        day INTEGER NOT NULL,
                        start_date TEXT NOT NULL,
                        end_date TEXT,
                        mandate_id TEXT,
                        status TEXT NOT NULL DEFAULT 'active',
                        bounce_count INTEGER NOT NULL DEFAULT 0,
                        last_bounce_at TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT,
                        created_by TEXT,
                        updated_by TEXT
                    )
                    """
                )
        except sqlite3.OperationalError as e:
            logger.error("Failed to initialize SQLite schema (disk full or DB error): %s", e)
        finally:
            conn.close()

    def _all(self, sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
        conn = self._get_connection()
        try:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        except sqlite3.OperationalError:
            return []
        finally:
            conn.close()

    def _first(self, sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            r = conn.execute(sql, params).fetchone()
            return dict(r) if r else None
        except sqlite3.OperationalError:
            return None
        finally:
            conn.close()

    def _run(self, sql: str, params: tuple | list = ()) -> Any:
        conn = self._get_connection()
        try:
            with conn:
                return conn.execute(sql, params)
        finally:
            conn.close()

    def purge_expired(self) -> int:
        cutoff = (datetime.now(UTC) - timedelta(days=ttl_days())).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                cur = conn.execute("DELETE FROM plans WHERE created_at < ?", (cutoff,))
                return cur.rowcount
        finally:
            conn.close()

    def save_plan(
        self,
        request: dict[str, Any],
        result: dict[str, Any],
        plan_id: str | None = None,
        created_at: str | None = None,
        customer_id: str | None = None,
    ) -> str:
        self.purge_expired()
        pid = plan_id or str(uuid.uuid4())
        now = created_at or datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO plans (id, created_at, request, result, customer_id) VALUES (?, ?, ?, ?, ?)",
                    (pid, now, json.dumps(request), json.dumps(result), customer_id),
                )
            return pid
        finally:
            conn.close()

    def update_plan(
        self,
        plan_id: str,
        request: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        """Replace the stored request/result for a plan, preserving created_at."""
        now = datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO plans (id, created_at, request, result)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        request=excluded.request,
                        result=excluded.result
                    """,
                    (plan_id, now, json.dumps(request), json.dumps(result)),
                )
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
            if _is_expired(row["created_at"]):
                with conn:
                    conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
                return None
            return {
                "id": row["id"],
                "created_at": row["created_at"],
                "expires_at": expires_at(row["created_at"]),
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
            return [_plan_summary(r) for r in rows]
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

    def list_customer_plans(self, customer_id: str, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT id, created_at, request, result FROM plans WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (customer_id, limit, offset),
            ).fetchall()
            return [_plan_summary(r) for r in rows]
        finally:
            conn.close()

    def count_customer_plans(self, customer_id: str) -> int:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT COUNT(*) AS c FROM plans WHERE customer_id = ?", (customer_id,)).fetchone()
            return int(row["c"]) if row else 0
        finally:
            conn.close()

    def create_customer(
        self,
        name: str,
        email: str,
        mobile: str,
        password_hash: str,
        role: str = "customer",
        assigned_rm_id: str | None = None,
    ) -> dict[str, Any]:
        cid = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                try:
                    conn.execute(
                        """
                        INSERT INTO customers (id, name, email, mobile, password_hash, role, assigned_rm_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (cid, name, email, mobile, password_hash, role, assigned_rm_id, now),
                    )
                except sqlite3.IntegrityError as e:
                    raise ValueError("An account with these details already exists") from e
            return {
                "id": cid,
                "name": name,
                "email": email,
                "mobile": mobile,
                "role": role,
                "assigned_rm_id": assigned_rm_id,
                "created_at": now,
            }
        finally:
            conn.close()

    def get_customer_by_id(self, customer_id: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_customer_by_email(self, email: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT * FROM customers WHERE email = ?", (email,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_customer_by_mobile(self, mobile: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute("SELECT * FROM customers WHERE mobile = ?", (mobile,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def list_customers(
        self,
        limit: int = 50,
        offset: int = 0,
        assigned_rm_id: str | None = None,
    ) -> list[dict[str, Any]]:
        conn = self._get_connection()
        try:
            where = "WHERE c.assigned_rm_id = ?" if assigned_rm_id is not None else ""
            params: list[Any] = [assigned_rm_id] if assigned_rm_id is not None else []
            rows = conn.execute(
                f"""
                SELECT c.id, c.name, c.email, c.mobile, c.role, c.assigned_rm_id, c.created_at,
                       COUNT(p.id) AS plan_count
                FROM customers c LEFT JOIN plans p ON p.customer_id = c.id
                {where}
                GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?
                """,
                (*params, limit, offset),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def count_customers(self, assigned_rm_id: str | None = None) -> int:
        conn = self._get_connection()
        try:
            if assigned_rm_id is not None:
                row = conn.execute(
                    "SELECT COUNT(*) AS c FROM customers WHERE assigned_rm_id = ?", (assigned_rm_id,)
                ).fetchone()
            else:
                row = conn.execute("SELECT COUNT(*) AS c FROM customers").fetchone()
            return int(row["c"]) if row else 0
        finally:
            conn.close()

    def update_customer(self, customer_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {
            "name", "role", "assigned_rm_id", "password_hash",
            "is_staff", "status", "must_change_password", "revoked_before", "pages"
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        conn = self._get_connection()
        try:
            with conn:
                if updates:
                    set_clause = ", ".join(f"{k} = ?" for k in updates)
                    conn.execute(
                        f"UPDATE customers SET {set_clause} WHERE id = ?",
                        (*updates.values(), customer_id),
                    )
            row = conn.execute(
                "SELECT * FROM customers WHERE id = ?",
                (customer_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def create_auth_session(self, customer_id: str, token_sha256: str, expires_at: str) -> None:
        now = datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO sessions (token_sha256, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    (token_sha256, customer_id, now, expires_at),
                )
        finally:
            conn.close()

    def get_auth_session(self, token_sha256: str) -> dict[str, Any] | None:
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT token_sha256, customer_id, created_at, expires_at FROM sessions WHERE token_sha256 = ?",
                (token_sha256,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def delete_auth_session(self, token_sha256: str) -> bool:
        conn = self._get_connection()
        try:
            with conn:
                cur = conn.execute("DELETE FROM sessions WHERE token_sha256 = ?", (token_sha256,))
                return cur.rowcount > 0
        finally:
            conn.close()

    def purge_expired_auth_sessions(self) -> int:
        now = datetime.now(UTC).isoformat()
        conn = self._get_connection()
        try:
            with conn:
                cur = conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
                return cur.rowcount
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


def _plan_summary(row: sqlite3.Row) -> dict[str, Any]:
    """Shared plan-list summary shape used by list_plans and list_customer_plans."""
    req = json.loads(row["request"])
    res = json.loads(row["result"])
    client = req.get("client", {})
    first_name = client.get("first_name", "Anonymous")
    last_name = client.get("last_name", "")
    name = f"{first_name} {last_name}".strip()
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "client_name": name or "Anonymous",
        "age": client.get("age"),
        "risk_band": res.get("profile", {}).get("band"),
        "risk_score": res.get("profile", {}).get("score"),
        "target_corpus": sum(g.get("future_cost", 0) for g in res.get("goals", [])),
        "total_sip": res.get("sip", {}).get("total_monthly_sip"),
        "goals_count": len(res.get("goals", [])),
        "request": req,
        "result": res,
    }


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


def save_plan(request: dict, result: dict, customer_id: str | None = None) -> dict:
    from app.db import get_repository

    repo = get_repository()
    if hasattr(repo, "purge_expired"):
        repo.purge_expired()
    plan_id = str(uuid.uuid4())
    created = datetime.now(UTC).isoformat()
    repo.save_plan(request, result, plan_id=plan_id, created_at=created, customer_id=customer_id)
    return {"id": plan_id, "created_at": created, "expires_at": expires_at(created)}


def update_plan(plan_id: str, request: dict, result: dict) -> None:
    from app.db import get_repository

    get_repository().update_plan(plan_id, request, result)


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


def list_customer_plans(customer_id: str, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    from app.db import get_repository

    return get_repository().list_customer_plans(customer_id, limit=limit, offset=offset)


def count_customer_plans(customer_id: str) -> int:
    from app.db import get_repository

    return get_repository().count_customer_plans(customer_id)


def create_customer(
    name: str,
    email: str,
    mobile: str,
    password_hash: str,
    role: str = "customer",
    assigned_rm_id: str | None = None,
) -> dict[str, Any]:
    from app.db import get_repository

    return get_repository().create_customer(
        name=name,
        email=email,
        mobile=mobile,
        password_hash=password_hash,
        role=role,
        assigned_rm_id=assigned_rm_id,
    )


def get_customer_by_id(customer_id: str) -> dict | None:
    from app.db import get_repository

    return get_repository().get_customer_by_id(customer_id)


def get_customer_by_email(email: str) -> dict | None:
    from app.db import get_repository

    return get_repository().get_customer_by_email(email)


def get_customer_by_mobile(mobile: str) -> dict | None:
    from app.db import get_repository

    return get_repository().get_customer_by_mobile(mobile)


def list_customers(
    limit: int = 50,
    offset: int = 0,
    assigned_rm_id: str | None = None,
) -> list[dict[str, Any]]:
    from app.db import get_repository

    return get_repository().list_customers(limit=limit, offset=offset, assigned_rm_id=assigned_rm_id)


def count_customers(assigned_rm_id: str | None = None) -> int:
    from app.db import get_repository

    return get_repository().count_customers(assigned_rm_id=assigned_rm_id)


def update_customer(customer_id: str, fields: dict[str, Any]) -> dict | None:
    from app.db import get_repository

    return get_repository().update_customer(customer_id, fields)


def create_auth_session(customer_id: str, token_sha256: str, expires_at: str) -> None:
    from app.db import get_repository

    get_repository().create_auth_session(customer_id, token_sha256, expires_at)


def get_auth_session(token_sha256: str) -> dict | None:
    from app.db import get_repository

    return get_repository().get_auth_session(token_sha256)


def delete_auth_session(token_sha256: str) -> bool:
    from app.db import get_repository

    return get_repository().delete_auth_session(token_sha256)


def purge_expired_auth_sessions() -> int:
    from app.db import get_repository

    return get_repository().purge_expired_auth_sessions()

