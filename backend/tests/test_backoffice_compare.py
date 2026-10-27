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


def test_compare_matches_screener_frame_for_tenure_and_sharpe(client):
    """V1 live-check fix 2: compare tenure and Sharpe/Sortino must equal the
    research row/dialog values (screener frame), never a silent second value.
    Managers are seeded so tenure is present; at least one seeded code must
    carry dataset ratios to prove the dataset path."""
    from app.backoffice.repository import BackofficeRepository

    sid = _create_staff()
    _login_staff(client, sid)
    codes = [str(c) for c in eligible_funds()["scheme_code"].head(4).tolist()]
    repo = BackofficeRepository()
    conn = repo._conn()
    with conn:
        for code in codes:
            conn.execute(
                """INSERT OR REPLACE INTO mf_managers
                   (scheme_code, manager_name, manager_start, source, provenance, updated_at)
                   VALUES (?, ?, '2019-01-01', 'manual_import', 'manual', '2026-10-14T00:00:00Z')""",
                (code, "Test Manager"),
            )
    by_code: dict[str, dict] = {}
    for code in codes:
        found = [r for r in client.get(
            f"/api/backoffice/mutual-funds/screener?search={code}&limit=200").json()["data"]
            if str(r["code"]) == code]
        assert found, f"screener row missing for {code}"
        by_code[code] = found[0]
    body = client.get(f"/api/backoffice/compare?type=mf&ids={','.join(codes)}")
    assert body.status_code == 200, body.text
    by_id = {str(it["id"]): it["metrics"] for it in body.json()["items"]}
    assert len(by_id) == len(codes)
    dataset_proven = 0
    for code in codes:
        s = by_code[code]
        m = by_id[code]
        assert m["manager_tenure"] == s["manager_tenure_years"], (code, m, s)
        if s.get("sharpe_3y") is not None and s.get("sortino_3y") is not None:
            assert m["sharpe"] == s["sharpe_3y"], (code, m, s)
            assert m["sortino"] == s["sortino_3y"], (code, m, s)
            assert m["sharpe_source"] == "dataset"
            dataset_proven += 1
        else:
            assert m["sharpe_source"] in ("live-nav", "mixed")
    assert dataset_proven >= 1, "no seeded code carried dataset ratios to prove the dataset path"
