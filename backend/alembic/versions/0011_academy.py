"""FH Academy: lesson progress, quiz attempts, FSRS card state, XP events, badges and preferences.

Revision ID: academy_0011
Revises: merge_0010
Create Date: 2026-10-14 17:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "academy_0011"
down_revision: Union[str, None] = "merge_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    have = set(sa.inspect(op.get_bind()).get_table_names())
    if "learn_progress" not in have:
        op.create_table(
            "learn_progress",
            sa.Column("staff_id", sa.String(36), primary_key=True),
            sa.Column("lesson_id", sa.String(32), primary_key=True),
            sa.Column("completed_at", sa.String(50), nullable=False),
        )
    if "quiz_attempts" not in have:
        op.create_table(
            "quiz_attempts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("quiz_id", sa.String(48), nullable=False),
            sa.Column("mode", sa.String(16), nullable=False),
            sa.Column("score", sa.Integer(), nullable=True),
            sa.Column("total", sa.Integer(), nullable=True),
            sa.Column("answers_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("started_at", sa.String(50), nullable=False),
            sa.Column("finished_at", sa.String(50), nullable=True),
        )
        op.create_index("ix_quiz_attempts_staff_id", "quiz_attempts", ["staff_id"])
    if "card_reviews" not in have:
        op.create_table(
            "card_reviews",
            sa.Column("staff_id", sa.String(36), primary_key=True),
            sa.Column("card_id", sa.String(32), primary_key=True),
            sa.Column("fsrs_json", sa.Text(), nullable=True),
            sa.Column("due_at", sa.String(50), nullable=False),
        )
        op.create_index("ix_card_reviews_due_at", "card_reviews", ["due_at"])
    if "xp_events" not in have:
        op.create_table(
            "xp_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("staff_id", sa.String(36), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("ref_id", sa.String(80), nullable=False),
            sa.Column("xp", sa.Integer(), nullable=False),
            sa.Column("ts", sa.String(50), nullable=False),
            sa.UniqueConstraint("staff_id", "kind", "ref_id", name="uq_xp_event"),
        )
        op.create_index("ix_xp_events_staff_id", "xp_events", ["staff_id"])
    if "badges" not in have:
        op.create_table(
            "badges",
            sa.Column("staff_id", sa.String(36), primary_key=True),
            sa.Column("badge_id", sa.String(32), primary_key=True),
            sa.Column("earned_at", sa.String(50), nullable=False),
        )
    if "learn_prefs" not in have:
        op.create_table(
            "learn_prefs",
            sa.Column("staff_id", sa.String(36), primary_key=True),
            sa.Column("leaderboard_optout", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("migrated_at", sa.String(50), nullable=True),
        )


def downgrade() -> None:
    have = set(sa.inspect(op.get_bind()).get_table_names())
    for t in ("learn_prefs", "badges", "xp_events", "card_reviews", "quiz_attempts", "learn_progress"):
        if t in have:
            op.drop_table(t)
