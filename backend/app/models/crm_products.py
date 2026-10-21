from __future__ import annotations
from app.db.d1 import on_workers
if not on_workers():
    """SQLAlchemy 2.0 models for the CRM products & compliance tables (W2).
    
    Extends the shared declarative ``Base`` from ``app.db.models`` so the existing
    ``Base.metadata.create_all`` call in the Postgres repository picks these tables
    up. The Alembic migration ``0004_crm_products`` (revision ``crm_products_0004``)
    is the production migration for Postgres; ``app/db_crm_products.py`` carries the
    matching raw-SQLite DDL.
    
    Money is integer paise; dates are ``YYYY-MM-DD`` strings; timestamps are
    ISO-8601 UTC strings. ``pan_last4`` holds only the last four PAN characters —
    the full PAN is never stored.
    """
    
    from sqlalchemy import BigInteger, Float, Integer, String, Text, UniqueConstraint
    from sqlalchemy.orm import Mapped, mapped_column
    
    from app.db.models import Base
    
    
    class InsurancePolicyModel(Base):
        __tablename__ = "insurance_policies"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        household_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        policy_type: Mapped[str] = mapped_column(String(32), nullable=False)
        insurer: Mapped[str | None] = mapped_column(String(120), nullable=True)
        policy_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
        premium_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # paise
        premium_due_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        renewal_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
        notes: Mapped[str | None] = mapped_column(Text, nullable=True)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class FixedDepositModel(Base):
        __tablename__ = "fixed_deposits"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        household_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        company: Mapped[str | None] = mapped_column(String(120), nullable=True)
        amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # paise
        interest_rate: Mapped[float | None] = mapped_column(Float, nullable=True)  # annual %
        start_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        maturity_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
        notes: Mapped[str | None] = mapped_column(Text, nullable=True)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class PmsAccountModel(Base):
        __tablename__ = "pms_accounts"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        household_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        provider: Mapped[str | None] = mapped_column(String(120), nullable=True)
        agreement_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # paise
        fee_fixed_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
        fee_performance_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
        hurdle_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
        high_water_mark: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # paise
        exit_load_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
        disclosure_doc_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
        disclosure_given_at: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        fee_acknowledged_at: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        reporting_cycle: Mapped[str] = mapped_column(String(16), nullable=False, default="quarterly")
        last_report_at: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        accredited_investor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
        status: Mapped[str] = mapped_column(String(16), nullable=False, default="prospect")
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
        updated_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class KycRecordModel(Base):
        __tablename__ = "kyc_records"
    
        customer_id: Mapped[str] = mapped_column(String(36), primary_key=True)
        pan_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
        kra_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
        ckyc_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
        updated_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class MandateModel(Base):
        __tablename__ = "mandates"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        umrn: Mapped[str | None] = mapped_column(String(64), nullable=True)
        bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
        amount_cap: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # paise
        status: Mapped[str] = mapped_column(String(16), nullable=False, default="registered")
        valid_until: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
    
    
    class ConsentModel(Base):
        __tablename__ = "consents"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        purpose: Mapped[str] = mapped_column(String(32), nullable=False)
        granted: Mapped[int] = mapped_column(Integer, nullable=False)
        notice_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
        granted_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
        withdrawn_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
        __table_args__ = (
            UniqueConstraint("customer_id", "purpose", name="uq_consent_customer_purpose"),
        )
    
    
    class SuitabilityRecordModel(Base):
        __tablename__ = "suitability_records"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        financial_status: Mapped[str | None] = mapped_column(Text, nullable=True)
        investment_experience: Mapped[str | None] = mapped_column(Text, nullable=True)
        objectives: Mapped[str | None] = mapped_column(Text, nullable=True)
        risk_band: Mapped[str | None] = mapped_column(String(32), nullable=True)
        recorded_by_rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
        recorded_at: Mapped[str] = mapped_column(String(50), nullable=False)
        score: Mapped[float | None] = mapped_column(Float, nullable=True)  # risk tolerance 0-100 from the questionnaire
        answers: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON {q1: 1..5}
        review_due: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
        max_riskometer: Mapped[int | None] = mapped_column(Integer, nullable=True)  # highest riskometer the band allows
    
    
    class DisclosureLogModel(Base):
        __tablename__ = "disclosure_logs"
    
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
        opportunity_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
        schemes_compared: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array string
        commissions_disclosed: Mapped[str | None] = mapped_column(Text, nullable=True)
        regular_plan_noted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
        created_at: Mapped[str] = mapped_column(String(50), nullable=False)
else:
    class ConsentModel: pass
    class FixedDepositModel: pass
    class KycRecordModel: pass
    class DisclosureLogModel: pass
    class InsurancePolicyModel: pass
    class PmsAccountModel: pass
    class MandateModel: pass
    class SuitabilityRecordModel: pass
