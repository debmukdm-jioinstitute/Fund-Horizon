"""Tests for Admin API endpoints."""
from __future__ import annotations

import os
from unittest.mock import patch

from app.db import get_repository


def test_admin_health(client):
    res = client.get("/api/admin/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "database" in data
    assert "rag" in data


def test_admin_stats(client):
    repo = get_repository()
    # Save a test plan
    repo.save_plan(
        {"client": {"first_name": "AdminTester", "age": 35}, "goals": []},
        {"profile": {"band": "Growth", "score": 60}, "goals": [], "sip": {"total_monthly_sip": 15000}},
    )

    res = client.get("/api/admin/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["total_plans"] >= 1
    assert data["total_schemes"] > 1000
    assert data["total_amcs"] > 10
    assert "database" in data


def test_admin_plans_crud(client):
    repo = get_repository()
    plan_id = repo.save_plan(
        {"client": {"first_name": "CRUDUser", "last_name": "Test", "age": 28}, "goals": []},
        {"profile": {"band": "Balanced", "score": 50}, "goals": [], "sip": {"total_monthly_sip": 10000}},
    )

    # List plans
    res = client.get("/api/admin/plans?limit=10&offset=0")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 1
    matching = [p for p in data["plans"] if p["id"] == plan_id]
    assert len(matching) == 1
    assert "CRUDUser" in matching[0]["client_name"]

    # Search plans
    search_res = client.get("/api/admin/plans?search=CRUDUser")
    assert search_res.status_code == 200
    assert len(search_res.json()["plans"]) >= 1

    # Get specific plan
    detail_res = client.get(f"/api/admin/plans/{plan_id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["id"] == plan_id

    # 404 for missing
    missing_res = client.get("/api/admin/plans/missing-uuid-1234")
    assert missing_res.status_code == 404

    # Delete plan
    del_res = client.delete(f"/api/admin/plans/{plan_id}")
    assert del_res.status_code == 200
    assert del_res.json()["success"] is True

    # Confirm deleted
    del_missing = client.delete(f"/api/admin/plans/{plan_id}")
    assert del_missing.status_code == 404


def test_admin_cas_sessions(client):
    repo = get_repository()
    sid = repo.save_cas_session(
        payload={"holdings": [{"name": "Fund X"}], "allocation_split": {"direct_pct": 50, "regular_pct": 50}},
        investor_name="CAS Investor",
        total_value=500000.0,
        xirr=0.135,
    )

    res = client.get("/api/admin/cas-sessions?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 1
    matching = [s for s in data["sessions"] if s["session_id"] == sid]
    assert len(matching) == 1
    assert matching[0]["investor_name"] == "CAS Investor"

    detail_res = client.get(f"/api/admin/cas-sessions/{sid}")
    assert detail_res.status_code == 200
    assert detail_res.json()["session_id"] == sid

    missing_res = client.get("/api/admin/cas-sessions/missing-sid")
    assert missing_res.status_code == 404


def test_admin_schemes(client):
    # Basic search
    res = client.get("/api/admin/schemes?limit=20&offset=0")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] > 1000
    assert len(data["schemes"]) <= 20
    assert len(data["amcs"]) > 10
    assert len(data["categories"]) > 10

    # Search by keyword
    search_res = client.get("/api/admin/schemes?search=Parag+Parikh&limit=5")
    assert search_res.status_code == 200
    assert search_res.json()["total"] >= 1

    # Filter by AMC
    amc_res = client.get("/api/admin/schemes?amc=HDFC+Mutual+Fund&limit=5")
    assert amc_res.status_code == 200
    for scheme in amc_res.json()["schemes"]:
        assert scheme["amc"] == "HDFC Mutual Fund"

    # Sorting
    sort_res = client.get("/api/admin/schemes?sort_by=cagr_3y&order=desc&limit=5")
    assert sort_res.status_code == 200
    schemes = sort_res.json()["schemes"]
    assert len(schemes) == 5


def test_admin_config(client):
    res = client.get("/api/admin/config")
    assert res.status_code == 200
    data = res.json()
    assert "assumptions" in data
    assert "allocation" in data
    assert "scoring" in data
    assert "inflation" in data["assumptions"]


def test_admin_refresh_dry_run(client):
    res = client.post("/api/admin/refresh", json={"dry_run": True})
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["dry_run"] is True
    assert data["funds_processed"] > 1000


def test_admin_api_key_auth(client):
    with patch.dict(os.environ, {"FH_ADMIN_KEY": "supersecretkey"}, clear=False):
        # Unauthenticated fails
        res_no_key = client.get("/api/admin/stats")
        assert res_no_key.status_code == 403

        # Bad key fails
        res_bad_key = client.get("/api/admin/stats", headers={"X-Admin-Key": "wrongkey"})
        assert res_bad_key.status_code == 403

        # Valid key succeeds
        res_good_key = client.get("/api/admin/stats", headers={"X-Admin-Key": "supersecretkey"})
        assert res_good_key.status_code == 200
