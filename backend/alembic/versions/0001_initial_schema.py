"""Initial schema for plans, cas_sessions, funds, metrics, and nav_monthly.

Revision ID: 0001_initial_schema
Revises: None
Create Date: 2026-10-10 18:35:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "plans" not in tables:
        op.create_table(
            "plans",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("request", sa.Text(), nullable=False),
            sa.Column("result", sa.Text(), nullable=False),
        )

    if "cas_sessions" not in tables:
        op.create_table(
            "cas_sessions",
            sa.Column("session_id", sa.String(36), primary_key=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("investor_name", sa.String(120), nullable=True),
            sa.Column("total_value", sa.Float(), nullable=False, server_default="0.0"),
            sa.Column("xirr", sa.Float(), nullable=True),
            sa.Column("payload", sa.Text(), nullable=False),
        )

    if "funds" not in tables:
        op.create_table(
            "funds",
            sa.Column("scheme_code", sa.String(32), primary_key=True),
            sa.Column("scheme_name", sa.String(255), nullable=False),
            sa.Column("amc", sa.String(120), nullable=False),
            sa.Column("category", sa.String(120), nullable=False),
            sa.Column("plan", sa.String(32), nullable=False, server_default="Regular"),
            sa.Column("option", sa.String(32), nullable=False, server_default="Growth"),
            sa.Column("isin", sa.String(32), nullable=True),
            sa.Column("latest_nav", sa.Float(), nullable=True),
            sa.Column("latest_nav_date", sa.String(32), nullable=True),
            sa.Column("data_quality", sa.String(32), nullable=False, server_default="ok"),
        )

    if "metrics" not in tables:
        op.create_table(
            "metrics",
            sa.Column("scheme_code", sa.String(32), primary_key=True),
            sa.Column("ret_1m", sa.Float(), nullable=True),
            sa.Column("ret_3m", sa.Float(), nullable=True),
            sa.Column("ret_6m", sa.Float(), nullable=True),
            sa.Column("ret_1y", sa.Float(), nullable=True),
            sa.Column("cagr_3y", sa.Float(), nullable=True),
            sa.Column("cagr_5y", sa.Float(), nullable=True),
            sa.Column("cagr_7y", sa.Float(), nullable=True),
            sa.Column("cagr_10y", sa.Float(), nullable=True),
            sa.Column("vol_3y", sa.Float(), nullable=True),
            sa.Column("sharpe_3y", sa.Float(), nullable=True),
            sa.Column("sortino_3y", sa.Float(), nullable=True),
            sa.Column("max_drawdown_3y", sa.Float(), nullable=True),
            sa.Column("max_drawdown_all", sa.Float(), nullable=True),
            sa.Column("data_asof", sa.String(32), nullable=False, server_default="2026-10-09"),
        )

    if "nav_monthly" not in tables:
        op.create_table(
            "nav_monthly",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("scheme_code", sa.String(32), nullable=False),
            sa.Column("date", sa.String(32), nullable=False),
            sa.Column("nav", sa.Float(), nullable=False),
        )
        op.create_index("ix_nav_monthly_scheme_code", "nav_monthly", ["scheme_code"])
        op.create_index("ix_nav_monthly_date", "nav_monthly", ["date"])



def downgrade() -> None:
    op.drop_index("ix_nav_monthly_date", table_name="nav_monthly")
    op.drop_index("ix_nav_monthly_scheme_code", table_name="nav_monthly")
    op.drop_table("nav_monthly")
    op.drop_table("metrics")
    op.drop_table("funds")
    op.drop_table("cas_sessions")
    op.drop_table("plans")
