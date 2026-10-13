"""SQLAlchemy 2.0 models for Fund Horizon Backoffice.

Covers:
- source_registry & instrument_registry
- observations (market data, yields, FX, macro, commodities)
- option_snapshots & option_contracts (derivatives, PCR)
- flows (FII / DII gross & net)
- pms_strategy_observations
- portfolio_positions, portfolio_cashflows, portfolio_valuations
- fund_holdings & issuer_fundamentals
- watchlists, research_notes, saved_views, import_jobs, audit_events, collector_runs
"""
from __future__ import annotations

from sqlalchemy import Float, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


class SourceRegistryModel(Base):
    __tablename__ = "source_registry"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    official_docs_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    adapter_id: Mapped[str] = mapped_column(String(64), nullable=False)
    adapter_version: Mapped[str] = mapped_column(String(32), nullable=False, default="1.0.0")
    terms_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    configured_permissions: Mapped[str] = mapped_column(String(120), nullable=False, default="public_view_only")
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    rate_budget: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata")
    supported_frequency: Mapped[str] = mapped_column(String(32), nullable=False, default="daily")
    health_status: Mapped[str] = mapped_column(String(32), nullable=False, default="ready")
    last_attempt_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_success_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(50), nullable=False)


class InstrumentRegistryModel(Base):
    __tablename__ = "instrument_registry"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False, default="NSE")
    symbol: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(32), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")
    base_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    quote_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="index_pts")
    source_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_identifier: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contract_convention: Mapped[str | None] = mapped_column(String(64), nullable=True)
    valid_from: Mapped[str | None] = mapped_column(String(10), nullable=True)
    valid_to: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class ObservationModel(Base):
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    instrument_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    observed_at: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    reference_period: Mapped[str | None] = mapped_column(String(32), nullable=True)
    published_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fetched_at: Mapped[str] = mapped_column(String(50), nullable=False)
    value_numeric: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    frequency: Mapped[str] = mapped_column(String(32), nullable=False, default="daily")
    vintage: Mapped[str] = mapped_column(String(32), nullable=False, default="initial")
    provenance: Mapped[str] = mapped_column(String(64), nullable=False, default="automated")
    quality_flags: Mapped[str] = mapped_column(String(64), nullable=False, default="ok")
    raw_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_obs_inst_observed", "instrument_id", "observed_at"),
        UniqueConstraint("instrument_id", "observed_at", "vintage", "provenance", name="uq_observation"),
    )


class OptionSnapshotModel(Base):
    __tablename__ = "option_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    underlying_symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    underlying_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    snapshot_timestamp: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    fetched_at: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    pcr_oi: Mapped[float | None] = mapped_column(Float, nullable=True)
    pcr_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_call_oi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_put_oi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_call_volume: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_put_volume: Mapped[int | None] = mapped_column(Integer, nullable=True)


class OptionContractModel(Base):
    __tablename__ = "option_contracts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    snapshot_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    underlying_symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    expiry_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    strike_price: Mapped[float] = mapped_column(Float, nullable=False)
    option_type: Mapped[str] = mapped_column(String(4), nullable=False)  # CE, PE
    contract_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lot_size: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    oi: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    oi_change: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    implied_vol: Mapped[float | None] = mapped_column(Float, nullable=True)


class FlowModel(Base):
    __tablename__ = "flows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    report_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(32), index=True, nullable=False)  # FII, DII, FPI
    segment: Mapped[str] = mapped_column(String(32), nullable=False)  # equity_cash, debt, fno
    gross_buy: Mapped[float] = mapped_column(Float, nullable=False)  # ₹ crore
    gross_sell: Mapped[float] = mapped_column(Float, nullable=False)
    net: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="inr_crore")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="provisional")
    vintage: Mapped[str] = mapped_column(String(32), nullable=False, default="initial")
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class PmsStrategyObservationModel(Base):
    __tablename__ = "pms_strategy_observations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    strategy_name: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    approach: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    report_month: Mapped[str] = mapped_column(String(7), index=True, nullable=False)  # YYYY-MM
    aum_crore: Mapped[float | None] = mapped_column(Float, nullable=True)
    return_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    return_3m: Mapped[float | None] = mapped_column(Float, nullable=True)
    return_6m: Mapped[float | None] = mapped_column(Float, nullable=True)
    return_1y: Mapped[float | None] = mapped_column(Float, nullable=True)
    cagr_3y: Mapped[float | None] = mapped_column(Float, nullable=True)
    cagr_5y: Mapped[float | None] = mapped_column(Float, nullable=True)
    cagr_since_inception: Mapped[float | None] = mapped_column(Float, nullable=True)
    inception_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    benchmark_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    benchmark_return_1y: Mapped[float | None] = mapped_column(Float, nullable=True)
    fee_structure_desc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="APMI")
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class PortfolioPositionModel(Base):
    __tablename__ = "portfolio_positions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    valuation_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    security_type: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol_or_isin: Mapped[str] = mapped_column(String(32), nullable=False)
    security_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    cost_price_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    market_price_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    market_value_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class PortfolioCashflowModel(Base):
    __tablename__ = "portfolio_cashflows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    flow_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    flow_type: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class PortfolioValuationModel(Base):
    __tablename__ = "portfolio_valuations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    valuation_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    nav_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_units: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_value_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    cash_balance_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fees_accrued_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    holdings_coverage_pct: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    xirr_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    twr_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="statement_import")
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class FundHoldingModel(Base):
    __tablename__ = "fund_holdings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scheme_code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    disclosure_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    isin: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sector: Mapped[str | None] = mapped_column(String(120), nullable=True)
    asset_class: Mapped[str] = mapped_column(String(32), nullable=False, default="equity")
    weight_pct: Mapped[float] = mapped_column(Float, nullable=False)
    rating: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class IssuerFundamentalModel(Base):
    __tablename__ = "issuer_fundamentals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    isin_or_symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sector: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    fiscal_period: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    revenue_crore: Mapped[float | None] = mapped_column(Float, nullable=True)
    ebitda_crore: Mapped[float | None] = mapped_column(Float, nullable=True)
    pat_crore: Mapped[float | None] = mapped_column(Float, nullable=True)
    operating_margin_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    net_margin_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_debt_crore: Mapped[float | None] = mapped_column(Float, nullable=True)
    cash_crore: Mapped[float | None] = mapped_column(Float, nullable=True)
    roe_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, default="consolidated")
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class WatchlistModel(Base):
    __tablename__ = "watchlists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    staff_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    item_type: Mapped[str] = mapped_column(String(32), nullable=False)  # scheme, pms, instrument, issuer
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class ResearchNoteModel(Base):
    __tablename__ = "research_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    staff_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(50), nullable=False)


class ImportJobModel(Base):
    __tablename__ = "import_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    staff_id: Mapped[str] = mapped_column(String(36), nullable=False)
    import_type: Mapped[str] = mapped_column(String(64), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="preview")
    summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    errors_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    committed_at: Mapped[str | None] = mapped_column(String(50), nullable=True)


class AuditEventModel(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    staff_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[str] = mapped_column(String(50), nullable=False)


class CollectorRunModel(Base):
    __tablename__ = "collector_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    records_ingested: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[str] = mapped_column(String(50), nullable=False)
    completed_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
