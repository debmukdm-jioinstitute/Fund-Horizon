from __future__ import annotations
"""Raw-SQLite DDL and data access for the CRM products & compliance tables (W2).

``init_crm_products_schema(conn)`` is idempotent (``CREATE TABLE IF NOT EXISTS``).
The coordinator wires it into ``SQLiteRepository._init_schema``; the Alembic
migration ``0004_crm_products`` carries the matching Postgres DDL and
``app/repo_crm_products.py`` additionally ensures the schema via SQLAlchemy
``create_all`` on first use, so tests work without manual migration steps.

Module-level functions open their own SQLite connection lazily (reading
``FH_DB_PATH`` at call time), mirroring the ``app.db.sqlite`` style. The FastAPI
layer (``app/api/crm_products.py``) calls ``ensure_crm_products_schema()`` per
request, which also creates the W1 core tables when they are missing, so the
client-import flow works standalone.
"""

import sqlite3
import uuid
from datetime import UTC, datetime
from typing import Any

from app.db import sqlite as _sqlite


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def init_crm_products_schema(conn: sqlite3.Connection) -> None:
    """Create the CRM products & compliance tables if they do not exist yet."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS insurance_policies (
            id TEXT PRIMARY KEY,
            household_id TEXT,
            customer_id TEXT,
            policy_type TEXT NOT NULL,
            insurer TEXT,
            policy_no TEXT,
            premium_amount INTEGER,
            premium_due_date TEXT,
            renewal_date TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_policies_household ON insurance_policies(household_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_policies_customer ON insurance_policies(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fixed_deposits (
            id TEXT PRIMARY KEY,
            household_id TEXT,
            customer_id TEXT,
            company TEXT,
            amount INTEGER,
            interest_rate REAL,
            start_date TEXT,
            maturity_date TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_fds_household ON fixed_deposits(household_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_fds_customer ON fixed_deposits(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pms_accounts (
            id TEXT PRIMARY KEY,
            household_id TEXT,
            customer_id TEXT,
            provider TEXT,
            agreement_date TEXT,
            amount INTEGER,
            fee_fixed_pct REAL,
            fee_performance_pct REAL,
            hurdle_pct REAL,
            high_water_mark INTEGER NOT NULL DEFAULT 0,
            exit_load_pct REAL,
            disclosure_doc_version TEXT,
            disclosure_given_at TEXT,
            fee_acknowledged_at TEXT,
            reporting_cycle TEXT NOT NULL DEFAULT 'quarterly',
            last_report_at TEXT,
            accredited_investor INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'prospect',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_pms_household ON pms_accounts(household_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_pms_customer ON pms_accounts(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kyc_records (
            customer_id TEXT PRIMARY KEY,
            pan_last4 TEXT,
            kra_status TEXT NOT NULL DEFAULT 'unknown',
            ckyc_id TEXT,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mandates (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            umrn TEXT,
            bank_name TEXT,
            amount_cap INTEGER,
            status TEXT NOT NULL DEFAULT 'registered',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_mandates_customer ON mandates(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS consents (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            purpose TEXT NOT NULL,
            granted INTEGER NOT NULL,
            notice_version TEXT,
            granted_at TEXT,
            withdrawn_at TEXT,
            UNIQUE(customer_id, purpose)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_consents_customer ON consents(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS suitability_records (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            financial_status TEXT,
            investment_experience TEXT,
            objectives TEXT,
            risk_band TEXT,
            recorded_by_rm_id TEXT,
            recorded_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_suitability_customer ON suitability_records(customer_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS disclosure_logs (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            opportunity_id TEXT,
            schemes_compared TEXT,
            commissions_disclosed TEXT,
            regular_plan_noted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_disclosures_customer ON disclosure_logs(customer_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_disclosures_opp ON disclosure_logs(opportunity_id)")


def _connect() -> sqlite3.Connection:
    from app.db.d1 import on_workers
    if on_workers():
        raise RuntimeError("SQLite filesystem access is not supported on Cloudflare Workers; use D1.")
    path = _sqlite.get_default_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_crm_products_schema() -> None:
    """Create W2 (and missing W1 core) tables on the configured SQLite DB."""
    conn = _connect()
    try:
        with conn:
            try:
                from app.db_crm_core import init_crm_core_schema

                init_crm_core_schema(conn)
            except ImportError:
                pass
            init_crm_products_schema(conn)
    finally:
        conn.close()


def _one(query: str, params: tuple = ()) -> dict[str, Any] | None:
    conn = _connect()
    try:
        row = conn.execute(query, params).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _all(query: str, params: tuple = ()) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        return [dict(r) for r in conn.execute(query, params).fetchall()]
    finally:
        conn.close()


def _insert(table: str, data: dict[str, Any]) -> dict[str, Any]:
    cols = list(data.keys())
    placeholders = ", ".join("?" for _ in cols)
    conn = _connect()
    try:
        with conn:
            conn.execute(
                f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
                tuple(data[c] for c in cols),
            )
        return _one(f"SELECT * FROM {table} WHERE id = ?", (data["id"],)) or dict(data)
    finally:
        conn.close()


def _patch(table: str, row_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    if not fields:
        return _one(f"SELECT * FROM {table} WHERE id = ?", (row_id,))
    sets = ", ".join(f"{c} = ?" for c in fields)
    conn = _connect()
    try:
        with conn:
            cur = conn.execute(
                f"UPDATE {table} SET {sets} WHERE id = ?", (*fields.values(), row_id)
            )
            if cur.rowcount == 0:
                return None
        return _one(f"SELECT * FROM {table} WHERE id = ?", (row_id,))
    finally:
        conn.close()


# ---------------------------------------------------------------- policies ---
def list_policies(household_id: str | None = None, customer_id: str | None = None) -> list[dict[str, Any]]:
    q = "SELECT * FROM insurance_policies WHERE 1=1"
    p: list[Any] = []
    if household_id:
        q += " AND household_id = ?"
        p.append(household_id)
    if customer_id:
        q += " AND customer_id = ?"
        p.append(customer_id)
    return _all(q + " ORDER BY created_at DESC", tuple(p))


def create_policy(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"id": _new_id(), "created_at": _now(), "updated_at": _now(), **data}
    return _insert("insurance_policies", rec)


def get_policy(policy_id: str) -> dict[str, Any] | None:
    return _one("SELECT * FROM insurance_policies WHERE id = ?", (policy_id,))


def patch_policy(policy_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    fields = {**fields, "updated_at": _now()}
    return _patch("insurance_policies", policy_id, fields)


# ------------------------------------------------------------------- FDs ----
def list_fds(household_id: str | None = None, customer_id: str | None = None) -> list[dict[str, Any]]:
    q = "SELECT * FROM fixed_deposits WHERE 1=1"
    p: list[Any] = []
    if household_id:
        q += " AND household_id = ?"
        p.append(household_id)
    if customer_id:
        q += " AND customer_id = ?"
        p.append(customer_id)
    return _all(q + " ORDER BY created_at DESC", tuple(p))


def create_fd(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"id": _new_id(), "created_at": _now(), "updated_at": _now(), **data}
    return _insert("fixed_deposits", rec)


def get_fd(fd_id: str) -> dict[str, Any] | None:
    return _one("SELECT * FROM fixed_deposits WHERE id = ?", (fd_id,))


def patch_fd(fd_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    fields = {**fields, "updated_at": _now()}
    return _patch("fixed_deposits", fd_id, fields)


# ------------------------------------------------------------------- PMS ----
def list_pms(household_id: str | None = None, customer_id: str | None = None) -> list[dict[str, Any]]:
    q = "SELECT * FROM pms_accounts WHERE 1=1"
    p: list[Any] = []
    if household_id:
        q += " AND household_id = ?"
        p.append(household_id)
    if customer_id:
        q += " AND customer_id = ?"
        p.append(customer_id)
    return _all(q + " ORDER BY created_at DESC", tuple(p))


def create_pms(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"id": _new_id(), "created_at": _now(), "updated_at": _now(), **data}
    return _insert("pms_accounts", rec)


def get_pms(pms_id: str) -> dict[str, Any] | None:
    return _one("SELECT * FROM pms_accounts WHERE id = ?", (pms_id,))


def patch_pms(pms_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    fields = {**fields, "updated_at": _now()}
    return _patch("pms_accounts", pms_id, fields)


# ------------------------------------------------------------------- KYC ----
def get_kyc(customer_id: str) -> dict[str, Any] | None:
    return _one("SELECT * FROM kyc_records WHERE customer_id = ?", (customer_id,))


def upsert_kyc(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"updated_at": _now(), **data}
    conn = _connect()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO kyc_records (customer_id, pan_last4, kra_status, ckyc_id, updated_at)
                VALUES (:customer_id, :pan_last4, :kra_status, :ckyc_id, :updated_at)
                ON CONFLICT(customer_id) DO UPDATE SET
                    pan_last4 = excluded.pan_last4,
                    kra_status = excluded.kra_status,
                    ckyc_id = excluded.ckyc_id,
                    updated_at = excluded.updated_at
                """,
                rec,
            )
        return _one("SELECT * FROM kyc_records WHERE customer_id = ?", (data["customer_id"],)) or rec
    finally:
        conn.close()


# --------------------------------------------------------------- mandates ---
def list_mandates(customer_id: str | None = None) -> list[dict[str, Any]]:
    if customer_id:
        return _all("SELECT * FROM mandates WHERE customer_id = ? ORDER BY created_at DESC", (customer_id,))
    return _all("SELECT * FROM mandates ORDER BY created_at DESC")


def create_mandate(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"id": _new_id(), "created_at": _now(), **data}
    return _insert("mandates", rec)


def get_mandate(mandate_id: str) -> dict[str, Any] | None:
    return _one("SELECT * FROM mandates WHERE id = ?", (mandate_id,))


def patch_mandate(mandate_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    return _patch("mandates", mandate_id, fields)


# --------------------------------------------------------------- consents ---
def list_consents(customer_id: str | None = None) -> list[dict[str, Any]]:
    if customer_id:
        return _all("SELECT * FROM consents WHERE customer_id = ? ORDER BY purpose", (customer_id,))
    return _all("SELECT * FROM consents ORDER BY customer_id, purpose")


def upsert_consent(data: dict[str, Any]) -> dict[str, Any]:
    """Upsert on (customer_id, purpose). ``granted`` is stored as 0/1; on grant
    sets ``granted_at`` and clears ``withdrawn_at``; on revoke does the reverse."""
    now = _now()
    granted = 1 if data["granted"] else 0
    rec = {
        "customer_id": data["customer_id"],
        "purpose": data["purpose"],
        "granted": granted,
        "notice_version": data.get("notice_version"),
        "granted_at": now if granted else None,
        "withdrawn_at": None if granted else now,
    }
    conn = _connect()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO consents (id, customer_id, purpose, granted, notice_version, granted_at, withdrawn_at)
                VALUES (:id, :customer_id, :purpose, :granted, :notice_version, :granted_at, :withdrawn_at)
                ON CONFLICT(customer_id, purpose) DO UPDATE SET
                    granted = excluded.granted,
                    notice_version = excluded.notice_version,
                    granted_at = excluded.granted_at,
                    withdrawn_at = excluded.withdrawn_at
                """,
                {"id": _new_id(), **rec},
            )
        return _one(
            "SELECT * FROM consents WHERE customer_id = ? AND purpose = ?",
            (data["customer_id"], data["purpose"]),
        ) or rec
    finally:
        conn.close()


# ------------------------------------------------------------ suitability ---
def list_suitability(customer_id: str) -> list[dict[str, Any]]:
    return _all(
        "SELECT * FROM suitability_records WHERE customer_id = ? ORDER BY recorded_at DESC",
        (customer_id,),
    )


def create_suitability(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"id": _new_id(), "recorded_at": _now(), **data}
    return _insert("suitability_records", rec)


# ------------------------------------------------------------ disclosures ---
def list_disclosures(
    customer_id: str | None = None, opportunity_id: str | None = None
) -> list[dict[str, Any]]:
    q = "SELECT * FROM disclosure_logs WHERE 1=1"
    p: list[Any] = []
    if customer_id:
        q += " AND customer_id = ?"
        p.append(customer_id)
    if opportunity_id:
        q += " AND opportunity_id = ?"
        p.append(opportunity_id)
    return _all(q + " ORDER BY created_at DESC", tuple(p))


def create_disclosure(data: dict[str, Any]) -> dict[str, Any]:
    rec = {"id": _new_id(), "created_at": _now(), **data}
    return _insert("disclosure_logs", rec)


# --------------------------------------- customers / households (import) ----
def get_customer(customer_id: str) -> dict[str, Any] | None:
    return _sqlite.get_customer_by_id(customer_id)


def get_customer_by_email(email: str) -> dict[str, Any] | None:
    return _sqlite.get_customer_by_email(email)


def create_import_customer(
    name: str, email: str, mobile: str, password_hash: str, assigned_rm_id: str | None
) -> dict[str, Any]:
    return _sqlite.create_customer(
        name=name,
        email=email,
        mobile=mobile,
        password_hash=password_hash,
        role="customer",
        assigned_rm_id=assigned_rm_id,
    )


def get_household(household_id: str) -> dict[str, Any] | None:
    return _one("SELECT * FROM households WHERE id = ?", (household_id,))


def create_household(name: str, rm_id: str | None) -> dict[str, Any]:
    rec = {"id": _new_id(), "name": name, "primary_customer_id": None, "rm_id": rm_id, "notes": None, "created_at": _now()}
    return _insert("households", rec)


def add_household_member(household_id: str, customer_id: str, role: str = "primary") -> None:
    conn = _connect()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO household_members (id, household_id, customer_id, role)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(household_id, customer_id) DO UPDATE SET role = excluded.role
                """,
                (_new_id(), household_id, customer_id, role),
            )
    finally:
        conn.close()


def set_household_primary(household_id: str, customer_id: str) -> None:
    conn = _connect()
    try:
        with conn:
            conn.execute(
                "UPDATE households SET primary_customer_id = ? WHERE id = ?", (customer_id, household_id)
            )
    finally:
        conn.close()


# ------------------------------------------------------------------ scope ---
def rm_household_ids(rm_id: str) -> set[str]:
    rows = _all("SELECT id FROM households WHERE rm_id = ?", (rm_id,))
    return {r["id"] for r in rows}


def rm_customer_ids(rm_id: str) -> set[str]:
    """Customers an RM may act on: directly assigned, or members of their households."""
    out: set[str] = set()
    try:
        assigned = _all("SELECT id FROM customers WHERE assigned_rm_id = ?", (rm_id,))
        out.update(r["id"] for r in assigned)
        hh = rm_household_ids(rm_id)
        if hh:
            marks = ", ".join("?" for _ in hh)
            members = _all(
                f"SELECT customer_id FROM household_members WHERE household_id IN ({marks})",
                tuple(hh),
            )
            out.update(r["customer_id"] for r in members)
    except Exception:
        pass
    return out


def get_household_for_scope(household_id: str) -> dict[str, Any] | None:
    return get_household(household_id)
