"""SQLAlchemy models (additive ``val_*`` tables). Money in rupees as Float; quantities/NAV as Float.
shortcut: Float not Decimal storage, all arithmetic is done in Decimal (consolidation.py) and rounded to paise; move to Numeric on Postgres."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> str:
    return datetime.now(UTC).isoformat()


def _s(n=64, **kw):
    return mapped_column(String(n), **kw)


class ValBatch(Base):
    __tablename__ = "val_batches"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    client_id: Mapped[str] = _s(36, nullable=False, index=True)
    report_month: Mapped[str] = _s(7, nullable=False)              # YYYY-MM
    valuation_date: Mapped[str] = _s(10, nullable=False)           # YYYY-MM-DD requested
    status: Mapped[str] = _s(16, nullable=False, default="draft")  # draft|processed|reconciled|approved|rejected
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revises_batch_id: Mapped[str | None] = _s(36, nullable=True)
    created_by: Mapped[str] = _s(36, nullable=False)
    created_at: Mapped[str] = _s(40, nullable=False, default=now)
    approved_by: Mapped[str | None] = _s(36, nullable=True)
    approved_at: Mapped[str | None] = _s(40, nullable=True)
    __table_args__ = (Index("ix_val_batches_client_month", "client_id", "report_month"),)


class ValSourceFile(Base):
    __tablename__ = "val_source_files"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(ForeignKey("val_batches.id"), nullable=False, index=True)
    client_id: Mapped[str] = _s(36, nullable=False)
    filename: Mapped[str] = _s(255, nullable=False)
    sha256: Mapped[str] = _s(64, nullable=False, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = _s(80, nullable=False)              # relative to the private store
    provider: Mapped[str | None] = _s(24, nullable=True)           # fundsindia|proaffluence|stallion
    provider_source: Mapped[str] = _s(12, nullable=False, default="detected")  # detected|manual
    detect_note: Mapped[str | None] = _s(255, nullable=True)
    status: Mapped[str] = _s(16, nullable=False, default="uploaded")  # uploaded|extracted|manual_review|failed|removed
    statement_date: Mapped[str | None] = _s(10, nullable=True)
    totals_json: Mapped[str | None] = mapped_column(Text, nullable=True)    # provider-reported totals
    warnings_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    errors_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    adapter_version: Mapped[str | None] = _s(32, nullable=True)
    created_at: Mapped[str] = _s(40, nullable=False, default=now)


class ValAccount(Base):
    __tablename__ = "val_accounts"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(ForeignKey("val_batches.id"), nullable=False, index=True)
    source_file_id: Mapped[str] = mapped_column(ForeignKey("val_source_files.id"), nullable=False)
    provider: Mapped[str] = _s(24, nullable=False)
    account_no: Mapped[str | None] = _s(64, nullable=True)
    asset_class: Mapped[str] = _s(16, nullable=False)              # mutual_fund|pms
    valuation_date: Mapped[str | None] = _s(10, nullable=True)
    statement_date: Mapped[str | None] = _s(10, nullable=True)
    period_start: Mapped[str | None] = _s(10, nullable=True)
    cash_balance: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider_total_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider_total_invested: Mapped[float | None] = mapped_column(Float, nullable=True)
    opening_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    realised_gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    unrealised_gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    income: Mapped[float | None] = mapped_column(Float, nullable=True)
    fees: Mapped[float | None] = mapped_column(Float, nullable=True)
    flows_complete: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 1 = flows cover inception -> valuation
    flows_attested_by: Mapped[str | None] = _s(36, nullable=True)
    value_basis: Mapped[str | None] = _s(24, nullable=True)        # set by reconciliation (cash treatment)
    closing_value: Mapped[float | None] = mapped_column(Float, nullable=True)   # set by reconciliation
    source_page: Mapped[str | None] = _s(32, nullable=True)
    __table_args__ = (Index("ix_val_accounts_identity", "provider", "account_no"),)


class ValHolding(Base):
    __tablename__ = "val_holdings"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(ForeignKey("val_batches.id"), nullable=False, index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("val_accounts.id"), nullable=False, index=True)
    source_file_id: Mapped[str] = mapped_column(ForeignKey("val_source_files.id"), nullable=False)
    provider: Mapped[str] = _s(24, nullable=False)
    asset_type: Mapped[str] = _s(16, nullable=False)               # mutual_fund|equity|debt|cash|other
    security_name: Mapped[str] = _s(255, nullable=False)
    isin: Mapped[str | None] = _s(12, nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    invested_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unrealised_gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    realised_gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    income: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_page: Mapped[str | None] = _s(32, nullable=True)        # PDF page or worksheet name
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)
    validation_status: Mapped[str] = _s(12, nullable=False, default="ok")  # ok|warning|error


class ValCashflow(Base):
    __tablename__ = "val_cashflows"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(ForeignKey("val_batches.id"), nullable=False, index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("val_accounts.id"), nullable=False)
    source_file_id: Mapped[str] = mapped_column(ForeignKey("val_source_files.id"), nullable=False)
    flow_date: Mapped[str] = _s(10, nullable=False)
    kind: Mapped[str] = _s(16, nullable=False)                     # deposit|withdrawal|transfer_in|transfer_out|fee|income
    amount: Mapped[float] = mapped_column(Float, nullable=False)   # always positive magnitude
    external: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 0 = internal transfer (excluded from XIRR)
    description: Mapped[str | None] = _s(255, nullable=True)
    source_page: Mapped[str | None] = _s(32, nullable=True)
    source_row: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ValReconciliation(Base):
    __tablename__ = "val_reconciliation"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(ForeignKey("val_batches.id"), nullable=False, index=True)
    check_code: Mapped[str] = _s(40, nullable=False)
    subject: Mapped[str] = _s(120, nullable=False, default="")      # file/account the check applies to
    severity: Mapped[str] = _s(8, nullable=False)                  # error|warning|info
    status: Mapped[str] = _s(12, nullable=False)                   # passed|failed|resolved|overridden
    expected: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)
    difference: Mapped[float | None] = mapped_column(Float, nullable=True)
    message: Mapped[str] = _s(500, nullable=False)
    fingerprint: Mapped[str] = _s(64, nullable=False)              # resolution only carries over if this is unchanged
    resolution_reason: Mapped[str | None] = _s(500, nullable=True)
    resolved_by: Mapped[str | None] = _s(36, nullable=True)
    resolved_at: Mapped[str | None] = _s(40, nullable=True)
    run_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ValSnapshot(Base):
    """Immutable approved snapshot (UPDATE/DELETE are blocked by trigger on SQLite)."""
    __tablename__ = "val_snapshots"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(ForeignKey("val_batches.id"), nullable=False, unique=True)
    client_id: Mapped[str] = _s(36, nullable=False)
    report_month: Mapped[str] = _s(7, nullable=False)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    valuation_date: Mapped[str] = _s(10, nullable=False)
    total_value: Mapped[float] = mapped_column(Float, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    payload_sha256: Mapped[str] = _s(64, nullable=False)
    approved_by: Mapped[str] = _s(36, nullable=False)
    created_at: Mapped[str] = _s(40, nullable=False, default=now)
    __table_args__ = (UniqueConstraint("client_id", "report_month", "revision_no", name="ux_val_snapshot_rev"),)


class ValReportVersion(Base):
    """Immutable generated PDF; a regenerate or a corrected statement adds a row, never replaces one."""
    __tablename__ = "val_report_versions"
    id: Mapped[str] = _s(36, primary_key=True, default=new_id)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("val_snapshots.id"), nullable=False, index=True)
    client_id: Mapped[str] = _s(36, nullable=False)
    report_month: Mapped[str] = _s(7, nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)   # per client-month, strictly increasing
    storage_key: Mapped[str] = _s(80, nullable=False)
    pdf_sha256: Mapped[str] = _s(64, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_by: Mapped[str] = _s(36, nullable=False)
    created_at: Mapped[str] = _s(40, nullable=False, default=now)
    __table_args__ = (UniqueConstraint("client_id", "report_month", "version_no", name="ux_val_report_ver"),)


class ValAuditLog(Base):
    __tablename__ = "val_audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str | None] = _s(36, nullable=True, index=True)
    client_id: Mapped[str | None] = _s(36, nullable=True)
    actor_id: Mapped[str] = _s(36, nullable=False)
    action: Mapped[str] = _s(40, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = _s(40, nullable=False, default=now)


TABLES = [m.__table__ for m in (ValBatch, ValSourceFile, ValAccount, ValHolding, ValCashflow, ValReconciliation,
                                ValSnapshot, ValReportVersion, ValAuditLog)]
_IMMUTABLE = ("val_snapshots", "val_report_versions", "val_audit_log")


def immutability_ddl() -> list[str]:
    out = []
    for t in _IMMUTABLE:
        for op in ("UPDATE", "DELETE"):
            out.append(f"CREATE TRIGGER IF NOT EXISTS trg_{t}_no_{op.lower()} BEFORE {op} ON {t} "
                       f"BEGIN SELECT RAISE(ABORT, '{t} is append-only'); END")
    return out


def ensure_schema(engine) -> None:
    """Idempotent, additive: create missing val_* tables and (SQLite) the append-only triggers. Never alters/drops."""
    Base.metadata.create_all(engine, tables=TABLES, checkfirst=True)
    if engine.dialect.name == "sqlite":
        with engine.begin() as c:
            for ddl in immutability_ddl():
                c.exec_driver_sql(ddl)
