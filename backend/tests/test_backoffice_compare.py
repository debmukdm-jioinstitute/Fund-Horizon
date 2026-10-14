"""Compare API validation."""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from app.data.loader import eligible_funds
from app.db import sqlite


def _create_staff(role="analyst"):
    tag = secrets.token_hex(6)
    email = f"staff_{tag}@fundhorizon.internal"
    mobile = f"98{secrets.randbelow(90000000) + 10000000}"
    created = sqlite.create_customer(
        name=f"Staff {role}",
        email=email,
        mobile=mobile,
        password_hash="pbkdf2_sha256$test",
        role=role,
    )
    user_id = created["id"]
    sqlite.update_customer(user_id, {"is_staff": 1, "status": "active"})
    return user_id


def _login_staff(client, staff_id):
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(
        staff_id,
        hashlib.sha256(token.encode()).hexdigest(),
        (datetime.now(UTC) + timedelta(days=30)).isoformat(),
    )
    client.cookies.set("fh_session", token)


def test_backoffice_compare_requires_two_ids(client):
    sid = _create_staff()
    _login_staff(client, sid)
    r = client.get("/api/backoffice/compare?type=mf&ids=119551")
    assert r.status_code == 422


def test_backoffice_compare_mf_two_known_schemes(client):
    sid = _create_staff()
    _login_staff(client, sid)
    codes = eligible_funds()["scheme_code"].head(2).tolist()
    r = client.get(f"/api/backoffice/compare?type=mf&ids={','.join(codes)}")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "mf"
    assert len(body["items"]) == 2
    assert all("series" in it for it in body["items"])
