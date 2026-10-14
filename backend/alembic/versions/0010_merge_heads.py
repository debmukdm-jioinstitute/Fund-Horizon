"""Merge the CRM phase 3 and flows dedup branches (both descend from crm_list_views_0008).

Revision ID: merge_0010
Revises: crm_phase3_0009, flows_0009
Create Date: 2026-10-14 15:00:00.000000
"""
from typing import Sequence, Union

revision: str = "merge_0010"
down_revision: Union[str, Sequence[str], None] = ("crm_phase3_0009", "flows_0009")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
