import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

RAW = json.loads((Path(__file__).parent / "fixtures" / "personas.json").read_text())


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["FH_DB_PATH"] = str(tmp_path_factory.mktemp("db") / "t.db")
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
    for key in ("id", "profile", "allocation", "funds", "stress_test", "planning", "disclosures"):
        assert key in d
    got = client.get(f"/api/plans/{d['id']}").json()
    assert got["profile"]["band"] == d["profile"]["band"]
    assert len(d["funds"]) <= 8


def test_recompute_with_step_up_changes_sip(client):
    d = client.post("/api/plans", json=body("mid_career_dependents")).json()
    s = client.get(f"/api/plans/{d['id']}", params={"step_up": 0.1}).json()
    assert s["planning"]["step_up"] == 0.1
    assert s["planning"]["goals"][0]["required_sip"] < d["planning"]["goals"][0]["required_sip"]
    assert client.get(f"/api/plans/{d['id']}").json()["planning"]["step_up"] == 0.0


def test_unknown_plan_404(client):
    assert client.get("/api/plans/does-not-exist").status_code == 404
    assert client.get("/api/plans/does-not-exist/report.pdf").status_code == 404


@pytest.mark.parametrize("mutate,needle", [
    (lambda b: b["client"].update(age=17), "age"),
    (lambda b: b["client"].update(age=81), "age"),
    (lambda b: b.update(goals=[]), "goals"),
    (lambda b: b.update(goals=b["goals"] * 4), "goals"),
    (lambda b: b["goals"][0].update(years_to_goal=0), "years_to_goal"),
    (lambda b: b["goals"][0].update(years_to_goal=41), "years_to_goal"),
    (lambda b: b["goals"][0].update(target_amount_today=-1), "target_amount_today"),
    (lambda b: b["client"].update(monthly_income=-5), "monthly_income"),
    (lambda b: b["client"].update(retirement_age=45, age=50), "etirement"),
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
