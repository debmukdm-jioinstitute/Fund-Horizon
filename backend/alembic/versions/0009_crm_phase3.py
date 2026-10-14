"""CRM phase 3: contacts, holdings, SIP schedules, commissions, campaigns, RM teams, suitability scoring.

Revision ID: crm_phase3_0009
Revises: crm_list_views_0008
Create Date: 2026-10-14 15:00:00.000000
"""

import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "crm_phase3_0009"
down_revision: Union[str, None] = "crm_list_views_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ADD_COLUMNS = {
    "opportunities": [("scheme_code", sa.String(32)), ("riskometer", sa.Integer()), ("suitability_note", sa.Text())],
    "activities": [("source_ref", sa.String(80))],
    "mandates": [("valid_until", sa.String(10))],
    "suitability_records": [
        ("score", sa.Float()), ("answers", sa.Text()), ("review_due", sa.String(10)), ("max_riskometer", sa.Integer()),
    ],
}
_RELATION = {"primary": "self", "spouse": "spouse", "child": "child", "dependent": "dependent"}


def _audit_cols():
    return [
        sa.Column("created_at", sa.String(50), nullable=False),
        sa.Column("updated_at", sa.String(50), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
    ]


# Money is integer paise; Postgres INTEGER overflows at ~₹2.1 crore, which a PMS ticket or an FD easily exceeds.
_WIDEN_TO_BIGINT = [
    ("opportunities", "amount"), ("opportunities", "won_amount"), ("fixed_deposits", "amount"),
    ("pms_accounts", "amount"), ("pms_accounts", "high_water_mark"), ("insurance_policies", "premium_amount"),
    ("mandates", "amount_cap"),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if bind.dialect.name == "postgresql":  # SQLite integers are already 64-bit
        for table, col in _WIDEN_TO_BIGINT:
            if table in tables and col in {c["name"] for c in insp.get_columns(table)}:
                op.alter_column(table, col, type_=sa.BigInteger(), existing_nullable=True)

    def create(name: str, *cols, indexes=()):
        if name in tables:
            return
        op.create_table(name, *cols)
        for idx_name, idx_cols in indexes:
            op.create_index(idx_name, name, idx_cols)

    create(
        "contacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("customer_id", sa.String(36), nullable=False, unique=True),
        sa.Column("household_id", sa.String(36), nullable=False),
        sa.Column("relation", sa.String(24), nullable=False, server_default="other"),
        sa.Column("dob", sa.String(10), nullable=True),
        sa.Column("guardian_contact_id", sa.String(36), nullable=True),
        sa.Column("tax_status", sa.String(12), nullable=False, server_default="resident"),
        sa.Column("country", sa.String(56), nullable=True),
        sa.Column("nre_bank", sa.String(120), nullable=True),
        sa.Column("nro_bank", sa.String(120), nullable=True),
        sa.Column("nominee_name", sa.String(120), nullable=True),
        sa.Column("nominee_relation", sa.String(40), nullable=True),
        sa.Column("nominee_pct", sa.Integer(), nullable=True),
        sa.Column("fatca_crs", sa.String(32), nullable=False, server_default="not_collected"),
        sa.Column("kyc_expiry", sa.String(10), nullable=True),
        *_audit_cols(),
        indexes=[("ix_contacts_household_id", ["household_id"])],
    )
    create(
        "holdings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("contact_id", sa.String(36), nullable=False),
        sa.Column("folio", sa.String(40), nullable=False),
        sa.Column("scheme_code", sa.String(32), nullable=False),
        sa.Column("scheme_name", sa.String(255), nullable=True),
        sa.Column("units", sa.Float(), nullable=False),
        sa.Column("cost_paise", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("as_of", sa.String(10), nullable=False),
        sa.Column("source", sa.String(40), nullable=True),
        *_audit_cols(),
        sa.UniqueConstraint("contact_id", "folio", "scheme_code", name="uq_holding_position"),
        indexes=[("ix_holdings_contact_id", ["contact_id"]), ("ix_holdings_scheme_code", ["scheme_code"])],
    )
    create(
        "sip_schedules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("contact_id", sa.String(36), nullable=False),
        sa.Column("scheme_code", sa.String(32), nullable=False),
        sa.Column("scheme_name", sa.String(255), nullable=True),
        sa.Column("type", sa.String(8), nullable=False, server_default="sip"),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("day", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.String(10), nullable=False),
        sa.Column("end_date", sa.String(10), nullable=True),
        sa.Column("mandate_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("bounce_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_bounce_at", sa.String(10), nullable=True),
        *_audit_cols(),
        indexes=[("ix_sip_schedules_contact_id", ["contact_id"]), ("ix_sip_schedules_mandate_id", ["mandate_id"])],
    )
    create(
        "commissions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("scheme_code", sa.String(32), nullable=False),
        sa.Column("folio", sa.String(40), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("contact_id", sa.String(36), nullable=True),
        sa.Column("household_id", sa.String(36), nullable=True),
        sa.Column("rm_id", sa.String(36), nullable=True),
        sa.Column("source", sa.String(80), nullable=True),
        sa.Column("created_at", sa.String(50), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.UniqueConstraint("folio", "scheme_code", "month", name="uq_commission_line"),
        indexes=[
            ("ix_commissions_scheme_code", ["scheme_code"]), ("ix_commissions_month", ["month"]),
            ("ix_commissions_contact_id", ["contact_id"]), ("ix_commissions_household_id", ["household_id"]),
            ("ix_commissions_rm_id", ["rm_id"]),
        ],
    )
    create(
        "campaigns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="draft"),
        sa.Column("segment", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("owner_id", sa.String(36), nullable=True),
        *_audit_cols(),
        indexes=[("ix_campaigns_owner_id", ["owner_id"])],
    )
    create(
        "campaign_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("campaign_id", sa.String(36), nullable=False),
        sa.Column("contact_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="targeted"),
        sa.Column("responded_at", sa.String(50), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(50), nullable=False),
        sa.Column("updated_at", sa.String(50), nullable=True),
        sa.UniqueConstraint("campaign_id", "contact_id", name="uq_campaign_member"),
        indexes=[("ix_campaign_members_campaign_id", ["campaign_id"]), ("ix_campaign_members_contact_id", ["contact_id"])],
    )
    create(
        "rm_teams",
        sa.Column("rm_id", sa.String(36), primary_key=True),
        sa.Column("lead_id", sa.String(36), nullable=False),
        indexes=[("ix_rm_teams_lead_id", ["lead_id"])],
    )

    for table, cols in _ADD_COLUMNS.items():
        if table not in tables:
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for name, type_ in cols:
            if name not in have:
                op.add_column(table, sa.Column(name, type_, nullable=True))
    if "activities" in tables and "ix_activities_source_ref" not in {i["name"] for i in insp.get_indexes("activities")}:
        op.create_index("ix_activities_source_ref", "activities", ["source_ref"])

    # every existing household member becomes a contact (one per customer)
    if "household_members" in tables:
        now = datetime.now(timezone.utc).isoformat()
        rows = bind.execute(
            sa.text(
                "SELECT m.customer_id, MIN(m.household_id), MIN(m.role) FROM household_members m "
                "WHERE m.customer_id NOT IN (SELECT customer_id FROM contacts) GROUP BY m.customer_id"
            )
        ).all()
        for customer_id, household_id, role in rows:
            bind.execute(
                sa.text(
                    "INSERT INTO contacts (id, customer_id, household_id, relation, tax_status, fatca_crs, created_at) "
                    "VALUES (:id, :c, :h, :r, 'resident', 'not_collected', :now)"
                ),
                {"id": uuid.uuid4().hex, "c": customer_id, "h": household_id, "r": _RELATION.get(role, "other"), "now": now},
            )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())
    for name in ("rm_teams", "campaign_members", "campaigns", "commissions", "sip_schedules", "holdings", "contacts"):
        if name in tables:
            op.drop_table(name)
    # added columns are kept on downgrade (dropping them is destructive)
