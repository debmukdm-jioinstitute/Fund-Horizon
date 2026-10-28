from __future__ import annotations
from app.db.d1 import on_workers
if not on_workers():
    """SQLAlchemy models for the FH Academy (staff learning hub): progress, quiz attempts, FSRS card state, XP and badges.
    
    Created by Alembic ``0011_academy``; ``app.api.learn`` also ensures them idempotently on first use.
    """
    
    
    from sqlalchemy import Integer, String, Text, UniqueConstraint
    from sqlalchemy.orm import Mapped, mapped_column
    
    from app.db.models import Base
    
    
    class LearnProgressModel(Base):
        __tablename__ = "learn_progress"
    
        staff_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        lesson_id: Mapped[str] = mapped_column(String(32), primary_key=True)
        completed_at: Mapped[str] = mapped_column(String(50), nullable=False)

    class VarsityProgressModel(Base):
        """Per-staff read state for external Zerodha Varsity chapters.

        Kept in its own table on purpose: Varsity ids are longer than the
        32-char lesson_id column, and Varsity reads must never appear in
        internal lesson completion, XP, streaks or badges.
        """

        __tablename__ = "learn_varsity_progress"

        staff_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        chapter_id: Mapped[str] = mapped_column(String(80), primary_key=True)
        completed_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class QuizAttemptModel(Base):
        __tablename__ = "quiz_attempts"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        staff_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        quiz_id: Mapped[str] = mapped_column(String(48), nullable=False)
        mode: Mapped[str] = mapped_column(String(16), nullable=False)
        score: Mapped[int | None] = mapped_column(Integer, nullable=True)
        total: Mapped[int | None] = mapped_column(Integer, nullable=True)
        answers_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
        started_at: Mapped[str] = mapped_column(String(50), nullable=False)
        finished_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
    
    class CardReviewModel(Base):
        __tablename__ = "card_reviews"
    
        staff_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        card_id: Mapped[str] = mapped_column(String(32), primary_key=True)
        fsrs_json: Mapped[str | None] = mapped_column(Text, nullable=True)
        due_at: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    
    
    class XpEventModel(Base):
        __tablename__ = "xp_events"
    
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        staff_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        kind: Mapped[str] = mapped_column(String(16), nullable=False)
        ref_id: Mapped[str] = mapped_column(String(80), nullable=False)
        xp: Mapped[int] = mapped_column(Integer, nullable=False)
        ts: Mapped[str] = mapped_column(String(50), nullable=False)
    
        # one award per (staff, kind, ref): repeating an action can never farm XP
        __table_args__ = (UniqueConstraint("staff_id", "kind", "ref_id", name="uq_xp_event"),)
    
    
    class BadgeModel(Base):
        __tablename__ = "badges"
    
        staff_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        badge_id: Mapped[str] = mapped_column(String(32), primary_key=True)
        earned_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class LearnPrefsModel(Base):
        __tablename__ = "learn_prefs"
    
        staff_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        leaderboard_optout: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
        migrated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
    
    LEARN_TABLES = [m.__table__ for m in (LearnProgressModel, VarsityProgressModel, QuizAttemptModel, CardReviewModel, XpEventModel, BadgeModel, LearnPrefsModel)]
else:
    class QuizAttemptModel: pass
    class BadgeModel: pass
    class LearnPrefsModel: pass
    class LearnProgressModel: pass
    class VarsityProgressModel: pass
    class CardReviewModel: pass
    class XpEventModel: pass
    LEARN_TABLES = []
