# ruff: noqa: F401, F811  (pytest fixtures are imported from test_crm_core)
"""Phase 2 tests: saved views, contacts, search, duplicates, timeline, bulk reassign, CSV export."""

from __future__ import annotations

from .test_crm_core import _login, _login_as, _make_customer, admin, client, rm, rm2


def _household_with_member(client, name="Fam", mobile=None):
    h = client.post("/api/crm/households", json={"name": name}).json()
    c = _make_customer()
    client.post(f"/api/crm/households/{h['id']}/members", json={"customer_id": c["id"], "role": "primary"})
    return h, c


# -- saved views ---------------------------------------------------------------
def test_builtin_views_listed_and_read_only(client, admin):
    views = client.get("/api/crm/views").json()
    names = {v["name"] for v in views if v["builtin"]}
    assert {"My open leads", "Overdue tasks", "SLA breaching cases"} <= names
    assert client.patch("/api/crm/views/builtin:overdue-tasks", json={"name": "x"}).status_code == 403
    assert client.delete("/api/crm/views/builtin:overdue-tasks").status_code == 403


def test_saved_views_persist_per_user_and_default_is_unique(client, admin):
    body = {"entity": "leads", "name": "Hot", "filters": {"status": "qualified"}, "columns": ["name", "status"], "is_default": True}
    v1 = client.post("/api/crm/views", json=body).json()
    assert v1["filters"] == {"status": "qualified"} and v1["is_default"] is True
    assert client.post("/api/crm/views", json=body).status_code == 422  # duplicate name
    v2 = client.post("/api/crm/views", json={**body, "name": "Cold", "is_default": True}).json()
    mine = {v["name"]: v for v in client.get("/api/crm/views", params={"entity": "leads"}).json() if not v["builtin"]}
    assert mine["Cold"]["is_default"] and not mine["Hot"]["is_default"]
    patched = client.patch(f"/api/crm/views/{v2['id']}", json={"name": "Colder", "columns": ["name"]}).json()
    assert patched["name"] == "Colder" and patched["columns"] == ["name"]
    assert client.delete(f"/api/crm/views/{v1['id']}").status_code == 204
    assert client.delete(f"/api/crm/views/{v1['id']}").status_code == 404

    # another user cannot see or touch them
    _login(client, _make_customer("admin"))
    assert [v for v in client.get("/api/crm/views").json() if not v["builtin"]] == []
    assert client.patch(f"/api/crm/views/{v2['id']}", json={"name": "hack"}).status_code == 404
    assert client.delete(f"/api/crm/views/{v2['id']}").status_code == 404


def test_builtin_view_filters_work_against_list_endpoints(client, rm):
    me = rm["id"]
    client.post("/api/crm/leads", json={"name": "Open"})
    lost = client.post("/api/crm/leads", json={"name": "Gone"}).json()
    client.patch(f"/api/crm/leads/{lost['id']}", json={"status": "lost"})
    names = {x["name"] for x in client.get("/api/crm/leads", params={"status": "new,contacted,qualified", "assigned_rm_id": "me"}).json()}
    assert names == {"Open"}
    client.post("/api/crm/activities", json={"kind": "followup", "subject": "Late", "due_at": "2020-01-01"})
    client.post("/api/crm/activities", json={"kind": "followup", "subject": "Fine", "due_at": "2999-01-01"})
    assert [a["subject"] for a in client.get("/api/crm/activities", params={"overdue": "true"}).json()] == ["Late"]
    cust = _make_customer()
    h = client.post("/api/crm/households", json={"name": "H"}).json()
    client.post(f"/api/crm/households/{h['id']}/members", json={"customer_id": cust["id"]})
    client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "kyc", "subject": "Breached", "sla_due_at": "2020-01-01"})
    client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "kyc", "subject": "OK", "sla_due_at": "2999-01-01"})
    assert [c["subject"] for c in client.get("/api/crm/cases", params={"sla_breaching": "true"}).json()] == ["Breached"]
    assert me


# -- contacts / owners / bulk reassign ------------------------------------------
def test_contacts_scoped_sorted_searchable(client, rm, rm2):
    h, c = _household_with_member(client, "Mine")
    _login_as(client, rm2)
    _household_with_member(client, "Theirs")
    _login_as(client, rm)
    r = client.get("/api/crm/contacts")
    assert [x["household_name"] for x in r.json()] == ["Mine"] and r.headers["X-Total-Count"] == "1"
    assert client.get("/api/crm/contacts", params={"q": c["name"][:4]}).json()[0]["customer_id"] == c["id"]
    assert client.get("/api/crm/contacts", params={"sort": "-name"}).status_code == 200
    assert client.get("/api/crm/contacts", params={"sort": "password_hash"}).status_code == 422


def test_owners_and_bulk_reassign_admin_only(client, rm, rm2):
    _admin = _login(client, _make_customer("admin"))
    owners = client.get("/api/crm/owners").json()
    assert {o["id"] for o in owners} >= {rm["id"], rm2["id"], _admin["id"]}
    leads = [client.post("/api/crm/leads", json={"name": f"L{i}"}).json()["id"] for i in range(3)]
    r = client.post("/api/crm/bulk-reassign", json={"entity": "leads", "ids": leads + ["nope"], "assigned_rm_id": rm["id"]})
    assert r.json() == {"updated": 3, "missing": ["nope"]}
    assert client.post("/api/crm/bulk-reassign", json={"entity": "leads", "ids": leads, "assigned_rm_id": "not-an-rm"}).status_code == 422
    _login_as(client, rm)
    assert len(client.get("/api/crm/leads").json()) == 3
    assert client.post("/api/crm/bulk-reassign", json={"entity": "leads", "ids": leads, "assigned_rm_id": rm2["id"]}).status_code == 403
    _login(client, _make_customer("admin"))
    h = client.post("/api/crm/households", json={"name": "HH"}).json()
    r = client.post("/api/crm/bulk-reassign", json={"entity": "households", "ids": [h["id"]], "assigned_rm_id": rm2["id"]})
    assert r.json()["updated"] == 1 and client.get(f"/api/crm/households/{h['id']}").json()["household"]["rm_id"] == rm2["id"]


# -- search -------------------------------------------------------------------------
def test_search_finds_mobile_pan_and_respects_scope(client, rm, rm2):
    h, c = _household_with_member(client, "Searchable Family")
    client.post("/api/crm/kyc", json={"customer_id": c["id"], "pan": "ABCDE1234F"})
    lead = client.post("/api/crm/leads", json={"name": "Zed Lead", "mobile": "9811122233"}).json()
    opp = client.post("/api/crm/opportunities", json={"product_line": "pms", "title": "Zed PMS deal", "household_id": h["id"]}).json()

    def kinds(q):
        return {(r["type"], r["id"]) for r in client.get("/api/crm/search", params={"q": q}).json()["results"]}

    assert ("household", h["id"]) in kinds("searchable")
    assert ("contact", c["id"]) in kinds(c["mobile"][-6:])  # by mobile fragment
    assert ("contact", c["id"]) in kinds("234F")  # by PAN last 4
    assert ("lead", lead["id"]) in kinds("98111")
    assert ("opportunity", opp["id"]) in kinds("zed pms")
    assert client.get("/api/crm/search", params={"q": "a"}).status_code == 422
    _login_as(client, rm2)
    assert kinds("searchable") == set() and kinds("234F") == set() and kinds("zed") == set()
    _login(client, _make_customer("admin"))
    assert ("lead", lead["id"]) in kinds("98111")


# -- duplicates ----------------------------------------------------------------------
def test_duplicate_check_and_lead_enforcement(client, rm, rm2):
    h, c = _household_with_member(client, "Dup Family")
    r = client.post("/api/crm/duplicates/check", json={"email": c["email"].upper(), "name": "x"}).json()
    assert r["blocking"] and r["matches"][0]["visible"] and r["matches"][0]["reasons"] == ["email"]
    assert r["matches"][0]["href"] == f"/backoffice/crm/households/{h['id']}"
    r = client.post("/api/crm/duplicates/check", json={"mobile": "+91 " + c["mobile"]}).json()
    assert r["matches"][0]["reasons"] == ["mobile"]
    # name alone is a weak signal and does not block
    weak = client.post("/api/crm/duplicates/check", json={"name": c["name"]}).json()
    assert weak["matches"] and not weak["blocking"]
    # creating a lead with a matching mobile is refused unless explicitly allowed
    r = client.post("/api/crm/leads", json={"name": "New", "mobile": c["mobile"]})
    assert r.status_code == 409 and r.json()["detail"]["matches"][0]["reasons"] == ["mobile"]
    assert client.post("/api/crm/leads", json={"name": "New", "mobile": c["mobile"], "allow_duplicates": True}).status_code == 201
    # a second lead with the same mobile now also matches the first lead
    assert client.post("/api/crm/leads", json={"name": "New2", "mobile": c["mobile"]}).status_code == 409
    # another RM learns only that a record exists, never whose it is
    _login_as(client, rm2)
    r = client.post("/api/crm/duplicates/check", json={"mobile": c["mobile"]}).json()
    assert r["blocking"] and all(not m["visible"] and m["name"] is None and m["id"] is None and m["href"] is None for m in r["matches"])


def test_import_skips_duplicate_mobile(client, admin):
    c = _make_customer()
    r = client.post("/api/crm/import/clients", json={"rows": [{"name": "Imp Ort", "email": "imp1@example.com", "mobile": c["mobile"]}]})
    assert r.json()["created"] == 0 and r.json()["skipped"][0]["reason"] == "duplicate mobile"


# -- timeline ------------------------------------------------------------------------
def test_timeline_merges_activities_cases_audit_and_is_scoped(client, rm, rm2):
    h, c = _household_with_member(client, "Timeline Fam")
    client.post("/api/crm/activities", json={"kind": "call", "subject": "Intro call", "household_id": h["id"]})
    client.post("/api/crm/activities", json={"kind": "note", "subject": "Prefers WhatsApp", "customer_id": c["id"]})
    client.post("/api/crm/cases", json={"customer_id": c["id"], "category": "kyc", "subject": "KYC pending"})
    client.patch(f"/api/crm/households/{h['id']}", json={"notes": "VIP"})
    opp = client.post("/api/crm/opportunities", json={"household_id": h["id"], "product_line": "pms", "title": "PMS"}).json()
    client.patch(f"/api/crm/opportunities/{opp['id']}", json={"stage": "funded"})
    items = client.get("/api/crm/timeline", params={"entity": "household", "id": h["id"]}).json()
    by_type = {}
    for i in items:
        by_type.setdefault(i["type"], []).append(i["title"])
    assert {"Intro call", "Prefers WhatsApp"} <= set(by_type["activity"])
    assert by_type["case"] == ["KYC pending"]
    assert "notes changed" in by_type["audit"] and "stage changed" in by_type["audit"]
    assert [i["at"] for i in items] == sorted((i["at"] for i in items), reverse=True)
    assert items[0]["actor_name"] == rm["name"]
    assert client.get("/api/crm/timeline", params={"entity": "opportunity", "id": opp["id"]}).status_code == 200
    assert client.get("/api/crm/timeline", params={"entity": "bogus", "id": "x"}).status_code == 422
    _login_as(client, rm2)
    assert client.get("/api/crm/timeline", params={"entity": "household", "id": h["id"]}).status_code == 403
    assert client.get("/api/crm/timeline", params={"entity": "household", "id": "nope"}).status_code == 404


# -- CSV export --------------------------------------------------------------------------
def test_csv_export_honours_filters_scope_and_neutralises_formulas(client, rm, rm2):
    client.post("/api/crm/leads", json={"name": "=HYPERLINK(\"x\")", "email": "evil@example.com"})
    client.post("/api/crm/leads", json={"name": "Plain Lead"})
    _login_as(client, rm2)
    client.post("/api/crm/leads", json={"name": "Other RM Lead"})
    _login_as(client, rm)
    r = client.get("/api/crm/export/leads", params={"q": "lead"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=\"crm-leads-" in r.headers["content-disposition"]
    body = r.text
    assert "Plain Lead" in body and "Other RM Lead" not in body
    full = client.get("/api/crm/export/leads").text
    assert "'=HYPERLINK" in full and "\n=HYPERLINK" not in full and ",=HYPERLINK" not in full
    assert full.splitlines()[0].startswith("Name,Email,Mobile")
    assert client.get("/api/crm/export/passwords").status_code == 422
    _h, _c = _household_with_member(client, "Exported Fam")
    assert "Exported Fam" in client.get("/api/crm/export/households").text
    assert _c["name"] in client.get("/api/crm/export/contacts").text


# -- lead timeline / composer / editable lead --------------------------------------------
def test_lead_activities_timeline_and_inline_edit(client, rm, rm2):
    lead = client.post("/api/crm/leads", json={"name": "Lead A", "mobile": "9811122244"}).json()
    r = client.post("/api/crm/activities", json={"kind": "whatsapp", "subject": "Sent brochure", "lead_id": lead["id"]})
    assert r.status_code == 201 and r.json()["lead_id"] == lead["id"]
    assert client.patch(f"/api/crm/leads/{lead['id']}", json={"name": "Lead B", "email": "b@example.com"}).json()["name"] == "Lead B"
    assert client.patch(f"/api/crm/leads/{lead['id']}", json={"mobile": "123"}).status_code == 422
    items = client.get("/api/crm/timeline", params={"entity": "lead", "id": lead["id"]}).json()
    assert {"Sent brochure", "name changed"} <= {i["title"] for i in items}
    assert [a["subject"] for a in client.get("/api/crm/activities", params={"lead_id": lead["id"]}).json()] == ["Sent brochure"]
    _login_as(client, rm2)
    assert client.post("/api/crm/activities", json={"kind": "note", "subject": "x", "lead_id": lead["id"]}).status_code == 403
    assert lead["id"] not in {a.get("lead_id") for a in client.get("/api/crm/activities").json()}


def test_bulk_delete_leads_needs_admin_and_code(client, rm):
    _login(client, _make_customer("admin"))
    lead = client.post("/api/crm/leads", json={"name": "Del Me"}).json()
    url = "/api/crm/leads/bulk-delete"
    assert client.post(url, json={"ids": [lead["id"]], "code": "1234"}).status_code == 403
    _login_as(client, rm)
    assert client.post(url, json={"ids": [lead["id"]], "code": "0000"}).status_code == 403
    _login(client, _make_customer("admin"))
    assert client.post(url, json={"ids": [lead["id"], "nope"], "code": "0000"}).json() == {"deleted": 1, "missing": ["nope"]}
    assert client.get(f"/api/crm/leads/{lead['id']}").status_code == 404


def test_search_matches_ids_and_lead_notes(client, rm):
    _login(client, _make_customer("admin"))
    lead = client.post("/api/crm/leads", json={"name": "Zed Person", "notes": "Crossword token FH-424242"}).json()
    hh = client.post("/api/crm/households", json={"name": "Quokka Family"}).json()
    ids = lambda q: {r["id"] for r in client.get("/api/crm/search", params={"q": q}).json()["results"]}  # noqa: E731
    assert lead["id"] in ids("fh-424242") and lead["id"] in ids(lead["id"][:8])
    assert hh["id"] in ids(hh["id"]) and hh["id"] in ids("quokka")
