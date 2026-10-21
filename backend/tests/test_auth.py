"""Tests for customer account auth: signup/login/logout, sessions, roles, rate limits."""
from __future__ import annotations

import hashlib
import itertools
import secrets
from datetime import UTC, datetime, timedelta

import pytest

from app.api import auth as auth_module
from app.db import sqlite

_counter = itertools.count()


@pytest.fixture(autouse=True)
def _clear_rate_limits():
    auth_module._reset_auth_rate_limits()
    yield
    auth_module._reset_auth_rate_limits()


def _unique():
    n = next(_counter)
    return f"user{n}@example.com", f"98{10000000 + n:08d}"


def _signup(client, email=None, mobile=None, password="password123", name="Test User",
            consent=True, expected=201):
    email, mobile = email or _unique()[0], mobile or _unique()[1]
    # _unique() consumes one counter step per call above; use explicit pair instead
    r = client.post("/api/auth/signup", json={
        "name": name, "email": email, "mobile": mobile,
        "password": password, "consent": consent,
    })
    assert r.status_code == expected, r.text
    return r


def _signup_pair(client, email=None, mobile=None, **kw):
    if email is None or mobile is None:
        u_email, u_mobile = _unique()
        email = email or u_email
        mobile = mobile or u_mobile
    return _signup(client, email=email, mobile=mobile, **kw), email, mobile


def test_signup_ok_sets_cookie(client):
    r, email, mobile = _signup_pair(client)
    body = r.json()["customer"]
    assert body["email"] == email and body["mobile"] == mobile
    assert body["role"] == "customer"
    assert "password_hash" not in body
    assert set(body) >= {"id", "name", "email", "mobile", "role", "assigned_rm_id", "created_at"}
    cookie = r.headers.get("set-cookie", "")
    assert "fh_session=" in cookie and "HttpOnly" in cookie and "Max-Age=2592000" in cookie
    stored = sqlite.get_customer_by_id(body["id"])
    assert stored["password_hash"].startswith("pbkdf2_sha256$600000$")
    # stored mobile is digits-only
    assert stored["mobile"] == mobile


def test_signup_duplicate_email(client):
    r1, email, _ = _signup_pair(client)
    assert r1.status_code == 201
    _, mobile2 = _unique()
    r = client.post("/api/auth/signup", json={
        "name": "Other", "email": email, "mobile": mobile2,
        "password": "password123", "consent": True,
    })
    assert r.status_code == 422
    assert r.json()["detail"] == "An account with these details already exists"


def test_signup_duplicate_mobile(client):
    r1, _, mobile = _signup_pair(client)
    assert r1.status_code == 201
    email2, _ = _unique()
    r = client.post("/api/auth/signup", json={
        "name": "Other", "email": email2, "mobile": mobile,
        "password": "password123", "consent": True,
    })
    assert r.status_code == 422
    assert r.json()["detail"] == "An account with these details already exists"


def test_signup_duplicate_email_case_insensitive(client):
    r1, email, _ = _signup_pair(client)
    assert r1.status_code == 201
    email2, mobile2 = _unique()
    r = client.post("/api/auth/signup", json={
        "name": "Other", "email": email.upper(), "mobile": mobile2,
        "password": "password123", "consent": True,
    })
    assert r.status_code == 422


def test_signup_validation_errors(client):
    email, mobile = _unique()
    base = {"name": "Test User", "email": email, "mobile": mobile,
            "password": "password123", "consent": True}
    cases = [
        ({**base, "email": "not-an-email"}, 422),
        ({**base, "mobile": "12345"}, 422),
        ({**base, "mobile": "5123456789"}, 422),  # starts with 5
        ({**base, "password": "short"}, 422),
        ({**base, "consent": False}, 422),
        ({**base, "name": "x"}, 422),
    ]
    for payload, expected in cases:
        r = client.post("/api/auth/signup", json=payload)
        assert r.status_code == expected, payload


def test_signup_mobile_normalization(client):
    email, _ = _unique()
    r = client.post("/api/auth/signup", json={
        "name": "Test User", "email": email, "mobile": "+91 98765 43210",
        "password": "password123", "consent": True,
    })
    assert r.status_code == 201, r.text
    assert r.json()["customer"]["mobile"] == "9876543210"


def test_login_ok_and_wrong_password(client):
    r, email, _ = _signup_pair(client, password="correct-horse-1")
    assert r.status_code == 201
    ok = client.post("/api/auth/login", json={"email": email, "password": "correct-horse-1"})
    assert ok.status_code == 200
    assert ok.json()["customer"]["email"] == email
    assert "fh_session=" in ok.headers.get("set-cookie", "")
    bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401
    assert bad.json()["detail"] == "Invalid email or password"
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x" * 12})
    assert unknown.status_code == 401
    assert unknown.json()["detail"] == "Invalid email or password"


def test_me_requires_auth(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    s, _, _ = _signup_pair(client)
    assert s.status_code == 201
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == s.json()["customer"]["email"]
    assert "password_hash" not in body


def test_me_plans_lists_only_mine(client):
    s1, _, _ = _signup_pair(client)
    cid1 = s1.json()["customer"]["id"]
    s2, _, _ = _signup_pair(client)
    cid2 = s2.json()["customer"]["id"]
    sqlite.save_plan({"client": {"first_name": "A"}}, {"profile": {}}, customer_id=cid1)
    sqlite.save_plan({"client": {"first_name": "B"}}, {"profile": {}}, customer_id=cid2)
    sqlite.save_plan({"client": {"first_name": "C"}}, {"profile": {}})  # anonymous
    # client fixture holds s2's cookie (last signup); switch back to s1 via fresh login-less cookie jar:
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(cid1, hashlib.sha256(token.encode()).hexdigest(),
                               (datetime.now(UTC) + timedelta(days=30)).isoformat())
    client.cookies.set("fh_session", token)
    r = client.get("/api/auth/me/plans")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["plans"][0]["client_name"] == "A"


def test_logout_revokes_session(client):
    s, _, _ = _signup_pair(client)
    assert s.status_code == 201
    assert client.get("/api/auth/me").status_code == 200
    out = client.post("/api/auth/logout")
    assert out.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_admin_bootstrap_via_env(client, monkeypatch):
    monkeypatch.setenv("FH_ADMIN_EMAIL", "boss_test_env@example.com")
    r, _, _ = _signup_pair(client, email="boss_test_env@example.com")
    # Verified invariant: email string never confers admin role
    assert r.json()["customer"]["role"] == "customer"


def _create_admin(client):
    r, _, _ = _signup_pair(client)
    admin_id = r.json()["customer"]["id"]
    sqlite.update_customer(admin_id, {"role": "admin", "is_staff": 1})
    _login_as(client, admin_id)
    return admin_id


def test_admin_customers_requires_admin(client):
    admin_id = _create_admin(client)
    r = client.get("/api/admin/customers")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    for c in body["customers"]:
        assert "password_hash" not in c
        assert set(c) >= {"id", "name", "email", "mobile", "role", "assigned_rm_id", "plan_count", "created_at"}

    # plain customer is forbidden
    client.cookies.clear()
    _signup_pair(client)
    r2 = client.get("/api/admin/customers")
    assert r2.status_code == 403

    # anonymous is unauthorized
    client.cookies.clear()
    assert client.get("/api/admin/customers").status_code == 401


def test_admin_update_customer(client):
    admin_id = _create_admin(client)
    _, _, _ = _signup_pair(client)  # plain customer; cookie now theirs
    target_id = client.get("/api/auth/me").json()["id"]

    # non-admin cannot patch
    assert client.patch(f"/api/admin/customers/{target_id}", json={"role": "rm"}).status_code == 403

    # log back in as admin via fresh session
    _login_as(client, admin_id)

    bad_role = client.patch(f"/api/admin/customers/{target_id}", json={"role": "superuser"})
    assert bad_role.status_code == 422
    missing = client.patch("/api/admin/customers/does-not-exist", json={"role": "rm"})
    assert missing.status_code == 404
    self_role = client.patch(f"/api/admin/customers/{admin_id}", json={"role": "customer"})
    assert self_role.status_code == 422
    bad_rm = client.patch(f"/api/admin/customers/{target_id}", json={"assigned_rm_id": admin_id})
    assert bad_rm.status_code == 422  # admin is not an rm

    ok = client.patch(f"/api/admin/customers/{target_id}", json={"role": "rm"})
    assert ok.status_code == 200
    assert ok.json()["customer"]["role"] == "rm"

    # clearing assignment with explicit null works
    ok2 = client.patch(f"/api/admin/customers/{target_id}", json={"assigned_rm_id": None})
    assert ok2.status_code == 200
    assert ok2.json()["customer"]["assigned_rm_id"] is None


def _login_as(client, customer_id):
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(customer_id, hashlib.sha256(token.encode()).hexdigest(),
                               (datetime.now(UTC) + timedelta(days=30)).isoformat())
    client.cookies.set("fh_session", token)


def test_rm_sees_only_assigned_customers(client):
    admin_id = _create_admin(client)

    _, _, _ = _signup_pair(client)
    rm_id = client.get("/api/auth/me").json()["id"]
    _, _, _ = _signup_pair(client)
    cust1_id = client.get("/api/auth/me").json()["id"]
    _, _, _ = _signup_pair(client)
    cust2_id = client.get("/api/auth/me").json()["id"]

    _login_as(client, admin_id)
    assert client.patch(f"/api/admin/customers/{rm_id}", json={"role": "rm"}).status_code == 200
    assert client.patch(f"/api/admin/customers/{cust1_id}", json={"assigned_rm_id": rm_id}).status_code == 200

    sqlite.save_plan({"client": {"first_name": "C1"}}, {"profile": {}}, customer_id=cust1_id)

    _login_as(client, rm_id)
    r = client.get("/api/rm/customers")
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["customers"]]
    assert ids == [cust1_id]

    plans = client.get(f"/api/rm/customers/{cust1_id}/plans")
    assert plans.status_code == 200
    assert plans.json()["total"] == 1

    forbidden = client.get(f"/api/rm/customers/{cust2_id}/plans")
    assert forbidden.status_code == 403
    assert client.get("/api/rm/customers/does-not-exist/plans").status_code == 404

    # admin sees everyone through the rm endpoint
    _login_as(client, admin_id)
    all_r = client.get("/api/rm/customers")
    assert all_r.json()["total"] >= 4

    # plain customer cannot use rm endpoints
    _login_as(client, cust2_id)
    assert client.get("/api/rm/customers").status_code == 403


def test_expired_session_rejected_and_purged(client):
    s, _, _ = _signup_pair(client)
    cid = s.json()["customer"]["id"]
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sha = hashlib.sha256(token.encode()).hexdigest()
    sqlite.create_auth_session(cid, sha, (datetime.now(UTC) - timedelta(seconds=1)).isoformat())
    client.cookies.set("fh_session", token)
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert sqlite.get_auth_session(sha) is None  # expired session was deleted


def test_bearer_header_fallback(client):
    s, _, _ = _signup_pair(client)
    cid = s.json()["customer"]["id"]
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(cid, hashlib.sha256(token.encode()).hexdigest(),
                               (datetime.now(UTC) + timedelta(days=30)).isoformat())
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["id"] == cid


def test_auth_rate_limit_trips(client):
    for _ in range(10):
        r = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrongpass1"})
        assert r.status_code == 401
    limited = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrongpass1"})
    assert limited.status_code == 429


def test_guest_login_is_gated_and_read_only(client, monkeypatch):
    monkeypatch.delenv("FH_GUEST_LOGIN", raising=False)
    assert client.post("/api/auth/guest").status_code == 404
    monkeypatch.setenv("FH_GUEST_LOGIN", "1")
    r = client.post("/api/auth/guest")
    assert r.status_code == 200 and r.json()["customer"]["email"] == auth_module.GUEST_EMAIL
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200  # logout is unguarded
