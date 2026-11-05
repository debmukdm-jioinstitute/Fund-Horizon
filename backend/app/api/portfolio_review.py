from __future__ import annotations
"""Backoffice > Operations > Portfolio review: render the client Portfolio Review deck from the holdings the adviser enters
plus live Fund Horizon data, then download it, save it to the client's CRM record and/or email it."""

import json
import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me, _optouts, _visible_customer
from app.data.loader import load_nav
from app.db import sqlite
from app.mailer import MailerError, send_email
from app.repo_crm_core import get_crm_repository
from app.report.portfolio_review import STRESS_WINDOWS, build_portfolio_review, window_fall

router = APIRouter(prefix="/api/backoffice/portfolio-review", tags=["portfolio-review"])
_SCHEMA = """CREATE TABLE IF NOT EXISTS portfolio_reviews (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, report_date TEXT, data TEXT NOT NULL, pdf BLOB NOT NULL,
    emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)"""
_LIVE_COLS = ("name", "cat", "cat_label", "nav_date", "cagr_3y", "cap_up_3y", "cap_down_3y", "cap_ratio_3y", "max_dd_3y", "max_dd_all",
              "history_years", "fh_score", "fh_signal", "is_fh_recommended")


class Holding(BaseModel):
    code: str = Field(pattern=r"^\d{4,8}$")
    invested: float = Field(ge=0)
    value: float = Field(ge=0)
    name: str = Field(default="", max_length=200)
    typ: str = Field(default="", max_length=60)
    period: str = Field(default="", max_length=40)
    inst: str = Field(default="", max_length=10)
    ret: float | None = None
    flag: str = Field(default="", pattern="^(\u2020|\\*)?$")  # glyphs Google Sans has: dagger (under 1 yr), asterisk (estimated)


class PerFund(BaseModel):
    pct: float | None = None
    inr: float | None = None


class IndexRow(BaseModel):
    name: str = Field(max_length=120)
    index: str = Field(max_length=60)
    period: str = Field(max_length=40)
    ret: float
    idx: float
    lead: float
    inr: float


class Compare(BaseModel):
    """Optional, computed from instalment-level data (CAS): without it the same-instalment index slides are left out."""
    portfolio_xirr: float | None = None
    nifty50_xirr: float = 0
    nifty500_xirr: float = 0
    ahead_inr_500: float = 0
    ahead_inr_50: float = 0
    funds_ahead_50: int = 0
    per_fund: dict[str, PerFund] = Field(default_factory=dict)
    index_rows: list[IndexRow] = Field(default_factory=list, max_length=12)


class Client(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    date: str = Field(min_length=1, max_length=20)


class Review(BaseModel):
    client: Client
    holdings: list[Holding] = Field(min_length=1, max_length=200)
    compare: Compare | None = None


class PushIn(BaseModel):
    customer_id: str
    review: Review
    send_email: bool = False


def _frame():
    from app.api.backoffice import _fh_frame
    return _fh_frame()


def _nav(code: str):
    try:
        return load_nav(code)
    except (FileNotFoundError, KeyError):
        return None


def live_data(codes: list[str]) -> dict[str, dict]:
    """Per scheme code: screener fields + each fund's own fall in the stress windows. Unknown codes are simply absent."""
    fr = _frame()
    fr = fr[fr["code"].isin(codes)].drop_duplicates("code").set_index("code")
    out: dict[str, dict] = {}
    for code, r in fr.iterrows():
        d = {k: (None if r.get(k) != r.get(k) else r.get(k)) for k in _LIVE_COLS}
        reasons = r.get("fh_signal_reasons")
        d["reason"] = reasons[0] if isinstance(reasons, (list, tuple)) and reasons else ""
        d["recommended"] = bool(d.pop("is_fh_recommended"))
        nav = _nav(code)
        d["falls"] = {k: window_fall(nav, a, b) for k, (a, b, _) in STRESS_WINDOWS.items()}
        out[code] = d
    return out


def _pdf(rv: Review) -> bytes:
    h = rv.model_dump()
    return build_portfolio_review(h, live_data([x["code"] for x in h["holdings"]]))


def _filename(rv: Review) -> str:
    return re.sub(r"[^\w.\- ]", "_", f"Portfolio Review - {rv.client.name} - {rv.client.date}")[:100] + ".pdf"


@router.post("/pdf")
def render(review: Review, me: Me):
    return Response(_pdf(review), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{_filename(review)}"'})


@router.post("/push")
def push(body: PushIn, me: Me):
    """Store the review on the client's CRM record and (optionally) email the PDF to the client."""
    _visible_customer(body.customer_id, me)
    customer = sqlite.get_customer_by_id(body.customer_id)
    pdf, rid, now, emailed = _pdf(body.review), uuid.uuid4().hex, datetime.now(UTC).isoformat(), None
    if body.send_email:
        to = (customer.get("email") or "").strip()
        if not to or to.endswith("@placeholder.invalid"):
            raise HTTPException(422, "No email address on file for this client.")
        if _optouts().email_opted_out(body.customer_id):
            raise HTTPException(422, "This client has opted out of emails.")
        first = (customer["name"] or "").split(" ")[0] or "there"
        try:
            send_email(to, f"Your portfolio review - {body.review.client.date}",
                       f"Dear {first},\n\nPlease find attached your portfolio review as on {body.review.client.date}.\n\nRegards,\nFund Horizon",
                       [(_filename(body.review), pdf)])
        except MailerError as e:
            raise HTTPException(503 if not e.configured else 502, str(e)) from e
        emailed = now
    conn = sqlite.get_default_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            conn.execute("INSERT INTO portfolio_reviews VALUES (?,?,?,?,?,?,?,?)",
                         (rid, body.customer_id, body.review.client.date, json.dumps(body.review.model_dump()), pdf, emailed, now, me["id"]))
    finally:
        conn.close()
    get_crm_repository().create_activity(
        kind="note", subject=f"Portfolio review {body.review.client.date}" + (" (emailed)" if emailed else ""),
        body=f"Portfolio review PDF stored (id {rid}).", customer_id=body.customer_id, actor_id=me["id"])
    return {"id": rid, "emailed": bool(emailed)}


@router.get("/customers/{customer_id}")
def history(customer_id: str, me: Me):
    _visible_customer(customer_id, me)
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        rows = conn.execute("SELECT id, report_date, emailed_at, created_at FROM portfolio_reviews WHERE customer_id=? ORDER BY created_at DESC LIMIT 50", (customer_id,)).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.get("/{review_id}/pdf")
def stored_pdf(review_id: str, me: Me):
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        row = conn.execute("SELECT customer_id, pdf FROM portfolio_reviews WHERE id=?", (review_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Review not found")
    _visible_customer(row["customer_id"], me)
    return Response(row["pdf"], media_type="application/pdf")
