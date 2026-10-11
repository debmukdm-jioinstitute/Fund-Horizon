import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

FIX = Path(__file__).parent / "fixtures"
TAX = json.loads((FIX / "tax_personas.json").read_text())
BASE = json.loads((FIX / "personas.json").read_text())


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["FH_DB_PATH"] = str(tmp_path_factory.mktemp("db") / "t.db")
    os.environ["FH_RATE_LIMIT"] = "false"
    with TestClient(create_app()) as c:
        yield c


def make(client, raw):
    r = client.post("/api/plans", json=raw)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_plan_with_tax_profile(client):
    p = make(client, TAX["salaried_deductions"])
    t = p["tax"]
    assert t["enabled"] and t["regimes"]["new"]["total_tax"] == 204_880
    assert t["fy"] == "2026-27" and t["verified"] is False and t["sources"]
    assert "_post_tax_marginal" not in t and "_reinvest_monthly" not in t


def test_plan_without_tax_still_works(client):
    p = make(client, BASE["young_aggressive"])
    assert p["tax"]["enabled"] is False


def test_recompute_with_switches_not_persisted(client):
    p = make(client, TAX["salaried_deductions"])
    r = client.get(f"/api/plans/{p['id']}", params={"regime": "old", "tax_view": "post",
                                                    "apply": "sec_80c,nps_1b", "reinvest": "true"}).json()
    assert r["tax"]["regime_in_force"] == "old" and r["tax"]["switches"]["tax_view"] == "post"
    assert set(r["tax"]["applied"]["applied"]) == {"sec_80c", "nps_1b"}
    assert "post_tax_goal_delta" in r["tax"]
    again = client.get(f"/api/plans/{p['id']}").json()
    assert again["tax"]["switches"]["regime"] == "auto" and "post_tax_goal_delta" not in again["tax"]


def test_recompute_rejects_bad_switch_values(client):
    p = make(client, TAX["senior_income"])
    assert client.get(f"/api/plans/{p['id']}", params={"regime": "weird"}).status_code == 422
    assert client.get(f"/api/plans/{p['id']}", params={"tax_view": "later"}).status_code == 422


def test_step_up_still_recomputes_and_keeps_tax(client):
    p = make(client, TAX["salaried_deductions"])
    r = client.get(f"/api/plans/{p['id']}", params={"step_up": 0.05}).json()
    assert r["planning"]["step_up"] == 0.05 and r["tax"]["enabled"]


@pytest.mark.parametrize("mutate,needle", [
    (lambda t: t.update(bracket_pct=17, mode="bracket_only"), "bracket"),
    (lambda t: t.update(mode="bracket_only", bracket_pct=None), "bracket"),
    (lambda t: t.update(gross_income_annual=-1), "gross_income_annual"),
    (lambda t: t.update(employer_nps_pct=20), "employer_nps_pct"),
    (lambda t: t.update(regime_current="maybe"), "regime_current"),
    (lambda t: t.update(not_a_field=1), "not_a_field"),
])
def test_tax_profile_validation(client, mutate, needle):
    raw = copy.deepcopy(TAX["salaried_deductions"])
    mutate(raw["client"]["tax"])
    r = client.post("/api/plans", json=raw)
    assert r.status_code == 422 and needle in r.text


def test_bad_tax_switches_rejected(client):
    raw = copy.deepcopy(TAX["senior_income"])
    raw["tax_switches"] = {"regime": "nope"}
    assert client.post("/api/plans", json=raw).status_code == 422


def test_tax_rules_endpoint(client):
    r = client.get("/api/tax/rules").json()
    assert r["fy"] == "2026-27" and r["verified"] is False and r["new_regime"]["std_deduction"] == 75_000
    assert r["limits"]["sec_80c"] == 150_000 and r["sources"] and "chartered accountant" in r["disclosure"]


def test_catalog_endpoints(client):
    c = client.get("/api/tax/catalog").json()
    assert len(c["instruments"]) >= 20 and "govt_scheme" in c["kinds"]
    assert {i["id"] for i in client.get("/api/tax/catalog", params={"kind": "govt_scheme"}).json()["instruments"]} >= {"ppf", "ssy"}
    hits = client.get("/api/tax/catalog", params={"q": "lock-in"}).json()["instruments"]
    assert any(i["id"] == "elss" for i in hits)
    assert client.get("/api/tax/catalog", params={"q": "zzzzzz"}).json()["instruments"] == []
    one = client.get("/api/tax/catalog/ppf").json()["instrument"]
    assert one["name"].startswith("Public Provident") and "7.1%" in one["return_note"]
    assert client.get("/api/tax/catalog/nope").status_code == 404


def test_tax_calc_endpoint_stateless(client):
    body = {"age": 38, "employment_type": "salaried_private", "goals": [{"type": "retirement", "years": 20}],
            "tax": TAX["salaried_deductions"]["client"]["tax"]}
    r = client.post("/api/tax/calc", json=body).json()
    assert r["regimes"]["old"]["total_tax"] == 311_064 and r["regimes"]["new"]["total_tax"] == 204_880
    assert [x["years"] for x in r["after_tax_returns"]] == [1, 3, 5, 10, 15]
    assert all(x["debt"] < r["pre_tax_returns"]["debt"] for x in r["after_tax_returns"])
    assert "_post_tax_marginal" not in r and r["disclosure"]
    bad = client.post("/api/tax/calc", json={**body, "age": 12})
    assert bad.status_code == 422


def test_fund_detail_has_tax_tag(client):
    p = make(client, BASE["young_aggressive"])
    code = p["funds"][0]["scheme_code"]
    f = client.get(f"/api/funds/{code}").json()
    assert f["tax_tag"]["label"] and "note" in f["tax_tag"]


def test_ai_explain_plan_by_id_no_longer_500(client):
    p = make(client, TAX["salaried_deductions"])
    r = client.post("/api/ai/explain/plan", json={"plan_id": p["id"]})
    assert r.status_code == 200 and "Summary of Your Financial Plan" in r.json()["explanation"]
    assert "₹" in r.json()["explanation"] and "0" != r.json()["explanation"]


def test_ai_explain_tax_deterministic(client):
    p = make(client, TAX["salaried_deductions"])
    r = client.post("/api/ai/explain/tax", json={"plan_id": p["id"]})
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "tax" and "₹2,04,880" in j["explanation"] and "₹3,11,064" in j["explanation"]
    one = client.post("/api/ai/explain/tax", json={"plan_id": p["id"], "nudge_id": "employer_nps"}).json()
    assert "employer NPS" in one["explanation"].replace("Employer NPS", "employer NPS")
    assert client.post("/api/ai/explain/tax", json={"plan_id": "missing"}).status_code == 404
    no_tax = make(client, BASE["young_aggressive"])
    assert client.post("/api/ai/explain/tax", json={"plan_id": no_tax["id"]}).status_code == 400
