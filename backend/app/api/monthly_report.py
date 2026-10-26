from __future__ import annotations
"""Backoffice > Operations > Paperwork Processing: monthly bucket reports.

Save-first ordering, on purpose: the report row is stored before any email attempt,
so a failed or unconfigured email never loses the report (unlike the older
folio-wise push, which emailed first). A successful email is also logged as a
``kind="email"`` CRM activity, so it shows up under Operations > Sent emails.
"""

import json
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me, _optouts, _visible_customer
from app.db import sqlite
from app.mailer import MailerError, send_email
from app.repo_crm_core import get_crm_repository
from app.report.monthly_report import build_monthly_report, parse_monthly_files

router = APIRouter(prefix="/api/backoffice/monthly-report", tags=["monthly-report"])
MAX_FILES, MAX_BYTES = 10, 15 * 1024 * 1024
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


class PushIn(BaseModel):
    customer_id: str
    household_id: str | None = None
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
    return parse_monthly_files(blobs)


@router.post("/pdf")
def render(report: MonthlyReport, me: Me):
    pdf = build_monthly_report(report.model_dump())
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_filename(report)}"'})


@router.post("/push")
def push(body: PushIn, me: Me):
    """Store the report on the client's CRM record, then (optionally) email it.

    Email problems are returned as ``email_error`` with ``emailed: false`` — the
    stored copy stands either way. The client's email address always comes from
    the CRM record at send time, never from an uploaded file header.
    """
    _visible_customer(body.customer_id, me)
    customer = sqlite.get_customer_by_id(body.customer_id)
    pdf = build_monthly_report(body.report.model_dump())
    rid, now = uuid.uuid4().hex, datetime.now(UTC).isoformat()
    conn = sqlite.get_default_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            conn.execute("INSERT INTO monthly_reports VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (rid, body.customer_id, body.household_id, body.report.month, body.report.client.date,
                          json.dumps(body.report.model_dump()), pdf, None, now, me["id"]))
    finally:
        conn.close()
    emailed, email_error, email_id = False, None, ""
    if body.send_email:
        to = (customer.get("email") or "").strip()
        if not to or to.endswith("@placeholder.invalid"):
            email_error = "No email address on file for this client."
        elif _optouts().email_opted_out(body.customer_id):
            email_error = "This client has opted out of emails."
        else:
            first = (customer["name"] or "").split(" ")[0] or "there"
            text = (f"Dear {first},\n\nPlease find attached your monthly report for {body.report.month} "
                    f"(value as on {body.report.client.date}).\n\nRegards,\nFund Horizon")
            try:
                email_id = send_email(to, f"Your monthly report - {body.report.month}", text,
                                      [(_filename(body.report), pdf)])
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
                kind="email", subject=f"Your monthly report - {body.report.month}",
                body=f"To: {to}\n\n{text}\n\nAttachments: {_filename(body.report)}",
                customer_id=body.customer_id, actor_id=me["id"],
                source_ref=f"resend:{email_id}" if email_id else None)
    get_crm_repository().create_activity(
        kind="note", subject=f"Monthly report {body.report.month}" + (" (emailed)" if emailed else ""),
        body=f"Monthly report stored (id {rid}).", customer_id=body.customer_id, actor_id=me["id"])
    return {"id": rid, "emailed": emailed, "email_error": email_error}


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
