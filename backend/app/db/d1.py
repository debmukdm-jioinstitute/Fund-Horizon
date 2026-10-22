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
from datetime import UTC, datetime, timedelta
from typing import Any

try:
    from pyodide.ffi import run_sync
except ImportError:
    run_sync = None

from app.db.sqlite import SQLiteRepository, _is_expired, _plan_summary, expires_at, ttl_days

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
    """Execute SQL with ? params on env.DB binding asynchronously."""
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

    def _db(self) -> Any:
        db = self.d1 or get_d1_database()
        if db is None:
            raise RuntimeError("D1 database binding not registered")
        return db

    def _first(self, sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
        db = self._db()
        stmt = db.prepare(sql)
        if params:
            stmt = stmt.bind(*params)
        if run_sync is None:
            raise RuntimeError("pyodide.ffi.run_sync unavailable on this platform")
        try:
            res = run_sync(stmt.first())
        except Exception as e:
            logger.warning("D1 first query failed: %s", e)
            return None
        if res is None:
            return None
        if hasattr(res, "to_py"):
            return dict(res.to_py())
        return dict(res)

    def _all(self, sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
        db = self._db()
        stmt = db.prepare(sql)
        if params:
            stmt = stmt.bind(*params)
        if run_sync is None:
            raise RuntimeError("pyodide.ffi.run_sync unavailable on this platform")
        try:
            res = run_sync(stmt.all())
        except Exception as e:
            logger.warning("D1 all query failed: %s", e)
            return []
        results = getattr(res, "results", res)
        if hasattr(results, "to_py"):
            raw = results.to_py()
        else:
            raw = results or []
        return [dict(r) for r in raw]

    def _run(self, sql: str, params: tuple | list = ()) -> Any:
        db = self._db()
        stmt = db.prepare(sql)
        if params:
            stmt = stmt.bind(*params)
        if run_sync is None:
            raise RuntimeError("pyodide.ffi.run_sync unavailable on this platform")
        try:
            res = run_sync(stmt.run())
        except Exception as e:
            logger.warning("D1 run query failed: %s", e)
            return None
        meta = getattr(res, "meta", None)
        if hasattr(meta, "to_py"):
            return meta.to_py()
        return meta

    def get_db_info(self) -> dict[str, Any]:
        return {
            "backend": "d1",
            "d1_connected": self.d1 is not None or get_d1_database() is not None,
        }

    # -----------------------------------------------------------------------
    # Plans
    # -----------------------------------------------------------------------
    def purge_expired(self) -> int:
        cutoff = (datetime.now(UTC) - timedelta(days=ttl_days())).isoformat()
        meta = self._run("DELETE FROM plans WHERE created_at < ?", (cutoff,))
        changes = meta.get("changes", 0) if isinstance(meta, dict) else getattr(meta, "changes", 0)
        return int(changes or 0)

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
        self._run(
            "INSERT INTO plans (id, created_at, request, result, customer_id) VALUES (?, ?, ?, ?, ?)",
            (pid, now, json.dumps(request), json.dumps(result), customer_id),
        )
        return pid

    def update_plan(
        self,
        plan_id: str,
        request: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        now = datetime.now(UTC).isoformat()
        self._run(
            """
            INSERT INTO plans (id, created_at, request, result)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                request=excluded.request,
                result=excluded.result
            """,
            (plan_id, now, json.dumps(request), json.dumps(result)),
        )

    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        row = self._first("SELECT id, created_at, request, result FROM plans WHERE id = ?", (plan_id,))
        if not row:
            return None
        if _is_expired(row["created_at"]):
            self._run("DELETE FROM plans WHERE id = ?", (plan_id,))
            return None
        req = json.loads(row["request"]) if isinstance(row["request"], str) else row["request"]
        res = json.loads(row["result"]) if isinstance(row["result"], str) else row["result"]
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "expires_at": expires_at(row["created_at"]),
            "request": req,
            "result": res,
        }

    def list_plans(self, limit: int = 50, offset: int = 0, search: str | None = None) -> list[dict[str, Any]]:
        if search:
            pattern = f"%{search}%"
            rows = self._all(
                "SELECT id, created_at, request, result FROM plans WHERE id LIKE ? OR request LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (pattern, pattern, limit, offset),
            )
        else:
            rows = self._all(
                "SELECT id, created_at, request, result FROM plans ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        return [_plan_summary(r) for r in rows]

    def count_plans(self) -> int:
        row = self._first("SELECT COUNT(*) AS c FROM plans")
        return int(row["c"]) if row and "c" in row else 0

    def delete_plan(self, plan_id: str) -> bool:
        meta = self._run("DELETE FROM plans WHERE id = ?", (plan_id,))
        changes = meta.get("changes", 0) if isinstance(meta, dict) else getattr(meta, "changes", 0)
        return bool(changes and changes > 0)

    def list_customer_plans(self, customer_id: str, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        rows = self._all(
            "SELECT id, created_at, request, result FROM plans WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (customer_id, limit, offset),
        )
        return [_plan_summary(r) for r in rows]

    def count_customer_plans(self, customer_id: str) -> int:
        row = self._first("SELECT COUNT(*) AS c FROM plans WHERE customer_id = ?", (customer_id,))
        return int(row["c"]) if row and "c" in row else 0

    # -----------------------------------------------------------------------
    # Customers
    # -----------------------------------------------------------------------
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
        try:
            self._run(
                """
                INSERT INTO customers (id, name, email, mobile, password_hash, role, assigned_rm_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (cid, name, email.strip().lower(), mobile.strip(), password_hash, role, assigned_rm_id, now),
            )
        except Exception as e:
            raise ValueError("An account with these details already exists") from e
        return {
            "id": cid,
            "name": name,
            "email": email.strip().lower(),
            "mobile": mobile.strip(),
            "role": role,
            "assigned_rm_id": assigned_rm_id,
            "created_at": now,
        }

    def get_customer_by_id(self, customer_id: str) -> dict[str, Any] | None:
        return self._first("SELECT * FROM customers WHERE id = ?", (customer_id,))

    def get_customer_by_email(self, email: str) -> dict[str, Any] | None:
        return self._first("SELECT * FROM customers WHERE email = ?", (email.strip().lower(),))

    def get_customer_by_mobile(self, mobile: str) -> dict[str, Any] | None:
        return self._first("SELECT * FROM customers WHERE mobile = ?", (mobile.strip(),))

    def list_customers(
        self,
        limit: int = 50,
        offset: int = 0,
        assigned_rm_id: str | None = None,
    ) -> list[dict[str, Any]]:
        where = "WHERE c.assigned_rm_id = ?" if assigned_rm_id is not None else ""
        params: list[Any] = [assigned_rm_id] if assigned_rm_id is not None else []
        sql = f"""
        SELECT c.id, c.name, c.email, c.mobile, c.role, c.assigned_rm_id, c.created_at,
               COUNT(p.id) AS plan_count
        FROM customers c LEFT JOIN plans p ON p.customer_id = c.id
        {where}
        GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?
        """
        return self._all(sql, (*params, limit, offset))

    def count_customers(self, assigned_rm_id: str | None = None) -> int:
        if assigned_rm_id is not None:
            row = self._first("SELECT COUNT(*) AS c FROM customers WHERE assigned_rm_id = ?", (assigned_rm_id,))
        else:
            row = self._first("SELECT COUNT(*) AS c FROM customers")
        return int(row["c"]) if row and "c" in row else 0

    def update_customer(self, customer_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {
            "name", "role", "assigned_rm_id", "password_hash",
            "is_staff", "status", "must_change_password", "revoked_before"
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            self._run(f"UPDATE customers SET {set_clause} WHERE id = ?", (*updates.values(), customer_id))
        return self.get_customer_by_id(customer_id)

    # -----------------------------------------------------------------------
    # Sessions
    # -----------------------------------------------------------------------
    def create_auth_session(self, customer_id: str, token_sha256: str, expires_at: str) -> None:
        now = datetime.now(UTC).isoformat()
        self._run(
            "INSERT INTO sessions (token_sha256, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_sha256, customer_id, now, expires_at),
        )

    def get_auth_session(self, token_sha256: str) -> dict[str, Any] | None:
        return self._first(
            "SELECT token_sha256, customer_id, created_at, expires_at FROM sessions WHERE token_sha256 = ?",
            (token_sha256,),
        )

    def delete_auth_session(self, token_sha256: str) -> bool:
        meta = self._run("DELETE FROM sessions WHERE token_sha256 = ?", (token_sha256,))
        changes = meta.get("changes", 0) if isinstance(meta, dict) else getattr(meta, "changes", 0)
        return bool(changes and changes > 0)

    def purge_expired_auth_sessions(self) -> int:
        now = datetime.now(UTC).isoformat()
        meta = self._run("DELETE FROM sessions WHERE expires_at < ?", (now,))
        changes = meta.get("changes", 0) if isinstance(meta, dict) else getattr(meta, "changes", 0)
        return int(changes or 0)

    # -----------------------------------------------------------------------
    # CAS Sessions
    # -----------------------------------------------------------------------
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
        self._run(
            """
            INSERT INTO cas_sessions (session_id, created_at, investor_name, total_value, xirr, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (sid, now, investor_name, total_value, xirr, json.dumps(payload)),
        )
        return sid

    def get_cas_session(self, session_id: str) -> dict[str, Any] | None:
        row = self._first(
            "SELECT session_id, created_at, investor_name, total_value, xirr, payload FROM cas_sessions WHERE session_id = ?",
            (session_id,),
        )
        if not row:
            return None
        payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
        return {
            "session_id": row["session_id"],
            "created_at": row["created_at"],
            "investor_name": row["investor_name"],
            "total_value": row["total_value"],
            "xirr": row["xirr"],
            "payload": payload,
        }

    def list_cas_sessions(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        rows = self._all(
            "SELECT session_id, created_at, investor_name, total_value, xirr, payload FROM cas_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        sessions = []
        for r in rows:
            payload = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
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

    def count_cas_sessions(self) -> int:
        row = self._first("SELECT COUNT(*) AS c FROM cas_sessions")
        return int(row["c"]) if row and "c" in row else 0

    # -----------------------------------------------------------------------
    # Funds & Metrics
    # -----------------------------------------------------------------------
    def upsert_funds(self, funds: list[dict[str, Any]]) -> int:
        if not funds:
            return 0
        sql = """
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
        """
        count = 0
        for f in funds:
            self._run(
                sql,
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

    def get_fund(self, scheme_code: str) -> dict[str, Any] | None:
        return self._first("SELECT * FROM funds WHERE scheme_code = ?", (str(scheme_code),))

    def list_funds(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        return self._all("SELECT * FROM funds ORDER BY scheme_name LIMIT ? OFFSET ?", (limit, offset))

    def upsert_metrics(self, metrics: list[dict[str, Any]]) -> int:
        if not metrics:
            return 0
        sql = """
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
        """
        count = 0
        for m in metrics:
            self._run(
                sql,
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

    def get_metrics(self, scheme_code: str) -> dict[str, Any] | None:
        return self._first("SELECT * FROM metrics WHERE scheme_code = ?", (str(scheme_code),))
