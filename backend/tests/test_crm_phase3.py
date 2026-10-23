# ruff: noqa: F401, F811  (pytest fixtures are imported from test_crm_core)
"""Phase 3 tests: contacts (NRI, minors, nominees), CAS holdings + AUM, SIP alerts, trail commission,
suitability, campaigns, compliance role and RM teams."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.api import auth as auth_module
from app.db import sqlite

from .test_crm_core import _login, _login_as, _make_customer, admin, client, rm, rm2


def seed_scheme(code, name, nav, plan="Regular", category="Equity Scheme - Large Cap Fund"):
    from app.backoffice.repository import BackofficeRepository

    conn = BackofficeRepository()._conn()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO mf_schemes (scheme_code, scheme_name, amc, category, plan, scheme_option, latest_nav, nav_date, base_key, updated_at) "
            "VALUES (?, ?, 'Test AMC', ?, ?, 'Growth', ?, '2026-10-13', ?, '2026-10-13')",
            (code, name, category, plan, nav, name.lower()),
        )


def household(client, name="Fam", rm_id=None):
    body = {"name": name, **({"rm_id": rm_id} if rm_id else {})}
    return client.post("/api/crm/households", json=body).json()


def contact(client, hh, name, **extra):
    r = client.post("/api/crm/contacts", json={"name": name, "household_id": hh["id"], "relation": "self", **extra})
    assert r.status_code == 201, r.text
    return r.json()


def in_days(n):
    from datetime import datetime

    from app.repo_crm_core import IST

    return (datetime.now(IST).date() + timedelta(days=n)).isoformat()


# -- contacts -----------------------------------------------------------------------
def test_contact_has_no_login_and_shows_in_list(client, admin):
    hh = household(client)
    c = contact(client, hh, "Asha Rao", email="asha.rao@example.com", mobile="9812345678")
    assert c["name"] == "Asha Rao" and c["tax_status"] == "resident" and c["fatca_crs"] == "not_collected"
    stored = sqlite.get_customer_by_id(c["customer_id"])
    assert not auth_module._verify_password("password", stored["password_hash"])
    assert client.post("/api/auth/login", json={"identifier": "asha.rao@example.com", "password": "anything12345"}).status_code in (400, 401, 422)
    rows = client.get("/api/crm/contacts").json()
    assert [r["name"] for r in rows] == ["Asha Rao"] and rows[0]["relation"] == "self"
    assert c["customer_id"] in {m["customer_id"] for m in client.get(f"/api/crm/households/{hh['id']}").json()["members"]}


def test_existing_members_are_backfilled_as_contacts(client, admin):
    hh = household(client)
    cust = _make_customer(name="Old Member")
    client.post(f"/api/crm/households/{hh['id']}/members", json={"customer_id": cust["id"], "role": "spouse"})
    rows = client.get("/api/crm/contacts").json()
    assert [(r["name"], r["relation"]) for r in rows] == [("Old Member", "spouse")]


def test_nri_minor_and_nominee_rules(client, admin):
    hh, other = household(client, "A"), household(client, "B")
    # NRI needs a country (not India); NRE/NRO only for NRI/OCI
    assert client.post("/api/crm/contacts", json={"name": "N", "household_id": hh["id"], "tax_status": "nri"}).status_code == 422
    assert client.post("/api/crm/contacts", json={"name": "N", "household_id": hh["id"], "tax_status": "nri", "country": "India"}).status_code == 422
    assert client.post("/api/crm/contacts", json={"name": "N", "household_id": hh["id"], "nre_bank": "HDFC NRE"}).status_code == 422
    nri = contact(client, hh, "Vikram Nair", tax_status="nri", country="UAE", nre_bank="HDFC NRE", nro_bank="SBI NRO", mobile="+971501234567")
    assert nri["tax_status"] == "nri" and nri["mobile"] == "+971501234567"
    # minors need an adult guardian in the same household
    kid = {"name": "Kid", "household_id": hh["id"], "relation": "child", "dob": in_days(-365 * 8)}
    assert client.post("/api/crm/contacts", json=kid).status_code == 422
    assert client.post("/api/crm/contacts", json={**kid, "guardian_contact_id": nri["id"]}).status_code == 201
    stranger = contact(client, other, "Stranger")
    assert client.post("/api/crm/contacts", json={**kid, "guardian_contact_id": stranger["id"]}).status_code == 422
    r = client.post("/api/crm/contacts", json={"name": "Future", "household_id": hh["id"], "dob": in_days(5)})
    assert r.status_code == 422
    # nominee share needs a name
    assert client.post("/api/crm/contacts", json={"name": "X", "household_id": hh["id"], "nominee_pct": 100}).status_code == 422
    # patch re-validates the resulting contact
    c = contact(client, hh, "Pat")
    assert client.patch(f"/api/crm/contacts/{c['id']}", json={"tax_status": "oci"}).status_code == 422
    ok = client.patch(f"/api/crm/contacts/{c['id']}", json={"tax_status": "oci", "country": "USA", "nominee_name": "Spouse", "nominee_pct": 100, "name": "Pat Renamed"})
    assert ok.status_code == 200 and ok.json()["name"] == "Pat Renamed" and "nominee" not in ok.json()["gaps"]
    assert client.patch(f"/api/crm/contacts/{c['id']}", json={"household_id": other["id"]}).status_code == 422


def test_contact_gaps_report_nominee_kyc_and_expiry(client, admin):
    hh = household(client)
    c = contact(client, hh, "Gappy")
    assert set(c["gaps"]) >= {"nominee", "kyc", "fatca_crs"}
    full = contact(client, hh, "Complete", nominee_name="Spouse", nominee_pct=100, fatca_crs="self_certified", kyc_expiry=in_days(400))
    client.post("/api/crm/kyc", json={"customer_id": full["customer_id"], "pan": "ABCDE1234F", "kra_status": "validated"})
    assert client.get(f"/api/crm/contacts/{full['id']}").json()["gaps"] == []
    expired = contact(client, hh, "Expired", nominee_name="N", fatca_crs="self_certified", kyc_expiry=in_days(-3))
    assert "kyc_expired" in expired["gaps"]
    gaps = {g["name"]: g["gaps"] for g in client.get("/api/crm/contacts/gaps").json()}
    assert "Complete" not in gaps and "kyc_expired" in gaps["Expired"]


# -- holdings / AUM / CAS import ------------------------------------------------------------
CAS = """Folio No,AMFI Code,Scheme Name,Closing Units,Cost Value,PAN,Investor Name
1001/01,100001,Alpha Large Cap Fund - Regular Growth,"1,000.500","₹ 1,00,000.00",ABCDE1234F,Meera Iyer
1001/02,100002,Beta Flexi Cap Fund - Direct Growth,200,"20,000",ABCDE1234F,Meera Iyer
2002/01,100001,Alpha Large Cap Fund - Regular Growth,50.25,5000,,Ravi Menon
9999/99,100001,Alpha Large Cap Fund - Regular Growth,10,1000,ZZZZZ9999Z,Nobody Known
3003/01,100001,Alpha Large Cap Fund - Regular Growth,abc,100,,Ravi Menon
4004/01,777777,Unlisted Fund,40,400,,Ravi Menon
"""


@pytest.fixture
def book(client, admin):
    seed_scheme("100001", "Alpha Large Cap Fund - Regular Growth", 50.0, "Regular")
    seed_scheme("100002", "Beta Flexi Cap Fund - Direct Growth", 120.5, "Direct", "Equity Scheme - Flexi Cap Fund")
    hh = household(client, "Iyer family")
    meera = contact(client, hh, "Meera Iyer", mobile="9811111111")
    client.post("/api/crm/kyc", json={"customer_id": meera["customer_id"], "pan": "ABCDE1234F", "kra_status": "validated"})
    ravi = contact(client, hh, "Ravi Menon", mobile="9822222222", relation="spouse")
    return {"hh": hh, "meera": meera, "ravi": ravi}


def test_direct_holding_crud(client, book):
    # Add a holding directly
    meera_id = book['meera']['id']
    res = client.post('/api/crm/holdings', json={
        'contact_id': meera_id,
        'folio': 'FOLIO-MANUAL-1',
        'scheme_code': '100001',
        'units': 50.0,
        'cost': 2500.0,
        'as_of': '2026-10-13',
        'source': 'manual'
    })
    assert res.status_code == 200, res.text
    assert res.json()['created'] == 1

    # Check holdings roll-up
    per = client.get(f'/api/crm/contacts/{meera_id}/holdings').json()
    h = [x for x in per['holdings'] if x['folio'] == 'FOLIO-MANUAL-1'][0]
    assert h['units'] == 50.0
    assert h['cost_paise'] == 250000
    holding_id = h['id']

    # Delete the holding
    del_res = client.delete(f'/api/crm/holdings/{holding_id}')
    assert del_res.status_code == 200, del_res.text
    assert del_res.json()['deleted'] is True

    # Verify deleted
    after = client.get(f'/api/crm/contacts/{meera_id}/holdings').json()
    assert not any(x['folio'] == 'FOLIO-MANUAL-1' for x in after['holdings'])


def test_cas_import_matches_values_and_rolls_up_household_aum(client, book):
    r = client.post("/api/crm/holdings/import", json={"csv_text": CAS, "as_of": "2026-10-13", "source": "cams"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["created"], out["updated"], out["matched_rows"]) == (4, 0, 4)
    reasons = {s["row"]: s["reason"] for s in out["skipped"]}
    assert "no matching contact" in reasons[5] and "not a number" in reasons[6]
    assert out["unvalued_schemes"] == ["777777"]
    # AUM = units x NAV: 1000.5*50 + 200*120.5 + 50.25*50  (the unlisted scheme is NOT counted as zero-valued)
    expected = round(1000.5 * 50 * 100) + round(200 * 120.5 * 100) + round(50.25 * 50 * 100)
    assert out["aum_paise"] == expected
    aum = client.get(f"/api/crm/households/{book['hh']['id']}/aum").json()
    assert aum["aum_paise"] == expected and aum["unvalued"] == 1 and aum["tier"] == "standard"
    assert aum["has_direct_plan"] and [h["scheme_code"] for h in aum["direct_plan_holdings"]] == ["100002"]
    assert {h["contact_name"] for h in aum["holdings"]} == {"Meera Iyer", "Ravi Menon"}
    listed = [h for h in client.get("/api/crm/households").json() if h["id"] == book["hh"]["id"]][0]
    assert listed["aum_paise"] == expected and listed["has_direct_plan"] is True
    assert client.get(f"/api/crm/households/{book['hh']['id']}").json()["aum"]["aum_paise"] == expected
    per = client.get(f"/api/crm/contacts/{book['meera']['id']}/holdings").json()
    assert per["aum_paise"] == round(1000.5 * 50 * 100) + round(200 * 120.5 * 100)


def test_cas_reimport_updates_and_dry_run_writes_nothing(client, book):
    dry = client.post("/api/crm/holdings/import", json={"csv_text": CAS, "dry_run": True}).json()
    assert dry["dry_run"] and dry["created"] == 0 and dry["matched_rows"] == 4
    assert client.get(f"/api/crm/households/{book['hh']['id']}/aum").json()["holdings"] == []
    client.post("/api/crm/holdings/import", json={"csv_text": CAS})
    again = client.post("/api/crm/holdings/import", json={"csv_text": CAS.replace("1,000.500", "2,000")}).json()
    assert (again["created"], again["updated"]) == (0, 4)
    assert len(client.get(f"/api/crm/households/{book['hh']['id']}/aum").json()["holdings"]) == 4


def test_cas_import_validation_and_header_aliases(client, book):
    assert client.post("/api/crm/holdings/import", json={"csv_text": "a,b\n1,2"}).status_code == 422
    assert client.post("/api/crm/holdings/import", json={"csv_text": ""}).status_code == 422
    assert client.post("/api/crm/holdings/import", json={"csv_text": CAS, "as_of": "2999-01-01"}).status_code == 422
    alt = "folio_number;amfi;units;mobile\n7/1;100001;10;9822222222\n"
    r = client.post("/api/crm/holdings/import", json={"csv_text": alt, "as_of": "2026-10-01"}).json()
    assert r["created"] == 1 and r["aum_paise"] == round(10 * 50 * 100)


def test_cas_import_is_scoped_to_the_importers_book(client, rm, rm2):
    seed_scheme("100001", "Alpha Large Cap Fund - Regular Growth", 50.0)
    mine = household(client, "Mine")
    c = contact(client, mine, "Meera Iyer", mobile="9811111111")
    csv = "folio,scheme_code,units,mobile\n1/1,100001,10,9811111111\n"
    _login_as(client, rm2)
    r = client.post("/api/crm/holdings/import", json={"csv_text": csv}).json()
    assert r["matched_rows"] == 0 and "no matching contact" in r["skipped"][0]["reason"]
    assert client.get(f"/api/crm/contacts/{c['id']}/holdings").status_code == 403
    assert client.get(f"/api/crm/households/{mine['id']}/aum").status_code == 403
    _login_as(client, rm)
    assert client.post("/api/crm/holdings/import", json={"csv_text": csv}).json()["matched_rows"] == 1


def test_household_tiers(client, admin):
    seed_scheme("100001", "Alpha", 1000.0)
    for name, units, tier in (("Big", 30000, "platinum"), ("Mid", 5000, "gold"), ("Small", 600, "silver"), ("Tiny", 10, "standard")):
        hh = household(client, name)
        c = contact(client, hh, f"{name} Person", mobile=None)
        client.post("/api/crm/holdings/import", json={"csv_text": f"folio,scheme_code,units,contact_id\n{name},100001,{units},{c['id']}\n"})
        assert client.get(f"/api/crm/households/{hh['id']}/aum").json()["tier"] == tier, name


# -- SIPs ------------------------------------------------------------------------------------------
def test_sip_validation_and_mandate_ownership(client, admin):
    seed_scheme("100001", "Alpha Large Cap Fund - Regular Growth", 50.0)
    hh = household(client)
    a, b = contact(client, hh, "Anil"), contact(client, hh, "Bina", relation="spouse")
    m = client.post("/api/crm/mandates", json={"customer_id": a["customer_id"], "umrn": "UM1", "bank_name": "HDFC"}).json()
    base = {"contact_id": a["id"], "scheme_code": "100001", "amount_paise": 500000, "day": 5, "start_date": "2026-01-05"}
    ok = client.post("/api/crm/sips", json={**base, "mandate_id": m["id"]})
    assert ok.status_code == 201 and ok.json()["scheme_name"].startswith("Alpha")
    assert client.post("/api/crm/sips", json={**base, "contact_id": b["id"], "mandate_id": m["id"]}).status_code == 422  # someone else's mandate
    assert client.post("/api/crm/sips", json={**base, "day": 31}).status_code == 422
    assert client.post("/api/crm/sips", json={**base, "end_date": "2025-01-01"}).status_code == 422
    assert client.post("/api/crm/sips", json={**base, "type": "xyz"}).status_code == 422
    assert client.post("/api/crm/sips", json={**base, "amount_paise": 0}).status_code == 422
    assert client.get("/api/crm/sips/book").json() == {"count": 1, "monthly_paise": 500000}


def test_sip_alerts_become_idempotent_tasks_for_the_household_rm(client, rm, rm2):
    seed_scheme("100001", "Alpha Large Cap Fund - Regular Growth", 50.0)
    hh = household(client, "Alert family")
    c = contact(client, hh, "Chitra")
    m = client.post("/api/crm/mandates", json={"customer_id": c["customer_id"], "umrn": "UM-A"}).json()
    assert client.put(f"/api/crm/mandates/{m['id']}/valid-until", json={"valid_until": in_days(10)}).status_code == 200
    base = {"contact_id": c["id"], "scheme_code": "100001", "amount_paise": 100000, "day": 1, "start_date": "2025-01-01"}
    ending = client.post("/api/crm/sips", json={**base, "end_date": in_days(12), "mandate_id": m["id"]}).json()
    far = client.post("/api/crm/sips", json={**base, "end_date": in_days(200)}).json()
    bounced = client.post("/api/crm/sips", json={**base, "scheme_code": "100001"}).json()
    assert client.post(f"/api/crm/sips/{bounced['id']}/bounce").json()["status"] == "bounced"
    kinds = sorted((a["kind"], a["sip_id"]) for a in client.get("/api/crm/sips/alerts").json())
    assert kinds == sorted([("ending_soon", ending["id"]), ("mandate_expiring", ending["id"]), ("bounce", bounced["id"])])
    assert far["id"] not in {a["sip_id"] for a in client.get("/api/crm/sips/alerts").json()}

    r = client.post("/api/crm/sips/generate-alerts").json()
    assert r["created"] == 3
    tasks = client.get("/api/crm/activities", params={"household_id": hh["id"]}).json()
    assert len(tasks) == 3 and all(t["kind"] == "followup" and t["due_at"] for t in tasks)
    assert {t["subject"].split(":")[0].split(" ")[0] for t in tasks} <= {"SIP", "Mandate"}
    assert all(t["assigned_rm_id"] == rm["id"] for t in tasks)
    assert client.post("/api/crm/sips/generate-alerts").json()["created"] == 0  # idempotent
    # completing the task lets the same alert raise a new one only if the underlying alert still holds
    client.patch(f"/api/crm/activities/{tasks[0]['id']}", json={"done_at": in_days(0)})
    assert client.post("/api/crm/sips/generate-alerts").json()["created"] == 1
    # another RM sees no alerts for this book
    _login_as(client, rm2)
    assert client.get("/api/crm/sips/alerts").json() == []


# -- trail commission ------------------------------------------------------------------------------
def test_trail_commission_upload_summary_and_scope(client, rm, rm2):
    seed_scheme("100001", "Alpha", 50.0)
    admin_user = _login(client, _make_customer("admin"))
    mine = household(client, "Mine", rm_id=rm["id"])
    theirs = household(client, "Theirs", rm_id=rm2["id"])
    a, b = contact(client, mine, "Mine Person"), contact(client, theirs, "Their Person")
    client.post("/api/crm/holdings/import", json={"csv_text": f"folio,scheme_code,units,contact_id\nF1,100001,10,{a['id']}\nF2,100001,10,{b['id']}\n"})
    csv = "Folio,AMFI Code,Month,Brokerage\nF1,100001,Sep-2026,\"1,200.50\"\nF1,100001,2026-10,300\nF2,100001,2026-10,800\nGHOST,100001,2026-10,99\nF1,100001,notamonth,5\n"
    dry = client.post("/api/crm/commissions/import", json={"csv_text": csv, "dry_run": True}).json()
    assert dry["created"] == 0 and dry["lines"] == 4 and dry["skipped"][0]["row"] == 6
    out = client.post("/api/crm/commissions/import", json={"csv_text": csv, "source": "cams-oct.csv"}).json()
    assert out["created"] == 4 and [u["folio"] for u in out["unmatched"]] == ["GHOST"]
    s = client.get("/api/crm/commissions/summary").json()
    assert s["total_paise"] == 120050 + 30000 + 80000 + 9900 and s["unmatched_paise"] == 9900
    assert {h["household_name"]: h["amount_paise"] for h in s["by_household"]} == {"Mine": 150050, "Theirs": 80000}
    assert {r["rm_name"]: r["amount_paise"] for r in s["by_rm"]} == {rm["name"]: 150050, rm2["name"]: 80000}
    assert [m["month"] for m in s["by_month"]] == ["2026-09", "2026-10"]
    only_oct = client.get("/api/crm/commissions/summary", params={"from": "2026-10", "to": "2026-10"}).json()
    assert only_oct["total_paise"] == 30000 + 80000 + 9900
    # re-upload replaces the line instead of doubling it
    again = client.post("/api/crm/commissions/import", json={"csv_text": "folio,scheme_code,month,amount\nF1,100001,2026-10,500\n"}).json()
    assert (again["created"], again["updated"]) == (0, 1)
    assert client.get("/api/crm/commissions/summary", params={"from": "2026-10", "to": "2026-10"}).json()["by_household"][0]["amount_paise"] == 80000
    assert client.get("/api/crm/commissions/summary", params={"from": "oct"}).status_code == 422
    # an RM sees only their own trail and cannot upload
    _login_as(client, rm)
    mine_only = client.get("/api/crm/commissions/summary").json()
    assert [h["household_name"] for h in mine_only["by_household"]] == ["Mine"] and mine_only["unmatched_paise"] == 0
    assert client.post("/api/crm/commissions/import", json={"csv_text": csv}).status_code == 403
    assert admin_user


# -- suitability ------------------------------------------------------------------------------------
def _questions():
    from app.config import load_questionnaire

    return load_questionnaire()["questions"]


def answers(kind):
    """Option indices: 'low' = first option of every question, 'high' = last, or an int for that option."""
    qs = _questions()
    if kind == "low":
        return {q["id"]: 0 for q in qs}
    if kind == "high":
        return {q["id"]: len(q["options"]) - 1 for q in qs}
    return {q["id"]: kind for q in qs}


def test_assessment_sets_band_riskometer_limit_and_review_date(client, admin):
    hh = household(client)
    c = contact(client, hh, "Careful")
    q = client.get("/api/crm/suitability/questionnaire").json()
    assert len(q["questions"]) == 10 and q["riskometer_labels"]["6"] == "Very High"
    r = client.post("/api/crm/suitability/assess", json={"customer_id": c["customer_id"], "answers": answers("low")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["risk_band"] == "Conservative" and body["max_riskometer"] == 2 and body["review_due"] == in_days(365) and body["review_due"] == in_days(365)
    aggressive = client.post("/api/crm/suitability/assess", json={"customer_id": c["customer_id"], "answers": answers("high")}).json()
    assert aggressive["risk_band"] == "Aggressive" and aggressive["max_riskometer"] == 6
    st = client.get("/api/crm/suitability/status", params={"customer_id": c["customer_id"]}).json()["assessment"]
    assert st["valid"] and st["risk_band"] == "Aggressive"  # the latest assessment wins
    assert client.post("/api/crm/suitability/assess", json={"customer_id": c["customer_id"], "answers": {"q1": 3}}).status_code == 422
    assert client.post("/api/crm/suitability/assess", json={"customer_id": c["customer_id"], "answers": answers(9)}).status_code == 422


def test_riskometer_mismatch_warns_then_blocks_and_admin_can_override(client, rm):
    seed_scheme("200001", "Gamma Small Cap", 10.0, category="Equity Scheme - Small Cap Fund")  # riskometer 6
    seed_scheme("200002", "Delta Large Cap", 10.0, category="Equity Scheme - Large Cap Fund")  # riskometer 5
    seed_scheme("200003", "Epsilon Liquid", 10.0, category="Debt Scheme - Liquid Fund")  # riskometer 1
    hh = household(client)
    c = contact(client, hh, "Moderate Mina")
    opp = lambda **kw: client.post("/api/crm/opportunities", json={"product_line": "mutual_fund", "title": "Idea", "household_id": hh["id"], "customer_id": c["customer_id"], **kw})  # noqa: E731
    # no assessment: allowed, but warned
    r = opp(scheme_code="200002")
    assert r.status_code == 201 and "No risk assessment" in r.json()["warnings"][0] and r.json()["riskometer"] == 5
    # Moderate band allows up to riskometer 4
    client.post("/api/crm/suitability/assess", json={"customer_id": c["customer_id"], "answers": answers(2)})
    assert client.get("/api/crm/suitability/status", params={"customer_id": c["customer_id"]}).json()["assessment"]["max_riskometer"] == 4
    ok = opp(scheme_code="200003")
    assert ok.status_code == 201 and "warnings" not in ok.json()
    warn = opp(scheme_code="200002")  # 5 vs limit 4: one step over -> warning
    assert warn.status_code == 201 and "above this client" in warn.json()["warnings"][0] and "above this client" in warn.json()["suitability_note"]
    block = opp(scheme_code="200001")  # 6 vs limit 4: two steps over -> blocked
    assert block.status_code == 422 and "Suitability block" in block.json()["detail"]
    assert opp(scheme_code="200001", suitability_override_reason="x").status_code == 422  # an RM cannot override
    explicit = opp(riskometer=3)
    assert explicit.status_code == 201 and explicit.json()["riskometer"] == 3
    check = client.post("/api/crm/suitability/check", json={"customer_id": c["customer_id"], "scheme_code": "200001"}).json()
    assert check["level"] == "block" and check["riskometer"] == 6
    # PMS defaults to the highest riskometer
    assert client.post("/api/crm/opportunities", json={"product_line": "pms", "title": "PMS", "customer_id": c["customer_id"]}).status_code == 422
    # insurance is not subject to the riskometer check
    assert client.post("/api/crm/opportunities", json={"product_line": "life_insurance", "title": "Term", "customer_id": c["customer_id"]}).status_code == 201
    _login(client, _make_customer("admin"))
    over = opp(scheme_code="200001", suitability_override_reason="Client signed risk-acceptance form")
    assert over.status_code == 201 and "Override by" in over.json()["suitability_note"] and "risk-acceptance" in over.json()["suitability_note"]
    assert opp(scheme_code="200001").status_code == 422  # admin still needs a reason


def test_expired_assessment_warns(client, admin):
    from sqlalchemy import text

    from app.repo_crm_core import _get_engine

    hh = household(client)
    c = contact(client, hh, "Old Profile")
    client.post("/api/crm/suitability/assess", json={"customer_id": c["customer_id"], "answers": answers(2)})
    with _get_engine().begin() as conn:
        conn.execute(text("UPDATE suitability_records SET review_due = '2020-01-01'"))
    r = client.post("/api/crm/opportunities", json={"product_line": "mutual_fund", "title": "x", "customer_id": c["customer_id"], "riskometer": 2})
    assert r.status_code == 201 and "out of date" in r.json()["warnings"][0]
    assert client.get("/api/crm/suitability/status", params={"customer_id": c["customer_id"]}).json()["assessment"]["valid"] is False


# -- campaigns ----------------------------------------------------------------------------------------
def test_campaign_segments_members_and_scope(client, rm, rm2):
    seed_scheme("100001", "Alpha Regular", 1000.0)
    rich_hh, nri_hh, plain_hh = household(client, "Rich"), household(client, "Gulf"), household(client, "Plain")
    rich = contact(client, rich_hh, "Rich Rita")
    nri = contact(client, nri_hh, "Gulf Gopal", tax_status="nri", country="Qatar")
    contact(client, plain_hh, "Plain Pran")
    client.post("/api/crm/holdings/import", json={"csv_text": f"folio,scheme_code,units,contact_id\nR1,100001,6000,{rich['id']}\nG1,100001,50,{nri['id']}\n"})
    client.post("/api/crm/sips", json={"contact_id": nri["id"], "scheme_code": "100001", "amount_paise": 100000, "day": 3, "start_date": "2026-01-03"})

    def preview(seg):
        return {r["name"] for r in client.post("/api/crm/campaigns/preview", json=seg).json()["sample"]}

    assert preview({"tier": ["gold"]}) == {"Rich Rita"}  # 6,000 x 1,000 = ₹60 lakh
    assert preview({"aum_min": 10000, "aum_max": 100000}) == {"Gulf Gopal"}
    assert preview({"tax_status": ["nri"]}) == {"Gulf Gopal"}
    assert preview({"sip_status": "active"}) == {"Gulf Gopal"}
    assert preview({"sip_status": "none"}) == {"Rich Rita", "Plain Pran"}
    assert client.post("/api/crm/campaigns/preview", json={"tier": ["diamond"]}).status_code == 422
    assert client.post("/api/crm/campaigns/preview", json={"aum_min": 5, "aum_max": 1}).status_code == 422

    camp = client.post("/api/crm/campaigns", json={"name": "NRI outreach", "segment": {"tax_status": ["nri"]}}).json()
    assert client.post(f"/api/crm/campaigns/{camp['id']}/populate").json() == {"matched": 1, "added": 1}
    assert client.post(f"/api/crm/campaigns/{camp['id']}/populate").json() == {"matched": 1, "added": 0}  # no duplicates
    got = client.get(f"/api/crm/campaigns/{camp['id']}").json()
    assert got["member_total"] == 1 and got["members"][0]["name"] == "Gulf Gopal" and got["member_counts"] == {"targeted": 1}
    r = client.patch(f"/api/crm/campaigns/{camp['id']}/members/{nri['id']}", json={"status": "responded", "notes": "Wants a call"})
    assert r.json()["status"] == "responded" and r.json()["responded_at"]
    assert client.patch(f"/api/crm/campaigns/{camp['id']}/members/{nri['id']}", json={"status": "bogus"}).status_code == 422
    assert client.patch(f"/api/crm/campaigns/{camp['id']}", json={"status": "active", "name": "NRI 2026"}).json()["status"] == "active"
    listed = client.get("/api/crm/campaigns").json()
    assert listed[0]["member_counts"] == {"responded": 1}


def test_rm_campaign_only_targets_own_book_and_is_private(client, rm, rm2):
    _login(client, _make_customer("admin"))
    mine = household(client, "Mine", rm_id=rm["id"])
    theirs = household(client, "Theirs", rm_id=rm2["id"])
    contact(client, mine, "Mine Person")
    contact(client, theirs, "Their Person")
    _login_as(client, rm)
    camp = client.post("/api/crm/campaigns", json={"name": "Mine", "segment": {}}).json()
    assert client.post(f"/api/crm/campaigns/{camp['id']}/populate").json()["added"] == 1
    assert [m["name"] for m in client.get(f"/api/crm/campaigns/{camp['id']}").json()["members"]] == ["Mine Person"]
    _login_as(client, rm2)
    assert client.get(f"/api/crm/campaigns/{camp['id']}").status_code == 403
    assert client.get("/api/crm/campaigns").json() == []
    assert client.post(f"/api/crm/campaigns/{camp['id']}/populate").status_code == 403


# -- roles: compliance and team leads --------------------------------------------------------------------
def test_compliance_reads_everything_and_writes_nothing(client, rm):
    household(client, "RM's family", rm_id=rm["id"])
    client.post("/api/crm/leads", json={"name": "RM lead"})
    comp = _login(client, _make_customer("compliance"))
    assert comp
    assert [h["name"] for h in client.get("/api/crm/households").json()] == ["RM's family"]
    assert len(client.get("/api/crm/leads").json()) == 1
    for method, url, body in (
        ("post", "/api/crm/households", {"name": "x"}),
        ("post", "/api/crm/leads", {"name": "x"}),
        ("post", "/api/crm/contacts", {"name": "x", "household_id": "y"}),
        ("post", "/api/crm/holdings/import", {"csv_text": "folio,scheme_code,units\n1,2,3"}),
        ("post", "/api/crm/sips/generate-alerts", None),
        ("post", "/api/crm/campaigns", {"name": "x"}),
        ("put", "/api/crm/teams/anyone", {"lead_id": None}),
        ("post", "/api/crm/bulk-reassign", {"entity": "leads", "ids": ["a"]}),
    ):
        r = getattr(client, method)(url, **({"json": body} if body is not None else {}))
        assert r.status_code == 403 and "read-only" in r.json()["detail"], (url, r.text)
    # reads that happen to be POSTs are allowed
    assert client.post("/api/crm/duplicates/check", json={"mobile": "9812345678"}).status_code == 200
    assert client.get("/api/crm/export/leads").status_code == 200
    assert client.get("/api/crm/commissions/summary").status_code == 200


def test_team_lead_sees_and_edits_reports_books_but_not_peers(client, rm, rm2):
    peer = _make_customer("rm")
    admin_user = _login(client, _make_customer("admin"))
    lead = _make_customer("rm")
    assert client.put(f"/api/crm/teams/{rm['id']}", json={"lead_id": lead["id"]}).status_code == 200
    assert client.put(f"/api/crm/teams/{rm2['id']}", json={"lead_id": rm["id"]}).status_code == 200  # two levels deep
    assert client.put(f"/api/crm/teams/{lead['id']}", json={"lead_id": rm2['id']}).status_code == 422  # loop refused
    assert client.put(f"/api/crm/teams/{lead['id']}", json={"lead_id": lead["id"]}).status_code == 422
    assert client.put("/api/crm/teams/nobody", json={"lead_id": None}).status_code == 422
    h_rm = household(client, "RM book", rm_id=rm["id"])
    household(client, "RM2 book", rm_id=rm2["id"])
    h_peer = household(client, "Peer book", rm_id=peer["id"])
    h_lead = household(client, "Lead book", rm_id=lead["id"])
    lead_l = client.post("/api/crm/leads", json={"name": "Report lead", "assigned_rm_id": rm["id"]}).json()
    peer_l = client.post("/api/crm/leads", json={"name": "Peer lead", "assigned_rm_id": peer["id"]}).json()

    _login_as(client, lead)
    names = {h["name"] for h in client.get("/api/crm/households").json()}
    assert names == {"RM book", "RM2 book", "Lead book"}  # reports (direct and indirect) + own, never the peer
    assert {x["name"] for x in client.get("/api/crm/leads").json()} == {"Report lead"}
    assert client.get(f"/api/crm/households/{h_peer['id']}").status_code == 403
    assert client.get(f"/api/crm/leads/{peer_l['id']}").status_code == 403
    # can work reports' records and assign within the team, not outside it
    assert client.patch(f"/api/crm/leads/{lead_l['id']}", json={"notes": "chased"}).status_code == 200
    assert client.patch(f"/api/crm/leads/{lead_l['id']}", json={"assigned_rm_id": rm2["id"]}).status_code == 200
    assert client.patch(f"/api/crm/leads/{lead_l['id']}", json={"assigned_rm_id": peer["id"]}).status_code == 403
    assert client.get(f"/api/crm/households/{h_rm['id']}/aum").status_code == 200
    # the report cannot see upwards
    _login_as(client, rm)
    assert {h["name"] for h in client.get("/api/crm/households").json()} == {"RM book", "RM2 book"}
    assert client.get(f"/api/crm/households/{h_lead['id']}").status_code == 403
    # only an admin changes reporting lines
    assert client.put(f"/api/crm/teams/{rm['id']}", json={"lead_id": None}).status_code == 403
    teams = client.get("/api/crm/teams").json()
    assert set(teams["my_team"]) == {rm["id"], rm2["id"]}
    assert admin_user
    # removing the line takes the visibility away
    _login(client, _make_customer("admin"))
    assert client.put(f"/api/crm/teams/{rm['id']}", json={"lead_id": None}).status_code == 200
    _login_as(client, lead)
    assert {h["name"] for h in client.get("/api/crm/households").json()} == {"Lead book"}


def test_household_without_primary_customer_is_assessed_on_its_primary_member(client, admin):
    """Member order is arbitrary, so the suitability check must pick the primary member, not 'the first one'."""
    seed_scheme("200001", "Gamma Small Cap", 10.0, category="Equity Scheme - Small Cap Fund")
    hh = household(client)
    primary = contact(client, hh, "Primary Pat", relation="self")
    child = contact(client, hh, "Adult Child", relation="child")
    client.post("/api/crm/suitability/assess", json={"customer_id": primary["customer_id"], "answers": answers("low")})
    client.post("/api/crm/suitability/assess", json={"customer_id": child["customer_id"], "answers": answers("high")})
    # the household's limit is the primary member's (Conservative -> 2), whatever the member row order is
    r = client.post("/api/crm/opportunities", json={"product_line": "mutual_fund", "title": "x", "household_id": hh["id"], "scheme_code": "200001"})
    assert r.status_code == 422 and "Suitability block" in r.json()["detail"]
