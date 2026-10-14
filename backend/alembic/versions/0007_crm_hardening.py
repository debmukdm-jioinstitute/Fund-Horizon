"""CRM hardening: audit_log, audit columns, lead conversion + opportunity close fields, indexes, unique keys.

Revision ID: crm_hardening_0007
Revises: screening_0006
Create Date: 2026-10-14 09:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "crm_hardening_0007"
down_revision: Union[str, None] = "screening_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_AUDIT = [("created_by", sa.String(36)), ("updated_by", sa.String(36))]
_UPDATED_AT = ("updated_at", sa.String(50))

# table -> extra columns (audit columns are added to every table below)
_CORE_COLUMNS: dict[str, list[tuple[str, sa.types.TypeEngine]]] = {
    "households": [_UPDATED_AT, *_AUDIT],
    "leads": [
        ("converted_household_id", sa.String(36)),
        ("converted_at", sa.String(50)),
        _UPDATED_AT,
        *_AUDIT,
    ],
    "opportunities": [
        ("lost_reason", sa.Text()),
        ("closed_at", sa.String(50)),
        ("won_amount", sa.Integer()),
        *_AUDIT,
    ],
    "activities": [_UPDATED_AT, *_AUDIT],
    "cases": [_UPDATED_AT, *_AUDIT],
}
_PRODUCT_TABLES = (
    "insurance_policies",
    "fixed_deposits",
    "pms_accounts",
    "kyc_records",
    "mandates",
    "consents",
    "suitability_records",
    "disclosure_logs",
)
_INDEXES = [
    ("ix_households_rm_id", "households", ["rm_id"]),
    ("ix_opportunities_assigned_rm_id", "opportunities", ["assigned_rm_id"]),
    ("ix_leads_email", "leads", ["email"]),
    ("ix_leads_mobile", "leads", ["mobile"]),
    ("ix_cases_sla_due_at", "cases", ["sla_due_at"]),
]
_UNIQUE = [
    ("uq_mandates_umrn", "mandates", "umrn"),
    ("uq_policies_policy_no", "insurance_policies", "policy_no"),
]


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "audit_log" not in tables:
        op.create_table(
            "audit_log",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("entity", sa.String(32), nullable=False),
            sa.Column("entity_id", sa.String(36), nullable=False),
            sa.Column("field", sa.String(64), nullable=False),
            sa.Column("old", sa.Text(), nullable=True),
            sa.Column("new", sa.Text(), nullable=True),
            sa.Column("actor_id", sa.String(36), nullable=True),
            sa.Column("at", sa.String(50), nullable=False),
        )
        op.create_index("ix_audit_log_entity", "audit_log", ["entity"])
        op.create_index("ix_audit_log_entity_id", "audit_log", ["entity_id"])

    for table, cols in _CORE_COLUMNS.items():
        if table not in tables:
            continue
        have = _columns(inspector, table)
        for name, type_ in cols:
            if name not in have:
                op.add_column(table, sa.Column(name, type_, nullable=True))

    for table in _PRODUCT_TABLES:
        if table not in tables:
            continue
        have = _columns(inspector, table)
        for name, type_ in [_UPDATED_AT, *_AUDIT]:
            if name not in have:
                op.add_column(table, sa.Column(name, type_, nullable=True))

    # Stages now end in "won": fold the old per-line terminal stages into it.
    if "opportunities" in tables:
        op.execute(
            "UPDATE opportunities SET stage = 'won', closed_at = COALESCE(closed_at, updated_at), "
            "won_amount = COALESCE(won_amount, amount) WHERE stage IN ('closed', 'renewed', 'reinvested')"
        )

    for name, table, cols in _INDEXES:
        if table in tables and not any(name == i["name"] for i in inspector.get_indexes(table)):
            op.create_index(name, table, cols)

    for name, table, col in _UNIQUE:
        if table in tables and not any(name == i["name"] for i in inspector.get_indexes(table)):
            # Blank strings are normalised to NULL by the API, and NULLs never collide.
            op.execute(f"UPDATE {table} SET {col} = NULL WHERE {col} = ''")
            dup = bind.execute(
                sa.text(f"SELECT {col} FROM {table} WHERE {col} IS NOT NULL GROUP BY {col} HAVING COUNT(*) > 1 LIMIT 1")
            ).first()
            if dup:
                # Never block startup on legacy data: leave the key unprotected until the duplicates are cleaned up.
                print(f"WARNING: skipping unique index {name}: duplicate {table}.{col} values exist")
                continue
            op.create_index(name, table, [col], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    for name, table, _ in _UNIQUE:
        if table in tables and any(name == i["name"] for i in inspector.get_indexes(table)):
            op.drop_index(name, table_name=table)
    for name, table, _ in _INDEXES:
        if table in tables and any(name == i["name"] for i in inspector.get_indexes(table)):
            op.drop_index(name, table_name=table)

    # Columns are kept on downgrade (dropping audit data is destructive); only the audit table is removed.
    if "audit_log" in tables:
        op.drop_table("audit_log")
