"""End-to-End API tests for Fund Horizon Backoffice endpoints."""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

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


def test_backoffice_overview_api(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/overview")
    assert r.status_code == 200
    body = r.json()
    assert "data" in body
    data = body["data"]
    assert "fx" in data
    assert "volatility" in data
    assert "yields" in data
    assert "derivatives" in data


def test_backoffice_series_api(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/series/FX:USDINR")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["data"], list)
    assert body["availability"] in {"ready", "unavailable"}
    assert client.get("/api/backoffice/series/MF:12345").status_code == 404


def test_backoffice_yields_api(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/yields")
    assert r.status_code == 200
    body = r.json()["data"]
    assert "india_curve" in body
    assert "us_curve" in body
    assert "india_us_10y_spread" in body
    # No fabricated values: the spread only exists once both 10Y yields have been collected live.
    assert "spread_bps" in body["india_us_10y_spread"]


def test_backoffice_derivatives_api(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/derivatives?underlying=NIFTY")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["underlying"] == "NIFTY"


def test_backoffice_impact_simulation_apis(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    # Scenario simulation
    scen_req = {
        "usd_shock_pct": 1.0,
        "us_yield_shock_bps": 25.0,
        "oil_shock_pct": 10.0,
        "modified_duration": 6.0,
    }
    r = client.post("/api/backoffice/impact/scenario", json=scen_req)
    assert r.status_code == 200
    body = r.json()
    assert body["impacts"]["bond_portfolio_price_change_pct"] == -1.5


def test_backoffice_briefing_api(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    # No briefing stored yet: 404, not 500.
    r = client.get("/api/backoffice/briefing")
    assert r.status_code == 404

    # Seed a stored briefing through the builder (read-only API path afterwards).
    from app.backoffice.analytics.briefing_builder import build_daily_briefing
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    build_daily_briefing(repo, "2026-10-14")

    r = client.get("/api/backoffice/briefing")
    assert r.status_code == 200
    body = r.json()
    assert body["brief_date"] == "2026-10-14"
    assert body["version"] == 1
    assert "generated_at" in body
    assert [s["key"] for s in body["sections"]] == [
        "market_pulse", "fund_movers", "screening_changes", "cost_manager_changes",
        "regulatory_news", "pms", "client_actions", "data_freshness",
    ]
    for section in body["sections"]:
        assert isinstance(section["items"], list) and "note" in section
    assert isinstance(body["freshness"], list)

    # Explicit date + archive dates.
    r = client.get("/api/backoffice/briefing?date=2026-10-14")
    assert r.status_code == 200 and r.json()["brief_date"] == "2026-10-14"
    assert client.get("/api/backoffice/briefing?date=2020-01-01").status_code == 404
    assert client.get("/api/backoffice/briefing?date=not-a-date").status_code == 404
    r = client.get("/api/backoffice/briefing/dates")
    assert r.status_code == 200 and r.json()["dates"] == ["2026-10-14"]

    # Rebuild is admin-only.
    r = client.post("/api/backoffice/briefing/rebuild", headers={"sec-fetch-site": "same-origin"})
    assert r.status_code == 403
    admin_sid = _create_staff("admin")
    _login_staff(client, admin_sid)
    r = client.post("/api/backoffice/briefing/rebuild", headers={"sec-fetch-site": "same-origin"})
    assert r.status_code == 202
    assert r.json()["ok"] is True and "brief_date" in r.json()


def test_backoffice_watchlists_crud(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    # Add watchlist
    add_r = client.post(
        "/api/backoffice/watchlists",
        json={"name": "Tech Watchlist", "item_type": "scheme", "item_id": "119551"},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert add_r.status_code == 201
    item_id = add_r.json()["id"]

    # List watchlists
    list_r = client.get("/api/backoffice/watchlists")
    assert list_r.status_code == 200
    items = list_r.json()["data"]
    assert any(it["id"] == item_id for it in items)

    # Delete watchlist
    del_r = client.delete(f"/api/backoffice/watchlists/{item_id}", headers={"sec-fetch-site": "same-origin"})
    assert del_r.status_code == 200


def test_backoffice_research_notes_crud(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    note_r = client.post(
        "/api/backoffice/research-notes",
        json={
            "entity_type": "pms",
            "entity_id": "ASK_Growth",
            "title": "Q2 Performance Analysis",
            "content": "Strong momentum in large caps with controlled drawdown.",
            "tags": "pms,growth,q2",
        },
        headers={"sec-fetch-site": "same-origin"},
    )
    assert note_r.status_code == 201
    assert note_r.json()["title"] == "Q2 Performance Analysis"

    # List
    list_r = client.get("/api/backoffice/research-notes?entity_type=pms")
    assert list_r.status_code == 200
    assert len(list_r.json()["data"]) >= 1


def test_backoffice_manual_import_lifecycle(client):
    sid = _create_staff("operations")
    _login_staff(client, sid)

    # 1. Download template
    tmpl_r = client.get("/api/backoffice/imports/template/pms_strategies")
    assert tmpl_r.status_code == 200
    csv_str = tmpl_r.text
    assert "Provider,Strategy Name" in csv_str

    # 2. Preview import
    prev_r = client.post(
        "/api/backoffice/imports/preview",
        json={
            "import_type": "pms_strategies",
            "filename": "strategies.csv",
            "csv_content": csv_str,
        },
        headers={"sec-fetch-site": "same-origin"},
    )
    assert prev_r.status_code == 200
    prev_data = prev_r.json()
    assert prev_data["valid"] is True

    # 3. Commit import
    commit_r = client.post(
        "/api/backoffice/imports/commit",
        json={
            "import_type": "pms_strategies",
            "filename": "strategies.csv",
            "csv_content": csv_str,
        },
        headers={"sec-fetch-site": "same-origin"},
    )
    assert commit_r.status_code == 200
    assert commit_r.json()["success"] is True
    assert commit_r.json()["rows_committed"] >= 1

    # 4. Verify strategies appear in query
    strat_r = client.get("/api/backoffice/pms/strategies")
    assert strat_r.status_code == 200
    assert strat_r.json()["count"] >= 1


def test_admin_staff_provisioning_api(client):
    admin_id = _create_staff("admin")
    _login_staff(client, admin_id)

    new_email = f"new_analyst_{secrets.token_hex(4)}@fundhorizon.internal"
    r = client.post(
        "/api/backoffice/staff/provision",
        json={
            "email": new_email,
            "name": "Jane Analyst",
            "role": "analyst",
            "password": "strongPassword123",
            "temp_password": True,
        },
        headers={"sec-fetch-site": "same-origin"},
    )
    assert r.status_code == 201
    assert r.json()["success"] is True

    # Non-admin cannot provision staff
    analyst_id = _create_staff("analyst")
    _login_staff(client, analyst_id)
    forbidden_r = client.post(
        "/api/backoffice/staff/provision",
        json={
            "email": "hacker@test.com",
            "name": "Hacker",
            "role": "admin",
            "password": "password123",
        },
        headers={"sec-fetch-site": "same-origin"},
    )
    assert forbidden_r.status_code == 403


def test_mutual_fund_tracker_pagination_dates_and_plan_filter(client):
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    repo.replace_mf_schemes(
        [
            {
                "scheme_code": "100001",
                "scheme_name": "Alpha Debt Fund",
                "amc": "Alpha AMC",
                "category": "Debt",
                "plan": "Direct",
                "option": "Growth",
                "isin": "INFALPHA1",
                "latest_nav": 2184.771,
                "latest_nav_date": "2026-10-12",
            },
            {
                "scheme_code": "100002",
                "scheme_name": "Alpha Debt Fund",
                "amc": "Alpha AMC",
                "category": "Debt",
                "plan": "Regular",
                "option": "IDCW",
                "isin": "-",
                "latest_nav": 10.5,
                "latest_nav_date": "2026-10-12",
            },
            {
                "scheme_code": "200001",
                "scheme_name": "Beta Flexi Cap",
                "amc": "Beta AMC",
                "category": "Equity",
                "plan": "Regular",
                "option": "Growth",
                "isin": "INFBETA1",
                "latest_nav": 50.0,
                "latest_nav_date": "2026-10-12",
            },
        ]
    )
    _login_staff(client, _create_staff("analyst"))
    page = client.get("/api/backoffice/mutual-funds/tracker", params={"limit": 1, "offset": 0, "search": "Alpha"})
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == 2 and body["count"] == 1
    assert body["as_of"] == "2026-10-12"
    row = body["data"][0]
    assert row["nav_date"] == "2026-10-12" and row["latest_nav_date"] == "2026-10-12"
    assert "Alpha AMC" in body["facets"]["amcs"]

    direct = client.get("/api/backoffice/mutual-funds/tracker", params={"plan": "Direct", "search": "Alpha"}).json()
    assert direct["total"] == 1 and direct["data"][0]["plan"] == "Direct" and direct["data"][0]["option"] == "Growth"

    missing_isin = client.get("/api/backoffice/mutual-funds/tracker", params={"search": "100002"}).json()["data"][0]
    assert missing_isin["isin"] is None


def test_upsert_observations_keeps_dict_provenance():
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    repo.upsert_observations([{
        "instrument_id": "VOL:IN:INDIAVIX", "observed_at": "2001-01-02", "value_numeric": 1.5,
        "frequency": "intraday", "provenance": "NSE",
    }])
    row = next(r for r in repo.get_observations_series("VOL:IN:INDIAVIX", start_date="2001-01-02", end_date="2001-01-02"))
    assert (row["provenance"], row["frequency"]) == ("NSE", "intraday")


def test_backoffice_mf_performance_api(client):
    from app.data.loader import load_metrics

    sid = _create_staff("analyst")
    _login_staff(client, sid)
    code = str(load_metrics().iloc[0]["scheme_code"])
    r = client.get(f"/api/backoffice/mutual-funds/{code}/performance")
    assert r.status_code == 200
    body = r.json()
    assert body["availability"] == "ready"
    hist = body["data"]["history"]
    assert hist and hist[0]["date"] <= body["as_of"]  # newest first, never dated after the last real NAV
    assert hist == sorted(hist, key=lambda h: h["date"], reverse=True)
    assert "ret_1y" in body["data"]["metrics"]
    eligible = set(client.app.state.eligible["scheme_code"])
    assert body["data"]["public_page"] is (code in eligible)
    assert client.get("/api/backoffice/mutual-funds/1/performance").json()["availability"] == "unavailable"
    assert client.get("/api/backoffice/mutual-funds/abc/performance").status_code == 404


def test_backoffice_mf_tracker_fh_recommended_filter(client):
    from app.backoffice.fh_recommended import FH_RECOMMENDED_MF_CODES
    from app.data.loader import load_metrics

    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/mutual-funds/tracker?recommended=true&limit=200")
    assert r.status_code == 200
    body = r.json()
    assert {f["scheme_code"] for f in body["data"]} <= set(FH_RECOMMENDED_MF_CODES)
    assert all(f["is_fh_recommended"] for f in body["data"])
    # Every curated code must exist in the performance dataset as a Regular Growth scheme.
    df = load_metrics().set_index("scheme_code")
    for code in FH_RECOMMENDED_MF_CODES:
        assert code in df.index and (df.loc[code, "plan"], df.loc[code, "option"]) == ("Regular", "Growth"), code


def test_provenance_meta_attached(client):
    from app.backoffice.meta import with_meta
    test_payload = {"data": "test"}
    enriched = with_meta(test_payload, "fbil", "2026-10-14")
    assert "meta" in enriched
    assert enriched["meta"]["_default"]["source"] == "fbil"
    assert enriched["meta"]["_default"]["source_url"] == "https://www.fbil.org.in"

    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/yields")
    assert r.status_code == 200
    meta = r.json().get("meta")
    assert meta and "_default" in meta
    assert meta["_default"]["source"] == "fbil"


def test_backoffice_risk_profiling_endpoints(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    # 1. Questionnaire
    q_res = client.get("/api/backoffice/risk-profiling/questionnaire")
    assert q_res.status_code == 200
    q_data = q_res.json()["data"]
    assert "questions" in q_data
    assert len(q_data["questions"]) == 10

    # 2. Evaluate
    payload = {
        "first_name": "Priya",
        "age": 32,
        "employment_type": "salaried_private",
        "dependents": 1,
        "monthly_income": 120000,
        "monthly_expenses": 45000,
        "monthly_emi": 15000,
        "liquid_assets": 400000,
        "investments": 800000,
        "liabilities": 500000,
        "term_cover": 20000000,
        "health_cover": 1000000,
        "answers": {f"q{i}": 3 for i in range(1, 11)},
    }
    eval_res = client.post("/api/backoffice/risk-profiling/evaluate", json=payload)
    assert eval_res.status_code == 200
    data = eval_res.json()["data"]
    assert "capacity" in data
    assert "tolerance" in data
    assert "final_score" in data
    assert "band" in data
    assert "target_allocation" in data
    assert data["target_allocation"]["equity"] > 0
    assert data["target_allocation"]["debt"] > 0

    # 3. Report PDF
    pdf_res = client.post("/api/backoffice/risk-profiling/report.pdf", json=payload)
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF")
    assert len(pdf_res.content) > 10000

