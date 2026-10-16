"""Leads: sequential customer-facing serial number (sr_no), backfilled in created order.

Revision ID: lead_sr_no_0012
Revises: academy_0011
Create Date: 2026-10-16 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "lead_sr_no_0012"
down_revision: Union[str, None] = "academy_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "leads" not in insp.get_table_names():
        return
    if "sr_no" not in {c["name"] for c in insp.get_columns("leads")}:
        op.add_column("leads", sa.Column("sr_no", sa.Integer(), nullable=True))
    rows = bind.execute(sa.text("SELECT id FROM leads WHERE sr_no IS NULL ORDER BY created_at, id")).fetchall()
    start = bind.execute(sa.text("SELECT COALESCE(MAX(sr_no), 0) FROM leads")).scalar() or 0
    for i, (lead_id,) in enumerate(rows, start=start + 1):
        bind.execute(sa.text("UPDATE leads SET sr_no = :n WHERE id = :id"), {"n": i, "id": lead_id})
    if "ux_leads_sr_no" not in {i["name"] for i in insp.get_indexes("leads")}:
        op.create_index("ux_leads_sr_no", "leads", ["sr_no"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_leads_sr_no", table_name="leads")
    op.drop_column("leads", "sr_no")
