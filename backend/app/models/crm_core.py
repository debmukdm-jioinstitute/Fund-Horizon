"""SQLAlchemy 2.0 models for the CRM core tables (W1).

Extends the shared declarative ``Base`` from ``app.db.models`` so the existing
``Base.metadata.create_all`` call in the Postgres repository picks these tables
up. The Alembic migration ``0003_crm_core`` (revision ``crm_core_0003``) is the
production migration for Postgres; ``app/db_crm_core.py`` carries the matching
raw-SQLite DDL.
"""

from __future__ import annotations

from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class HouseholdModel(Base):
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    primary_customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class HouseholdMemberModel(Base):
    __tablename__ = "household_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="other")

    __table_args__ = (UniqueConstraint("household_id", "customer_id", name="uq_household_member"),)


class LeadModel(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    mobile: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new", index=True)
    assigned_rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    converted_household_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    converted_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class OpportunityModel(Base):
    __tablename__ = "opportunities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    household_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    product_line: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[int | None] = mapped_column(Integer, nullable=True)  # paise
    stage: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    probability: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expected_close: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
    assigned_rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(50), nullable=False)
    lost_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    won_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)  # paise
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ActivityModel(Base):
    __tablename__ = "activities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    household_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    opportunity_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    case_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    lead_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    policy_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    fd_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    due_at: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    done_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assigned_rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class CaseModel(Base):
    __tablename__ = "cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open", index=True)
    sla_due_at: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    resolved_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class AuditLogModel(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entity: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    old: Mapped[str | None] = mapped_column(Text, nullable=True)
    new: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    at: Mapped[str] = mapped_column(String(50), nullable=False)


class CrmListViewModel(Base):
    """A user's saved list view: filters + visible columns for one CRM entity."""

    __tablename__ = "crm_list_views"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    entity: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    filters: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON object
    columns: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array of column ids
    is_default: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(50), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "entity", "name", name="uq_crm_list_view_name"),)
