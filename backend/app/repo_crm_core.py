"""Persistence layer for CRM core entities (W1).

Backend-agnostic: the SQLAlchemy 2.0 models from ``app.models.crm_core`` run
against Postgres when ``DATABASE_URL`` points at one, otherwise against the
local SQLite file (``FH_DB_PATH``). The schema is ensured idempotently on first
use, so tests and fresh checkouts work without manual migration steps; Alembic
``0003_crm_core`` is the production migration for Postgres and
``app/db_crm_core.init_crm_core_schema`` is the raw-SQLite equivalent.

All methods return plain ``dict`` rows (ISO-8601 UTC text timestamps, money in
integer paise) and raise ``ValueError`` with a machine-friendly ``.code``
attribute for constraint violations the API layer maps to 422.
"""

from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.db.models import Base
from app.models.crm_core import (
    ActivityModel,
    CaseModel,
    HouseholdMemberModel,
    HouseholdModel,
    LeadModel,
    OpportunityModel,
)

CRM_CORE_TABLES = [
    HouseholdModel.__table__,
    HouseholdMemberModel.__table__,
    LeadModel.__table__,
    OpportunityModel.__table__,
    ActivityModel.__table__,
    CaseModel.__table__,
]

_ENGINES: dict[str, Engine] = {}


class CrmCoreError(ValueError):
    """Constraint violation with a machine-friendly code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def _row(model: Any) -> dict[str, Any]:
    return {c.name: getattr(model, c.name) for c in model.__table__.columns}


def _resolve_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url.startswith(("postgres://", "postgresql://")):
        from app.db.postgres import normalize_postgres_url

        return normalize_postgres_url(url)
    from app.db.sqlite import get_default_db_path

    path = get_default_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


def _get_engine() -> Engine:
    key = _resolve_url()
    engine = _ENGINES.get(key)
    if engine is None:
        engine = create_engine(key, pool_pre_ping=True)
        # Idempotent: create_all only adds missing tables.
        Base.metadata.create_all(engine, tables=CRM_CORE_TABLES)
        _ENGINES[key] = engine
    return engine


@contextmanager
def _session():
    engine = _get_engine()
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


class CrmCoreRepository:
    """CRUD for the CRM core tables."""

    # -- households -----------------------------------------------------
    def create_household(
        self,
        *,
        name: str,
        primary_customer_id: str | None = None,
        rm_id: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            h = HouseholdModel(
                id=_new_id(),
                name=name,
                primary_customer_id=primary_customer_id,
                rm_id=rm_id,
                notes=notes,
                created_at=_utcnow(),
            )
            s.add(h)
            s.flush()
            return _row(h)

    def get_household(self, household_id: str) -> dict[str, Any] | None:
        with _session() as s:
            h = s.get(HouseholdModel, household_id)
            return _row(h) if h else None

    def list_households(self, *, rm_id: str | None = None) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(HouseholdModel).order_by(HouseholdModel.created_at.desc())
            if rm_id is not None:
                stmt = stmt.where(HouseholdModel.rm_id == rm_id)
            return [_row(h) for h in s.scalars(stmt).all()]

    def update_household(self, household_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"name", "primary_customer_id", "rm_id", "notes"}
        with _session() as s:
            h = s.get(HouseholdModel, household_id)
            if not h:
                return None
            for k, v in fields.items():
                if k in allowed:
                    setattr(h, k, v)
            s.flush()
            return _row(h)

    # -- household members ----------------------------------------------
    def add_household_member(self, *, household_id: str, customer_id: str, role: str) -> dict[str, Any]:
        with _session() as s:
            existing = s.scalar(
                select(HouseholdMemberModel).where(
                    HouseholdMemberModel.household_id == household_id,
                    HouseholdMemberModel.customer_id == customer_id,
                )
            )
            if existing:
                raise CrmCoreError("duplicate_member", "This customer is already a member of the household.")
            m = HouseholdMemberModel(id=_new_id(), household_id=household_id, customer_id=customer_id, role=role)
            s.add(m)
            s.flush()
            return _row(m)

    def list_household_members(self, household_id: str) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = (
                select(HouseholdMemberModel)
                .where(HouseholdMemberModel.household_id == household_id)
                .order_by(HouseholdMemberModel.id)
            )
            return [_row(m) for m in s.scalars(stmt).all()]

    def count_household_members(self, household_id: str) -> int:
        return len(self.list_household_members(household_id))

    # -- leads ----------------------------------------------------------
    def create_lead(
        self,
        *,
        name: str,
        email: str | None = None,
        mobile: str | None = None,
        source: str = "other",
        status: str = "new",
        assigned_rm_id: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            lead = LeadModel(
                id=_new_id(),
                name=name,
                email=email,
                mobile=mobile,
                source=source,
                status=status,
                assigned_rm_id=assigned_rm_id,
                notes=notes,
                created_at=_utcnow(),
            )
            s.add(lead)
            s.flush()
            return _row(lead)

    def get_lead(self, lead_id: str) -> dict[str, Any] | None:
        with _session() as s:
            lead = s.get(LeadModel, lead_id)
            return _row(lead) if lead else None

    def list_leads(self, *, status: str | None = None, assigned_rm_id: str | None = None) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(LeadModel).order_by(LeadModel.created_at.desc())
            if status is not None:
                stmt = stmt.where(LeadModel.status == status)
            if assigned_rm_id is not None:
                stmt = stmt.where(LeadModel.assigned_rm_id == assigned_rm_id)
            return [_row(lead) for lead in s.scalars(stmt).all()]

    def update_lead(self, lead_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"status", "assigned_rm_id", "notes", "name", "email", "mobile", "source"}
        with _session() as s:
            lead = s.get(LeadModel, lead_id)
            if not lead:
                return None
            for k, v in fields.items():
                if k in allowed:
                    setattr(lead, k, v)
            s.flush()
            return _row(lead)

    # -- opportunities --------------------------------------------------
    def create_opportunity(
        self,
        *,
        household_id: str | None = None,
        customer_id: str | None = None,
        product_line: str,
        title: str,
        amount: int | None = None,
        stage: str,
        probability: int = 0,
        expected_close: str | None = None,
        assigned_rm_id: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        now = _utcnow()
        with _session() as s:
            opp = OpportunityModel(
                id=_new_id(),
                household_id=household_id,
                customer_id=customer_id,
                product_line=product_line,
                title=title,
                amount=amount,
                stage=stage,
                probability=probability,
                expected_close=expected_close,
                assigned_rm_id=assigned_rm_id,
                notes=notes,
                created_at=now,
                updated_at=now,
            )
            s.add(opp)
            s.flush()
            return _row(opp)

    def get_opportunity(self, opportunity_id: str) -> dict[str, Any] | None:
        with _session() as s:
            opp = s.get(OpportunityModel, opportunity_id)
            return _row(opp) if opp else None

    def list_opportunities(
        self,
        *,
        product_line: str | None = None,
        stage: str | None = None,
        household_id: str | None = None,
        assigned_rm_id: str | None = None,
        exclude_stages: tuple[str, ...] = (),
    ) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(OpportunityModel).order_by(OpportunityModel.created_at.desc())
            if product_line is not None:
                stmt = stmt.where(OpportunityModel.product_line == product_line)
            if stage is not None:
                stmt = stmt.where(OpportunityModel.stage == stage)
            if household_id is not None:
                stmt = stmt.where(OpportunityModel.household_id == household_id)
            if assigned_rm_id is not None:
                stmt = stmt.where(OpportunityModel.assigned_rm_id == assigned_rm_id)
            if exclude_stages:
                stmt = stmt.where(OpportunityModel.stage.notin_(exclude_stages))
            return [_row(opp) for opp in s.scalars(stmt).all()]

    def update_opportunity(self, opportunity_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"stage", "probability", "amount", "expected_close", "notes", "assigned_rm_id", "title"}
        with _session() as s:
            opp = s.get(OpportunityModel, opportunity_id)
            if not opp:
                return None
            for k, v in fields.items():
                if k in allowed:
                    setattr(opp, k, v)
            opp.updated_at = _utcnow()
            s.flush()
            return _row(opp)

    def count_open_opportunities(self, household_id: str) -> int:
        with _session() as s:
            stmt = select(OpportunityModel).where(
                OpportunityModel.household_id == household_id,
                OpportunityModel.stage.notin_(("closed", "lost")),
            )
            return len(s.scalars(stmt).all())

    # -- activities -----------------------------------------------------
    def create_activity(
        self,
        *,
        kind: str,
        subject: str,
        body: str | None = None,
        household_id: str | None = None,
        customer_id: str | None = None,
        opportunity_id: str | None = None,
        case_id: str | None = None,
        policy_id: str | None = None,
        fd_id: str | None = None,
        due_at: str | None = None,
        assigned_rm_id: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            act = ActivityModel(
                id=_new_id(),
                kind=kind,
                subject=subject,
                body=body,
                household_id=household_id,
                customer_id=customer_id,
                opportunity_id=opportunity_id,
                case_id=case_id,
                policy_id=policy_id,
                fd_id=fd_id,
                due_at=due_at,
                done_at=None,
                assigned_rm_id=assigned_rm_id,
                created_at=_utcnow(),
            )
            s.add(act)
            s.flush()
            return _row(act)

    def get_activity(self, activity_id: str) -> dict[str, Any] | None:
        with _session() as s:
            act = s.get(ActivityModel, activity_id)
            return _row(act) if act else None

    def list_activities(
        self,
        *,
        assigned_rm_id: str | None = None,
        household_id: str | None = None,
        customer_id: str | None = None,
        opportunity_id: str | None = None,
        case_id: str | None = None,
        policy_id: str | None = None,
        fd_id: str | None = None,
        done: bool | None = None,
        due_before: str | None = None,
    ) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(ActivityModel).order_by(ActivityModel.created_at.desc())
            if assigned_rm_id is not None:
                stmt = stmt.where(ActivityModel.assigned_rm_id == assigned_rm_id)
            if household_id is not None:
                stmt = stmt.where(ActivityModel.household_id == household_id)
            if customer_id is not None:
                stmt = stmt.where(ActivityModel.customer_id == customer_id)
            if opportunity_id is not None:
                stmt = stmt.where(ActivityModel.opportunity_id == opportunity_id)
            if case_id is not None:
                stmt = stmt.where(ActivityModel.case_id == case_id)
            if policy_id is not None:
                stmt = stmt.where(ActivityModel.policy_id == policy_id)
            if fd_id is not None:
                stmt = stmt.where(ActivityModel.fd_id == fd_id)
            if done is True:
                stmt = stmt.where(ActivityModel.done_at.isnot(None))
            elif done is False:
                stmt = stmt.where(ActivityModel.done_at.is_(None))
            if due_before is not None:
                stmt = stmt.where(ActivityModel.due_at.isnot(None), ActivityModel.due_at <= due_before)
            return [_row(a) for a in s.scalars(stmt).all()]

    def update_activity(self, activity_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"done_at", "subject", "body", "due_at", "assigned_rm_id"}
        with _session() as s:
            act = s.get(ActivityModel, activity_id)
            if not act:
                return None
            for k, v in fields.items():
                if k in allowed:
                    setattr(act, k, v)
            s.flush()
            return _row(act)

    def open_followup_exists(self, *, policy_id: str | None = None, fd_id: str | None = None) -> bool:
        with _session() as s:
            stmt = select(ActivityModel).where(
                ActivityModel.kind == "followup",
                ActivityModel.done_at.is_(None),
            )
            if policy_id is not None:
                stmt = stmt.where(ActivityModel.policy_id == policy_id)
            if fd_id is not None:
                stmt = stmt.where(ActivityModel.fd_id == fd_id)
            return s.scalar(stmt) is not None

    # -- cases ----------------------------------------------------------
    def create_case(
        self,
        *,
        customer_id: str,
        category: str,
        subject: str,
        body: str | None = None,
        status: str = "open",
        sla_due_at: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            case = CaseModel(
                id=_new_id(),
                customer_id=customer_id,
                category=category,
                subject=subject,
                body=body,
                status=status,
                sla_due_at=sla_due_at,
                created_at=_utcnow(),
                resolved_at=None,
            )
            s.add(case)
            s.flush()
            return _row(case)

    def get_case(self, case_id: str) -> dict[str, Any] | None:
        with _session() as s:
            case = s.get(CaseModel, case_id)
            return _row(case) if case else None

    def list_cases(self, *, status: str | None = None, customer_id: str | None = None) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(CaseModel).order_by(CaseModel.created_at.desc())
            if status is not None:
                stmt = stmt.where(CaseModel.status == status)
            if customer_id is not None:
                stmt = stmt.where(CaseModel.customer_id == customer_id)
            return [_row(c) for c in s.scalars(stmt).all()]

    def update_case(self, case_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"status", "sla_due_at", "body", "resolved_at"}
        with _session() as s:
            case = s.get(CaseModel, case_id)
            if not case:
                return None
            for k, v in fields.items():
                if k in allowed:
                    setattr(case, k, v)
            s.flush()
            return _row(case)

    # -- W2-adjacent reads (defensive: tables may not exist yet) ---------
    def table_exists(self, name: str) -> bool:
        return name in inspect(_get_engine()).get_table_names()

    def _w2_rows(self, table: str, where: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        if not self.table_exists(table):
            return []
        with _session() as s:
            rows = s.execute(text(f"SELECT * FROM {table} WHERE {where}"), params).mappings().all()
            return [dict(r) for r in rows]

    @staticmethod
    def _date_window(days: int) -> tuple[str, str]:
        from datetime import date as _date
        from datetime import timedelta as _td

        today = _date.today()
        return today.isoformat(), (today + _td(days=days)).isoformat()

    def list_policy_renewals(self, *, days: int) -> list[dict[str, Any]]:
        """Active insurance policies (W2 table) with renewal_date within N days."""
        today, horizon = self._date_window(days)
        return self._w2_rows(
            "insurance_policies",
            "status = 'active' AND renewal_date IS NOT NULL AND renewal_date >= :today AND renewal_date <= :horizon",
            {"today": today, "horizon": horizon},
        )

    def list_fd_maturities(self, *, days: int) -> list[dict[str, Any]]:
        """Active fixed deposits (W2 table) maturing within N days."""
        today, horizon = self._date_window(days)
        return self._w2_rows(
            "fixed_deposits",
            "status = 'active' AND maturity_date IS NOT NULL AND maturity_date >= :today AND maturity_date <= :horizon",
            {"today": today, "horizon": horizon},
        )


def get_crm_repository() -> CrmCoreRepository:
    """Return a CRM core repository bound to the configured database."""
    return CrmCoreRepository()
