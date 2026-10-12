"""CRM core tables: households, household_members, leads, opportunities, activities, cases.

Revision ID: crm_core_0003
Revises: 0002_customer_accounts
Create Date: 2026-10-12 22:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "crm_core_0003"
down_revision: Union[str, None] = "0002_customer_accounts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "households" not in tables:
        op.create_table(
            "households",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("primary_customer_id", sa.String(36), nullable=True),
            sa.Column("rm_id", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )

    if "household_members" not in tables:
        op.create_table(
            "household_members",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), nullable=False),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("role", sa.String(16), nullable=False, server_default="other"),
            sa.UniqueConstraint("household_id", "customer_id", name="uq_household_member"),
        )
        op.create_index("ix_household_members_household", "household_members", ["household_id"])
        op.create_index("ix_household_members_customer", "household_members", ["customer_id"])

    if "leads" not in tables:
        op.create_table(
            "leads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("email", sa.String(255), nullable=True),
            sa.Column("mobile", sa.String(16), nullable=True),
            sa.Column("source", sa.String(32), nullable=False, server_default="other"),
            sa.Column("status", sa.String(16), nullable=False, server_default="new"),
            sa.Column("assigned_rm_id", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_leads_status", "leads", ["status"])
        op.create_index("ix_leads_assigned_rm", "leads", ["assigned_rm_id"])

    if "opportunities" not in tables:
        op.create_table(
            "opportunities",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), nullable=True),
            sa.Column("customer_id", sa.String(36), nullable=True),
            sa.Column("product_line", sa.String(32), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("amount", sa.Integer(), nullable=True),
            sa.Column("stage", sa.String(32), nullable=False),
            sa.Column("probability", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("expected_close", sa.String(10), nullable=True),
            sa.Column("assigned_rm_id", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_opportunities_household", "opportunities", ["household_id"])
        op.create_index("ix_opportunities_line_stage", "opportunities", ["product_line", "stage"])

    if "activities" not in tables:
        op.create_table(
            "activities",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("subject", sa.String(255), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("household_id", sa.String(36), nullable=True),
            sa.Column("customer_id", sa.String(36), nullable=True),
            sa.Column("opportunity_id", sa.String(36), nullable=True),
            sa.Column("case_id", sa.String(36), nullable=True),
            sa.Column("policy_id", sa.String(36), nullable=True),
            sa.Column("fd_id", sa.String(36), nullable=True),
            sa.Column("due_at", sa.String(50), nullable=True),
            sa.Column("done_at", sa.String(50), nullable=True),
            sa.Column("assigned_rm_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_activities_assigned", "activities", ["assigned_rm_id"])
        op.create_index("ix_activities_household", "activities", ["household_id"])
        op.create_index("ix_activities_due", "activities", ["due_at"])
        op.create_index("ix_activities_policy", "activities", ["policy_id"])
        op.create_index("ix_activities_fd", "activities", ["fd_id"])

    if "cases" not in tables:
        op.create_table(
            "cases",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("category", sa.String(32), nullable=False),
            sa.Column("subject", sa.String(255), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("status", sa.String(24), nullable=False, server_default="open"),
            sa.Column("sla_due_at", sa.String(50), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("resolved_at", sa.String(50), nullable=True),
        )
        op.create_index("ix_cases_customer", "cases", ["customer_id"])
        op.create_index("ix_cases_status", "cases", ["status"])


def downgrade() -> None:
    op.drop_table("cases")
    op.drop_table("activities")
    op.drop_table("opportunities")
    op.drop_table("leads")
    op.drop_table("household_members")
    op.drop_table("households")
