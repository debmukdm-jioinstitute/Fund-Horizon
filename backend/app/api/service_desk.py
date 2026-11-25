from __future__ import annotations
"""Service desk: one place for incoming service queries and completed work, plus the monthly-report send tracker.

A query captures the client name and a category (operational, recommendation/investment or other). "Other" needs
free text. ``source`` records whether it was dictated or typed. Same auth as the CRM: admin/RM; compliance read-only.
"""

import calendar
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from app.api.crm_core import Me
from app.db import sqlite
from app.repo_crm_core import IST

router = APIRouter(prefix="/api/service-desk", tags=["service-desk"])

CATEGORIES = ("operational", "recommendation", "other")
STATUSES = ("incoming", "in_progress", "completed")
SEND_BY_DAY = 5  # reports are due before the 7th; aim for the 5th so a holiday or weekend still leaves slack
_SCHEMA = """CREATE TABLE IF NOT EXISTS service_queries (
    id TEXT PRIMARY KEY, client_name TEXT NOT NULL, category TEXT NOT NULL, other_text TEXT, details TEXT,
    status TEXT NOT NULL DEFAULT 'incoming', source TEXT NOT NULL DEFAULT 'typed',
    created_at TEXT NOT NULL, completed_at TEXT, created_by TEXT, owner_id TEXT)"""


class QueryIn(BaseModel):
    client_name: str = Field(min_length=1, max_length=120)
    category: Literal["operational", "recommendation", "other"]
    other_text: str = Field(default="", max_length=200)
    details: str = Field(default="", max_length=2000)
    source: Literal["voice", "typed"] = "typed"

    @model_validator(mode="after")
    def _clean(self):
        self.client_name, self.other_text = self.client_name.strip(), self.other_text.strip()
        if not self.client_name:
            raise ValueError("Client name is required.")
        if self.category == "other" and not self.other_text:
            raise ValueError("Describe the service when the category is Other.")
        if self.category != "other":
            self.other_text = ""
        return self


class StatusIn(BaseModel):
    status: Literal["incoming", "in_progress", "completed"]


def _conn():
    conn = sqlite.get_default_connection()
    conn.execute(_SCHEMA)
    return conn


def _writer(me: dict) -> None:
    if me.get("role") == "compliance":
        raise HTTPException(403, "Compliance accounts are read-only.")


def _working_day_on_or_before(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def report_cycle(today: date) -> dict:
    """Month-end finalize date and send-by dates for the cycle in progress.

    shortcut: weekends only, no exchange-holiday calendar; add one if the 5th-to-7th buffer proves too thin.
    """
    y, m = (today.year, today.month) if today.day <= 7 else ((today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1))
    prev_y, prev_m = (y, m - 1) if m > 1 else (y - 1, 12)
    return {
        "report_month": f"{calendar.month_name[prev_m]} {prev_y}",
        "finalize_by": date(prev_y, prev_m, calendar.monthrange(prev_y, prev_m)[1]).isoformat(),
        "send_by": _working_day_on_or_before(date(y, m, SEND_BY_DAY)).isoformat(),
        "hard_deadline": date(y, m, 7).isoformat(),
        "cycle_start": date(y, m, 1).isoformat(),
        "days_left": (date(y, m, 7) - today).days,
    }


@router.post("/queries", status_code=201)
def create_query(body: QueryIn, me: Me):
    _writer(me)
    row = (uuid.uuid4().hex, body.client_name, body.category, body.other_text, body.details, "incoming", body.source,
           datetime.now(UTC).isoformat(), None, me["id"], me["id"])
    conn = _conn()
    try:
        with conn:
            conn.execute("INSERT INTO service_queries VALUES (?,?,?,?,?,?,?,?,?,?,?)", row)
    finally:
        conn.close()
    return {"id": row[0]}


@router.get("/queries")
def list_queries(me: Me, status: str | None = Query(None), limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    if status and status not in STATUSES:
        raise HTTPException(422, "Unknown status.")
    admin = me.get("_team") is None
    where, args = [], []
    if status:
        where.append("status=?"); args.append(status)
    if not admin:  # an RM sees their own queries and their team's
        ids = list(me.get("_team") or []) + [me["id"]]
        where.append(f"created_by IN ({','.join('?' * len(ids))})"); args += ids
    sql = " WHERE " + " AND ".join(where) if where else ""
    conn = _conn()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM service_queries{sql}", args).fetchone()[0]
        rows = conn.execute(f"SELECT * FROM service_queries{sql} ORDER BY created_at DESC LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
        counts = {r[0]: r[1] for r in conn.execute("SELECT status, COUNT(*) FROM service_queries GROUP BY status")} if admin else {}
    finally:
        conn.close()
    return {"total": total, "rows": [dict(r) for r in rows], "counts": counts}


@router.patch("/queries/{query_id}")
def set_status(query_id: str, body: StatusIn, me: Me):
    _writer(me)
    done = datetime.now(UTC).isoformat() if body.status == "completed" else None
    conn = _conn()
    try:
        with conn:
            cur = conn.execute("UPDATE service_queries SET status=?, completed_at=? WHERE id=?", (body.status, done, query_id))
    finally:
        conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Query not found")
    return {"id": query_id, "status": body.status}


@router.get("/report-tracker")
def report_tracker(me: Me):
    """Reports generated and emailed in the current send cycle, and the ones still unsent."""
    cycle = report_cycle(datetime.now(IST).date())
    start = datetime.fromisoformat(cycle["cycle_start"]).replace(tzinfo=IST).astimezone(UTC).isoformat()
    conn = sqlite.get_default_connection()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS monthly_reports (
            id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, household_id TEXT, report_month TEXT, value_as_on TEXT,
            data TEXT NOT NULL, pdf BLOB NOT NULL, emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)""")
        rows = conn.execute("SELECT customer_id, emailed_at FROM monthly_reports WHERE created_at>=? ORDER BY created_at", (start,)).fetchall()
    finally:
        conn.close()
    sent = {r["customer_id"] for r in rows if r["emailed_at"]}
    unsent = sorted({r["customer_id"] for r in rows} - sent)
    names = get_names(unsent[:50])
    return {**cycle, "generated": len({r["customer_id"] for r in rows}), "emailed": len(sent),
            "unsent": [{"customer_id": c, "name": names.get(c, c)} for c in unsent[:50]]}


def get_names(ids: list[str]) -> dict[str, str]:
    out = {}
    for cid in ids:
        c = sqlite.get_customer_by_id(cid)
        out[cid] = (c or {}).get("name") or cid
    return out
