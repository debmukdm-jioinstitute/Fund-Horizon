"""W2 scope: products & compliance endpoints (app/api/crm_products.py).

Covers CRUD per resource, KYC pan_last4 validation (422 on anything that is not
exactly 4 alphanumerics; the full PAN is never stored), the consent
grant/withdraw cycle, suitability append-only history, and the bulk client
import report (duplicates/bad rows skipped, never failing the batch).
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db_crm_products
from app.api.auth import _hash_password, _reset_auth_rate_limits, auth_router
from app.api.crm_products import router as crm_products_router
from app.db import sqlite as sqlite_repo

PASSWORD = "password123"


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(crm_products_router)
    return app


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("crm-products") / "test.db"
    os.environ["FH_DB_PATH"] = str(db_path)
    os.environ.pop("DATABASE_URL", None)
    db_crm_products.ensure_crm_products_schema()
    return _build_app()


def _seed_user(email: str, role: str, assigned_rm_id: str | None = None, name: str = "Seed User") -> dict:
    mobile = "9" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
    mobile = mobile[:10]
    return sqlite_repo.create_customer(
        name=name,
        email=email,
        mobile=mobile,
        password_hash=_hash_password(PASSWORD),
        role=role,
        assigned_rm_id=assigned_rm_id,
    )


@pytest.fixture(scope="module")
def clients(app):
    _reset_auth_rate_limits()
    admin = _seed_user("crm-admin@example.com", "admin", name="Admin")
    rm1 = _seed_user("crm-rm1@example.com", "rm", name="RM One")
    rm2 = _seed_user("crm-rm2@example.com", "rm", name="RM Two")
    cust1 = _seed_user("crm-cust1@example.com", "customer", assigned_rm_id=rm1["id"], name="Cust One")
    cust2 = _seed_user("crm-cust2@example.com", "customer", assigned_rm_id=rm2["id"], name="Cust Two")

    def login(email: str) -> TestClient:
        c = TestClient(app)
        r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        return c

    return {
        "admin": login("crm-admin@example.com"),
        "rm1": login("crm-rm1@example.com"),
        "rm2": login("crm-rm2@example.com"),
        "customer": login("crm-cust1@example.com"),
        "anon": TestClient(app),
        "ids": {"admin": admin["id"], "rm1": rm1["id"], "rm2": rm2["id"], "cust1": cust1["id"], "cust2": cust2["id"]},
    }


# ------------------------------------------------------------------ auth ----
def test_unauthenticated_returns_401(clients):
    assert clients["anon"].get("/api/crm/policies").status_code == 401
    assert clients["anon"].post("/api/crm/policies", json={"policy_type": "term"}).status_code == 401
    assert clients["anon"].get("/api/crm/kyc", params={"customer_id": "x"}).status_code == 401
    assert clients["anon"].post("/api/crm/import/clients", json={"rows": []}).status_code == 401


def test_customer_role_is_forbidden(clients):
    assert clients["customer"].get("/api/crm/policies").status_code == 403
    assert clients["customer"].post("/api/crm/fds", json={}).status_code == 403
    assert clients["customer"].get("/api/crm/consents", params={"customer_id": "x"}).status_code == 403


# --------------------------------------------------------------- policies ---
def test_policy_crud(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]
    r = admin.post(
        "/api/crm/policies",
        json={
            "customer_id": cust1,
            "policy_type": "term",
            "insurer": "Test Life",
            "policy_no": "POL-1",
            "premium_amount": 2500000,  # paise = Rs 25,000
            "premium_due_date": "2026-11-01",
            "renewal_date": "2027-11-01",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["premium_amount"] == 2500000
    assert body["status"] == "active"
    pid = body["id"]

    r = admin.get("/api/crm/policies", params={"customer_id": cust1})
    assert r.status_code == 200
    assert any(p["id"] == pid for p in r.json())

    r = admin.patch(f"/api/crm/policies/{pid}", json={"status": "renewed", "notes": "Renewed for a year"})
    assert r.status_code == 200
    assert r.json()["status"] == "renewed"

    r = admin.patch("/api/crm/policies/does-not-exist", json={"status": "lapsed"})
    assert r.status_code == 404


def test_policy_bad_input_422(clients):
    admin = clients["admin"]
    r = admin.post("/api/crm/policies", json={"policy_type": "spaceship"})
    assert r.status_code == 422
    r = admin.post("/api/crm/policies", json={"policy_type": "term", "premium_amount": -5})
    assert r.status_code == 422
    r = admin.post("/api/crm/policies", json={"policy_type": "term", "renewal_date": "01-11-2026"})
    assert r.status_code == 422
    r = admin.post("/api/crm/policies", json={"policy_type": "term", "customer_id": "no-such-customer"})
    assert r.status_code == 404


# ------------------------------------------------------------------- fds ----
def test_fd_crud(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]
    r = admin.post(
        "/api/crm/fds",
        json={
            "customer_id": cust1,
            "company": "Test Finance Ltd",
            "amount": 50000000,  # paise = Rs 5,00,000
            "interest_rate": 8.25,
            "start_date": "2026-01-15",
            "maturity_date": "2027-01-15",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["amount"] == 50000000
    assert body["interest_rate"] == 8.25
    fid = body["id"]

    r = admin.patch(f"/api/crm/fds/{fid}", json={"status": "matured", "amount": 54125000})
    assert r.status_code == 200
    assert r.json()["status"] == "matured"
    assert r.json()["amount"] == 54125000

    r = admin.get("/api/crm/fds", params={"customer_id": cust1})
    assert r.status_code == 200
    assert any(f["id"] == fid for f in r.json())


# ------------------------------------------------------------------- pms ----
def test_pms_crud(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]
    r = admin.post(
        "/api/crm/pms",
        json={
            "customer_id": cust1,
            "provider": "Test PMS",
            "agreement_date": "2026-09-01",
            "amount": 750000000,  # paise = Rs 75,00,000
            "fee_fixed_pct": 2.0,
            "fee_performance_pct": 20.0,
            "hurdle_pct": 10.0,
            "high_water_mark": 750000000,
            "accredited_investor": True,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["amount"] == 750000000
    assert body["high_water_mark"] == 750000000
    assert body["status"] == "prospect"
    pms_id = body["id"]

    r = admin.patch(f"/api/crm/pms/{pms_id}", json={"status": "active", "disclosure_given_at": "2026-09-02"})
    assert r.status_code == 200
    assert r.json()["status"] == "active"

    r = admin.get("/api/crm/pms", params={"customer_id": cust1})
    assert r.status_code == 200
    assert any(p["id"] == pms_id for p in r.json())


# ------------------------------------------------------------------- kyc ----
def test_kyc_pan_last4_validation(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]
    for bad in ("ABCDE", "AB1", "ABCD1", "ABCDE1234F", "AB 1", "", "12-4"):
        r = admin.post(
            "/api/crm/kyc",
            json={"customer_id": cust1, "pan_last4": bad, "kra_status": "validated"},
        )
        assert r.status_code == 422, (bad, r.text)

    r = admin.post(
        "/api/crm/kyc",
        json={"customer_id": cust1, "pan_last4": "ab12", "kra_status": "validated", "ckyc_id": "CKY123"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] is True
    rec = r.json()["record"]
    assert rec["pan_last4"] == "AB12"  # normalized; only the last 4 ever stored
    assert "ABCDE1234F" not in json.dumps(rec)

    r = admin.post(
        "/api/crm/kyc",
        json={"customer_id": cust1, "pan_last4": "ZZ99", "kra_status": "on_hold"},
    )
    assert r.json()["created"] is False  # upsert, not a duplicate

    r = admin.get("/api/crm/kyc", params={"customer_id": cust1})
    assert r.status_code == 200
    assert r.json()["pan_last4"] == "ZZ99"
    assert r.json()["kra_status"] == "on_hold"

    r = admin.get("/api/crm/kyc", params={"customer_id": "no-such-customer"})
    assert r.status_code == 404


# --------------------------------------------------------------- mandates ---
def test_mandate_crud(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]
    r = admin.post(
        "/api/crm/mandates",
        json={"customer_id": cust1, "umrn": "UMRN001", "bank_name": "Test Bank", "amount_cap": 10000000},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["amount_cap"] == 10000000
    assert body["status"] == "registered"
    mid = body["id"]

    r = admin.get("/api/crm/mandates", params={"customer_id": cust1})
    assert r.status_code == 200
    assert any(m["id"] == mid for m in r.json())

    r = admin.patch(f"/api/crm/mandates/{mid}", json={"status": "approved"})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    r = admin.patch("/api/crm/mandates/nope", json={"status": "approved"})
    assert r.status_code == 404


# --------------------------------------------------------------- consents ---
def test_consent_grant_withdraw_cycle(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]

    r = admin.post(
        "/api/crm/consents",
        json={"customer_id": cust1, "purpose": "marketing", "granted": True, "notice_version": "v3"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] is True
    c = r.json()["consent"]
    assert c["granted"] is True
    assert c["granted_at"] is not None
    assert c["withdrawn_at"] is None

    r = admin.post(
        "/api/crm/consents",
        json={"customer_id": cust1, "purpose": "marketing", "granted": False},
    )
    assert r.json()["created"] is False  # upsert on (customer_id, purpose)
    c = r.json()["consent"]
    assert c["granted"] is False
    assert c["withdrawn_at"] is not None
    assert c["granted_at"] is None

    r = admin.post(
        "/api/crm/consents",
        json={"customer_id": cust1, "purpose": "marketing", "granted": True},
    )
    c = r.json()["consent"]
    assert c["granted"] is True
    assert c["withdrawn_at"] is None  # re-grant clears the withdrawal

    r = admin.get("/api/crm/consents", params={"customer_id": cust1})
    assert r.status_code == 200
    assert len([x for x in r.json() if x["purpose"] == "marketing"]) == 1


# ------------------------------------------------------------ suitability ---
def test_suitability_append_only_latest_first(clients):
    rm1, cust1 = clients["rm1"], clients["ids"]["cust1"]
    r = rm1.post(
        "/api/crm/suitability",
        json={"customer_id": cust1, "financial_status": "salaried", "risk_band": "moderate"},
    )
    assert r.status_code == 201, r.text
    first_id = r.json()["id"]
    assert r.json()["recorded_by_rm_id"] == clients["ids"]["rm1"]

    r = rm1.post(
        "/api/crm/suitability",
        json={"customer_id": cust1, "financial_status": "salaried", "risk_band": "balanced"},
    )
    assert r.status_code == 201

    r = rm1.get("/api/crm/suitability", params={"customer_id": cust1})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2
    assert rows[0]["risk_band"] == "balanced"  # latest first
    assert rows[1]["id"] == first_id


# ------------------------------------------------------------ disclosures ---
def test_disclosure_logging(clients):
    admin, cust1 = clients["admin"], clients["ids"]["cust1"]
    r = admin.post(
        "/api/crm/disclosures",
        json={
            "customer_id": cust1,
            "schemes_compared": ["Scheme A", "Scheme B"],
            "commissions_disclosed": "Trailing commission disclosed in writing",
            "regular_plan_noted": True,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["regular_plan_noted"] is True
    assert json.loads(body["schemes_compared"]) == ["Scheme A", "Scheme B"]

    r = admin.get("/api/crm/disclosures", params={"customer_id": cust1})
    assert r.status_code == 200
    assert len(r.json()) >= 1


# ------------------------------------------------------------ rm scoping ----
def test_rm_scoping(clients):
    rm1, rm2, admin = clients["rm1"], clients["rm2"], clients["admin"]
    cust1, cust2 = clients["ids"]["cust1"], clients["ids"]["cust2"]

    admin.post("/api/crm/policies", json={"customer_id": cust1, "policy_type": "health"})
    admin.post("/api/crm/policies", json={"customer_id": cust2, "policy_type": "term"})

    # rm1 sees only cust1's policy
    r = rm1.get("/api/crm/policies")
    assert r.status_code == 200
    assert {p["customer_id"] for p in r.json()} == {cust1}

    # rm2 cannot query cust1's records
    r = rm2.get("/api/crm/policies", params={"customer_id": cust1})
    assert r.status_code == 403

    # rm2 cannot write for cust1 either
    r = rm2.post("/api/crm/policies", json={"customer_id": cust1, "policy_type": "term"})
    assert r.status_code == 403

    # admin sees everything
    r = admin.get("/api/crm/policies")
    assert r.status_code == 200
    assert {cust1, cust2} <= {p["customer_id"] for p in r.json()}


# ----------------------------------------------------------------- import ---
def test_import_clients_report(clients):
    admin = clients["admin"]
    rows = [
        {"name": "Imp One", "email": "imp1@example.com", "mobile": "9811111111",
         "household_name": "Imp Household", "rm_email": "crm-rm1@example.com"},
        {"name": "Imp Two", "email": "imp2@example.com"},
        {"name": "Dup", "email": "imp1@example.com"},  # duplicate
        {"name": "Bad", "email": "not-an-email"},  # bad email
        {"name": "X", "email": "x@example.com"},  # bad name
        {"name": "NoRm", "email": "norm@example.com", "rm_email": "ghost@example.com"},  # rm not found
    ]
    r = admin.post("/api/crm/import/clients", json={"rows": rows})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 2
    assert body["households_created"] == 1
    assert len(body["skipped"]) == 4
    reasons = {s["email"]: s["reason"] for s in body["skipped"]}
    assert reasons["imp1@example.com"] == "duplicate email"
    assert reasons["not-an-email"] == "invalid email address"
    assert reasons["x@example.com"] == "name is required"
    assert reasons["norm@example.com"] == "rm not found"

    # household was created with a primary member link to the imported customer
    cust = sqlite_repo.get_customer_by_email("imp1@example.com")
    assert cust is not None
    assert cust["role"] == "customer"
    assert cust["assigned_rm_id"] == clients["ids"]["rm1"]
    hh = db_crm_products._one("SELECT * FROM households WHERE name = ?", ("Imp Household",))
    assert hh is not None
    assert hh["rm_id"] == clients["ids"]["rm1"]
    assert hh["primary_customer_id"] == cust["id"]
    member = db_crm_products._one(
        "SELECT * FROM household_members WHERE household_id = ? AND customer_id = ?",
        (hh["id"], cust["id"]),
    )
    assert member is not None
    assert member["role"] == "primary"

    # batch never fails: a second identical import only reports skips
    r = admin.post("/api/crm/import/clients", json={"rows": rows})
    assert r.status_code == 200
    assert r.json()["created"] == 0
    assert r.json()["households_created"] == 0


def test_import_rm_caller_scoped_to_self(clients):
    rm2 = clients["rm2"]
    r = rm2.post(
        "/api/crm/import/clients",
        json={"rows": [{"name": "Rm Import", "email": "rmimport@example.com",
                        "household_name": "Rm HH", "rm_email": "crm-rm1@example.com"}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    cust = sqlite_repo.get_customer_by_email("rmimport@example.com")
    assert cust["assigned_rm_id"] == clients["ids"]["rm2"]  # forced to the caller
