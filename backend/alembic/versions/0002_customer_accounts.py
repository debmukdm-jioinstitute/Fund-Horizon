"""Customer accounts: customers/sessions tables and plans.customer_id.

Revision ID: 0002_customer_accounts
Revises: 0001_initial_schema
Create Date: 2026-10-12 01:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_customer_accounts"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "customer_id" not in [c["name"] for c in inspector.get_columns("plans")]:
        op.add_column("plans", sa.Column("customer_id", sa.String(36), nullable=True))

    if "customers" not in tables:
        op.create_table(
            "customers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("email", sa.String(255), nullable=False, unique=True),
            sa.Column("mobile", sa.String(16), nullable=False, unique=True),
            sa.Column("password_hash", sa.String(255), nullable=False),
            sa.Column("role", sa.String(16), nullable=False, server_default="customer"),
            sa.Column("assigned_rm_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
        )

    if "sessions" not in tables:
        op.create_table(
            "sessions",
            sa.Column("token_sha256", sa.String(64), primary_key=True),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("expires_at", sa.String(50), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_table("customers")
    # batch mode: SQLite cannot DROP COLUMN directly.
    with op.batch_alter_table("plans") as batch_op:
        batch_op.drop_column("customer_id")
