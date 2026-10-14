"""Flows dedup cleanup and unique index on (report_date, category, segment).

Revision ID: flows_0007
Revises: screening_0006
Create Date: 2026-10-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "flows_0007"
down_revision: Union[str, None] = "screening_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "flows" in tables:
        # 1. Clean up existing duplicate rows, keeping only the latest row per (report_date, category, segment)
        bind.execute(
            sa.text(
                """
                DELETE FROM flows
                WHERE id NOT IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY report_date, category, segment
                            ORDER BY created_at DESC, id DESC
                        ) AS rn
                        FROM flows
                    ) t
                    WHERE t.rn = 1
                )
                """
            )
        )

        # 2. Add unique index on (report_date, category, segment)
        existing_indices = [idx["name"] for idx in inspector.get_indexes("flows")]
        if "uq_flows_date_cat_seg" not in existing_indices:
            op.create_index(
                "uq_flows_date_cat_seg",
                "flows",
                ["report_date", "category", "segment"],
                unique=True,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if "flows" in tables:
        existing_indices = [idx["name"] for idx in inspector.get_indexes("flows")]
        if "uq_flows_date_cat_seg" in existing_indices:
            op.drop_index("uq_flows_date_cat_seg", table_name="flows")
