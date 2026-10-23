from __future__ import annotations
"""Backoffice > Operations > Client report: parse statements/factsheets, render the PDF, push to CRM + email."""

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
from app.report.client_report import build_client_report, parse_files, summarize

router = APIRouter(prefix="/api/backoffice/client-report", tags=["client-report"])
MAX_FILES, MAX_BYTES = 10, 15 * 1024 * 1024
_SCHEMA = """CREATE TABLE IF NOT EXISTS client_reports (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, report_date TEXT, data TEXT NOT NULL, pdf BLOB NOT NULL,
    emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)"""


class Row(BaseModel):
    name: str = Field(max_length=200)
    folio: str = Field(max_length=40)
    invested: float
    investments: float
    div_reinv: float
    div_payout: float
    units: float
    nav: float
    value: float
    ann_ret: float
    weight: float = 0
    abs_ret: float = 0


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


class Report(BaseModel):
    client: Client
    xirr: float | None = None
    rows: list[Row] = Field(min_length=1, max_length=300)
    factsheets: list[Factsheet] = Field(default_factory=list, max_length=20)


class PushIn(BaseModel):
    customer_id: str
    report: Report
    send_email: bool = True


def _filename(r: Report) -> str:
    return re.sub(r"[^\w.\- ]", "_", f"Portfolio Valuation Report - {r.client.name} - {r.client.date}")[:100] + ".pdf"


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
    data = parse_files(blobs)
    return {**data, "summary": summarize(data)}


@router.post("/pdf")
def render(report: Report, me: Me):
    pdf = build_client_report(report.model_dump())
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{_filename(report)}"'})


@router.post("/push")
def push(body: PushIn, me: Me):
    """Store the report on the client's CRM record and (optionally) email the PDF to the client."""
    _visible_customer(body.customer_id, me)
    customer = sqlite.get_customer_by_id(body.customer_id)
    pdf = build_client_report(body.report.model_dump())
    rid, now = uuid.uuid4().hex, datetime.now(UTC).isoformat()
    emailed = None
    if body.send_email:
        to = (customer.get("email") or "").strip()
        if not to or to.endswith("@placeholder.invalid"):
            raise HTTPException(422, "No email address on file for this client.")
        if _optouts().email_opted_out(body.customer_id):
            raise HTTPException(422, "This client has opted out of emails.")
        first = (customer["name"] or "").split(" ")[0] or "there"
        try:
            send_email(to, f"Your portfolio valuation report - {body.report.client.date}",
                       f"Dear {first},\n\nPlease find attached your portfolio valuation report as on {body.report.client.date}.\n\nRegards,\nFund Horizon",
                       [(_filename(body.report), pdf)])
        except MailerError as e:
            raise HTTPException(503 if not e.configured else 502, str(e)) from e
        emailed = now
    conn = sqlite.get_default_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            conn.execute("INSERT INTO client_reports VALUES (?,?,?,?,?,?,?,?)",
                         (rid, body.customer_id, body.report.client.date, json.dumps(body.report.model_dump()), pdf, emailed, now, me["id"]))
    finally:
        conn.close()
    get_crm_repository().create_activity(
        kind="note", subject=f"Client report {body.report.client.date}" + (" (emailed)" if emailed else ""),
        body=f"Portfolio valuation report stored (id {rid}).", customer_id=body.customer_id, actor_id=me["id"])
    return {"id": rid, "emailed": bool(emailed)}


@router.get("/customers/{customer_id}")
def history(customer_id: str, me: Me):
    _visible_customer(customer_id, me)
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        rows = conn.execute("SELECT id, report_date, emailed_at, created_at FROM client_reports WHERE customer_id=? ORDER BY created_at DESC LIMIT 50", (customer_id,)).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.get("/{report_id}/pdf")
def stored_pdf(report_id: str, me: Me):
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        row = conn.execute("SELECT customer_id, pdf FROM client_reports WHERE id=?", (report_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Report not found")
    _visible_customer(row["customer_id"], me)
    return Response(row["pdf"], media_type="application/pdf")
