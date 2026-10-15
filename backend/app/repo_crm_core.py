"""Persistence layer for CRM core entities (W1).

Backend-agnostic: the SQLAlchemy 2.0 models from ``app.models.crm_core`` run
against Postgres when ``DATABASE_URL`` points at one, otherwise against the
local SQLite file (``FH_DB_PATH``). The schema is ensured idempotently on first
use, so tests and fresh checkouts work without manual migration steps; Alembic
``0003_crm_core``/``0007_crm_hardening`` are the production migrations for
Postgres and ``app/db_crm_core.init_crm_core_schema`` is the raw-SQLite
equivalent.

All methods return plain ``dict`` rows (ISO-8601 UTC text timestamps, money in
integer paise) and raise ``CrmCoreError`` (a ``ValueError`` with a
machine-friendly ``.code``) for constraint violations the API layer maps to 422.

Every create/update also writes ``audit_log`` rows (one per changed field) in
the same transaction and stamps ``created_by``/``updated_by``/``updated_at``.
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Engine, and_, bindparam, create_engine, func, inspect, or_, select, text
from sqlalchemy.orm import Session

from app.db.models import Base
from app.models.crm_core import (
    ActivityModel,
    AuditLogModel,
    CaseModel,
    ContactModel,
    CrmListViewModel,
    HouseholdMemberModel,
    HouseholdModel,
    LeadModel,
    OpportunityModel,
)
from app.models.crm_phase3 import (  # noqa: E402  (registers the tables on the shared Base)
    CampaignMemberModel,
    CampaignModel,
    CommissionModel,
    HoldingModel,
    RmTeamModel,
    SipScheduleModel,
)

log = logging.getLogger(__name__)

CRM_CORE_TABLES = [
    HouseholdModel.__table__,
    HouseholdMemberModel.__table__,
    LeadModel.__table__,
    OpportunityModel.__table__,
    ActivityModel.__table__,
    CaseModel.__table__,
    AuditLogModel.__table__,
    CrmListViewModel.__table__,
    ContactModel.__table__,
    HoldingModel.__table__,
    SipScheduleModel.__table__,
    CommissionModel.__table__,
    CampaignModel.__table__,
    CampaignMemberModel.__table__,
    RmTeamModel.__table__,
]

# W2 product tables get audit columns + unique business keys once they exist.
PRODUCT_TABLES = (
    "insurance_policies",
    "fixed_deposits",
    "pms_accounts",
    "kyc_records",
    "mandates",
    "consents",
    "suitability_records",
    "disclosure_logs",
)
_AUDIT_COLUMNS = (("created_by", "VARCHAR(36)"), ("updated_by", "VARCHAR(36)"), ("updated_at", "VARCHAR(50)"))
_PRODUCT_EXTRA_COLUMNS = {
    "mandates": (("valid_until", "VARCHAR(10)"),),
    "suitability_records": (
        ("score", "FLOAT"), ("answers", "TEXT"), ("review_due", "VARCHAR(10)"), ("max_riskometer", "INTEGER"),
    ),
}
_PRODUCT_UNIQUE = (
    ("uq_mandates_umrn", "mandates", "umrn"),
    ("uq_policies_policy_no", "insurance_policies", "policy_no"),
)
_LEGACY_WON_STAGES = ("closed", "renewed", "reinvested")

# India has no DST, so a fixed offset avoids needing a tz database in slim images.
IST = timezone(timedelta(hours=5, minutes=30))

_ENGINES: dict[str, Engine] = {}
_PRODUCTS_HARDENED: set[str] = set()


class CrmCoreError(ValueError):
    """Constraint violation with a machine-friendly code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Page:
    """Pagination/sort/search request; ``total`` is filled in by list methods."""

    limit: int = 50
    offset: int = 0
    sort: str | None = None
    q: str | None = None
    total: int = 0


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def month_start_utc() -> str:
    """Start of the current calendar month in IST, as a UTC ISO timestamp (matches ``closed_at``)."""
    now = datetime.now(IST)
    return datetime(now.year, now.month, 1, tzinfo=IST).astimezone(UTC).isoformat()


def today_ist() -> str:
    return datetime.now(IST).date().isoformat()


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


# ---------------------------------------------------------------------------
# Schema hardening (idempotent; mirrors Alembic 0007 for fresh/SQLite DBs)
# ---------------------------------------------------------------------------
def _add_missing_columns(engine: Engine, tables: list) -> None:
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    for t in tables:
        if t.name not in existing:
            continue
        have = {c["name"] for c in insp.get_columns(t.name)}
        for col in t.columns:
            if col.name not in have:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {t.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}"))
        for idx in t.indexes:
            idx.create(engine, checkfirst=True)


def _harden_core(engine: Engine) -> None:
    _add_missing_columns(engine, CRM_CORE_TABLES)
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE opportunities SET stage = 'won', closed_at = COALESCE(closed_at, updated_at), "
                "won_amount = COALESCE(won_amount, amount) WHERE stage IN :legacy"
            ).bindparams(bindparam("legacy", expanding=True)),
            {"legacy": list(_LEGACY_WON_STAGES)},
        )


def ensure_products_hardening() -> None:
    """Add audit columns + unique business keys to the W2 tables (once they exist)."""
    engine = _get_engine()
    key = str(engine.url)
    if key in _PRODUCTS_HARDENED:
        return
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    if not set(PRODUCT_TABLES) <= existing:
        return
    for table in PRODUCT_TABLES:
        have = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in (*_AUDIT_COLUMNS, *_PRODUCT_EXTRA_COLUMNS.get(table, ())):
            if name not in have:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
    for idx_name, table, col in _PRODUCT_UNIQUE:
        try:
            with engine.begin() as conn:
                conn.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {idx_name} ON {table}({col})"))
        except Exception:  # existing duplicate rows: leave unprotected rather than fail startup
            log.warning("Could not create unique index %s (duplicate %s.%s values exist)", idx_name, table, col)
    _PRODUCTS_HARDENED.add(key)


RELATION_FOR_ROLE = {"primary": "self", "spouse": "spouse", "child": "child", "dependent": "dependent", "other": "other"}


def _backfill_contacts(engine: Engine) -> None:
    """Give every existing household member a contact row (idempotent)."""
    with Session(engine) as s:
        have = set(s.scalars(select(ContactModel.customer_id)).all())
        missing = [m for m in s.scalars(select(HouseholdMemberModel)).all() if m.customer_id not in have]
        # a customer in several households (admin override) gets one contact, in the first household found
        seen: set[str] = set()
        for m in missing:
            if m.customer_id in seen:
                continue
            seen.add(m.customer_id)
            s.add(ContactModel(
                id=_new_id(), customer_id=m.customer_id, household_id=m.household_id,
                relation=RELATION_FOR_ROLE.get(m.role, "other"), created_at=_utcnow(),
            ))
        s.commit()


def _ensure_contact(s: Session, household_id: str, customer_id: str, role: str, actor_id: str | None) -> None:
    if s.scalar(select(ContactModel.id).where(ContactModel.customer_id == customer_id)):
        return
    _create(s, ContactModel, "contact", actor_id, customer_id=customer_id, household_id=household_id,
            relation=RELATION_FOR_ROLE.get(role, "other"))


def _get_engine() -> Engine:
    key = _resolve_url()
    engine = _ENGINES.get(key)
    if engine is None:
        engine = create_engine(key, pool_pre_ping=True)
        # Idempotent: create_all only adds missing tables.
        Base.metadata.create_all(engine, tables=CRM_CORE_TABLES)
        _harden_core(engine)
        _backfill_contacts(engine)
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


# ---------------------------------------------------------------------------
# Query helpers: pagination, scoping, audit
# ---------------------------------------------------------------------------
def _page(s: Session, stmt, model: Any, page: Page | None, search_cols: tuple[str, ...]):
    """Apply q/sort/limit/offset; fills ``page.total``. Returns scalars."""
    if page is None:
        return s.scalars(stmt).all()
    if page.q:
        like = "%" + page.q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(*[getattr(model, c).ilike(like, escape="\\") for c in search_cols]))
    page.total = s.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    if page.sort:
        name = page.sort.lstrip("-")
        if name not in model.__table__.columns:
            raise CrmCoreError("bad_sort", f"sort must be a column name (optionally prefixed with '-'), got '{name}'")
        col = getattr(model, name)
        stmt = stmt.order_by(None).order_by(col.desc() if page.sort.startswith("-") else col.asc())
    return s.scalars(stmt.limit(page.limit).offset(page.offset)).all()





def rm_ids(rm: Any) -> list[str]:
    """Normalise a viewer (one RM id or a team) to a list for ``IN`` clauses."""
    return [rm] if isinstance(rm, str) else sorted(rm)


def _scope_customers(col, rm: Any):
    """Predicate: ``col`` is a customer in a household owned by ``rm`` (primary or member)."""
    ids = rm_ids(rm)
    hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(ids))
    members = select(HouseholdMemberModel.customer_id).where(HouseholdMemberModel.household_id.in_(hh))
    primaries = select(HouseholdModel.primary_customer_id).where(
        HouseholdModel.rm_id.in_(ids), HouseholdModel.primary_customer_id.isnot(None)
    )
    return or_(col.in_(members), col.in_(primaries))


def _opp_visible(rm: Any):
    ids = rm_ids(rm)
    hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(ids))
    return or_(
        OpportunityModel.assigned_rm_id.in_(ids),
        OpportunityModel.household_id.in_(hh),
        _scope_customers(OpportunityModel.customer_id, rm),
    )


def _case_visible(rm: Any):
    return _scope_customers(CaseModel.customer_id, rm)


def _activity_visible(rm: Any):
    ids = rm_ids(rm)
    hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(ids))
    return or_(
        ActivityModel.assigned_rm_id.in_(ids),
        ActivityModel.household_id.in_(hh),
        _scope_customers(ActivityModel.customer_id, rm),
        ActivityModel.opportunity_id.in_(select(OpportunityModel.id).where(_opp_visible(rm))),
        ActivityModel.case_id.in_(select(CaseModel.id).where(_case_visible(rm))),
        ActivityModel.lead_id.in_(select(LeadModel.id).where(LeadModel.assigned_rm_id.in_(ids))),
    )


def _str(v: Any) -> str | None:
    return None if v is None else str(v)


def _audit(s: Session, entity: str, entity_id: str, actor_id: str | None, old: dict | None, new: dict) -> None:
    at = _utcnow()
    if old is None:
        s.add(
            AuditLogModel(
                id=_new_id(), entity=entity, entity_id=entity_id, field="_created", old=None, new=entity_id,
                actor_id=actor_id, at=at,
            )
        )
        return
    for k, v in new.items():
        if k in ("updated_at", "updated_by"):
            continue
        if old.get(k) != v:
            s.add(
                AuditLogModel(
                    id=_new_id(), entity=entity, entity_id=entity_id, field=k, old=_str(old.get(k)), new=_str(v),
                    actor_id=actor_id, at=at,
                )
            )


def _create(s: Session, model: Any, entity: str, actor_id: str | None, **values: Any) -> dict[str, Any]:
    now = _utcnow()
    cols = model.__table__.columns
    values.setdefault("id", _new_id())
    if "created_at" in cols:
        values.setdefault("created_at", now)
    if "updated_at" in cols:
        values.setdefault("updated_at", now)
    if "created_by" in cols:
        values["created_by"] = actor_id
    if "updated_by" in cols:
        values["updated_by"] = actor_id
    obj = model(**values)
    s.add(obj)
    s.flush()
    row = _row(obj)
    _audit(s, entity, row["id"], actor_id, None, row)
    return row


def _update(
    s: Session, model: Any, entity: str, rec_id: str, fields: dict[str, Any], allowed: set[str], actor_id: str | None
) -> dict[str, Any] | None:
    obj = s.get(model, rec_id)
    if not obj:
        return None
    old = _row(obj)
    for k, v in fields.items():
        if k in allowed:
            setattr(obj, k, v)
    if "updated_at" in model.__table__.columns:
        obj.updated_at = _utcnow()
        obj.updated_by = actor_id
    s.flush()
    new = _row(obj)
    _audit(s, entity, rec_id, actor_id, old, new)
    return new


class CrmCoreRepository:
    """CRUD for the CRM core tables."""

    # -- scope / lookups ------------------------------------------------
    def scope_ids(self, rm: Any) -> tuple[set[str], set[str]]:
        """(household ids, customer ids) an RM (or a team) can see — a few queries, no per-row lookups."""
        ids = rm_ids(rm)
        with _session() as s:
            hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(ids))
            household_ids = set(s.scalars(hh).all())
            cids = set(
                s.scalars(
                    select(HouseholdMemberModel.customer_id).where(HouseholdMemberModel.household_id.in_(hh))
                ).all()
            )
            cids |= set(
                s.scalars(
                    select(HouseholdModel.primary_customer_id).where(
                        HouseholdModel.rm_id.in_(ids), HouseholdModel.primary_customer_id.isnot(None)
                    )
                ).all()
            )
            return household_ids, cids

    def customer_names(self, ids: set[str] | list[str]) -> dict[str, str]:
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        with _session() as s:
            rows = s.execute(
                text("SELECT id, name FROM customers WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)),
                {"ids": ids},
            ).all()
            return {r[0]: r[1] for r in rows}

    def household_names(self, ids: set[str] | list[str]) -> dict[str, str]:
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        with _session() as s:
            rows = s.execute(select(HouseholdModel.id, HouseholdModel.name).where(HouseholdModel.id.in_(ids))).all()
            return {r[0]: r[1] for r in rows}

    def customer_memberships(self, customer_id: str) -> list[dict[str, Any]]:
        with _session() as s:
            rows = s.scalars(select(HouseholdMemberModel).where(HouseholdMemberModel.customer_id == customer_id)).all()
            return [_row(r) for r in rows]

    # -- households -----------------------------------------------------
    def create_household(
        self,
        *,
        name: str,
        primary_customer_id: str | None = None,
        rm_id: str | None = None,
        notes: str | None = None,
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            return _create(
                s, HouseholdModel, "household", actor_id,
                name=name, primary_customer_id=primary_customer_id, rm_id=rm_id, notes=notes,
            )

    def get_household(self, household_id: str) -> dict[str, Any] | None:
        with _session() as s:
            h = s.get(HouseholdModel, household_id)
            return _row(h) if h else None

    def list_households(
        self, *, rm_id: Any = None, ids: list[str] | None = None, page: Page | None = None
    ) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(HouseholdModel).order_by(HouseholdModel.created_at.desc())
            if rm_id is not None:
                stmt = stmt.where(HouseholdModel.rm_id.in_(rm_ids(rm_id)))
            if ids is not None:
                stmt = stmt.where(HouseholdModel.id.in_(ids))
            return [_row(h) for h in _page(s, stmt, HouseholdModel, page, ("name", "notes"))]

    def update_household(
        self, household_id: str, fields: dict[str, Any], actor_id: str | None = None
    ) -> dict[str, Any] | None:
        with _session() as s:
            return _update(
                s, HouseholdModel, "household", household_id, fields,
                {"name", "primary_customer_id", "rm_id", "notes"}, actor_id,
            )

    # -- household members ----------------------------------------------
    def add_household_member(
        self, *, household_id: str, customer_id: str, role: str, actor_id: str | None = None
    ) -> dict[str, Any]:
        with _session() as s:
            existing = s.scalar(
                select(HouseholdMemberModel).where(
                    HouseholdMemberModel.household_id == household_id,
                    HouseholdMemberModel.customer_id == customer_id,
                )
            )
            if existing:
                raise CrmCoreError("duplicate_member", "This customer is already a member of the household.")
            member = _create(
                s, HouseholdMemberModel, "household_member", actor_id,
                household_id=household_id, customer_id=customer_id, role=role,
            )
            _ensure_contact(s, household_id, customer_id, role, actor_id)
            return member

    def list_household_members(self, household_id: str) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = (
                select(HouseholdMemberModel)
                .where(HouseholdMemberModel.household_id == household_id)
                .order_by(HouseholdMemberModel.id)
            )
            return [_row(m) for m in s.scalars(stmt).all()]

    def count_household_members(self, household_id: str) -> int:
        return self.member_counts([household_id]).get(household_id, 0)

    def member_counts(self, household_ids: list[str]) -> dict[str, int]:
        if not household_ids:
            return {}
        with _session() as s:
            rows = s.execute(
                select(HouseholdMemberModel.household_id, func.count())
                .where(HouseholdMemberModel.household_id.in_(household_ids))
                .group_by(HouseholdMemberModel.household_id)
            ).all()
            return {r[0]: r[1] for r in rows}

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
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            return _create(
                s, LeadModel, "lead", actor_id,
                name=name, email=email, mobile=mobile, source=source, status=status,
                assigned_rm_id=assigned_rm_id, notes=notes,
            )

    def get_lead(self, lead_id: str) -> dict[str, Any] | None:
        with _session() as s:
            lead = s.get(LeadModel, lead_id)
            return _row(lead) if lead else None

    def list_leads(
        self,
        *,
        status: str | None = None,
        statuses: tuple[str, ...] = (),
        assigned_rm_id: str | None = None,
        viewer_rm_id: str | None = None,
        page: Page | None = None,
    ) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(LeadModel).order_by(LeadModel.created_at.desc())
            if status is not None:
                stmt = stmt.where(LeadModel.status == status)
            if statuses:
                stmt = stmt.where(LeadModel.status.in_(statuses))
            if assigned_rm_id is not None:
                stmt = stmt.where(LeadModel.assigned_rm_id == assigned_rm_id)
            if viewer_rm_id is not None:  # RMs see only their own leads; the unassigned pool is admin-only
                stmt = stmt.where(LeadModel.assigned_rm_id.in_(rm_ids(viewer_rm_id)))
            return [_row(lead) for lead in _page(s, stmt, LeadModel, page, ("name", "email", "mobile", "notes"))]

    def update_lead(self, lead_id: str, fields: dict[str, Any], actor_id: str | None = None) -> dict[str, Any] | None:
        allowed = {"status", "assigned_rm_id", "notes", "name", "email", "mobile", "source"}
        with _session() as s:
            return _update(s, LeadModel, "lead", lead_id, fields, allowed, actor_id)

    def delete_lead(self, lead_id: str, actor_id: str | None = None) -> bool:
        """Hard-delete a lead and its activities; leaves an audit row."""
        with _session() as s:
            lead = s.get(LeadModel, lead_id)
            if not lead:
                return False
            for a in s.scalars(select(ActivityModel).where(ActivityModel.lead_id == lead_id)).all():
                s.delete(a)
            s.add(AuditLogModel(id=_new_id(), entity="lead", entity_id=lead_id, field="_deleted", old=lead.name, new=None, actor_id=actor_id, at=_utcnow()))
            s.delete(lead)
            return True

    def convert_lead(
        self,
        lead_id: str,
        *,
        actor_id: str | None,
        owner_rm_id: str | None,
        password_hash: str,
        household_id: str | None = None,
        household_name: str | None = None,
        member_role: str = "primary",
    ) -> dict[str, Any]:
        """Atomically turn a lead into a customer + household membership.

        One session = one transaction: if any step fails nothing is written.
        Only one of email/mobile is required; the customers table needs both,
        so a missing one gets a clearly-marked placeholder.
        """
        with _session() as s:
            lead = s.get(LeadModel, lead_id)
            if not lead:
                raise CrmCoreError("not_found", "Lead not found")
            if lead.status == "converted":
                raise CrmCoreError("already_converted", "This lead has already been converted.")
            email, mobile = (lead.email or "").strip().lower() or None, (lead.mobile or "").strip() or None
            if not email and not mobile:
                raise CrmCoreError("missing_contact", "Add an email address or a mobile number to the lead before converting.")
            if email and s.execute(text("SELECT 1 FROM customers WHERE email = :e"), {"e": email}).first():
                raise CrmCoreError("duplicate_email", "An account with this email already exists.")
            if mobile and s.execute(text("SELECT 1 FROM customers WHERE mobile = :m"), {"m": mobile}).first():
                raise CrmCoreError("duplicate_mobile", "An account with this mobile number already exists.")
            household: dict[str, Any] | None = None
            if household_id:
                h = s.get(HouseholdModel, household_id)
                if not h:
                    raise CrmCoreError("household_not_found", "Household not found")
                household = _row(h)
            token = _new_id()
            now = _utcnow()
            customer_id = str(uuid.uuid4())
            s.execute(
                text(
                    "INSERT INTO customers (id, name, email, mobile, password_hash, role, assigned_rm_id, "
                    "is_staff, status, must_change_password, created_at) VALUES "
                    "(:id, :name, :email, :mobile, :ph, 'customer', :rm, 0, 'active', 0, :now)"
                ),
                {
                    "id": customer_id,
                    "name": lead.name,
                    "email": email or f"no-email-{token[:12]}@placeholder.invalid",
                    "mobile": mobile or f"0000{token[:8]}",  # not a valid Indian mobile, so never collides
                    "ph": password_hash,
                    "rm": owner_rm_id,
                    "now": now,
                },
            )
            if household is None:
                household = _create(
                    s, HouseholdModel, "household", actor_id,
                    name=household_name or f"{lead.name} Household", primary_customer_id=customer_id, rm_id=owner_rm_id,
                )
            _create(
                s, HouseholdMemberModel, "household_member", actor_id,
                household_id=household["id"], customer_id=customer_id, role=member_role,
            )
            _ensure_contact(s, household["id"], customer_id, member_role, actor_id)
            _update(
                s, LeadModel, "lead", lead_id,
                {"status": "converted", "converted_household_id": household["id"], "converted_at": now},
                {"status", "converted_household_id", "converted_at"}, actor_id,
            )
            return {"customer_id": customer_id, "household_id": household["id"]}

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
        scheme_code: str | None = None,
        riskometer: int | None = None,
        suitability_note: str | None = None,
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            return _create(
                s, OpportunityModel, "opportunity", actor_id,
                household_id=household_id, customer_id=customer_id, product_line=product_line, title=title,
                amount=amount, stage=stage, probability=probability, expected_close=expected_close,
                assigned_rm_id=assigned_rm_id, notes=notes, scheme_code=scheme_code, riskometer=riskometer,
                suitability_note=suitability_note,
            )

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
        closed_from: str | None = None,
        viewer_rm_id: str | None = None,
        page: Page | None = None,
    ) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(OpportunityModel).order_by(OpportunityModel.created_at.desc())
            if closed_from is not None:  # UTC ISO timestamp
                stmt = stmt.where(OpportunityModel.closed_at >= closed_from)
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
            if viewer_rm_id is not None:
                stmt = stmt.where(_opp_visible(viewer_rm_id))
            return [_row(o) for o in _page(s, stmt, OpportunityModel, page, ("title", "notes", "product_line"))]

    def update_opportunity(
        self, opportunity_id: str, fields: dict[str, Any], actor_id: str | None = None
    ) -> dict[str, Any] | None:
        allowed = {
            "stage", "probability", "amount", "expected_close", "notes", "assigned_rm_id", "title",
            "lost_reason", "closed_at", "won_amount",
        }
        with _session() as s:
            return _update(s, OpportunityModel, "opportunity", opportunity_id, fields, allowed, actor_id)

    def count_open_opportunities(self, household_id: str) -> int:
        return self.open_opp_counts([household_id]).get(household_id, 0)

    def open_opp_counts(self, household_ids: list[str]) -> dict[str, int]:
        if not household_ids:
            return {}
        with _session() as s:
            rows = s.execute(
                select(OpportunityModel.household_id, func.count())
                .where(OpportunityModel.household_id.in_(household_ids), OpportunityModel.stage.notin_(("won", "lost")))
                .group_by(OpportunityModel.household_id)
            ).all()
            return {r[0]: r[1] for r in rows}

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
        lead_id: str | None = None,
        policy_id: str | None = None,
        fd_id: str | None = None,
        due_at: str | None = None,
        assigned_rm_id: str | None = None,
        source_ref: str | None = None,
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            return _create(
                s, ActivityModel, "activity", actor_id, source_ref=source_ref,
                kind=kind, subject=subject, body=body, household_id=household_id, customer_id=customer_id,
                opportunity_id=opportunity_id, case_id=case_id, lead_id=lead_id, policy_id=policy_id, fd_id=fd_id, due_at=due_at,
                done_at=None, assigned_rm_id=assigned_rm_id,
            )

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
        lead_id: str | None = None,
        policy_id: str | None = None,
        fd_id: str | None = None,
        done: bool | None = None,
        due_before: str | None = None,
        overdue_before: str | None = None,
        viewer_rm_id: str | None = None,
        page: Page | None = None,
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
            if lead_id is not None:
                stmt = stmt.where(ActivityModel.lead_id == lead_id)
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
            if overdue_before is not None:  # strictly before this date: "due before today (IST)"
                stmt = stmt.where(ActivityModel.due_at.isnot(None), ActivityModel.due_at < overdue_before)
            if viewer_rm_id is not None:
                stmt = stmt.where(_activity_visible(viewer_rm_id))
            return [_row(a) for a in _page(s, stmt, ActivityModel, page, ("subject", "body", "kind"))]

    def update_activity(
        self, activity_id: str, fields: dict[str, Any], actor_id: str | None = None
    ) -> dict[str, Any] | None:
        allowed = {"done_at", "subject", "body", "due_at", "assigned_rm_id"}
        with _session() as s:
            return _update(s, ActivityModel, "activity", activity_id, fields, allowed, actor_id)

    def open_followup_exists(
        self, *, policy_id: str | None = None, fd_id: str | None = None, source_ref: str | None = None
    ) -> bool:
        with _session() as s:
            stmt = select(ActivityModel.id).where(
                ActivityModel.kind == "followup",
                ActivityModel.done_at.is_(None),
            )
            if source_ref is not None:
                stmt = stmt.where(ActivityModel.source_ref == source_ref)
            if policy_id is not None:
                stmt = stmt.where(ActivityModel.policy_id == policy_id)
            if fd_id is not None:
                stmt = stmt.where(ActivityModel.fd_id == fd_id)
            return s.scalar(stmt.limit(1)) is not None

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
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        with _session() as s:
            return _create(
                s, CaseModel, "case", actor_id,
                customer_id=customer_id, category=category, subject=subject, body=body, status=status,
                sla_due_at=sla_due_at, resolved_at=None,
            )

    def get_case(self, case_id: str) -> dict[str, Any] | None:
        with _session() as s:
            case = s.get(CaseModel, case_id)
            return _row(case) if case else None

    def list_cases(
        self,
        *,
        status: str | None = None,
        statuses: tuple[str, ...] = (),
        customer_id: str | None = None,
        customer_ids: set[str] | None = None,
        sla_before: str | None = None,
        viewer_rm_id: str | None = None,
        page: Page | None = None,
    ) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = select(CaseModel).order_by(CaseModel.created_at.desc())
            if status is not None:
                stmt = stmt.where(CaseModel.status == status)
            if statuses:
                stmt = stmt.where(CaseModel.status.in_(statuses))
            if customer_id is not None:
                stmt = stmt.where(CaseModel.customer_id == customer_id)
            if customer_ids is not None:
                stmt = stmt.where(CaseModel.customer_id.in_(customer_ids or {""}))
            if sla_before is not None:  # SLA date strictly before this date
                stmt = stmt.where(CaseModel.sla_due_at.isnot(None), CaseModel.sla_due_at < sla_before)
            if viewer_rm_id is not None:
                stmt = stmt.where(_case_visible(viewer_rm_id))
            return [_row(c) for c in _page(s, stmt, CaseModel, page, ("subject", "body", "category"))]

    def update_case(self, case_id: str, fields: dict[str, Any], actor_id: str | None = None) -> dict[str, Any] | None:
        allowed = {"status", "sla_due_at", "body", "resolved_at"}
        with _session() as s:
            return _update(s, CaseModel, "case", case_id, fields, allowed, actor_id)

    # -- audit ----------------------------------------------------------
    def record_audit(
        self, entity: str, entity_id: str, actor_id: str | None, old: dict | None, new: dict
    ) -> None:
        """Audit a write that happened outside this repo (W2 product tables)."""
        with _session() as s:
            _audit(s, entity, entity_id, actor_id, old, new)

    def stamp(self, table: str, rec_id: str, actor_id: str | None, *, created: bool, id_col: str = "id") -> None:
        """Set created_by/updated_by/updated_at on a W2 product row (table names are internal constants)."""
        if table not in PRODUCT_TABLES:
            raise ValueError(f"unknown table {table}")
        ensure_products_hardening()
        sets = "updated_by = :a, updated_at = :now" + (", created_by = COALESCE(created_by, :a)" if created else "")
        with _session() as s:
            s.execute(text(f"UPDATE {table} SET {sets} WHERE {id_col} = :id"), {"a": actor_id, "now": _utcnow(), "id": rec_id})

    def list_audit(self, entity: str, entity_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
        with _session() as s:
            stmt = (
                select(AuditLogModel)
                .where(and_(AuditLogModel.entity == entity, AuditLogModel.entity_id == entity_id))
                .order_by(AuditLogModel.at.desc())
                .limit(limit)
            )
            return [_row(a) for a in s.scalars(stmt).all()]

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
        today = datetime.now(IST).date()
        return today.isoformat(), (today + timedelta(days=days)).isoformat()

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
