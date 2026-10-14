"""CRM saved list views (per-user filters + columns for the Salesforce-style list pages).

Revision ID: crm_list_views_0008
Revises: crm_hardening_0007
Create Date: 2026-10-14 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "crm_list_views_0008"
down_revision: Union[str, None] = "crm_hardening_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    # activities can now hang off a lead (timeline + composer on the lead record page)
    if "activities" in inspector.get_table_names() and "lead_id" not in {c["name"] for c in inspector.get_columns("activities")}:
        op.add_column("activities", sa.Column("lead_id", sa.String(36), nullable=True))
        op.create_index("ix_activities_lead_id", "activities", ["lead_id"])
    if "crm_list_views" in inspector.get_table_names():
        return
    op.create_table(
        "crm_list_views",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("entity", sa.String(32), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("filters", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("columns", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("is_default", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(50), nullable=False),
        sa.Column("updated_at", sa.String(50), nullable=False),
        sa.UniqueConstraint("user_id", "entity", "name", name="uq_crm_list_view_name"),
    )
    op.create_index("ix_crm_list_views_user_id", "crm_list_views", ["user_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "crm_list_views" in inspector.get_table_names():
        op.drop_table("crm_list_views")
