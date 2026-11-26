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
STATUSES = ("incoming", "in_progress", "waiting_client", "completed", "cancelled")
PRIORITIES = ("urgent", "high", "medium", "low")
SEND_BY_DAY = 5  # reports are due before the 7th; aim for the 5th so a holiday or weekend still leaves slack
_SCHEMA = """CREATE TABLE IF NOT EXISTS service_queries (
    id TEXT PRIMARY KEY, client_name TEXT NOT NULL, category TEXT NOT NULL, other_text TEXT, details TEXT,
    status TEXT NOT NULL DEFAULT 'incoming', source TEXT NOT NULL DEFAULT 'typed',
    created_at TEXT NOT NULL, completed_at TEXT, created_by TEXT, owner_id TEXT,
    priority TEXT NOT NULL DEFAULT 'medium', resolution_note TEXT, updated_at TEXT)"""


class QueryIn(BaseModel):
    client_name: str = Field(min_length=1, max_length=120)
    category: Literal["operational", "recommendation", "other"]
    other_text: str = Field(default="", max_length=200)
    details: str = Field(default="", max_length=2000)
    priority: Literal["urgent", "high", "medium", "low"] = "medium"
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
    status: Literal["incoming", "in_progress", "waiting_client", "completed", "cancelled"]
    resolution_note: str | None = Field(default=None, max_length=2000)


class QueryUpdateIn(BaseModel):
    client_name: str | None = Field(default=None, min_length=1, max_length=120)
    category: Literal["operational", "recommendation", "other"] | None = None
    other_text: str | None = Field(default="", max_length=200)
    details: str | None = Field(default=None, max_length=2000)
    priority: Literal["urgent", "high", "medium", "low"] | None = None
    status: Literal["incoming", "in_progress", "waiting_client", "completed", "cancelled"] | None = None
    resolution_note: str | None = Field(default=None, max_length=2000)


def _conn():
    conn = sqlite.get_default_connection()
    conn.execute(_SCHEMA)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(service_queries)").fetchall()}
    if "priority" not in cols:
        conn.execute("ALTER TABLE service_queries ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'")
    if "resolution_note" not in cols:
        conn.execute("ALTER TABLE service_queries ADD COLUMN resolution_note TEXT")
    if "updated_at" not in cols:
        conn.execute("ALTER TABLE service_queries ADD COLUMN updated_at TEXT")
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
    now_iso = datetime.now(UTC).isoformat()
    qid = uuid.uuid4().hex
    ticket_code = f"SR-{qid[:6].upper()}"
    conn = _conn()
    try:
        with conn:
            conn.execute(
                """INSERT INTO service_queries
                   (id, client_name, category, other_text, details, status, source, created_at, completed_at, created_by, owner_id, priority, resolution_note, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (qid, body.client_name, body.category, body.other_text, body.details, "incoming", body.source,
                 now_iso, None, me["id"], me["id"], body.priority, None, now_iso),
            )
    finally:
        conn.close()
    return {"id": qid, "ticket_code": ticket_code}


@router.get("/queries")
def list_queries(
    me: Me,
    status: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    priority: str | None = Query(None),
    category: str | None = Query(None),
    q: str | None = Query(None),
):
    # Support both FastAPI dependency injection and direct unit test calls
    st = None if (status is None or hasattr(status, "default")) else status
    pr = None if (priority is None or hasattr(priority, "default")) else priority
    cat = None if (category is None or hasattr(category, "default")) else category
    query_text = None if (q is None or hasattr(q, "default")) else q
    lim = 100 if (limit is None or hasattr(limit, "default")) else limit
    off = 0 if (offset is None or hasattr(offset, "default")) else offset

    if st and st not in STATUSES:
        raise HTTPException(422, "Unknown status.")
    if pr and pr not in PRIORITIES:
        raise HTTPException(422, "Unknown priority.")
    if cat and cat not in CATEGORIES:
        raise HTTPException(422, "Unknown category.")

    admin = me.get("_team") is None
    where, args = [], []
    if st:
        where.append("status=?"); args.append(st)
    if pr:
        where.append("priority=?"); args.append(pr)
    if cat:
        where.append("category=?"); args.append(cat)
    if query_text and query_text.strip():
        search = f"%{query_text.strip().lower()}%"
        clean_q = query_text.strip().upper().replace("SR-", "").lower()
        where.append("(LOWER(client_name) LIKE ? OR LOWER(details) LIKE ? OR LOWER(other_text) LIKE ? OR LOWER(id) LIKE ?)")
        args.extend([search, search, search, f"%{clean_q}%"])

    if not admin:  # an RM sees their own queries and their team's
        ids = list(me.get("_team") or []) + [me["id"]]
        where.append(f"created_by IN ({','.join('?' * len(ids))})"); args += ids

    sql = " WHERE " + " AND ".join(where) if where else ""
    conn = _conn()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM service_queries{sql}", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM service_queries{sql} ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC LIMIT ? OFFSET ?",
            [*args, lim, off],
        ).fetchall()
        
        counts = {s: 0 for s in STATUSES}
        for r in conn.execute("SELECT status, COUNT(*) FROM service_queries GROUP BY status"):
            if r[0] in counts:
                counts[r[0]] = r[1]
                
        urgent_row = conn.execute("SELECT COUNT(*) FROM service_queries WHERE priority='urgent' AND status NOT IN ('completed', 'cancelled')").fetchone()
        urgent_count = urgent_row[0] if urgent_row else 0
        active_count = sum(counts.get(s, 0) for s in ("incoming", "in_progress", "waiting_client"))
    finally:
        conn.close()

    result_rows = []
    for r in rows:
        d = dict(r)
        d["ticket_code"] = f"SR-{d['id'][:6].upper()}"
        d["priority"] = d.get("priority") or "medium"
        d["resolution_note"] = d.get("resolution_note") or ""
        result_rows.append(d)

    return {
        "total": total,
        "rows": result_rows,
        "counts": counts,
        "urgent_count": urgent_count,
        "active_count": active_count,
    }


@router.patch("/queries/{query_id}")
def set_status(query_id: str, body: StatusIn, me: Me):
    _writer(me)
    now_iso = datetime.now(UTC).isoformat()
    done = now_iso if body.status == "completed" else None
    conn = _conn()
    try:
        with conn:
            if body.resolution_note is not None:
                cur = conn.execute(
                    "UPDATE service_queries SET status=?, completed_at=?, resolution_note=?, updated_at=? WHERE id=?",
                    (body.status, done, body.resolution_note.strip(), now_iso, query_id),
                )
            else:
                cur = conn.execute(
                    "UPDATE service_queries SET status=?, completed_at=?, updated_at=? WHERE id=?",
                    (body.status, done, now_iso, query_id),
                )
    finally:
        conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Query not found")
    return {"id": query_id, "status": body.status, "ticket_code": f"SR-{query_id[:6].upper()}"}


@router.put("/queries/{query_id}")
def update_query(query_id: str, body: QueryUpdateIn, me: Me):
    _writer(me)
    now_iso = datetime.now(UTC).isoformat()
    conn = _conn()
    try:
        with conn:
            existing = conn.execute("SELECT * FROM service_queries WHERE id=?", (query_id,)).fetchone()
            if not existing:
                raise HTTPException(404, "Query not found")
            ex = dict(existing)

            client_name = body.client_name.strip() if body.client_name is not None else ex["client_name"]
            category = body.category if body.category is not None else ex["category"]
            other_text = body.other_text.strip() if body.other_text is not None else (ex.get("other_text") or "")
            details = body.details.strip() if body.details is not None else (ex.get("details") or "")
            priority = body.priority if body.priority is not None else (ex.get("priority") or "medium")
            status = body.status if body.status is not None else ex["status"]
            resolution_note = body.resolution_note.strip() if body.resolution_note is not None else (ex.get("resolution_note") or "")

            if category == "other" and not other_text:
                raise HTTPException(422, "Describe the service when the category is Other.")
            if category != "other":
                other_text = ""

            completed_at = now_iso if status == "completed" else (None if ex["status"] == "completed" else ex.get("completed_at"))

            conn.execute(
                """UPDATE service_queries SET
                   client_name=?, category=?, other_text=?, details=?, priority=?, status=?,
                   resolution_note=?, completed_at=?, updated_at=? WHERE id=?""",
                (client_name, category, other_text, details, priority, status, resolution_note, completed_at, now_iso, query_id),
            )
    finally:
        conn.close()
    return {"id": query_id, "ticket_code": f"SR-{query_id[:6].upper()}", "updated": True}


@router.delete("/queries/{query_id}")
def delete_query(query_id: str, me: Me):
    _writer(me)
    admin = me.get("_team") is None
    conn = _conn()
    try:
        with conn:
            if admin:
                cur = conn.execute("DELETE FROM service_queries WHERE id=?", (query_id,))
            else:
                cur = conn.execute("DELETE FROM service_queries WHERE id=? AND created_by=?", (query_id, me["id"]))
    finally:
        conn.close()
    if not cur.rowcount:
        raise HTTPException(404, "Query not found or not permitted to delete.")
    return {"id": query_id, "ticket_code": f"SR-{query_id[:6].upper()}", "deleted": True}


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
