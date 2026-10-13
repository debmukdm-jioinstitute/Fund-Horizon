"""Tests for backoffice authorization, CSRF, staff roles, and IDOR protection."""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import pytest

from app.db import sqlite


def _create_user(role="customer", is_staff=0, status="active", revoked_before=None):
    tag = secrets.token_hex(6)
    email = f"user_{tag}@internal.fundhorizon"
    mobile = f"98{secrets.randbelow(90000000) + 10000000}"
    created = sqlite.create_customer(
        name=f"User {role}",
        email=email,
        mobile=mobile,
        password_hash="pbkdf2_sha256$test",
        role=role,
    )
    user_id = created["id"]
    sqlite.update_customer(
        user_id,
        {
            "is_staff": is_staff,
            "status": status,
            "revoked_before": revoked_before,
        },
    )
    return user_id


def _login(client, user_id):
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(
        user_id,
        hashlib.sha256(token.encode()).hexdigest(),
        (datetime.now(UTC) + timedelta(days=30)).isoformat(),
    )
    client.cookies.set("fh_session", token)
    return token


def test_anonymous_access_denied_on_backoffice(client):
    client.cookies.clear()
    endpoints = [
        "/api/backoffice/overview",
        "/api/backoffice/yields",
        "/api/backoffice/derivatives",
        "/api/backoffice/flows",
        "/api/backoffice/pms/strategies",
        "/api/backoffice/pms/accounts",
        "/api/backoffice/mutual-funds/tracker",
        "/api/backoffice/data-health",
        "/api/backoffice/briefing",
    ]
    for ep in endpoints:
        r = client.get(ep)
        assert r.status_code == 401, f"{ep} allowed anonymous access"


def test_customer_role_denied_staff_access(client):
    cid = _create_user(role="customer", is_staff=0)
    _login(client, cid)

    endpoints = [
        "/api/backoffice/overview",
        "/api/backoffice/yields",
        "/api/backoffice/derivatives",
        "/api/backoffice/pms/strategies",
    ]
    for ep in endpoints:
        r = client.get(ep)
        assert r.status_code == 403, f"{ep} allowed customer role"


def test_staff_roles_authorized(client):
    roles = ["admin", "analyst", "rm", "operations", "read_only"]
    for role in roles:
        sid = _create_user(role=role, is_staff=1)
        _login(client, sid)
        r = client.get("/api/backoffice/overview")
        assert r.status_code == 200, f"{role} could not access overview: {r.text}"


def test_suspended_staff_account_rejected(client):
    sid = _create_user(role="analyst", is_staff=1, status="suspended")
    _login(client, sid)
    r = client.get("/api/backoffice/overview")
    assert r.status_code == 403
    assert "suspended" in r.text.lower()


def test_session_revocation_enforced(client):
    past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    sid = _create_user(role="analyst", is_staff=1)
    _login(client, sid)

    # First call succeeds
    assert client.get("/api/backoffice/overview").status_code == 200

    # Revoke sessions created before now + 1 minute
    future = (datetime.now(UTC) + timedelta(minutes=1)).isoformat()
    sqlite.update_customer(sid, {"revoked_before": future})

    # Next call fails with 401 session revoked
    r2 = client.get("/api/backoffice/overview")
    assert r2.status_code == 401
    assert "revoked" in r2.text.lower()


def test_csrf_protection_on_cookie_mutation(client):
    sid = _create_user(role="analyst", is_staff=1)
    _login(client, sid)

    # Cross-site sec-fetch-site header is refused
    r = client.post(
        "/api/backoffice/watchlists",
        json={"name": "Core", "item_type": "scheme", "item_id": "119551"},
        headers={"sec-fetch-site": "cross-site"},
    )
    assert r.status_code == 403
    assert "csrf" in r.text.lower()

    # Same-origin call succeeds
    r2 = client.post(
        "/api/backoffice/watchlists",
        json={"name": "Core", "item_type": "scheme", "item_id": "119551"},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert r2.status_code == 201


def test_rm_idor_guard_across_clients(client):
    rm1 = _create_user(role="rm", is_staff=1)
    rm2 = _create_user(role="rm", is_staff=1)

    # Create two PMS accounts in SQLite
    from app.db_crm_products import init_crm_products_schema
    conn = sqlite.get_default_connection()
    init_crm_products_schema(conn)
    now = datetime.now(UTC).isoformat()
    with conn:
        conn.execute(
            """
            INSERT INTO pms_accounts (id, customer_id, provider, amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            ("acc_rm1", rm1, "ASK", 500000000, now, now),
        )
        conn.execute(
            """
            INSERT INTO pms_accounts (id, customer_id, provider, amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            ("acc_rm2", rm2, "ASK", 500000000, now, now),
        )
    conn.close()

    # rm1 can view acc_rm1
    _login(client, rm1)
    r1 = client.get("/api/backoffice/pms/accounts/acc_rm1/tracker")
    assert r1.status_code == 200

    # rm1 is forbidden from viewing acc_rm2 (IDOR protection!)
    r2 = client.get("/api/backoffice/pms/accounts/acc_rm2/tracker")
    assert r2.status_code == 403
    assert "restricted" in r2.text.lower()

    # admin can view both
    admin_id = _create_user(role="admin", is_staff=1)
    _login(client, admin_id)
    assert client.get("/api/backoffice/pms/accounts/acc_rm2/tracker").status_code == 200
