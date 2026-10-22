from __future__ import annotations
"""Customer self-service: read-only view of their own CRM records, and chat with the staff team.

A customer only ever sees rows tied to their own account. Chat is one thread per customer, shared by all staff.
"""

import sqlite3
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.api.auth import GUEST_EMAIL, get_current_customer, require_staff
from app.db.sqlite import get_default_connection

router = APIRouter(tags=["customer-portal"])


def staff_only(staff: Annotated[dict, Depends(require_staff)]) -> dict:
    """Staff chat holds private customer conversations, so the read-only guest is excluded."""
    if staff.get("email") == GUEST_EMAIL:
        raise HTTPException(403, "Not available to guest access.")
    return staff

_DDL = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    from_staff INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_chat_customer ON chat_messages (customer_id, created_at);
"""


def _conn():
    conn = get_default_connection()
    conn.executescript(_DDL)
    return conn


def _rows(conn, sql: str, params: tuple = ()) -> list[dict]:
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    except sqlite3.OperationalError:  # CRM tables are created lazily; a fresh database has none yet
        return []


class MessageIn(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        v = (v or "").strip()
        if not v or len(v) > 2000:
            raise ValueError("message must be 1 to 2000 characters")
        return v


@router.get("/api/me/crm")
def my_crm(me: Annotated[dict, Depends(get_current_customer)]):
    conn = _conn()
    try:
        uid = me["id"]
        households = _rows(
            conn,
            "SELECT h.id, h.name, h.notes, rm.name AS rm_name FROM households h "
            "JOIN household_members m ON m.household_id = h.id LEFT JOIN customers rm ON rm.id = h.rm_id "
            "WHERE m.customer_id = ?",
            (uid,),
        )
        holdings = _rows(
            conn,
            "SELECT scheme_name, folio, units, cost_paise, as_of FROM holdings WHERE contact_id IN "
            "(SELECT id FROM contacts WHERE customer_id = ?)",
            (uid,),
        )
        sips = _rows(
            conn,
            "SELECT scheme_name, type, amount_paise, day, status FROM sip_schedules WHERE contact_id IN "
            "(SELECT id FROM contacts WHERE customer_id = ?)",
            (uid,),
        )
        cases = _rows(conn, "SELECT subject, category, status, created_at FROM cases WHERE customer_id = ?", (uid,))
        return {"households": households, "holdings": holdings, "sips": sips, "cases": cases}
    finally:
        conn.close()


@router.get("/api/me/messages")
def my_messages(me: Annotated[dict, Depends(get_current_customer)]):
    conn = _conn()
    try:
        with conn:
            conn.execute(
                "UPDATE chat_messages SET read_at = ? WHERE customer_id = ? AND from_staff = 1 AND read_at IS NULL",
                (datetime.now(UTC).isoformat(), me["id"]),
            )
        return {"messages": _rows(conn, "SELECT id, from_staff, body, created_at FROM chat_messages "
                                  "WHERE customer_id = ? ORDER BY created_at", (me["id"],))}
    finally:
        conn.close()


def _post(customer_id: str, sender_id: str, from_staff: int, body: str) -> dict:
    conn = _conn()
    try:
        row = {"id": uuid.uuid4().hex, "customer_id": customer_id, "sender_id": sender_id,
               "from_staff": from_staff, "body": body, "created_at": datetime.now(UTC).isoformat()}
        with conn:
            conn.execute(
                "INSERT INTO chat_messages (id, customer_id, sender_id, from_staff, body, created_at) "
                "VALUES (:id, :customer_id, :sender_id, :from_staff, :body, :created_at)", row)
        return {"id": row["id"], "from_staff": from_staff, "body": body, "created_at": row["created_at"]}
    finally:
        conn.close()


@router.post("/api/me/messages", status_code=201)
def send_my_message(body: MessageIn, me: Annotated[dict, Depends(get_current_customer)]):
    return _post(me["id"], me["id"], 0, body.body)


@router.get("/api/staff/chats")
def staff_chats(_: Annotated[dict, Depends(staff_only)]):
    conn = _conn()
    try:
        return {"threads": _rows(
            conn,
            "SELECT m.customer_id, c.name, c.email, MAX(m.created_at) AS last_at, "
            "SUM(CASE WHEN m.from_staff = 0 AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unread, "
            "(SELECT body FROM chat_messages x WHERE x.customer_id = m.customer_id ORDER BY x.created_at DESC LIMIT 1) AS last_body "
            "FROM chat_messages m JOIN customers c ON c.id = m.customer_id GROUP BY m.customer_id ORDER BY last_at DESC")}
    finally:
        conn.close()


@router.get("/api/staff/chats/{customer_id}")
def staff_thread(customer_id: str, _: Annotated[dict, Depends(staff_only)]):
    conn = _conn()
    try:
        with conn:
            conn.execute(
                "UPDATE chat_messages SET read_at = ? WHERE customer_id = ? AND from_staff = 0 AND read_at IS NULL",
                (datetime.now(UTC).isoformat(), customer_id),
            )
        return {"messages": _rows(conn, "SELECT id, from_staff, body, created_at FROM chat_messages "
                                  "WHERE customer_id = ? ORDER BY created_at", (customer_id,))}
    finally:
        conn.close()


@router.post("/api/staff/chats/{customer_id}", status_code=201)
def staff_reply(customer_id: str, body: MessageIn, staff: Annotated[dict, Depends(staff_only)]):
    conn = _conn()
    try:
        if not conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone():
            raise HTTPException(404, "Customer not found")
    finally:
        conn.close()
    return _post(customer_id, staff["id"], 1, body.body)
