"""CRM products & compliance tables (W2): insurance policies, FDs, PMS, KYC,
mandates, consents, suitability records, disclosure logs.

Revision ID: crm_products_0004
Revises: crm_core_0003
Create Date: 2026-10-12 22:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "crm_products_0004"
down_revision: Union[str, None] = "crm_core_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "insurance_policies" not in tables:
        op.create_table(
            "insurance_policies",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), nullable=True),
            sa.Column("customer_id", sa.String(36), nullable=True),
            sa.Column("policy_type", sa.String(32), nullable=False),
            sa.Column("insurer", sa.String(120), nullable=True),
            sa.Column("policy_no", sa.String(64), nullable=True),
            sa.Column("premium_amount", sa.Integer, nullable=True),
            sa.Column("premium_due_date", sa.String(10), nullable=True),
            sa.Column("renewal_date", sa.String(10), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
    if "fixed_deposits" not in tables:
        op.create_table(
            "fixed_deposits",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), nullable=True),
            sa.Column("customer_id", sa.String(36), nullable=True),
            sa.Column("company", sa.String(120), nullable=True),
            sa.Column("amount", sa.Integer, nullable=True),
            sa.Column("interest_rate", sa.Float, nullable=True),
            sa.Column("start_date", sa.String(10), nullable=True),
            sa.Column("maturity_date", sa.String(10), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
    if "pms_accounts" not in tables:
        op.create_table(
            "pms_accounts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), nullable=True),
            sa.Column("customer_id", sa.String(36), nullable=True),
            sa.Column("provider", sa.String(120), nullable=True),
            sa.Column("agreement_date", sa.String(10), nullable=True),
            sa.Column("amount", sa.Integer, nullable=True),
            sa.Column("fee_fixed_pct", sa.Float, nullable=True),
            sa.Column("fee_performance_pct", sa.Float, nullable=True),
            sa.Column("hurdle_pct", sa.Float, nullable=True),
            sa.Column("high_water_mark", sa.Integer, nullable=False, server_default="0"),
            sa.Column("exit_load_pct", sa.Float, nullable=True),
            sa.Column("disclosure_doc_version", sa.String(32), nullable=True),
            sa.Column("disclosure_given_at", sa.String(10), nullable=True),
            sa.Column("fee_acknowledged_at", sa.String(10), nullable=True),
            sa.Column("reporting_cycle", sa.String(16), nullable=False, server_default="quarterly"),
            sa.Column("last_report_at", sa.String(10), nullable=True),
            sa.Column("accredited_investor", sa.Integer, nullable=False, server_default="0"),
            sa.Column("status", sa.String(16), nullable=False, server_default="prospect"),
            sa.Column("created_at", sa.String(50), nullable=False),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
    if "kyc_records" not in tables:
        op.create_table(
            "kyc_records",
            sa.Column("customer_id", sa.String(36), primary_key=True),
            sa.Column("pan_last4", sa.String(4), nullable=True),
            sa.Column("kra_status", sa.String(16), nullable=False, server_default="unknown"),
            sa.Column("ckyc_id", sa.String(32), nullable=True),
            sa.Column("updated_at", sa.String(50), nullable=False),
        )
    if "mandates" not in tables:
        op.create_table(
            "mandates",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("umrn", sa.String(64), nullable=True),
            sa.Column("bank_name", sa.String(120), nullable=True),
            sa.Column("amount_cap", sa.Integer, nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="registered"),
            sa.Column("created_at", sa.String(50), nullable=False),
        )
    if "consents" not in tables:
        op.create_table(
            "consents",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("purpose", sa.String(32), nullable=False),
            sa.Column("granted", sa.Integer, nullable=False),
            sa.Column("notice_version", sa.String(32), nullable=True),
            sa.Column("granted_at", sa.String(50), nullable=True),
            sa.Column("withdrawn_at", sa.String(50), nullable=True),
            sa.UniqueConstraint("customer_id", "purpose", name="uq_consent_customer_purpose"),
        )
    if "suitability_records" not in tables:
        op.create_table(
            "suitability_records",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("financial_status", sa.Text, nullable=True),
            sa.Column("investment_experience", sa.Text, nullable=True),
            sa.Column("objectives", sa.Text, nullable=True),
            sa.Column("risk_band", sa.String(32), nullable=True),
            sa.Column("recorded_by_rm_id", sa.String(36), nullable=True),
            sa.Column("recorded_at", sa.String(50), nullable=False),
        )
    if "disclosure_logs" not in tables:
        op.create_table(
            "disclosure_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("customer_id", sa.String(36), nullable=False),
            sa.Column("opportunity_id", sa.String(36), nullable=True),
            sa.Column("schemes_compared", sa.Text, nullable=True),
            sa.Column("commissions_disclosed", sa.Text, nullable=True),
            sa.Column("regular_plan_noted", sa.Integer, nullable=False, server_default="0"),
            sa.Column("created_at", sa.String(50), nullable=False),
        )


def downgrade() -> None:
    for table in (
        "disclosure_logs",
        "suitability_records",
        "consents",
        "mandates",
        "kyc_records",
        "pms_accounts",
        "fixed_deposits",
        "insurance_policies",
    ):
        op.drop_table(table)
