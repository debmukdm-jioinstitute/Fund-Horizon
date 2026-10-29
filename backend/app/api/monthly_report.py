from __future__ import annotations
"""Backoffice > Operations > Paperwork Processing: monthly bucket reports.

Save-first ordering, on purpose: the report row is stored before any email attempt,
so a failed or unconfigured email never loses the report (unlike the older
folio-wise push, which emailed first). A successful email is also logged as a
``kind="email"`` CRM activity, so it shows up under Operations > Sent emails.
"""

import json
import re
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me, _optouts, _visible_customer
from app.db import sqlite
from app.mailer import MailerError, send_email
from app.repo_crm_core import get_crm_repository
from app.report.monthly_report import build_monthly_report, parse_monthly_files

router = APIRouter(prefix="/api/backoffice/monthly-report", tags=["monthly-report"])
MAX_FILES, MAX_BYTES = 10, 15 * 1024 * 1024
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SCHEMA = """CREATE TABLE IF NOT EXISTS monthly_reports (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, household_id TEXT, report_month TEXT, value_as_on TEXT,
    data TEXT NOT NULL, pdf BLOB NOT NULL, emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)"""


class Bucket(BaseModel):
    name: str = Field(max_length=120)
    invested: float
    current: float
    xirr: float | None = None


class PmsRow(BaseModel):
    invested: float = 0
    current: float = 0
    xirr: float | None = None


class Client(BaseModel):
    name: str = Field(max_length=120)
    date: str = Field(max_length=20)
    arn: str = Field(max_length=20)
    phone: str = Field(default="", max_length=20)


class FactItem(BaseModel):
    label: str = Field(max_length=80)
    value: str = Field(max_length=120)


class Factsheet(BaseModel):
    source: str = Field(max_length=120)
    items: list[FactItem] = Field(max_length=40)


class MonthlyReport(BaseModel):
    client: Client
    month: str = Field(min_length=1, max_length=40)
    inception: str = Field(default="", max_length=40)
    total_xirr: float | None = None
    buckets: list[Bucket] = Field(min_length=1, max_length=100)
    pms: PmsRow = PmsRow()
    factsheets: list[Factsheet] = Field(default_factory=list, max_length=20)


class CustomClient(BaseModel):
    name: str = Field(max_length=120)
    mobile: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=120)


class PushIn(BaseModel):
    customer_id: str | None = None
    household_id: str | None = None
    custom_client: CustomClient | None = None
    report: MonthlyReport
    send_email: bool = True


def _filename(r: MonthlyReport) -> str:
    return re.sub(r"[^\w.\- ]", "_", f"{r.client.name} Monthly report {r.month}")[:100] + ".pdf"


@router.post("/parse")
async def parse(me: Me, files: Annotated[list[UploadFile], File()]):
    if not files or len(files) > MAX_FILES:
        raise HTTPException(422, f"Upload 1 to {MAX_FILES} files.")
    blobs = []
    for f in files:
        b = await f.read()
        if len(b) > MAX_BYTES:
            raise HTTPException(422, f"{f.filename}: larger than 15 MB.")
        blobs.append((f.filename or "file.pdf", b))
    try:  # OCR is CPU-bound: keep the event loop free
        return await run_in_threadpool(parse_monthly_files, blobs)
    except Exception as e:  # JSON detail so the page shows the exact reason, not "Request failed (500)"
        raise HTTPException(500, f"Parsing failed: {type(e).__name__}: {e}") from e


@router.post("/pdf")
def render(report: MonthlyReport, me: Me):
    pdf = build_monthly_report(report.model_dump())
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_filename(report)}"'})


def _resolve_or_create_custom_client(name: str, mobile: str | None, email: str | None, me: dict):
    """Resolve a custom client to a proper CRM customer + household.

    Duplicate check first (email, then mobile): an existing customer is reused
    and never duplicated. If the matched customer has no household yet, one is
    created for them. Otherwise a new customer + household are created,
    following the lead-conversion pattern in ``repo_crm_core.convert_lead``:
    household named exactly as entered, new customer as primary member, role
    'customer', assigned_rm_id = the staff RM (or None for admin), placeholder
    email/mobile only when missing, and a password hash of a random value that
    is never returned and never shown to anyone — so no usable portal login
    exists unless the RM separately invites the client to the portal, which
    is out of scope here. Returns (customer_id, household_id, matched_existing).
    """
    repo = get_crm_repository()
    by_email = sqlite.get_customer_by_email(email) if email else None
    by_mobile = sqlite.get_customer_by_mobile(mobile) if mobile else None
    if by_email and by_mobile and by_email["id"] != by_mobile["id"]:
        raise HTTPException(422, "The entered email and mobile match different CRM records. Check the details and try again.")
    matched = by_email or by_mobile
    owner_rm = me["id"] if me.get("role") == "rm" else None
    if matched is not None:
        customer_id = matched["id"]
        memberships = repo.customer_memberships(customer_id)
        if memberships:
            return customer_id, memberships[0]["household_id"], True
        household = repo.create_household(name=name, primary_customer_id=customer_id, rm_id=owner_rm, actor_id=me["id"])
        repo.add_household_member(household_id=household["id"], customer_id=customer_id, role="primary", actor_id=me["id"])
        return customer_id, household["id"], True
    token = uuid.uuid4().hex
    email_final = email or f"no-email-{token[:12]}@placeholder.invalid"
    mobile_final = mobile or f"0000{token[:8]}"  # convert_lead pattern: not a valid mobile, so never collides
    from app.api.auth import _hash_password

    password_hash = _hash_password(secrets.token_hex(32))
    try:
        customer = sqlite.create_customer(
            name=name, email=email_final, mobile=mobile_final,
            password_hash=password_hash, role="customer", assigned_rm_id=owner_rm)
    except ValueError:
        # A duplicate slipped in between the lookup and the insert: reuse it.
        again = (sqlite.get_customer_by_email(email) if email else None) or (sqlite.get_customer_by_mobile(mobile) if mobile else None)
        if again is None:
            raise
        return _resolve_or_create_custom_client(name, mobile, email, me)
    customer_id = customer["id"]
    household = repo.create_household(name=name, primary_customer_id=customer_id, rm_id=owner_rm, actor_id=me["id"])
    repo.add_household_member(household_id=household["id"], customer_id=customer_id, role="primary", actor_id=me["id"])
    return customer_id, household["id"], False


def _push_household(customer_id: str, household_id: str | None, report: MonthlyReport, send_email_flag: bool, me: dict):
    """The existing household push, unchanged: store, then optionally email.

    Email problems are returned as ``email_error`` with ``emailed: false`` — the
    stored copy stands either way. The client's email address always comes from
    the CRM record at send time, never from an uploaded file header.
    """
    _visible_customer(customer_id, me)
    customer = sqlite.get_customer_by_id(customer_id)
    if not customer:
        raise HTTPException(404, "Client not found")
    pdf = build_monthly_report(report.model_dump())
    rid, now = uuid.uuid4().hex, datetime.now(UTC).isoformat()
    conn = sqlite.get_default_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            conn.execute("INSERT INTO monthly_reports VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (rid, customer_id, household_id, report.month, report.client.date,
                          json.dumps(report.model_dump()), pdf, None, now, me["id"]))
    finally:
        conn.close()
    emailed, email_error, email_id = False, None, ""
    if send_email_flag:
        to = (customer.get("email") or "").strip()
        if not to or to.endswith("@placeholder.invalid"):
            email_error = "No email address on file for this client."
        elif _optouts().email_opted_out(customer_id):
            email_error = "This client has opted out of emails."
        else:
            first = (customer["name"] or "").split(" ")[0] or "there"
            text = (f"Dear {first},\n\nPlease find attached your monthly report for {report.month} "
                    f"(value as on {report.client.date}).\n\nRegards,\nFund Horizon")
            try:
                email_id = send_email(to, f"Your monthly report - {report.month}", text,
                                      [(_filename(report), pdf)])
                emailed = True
            except MailerError as e:
                email_error = str(e)
        if emailed:
            conn = sqlite.get_default_connection()
            try:
                with conn:
                    conn.execute(_SCHEMA)
                    conn.execute("UPDATE monthly_reports SET emailed_at=? WHERE id=?", (now, rid))
            finally:
                conn.close()
            repo = get_crm_repository()
            repo.create_activity(
                kind="email", subject=f"Your monthly report - {report.month}",
                body=f"To: {to}\n\n{text}\n\nAttachments: {_filename(report)}",
                customer_id=customer_id, actor_id=me["id"],
                source_ref=f"resend:{email_id}" if email_id else None)
    get_crm_repository().create_activity(
        kind="note", subject=f"Monthly report {report.month}" + (" (emailed)" if emailed else ""),
        body=f"Monthly report stored (id {rid}).", customer_id=customer_id, actor_id=me["id"])
    return {"id": rid, "emailed": emailed, "email_error": email_error}


@router.post("/push")
def push(body: PushIn, me: Me):
    """Store the report, then (optionally) email it.

    Exactly one of a CRM customer or a custom client must be given. In custom
    mode the client is first resolved to, or created as, a proper CRM customer
    + household (see ``_resolve_or_create_custom_client``) and the existing
    household push then runs unchanged — same monthly_reports row, note and
    email activities, history, latest and re-download. If the CRM record is
    created but the report push then fails, that is reported honestly instead
    of silently rolling back or hiding it. No portal invitation or usable
    password is ever generated or returned here.
    """
    if bool(body.customer_id) == bool(body.custom_client):
        raise HTTPException(422, "Provide either a CRM customer or a custom client, not both.")
    if body.custom_client is not None:
        name = body.custom_client.name.strip()
        if not name:
            raise HTTPException(422, "Custom client name is required.")
        email = body.custom_client.email.strip().lower() or None
        mobile = body.custom_client.mobile.strip() or None
        if email and not _EMAIL_RE.match(email):
            raise HTTPException(422, "Custom client email does not look like an email address.")
        try:
            customer_id, household_id, matched_existing = _resolve_or_create_custom_client(name, mobile, email, me)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Could not create or match a CRM record for this custom client: {e}") from e
        try:
            result = _push_household(customer_id, household_id, body.report, body.send_email, me)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"CRM record was {'matched' if matched_existing else 'created'} "
                                f"(customer {customer_id}, household {household_id}) but the report was not saved: {e}") from e
        return {**result, "customer_id": customer_id, "household_id": household_id, "matched_existing": matched_existing}
    result = _push_household(body.customer_id, body.household_id, body.report, body.send_email, me)  # type: ignore[arg-type]
    return {**result, "customer_id": body.customer_id, "household_id": body.household_id, "matched_existing": False}


@router.get("/customers/{customer_id}")
def history(customer_id: str, me: Me):
    _visible_customer(customer_id, me)
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        rows = conn.execute(
            "SELECT id, report_month, value_as_on, emailed_at, created_at FROM monthly_reports "
            "WHERE customer_id=? ORDER BY created_at DESC LIMIT 50", (customer_id,)).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.get("/customers/{customer_id}/latest")
def latest(customer_id: str, me: Me):
    _visible_customer(customer_id, me)
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        row = conn.execute(
            "SELECT id, data FROM monthly_reports WHERE customer_id=? ORDER BY created_at DESC LIMIT 1",
            (customer_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "No monthly report stored for this client yet")
    return {"id": row["id"], "report": json.loads(row["data"])}


@router.get("/{report_id}/pdf")
def stored_pdf(report_id: str, me: Me):
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        row = conn.execute("SELECT customer_id, pdf FROM monthly_reports WHERE id=?", (report_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Report not found")
    _visible_customer(row["customer_id"], me)
    return Response(row["pdf"], media_type="application/pdf")
