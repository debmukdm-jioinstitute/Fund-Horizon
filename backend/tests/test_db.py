"""Tests for database repositories (SQLite, PostgreSQL/SQLAlchemy, Alembic, and data refresh)."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine

from app.db import get_repository
from app.db.postgres import PostgresRepository, normalize_postgres_url
from app.db.sqlite import SQLiteRepository


@pytest.fixture
def temp_sqlite_repo(tmp_path: Path) -> SQLiteRepository:
    db_file = tmp_path / "test_plans.db"
    return SQLiteRepository(path=db_file)


@pytest.fixture
def sqlite_postgres_repo() -> PostgresRepository:
    """Use an in-memory SQLite engine to test PostgresRepository SQLAlchemy 2 ORM logic."""
    engine = create_engine("sqlite:///:memory:")
    repo = PostgresRepository("postgresql://mock:mock@localhost/mock", engine=engine)
    repo.init_schema()
    return repo


def test_normalize_postgres_url():
    url1 = "postgres://user:pass@ep-cool-123.us-east-1.aws.neon.tech/neondb"
    norm1 = normalize_postgres_url(url1)
    assert norm1.startswith("postgresql+psycopg://")

    url2 = "postgresql://user:pass@pooler.supabase.com:6543/postgres"
    norm2 = normalize_postgres_url(url2)
    assert norm2.startswith("postgresql+psycopg://")

    url3 = "postgresql+psycopg://already:ok@db/prod"
    norm3 = normalize_postgres_url(url3)
    assert norm3 == url3


def test_sqlite_plan_lifecycle(temp_sqlite_repo: SQLiteRepository):
    req = {"client": {"first_name": "TestUser", "age": 30}, "goals": []}
    res = {"headline": "Plan ready", "corpus": 500000}

    plan_id = temp_sqlite_repo.save_plan(req, res)
    assert isinstance(plan_id, str) and len(plan_id) == 36

    loaded = temp_sqlite_repo.get_plan(plan_id)
    assert loaded is not None
    assert loaded["id"] == plan_id
    assert loaded["request"]["client"]["first_name"] == "TestUser"
    assert loaded["result"]["corpus"] == 500000

    missing = temp_sqlite_repo.get_plan("non-existent-id")
    assert missing is None


def test_sqlite_cas_session_lifecycle(temp_sqlite_repo: SQLiteRepository):
    payload = {"holdings": [{"name": "Fund A", "value": 100000}], "direct_pct": 80.0}
    session_id = temp_sqlite_repo.save_cas_session(
        payload=payload,
        investor_name="Sharma",
        total_value=100000.0,
        xirr=0.145,
    )
    assert isinstance(session_id, str)

    loaded = temp_sqlite_repo.get_cas_session(session_id)
    assert loaded is not None
    assert loaded["session_id"] == session_id
    assert loaded["investor_name"] == "Sharma"
    assert loaded["total_value"] == 100000.0
    assert loaded["xirr"] == 0.145
    assert loaded["payload"]["direct_pct"] == 80.0

    assert temp_sqlite_repo.get_cas_session("missing-uuid") is None


def test_sqlite_funds_and_metrics_upsert(temp_sqlite_repo: SQLiteRepository):
    funds = [
        {
            "scheme_code": "119551",
            "scheme_name": "Parag Parikh Flexi Cap Fund",
            "amc": "PPFAS Mutual Fund",
            "category": "Flexi Cap Fund",
            "plan": "Regular",
            "option": "Growth",
            "isin": "INF879O01019",
            "latest_nav": 74.52,
            "latest_nav_date": "2026-10-09",
            "data_quality": "ok",
        }
    ]
    count = temp_sqlite_repo.upsert_funds(funds)
    assert count == 1

    fund = temp_sqlite_repo.get_fund("119551")
    assert fund is not None
    assert fund["scheme_name"] == "Parag Parikh Flexi Cap Fund"
    assert fund["latest_nav"] == 74.52

    # Update on conflict
    funds[0]["latest_nav"] = 75.10
    temp_sqlite_repo.upsert_funds(funds)
    updated = temp_sqlite_repo.get_fund("119551")
    assert updated is not None
    assert updated["latest_nav"] == 75.10

    listed = temp_sqlite_repo.list_funds(limit=10)
    assert len(listed) == 1
    assert listed[0]["scheme_code"] == "119551"

    # Metrics upsert
    metrics = [
        {
            "scheme_code": "119551",
            "ret_1y": 0.22,
            "cagr_3y": 0.185,
            "cagr_5y": 0.21,
            "vol_3y": 0.12,
            "sharpe_3y": 1.45,
            "data_asof": "2026-10-09",
        }
    ]
    m_count = temp_sqlite_repo.upsert_metrics(metrics)
    assert m_count == 1

    loaded_m = temp_sqlite_repo.get_metrics("119551")
    assert loaded_m is not None
    assert loaded_m["cagr_3y"] == 0.185
    assert loaded_m["sharpe_3y"] == 1.45

    assert temp_sqlite_repo.get_metrics("000000") is None


def test_postgres_repo_with_orm(sqlite_postgres_repo: PostgresRepository):
    # Plan lifecycle
    req = {"client": {"first_name": "Priya"}, "goals": []}
    res = {"headline": "Plan evaluated"}
    pid = sqlite_postgres_repo.save_plan(req, res)
    assert isinstance(pid, str)

    plan = sqlite_postgres_repo.get_plan(pid)
    assert plan is not None
    assert plan["request"]["client"]["first_name"] == "Priya"

    # CAS session lifecycle
    sid = sqlite_postgres_repo.save_cas_session(
        payload={"funds": 3},
        investor_name="Priya",
        total_value=250000.0,
        xirr=0.12,
    )
    cas = sqlite_postgres_repo.get_cas_session(sid)
    assert cas is not None
    assert cas["total_value"] == 250000.0

    # Funds & Metrics upsert
    funds = [
        {
            "scheme_code": "120503",
            "scheme_name": "Mirae Asset Large & Midcap Fund",
            "amc": "Mirae Asset",
            "category": "Large & Mid Cap Fund",
            "plan": "Regular",
            "option": "Growth",
            "latest_nav": 128.4,
            "data_quality": "ok",
        }
    ]
    sqlite_postgres_repo.upsert_funds(funds)
    fund = sqlite_postgres_repo.get_fund("120503")
    assert fund is not None
    assert fund["scheme_name"] == "Mirae Asset Large & Midcap Fund"

    metrics = [
        {
            "scheme_code": "120503",
            "cagr_3y": 0.17,
            "cagr_5y": 0.19,
            "vol_3y": 0.14,
            "data_asof": "2026-10-09",
        }
    ]
    sqlite_postgres_repo.upsert_metrics(metrics)
    metric = sqlite_postgres_repo.get_metrics("120503")
    assert metric is not None
    assert metric["cagr_3y"] == 0.17


def test_get_repository_factory():
    with patch.dict(os.environ, {"DATABASE_URL": ""}, clear=False):
        repo = get_repository()
        assert isinstance(repo, SQLiteRepository)

    with patch.dict(os.environ, {"DATABASE_URL": "postgresql://user:pass@host:5432/db"}, clear=False):
        with patch("app.db.postgres.create_engine") as mock_engine:
            repo_pg = get_repository()
            assert isinstance(repo_pg, PostgresRepository)
            mock_engine.assert_called_once()


def test_refresh_fund_database_dry_run():
    from scripts.refresh_data import refresh_fund_database

    n_funds, n_metrics = refresh_fund_database(dry_run=True)
    assert n_funds > 1000
    assert n_metrics > 1000


def test_alembic_migrations(tmp_path: Path):
    from alembic.config import Config
    from sqlalchemy import inspect

    from alembic import command

    with patch.dict(os.environ, {"DATABASE_URL": ""}, clear=False):
        backend_dir = Path(__file__).resolve().parents[1]
        alembic_cfg = Config(str(backend_dir / "alembic.ini"))
        test_db_url = f"sqlite:///{tmp_path / 'alembic_test.db'}"
        alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)
        alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))

        # Upgrade to head
        command.upgrade(alembic_cfg, "head")

        # Verify tables were created
        engine = create_engine(test_db_url)
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = inspector.get_table_names()
            assert "plans" in tables
            assert "funds" in tables
            assert "metrics" in tables
            assert "cas_sessions" in tables
            assert "nav_monthly" in tables

        # Downgrade to base
        command.downgrade(alembic_cfg, "base")
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = inspector.get_table_names()
            assert "plans" not in tables
            assert "funds" not in tables
