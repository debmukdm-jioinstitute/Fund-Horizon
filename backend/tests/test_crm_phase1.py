# ruff: noqa: F401, F811  (pytest fixtures are imported from test_crm_core)
"""Phase 1 (security & correctness) tests: RM isolation, atomic lead conversion,
won/lost pipeline rules, validation, pagination, audit log and schema hardening."""

from __future__ import annotations

import pytest

from app.db import sqlite
from app.repo_crm_core import get_crm_repository

from .test_crm_core import (  # noqa: F401  (fixtures + helpers)
    _login,
    _login_as,
    _make_customer,
    admin,
    client,
    rm,
    rm2,
)


def _admin_session(client):
    return _login(client, _make_customer("admin"))


# ---------------------------------------------------------------------------
# 1. Household member add
# ---------------------------------------------------------------------------
def test_rm_cannot_add_other_rms_customer_to_household(client, rm, rm2):
    mine = client.post("/api/crm/households", json={"name": "Mine"}).json()
    _login_as(client, rm2)
    theirs = client.post("/api/crm/households", json={"name": "Theirs"}).json()
    victim = _make_customer()
    assert client.post(
        f"/api/crm/households/{theirs['id']}/members", json={"customer_id": victim["id"], "role": "primary"}
    ).status_code == 201

    _login_as(client, rm)
    r = client.post(f"/api/crm/households/{mine['id']}/members", json={"customer_id": victim["id"], "role": "other"})
    assert r.status_code == 403  # out of this RM's scope and already attached elsewhere


def test_rm_can_add_brand_new_customer_but_not_override(client, rm):
    h = client.post("/api/crm/households", json={"name": "Fam"}).json()
    fresh = _make_customer()
    assert client.post(
        f"/api/crm/households/{h['id']}/members", json={"customer_id": fresh["id"], "role": "primary"}
    ).status_code == 201
    other = client.post("/api/crm/households", json={"name": "Fam2"}).json()
    r = client.post(f"/api/crm/households/{other['id']}/members", json={"customer_id": fresh["id"], "override": True})
    assert r.status_code == 403
    r = client.post(f"/api/crm/households/{other['id']}/members", json={"customer_id": fresh["id"]})
    assert r.status_code == 422 and "another household" in r.json()["detail"]


def test_admin_needs_explicit_override_for_second_household(client, admin):
    a = client.post("/api/crm/households", json={"name": "A"}).json()
    b = client.post("/api/crm/households", json={"name": "B"}).json()
    c = _make_customer()
    assert client.post(f"/api/crm/households/{a['id']}/members", json={"customer_id": c["id"]}).status_code == 201
    r = client.post(f"/api/crm/households/{b['id']}/members", json={"customer_id": c["id"]})
    assert r.status_code == 422 and "A" in r.json()["detail"]
    r = client.post(f"/api/crm/households/{b['id']}/members", json={"customer_id": c["id"], "override": True})
    assert r.status_code == 201


# ---------------------------------------------------------------------------
# 2. assigned_rm_id rules + RM isolation
# ---------------------------------------------------------------------------
def test_rm_cannot_assign_to_another_rm(client, rm, rm2):
    for path, payload in (
        ("/api/crm/leads", {"name": "L"}),
        ("/api/crm/opportunities", {"product_line": "pms", "title": "O"}),
        ("/api/crm/activities", {"kind": "note", "subject": "S"}),
    ):
        r = client.post(path, json={**payload, "assigned_rm_id": rm2["id"]})
        assert r.status_code == 403, (path, r.text)
        r = client.post(path, json=payload)  # defaults to the caller
        assert r.status_code == 201 and r.json()["assigned_rm_id"] == rm["id"]
        rec = r.json()
        r = client.patch(f"{path}/{rec['id']}", json={"assigned_rm_id": rm2["id"]})
        assert r.status_code == 403
        r = client.patch(f"{path}/{rec['id']}", json={"assigned_rm_id": None})
        assert r.status_code == 403  # RMs cannot unassign either


def test_admin_can_assign_anyone_and_unassigned_leads_are_admin_only(client, rm):
    _admin_session(client)  # the rm fixture logs in as the RM; switch back to an admin
    lead = client.post("/api/crm/leads", json={"name": "Pool"}).json()
    assert lead["assigned_rm_id"] is None
    assigned = client.patch(f"/api/crm/leads/{lead['id']}", json={"assigned_rm_id": rm["id"]})
    assert assigned.status_code == 200
    pool = client.post("/api/crm/leads", json={"name": "Pool 2"}).json()

    _login_as(client, rm)
    ids = {x["id"] for x in client.get("/api/crm/leads").json()}
    assert lead["id"] in ids and pool["id"] not in ids
    assert client.patch(f"/api/crm/leads/{pool['id']}", json={"notes": "x"}).status_code == 403


def test_rm_a_cannot_see_add_or_reassign_rm_b_records(client, rm, rm2):
    b_house = None
    _login_as(client, rm2)
    b_house = client.post("/api/crm/households", json={"name": "B House"}).json()
    b_lead = client.post("/api/crm/leads", json={"name": "B Lead"}).json()
    b_opp = client.post(
        "/api/crm/opportunities", json={"household_id": b_house["id"], "product_line": "mutual_fund", "title": "B"}
    ).json()
    b_task = client.post("/api/crm/activities", json={"kind": "note", "subject": "B task"}).json()

    _login_as(client, rm)
    assert b_house["id"] not in {h["id"] for h in client.get("/api/crm/households").json()}
    assert b_lead["id"] not in {x["id"] for x in client.get("/api/crm/leads").json()}
    assert b_opp["id"] not in {x["id"] for x in client.get("/api/crm/opportunities").json()}
    assert b_task["id"] not in {x["id"] for x in client.get("/api/crm/activities").json()}
    for method, url, body in (
        ("get", f"/api/crm/households/{b_house['id']}", None),
        ("patch", f"/api/crm/leads/{b_lead['id']}", {"assigned_rm_id": rm["id"]}),
        ("patch", f"/api/crm/opportunities/{b_opp['id']}", {"assigned_rm_id": rm["id"]}),
        ("patch", f"/api/crm/activities/{b_task['id']}", {"assigned_rm_id": rm["id"]}),
        ("post", f"/api/crm/households/{b_house['id']}/members", {"customer_id": _make_customer()["id"]}),
    ):
        r = getattr(client, method)(url, **({"json": body} if body is not None else {}))
        assert r.status_code == 403, (method, url, r.text)


# ---------------------------------------------------------------------------
# 3. Lead conversion
# ---------------------------------------------------------------------------
def test_convert_without_invite_creates_no_usable_login(client, admin):
    lead = client.post("/api/crm/leads", json={"name": "No Login", "email": "nologin@example.com"}).json()
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "temp_password" not in body and body["invited"] is False
    cust = sqlite.get_customer_by_id(body["customer_id"])
    assert cust["email"] == "nologin@example.com"
    assert cust["mobile"].startswith("0000")  # only email given: placeholder mobile, never a valid Indian number
    stored = client.get(f"/api/crm/leads/{lead['id']}") if False else get_crm_repository().get_lead(lead["id"])
    assert stored["status"] == "converted"
    assert stored["converted_household_id"] == body["household_id"] and stored["converted_at"]


def test_convert_requires_only_one_of_email_or_mobile(client, admin):
    only_mobile = client.post("/api/crm/leads", json={"name": "Mobile Only", "mobile": "9811111111"}).json()
    r = client.post(f"/api/crm/leads/{only_mobile['id']}/convert", json={})
    assert r.status_code == 200, r.text
    assert sqlite.get_customer_by_id(r.json()["customer_id"])["email"].endswith("@placeholder.invalid")
    neither = client.post("/api/crm/leads", json={"name": "Nothing"}).json()
    assert client.post(f"/api/crm/leads/{neither['id']}/convert", json={}).status_code == 422


def test_convert_into_existing_household_and_one_way(client, admin):
    h = client.post("/api/crm/households", json={"name": "Existing"}).json()
    lead = client.post("/api/crm/leads", json={"name": "Spouse", "email": "spouse@example.com"}).json()
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={"household_id": h["id"], "member_role": "spouse"})
    assert r.status_code == 200 and r.json()["household_id"] == h["id"]
    members = client.get(f"/api/crm/households/{h['id']}").json()["members"]
    assert [m["role"] for m in members] == ["spouse"]
    # one-way: no re-conversion, no reopening, no setting converted by hand
    assert client.post(f"/api/crm/leads/{lead['id']}/convert", json={}).status_code == 422
    assert client.patch(f"/api/crm/leads/{lead['id']}", json={"status": "new"}).status_code == 422
    other = client.post("/api/crm/leads", json={"name": "X", "email": "x1@example.com"}).json()
    assert client.patch(f"/api/crm/leads/{other['id']}", json={"status": "converted"}).status_code == 422


def test_convert_is_atomic_on_failure(client, admin, monkeypatch):
    """A failure at the last step (after customer + household were written) must roll everything back."""
    from app import repo_crm_core as repo_mod

    lead = client.post("/api/crm/leads", json={"name": "Atomic", "email": "atomic@example.com"}).json()
    repo = get_crm_repository()
    before_households = len(repo.list_households())

    def boom(*args, **kwargs):
        raise RuntimeError("simulated failure while marking the lead converted")

    with monkeypatch.context() as m, pytest.raises(RuntimeError):
        m.setattr(repo_mod, "_update", boom)
        repo.convert_lead(lead["id"], actor_id=None, owner_rm_id=None, password_hash="x")

    assert sqlite.get_customer_by_email("atomic@example.com") is None
    assert repo.get_lead(lead["id"])["status"] == "new"
    assert len(repo.list_households()) == before_households
    # and a retry succeeds cleanly
    assert client.post(f"/api/crm/leads/{lead['id']}/convert", json={}).status_code == 200


def test_rm_cannot_convert_into_other_rms_household(client, rm, rm2):
    _login_as(client, rm2)
    theirs = client.post("/api/crm/households", json={"name": "Theirs"}).json()
    _login_as(client, rm)
    lead = client.post("/api/crm/leads", json={"name": "Mine", "email": "mine1@example.com"}).json()
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={"household_id": theirs["id"]})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# 4. Pipeline: won / lost
# ---------------------------------------------------------------------------
def _opp(client, **kw):
    return client.post(
        "/api/crm/opportunities", json={"product_line": "mutual_fund", "title": "SIP", "amount": 100000, **kw}
    ).json()


def test_lost_requires_reason_and_sets_closed_at(client, admin):
    o = _opp(client)
    assert client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "lost"}).status_code == 422
    r = client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "lost", "lost_reason": "price"})
    assert r.status_code == 200
    assert r.json()["lost_reason"] == "price" and r.json()["closed_at"] and r.json()["probability"] == 0


def test_won_sets_closed_at_and_won_amount_and_is_final(client, admin):
    o = _opp(client)
    # only the last open stage can win
    r = client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "won"})
    assert r.status_code == 422 and "Cannot move" in r.json()["detail"]
    client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "sip_active"})
    r = client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "won", "won_amount": 90000})
    assert r.status_code == 200
    assert r.json()["won_amount"] == 90000 and r.json()["closed_at"] and r.json()["probability"] == 100
    assert client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "discussion"}).status_code == 422
    assert client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "lost", "lost_reason": "x"}).status_code == 422


def test_won_defaults_to_amount_and_needs_one(client, admin):
    o = _opp(client, amount=None)
    client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "sip_active"})
    assert client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "won"}).status_code == 422
    p = _opp(client, amount=555)
    client.patch(f"/api/crm/opportunities/{p['id']}", json={"stage": "sip_active"})
    r = client.patch(f"/api/crm/opportunities/{p['id']}", json={"stage": "won"})
    assert r.json()["won_amount"] == 555


def test_open_pipeline_excludes_won_and_lost_and_reports_closed(client, admin):
    keep = _opp(client, amount=100)
    won = _opp(client, amount=200)
    client.patch(f"/api/crm/opportunities/{won['id']}", json={"stage": "sip_active"})
    client.patch(f"/api/crm/opportunities/{won['id']}", json={"stage": "won"})
    lost = _opp(client, amount=400)
    client.patch(f"/api/crm/opportunities/{lost['id']}", json={"stage": "lost", "lost_reason": "no"})
    body = client.get("/api/crm/pipeline", params={"product_line": "mutual_fund"}).json()
    assert body["total_count"] == 1 and body["total_value"] == 100
    assert body["closed"] == {"won": {"count": 1, "value": 200}, "lost": {"count": 1, "value": 400}}
    assert {s["stage"] for s in body["stages"]} == {"illustration", "discussion", "invested", "sip_active"}
    h = client.post("/api/crm/households", json={"name": "Open"}).json()
    _opp(client, household_id=h["id"])
    done = _opp(client, household_id=h["id"])
    client.patch(f"/api/crm/opportunities/{done['id']}", json={"stage": "lost", "lost_reason": "no"})
    row = [x for x in client.get("/api/crm/households").json() if x["id"] == h["id"]][0]
    assert row["open_opportunities"] == 1
    assert keep["probability"] == 20  # default from stage


def test_stage_change_sets_default_probability_and_cannot_create_closed(client, admin):
    o = _opp(client)
    r = client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "invested"})
    assert r.json()["probability"] == 60
    r = client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "discussion", "probability": 33})
    assert r.json()["probability"] == 33
    assert client.post(
        "/api/crm/opportunities", json={"product_line": "pms", "title": "x", "stage": "won"}
    ).status_code == 422


# ---------------------------------------------------------------------------
# 5. Validation
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "mobile,ok",
    [("9876543210", True), ("+91 98765 43210", True), ("5876543210", False), ("98765", False), ("+14155550123", True),
     ("+1", False)],
)
def test_lead_mobile_validation(client, admin, mobile, ok):
    r = client.post("/api/crm/leads", json={"name": "V", "mobile": mobile})
    assert (r.status_code == 201) is ok, r.text


def test_lead_email_validation(client, admin):
    assert client.post("/api/crm/leads", json={"name": "V", "email": "nope"}).status_code == 422


def test_task_and_case_subject_required_and_due_date_warning(client, admin):
    assert client.post("/api/crm/activities", json={"kind": "note", "subject": "   "}).status_code == 422
    assert client.post("/api/crm/activities", json={"kind": "note"}).status_code == 422
    r = client.post("/api/crm/activities", json={"kind": "followup", "subject": "Late", "due_at": "2020-01-01"})
    assert r.status_code == 201 and r.json()["warnings"] == ["due_at is in the past"]
    r = client.post("/api/crm/activities", json={"kind": "followup", "subject": "Fine", "due_at": "2999-01-01"})
    assert "warnings" not in r.json()
    cust = _make_customer()
    assert client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "kyc", "subject": " "}).status_code == 422
    assert client.post("/api/crm/cases", json={"customer_id": cust["id"], "subject": "x"}).status_code == 422
    assert client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "", "subject": "x"}).status_code == 422


def test_pan_validation_and_only_last4_kept(client, admin):
    c = _make_customer()
    assert client.post("/api/crm/kyc", json={"customer_id": c["id"], "pan": "abcde1234"}).status_code == 422
    r = client.post("/api/crm/kyc", json={"customer_id": c["id"], "pan": "abcde1234f"})
    assert r.status_code == 200 and r.json()["record"]["pan_last4"] == "234F"
    assert "pan" not in r.json()["record"]


def test_consent_unknown_customer_404(client, admin):
    r = client.post("/api/crm/consents", json={"customer_id": "nope", "purpose": "marketing", "granted": True})
    assert r.status_code == 404 and r.json()["detail"] == "Customer not found"


# ---------------------------------------------------------------------------
# 6. Pagination, schema hardening
# ---------------------------------------------------------------------------
def test_lists_paginate_sort_search(client, admin):
    for n in range(7):
        client.post("/api/crm/households", json={"name": f"Fam {n:02d}"})
    client.post("/api/crm/households", json={"name": "Zeta Clan"})
    r = client.get("/api/crm/households", params={"limit": 3, "offset": 0, "sort": "name"})
    assert [h["name"] for h in r.json()] == ["Fam 00", "Fam 01", "Fam 02"]
    assert r.headers["X-Total-Count"] == "8"
    r = client.get("/api/crm/households", params={"limit": 3, "sort": "-name"})
    assert r.json()[0]["name"] == "Zeta Clan"
    r = client.get("/api/crm/households", params={"q": "zeta"})
    assert [h["name"] for h in r.json()] == ["Zeta Clan"] and r.headers["X-Total-Count"] == "1"
    assert client.get("/api/crm/households", params={"sort": "drop table"}).status_code == 422
    assert client.get("/api/crm/households", params={"limit": 0}).status_code == 422
    assert len(client.get("/api/crm/households").json()) == 8  # default limit 50


def test_list_endpoints_all_accept_paging(client, admin):
    c = _make_customer()
    for path in (
        "/api/crm/leads", "/api/crm/opportunities", "/api/crm/activities", "/api/crm/cases", "/api/crm/renewals",
        "/api/crm/maturities", "/api/crm/policies", "/api/crm/fds", "/api/crm/pms", "/api/crm/mandates",
        "/api/crm/disclosures",
    ):
        r = client.get(path, params={"limit": 5, "offset": 0, "q": "zzz"})
        assert r.status_code == 200 and r.headers["X-Total-Count"] == "0", path
    assert c  # silence unused


def test_indexes_and_unique_keys_exist(client, admin):
    from sqlalchemy import inspect

    from app.repo_crm_core import _get_engine

    client.get("/api/crm/policies")  # triggers products schema + hardening
    insp = inspect(_get_engine())

    def has_index(table, col):
        return any(col in i["column_names"] for i in insp.get_indexes(table))

    assert has_index("opportunities", "assigned_rm_id") and has_index("households", "rm_id")
    assert has_index("leads", "email") and has_index("leads", "mobile") and has_index("cases", "sla_due_at")
    uniq = {(t, tuple(i["column_names"])) for t in ("mandates", "insurance_policies") for i in insp.get_indexes(t) if i["unique"]}
    assert ("mandates", ("umrn",)) in uniq and ("insurance_policies", ("policy_no",)) in uniq


def test_duplicate_umrn_and_policy_no_rejected(client, admin):
    c = _make_customer()
    m = {"customer_id": c["id"], "umrn": "UMRN123"}
    assert client.post("/api/crm/mandates", json=m).status_code == 201
    r = client.post("/api/crm/mandates", json=m)
    assert r.status_code == 422 and "UMRN" in r.json()["detail"]
    assert client.post("/api/crm/mandates", json={"customer_id": c["id"], "umrn": ""}).status_code == 201
    assert client.post("/api/crm/mandates", json={"customer_id": c["id"], "umrn": " "}).status_code == 201  # blanks ≠ duplicates
    p = {"customer_id": c["id"], "policy_type": "term", "policy_no": "POL-1"}
    assert client.post("/api/crm/policies", json=p).status_code == 201
    assert client.post("/api/crm/policies", json=p).status_code == 422


# ---------------------------------------------------------------------------
# 7. Audit
# ---------------------------------------------------------------------------
def test_every_write_is_audited_and_stamped(client, admin):
    repo = get_crm_repository()
    h = client.post("/api/crm/households", json={"name": "Audit Fam"}).json()
    assert h["created_by"] == admin["id"] and h["updated_by"] == admin["id"] and h["updated_at"]
    client.patch(f"/api/crm/households/{h['id']}", json={"name": "Audit Family", "notes": "n"})
    rows = {a["field"]: a for a in repo.list_audit("household", h["id"])}
    assert rows["_created"]["actor_id"] == admin["id"]
    assert (rows["name"]["old"], rows["name"]["new"]) == ("Audit Fam", "Audit Family")
    assert rows["notes"]["old"] is None and rows["notes"]["new"] == "n"
    assert "updated_at" not in rows

    c = _make_customer()
    m = client.post("/api/crm/mandates", json={"customer_id": c["id"], "umrn": "U1"}).json()
    client.patch(f"/api/crm/mandates/{m['id']}", json={"status": "approved"})
    fields = {a["field"]: a for a in repo.list_audit("mandate", m["id"])}
    assert fields["status"]["old"] == "registered" and fields["status"]["new"] == "approved"
    # product rows are stamped too
    from sqlalchemy import text

    from app.repo_crm_core import _get_engine

    with _get_engine().connect() as conn:
        by = conn.execute(text("SELECT created_by, updated_by FROM mandates WHERE id = :i"), {"i": m["id"]}).one()
    assert by == (admin["id"], admin["id"])

    opp = _opp(client)
    client.patch(f"/api/crm/opportunities/{opp['id']}", json={"stage": "lost", "lost_reason": "r"})
    changed = {a["field"] for a in repo.list_audit("opportunity", opp["id"])}
    assert {"_created", "stage", "lost_reason", "closed_at", "probability"} <= changed
    lead = client.post("/api/crm/leads", json={"name": "AL", "email": "al@example.com"}).json()
    client.post(f"/api/crm/leads/{lead['id']}/convert", json={})
    assert {a["field"] for a in repo.list_audit("lead", lead["id"])} >= {"_created", "status", "converted_household_id"}


# ---------------------------------------------------------------------------
# 8. Legacy data
# ---------------------------------------------------------------------------
def test_legacy_closed_stages_migrate_to_won(client, admin):
    from sqlalchemy import text

    from app import repo_crm_core as repo_mod

    o = _opp(client, amount=700)
    engine = repo_mod._get_engine()
    with engine.begin() as conn:
        conn.execute(text("UPDATE opportunities SET stage = 'closed', won_amount = NULL WHERE id = :i"), {"i": o["id"]})
    repo_mod._harden_core(engine)
    migrated = get_crm_repository().get_opportunity(o["id"])
    assert migrated["stage"] == "won" and migrated["won_amount"] == 700 and migrated["closed_at"]


# ---------------------------------------------------------------------------
# 9. Record-by-id reads (used by the /backoffice/crm/<entity>/<id> pages)
# ---------------------------------------------------------------------------
def test_record_reads_by_id_respect_scope(client, rm, rm2):
    _login_as(client, rm2)
    lead = client.post("/api/crm/leads", json={"name": "B Lead"}).json()
    opp = client.post("/api/crm/opportunities", json={"product_line": "pms", "title": "B"}).json()
    cust = _make_customer()
    hh = client.post("/api/crm/households", json={"name": "B HH"}).json()
    client.post(f"/api/crm/households/{hh['id']}/members", json={"customer_id": cust["id"], "role": "primary"})
    case = client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "kyc", "subject": "s"}).json()
    for url in (f"/api/crm/leads/{lead['id']}", f"/api/crm/opportunities/{opp['id']}", f"/api/crm/cases/{case['id']}"):
        assert client.get(url).status_code == 200, url
    assert client.get(f"/api/crm/cases/{case['id']}").json()["customer_name"] == cust["name"]

    _login_as(client, rm)
    for url in (f"/api/crm/leads/{lead['id']}", f"/api/crm/opportunities/{opp['id']}", f"/api/crm/cases/{case['id']}"):
        assert client.get(url).status_code == 403, url
        assert client.get(url.rsplit("/", 1)[0] + "/does-not-exist").status_code == 404
