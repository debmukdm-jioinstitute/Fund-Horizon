"""Unit tests for Institutional Flows (Phase 1): dedup, normalization, querying, and collector schedule."""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.api.backoffice import get_last_nse_trading_day
from app.backoffice.collectors import should_fetch_flows
from app.backoffice.repository import BackofficeRepository
from app.backoffice.service import BackofficeService
from app.db import sqlite

IST = ZoneInfo("Asia/Kolkata")


def _create_staff(role="analyst"):
    tag = secrets.token_hex(6)
    email = f"staff_{tag}@fundhorizon.internal"
    mobile = f"98{secrets.randbelow(90000000) + 10000000}"
    created = sqlite.create_customer(
        name=f"Staff {role}",
        email=email,
        mobile=mobile,
        password_hash="pbkdf2_sha256$test",
        role=role,
    )
    user_id = created["id"]
    sqlite.update_customer(user_id, {"is_staff": 1, "status": "active"})
    return user_id


def _login_staff(client, staff_id):
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(
        staff_id,
        hashlib.sha256(token.encode()).hexdigest(),
        (datetime.now(UTC) + timedelta(days=30)).isoformat(),
    )
    client.cookies.set("fh_session", token)


def test_flows_upsert_on_conflict_and_dedup():
    repo = BackofficeRepository()
    row_v1 = [{
        "report_date": "2026-09-15",
        "category": "FII",
        "segment": "equity_cash",
        "gross_buy": 1000.50,
        "gross_sell": 800.25,
        "net": 200.25,
        "unit": "inr_crore",
        "status": "provisional",
    }]
    count1 = repo.upsert_flows(row_v1)
    assert count1 == 1

    # Re-insert with updated values on same (report_date, category, segment)
    row_v2 = [{
        "report_date": "2026-09-15",
        "category": "FII",
        "segment": "equity_cash",
        "gross_buy": 1200.00,
        "gross_sell": 700.00,
        "net": 500.00,
        "unit": "inr_crore",
        "status": "final",
    }]
    count2 = repo.upsert_flows(row_v2)
    assert count2 == 1

    # Fetch rows for this date: only 1 row exists with updated values
    flows = repo.list_flows(start_date="2026-09-15", end_date="2026-09-15")
    assert len(flows) == 1
    assert flows[0]["gross_buy"] == 1200.00
    assert flows[0]["gross_sell"] == 700.00
    assert flows[0]["net"] == 500.00
    assert flows[0]["status"] == "final"


def test_flows_query_filters_singly():
    repo = BackofficeRepository()
    records = [
        {"report_date": "2026-08-01", "category": "DII", "segment": "equity_cash", "gross_buy": 500, "gross_sell": 400, "net": 100},
        {"report_date": "2026-08-10", "category": "DII", "segment": "equity_cash", "gross_buy": 600, "gross_sell": 500, "net": 100},
        {"report_date": "2026-08-20", "category": "DII", "segment": "equity_cash", "gross_buy": 700, "gross_sell": 600, "net": 100},
    ]
    repo.upsert_flows(records)

    # Test 'from' singly
    from_only = repo.list_flows(start_date="2026-08-10")
    dates_from = {r["report_date"] for r in from_only if r["report_date"].startswith("2026-08")}
    assert "2026-08-01" not in dates_from
    assert "2026-08-10" in dates_from
    assert "2026-08-20" in dates_from

    # Test 'to' singly
    to_only = repo.list_flows(end_date="2026-08-10")
    dates_to = {r["report_date"] for r in to_only if r["report_date"].startswith("2026-08")}
    assert "2026-08-01" in dates_to
    assert "2026-08-10" in dates_to
    assert "2026-08-20" not in dates_to


def test_flows_import_normalization():
    service = BackofficeService()

    csv_content = """Report Date,Category,Segment,Gross Buy,Gross Sell,Net,Unit,Status
2026-09-01,FPI,equity_cash,50000,40000,10000,inr_lakh,Provisional
2026-09-01,DII,equity_cash,800.5,600.25,200.25,inr_crore,Final
"""
    res = service.commit_manual_import("fii_dii_flows", "test_flows.csv", csv_content, "staff_admin")
    assert res["success"] is True
    assert res["rows_committed"] == 2

    repo = BackofficeRepository()
    rows = repo.list_flows(start_date="2026-09-01", end_date="2026-09-01")
    fii_row = next(r for r in rows if r["category"] == "FII")
    dii_row = next(r for r in rows if r["category"] == "DII")

    # FPI was mapped to FII
    assert fii_row["category"] == "FII"
    # Lakh converted to Crore: 50,000 lakh = 500.00 crore
    assert fii_row["gross_buy"] == 500.0
    assert fii_row["gross_sell"] == 400.0
    assert fii_row["net"] == 100.0
    assert fii_row["unit"] == "inr_crore"
    assert fii_row["status"] == "provisional"

    # DII kept in crore
    assert dii_row["category"] == "DII"
    assert dii_row["gross_buy"] == 800.5
    assert dii_row["unit"] == "inr_crore"
    assert dii_row["status"] == "final"


def test_flows_import_rejections():
    service = BackofficeService()

    # Reject non-ISO date
    bad_date_csv = """Report Date,Category,Segment,Gross Buy,Gross Sell,Net,Unit,Status
01/09/2026,FII,equity_cash,500,400,100,inr_crore,final
"""
    with pytest.raises(ValueError, match="Invalid date format"):
        service.commit_manual_import("fii_dii_flows", "bad_date.csv", bad_date_csv, "staff_admin")

    # Reject unknown category
    bad_cat_csv = """Report Date,Category,Segment,Gross Buy,Gross Sell,Net,Unit,Status
2026-09-02,RETAIL,equity_cash,500,400,100,inr_crore,final
"""
    # Either preview rejects it or commit raises ValueError
    try:
        res = service.commit_manual_import("fii_dii_flows", "bad_cat.csv", bad_cat_csv, "staff_admin")
        assert res["success"] is False
    except ValueError:
        pass

    # Reject unknown unit
    bad_unit_csv = """Report Date,Category,Segment,Gross Buy,Gross Sell,Net,Unit,Status
2026-09-02,FII,equity_cash,500,400,100,usd_million,final
"""
    try:
        res = service.commit_manual_import("fii_dii_flows", "bad_unit.csv", bad_unit_csv, "staff_admin")
        assert res["success"] is False
    except ValueError:
        pass


def test_flows_api_as_of_and_freshness(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    repo = BackofficeRepository()
    repo.upsert_flows([
        {
            "report_date": "2026-10-13",
            "category": "FII",
            "segment": "equity_cash",
            "gross_buy": 1500.0,
            "gross_sell": 1200.0,
            "net": 300.0,
            "unit": "inr_crore",
            "status": "provisional",
        },
        {
            "report_date": "2026-10-13",
            "category": "DII",
            "segment": "equity_cash",
            "gross_buy": 1100.0,
            "gross_sell": 900.0,
            "net": 200.0,
            "unit": "inr_crore",
            "status": "provisional",
        },
    ])

    resp = client.get("/api/backoffice/flows?from=2026-10-13&to=2026-10-13")
    assert resp.status_code == 200
    data = resp.json()
    assert "as_of" in data
    assert data["as_of"] == "2026-10-13"
    assert "fetched_at" in data
    assert "freshness" in data
    assert "availability" in data
    assert data["unit"] == "inr_crore"
    assert len(data["data"]) == 2


def test_collector_should_fetch_flows():
    # Force bypass works
    due, reason = should_fetch_flows(force=True)
    assert due is True
    assert reason == "forced_manual_refresh"
