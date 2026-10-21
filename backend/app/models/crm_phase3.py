from __future__ import annotations
from app.db.d1 import on_workers
if not on_workers():
    """SQLAlchemy models for CRM Phase 3: distributor-specific objects.
    
    Money is integer paise in ``BigInteger`` columns (Postgres ``INTEGER`` overflows at ~₹2.1 crore, which a
    family's AUM easily exceeds). Dates are ``YYYY-MM-DD`` strings, timestamps ISO-8601 UTC strings. Created by
    Alembic ``0009_crm_phase3``; ``repo_crm_core`` also ensures them idempotently on first use.
    """
    
    
    from sqlalchemy import BigInteger, Float, Integer, String, Text, UniqueConstraint
    from sqlalchemy.orm import Mapped, mapped_column
    
    from app.db.models import Base
    
    
    class HoldingModel(Base):
        __tablename__ = "holdings"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        contact_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        folio: Mapped[str] = mapped_column(String(40), nullable=False)
        scheme_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
        scheme_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
        units: Mapped[float] = mapped_column(Float, nullable=False)
        cost_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
        as_of: Mapped[str] = mapped_column(String(10), nullable=False)
        source: Mapped[str | None] = mapped_column(String(40), nullable=True)  # e.g. cams, kfin, manual
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
        created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
        updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    
        __table_args__ = (UniqueConstraint("contact_id", "folio", "scheme_code", name="uq_holding_position"),)
    
    
    class SipScheduleModel(Base):
        __tablename__ = "sip_schedules"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        contact_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        scheme_code: Mapped[str] = mapped_column(String(32), nullable=False)
        scheme_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
        type: Mapped[str] = mapped_column(String(8), nullable=False, default="sip")  # sip | stp | swp
        amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
        day: Mapped[int] = mapped_column(Integer, nullable=False)  # day of month, 1-28
        start_date: Mapped[str] = mapped_column(String(10), nullable=False)
        end_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
        mandate_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")  # active|paused|ended|bounced
        bounce_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
        last_bounce_at: Mapped[str | None] = mapped_column(String(10), nullable=True)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
        created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
        updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    
    
    class CommissionModel(Base):
        __tablename__ = "commissions"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        scheme_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
        folio: Mapped[str] = mapped_column(String(40), nullable=False)
        month: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # YYYY-MM
        amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
        contact_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        household_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        source: Mapped[str | None] = mapped_column(String(80), nullable=True)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    
        __table_args__ = (UniqueConstraint("folio", "scheme_code", "month", name="uq_commission_line"),)
    
    
    class CampaignModel(Base):
        __tablename__ = "campaigns"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        name: Mapped[str] = mapped_column(String(120), nullable=False)
        description: Mapped[str | None] = mapped_column(Text, nullable=True)
        status: Mapped[str] = mapped_column(String(12), nullable=False, default="draft")  # draft|active|completed
        segment: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON
        owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
        created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
        updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    
    
    class CampaignMemberModel(Base):
        __tablename__ = "campaign_members"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        campaign_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        contact_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        status: Mapped[str] = mapped_column(String(12), nullable=False, default="targeted")
        responded_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
        notes: Mapped[str | None] = mapped_column(Text, nullable=True)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
        __table_args__ = (UniqueConstraint("campaign_id", "contact_id", name="uq_campaign_member"),)
    
    
    class RmTeamModel(Base):
        """RM team hierarchy: a team lead sees their reports' books (one row per report)."""
    
        __tablename__ = "rm_teams"
    
        rm_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        lead_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
else:
    class SipScheduleModel: pass
    class CommissionModel: pass
    class CampaignModel: pass
    class CampaignMemberModel: pass
    class HoldingModel: pass
    class RmTeamModel: pass
