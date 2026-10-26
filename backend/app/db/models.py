from __future__ import annotations
"""SQLAlchemy 2.0 database models for PostgreSQL and SQLite persistence."""

from app.db.d1 import on_workers

if not on_workers():
    try:
        from sqlalchemy import Float, Integer, String, Text
        from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

        class Base(DeclarativeBase):
            pass

        class PlanModel(Base):
            __tablename__ = "plans"
            id: Mapped[str] = mapped_column(String(36), primary_key=True)
            created_at: Mapped[str] = mapped_column(String(50), nullable=False)
            request: Mapped[str] = mapped_column(Text, nullable=False)
            result: Mapped[str] = mapped_column(Text, nullable=False)
            customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

        class CustomerModel(Base):
            __tablename__ = "customers"
            id: Mapped[str] = mapped_column(String(36), primary_key=True)
            name: Mapped[str] = mapped_column(String(120), nullable=False)
            email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
            mobile: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
            password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
            role: Mapped[str] = mapped_column(String(16), nullable=False, default="customer")
            assigned_rm_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
            is_staff: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
            status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
            must_change_password: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
            revoked_before: Mapped[str | None] = mapped_column(String(50), nullable=True)
            pages: Mapped[str | None] = mapped_column(String(2000), nullable=True)
            created_at: Mapped[str] = mapped_column(String(50), nullable=False)

        class AuthSessionModel(Base):
            __tablename__ = "sessions"
            token_sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
            customer_id: Mapped[str] = mapped_column(String(36), nullable=False)
            created_at: Mapped[str] = mapped_column(String(50), nullable=False)
            expires_at: Mapped[str] = mapped_column(String(50), nullable=False)

        class FundModel(Base):
            __tablename__ = "funds"
            scheme_code: Mapped[str] = mapped_column(String(32), primary_key=True)
            scheme_name: Mapped[str] = mapped_column(String(255), nullable=False)
            amc: Mapped[str] = mapped_column(String(120), nullable=False)
            category: Mapped[str] = mapped_column(String(120), nullable=False)
            plan: Mapped[str] = mapped_column(String(32), nullable=False, default="Regular")
            option: Mapped[str] = mapped_column(String(32), nullable=False, default="Growth")
            isin: Mapped[str | None] = mapped_column(String(32), nullable=True)
            latest_nav: Mapped[float | None] = mapped_column(Float, nullable=True)
            latest_nav_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
            data_quality: Mapped[str] = mapped_column(String(32), nullable=False, default="ok")

        class MetricModel(Base):
            __tablename__ = "metrics"
            scheme_code: Mapped[str] = mapped_column(String(32), primary_key=True)
            ret_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
            ret_3m: Mapped[float | None] = mapped_column(Float, nullable=True)
            ret_6m: Mapped[float | None] = mapped_column(Float, nullable=True)
            ret_1y: Mapped[float | None] = mapped_column(Float, nullable=True)
            cagr_3y: Mapped[float | None] = mapped_column(Float, nullable=True)
            cagr_5y: Mapped[float | None] = mapped_column(Float, nullable=True)
            cagr_7y: Mapped[float | None] = mapped_column(Float, nullable=True)
            cagr_10y: Mapped[float | None] = mapped_column(Float, nullable=True)
            vol_3y: Mapped[float | None] = mapped_column(Float, nullable=True)
            sharpe_3y: Mapped[float | None] = mapped_column(Float, nullable=True)
            sortino_3y: Mapped[float | None] = mapped_column(Float, nullable=True)
            max_drawdown_3y: Mapped[float | None] = mapped_column(Float, nullable=True)
            max_drawdown_all: Mapped[float | None] = mapped_column(Float, nullable=True)
            data_asof: Mapped[str] = mapped_column(String(32), nullable=False, default="2026-10-09")

        class NavMonthlyModel(Base):
            __tablename__ = "nav_monthly"
            id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
            scheme_code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
            date: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
            nav: Mapped[float] = mapped_column(Float, nullable=False)

        class CasSessionModel(Base):
            __tablename__ = "cas_sessions"
            session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
            created_at: Mapped[str] = mapped_column(String(50), nullable=False)
            investor_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
            total_value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
            xirr: Mapped[float | None] = mapped_column(Float, nullable=True)
            payload: Mapped[str] = mapped_column(Text, nullable=False)
    except ImportError:
        class Base:
            metadata = None
else:
    class Base:
        metadata = None
