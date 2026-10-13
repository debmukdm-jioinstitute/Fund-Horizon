"""Internal Backoffice tables: staff fields, registries, observations, derivatives, flows, PMS strategies, valuations.

Revision ID: backoffice_0005
Revises: crm_products_0004
Create Date: 2026-10-13 11:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "backoffice_0005"
down_revision: Union[str, None] = "crm_products_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Staff columns on customers
    if "customers" in tables:
        cust_cols = [c["name"] for c in inspector.get_columns("customers")]
        if "is_staff" not in cust_cols:
            op.add_column("customers", sa.Column("is_staff", sa.Integer(), server_default="0", nullable=False))
        if "status" not in cust_cols:
            op.add_column("customers", sa.Column("status", sa.String(16), server_default="active", nullable=False))
        if "must_change_password" not in cust_cols:
            op.add_column("customers", sa.Column("must_change_password", sa.Integer(), server_default="0", nullable=False))
        if "revoked_before" not in cust_cols:
            op.add_column("customers", sa.Column("revoked_before", sa.String(50), nullable=True))

    # 2. source_registry
    if "source_registry" not in tables:
        op.create_table(
            "source_registry",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("official_docs_url", sa.String(255), nullable=True),
            sa.Column("adapter_id", sa.String(64), nullable=False),
            sa.Column("adapter_version", sa.String(32), server_default="1.0.0", nullable=False),
            sa.Column("terms_notes", sa.Text(), nullable=True),
            sa.Column("configured_permissions", sa.String(120), server_default="public_view_only", nullable=False),
            sa.Column("enabled", sa.Integer(), server_default="1", nullable=False),
            sa.Column("rate_budget", sa.Integer(), server_default="60", nullable=False),
            sa.Column("timezone", sa.String(64), server_default="Asia/Kolkata", nullable=False),
            sa.Column("supported_frequency", sa.String(32), server_default="daily", nullable=False),
            sa.Column("health_status", sa.String(32), server_default="ready", nullable=False),
            sa.Column("last_attempt_at", sa.String(50), nullable=True),
            sa.Column("last_success_at", sa.String(50), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )

    # 3. instrument_registry
    if "instrument_registry" not in tables:
        op.create_table(
            "instrument_registry",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("exchange", sa.String(32), server_default="NSE", nullable=False),
            sa.Column("symbol", sa.String(64), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("asset_class", sa.String(32), nullable=False),
            sa.Column("currency", sa.String(8), server_default="INR", nullable=False),
            sa.Column("base_currency", sa.String(8), nullable=True),
            sa.Column("quote_currency", sa.String(8), nullable=True),
            sa.Column("unit", sa.String(32), server_default="index_pts", nullable=False),
            sa.Column("source_id", sa.String(64), nullable=False),
            sa.Column("source_identifier", sa.String(120), nullable=True),
            sa.Column("contract_convention", sa.String(64), nullable=True),
            sa.Column("valid_from", sa.String(10), nullable=True),
            sa.Column("valid_to", sa.String(10), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_inst_symbol", "instrument_registry", ["symbol"])
        op.create_index("ix_inst_source", "instrument_registry", ["source_id"])

    # 4. observations
    if "observations" not in tables:
        op.create_table(
            "observations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("instrument_id", sa.String(64), nullable=False),
            sa.Column("observed_at", sa.String(50), nullable=False),
            sa.Column("reference_period", sa.String(32), nullable=True),
            sa.Column("published_at", sa.String(50), nullable=True),
            sa.Column("fetched_at", sa.String(50), nullable=False),
            sa.Column("value_numeric", sa.Float(), nullable=True),
            sa.Column("value_text", sa.String(120), nullable=True),
            sa.Column("frequency", sa.String(32), server_default="daily", nullable=False),
            sa.Column("vintage", sa.String(32), server_default="initial", nullable=False),
            sa.Column("provenance", sa.String(64), server_default="automated", nullable=False),
            sa.Column("quality_flags", sa.String(64), server_default="ok", nullable=False),
            sa.Column("raw_hash", sa.String(64), nullable=True),
            sa.UniqueConstraint("instrument_id", "observed_at", "vintage", "provenance", name="uq_observation"),
        )
        op.create_index("ix_obs_inst_observed", "observations", ["instrument_id", "observed_at"])

    # 5. option_snapshots
    if "option_snapshots" not in tables:
        op.create_table(
            "option_snapshots",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("exchange", sa.String(32), nullable=False),
            sa.Column("underlying_symbol", sa.String(32), nullable=False),
            sa.Column("underlying_price", sa.Float(), nullable=True),
            sa.Column("snapshot_timestamp", sa.String(50), nullable=False),
            sa.Column("fetched_at", sa.String(50), nullable=False),
            sa.Column("source", sa.String(64), nullable=False),
            sa.Column("pcr_oi", sa.Float(), nullable=True),
            sa.Column("pcr_volume", sa.Float(), nullable=True),
            sa.Column("total_call_oi", sa.Integer(), nullable=True),
            sa.Column("total_put_oi", sa.Integer(), nullable=True),
            sa.Column("total_call_volume", sa.Integer(), nullable=True),
            sa.Column("total_put_volume", sa.Integer(), nullable=True),
        )
        op.create_index("ix_opt_snap_underlying", "option_snapshots", ["underlying_symbol"])
        op.create_index("ix_opt_snap_time", "option_snapshots", ["snapshot_timestamp"])

    # 6. option_contracts
    if "option_contracts" not in tables:
        op.create_table(
            "option_contracts",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("snapshot_id", sa.String(36), nullable=False),
            sa.Column("exchange", sa.String(32), nullable=False),
            sa.Column("underlying_symbol", sa.String(32), nullable=False),
            sa.Column("expiry_date", sa.String(10), nullable=False),
            sa.Column("strike_price", sa.Float(), nullable=False),
            sa.Column("option_type", sa.String(4), nullable=False),
            sa.Column("contract_id", sa.String(64), nullable=True),
            sa.Column("lot_size", sa.Integer(), server_default="1", nullable=False),
            sa.Column("last_price", sa.Float(), nullable=True),
            sa.Column("oi", sa.Integer(), server_default="0", nullable=False),
            sa.Column("oi_change", sa.Integer(), server_default="0", nullable=False),
            sa.Column("volume", sa.Integer(), server_default="0", nullable=False),
            sa.Column("implied_vol", sa.Float(), nullable=True),
        )
        op.create_index("ix_opt_contract_snap", "option_contracts", ["snapshot_id"])
        op.create_index("ix_opt_contract_exp", "option_contracts", ["expiry_date"])

    # 7. flows
    if "flows" not in tables:
        op.create_table(
            "flows",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_id", sa.String(64), nullable=False),
            sa.Column("report_date", sa.String(10), nullable=False),
            sa.Column("category", sa.String(32), nullable=False),
            sa.Column("segment", sa.String(32), nullable=False),
            sa.Column("gross_buy", sa.Float(), nullable=False),
            sa.Column("gross_sell", sa.Float(), nullable=False),
            sa.Column("net", sa.Float(), nullable=False),
            sa.Column("unit", sa.String(32), server_default="inr_crore", nullable=False),
            sa.Column("status", sa.String(16), server_default="provisional", nullable=False),
            sa.Column("vintage", sa.String(32), server_default="initial", nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_flows_date_cat", "flows", ["report_date", "category"])

    # 8. pms_strategy_observations
    if "pms_strategy_observations" not in tables:
        op.create_table(
            "pms_strategy_observations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("provider", sa.String(120), nullable=False),
            sa.Column("strategy_name", sa.String(120), nullable=False),
            sa.Column("approach", sa.String(64), nullable=True),
            sa.Column("category", sa.String(64), nullable=True),
            sa.Column("report_month", sa.String(7), nullable=False),
            sa.Column("aum_crore", sa.Float(), nullable=True),
            sa.Column("return_1m", sa.Float(), nullable=True),
            sa.Column("return_3m", sa.Float(), nullable=True),
            sa.Column("return_6m", sa.Float(), nullable=True),
            sa.Column("return_1y", sa.Float(), nullable=True),
            sa.Column("cagr_3y", sa.Float(), nullable=True),
            sa.Column("cagr_5y", sa.Float(), nullable=True),
            sa.Column("cagr_since_inception", sa.Float(), nullable=True),
            sa.Column("inception_date", sa.String(10), nullable=True),
            sa.Column("benchmark_name", sa.String(120), nullable=True),
            sa.Column("benchmark_return_1y", sa.Float(), nullable=True),
            sa.Column("fee_structure_desc", sa.String(255), nullable=True),
            sa.Column("source", sa.String(64), server_default="APMI", nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_pms_strat_provider", "pms_strategy_observations", ["provider"])
        op.create_index("ix_pms_strat_month", "pms_strategy_observations", ["report_month"])

    # 9. portfolio_positions
    if "portfolio_positions" not in tables:
        op.create_table(
            "portfolio_positions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36), nullable=False),
            sa.Column("valuation_date", sa.String(10), nullable=False),
            sa.Column("security_type", sa.String(32), nullable=False),
            sa.Column("symbol_or_isin", sa.String(32), nullable=False),
            sa.Column("security_name", sa.String(255), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("cost_price_paise", sa.Integer(), nullable=True),
            sa.Column("market_price_paise", sa.Integer(), nullable=True),
            sa.Column("market_value_paise", sa.Integer(), nullable=False),
            sa.Column("weight_pct", sa.Float(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_port_pos_account", "portfolio_positions", ["account_id", "valuation_date"])

    # 10. portfolio_cashflows
    if "portfolio_cashflows" not in tables:
        op.create_table(
            "portfolio_cashflows",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36), nullable=False),
            sa.Column("flow_date", sa.String(10), nullable=False),
            sa.Column("flow_type", sa.String(32), nullable=False),
            sa.Column("amount_paise", sa.Integer(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_port_flow_account", "portfolio_cashflows", ["account_id", "flow_date"])

    # 11. portfolio_valuations
    if "portfolio_valuations" not in tables:
        op.create_table(
            "portfolio_valuations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36), nullable=False),
            sa.Column("valuation_date", sa.String(10), nullable=False),
            sa.Column("nav_per_unit", sa.Float(), nullable=True),
            sa.Column("total_units", sa.Float(), nullable=True),
            sa.Column("total_value_paise", sa.Integer(), nullable=False),
            sa.Column("cash_balance_paise", sa.Integer(), server_default="0", nullable=False),
            sa.Column("fees_accrued_paise", sa.Integer(), server_default="0", nullable=False),
            sa.Column("holdings_coverage_pct", sa.Float(), server_default="100.0", nullable=False),
            sa.Column("xirr_pct", sa.Float(), nullable=True),
            sa.Column("twr_pct", sa.Float(), nullable=True),
            sa.Column("source", sa.String(64), server_default="statement_import", nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_port_val_account", "portfolio_valuations", ["account_id", "valuation_date"])

    # 12. fund_holdings
    if "fund_holdings" not in tables:
        op.create_table(
            "fund_holdings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("scheme_code", sa.String(32), nullable=False),
            sa.Column("disclosure_date", sa.String(10), nullable=False),
            sa.Column("isin", sa.String(32), nullable=True),
            sa.Column("company_name", sa.String(255), nullable=False),
            sa.Column("sector", sa.String(120), nullable=True),
            sa.Column("asset_class", sa.String(32), server_default="equity", nullable=False),
            sa.Column("weight_pct", sa.Float(), nullable=False),
            sa.Column("rating", sa.String(32), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_fund_holdings_scheme", "fund_holdings", ["scheme_code", "disclosure_date"])

    # 13. issuer_fundamentals
    if "issuer_fundamentals" not in tables:
        op.create_table(
            "issuer_fundamentals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("isin_or_symbol", sa.String(32), nullable=False),
            sa.Column("company_name", sa.String(255), nullable=False),
            sa.Column("sector", sa.String(120), nullable=True),
            sa.Column("fiscal_period", sa.String(32), nullable=False),
            sa.Column("revenue_crore", sa.Float(), nullable=True),
            sa.Column("ebitda_crore", sa.Float(), nullable=True),
            sa.Column("pat_crore", sa.Float(), nullable=True),
            sa.Column("operating_margin_pct", sa.Float(), nullable=True),
            sa.Column("net_margin_pct", sa.Float(), nullable=True),
            sa.Column("total_debt_crore", sa.Float(), nullable=True),
            sa.Column("cash_crore", sa.Float(), nullable=True),
            sa.Column("roe_pct", sa.Float(), nullable=True),
            sa.Column("pe_ratio", sa.Float(), nullable=True),
            sa.Column("scope", sa.String(32), server_default="consolidated", nullable=False),
            sa.Column("source", sa.String(64), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_fundamentals_symbol", "issuer_fundamentals", ["isin_or_symbol", "fiscal_period"])

    # 14. watchlists
    if "watchlists" not in tables:
        op.create_table(
            "watchlists",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("item_type", sa.String(32), nullable=False),
            sa.Column("item_id", sa.String(64), nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_watchlist_staff", "watchlists", ["staff_id"])

    # 15. research_notes
    if "research_notes" not in tables:
        op.create_table(
            "research_notes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("entity_type", sa.String(32), nullable=False),
            sa.Column("entity_id", sa.String(64), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("tags", sa.String(255), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_notes_entity", "research_notes", ["entity_type", "entity_id"])

    # 16. import_jobs
    if "import_jobs" not in tables:
        op.create_table(
            "import_jobs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("import_type", sa.String(64), nullable=False),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("total_rows", sa.Integer(), server_default="0", nullable=False),
            sa.Column("valid_rows", sa.Integer(), server_default="0", nullable=False),
            sa.Column("error_rows", sa.Integer(), server_default="0", nullable=False),
            sa.Column("status", sa.String(32), server_default="preview", nullable=False),
            sa.Column("summary_json", sa.Text(), nullable=True),
            sa.Column("errors_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("committed_at", sa.String(50), nullable=True),
        )

    # 17. audit_events
    if "audit_events" not in tables:
        op.create_table(
            "audit_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=True),
            sa.Column("action", sa.String(64), nullable=False),
            sa.Column("target_type", sa.String(64), nullable=False),
            sa.Column("target_id", sa.String(64), nullable=True),
            sa.Column("details_json", sa.Text(), nullable=True),
            sa.Column("ip_address", sa.String(64), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )

    # 18. collector_runs
    if "collector_runs" not in tables:
        op.create_table(
            "collector_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_id", sa.String(64), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("records_ingested", sa.Integer(), server_default="0", nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), server_default="0", nullable=False),
            sa.Column("started_at", sa.String(50), nullable=False),
            sa.Column("completed_at", sa.String(50), nullable=True),
        )


def downgrade() -> None:
    # Downgrade drops backoffice tables if rolled back
    for tbl in [
        "collector_runs", "audit_events", "import_jobs", "research_notes",
        "watchlists", "issuer_fundamentals", "fund_holdings",
        "portfolio_valuations", "portfolio_cashflows", "portfolio_positions",
        "pms_strategy_observations", "flows", "option_contracts",
        "option_snapshots", "observations", "instrument_registry",
        "source_registry",
    ]:
        op.drop_table(tbl)
