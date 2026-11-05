"""MCP OAuth (web/mobile connector): discovery, register, PKCE sign-in, token, refresh rotation, revoke, staff-only."""
import base64
import hashlib
from urllib.parse import parse_qs, urlparse

from app.api.auth import _hash_password
from app.db import sqlite
from tests.test_backoffice_api import _create_staff

CB = "https://claude.ai/api/mcp/auth_callback"
PW = "Correct-horse-9"


def _user(role="analyst"):
    uid = _create_staff(role)
    sqlite.update_customer(uid, {"password_hash": _hash_password(PW)})
    return sqlite.get_customer_by_id(uid)["email"]


def _pkce():
    v = "v" * 64
    return v, base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()


def _register(client):
    r = client.post("/oauth/register", json={"redirect_uris": [CB], "client_name": "Claude"})
    assert r.status_code == 201, r.text
    return r.json()["client_id"]


def _authorize(client, cid, challenge, email, pw=PW, decision="allow"):
    return client.post("/oauth/authorize", data={"client_id": cid, "redirect_uri": CB, "code_challenge": challenge, "state": "s1",
                                                 "email": email, "password": pw, "decision": decision}, follow_redirects=False)


def _tokens(client, email):
    cid = _register(client)
    verifier, challenge = _pkce()
    r = _authorize(client, cid, challenge, email)
    assert r.status_code == 303
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["state"] == ["s1"]
    t = client.post("/oauth/token", data={"grant_type": "authorization_code", "code": q["code"][0], "redirect_uri": CB,
                                          "code_verifier": verifier, "client_id": cid})
    return cid, verifier, q["code"][0], t


def _mcp(client, access):
    return client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers={"Authorization": f"Bearer {access}"})


def test_unauthenticated_mcp_points_to_oauth_metadata(client):
    r = client.post("/mcp", json={})
    assert r.status_code == 401 and "resource_metadata=" in r.headers["www-authenticate"]
    meta = client.get("/.well-known/oauth-protected-resource").json()
    assert meta["authorization_servers"]
    auth = client.get("/.well-known/oauth-authorization-server").json()
    assert auth["code_challenge_methods_supported"] == ["S256"] and auth["registration_endpoint"].endswith("/oauth/register")


def test_register_rejects_bad_redirect(client):
    for uri in ("http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#f"):
        assert client.post("/oauth/register", json={"redirect_uris": [uri]}).status_code == 400


def test_full_flow_refresh_and_revoke(client):
    email = _user()
    cid, verifier, code, t = _tokens(client, email)
    assert t.status_code == 200, t.text
    tok = t.json()
    assert _mcp(client, tok["access_token"]).json()["result"]["tools"]
    # code is single use
    again = client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": CB,
                                              "code_verifier": verifier, "client_id": cid})
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
    # refresh rotates: old access and old refresh both die
    r = client.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert r.status_code == 200, r.text
    new = r.json()
    assert _mcp(client, new["access_token"]).status_code == 200
    assert _mcp(client, tok["access_token"]).status_code == 401
    assert client.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid}).status_code == 400
    # removing the connection in Settings kills the refresh token too
    client.cookies.clear()
    ids = client.get("/api/mcp/tokens", headers={"Authorization": f"Bearer {new['access_token']}"}).json()["data"]
    assert ids
    for i in ids:
        assert client.delete(f"/api/mcp/tokens/{i['id']}", headers={"Authorization": f"Bearer {new['access_token']}"}).status_code in (204, 401)
    assert client.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": new["refresh_token"], "client_id": cid}).status_code == 400


def test_wrong_verifier_password_and_non_staff_refused(client):
    email = _user()
    cid = _register(client)
    _, challenge = _pkce()
    assert _authorize(client, cid, challenge, email, pw="wrong").status_code == 401
    ok = _authorize(client, cid, challenge, email)
    code = parse_qs(urlparse(ok.headers["location"]).query)["code"][0]
    bad = client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": CB,
                                            "code_verifier": "x" * 64, "client_id": cid})
    assert bad.status_code == 400
    deny = _authorize(client, cid, challenge, email, decision="deny")
    assert "error=access_denied" in deny.headers["location"]
    # customer (non-staff) account cannot connect
    c = sqlite.create_customer(name="Cust", email="cust_oauth@example.com", mobile="9811122233", password_hash=_hash_password(PW), role="customer")
    assert _authorize(client, cid, challenge, "cust_oauth@example.com").status_code == 403


def test_unregistered_redirect_is_not_followed(client):
    cid = _register(client)
    r = client.post("/oauth/authorize", data={"client_id": cid, "redirect_uri": "https://evil.example/cb", "code_challenge": "c" * 43,
                                              "email": "a@b.c", "password": "x", "decision": "allow"}, follow_redirects=False)
    assert r.status_code == 400


def test_consent_page_keeps_its_own_csp_so_styles_load(client):
    cid = _register(client)
    r = client.get("/oauth/authorize", params={"response_type": "code", "client_id": cid, "redirect_uri": CB,
                                               "code_challenge": "c" * 43, "code_challenge_method": "S256"})
    assert r.status_code == 200 and "style-src 'unsafe-inline'" in r.headers["content-security-policy"]
    assert 'type="text"' in r.text  # staff sign in with whatever their login is, not only a strict email
    assert client.get("/oauth/font/GoogleSans-Regular.ttf").status_code == 200
    assert client.get("/oauth/font/../../main.py").status_code == 404
