"""API tests for Fund Horizon Screening endpoints."""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import pytest

from app.backoffice.repository import BackofficeRepository
from app.db import sqlite


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


@pytest.fixture
def seeded_screening(client):
    """Seed test screening metrics and managers for the client session."""
    repo = BackofficeRepository()
    conn = repo._conn()
    with conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO mf_managers (scheme_code, manager_name, manager_start, source, provenance, updated_at)
            VALUES ('119551', 'Chirag Setalvad', '2019-01-01', 'manual_import', 'manual', '2026-10-14T00:00:00Z')
            """
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO mf_screening_metrics (
                scheme_code, as_of, cat, amc, scheme_name,
                manager_name, manager_tenure_years, tenure_ratio,
                alpha, beta, std_dev, r_squared, information_ratio, tracking_error, treynor,
                sharpe, sortino, up_capture, down_capture, max_drawdown, expense_ratio,
                ret_1y, cagr_3y, cagr_5y, cagr_si, bench_1y, bench_3y, bench_5y, bench_si,
                cat_avg_1y, cat_avg_3y, cat_avg_5y, cat_avg_si,
                quartile_2y, quartile_source, rf_source, benchmark_source,
                history_years, quality_flags, provenance_json
            ) VALUES (
                '119551', '2026-10-09', 'mid_cap', 'HDFC Mutual Fund', 'HDFC Mid-Cap Opportunities Fund - Regular Plan - Growth',
                'Chirag Setalvad', 4.5, 1.2,
                0.03, 0.95, 0.14, 0.88, 0.85, 0.04, 0.12,
                1.25, 1.45, 1.08, 0.92, -0.15, 1.55,
                0.18, 0.22, 0.19, 0.17, 0.15, 0.18, 0.16, 0.14,
                0.16, 0.19, 0.17, 0.15,
                2, 'computed_nav', 'assumptions_fixed', 'category_median',
                12.5, 'ok', '{"rf": 0.065, "rf_source": "assumptions_fixed", "cat_median_ter": 1.65}'
            )
            """
        )
    return repo


def test_screening_requires_staff(client):
    client.cookies.clear()
    r = client.get("/api/backoffice/screening/metrics")
    assert r.status_code == 401


def test_screening_metrics_schema(client, seeded_screening):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    r = client.get("/api/backoffice/screening/metrics")
    assert r.status_code == 200
    body = r.json()
    assert body["availability"] == "ready"
    assert "data" in body
    d = body["data"]
    assert "ratios" in d
    assert "rows" in d
    assert len(d["rows"]) >= 1
    assert "facets" in d
    assert "cats" in d["facets"]
    assert "amcs" in d["facets"]
    assert "mid_cap" in d["facets"]["cats"]


def test_screening_run_endpoint(client, seeded_screening):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    payload = {
        "preset_id": None,
        "filters": {
            "min_tenure_years": 3,
            "columns": ["sharpe", "sortino", "up_capture", "down_capture", "expense_ratio"],
            "bounds": {"sharpe": {"min": 1.0}},
            "quartiles_action": [2, 3],
            "include_retain": False,
        },
    }
    r = client.post(
        "/api/backoffice/screening/run",
        json=payload,
        headers={"sec-fetch-site": "same-origin"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "data" in body
    data = body["data"]
    assert "run_id" in data
    assert "counts" in data
    assert data["counts"]["universe"] >= 1
    assert data["counts"]["final"] >= 1
    assert len(data["action"]) >= 1
    assert data["action"][0]["scheme_code"] == "119551"


def test_screening_preset_crud_isolation(client):
    staff_a = _create_staff("analyst")
    staff_b = _create_staff("analyst")

    _login_staff(client, staff_a)
    create_r = client.post(
        "/api/backoffice/screening/presets",
        json={"name": "Alpha Hunters", "filters": {"min_tenure_years": 4}},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert create_r.status_code == 200
    preset_id = create_r.json()["data"]["id"]

    list_a = client.get("/api/backoffice/screening/presets")
    assert any(p["id"] == preset_id for p in list_a.json()["data"])

    _login_staff(client, staff_b)
    list_b = client.get("/api/backoffice/screening/presets")
    assert not any(p["id"] == preset_id for p in list_b.json()["data"])

    del_b = client.delete(
        f"/api/backoffice/screening/presets/{preset_id}",
        headers={"sec-fetch-site": "same-origin"},
    )
    assert del_b.status_code == 404

    _login_staff(client, staff_a)
    del_a = client.delete(
        f"/api/backoffice/screening/presets/{preset_id}",
        headers={"sec-fetch-site": "same-origin"},
    )
    assert del_a.status_code == 200


def test_screening_csv_export_and_sanitization(client, seeded_screening):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    run_r = client.post(
        "/api/backoffice/screening/run",
        json={"filters": {"min_tenure_years": 1}},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert run_r.status_code == 200
    run_id = run_r.json()["data"]["run_id"]

    export_r = client.get(f"/api/backoffice/screening/export/{run_id}.csv")
    assert export_r.status_code == 200
    assert "text/csv" in export_r.headers["content-type"]
    csv_content = export_r.text
    assert "scheme_code" in csv_content
    assert "119551" in csv_content
    # Formula injection safety: no unescaped cell starts with =cmd
    for line in csv_content.splitlines():
        cells = line.split(",")
        for cell in cells:
            assert not cell.startswith("=cmd")


def test_screening_fund_details_endpoint(client, seeded_screening):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    r = client.get("/api/backoffice/screening/funds/119551")
    assert r.status_code == 200
    body = r.json()
    assert "data" in body
    d = body["data"]
    assert d["scheme_code"] == "119551"
    assert d["manager_name"] == "Chirag Setalvad"
    assert "notes" in d
    assert "pms_matches" in d
