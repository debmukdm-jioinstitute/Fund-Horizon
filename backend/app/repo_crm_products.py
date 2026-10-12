"""PostgreSQL data access for the CRM products & compliance tables (W2).

Mirrors the function names of ``app/db_crm_products.py`` (the SQLite store) so
``app/api/crm_products.py`` can pick a backend per request. SQLAlchemy 2.0
models come from ``app/models/crm_products.py``; customer/household lookups use
raw SQL (``text()``) to avoid re-registering W1's models on the shared
declarative ``Base``.

``ensure_schema()`` creates the eight W2 tables with ``checkfirst`` plus the
W1 household tables via DDL when missing, so the client-import flow works
without running Alembic in tests.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.postgres import normalize_postgres_url
from app.models.crm_products import (
    ConsentModel,
    DisclosureLogModel,
    FixedDepositModel,
    InsurancePolicyModel,
    KycRecordModel,
    MandateModel,
    PmsAccountModel,
    SuitabilityRecordModel,
)

_PRODUCT_MODELS = (
    InsurancePolicyModel,
    FixedDepositModel,
    PmsAccountModel,
    KycRecordModel,
    MandateModel,
    ConsentModel,
    SuitabilityRecordModel,
    DisclosureLogModel,
)

_HOUSEHOLD_DDL = """
CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    primary_customer_id TEXT,
    rm_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS household_members (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'other',
    UNIQUE(household_id, customer_id)
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _row_to_dict(obj: Any) -> dict[str, Any]:
    return {c.key: getattr(obj, c.key) for c in obj.__table__.columns}


class CrmProductsPostgres:
    """Postgres-backed store with the same surface as ``app/db_crm_products``."""

    def __init__(self, db_url: str | None = None) -> None:
        url = normalize_postgres_url((db_url or os.environ.get("DATABASE_URL", "")).strip())
        self.engine: Engine = create_engine(url, pool_pre_ping=True)
        self._sessions = sessionmaker(bind=self.engine, class_=Session, expire_on_commit=False)

    # ------------------------------------------------------------ schema ----
    def ensure_schema(self) -> None:
        for model in _PRODUCT_MODELS:
            model.__table__.create(bind=self.engine, checkfirst=True)
        with self.engine.begin() as conn:
            for stmt in _HOUSEHOLD_DDL.split(";"):
                if stmt.strip():
                    conn.execute(text(stmt))

    # ------------------------------------------------------------ helpers ---
    def _one(self, model: Any, pk: str) -> dict[str, Any] | None:
        with self._sessions() as s:
            obj = s.get(model, pk)
            return _row_to_dict(obj) if obj else None

    # ------------------------------------------------------------ policies --
    def list_policies(self, household_id=None, customer_id=None) -> list[dict[str, Any]]:
        with self._sessions() as s:
            q = s.query(InsurancePolicyModel)
            if household_id:
                q = q.filter_by(household_id=household_id)
            if customer_id:
                q = q.filter_by(customer_id=customer_id)
            return [_row_to_dict(o) for o in q.order_by(InsurancePolicyModel.created_at.desc())]

    def create_policy(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._create(InsurancePolicyModel, data)

    def get_policy(self, policy_id: str) -> dict[str, Any] | None:
        return self._one(InsurancePolicyModel, policy_id)

    def patch_policy(self, policy_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        return self._patch(InsurancePolicyModel, policy_id, {**fields, "updated_at": _now()})

    # ---------------------------------------------------------------- fds ---
    def list_fds(self, household_id=None, customer_id=None) -> list[dict[str, Any]]:
        with self._sessions() as s:
            q = s.query(FixedDepositModel)
            if household_id:
                q = q.filter_by(household_id=household_id)
            if customer_id:
                q = q.filter_by(customer_id=customer_id)
            return [_row_to_dict(o) for o in q.order_by(FixedDepositModel.created_at.desc())]

    def create_fd(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._create(FixedDepositModel, data)

    def get_fd(self, fd_id: str) -> dict[str, Any] | None:
        return self._one(FixedDepositModel, fd_id)

    def patch_fd(self, fd_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        return self._patch(FixedDepositModel, fd_id, {**fields, "updated_at": _now()})

    # ---------------------------------------------------------------- pms ---
    def list_pms(self, household_id=None, customer_id=None) -> list[dict[str, Any]]:
        with self._sessions() as s:
            q = s.query(PmsAccountModel)
            if household_id:
                q = q.filter_by(household_id=household_id)
            if customer_id:
                q = q.filter_by(customer_id=customer_id)
            return [_row_to_dict(o) for o in q.order_by(PmsAccountModel.created_at.desc())]

    def create_pms(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._create(PmsAccountModel, data)

    def get_pms(self, pms_id: str) -> dict[str, Any] | None:
        return self._one(PmsAccountModel, pms_id)

    def patch_pms(self, pms_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        return self._patch(PmsAccountModel, pms_id, {**fields, "updated_at": _now()})

    # ---------------------------------------------------------------- kyc ---
    def get_kyc(self, customer_id: str) -> dict[str, Any] | None:
        with self._sessions() as s:
            obj = s.get(KycRecordModel, customer_id)
            return _row_to_dict(obj) if obj else None

    def upsert_kyc(self, data: dict[str, Any]) -> dict[str, Any]:
        with self._sessions() as s:
            obj = s.get(KycRecordModel, data["customer_id"])
            payload = {"updated_at": _now(), **data}
            if obj is None:
                obj = KycRecordModel(**payload)
                s.add(obj)
            else:
                for k, v in payload.items():
                    setattr(obj, k, v)
            s.commit()
            return _row_to_dict(obj)

    # ----------------------------------------------------------- mandates ---
    def list_mandates(self, customer_id=None) -> list[dict[str, Any]]:
        with self._sessions() as s:
            q = s.query(MandateModel)
            if customer_id:
                q = q.filter_by(customer_id=customer_id)
            return [_row_to_dict(o) for o in q.order_by(MandateModel.created_at.desc())]

    def create_mandate(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._create(MandateModel, data)

    def get_mandate(self, mandate_id: str) -> dict[str, Any] | None:
        return self._one(MandateModel, mandate_id)

    def patch_mandate(self, mandate_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        return self._patch(MandateModel, mandate_id, fields)

    # ----------------------------------------------------------- consents ---
    def list_consents(self, customer_id=None) -> list[dict[str, Any]]:
        with self._sessions() as s:
            q = s.query(ConsentModel)
            if customer_id:
                q = q.filter_by(customer_id=customer_id)
            return [_row_to_dict(o) for o in q.order_by(ConsentModel.customer_id, ConsentModel.purpose)]

    def upsert_consent(self, data: dict[str, Any]) -> dict[str, Any]:
        now = _now()
        granted = 1 if data["granted"] else 0
        with self._sessions() as s:
            obj = (
                s.query(ConsentModel)
                .filter_by(customer_id=data["customer_id"], purpose=data["purpose"])
                .one_or_none()
            )
            if obj is None:
                obj = ConsentModel(
                    id=uuid.uuid4().hex,
                    customer_id=data["customer_id"],
                    purpose=data["purpose"],
                    granted=granted,
                    notice_version=data.get("notice_version"),
                    granted_at=now if granted else None,
                    withdrawn_at=None if granted else now,
                )
                s.add(obj)
            else:
                obj.granted = granted
                obj.notice_version = data.get("notice_version")
                obj.granted_at = now if granted else None
                obj.withdrawn_at = None if granted else now
            s.commit()
            return _row_to_dict(obj)

    # -------------------------------------------------------- suitability ---
    def list_suitability(self, customer_id: str) -> list[dict[str, Any]]:
        with self._sessions() as s:
            rows = (
                s.query(SuitabilityRecordModel)
                .filter_by(customer_id=customer_id)
                .order_by(SuitabilityRecordModel.recorded_at.desc())
                .all()
            )
            return [_row_to_dict(o) for o in rows]

    def create_suitability(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._create(SuitabilityRecordModel, data, recorded_at=_now())

    # -------------------------------------------------------- disclosures ---
    def list_disclosures(self, customer_id=None, opportunity_id=None) -> list[dict[str, Any]]:
        with self._sessions() as s:
            q = s.query(DisclosureLogModel)
            if customer_id:
                q = q.filter_by(customer_id=customer_id)
            if opportunity_id:
                q = q.filter_by(opportunity_id=opportunity_id)
            return [_row_to_dict(o) for o in q.order_by(DisclosureLogModel.created_at.desc())]

    def create_disclosure(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._create(DisclosureLogModel, data)

    # --------------------------------------- customers / households --------
    def get_customer(self, customer_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            row = c.execute(
                text("SELECT * FROM customers WHERE id = :id"), {"id": customer_id}
            ).mappings().first()
            return dict(row) if row else None

    def get_customer_by_email(self, email: str) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            row = c.execute(
                text("SELECT * FROM customers WHERE email = :email"), {"email": email}
            ).mappings().first()
            return dict(row) if row else None

    def create_import_customer(self, name, email, mobile, password_hash, assigned_rm_id) -> dict[str, Any]:
        cid = uuid.uuid4().hex
        now = _now()
        with self.engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO customers (id, name, email, mobile, password_hash, role, assigned_rm_id, created_at)"
                    " VALUES (:id, :name, :email, :mobile, :ph, 'customer', :rm, :now)"
                ),
                {"id": cid, "name": name, "email": email, "mobile": mobile, "ph": password_hash, "rm": assigned_rm_id, "now": now},
            )
        return self.get_customer(cid) or {"id": cid}

    def get_household(self, household_id: str) -> dict[str, Any] | None:
        return self.get_household_for_scope(household_id)

    def get_household_for_scope(self, household_id: str) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            row = c.execute(
                text("SELECT * FROM households WHERE id = :id"), {"id": household_id}
            ).mappings().first()
            return dict(row) if row else None

    def create_household(self, name: str, rm_id: str | None) -> dict[str, Any]:
        hid = uuid.uuid4().hex
        with self.engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO households (id, name, primary_customer_id, rm_id, notes, created_at)"
                    " VALUES (:id, :name, NULL, :rm, NULL, :now)"
                ),
                {"id": hid, "name": name, "rm": rm_id, "now": _now()},
            )
        return self.get_household(hid) or {"id": hid}

    def add_household_member(self, household_id: str, customer_id: str, role: str = "primary") -> None:
        with self.engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO household_members (id, household_id, customer_id, role)"
                    " VALUES (:id, :hh, :cust, :role)"
                    " ON CONFLICT(household_id, customer_id) DO UPDATE SET role = EXCLUDED.role"
                ),
                {"id": uuid.uuid4().hex, "hh": household_id, "cust": customer_id, "role": role},
            )

    def set_household_primary(self, household_id: str, customer_id: str) -> None:
        with self.engine.begin() as c:
            c.execute(
                text("UPDATE households SET primary_customer_id = :cust WHERE id = :id"),
                {"cust": customer_id, "id": household_id},
            )

    # --------------------------------------------------------------- scope --
    def rm_household_ids(self, rm_id: str) -> set[str]:
        with self.engine.connect() as c:
            rows = c.execute(text("SELECT id FROM households WHERE rm_id = :rm"), {"rm": rm_id}).all()
            return {r[0] for r in rows}

    def rm_customer_ids(self, rm_id: str) -> set[str]:
        out: set[str] = set()
        with self.engine.connect() as c:
            rows = c.execute(text("SELECT id FROM customers WHERE assigned_rm_id = :rm"), {"rm": rm_id}).all()
            out.update(r[0] for r in rows)
            hh = self.rm_household_ids(rm_id)
            if hh:
                rows = c.execute(
                    text("SELECT customer_id FROM household_members WHERE household_id = ANY(:hh)"),
                    {"hh": list(hh)},
                ).all()
                out.update(r[0] for r in rows)
        return out

    # ------------------------------------------------------------ internal --
    def _create(self, model: Any, data: dict[str, Any], **extra: Any) -> dict[str, Any]:
        columns = {c.key for c in model.__table__.columns}
        with self._sessions() as s:
            obj = model(id=uuid.uuid4().hex, **{**data, **extra})
            if "created_at" in columns and getattr(obj, "created_at", None) is None:
                obj.created_at = _now()
            if "updated_at" in columns and getattr(obj, "updated_at", None) is None:
                obj.updated_at = _now()
            s.add(obj)
            s.commit()
            return _row_to_dict(obj)

    def _patch(self, model: Any, pk: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        with self._sessions() as s:
            obj = s.get(model, pk)
            if obj is None:
                return None
            for k, v in fields.items():
                setattr(obj, k, v)
            s.commit()
            return _row_to_dict(obj)


_store: CrmProductsPostgres | None = None


def get_store() -> CrmProductsPostgres:
    global _store
    if _store is None:
        _store = CrmProductsPostgres()
        _store.ensure_schema()
    return _store
