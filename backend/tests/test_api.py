import json
import os
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import sqlite
from app.main import create_app

RAW = json.loads((Path(__file__).parent / "fixtures" / "personas.json").read_text())


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["FH_DB_PATH"] = str(tmp_path_factory.mktemp("db") / "t.db")
    os.environ["FH_RATE_LIMIT"] = "false"
    os.environ["FH_ALLOW_ASSUMPTION_OVERRIDES"] = "true"
    with TestClient(create_app()) as c:
        yield c


def body(name="young_aggressive", **over):
    b = json.loads(json.dumps(RAW[name]))
    for k, v in over.items():
        b[k] = v
    return b


def test_health_and_meta(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["eligible_funds"] > 1000
    m = client.get("/api/meta").json()
    assert m["data_asof"] == "2026-10-09"
    assert "ARN 345439" in m["disclosures"]["arn"]
    assert len(m["bands"]) == 5


def test_questionnaire(client):
    q = client.get("/api/questionnaire").json()["questions"]
    assert len(q) == 10 and all(len(x["options"]) >= 4 for x in q)


def test_happy_path_create_and_fetch(client):
    r = client.post("/api/plans", json=body())
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("id", "profile", "allocation", "funds", "stress_test", "planning", "disclosures",
                "created_at", "expires_at"):
        assert key in d
    got = client.get(f"/api/plans/{d['id']}").json()
    assert got["profile"]["band"] == d["profile"]["band"]
    assert got["created_at"] == d["created_at"] and got["expires_at"] == d["expires_at"]
    assert len(d["funds"]) <= 8
    stored = sqlite.get_plan(d["id"])
    assert stored["request"]["consent"] is True


def test_recompute_with_step_up_changes_sip(client):
    d = client.post("/api/plans", json=body("mid_career_dependents")).json()
    s = client.get(f"/api/plans/{d['id']}", params={"step_up": 0.1}).json()
    assert s["planning"]["step_up"] == 0.1
    assert s["planning"]["goals"][0]["required_sip"] < d["planning"]["goals"][0]["required_sip"]
    assert client.get(f"/api/plans/{d['id']}").json()["planning"]["step_up"] == 0.0


def test_unknown_plan_404(client):
    assert client.get("/api/plans/does-not-exist").status_code == 404
    assert client.get("/api/plans/does-not-exist/report.pdf").status_code == 404
    assert client.delete("/api/plans/does-not-exist").status_code == 404


@pytest.mark.parametrize("mutate,needle", [
    (lambda b: b["client"].update(age=17), "age"),
    (lambda b: b["client"].update(age=81), "age"),
    (lambda b: b.update(goals=[]), "goals"),
    (lambda b: b.update(goals=b["goals"] * 4), "goals"),
    (lambda b: b["goals"][0].update(years_to_goal=0), "years_to_goal"),
    (lambda b: b["goals"][0].update(years_to_goal=41), "years_to_goal"),
    (lambda b: b["goals"][0].update(target_amount_today=-1), "target_amount_today"),
    (lambda b: b["goals"][0].update(target_amount_today=10**15), "target_amount_today"),
    (lambda b: b["client"].update(monthly_income=-5), "monthly_income"),
    (lambda b: b["client"].update(monthly_income=10**15), "monthly_income"),
    (lambda b: b["client"].update(retirement_age=45, age=50), "etirement"),
    (lambda b: b["goals"][0].update(years_to_goal=5), "years_to_goal"),
    (lambda b: b["goals"][1].update(existing_investment_earmarked=50_000_000), "earmarked"),
    (lambda b: b.update(consent=False), "onsent"),
    (lambda b: b.update(assumption_overrides={"asset_returns": {"equity": 0.50}}), "equity"),
    (lambda b: b.update(assumption_overrides={"montecarlo": {"sims": 50}}), "sims"),
    (lambda b: b.update(assumption_overrides={"montecarlo": {"sims": 999_999}}), "sims"),
    (lambda b: b.update(assumption_overrides={"planning": {"step_up_default": 0.1}}), "assumption_overrides"),
])
def test_validation_errors_are_readable_422(client, mutate, needle):
    b = body()
    mutate(b)
    r = client.post("/api/plans", json=b)
    assert r.status_code == 422
    j = r.json()
    assert needle in j["detail"] and j["errors"]


def test_missing_and_invalid_answers_422(client):
    b = body()
    b["answers"].pop("q3")
    r = client.post("/api/plans", json=b)
    assert r.status_code == 422 and "q3" in r.json()["detail"]
    b = body()
    b["answers"]["q1"] = 9
    assert client.post("/api/plans", json=b).status_code == 422


def test_assumption_overrides_apply(client):
    base = client.post("/api/plans", json=body()).json()
    hi = client.post("/api/plans", json=body(assumption_overrides={"asset_returns": {"equity": 0.15}})).json()
    assert hi["planning"]["goals"][0]["required_sip"] < base["planning"]["goals"][0]["required_sip"]


def test_assumption_overrides_rejected_when_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("FH_RATE_LIMIT", "false")
    monkeypatch.setenv("FH_ALLOW_ASSUMPTION_OVERRIDES", "false")
    with TestClient(create_app()) as c:
        r = c.post("/api/plans", json=body(assumption_overrides={"asset_returns": {"equity": 0.15}}))
        assert r.status_code == 422
        assert "assumption_overrides" in r.json()["detail"]


def test_delete_plan(client):
    d = client.post("/api/plans", json=body()).json()
    assert client.delete(f"/api/plans/{d['id']}").status_code == 204
    assert client.get(f"/api/plans/{d['id']}").status_code == 404
    assert client.get(f"/api/plans/{d['id']}/report.pdf").status_code == 404
    assert client.delete(f"/api/plans/{d['id']}").status_code == 404


def test_expired_plan_is_gone(client):
    d = client.post("/api/plans", json=body()).json()
    old = (datetime.now(UTC) - timedelta(days=40)).isoformat()
    with sqlite3.connect(sqlite.db_path()) as c:
        c.execute("UPDATE plans SET created_at=? WHERE id=?", (old, d["id"]))
    assert client.get(f"/api/plans/{d['id']}").status_code == 404
    assert client.get(f"/api/plans/{d['id']}/report.pdf").status_code == 404


def test_head_healthz(client):
    r = client.head("/healthz")
    assert r.status_code == 200
    assert r.content == b""
    assert r.headers.get("x-content-type-options") == "nosniff"


def test_rate_limit_plan_post_and_step_up_get(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("FH_RATE_LIMIT", "true")
    monkeypatch.setenv("FH_PLAN_POST_RATE", "2")
    monkeypatch.setenv("FH_PLAN_GET_RATE", "2")
    monkeypatch.setenv("FH_RATE_WINDOW_SECONDS", "60")
    with TestClient(create_app()) as c:
        assert c.post("/api/plans", json={}).status_code == 422
        assert c.post("/api/plans", json={}).status_code == 422
        limited = c.post("/api/plans", json={})
        assert limited.status_code == 429
        assert "Retry-After" in limited.headers
        assert c.get("/api/plans/missing", params={"step_up": 0.1}).status_code == 404
        assert c.get("/api/plans/missing", params={"step_up": 0.1}).status_code == 404
        assert c.get("/api/plans/missing", params={"step_up": 0.1}).status_code == 429
        assert c.get("/api/plans/missing").status_code == 404


def test_fund_detail(client):
    code = client.post("/api/plans", json=body()).json()["funds"][0]["scheme_code"]
    f = client.get(f"/api/funds/{code}").json()
    assert f["scheme_code"] == code and f["eligible_for_shortlist"] and len(f["nav_monthly"]) > 12
    assert client.get("/api/funds/0000").status_code == 404


def test_no_nan_in_json(client):
    r = client.post("/api/plans", json=body("low_emergency_fund"))
    assert "NaN" not in r.text and "Infinity" not in r.text


def test_cors_header(client):
    r = client.get("/api/meta", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_security_headers(client):
    r = client.get("/healthz")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"
    assert "max-age=63072000" in r.headers.get("strict-transport-security", "")
    assert r.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in r.headers.get("permissions-policy", "")
    assert r.headers.get("content-security-policy") == "default-src 'none'; frame-ancestors 'none'"


def test_docs_off_by_default(monkeypatch):
    monkeypatch.delenv("FH_ENABLE_DOCS", raising=False)
    with TestClient(create_app()) as c:
        assert c.get("/docs").status_code == 404
        assert c.get("/redoc").status_code == 404
        assert c.get("/openapi.json").status_code == 404


def test_docs_enabled_toggle(monkeypatch):
    monkeypatch.setenv("FH_ENABLE_DOCS", "false")
    with TestClient(create_app()) as c:
        assert c.get("/docs").status_code == 404
        assert c.get("/openapi.json").status_code == 404
    monkeypatch.setenv("FH_ENABLE_DOCS", "true")
    with TestClient(create_app()) as c:
        assert c.get("/openapi.json").status_code == 200
        assert c.get("/docs").status_code == 200


def test_fund_detail_direct_and_ineligible(client):
    # Direct plan: informative message with regular equivalent
    r_direct = client.get("/api/funds/135762")
    assert r_direct.status_code == 404
    assert "Direct plans are not offered" in r_direct.json()["detail"]
    assert "Regular equivalent 135759" in r_direct.json()["detail"]

    # Ineligible plan due to data quality (nav_shock)
    r_inel = client.get("/api/funds/133867")
    assert r_inel.status_code == 404
    assert "ineligible" in r_inel.json()["detail"]

    # Non-existent scheme code
    r_none = client.get("/api/funds/0000")
    assert r_none.status_code == 404
    assert r_none.json()["detail"] == "Scheme not found"
