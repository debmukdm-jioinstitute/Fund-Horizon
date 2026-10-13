"""Customer account authentication: signup, login, sessions, and role guards.

Session identity travels in the ``fh_session`` HttpOnly cookie (or an
``Authorization: Bearer`` header fallback). Only the SHA-256 of the token is
stored server-side. Passwords use PBKDF2-HMAC-SHA256 with 600k iterations.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator

from app.db import sqlite

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE = "fh_session"
SESSION_DAYS = 30
SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600
PBKDF2_ITERATIONS = 600_000
AUTH_RATE_LIMIT = 10  # requests per minute per IP on signup + login
AUTH_RATE_WINDOW_S = 60.0

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")

# In-memory sliding-window counters for the auth endpoints: {ip: [monotonic timestamps]}.
_AUTH_ATTEMPTS: dict[str, list[float]] = {}


def _reset_auth_rate_limits() -> None:
    """Test hook: clear the in-memory auth rate-limit counters."""
    _AUTH_ATTEMPTS.clear()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def _check_auth_rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    now = time.monotonic()
    hits = _AUTH_ATTEMPTS.setdefault(ip, [])
    cutoff = now - AUTH_RATE_WINDOW_S
    while hits and hits[0] <= cutoff:
        hits.pop(0)
    if len(hits) >= AUTH_RATE_LIMIT:
        raise HTTPException(429, "Too many requests. Please try again later.")
    hits.append(now)


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


# Precomputed dummy hash so unknown-email logins cost the same as wrong-password ones.
_DUMMY_HASH = _hash_password(secrets.token_hex(16))


def _normalize_mobile(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits


def _public_customer(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "password_hash"}


def _parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _new_session_token(customer_id: str) -> str:
    token = secrets.token_urlsafe(32)
    token_sha = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).isoformat()
    sqlite.create_auth_session(customer_id, token_sha, expires_at)
    return token


def _cookie_settings() -> dict:
    secure = os.environ.get("FH_COOKIE_SECURE", "false").lower() in ("true", "1", "yes")
    return {
        "httponly": True,
        "samesite": "none" if secure else "lax",
        "secure": secure,
    }


def _set_session_cookie(response: Response, token: str) -> None:
    settings = _cookie_settings()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        path="/",
        **settings,
    )


def _clear_session_cookie(response: Response) -> None:
    settings = _cookie_settings()
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        **settings,
    )


def _token_from_request(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        return token
    auth = request.headers.get("authorization", "")
    if auth[:7].lower() == "bearer ":
        token = auth[7:].strip()
        return token or None
    return None


def get_current_customer(request: Request) -> dict:
    """Return the signed-in customer's public record, or raise 401."""
    token = _token_from_request(request)
    if not token:
        raise HTTPException(401, "Sign in required.")
    token_sha = hashlib.sha256(token.encode("utf-8")).hexdigest()
    sess = sqlite.get_auth_session(token_sha)
    if not sess:
        raise HTTPException(401, "Sign in required.")
    if _parse_dt(sess["expires_at"]) <= datetime.now(UTC):
        sqlite.delete_auth_session(token_sha)
        raise HTTPException(401, "Session expired. Please sign in again.")
    customer = sqlite.get_customer_by_id(sess["customer_id"])
    if not customer:
        sqlite.delete_auth_session(token_sha)
        raise HTTPException(401, "Sign in required.")
    admin_email = os.environ.get("FH_ADMIN_EMAIL", "").strip().lower()
    if admin_email and customer.get("email") == admin_email and customer.get("role") != "admin":
        updated = sqlite.update_customer(customer["id"], {"role": "admin"})
        if updated:
            customer = updated
    return _public_customer(customer)


def get_optional_customer(request: Request) -> dict | None:
    """Return the signed-in customer, or None for anonymous requests (never raises)."""
    try:
        return get_current_customer(request)
    except HTTPException:
        return None


def require_role(*roles: str):
    """Dependency factory: allow only customers whose role is in ``roles``."""

    def _require(customer: Annotated[dict, Depends(get_current_customer)]) -> dict:
        if customer["role"] not in roles:
            raise HTTPException(403, "You do not have permission to access this resource.")
        return customer

    return _require


class SignupRequest(BaseModel):
    name: str
    email: str
    mobile: str
    password: str
    consent: bool

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) < 2:
            raise ValueError("name must be at least 2 characters")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v: str) -> str:
        v = _normalize_mobile(v)
        if not _MOBILE_RE.match(v):
            raise ValueError("Enter a valid 10-digit Indian mobile number")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v or "") < 8:
            raise ValueError("password must be at least 8 characters")
        return v

    @field_validator("consent")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("consent is required")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


@auth_router.post("/signup", status_code=201)
def signup(body: SignupRequest, request: Request, response: Response):
    _check_auth_rate_limit(request)
    if sqlite.get_customer_by_email(body.email) or sqlite.get_customer_by_mobile(body.mobile):
        raise HTTPException(422, "An account with these details already exists")
    admin_email = os.environ.get("FH_ADMIN_EMAIL", "").strip().lower()
    role = "admin" if admin_email and body.email == admin_email else "customer"
    try:
        customer = sqlite.create_customer(
            name=body.name,
            email=body.email,
            mobile=body.mobile,
            password_hash=_hash_password(body.password),
            role=role,
        )
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    _set_session_cookie(response, _new_session_token(customer["id"]))
    return {"customer": customer}


@auth_router.post("/login")
def login(body: LoginRequest, request: Request, response: Response):
    _check_auth_rate_limit(request)
    email = (body.email or "").strip().lower()
    customer = sqlite.get_customer_by_email(email)
    if customer:
        ok = _verify_password(body.password or "", customer["password_hash"])
    else:
        # Same-cost dummy check so unknown emails don't answer faster.
        _verify_password(body.password or "", _DUMMY_HASH)
        ok = False
    if not ok or not customer:
        raise HTTPException(401, "Invalid email or password")
    admin_email = os.environ.get("FH_ADMIN_EMAIL", "").strip().lower()
    if admin_email and customer.get("email") == admin_email and customer.get("role") != "admin":
        updated = sqlite.update_customer(customer["id"], {"role": "admin"})
        if updated:
            customer = updated
    _set_session_cookie(response, _new_session_token(customer["id"]))
    return {"customer": _public_customer(customer)}


@auth_router.post("/logout")
def logout(request: Request, response: Response):
    token = _token_from_request(request)
    if token:
        sqlite.delete_auth_session(hashlib.sha256(token.encode("utf-8")).hexdigest())
    _clear_session_cookie(response)
    return {"success": True}


@auth_router.get("/me")
def me(customer: Annotated[dict, Depends(get_current_customer)]):
    return customer


@auth_router.get("/me/plans")
def my_plans(customer: Annotated[dict, Depends(get_current_customer)], limit: int = 50, offset: int = 0):
    plans = sqlite.list_customer_plans(customer["id"], limit=limit, offset=offset)
    return {"plans": plans, "total": sqlite.count_customer_plans(customer["id"]), "limit": limit, "offset": offset}
