"""PostgreSQL persistence repository for Fund Horizon.

Designed for free-tier managed Postgres databases (Supabase, Neon).
Supports SQLAlchemy 2.0 with connection pooling, automatic ping,
and JSON payload serialization.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, create_engine, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import DatabaseRepository
from app.db.models import Base, CasSessionModel, FundModel, MetricModel, PlanModel


def normalize_postgres_url(url: str) -> str:
    """Normalize postgres URLs to use psycopg driver."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and not url.startswith("postgresql+"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


class PostgresRepository(DatabaseRepository):
    """PostgreSQL implementation of DatabaseRepository using SQLAlchemy 2.0."""

    def __init__(self, db_url: str, engine: Engine | None = None) -> None:
        if engine is not None:
            self.engine = engine
        else:
            normalized_url = normalize_postgres_url(db_url)
            self.engine = create_engine(
                normalized_url,
                pool_pre_ping=True,
                pool_size=10,
                max_overflow=20,
                pool_recycle=300,
            )
        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)

    def init_schema(self) -> None:
        """Create tables if they do not exist (useful for testing or initial setup)."""
        Base.metadata.create_all(self.engine)

    def get_session(self) -> Session:
        return self.session_factory()

    def save_plan(self, request: dict[str, Any], result: dict[str, Any], plan_id: str | None = None) -> str:
        pid = plan_id or str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        with self.get_session() as session:
            with session.begin():
                plan = PlanModel(
                    id=pid,
                    created_at=now,
                    request=json.dumps(request),
                    result=json.dumps(result),
                )
                session.add(plan)
        return pid

    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        with self.get_session() as session:
            stmt = select(PlanModel).where(PlanModel.id == plan_id)
            plan = session.scalars(stmt).first()
            if not plan:
                return None
            return {
                "id": plan.id,
                "created_at": plan.created_at,
                "request": json.loads(plan.request),
                "result": json.loads(plan.result),
            }

    def list_plans(self, limit: int = 50, offset: int = 0, search: str | None = None) -> list[dict[str, Any]]:
        with self.get_session() as session:
            stmt = select(PlanModel).order_by(PlanModel.created_at.desc())
            if search:
                pattern = f"%{search}%"
                stmt = stmt.where(or_(PlanModel.id.ilike(pattern), PlanModel.request.ilike(pattern)))
            stmt = stmt.limit(limit).offset(offset)
            plans_orm = session.scalars(stmt).all()
            plans = []
            for p in plans_orm:
                req = json.loads(p.request)
                res = json.loads(p.result)
                client = req.get("client", {})
                first_name = client.get("first_name", "Anonymous")
                last_name = client.get("last_name", "")
                name = f"{first_name} {last_name}".strip()
                plans.append({
                    "id": p.id,
                    "created_at": p.created_at,
                    "client_name": name or "Anonymous",
                    "age": client.get("age"),
                    "risk_band": res.get("profile", {}).get("band"),
                    "risk_score": res.get("profile", {}).get("score"),
                    "target_corpus": sum(g.get("future_cost", 0) for g in res.get("goals", [])),
                    "total_sip": res.get("sip", {}).get("total_monthly_sip"),
                    "goals_count": len(res.get("goals", [])),
                    "request": req,
                    "result": res,
                })
            return plans

    def count_plans(self) -> int:
        with self.get_session() as session:
            return session.scalar(select(func.count(PlanModel.id))) or 0

    def delete_plan(self, plan_id: str) -> bool:
        with self.get_session() as session:
            with session.begin():
                stmt = delete(PlanModel).where(PlanModel.id == plan_id)
                res = session.execute(stmt)
                return (res.rowcount or 0) > 0


    def save_cas_session(
        self,
        payload: dict[str, Any],
        investor_name: str | None = None,
        total_value: float = 0.0,
        xirr: float | None = None,
        session_id: str | None = None,
    ) -> str:
        sid = session_id or str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        with self.get_session() as session:
            with session.begin():
                cas_session = CasSessionModel(
                    session_id=sid,
                    created_at=now,
                    investor_name=investor_name,
                    total_value=total_value,
                    xirr=xirr,
                    payload=json.dumps(payload),
                )
                session.add(cas_session)
        return sid

    def get_cas_session(self, session_id: str) -> dict[str, Any] | None:
        with self.get_session() as session:
            stmt = select(CasSessionModel).where(CasSessionModel.session_id == session_id)
            session_obj = session.scalars(stmt).first()
            if not session_obj:
                return None
            return {
                "session_id": session_obj.session_id,
                "created_at": session_obj.created_at,
                "investor_name": session_obj.investor_name,
                "total_value": session_obj.total_value,
                "xirr": session_obj.xirr,
                "payload": json.loads(session_obj.payload),
            }

    def list_cas_sessions(self, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        with self.get_session() as session:
            stmt = select(CasSessionModel).order_by(CasSessionModel.created_at.desc()).limit(limit).offset(offset)
            sessions_orm = session.scalars(stmt).all()
            sessions = []
            for s in sessions_orm:
                payload = json.loads(s.payload)
                sessions.append({
                    "session_id": s.session_id,
                    "created_at": s.created_at,
                    "investor_name": s.investor_name or "Anonymous",
                    "total_value": s.total_value,
                    "xirr": s.xirr,
                    "holdings_count": len(payload.get("holdings", [])),
                    "direct_pct": payload.get("allocation_split", {}).get("direct_pct", 0),
                    "regular_pct": payload.get("allocation_split", {}).get("regular_pct", 0),
                    "payload": payload,
                })
            return sessions

    def count_cas_sessions(self) -> int:
        with self.get_session() as session:
            return session.scalar(select(func.count(CasSessionModel.session_id))) or 0


    def upsert_funds(self, funds: list[dict[str, Any]]) -> int:
        if not funds:
            return 0

        with self.get_session() as session:
            with session.begin():
                if self.engine.dialect.name == "postgresql":
                    count = 0
                    # Batch upserts in chunks of 200
                    chunk_size = 200
                    for i in range(0, len(funds), chunk_size):
                        chunk = funds[i : i + chunk_size]
                        insert_stmt = pg_insert(FundModel).values(chunk)
                        upsert_stmt = insert_stmt.on_conflict_do_update(
                            index_elements=[FundModel.scheme_code],
                            set_={
                                "scheme_name": insert_stmt.excluded.scheme_name,
                                "amc": insert_stmt.excluded.amc,
                                "category": insert_stmt.excluded.category,
                                "plan": insert_stmt.excluded.plan,
                                "option": insert_stmt.excluded.option,
                                "isin": insert_stmt.excluded.isin,
                                "latest_nav": insert_stmt.excluded.latest_nav,
                                "latest_nav_date": insert_stmt.excluded.latest_nav_date,
                                "data_quality": insert_stmt.excluded.data_quality,
                            },
                        )
                        session.execute(upsert_stmt)
                        count += len(chunk)
                    return count
                else:
                    for f in funds:
                        clean_fund = {k: v for k, v in f.items() if hasattr(FundModel, k)}
                        session.merge(FundModel(**clean_fund))
                    return len(funds)

    def get_fund(self, scheme_code: str) -> dict[str, Any] | None:
        with self.get_session() as session:
            stmt = select(FundModel).where(FundModel.scheme_code == str(scheme_code))
            fund = session.scalars(stmt).first()
            if not fund:
                return None
            return {
                "scheme_code": fund.scheme_code,
                "scheme_name": fund.scheme_name,
                "amc": fund.amc,
                "category": fund.category,
                "plan": fund.plan,
                "option": fund.option,
                "isin": fund.isin,
                "latest_nav": fund.latest_nav,
                "latest_nav_date": fund.latest_nav_date,
                "data_quality": fund.data_quality,
            }

    def list_funds(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        with self.get_session() as session:
            stmt = select(FundModel).order_by(FundModel.scheme_name).limit(limit).offset(offset)
            funds = session.scalars(stmt).all()
            return [
                {
                    "scheme_code": f.scheme_code,
                    "scheme_name": f.scheme_name,
                    "amc": f.amc,
                    "category": f.category,
                    "plan": f.plan,
                    "option": f.option,
                    "isin": f.isin,
                    "latest_nav": f.latest_nav,
                    "latest_nav_date": f.latest_nav_date,
                    "data_quality": f.data_quality,
                }
                for f in funds
            ]

    def upsert_metrics(self, metrics: list[dict[str, Any]]) -> int:
        if not metrics:
            return 0

        with self.get_session() as session:
            with session.begin():
                if self.engine.dialect.name == "postgresql":
                    count = 0
                    chunk_size = 200
                    for i in range(0, len(metrics), chunk_size):
                        chunk = metrics[i : i + chunk_size]
                        insert_stmt = pg_insert(MetricModel).values(chunk)
                        upsert_stmt = insert_stmt.on_conflict_do_update(
                            index_elements=[MetricModel.scheme_code],
                            set_={
                                "ret_1m": insert_stmt.excluded.ret_1m,
                                "ret_3m": insert_stmt.excluded.ret_3m,
                                "ret_6m": insert_stmt.excluded.ret_6m,
                                "ret_1y": insert_stmt.excluded.ret_1y,
                                "cagr_3y": insert_stmt.excluded.cagr_3y,
                                "cagr_5y": insert_stmt.excluded.cagr_5y,
                                "cagr_7y": insert_stmt.excluded.cagr_7y,
                                "cagr_10y": insert_stmt.excluded.cagr_10y,
                                "vol_3y": insert_stmt.excluded.vol_3y,
                                "sharpe_3y": insert_stmt.excluded.sharpe_3y,
                                "sortino_3y": insert_stmt.excluded.sortino_3y,
                                "max_drawdown_3y": insert_stmt.excluded.max_drawdown_3y,
                                "max_drawdown_all": insert_stmt.excluded.max_drawdown_all,
                                "data_asof": insert_stmt.excluded.data_asof,
                            },
                        )
                        session.execute(upsert_stmt)
                        count += len(chunk)
                    return count
                else:
                    for m in metrics:
                        clean_metric = {k: v for k, v in m.items() if hasattr(MetricModel, k)}
                        session.merge(MetricModel(**clean_metric))
                    return len(metrics)

    def get_metrics(self, scheme_code: str) -> dict[str, Any] | None:
        with self.get_session() as session:
            stmt = select(MetricModel).where(MetricModel.scheme_code == str(scheme_code))
            m = session.scalars(stmt).first()
            if not m:
                return None
            return {
                "scheme_code": m.scheme_code,
                "ret_1m": m.ret_1m,
                "ret_3m": m.ret_3m,
                "ret_6m": m.ret_6m,
                "ret_1y": m.ret_1y,
                "cagr_3y": m.cagr_3y,
                "cagr_5y": m.cagr_5y,
                "cagr_7y": m.cagr_7y,
                "cagr_10y": m.cagr_10y,
                "vol_3y": m.vol_3y,
                "sharpe_3y": m.sharpe_3y,
                "sortino_3y": m.sortino_3y,
                "max_drawdown_3y": m.max_drawdown_3y,
                "max_drawdown_all": m.max_drawdown_all,
                "data_asof": m.data_asof,
            }

    def get_db_info(self) -> dict[str, Any]:
        return {
            "provider": "PostgreSQL",
            "connected": True,
            "dialect": self.engine.dialect.name,
            "url": str(self.engine.url).split("@")[-1] if "@" in str(self.engine.url) else str(self.engine.url),
        }

