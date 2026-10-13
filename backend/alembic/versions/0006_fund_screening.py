"""Fund Screening tables: managers, external quartiles, benchmark navs, metrics cache, presets, and runs.

Revision ID: screening_0006
Revises: backoffice_0005
Create Date: 2026-10-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "screening_0006"
down_revision: Union[str, None] = "backoffice_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. mf_managers
    if "mf_managers" not in tables:
        op.create_table(
            "mf_managers",
            sa.Column("scheme_code", sa.String(64), primary_key=True),
            sa.Column("manager_name", sa.String(120), nullable=False),
            sa.Column("manager_start", sa.String(20), nullable=True),
            sa.Column("source", sa.String(64), nullable=False, server_default="manual_import"),
            sa.Column("provenance", sa.String(64), nullable=False, server_default="manual"),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )

    # 2. mf_quartile_external
    if "mf_quartile_external" not in tables:
        op.create_table(
            "mf_quartile_external",
            sa.Column("scheme_code", sa.String(64), nullable=False),
            sa.Column("window_years", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("as_of", sa.String(20), nullable=False),
            sa.Column("quartile", sa.Integer(), nullable=False),
            sa.Column("source", sa.String(64), nullable=False),
            sa.Column("source_url", sa.String(255), nullable=True),
            sa.Column("fetched_at", sa.String(50), nullable=False),
            sa.PrimaryKeyConstraint("scheme_code", "window_years", "as_of"),
        )

    # 3. mf_benchmark_nav
    if "mf_benchmark_nav" not in tables:
        op.create_table(
            "mf_benchmark_nav",
            sa.Column("instrument_id", sa.String(64), nullable=False),
            sa.Column("date", sa.String(20), nullable=False),
            sa.Column("nav", sa.Float(), nullable=False),
            sa.Column("provenance", sa.String(64), nullable=False, server_default="imported"),
            sa.PrimaryKeyConstraint("instrument_id", "date"),
        )

    # 4. mf_screening_metrics
    if "mf_screening_metrics" not in tables:
        op.create_table(
            "mf_screening_metrics",
            sa.Column("scheme_code", sa.String(64), primary_key=True),
            sa.Column("as_of", sa.String(20), nullable=False),
            sa.Column("cat", sa.String(64), nullable=False),
            sa.Column("amc", sa.String(120), nullable=True),
            sa.Column("scheme_name", sa.String(255), nullable=False),
            sa.Column("manager_name", sa.String(120), nullable=True),
            sa.Column("manager_tenure_years", sa.Float(), nullable=True),
            sa.Column("tenure_ratio", sa.Float(), nullable=True),
            sa.Column("alpha", sa.Float(), nullable=True),
            sa.Column("beta", sa.Float(), nullable=True),
            sa.Column("std_dev", sa.Float(), nullable=True),
            sa.Column("r_squared", sa.Float(), nullable=True),
            sa.Column("information_ratio", sa.Float(), nullable=True),
            sa.Column("tracking_error", sa.Float(), nullable=True),
            sa.Column("treynor", sa.Float(), nullable=True),
            sa.Column("sharpe", sa.Float(), nullable=True),
            sa.Column("sortino", sa.Float(), nullable=True),
            sa.Column("up_capture", sa.Float(), nullable=True),
            sa.Column("down_capture", sa.Float(), nullable=True),
            sa.Column("max_drawdown", sa.Float(), nullable=True),
            sa.Column("expense_ratio", sa.Float(), nullable=True),
            sa.Column("ret_1y", sa.Float(), nullable=True),
            sa.Column("cagr_3y", sa.Float(), nullable=True),
            sa.Column("cagr_5y", sa.Float(), nullable=True),
            sa.Column("cagr_si", sa.Float(), nullable=True),
            sa.Column("bench_1y", sa.Float(), nullable=True),
            sa.Column("bench_3y", sa.Float(), nullable=True),
            sa.Column("bench_5y", sa.Float(), nullable=True),
            sa.Column("bench_si", sa.Float(), nullable=True),
            sa.Column("cat_avg_1y", sa.Float(), nullable=True),
            sa.Column("cat_avg_3y", sa.Float(), nullable=True),
            sa.Column("cat_avg_5y", sa.Float(), nullable=True),
            sa.Column("cat_avg_si", sa.Float(), nullable=True),
            sa.Column("quartile_2y", sa.Integer(), nullable=True),
            sa.Column("quartile_source", sa.String(64), nullable=True),
            sa.Column("rf_source", sa.String(64), nullable=True),
            sa.Column("benchmark_source", sa.String(64), nullable=True),
            sa.Column("history_years", sa.Float(), nullable=True),
            sa.Column("quality_flags", sa.String(120), nullable=True),
            sa.Column("provenance_json", sa.Text(), nullable=True),
        )
        op.create_index("ix_mf_screening_cat", "mf_screening_metrics", ["cat"])
        op.create_index("ix_mf_screening_amc", "mf_screening_metrics", ["amc"])

    # 5. screening_presets
    if "screening_presets" not in tables:
        op.create_table(
            "screening_presets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("filters_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_screening_presets_staff", "screening_presets", ["staff_id"])

    # 6. screening_runs
    if "screening_runs" not in tables:
        op.create_table(
            "screening_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("preset_id", sa.String(36), nullable=True),
            sa.Column("filters_json", sa.Text(), nullable=False),
            sa.Column("stage_counts_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_screening_runs_staff", "screening_runs", ["staff_id"])


def downgrade() -> None:
    op.drop_table("screening_runs")
    op.drop_table("screening_presets")
    op.drop_table("mf_screening_metrics")
    op.drop_table("mf_benchmark_nav")
    op.drop_table("mf_quartile_external")
    op.drop_table("mf_managers")
