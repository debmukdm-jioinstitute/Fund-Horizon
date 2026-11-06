"""OAuth 2.1 for the Fund Horizon MCP server, so Claude on the web and phones can connect with "Add custom connector".

Mobile/web connectors cannot hold a pasted bearer token. They discover this server from the 401 on ``POST /mcp``, register
themselves (RFC 7591), send the user to ``/oauth/authorize`` (PKCE S256), and swap the code at ``/oauth/token``.

The access token issued here is the same personal token as the Desktop one (``mcp_tokens`` + ``sessions``), so permissions,
audit and revocation ("Settings, Claude connection") behave identically. Staff only, exactly like the rest of /mcp.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import secrets
from pathlib import Path
import sqlite3
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse

from app.api.auth import _check_auth_rate_limit, _public_customer, _verify_password, require_staff
from app.db import sqlite

router = APIRouter(tags=["mcp-oauth"])

ACCESS_DAYS = 1       # short access token, silently renewed with the refresh token
REFRESH_DAYS = 90
CODE_SECONDS = 300
LOCK_AFTER = 5        # wrong passwords per account ...
LOCK_MINUTES = 15     # ... inside this window lock the account's MCP sign-in (guessing "admin" from any IP stops here)
MAX_CLIENTS = 5000    # dynamic registration is open by design; cap it so it cannot fill the disk


def base_url() -> str:
    """Public origin of this API. Fixed from config, never taken from the request (no host-header spoofing)."""
    mcp = os.environ.get("FH_MCP_URL", "https://api.fundhorizon.website/mcp")
    return mcp[:-4] if mcp.endswith("/mcp") else mcp.rstrip("/")


def resource_metadata_url() -> str:
    return f"{base_url()}/.well-known/oauth-protected-resource"


def _db() -> sqlite3.Connection:
    conn = sqlite.get_default_connection()
    conn.execute("CREATE TABLE IF NOT EXISTS mcp_oauth_clients (client_id TEXT PRIMARY KEY, name TEXT, redirect_uris TEXT NOT NULL, created_at TEXT NOT NULL)")
    conn.execute("""CREATE TABLE IF NOT EXISTS mcp_oauth_codes (code_sha TEXT PRIMARY KEY, client_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, expires_at TEXT NOT NULL)""")
    conn.execute("CREATE TABLE IF NOT EXISTS mcp_oauth_fails (email TEXT NOT NULL, at TEXT NOT NULL)")
    conn.execute("""CREATE TABLE IF NOT EXISTS mcp_oauth_refresh (refresh_sha TEXT PRIMARY KEY, client_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        token_id TEXT NOT NULL, label TEXT NOT NULL, expires_at TEXT NOT NULL)""")
    return conn


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _json(data: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


def _oerr(code: str, desc: str, status: int = 400) -> JSONResponse:
    return _json({"error": code, "error_description": desc}, status)


# --------------------------------------------------------------------------- discovery
@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
def protected_resource():
    return _json({"resource": f"{base_url()}/mcp", "authorization_servers": [base_url()], "bearer_methods_supported": ["header"]})


@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/oauth-authorization-server/mcp")
def authorization_server():
    b = base_url()
    return _json({"issuer": b, "authorization_endpoint": f"{b}/oauth/authorize", "token_endpoint": f"{b}/oauth/token",
                  "registration_endpoint": f"{b}/oauth/register", "response_types_supported": ["code"],
                  "grant_types_supported": ["authorization_code", "refresh_token"], "code_challenge_methods_supported": ["S256"],
                  "token_endpoint_auth_methods_supported": ["none"]})


# --------------------------------------------------------------------------- dynamic client registration (RFC 7591)
def _valid_redirect(uri: str) -> bool:
    u = urlparse(uri)
    if u.fragment or not u.netloc:
        return False
    return u.scheme == "https" or (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1"))


@router.post("/oauth/register")
async def register(request: Request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return _oerr("invalid_client_metadata", "Body must be JSON.")
    uris = body.get("redirect_uris") if isinstance(body, dict) else None
    if not isinstance(uris, list) or not uris or len(uris) > 10 or not all(isinstance(u, str) and _valid_redirect(u) for u in uris):
        return _oerr("invalid_redirect_uri", "redirect_uris must be 1-10 https URLs (http only for localhost).")
    name = str(body.get("client_name") or "MCP client")[:80]
    conn = _db()
    if conn.execute("SELECT COUNT(*) FROM mcp_oauth_clients").fetchone()[0] >= MAX_CLIENTS:
        conn.close()
        return _oerr("temporarily_unavailable", "Client registry is full.", 503)
    cid = "fhc_" + secrets.token_urlsafe(18)
    with conn:
        conn.execute("INSERT INTO mcp_oauth_clients VALUES (?,?,?,?)", (cid, name, json.dumps(uris), _now().isoformat()))
    conn.close()
    return _json({"client_id": cid, "client_name": name, "redirect_uris": uris, "token_endpoint_auth_method": "none",
                  "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]}, 201)


def _client(client_id: str) -> dict | None:
    conn = _db()
    row = conn.execute("SELECT * FROM mcp_oauth_clients WHERE client_id = ?", (client_id,)).fetchone()
    conn.close()
    return {"name": row["name"], "uris": json.loads(row["redirect_uris"])} if row else None


# --------------------------------------------------------------------------- authorize (sign in + approve)
_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Fund Horizon</title><style>
@font-face{{font-family:"Google Sans";font-weight:400;src:url(/oauth/font/GoogleSans-Regular.ttf) format("truetype")}}
@font-face{{font-family:"Google Sans";font-weight:700;src:url(/oauth/font/GoogleSans-Bold.ttf) format("truetype")}}
*{{font-family:"Google Sans"}}
body{{font-family:"Google Sans";background:#f4f6f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}}
main{{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:24px;width:100%;max-width:400px;box-sizing:border-box}}
h1{{font-size:20px;margin:0 0 8px;color:#0b2545}}p{{font-size:15px;line-height:1.5;color:#374151;margin:8px 0}}
label{{display:block;font-size:14px;font-weight:600;margin-top:14px;color:#181818}}
input[type=text],input[type=password]{{width:100%;box-sizing:border-box;font-size:16px;padding:12px;margin-top:4px;border:1px solid #c9c9c9;border-radius:8px}}
button{{width:100%;font-size:16px;font-weight:600;padding:13px;margin-top:16px;border:0;border-radius:8px;cursor:pointer}}
.ok{{background:#006f64;color:#fff}}.no{{background:#eef0f3;color:#181818}}.err{{color:#b42332;font-size:14px}}
</style></head><body><main><h1>Connect Fund Horizon to Claude</h1>
<p><b>{client}</b> wants to use Fund Horizon with your account. It will see and change only what you can, and asks you before any change.</p>
{error}<form method="post" action="/oauth/authorize">{hidden}
<label>Email<input type="text" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" name="email" autocomplete="username" required autofocus></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required></label>
<button class="ok" name="decision" value="allow">Sign in and allow</button>
<button class="no" name="decision" value="deny" formnovalidate>Cancel</button></form>
<p style="font-size:12px;color:#706e6b">Staff accounts only. You can remove this connection any time in Fund Horizon, Settings, Claude connection.</p></main></body></html>"""

@router.get("/oauth/font/{name}")
def font(name: str):
    """The project's own Google Sans (same files the PDFs use), so the sign-in page matches the rest of Fund Horizon."""
    if name not in ("GoogleSans-Regular.ttf", "GoogleSans-Bold.ttf"):
        raise HTTPException(404, "Not found.")
    return FileResponse(Path(__file__).parent / "report" / "fonts" / name, media_type="font/ttf", headers={"Cache-Control": "public, max-age=31536000, immutable"})


_PARAMS = ("client_id", "redirect_uri", "code_challenge", "state", "scope", "resource")


def _page(p: dict, client: str, error: str = "", status: int = 200) -> HTMLResponse:
    hidden = "".join(f'<input type="hidden" name="{k}" value="{html.escape(p.get(k, ""), quote=True)}">' for k in _PARAMS)
    err = f'<p class="err" role="alert">{html.escape(error)}</p>' if error else ""
    return HTMLResponse(_PAGE.format(client=html.escape(client), hidden=hidden, error=err), status_code=status,
                        headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'"})


def _validate(p: dict) -> tuple[dict | None, str]:
    c = _client(p.get("client_id", ""))
    if not c:
        return None, "Unknown application. Remove the connector in Claude and add it again."
    if p.get("redirect_uri") not in c["uris"]:
        return None, "This redirect address is not registered for the application."
    if not p.get("code_challenge") or len(p["code_challenge"]) < 43:
        return None, "The application did not send a PKCE challenge."
    return c, ""


@router.get("/oauth/authorize")
def authorize_form(request: Request):
    q = dict(request.query_params)
    if q.get("response_type") != "code" or q.get("code_challenge_method") != "S256":
        return _page(q, "An application", "Unsupported request (needs response_type=code and PKCE S256).", 400)
    c, err = _validate(q)
    return _page(q, c["name"] if c else "An application", err, 400) if err else _page(q, c["name"])


@router.post("/oauth/authorize")
async def authorize_submit(request: Request):
    form = {k: str(v) for k, v in (await request.form()).items()}
    c, err = _validate(form)
    if err:
        return _page(form, "An application", err, 400)
    back = form["redirect_uri"]

    def go(**kw):
        if form.get("state"):
            kw["state"] = form["state"]
        return RedirectResponse(f"{back}{'&' if '?' in back else '?'}{urlencode(kw)}", status_code=303)

    if form.get("decision") != "allow":
        return go(error="access_denied")
    _check_auth_rate_limit(request)
    email = (form.get("email") or "").strip().lower()[:200]
    since = (_now() - timedelta(minutes=LOCK_MINUTES)).isoformat()
    conn = _db()
    with conn:
        conn.execute("DELETE FROM mcp_oauth_fails WHERE at < ?", (since,))
    fails = conn.execute("SELECT COUNT(*) FROM mcp_oauth_fails WHERE email = ?", (email,)).fetchone()[0]
    if fails >= LOCK_AFTER:
        conn.close()
        return _page(form, c["name"], f"Too many wrong passwords. Try again in {LOCK_MINUTES} minutes.", 429)
    row = sqlite.get_customer_by_email(email)
    ok = bool(row) and _verify_password(form.get("password") or "", row["password_hash"])
    if not ok:
        with conn:
            conn.execute("INSERT INTO mcp_oauth_fails VALUES (?,?)", (email, _now().isoformat()))
        conn.close()
        return _page(form, c["name"], "Invalid email or password.", 401)
    conn.close()
    if not _active(row):
        return _page(form, c["name"], "This account is suspended or inactive.", 403)
    code = secrets.token_urlsafe(32)
    conn = _db()
    with conn:
        conn.execute("DELETE FROM mcp_oauth_codes WHERE expires_at < ?", (_now().isoformat(),))
        conn.execute("INSERT INTO mcp_oauth_codes VALUES (?,?,?,?,?,?)",
                     (_sha(code), form["client_id"], row["id"], back, form["code_challenge"], (_now() + timedelta(seconds=CODE_SECONDS)).isoformat()))
    conn.close()
    return go(code=code)


# --------------------------------------------------------------------------- token
def _issue(staff: dict, client_id: str, label: str) -> dict:
    from app.mcp_server import _new_token  # late import: mcp_server imports this module for the 401 header

    tid, access, _ = _new_token(staff, label, ACCESS_DAYS)
    refresh = "fhr_" + secrets.token_urlsafe(32)
    conn = _db()
    with conn:
        conn.execute("INSERT INTO mcp_oauth_refresh VALUES (?,?,?,?,?,?)",
                     (_sha(refresh), client_id, staff["id"], tid, label, (_now() + timedelta(days=REFRESH_DAYS)).isoformat()))
    conn.close()
    return {"access_token": access, "token_type": "Bearer", "expires_in": ACCESS_DAYS * 86400, "refresh_token": refresh}


def _active(row: dict | None) -> dict | None:
    """Any active account may connect: staff get every tool, customers only their own My money tools (enforced in mcp_server)."""
    pub = _public_customer(row) if row else None
    return pub if pub and pub.get("status") not in ("inactive", "suspended") else None


def _staff(customer_id: str) -> dict | None:
    return _active(sqlite.get_customer_by_id(customer_id))


@router.post("/oauth/token")
async def token(request: Request):
    # no per-IP limit: Claude calls from shared cloud IPs; codes and refresh tokens are high-entropy and single use
    f = {k: str(v) for k, v in (await request.form()).items()}
    gt, cid = f.get("grant_type"), f.get("client_id", "")
    conn = _db()
    try:
        if gt == "authorization_code":
            h = _sha(f.get("code", ""))
            row = conn.execute("SELECT * FROM mcp_oauth_codes WHERE code_sha = ?", (h,)).fetchone()
            with conn:  # single use, even if validation below fails
                used = conn.execute("DELETE FROM mcp_oauth_codes WHERE code_sha = ?", (h,)).rowcount
            verifier = f.get("code_verifier", "")
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            if (not row or not used or row["client_id"] != cid or row["redirect_uri"] != f.get("redirect_uri")
                    or row["expires_at"] < _now().isoformat() or not secrets.compare_digest(challenge, row["challenge"])):
                return _oerr("invalid_grant", "Code is invalid, expired or already used.")
            staff = _staff(row["customer_id"])
            if not staff:
                return _oerr("invalid_grant", "Account is no longer allowed.")
            return _json(_issue(staff, cid, "Claude (web and mobile)"))
        if gt == "refresh_token":
            h = _sha(f.get("refresh_token", ""))
            row = conn.execute("SELECT * FROM mcp_oauth_refresh WHERE refresh_sha = ?", (h,)).fetchone()
            with conn:  # rotate: a refresh token works once
                used = conn.execute("DELETE FROM mcp_oauth_refresh WHERE refresh_sha = ?", (h,)).rowcount
            if not row or not used or row["client_id"] != cid or row["expires_at"] < _now().isoformat():
                return _oerr("invalid_grant", "Refresh token is invalid or expired.")
            staff = _staff(row["customer_id"])
            if not staff:
                return _oerr("invalid_grant", "Account is no longer allowed.")
            old = conn.execute("SELECT token_sha256 FROM mcp_tokens WHERE id = ?", (row["token_id"],)).fetchone()
            if old:
                sqlite.delete_auth_session(old["token_sha256"])
                with conn:
                    conn.execute("DELETE FROM mcp_tokens WHERE id = ?", (row["token_id"],))
            return _json(_issue(staff, cid, row["label"]))
        return _oerr("unsupported_grant_type", "Use authorization_code or refresh_token.")
    finally:
        conn.close()
