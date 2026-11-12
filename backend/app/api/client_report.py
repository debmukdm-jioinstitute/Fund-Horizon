"""Backoffice > Operations > Client report: parse any uploaded statements/factsheets, compute XIRR + investment matrices,
render the Fund Horizon consolidated PDF, and push to CRM + email."""
from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me, _optouts, _visible_customer
from app.db import sqlite
from app.mailer import MailerError, send_email
from app.repo_crm_core import get_crm_repository
from app.report.client_report import build_client_report, enrich_and_compute_matrices, parse_files, summarize

router = APIRouter(prefix="/api/backoffice/client-report", tags=["client-report"])
MAX_FILES, MAX_BYTES = 20, 15 * 1024 * 1024
_SCHEMA = """CREATE TABLE IF NOT EXISTS client_reports (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, report_date TEXT, data TEXT NOT NULL, pdf BLOB NOT NULL,
    emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)"""


class Row(BaseModel):
    name: str = Field(max_length=240)
    folio: str = Field(default="-", max_length=60)
    invested: float
    investments: float = 0
    div_reinv: float = 0
    div_payout: float = 0
    units: float = 0
    nav: float = 0
    value: float
    ann_ret: float = 0
    weight: float = 0
    abs_ret: float = 0
    isin: str | None = Field(default=None, max_length=20)
    code: str | None = Field(default=None, max_length=20)
    asset_class: str = Field(default="Mutual Fund", max_length=40)
    category: str = Field(default="", max_length=80)
    from_date: str = Field(default="", max_length=30)
    to_date: str = Field(default="", max_length=30)
    days: int | None = None
    inst: str = Field(default="", max_length=20)
    period: str = Field(default="", max_length=60)
    flag: str = Field(default="", max_length=5)
    flows: list[list[Any]] = Field(default_factory=list, max_length=1200)
    source_file: str = Field(default="", max_length=200)
    lots: list[list[Any]] = Field(default_factory=list, max_length=1200)


class SourceFileRef(BaseModel):
    id: str = Field(default="", max_length=64)
    name: str = Field(default="", max_length=200)
    kind: str = Field(default="statement", max_length=40)
    size: int = 0


class Client(BaseModel):
    name: str = Field(default="", max_length=120)
    date: str = Field(default="", max_length=30)
    arn: str = Field(default="345439", max_length=20)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=120)
    pan: str = Field(default="", max_length=20)
    inception: str = Field(default="", max_length=30)
    timeframe: str = Field(default="", max_length=100)


class FactItem(BaseModel):
    label: str = Field(max_length=100)
    value: str = Field(max_length=160)


class Factsheet(BaseModel):
    source: str = Field(max_length=140)
    items: list[FactItem] = Field(max_length=50)


class Report(BaseModel):
    client: Client
    xirr: float | None = None
    rows: list[Row] = Field(min_length=1, max_length=400)
    factsheets: list[Factsheet] = Field(default_factory=list, max_length=30)
    matrices: dict[str, Any] | None = None
    source_files: list[SourceFileRef] = Field(default_factory=list, max_length=40)
    attach_statements: bool = True


class PushIn(BaseModel):
    customer_id: str
    report: Report
    send_email: bool = True


def _filename(r: Report) -> str:
    return re.sub(r"[^\w.\- ]", "_", f"Portfolio Valuation Report - {r.client.name or 'Client'} - {r.client.date or 'Report'}")[:100] + ".pdf"


@router.post("/parse")
async def parse(me: Me, files: Annotated[list[UploadFile], File()], password: Annotated[str, Form()] = ""):
    if not files or len(files) > MAX_FILES:
        raise HTTPException(422, f"Upload 1 to {MAX_FILES} files.")
    blobs = []
    for f in files:
        b = await f.read()
        if len(b) > MAX_BYTES:
            raise HTTPException(422, f"{f.filename}: larger than 15 MB.")
        blobs.append((f.filename or "file.pdf", b))
    data = parse_files(blobs, password=password)
    return {**data, "summary": summarize(data)}


@router.post("/analyze")
def analyze(report: Report, me: Me):
    data = report.model_dump()
    summarize(data)
    enrich_and_compute_matrices(data)
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
    rep_dict = body.report.model_dump()
    pdf = build_client_report(rep_dict)
    rid, now = uuid.uuid4().hex, datetime.now(UTC).isoformat()
    emailed = None
    if body.send_email:
        to = (customer.get("email") or body.report.client.email or "").strip()
        if not to or to.endswith("@placeholder.invalid"):
            raise HTTPException(422, "No email address on file for this client.")
        if _optouts().email_opted_out(body.customer_id):
            raise HTTPException(422, "This client has opted out of emails.")
        first = (customer["name"] or body.report.client.name or "").split(" ")[0] or "there"
        try:
            send_email(to, f"Your consolidated portfolio valuation report - {body.report.client.date}",
                       f"Dear {first},\n\nPlease find attached your consolidated portfolio valuation report as on {body.report.client.date}.\n\nRegards,\nFund Horizon",
                       [(_filename(body.report), pdf)])
        except MailerError as e:
            raise HTTPException(503 if not e.configured else 502, str(e)) from e
        emailed = now
    conn = sqlite.get_default_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            conn.execute("INSERT INTO client_reports VALUES (?,?,?,?,?,?,?,?)",
                         (rid, body.customer_id, body.report.client.date, json.dumps(rep_dict), pdf, emailed, now, me["id"]))
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
