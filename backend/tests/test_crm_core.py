"""Tests for the CRM core backend (W1): households, leads, opportunities,
activities, cases, dashboard, renewals/maturities, generate-tasks, RBAC."""

from __future__ import annotations

import hashlib
import itertools
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api import auth as auth_module
from app.api.crm_core import router as crm_router
from app.db import sqlite

_counter = itertools.count()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "crm_test.db"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app.main import create_app

    app = create_app()
    app.include_router(crm_router)
    with TestClient(app) as c:
        yield c


def _unique():
    n = next(_counter)
    return f"crmuser{n}@example.com", f"97{10000000 + n:08d}"


def _make_customer(role="customer", name=None):
    email, mobile = _unique()
    return sqlite.create_customer(
        name=name or f"Test {role.title()}",
        email=email,
        mobile=mobile,
        password_hash="dummy-hash",
        role=role,
    )


def _login(client, customer):
    token = secrets.token_urlsafe(32)
    sha = hashlib.sha256(token.encode()).hexdigest()
    sqlite.create_auth_session(customer["id"], sha, (datetime.now(UTC) + timedelta(days=1)).isoformat())
    client.cookies.set("fh_session", token)
    return customer


@pytest.fixture
def admin(client):
    return _login(client, _make_customer("admin"))


@pytest.fixture
def rm(client):
    return _login(client, _make_customer("rm"))


@pytest.fixture
def rm2(client):
    c = _make_customer("rm")
    return c  # logged in explicitly where needed


def _login_as(client, customer):
    return _login(client, customer)


# ---------------------------------------------------------------------------
# Households
# ---------------------------------------------------------------------------
def test_household_crud_admin(client, admin):
    r = client.post("/api/crm/households", json={"name": "Sharma Family"})
    assert r.status_code == 201, r.text
    h = r.json()
    assert h["name"] == "Sharma Family" and h["rm_id"] is None

    r = client.get(f"/api/crm/households/{h['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["household"]["id"] == h["id"]
    assert body["members"] == [] and body["opportunities"] == []

    r = client.patch(f"/api/crm/households/{h['id']}", json={"notes": "HNI prospect"})
    assert r.status_code == 200 and r.json()["notes"] == "HNI prospect"

    r = client.get("/api/crm/households")
    assert r.status_code == 200
    row = [x for x in r.json() if x["id"] == h["id"]][0]
    assert row["member_count"] == 0 and row["open_opportunities"] == 0


def test_household_requires_name(client, admin):
    r = client.post("/api/crm/households", json={"name": "  "})
    assert r.status_code == 422


def test_household_not_found(client, admin):
    assert client.get("/api/crm/households/nope").status_code == 404


def test_add_member_and_duplicate_422(client, admin):
    h = client.post("/api/crm/households", json={"name": "Fam"}).json()
    cust = _make_customer()
    r = client.post(f"/api/crm/households/{h['id']}/members", json={"customer_id": cust["id"], "role": "primary"})
    assert r.status_code == 201, r.text
    r = client.post(f"/api/crm/households/{h['id']}/members", json={"customer_id": cust["id"], "role": "spouse"})
    assert r.status_code == 422
    assert "already a member" in r.json()["detail"]

    r = client.get(f"/api/crm/households/{h['id']}")
    members = r.json()["members"]
    assert len(members) == 1
    assert members[0]["role"] == "primary"
    assert members[0]["email"] == cust["email"]
    assert "password_hash" not in members[0]

    r = client.get("/api/crm/households")
    row = [x for x in r.json() if x["id"] == h["id"]][0]
    assert row["member_count"] == 1


def test_add_member_bad_role_422(client, admin):
    h = client.post("/api/crm/households", json={"name": "Fam"}).json()
    cust = _make_customer()
    r = client.post(f"/api/crm/households/{h['id']}/members", json={"customer_id": cust["id"], "role": "cousin"})
    assert r.status_code == 422


def test_rm_household_gets_own_rm_id(client, rm):
    h = client.post("/api/crm/households", json={"name": "Mine"}).json()
    assert h["rm_id"] == rm["id"]


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------
def test_lead_lifecycle(client, admin):
    r = client.post(
        "/api/crm/leads",
        json={"name": "Lead One", "email": "lead1@example.com", "mobile": "9811111111", "source": "website"},
    )
    assert r.status_code == 201, r.text
    lead = r.json()
    assert lead["status"] == "new" and lead["source"] == "website"

    r = client.patch(f"/api/crm/leads/{lead['id']}", json={"status": "contacted"})
    assert r.status_code == 200 and r.json()["status"] == "contacted"

    r = client.get("/api/crm/leads", params={"status": "contacted"})
    assert any(row["id"] == lead["id"] for row in r.json())

    r = client.patch(f"/api/crm/leads/{lead['id']}", json={"status": "bogus"})
    assert r.status_code == 422


def test_lead_convert_creates_customer_and_household(client, admin):
    r = client.post("/api/crm/leads", json={"name": "Convert Me", "email": "conv@example.com", "mobile": "9822222222"})
    lead = r.json()
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={"invite_to_portal": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["customer_id"] and body["household_id"]
    assert len(body["temp_password"]) == 32

    stored = sqlite.get_customer_by_id(body["customer_id"])
    assert stored["role"] == "customer"
    assert auth_module._verify_password(body["temp_password"], stored["password_hash"])

    r = client.get(f"/api/crm/households/{body['household_id']}")
    members = r.json()["members"]
    assert len(members) == 1 and members[0]["role"] == "primary"
    assert members[0]["customer_id"] == body["customer_id"]

    # lead is marked converted; converting again is rejected
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={})
    assert r.status_code == 422


def test_lead_convert_with_explicit_password(client, admin):
    lead = client.post(
        "/api/crm/leads", json={"name": "PW User", "email": "pw@example.com", "mobile": "9833333333"}
    ).json()
    r = client.post(
        f"/api/crm/leads/{lead['id']}/convert",
        json={"password": "supersecret1", "household_name": "PW Household", "invite_to_portal": True},
    )
    assert r.status_code == 200, r.text
    assert "temp_password" not in r.json()
    stored = sqlite.get_customer_by_id(r.json()["customer_id"])
    assert auth_module._verify_password("supersecret1", stored["password_hash"])


def test_lead_convert_duplicate_email_422(client, admin):
    existing = _make_customer()
    lead = client.post(
        "/api/crm/leads",
        json={"name": "Dup", "email": existing["email"], "mobile": "9844444444", "allow_duplicates": True},
    ).json()
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={})
    assert r.status_code == 422
    assert "email" in r.json()["detail"].lower()


def test_lead_convert_missing_contact_422(client, admin):
    lead = client.post("/api/crm/leads", json={"name": "No Contact"}).json()
    r = client.post(f"/api/crm/leads/{lead['id']}/convert", json={})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Opportunities + pipeline
# ---------------------------------------------------------------------------
def test_opportunity_stage_defaults_and_validation(client, admin):
    h = client.post("/api/crm/households", json={"name": "Opp Fam"}).json()
    r = client.post(
        "/api/crm/opportunities",
        json={
            "household_id": h["id"],
            "product_line": "mutual_fund",
            "title": "SIP 50k",
            "amount": 5000000,
        },
    )
    assert r.status_code == 201, r.text
    opp = r.json()
    assert opp["stage"] == "illustration"  # first stage of the line
    assert opp["probability"] == 20  # defaults from the stage

    r = client.post("/api/crm/opportunities", json={"product_line": "mutual_fund", "title": "Bad", "stage": "proposal"})
    assert r.status_code == 422  # proposal is not an MF stage

    r = client.post("/api/crm/opportunities", json={"product_line": "crypto", "title": "Bad"})
    assert r.status_code == 422

    r = client.post(
        "/api/crm/opportunities", json={"product_line": "pms", "title": "PMS", "stage": "funded", "probability": 70}
    )
    assert r.status_code == 201 and r.json()["stage"] == "funded"


def test_opportunity_patch_stage_and_updated_at(client, admin):
    opp = client.post("/api/crm/opportunities", json={"product_line": "life_insurance", "title": "Term cover"}).json()
    before = opp["updated_at"]
    r = client.patch(f"/api/crm/opportunities/{opp['id']}", json={"stage": "proposal", "probability": 40})
    assert r.status_code == 200, r.text
    assert r.json()["stage"] == "proposal"
    assert r.json()["updated_at"] >= before

    r = client.patch(f"/api/crm/opportunities/{opp['id']}", json={"stage": "sip_active"})
    assert r.status_code == 422  # not a life_insurance stage

    r = client.patch("/api/crm/opportunities/nope", json={"stage": "proposal"})
    assert r.status_code == 404


def test_pipeline_math_excludes_lost(client, admin):
    def mk(line, stage, amount):
        return client.post(
            "/api/crm/opportunities",
            json={"product_line": line, "title": f"{line}-{stage}", "stage": stage, "amount": amount},
        ).json()

    mk("mutual_fund", "illustration", 100000)  # ₹1,000 in paise
    mk("mutual_fund", "discussion", 200000)
    lost = mk("mutual_fund", "discussion", 500000)
    client.patch(f"/api/crm/opportunities/{lost['id']}", json={"stage": "lost", "lost_reason": "chose competitor"})
    mk("life_insurance", "proposal", 300000)

    r = client.get("/api/crm/pipeline", params={"product_line": "mutual_fund"})
    assert r.status_code == 200
    body = r.json()
    by_stage = {s["stage"]: s for s in body["stages"]}
    assert by_stage["illustration"] == {"stage": "illustration", "count": 1, "value": 100000}
    assert by_stage["discussion"]["value"] == 200000
    assert "lost" not in by_stage
    assert body["total_value"] == 300000
    assert body["total_count"] == 2

    r = client.get("/api/crm/households")
    # pipeline list carries household/customer names
    r = client.get("/api/crm/opportunities", params={"product_line": "life_insurance"})
    assert r.json()[0]["customer_name"] is None


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------
def test_activity_done_reopen(client, admin):
    r = client.post("/api/crm/activities", json={"kind": "call", "subject": "Intro call"})
    assert r.status_code == 201, r.text
    act = r.json()
    assert act["done_at"] is None

    now = datetime.now(UTC).isoformat()
    r = client.patch(f"/api/crm/activities/{act['id']}", json={"done_at": now})
    assert r.status_code == 200 and r.json()["done_at"] == now

    r = client.get("/api/crm/activities", params={"done": "true"})
    assert any(a["id"] == act["id"] for a in r.json())

    r = client.patch(f"/api/crm/activities/{act['id']}", json={"done_at": None})
    assert r.status_code == 200 and r.json()["done_at"] is None

    r = client.get("/api/crm/activities", params={"done": "false"})
    assert any(a["id"] == act["id"] for a in r.json())


def test_activity_kind_validation(client, admin):
    r = client.post("/api/crm/activities", json={"kind": "telepathy", "subject": "x"})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------
def test_case_resolve_sets_resolved_at(client, admin):
    cust = _make_customer()
    r = client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "kyc", "subject": "PAN mismatch"})
    assert r.status_code == 201, r.text
    case = r.json()
    assert case["status"] == "open" and case["resolved_at"] is None

    r = client.patch(f"/api/crm/cases/{case['id']}", json={"status": "resolved"})
    assert r.status_code == 200
    assert r.json()["resolved_at"] is not None

    r = client.patch(f"/api/crm/cases/{case['id']}", json={"status": "open"})
    assert r.json()["resolved_at"] is None  # reopening clears it

    r = client.patch(f"/api/crm/cases/{case['id']}", json={"status": "bogus"})
    assert r.status_code == 422


def test_case_bad_category_422(client, admin):
    cust = _make_customer()
    r = client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "refund", "subject": "x"})
    assert r.status_code == 422


def test_case_list_has_customer_name(client, admin):
    cust = _make_customer(name="Case Customer")
    client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "folio", "subject": "Folio merge"})
    r = client.get("/api/crm/cases")
    row = [c for c in r.json() if c["customer_id"] == cust["id"]][0]
    assert row["customer_name"] == "Case Customer"


# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------
def test_unauthenticated_401(client):
    for method, path in [
        ("get", "/api/crm/households"),
        ("get", "/api/crm/leads"),
        ("get", "/api/crm/opportunities"),
        ("get", "/api/crm/activities"),
        ("get", "/api/crm/cases"),
        ("get", "/api/crm/dashboard"),
        ("get", "/api/crm/pipeline"),
        ("get", "/api/crm/renewals"),
        ("get", "/api/crm/maturities"),
    ]:
        r = client.request(method, path)
        assert r.status_code == 401, (method, path)


def test_customer_role_403(client):
    _login(client, _make_customer("customer"))
    assert client.get("/api/crm/households").status_code == 403
    assert client.post("/api/crm/households", json={"name": "x"}).status_code == 403
    assert client.get("/api/crm/dashboard").status_code == 403


def test_rm_scoping(client, rm, rm2):
    h1 = client.post("/api/crm/households", json={"name": "RM1 Fam"}).json()
    assert h1["rm_id"] == rm["id"]

    _login_as(client, rm2)
    r = client.get("/api/crm/households")
    assert all(h["id"] != h1["id"] for h in r.json())
    assert client.get(f"/api/crm/households/{h1['id']}").status_code == 403

    # rm2 cannot attach opportunities to rm1's household
    r = client.post(
        "/api/crm/opportunities", json={"household_id": h1["id"], "product_line": "mutual_fund", "title": "Sneaky"}
    )
    assert r.status_code == 403

    # admin sees everything
    _login(client, _make_customer("admin"))
    assert client.get(f"/api/crm/households/{h1['id']}").status_code == 200


def test_rm_lead_scoping(client, rm, rm2):
    _login(client, _make_customer("admin"))
    mine = client.post("/api/crm/leads", json={"name": "Mine", "assigned_rm_id": rm["id"]}).json()
    pool = client.post("/api/crm/leads", json={"name": "Pool"}).json()
    other = client.post("/api/crm/leads", json={"name": "Other", "assigned_rm_id": rm2["id"]}).json()

    _login_as(client, rm2)
    ids = {row["id"] for row in client.get("/api/crm/leads").json()}
    assert other["id"] in ids and pool["id"] not in ids and mine["id"] not in ids  # unassigned pool is admin-only
    assert client.patch(f"/api/crm/leads/{mine['id']}", json={"status": "lost"}).status_code == 403


# ---------------------------------------------------------------------------
# Dashboard / renewals / generate-tasks
# ---------------------------------------------------------------------------
def test_dashboard_kpis(client, admin, rm):
    h = client.post("/api/crm/households", json={"name": "Dash Fam", "rm_id": rm["id"]}).json()
    client.post("/api/crm/leads", json={"name": "Dash Lead"})
    client.post(
        "/api/crm/opportunities",
        json={
            "household_id": h["id"],
            "product_line": "mutual_fund",
            "title": "SIP",
            "stage": "discussion",
            "amount": 250000,
        },
    )
    tomorrow = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    client.post(
        "/api/crm/activities",
        json={"kind": "followup", "subject": "Call back", "due_at": tomorrow, "assigned_rm_id": rm["id"]},
    )
    cust = _make_customer()
    client.post(f"/api/crm/households/{h['id']}/members", json={"customer_id": cust["id"], "role": "primary"})
    client.post("/api/crm/cases", json={"customer_id": cust["id"], "category": "folio", "subject": "Folio issue"})

    r = client.get("/api/crm/dashboard")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["households_count"] == 1
    assert d["active_leads_count"] == 1
    assert d["pipeline_value_by_line"]["mutual_fund"] == 250000
    assert d["open_cases_count"] == 1
    assert d["tasks_due_count"] == 1
    assert d["renewals_due_30d"] == 0  # W2 tables absent -> defensive zero
    assert d["fd_maturities_60d"] == 0

    # rm-scoped dashboard hides other RMs' households
    _login_as(client, rm)
    assert client.get("/api/crm/dashboard").json()["households_count"] == 1
    other_rm = _make_customer("rm")
    _login_as(client, other_rm)
    assert client.get("/api/crm/dashboard").json()["households_count"] == 0


def _create_w2_policy_table(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS insurance_policies (
            id TEXT PRIMARY KEY, household_id TEXT, customer_id TEXT,
            policy_type TEXT NOT NULL, insurer TEXT, policy_no TEXT,
            premium_amount INTEGER, premium_due_date TEXT, renewal_date TEXT,
            status TEXT NOT NULL DEFAULT 'active', notes TEXT)"""
    )
    conn.commit()
    conn.close()


def test_generate_tasks_idempotent(client, admin, rm, tmp_path):
    db_path = str(tmp_path / "crm_test.db")
    _create_w2_policy_table(db_path)
    h = client.post("/api/crm/households", json={"name": "Policy Fam", "rm_id": rm["id"]}).json()
    renewal = (datetime.now(UTC) + timedelta(days=10)).date().isoformat()
    conn = sqlite3.connect(db_path)
    now = datetime.now(UTC).isoformat()
    conn.execute(
        "INSERT INTO insurance_policies (id, household_id, policy_type, insurer, policy_no,"
        " premium_amount, renewal_date, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("pol1", h["id"], "term", "LIC", "P-001", 5000000, renewal, "active", now, now),
    )
    conn.commit()
    conn.close()

    r = client.get("/api/crm/renewals")
    assert r.status_code == 200 and len(r.json()) == 1
    assert r.json()[0]["household_name"] == "Policy Fam"

    r = client.post("/api/crm/renewals/generate-tasks", json={"type": "policy"})
    assert r.status_code == 200, r.text
    assert r.json() == {"created": 1}

    # second run creates nothing: idempotent
    r = client.post("/api/crm/renewals/generate-tasks", json={"type": "policy"})
    assert r.json() == {"created": 0}

    acts = client.get("/api/crm/activities").json()
    task = [a for a in acts if a.get("policy_id") == "pol1"][0]
    assert task["kind"] == "followup" and task["done_at"] is None
    assert task["assigned_rm_id"] == rm["id"]

    r = client.post("/api/crm/renewals/generate-tasks", json={"type": "bogus"})
    assert r.status_code == 422


def test_renewals_maturities_empty_without_w2(client, admin):
    assert client.get("/api/crm/renewals").json() == []
    assert client.get("/api/crm/maturities").json() == []


def test_public_crossword_result_creates_lead(client):
    body = {"name": "Asha Rao", "phone": "98201 12345", "puzzle_id": 3,
            "words_correct": 4, "words_total": 7, "seconds_used": 95}
    r = client.post("/api/crm/public/crossword", json=body)
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    assert token.startswith("FH-") and len(token) == 9
    bad = client.post("/api/crm/public/crossword", json={**body, "words_correct": 9})
    assert bad.status_code == 422
