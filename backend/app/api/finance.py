from __future__ import annotations
"""Personal finance, in-house: the customer types in income, expenses, debts and savings (no bank link, no third party).

The numbers come from `summarize` (plain arithmetic). The AI only explains them: its answer is dropped for the
deterministic one if it quotes a number we did not compute or uses banned compliance wording.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.client import call_llm
from app.ai.guardrails import (
    append_statutory_disclosures,
    extract_numbers_from_payload,
    scan_banned_wording,
    scrub_pii,
    verify_number_consistency,
)
from app.api.auth import get_current_customer
from app.api.customer_portal import staff_only
from app.db import get_repository

router = APIRouter(tags=["finance"])

Kind = Literal["income", "expense", "debt", "saving", "goal"]
MAX_ENTRIES = 100  # also the table size, so no paging is needed


class EntryIn(BaseModel):
    kind: Kind
    label: str = Field(min_length=1, max_length=80)
    amount: int = Field(gt=0, le=10**10, description="Rupees per month; for debt = outstanding balance; for saving/goal = total")
    category: str = Field(default="", max_length=40)
    monthly_payment: int = Field(default=0, ge=0, le=10**9, description="Debt EMI / minimum due per month")
    apr: float = Field(default=0, ge=0, le=100, description="Debt interest rate, % a year")
    due_day: int | None = Field(default=None, ge=1, le=31, description="Day of month a bill or EMI is due")
    liquid: bool = Field(default=False, description="Saving is cash-like (savings account, liquid fund)")


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


def _rows(customer_id: str) -> list[dict]:
    return get_repository()._all(
        "SELECT id, kind, label, amount, category, monthly_payment, apr, due_day, liquid FROM fin_entries "
        "WHERE customer_id = ? ORDER BY created_at", (customer_id,))


def missing_info(rows: list[dict]) -> list[str]:
    """Questions to ask the customer about what is still unknown, most important first."""
    kinds = {r["kind"] for r in rows}
    q = []
    if "income" not in kinds:
        q.append("What is your monthly take-home income (salary, business, rent, other)?")
    if "expense" not in kinds:
        q.append("What do you spend each month? Add rent, groceries, bills, travel, eating out, school fees.")
    if "debt" not in kinds:
        q.append("Do you have any loans or credit card dues? Add balance, EMI and interest rate (or add none if debt-free).")
    if not any(r["kind"] == "saving" and r["liquid"] for r in rows):
        q.append("How much do you hold as an emergency fund in cash or a savings account?")
    if "goal" not in kinds:
        q.append("What are you saving for (home, education, retirement)? Add the target amount.")
    return q


def summarize(rows: list[dict], today: datetime | None = None) -> dict:
    """All figures the UI, the AI and MCP use. Rupees and percentages; nothing here is an estimate beyond simple interest."""
    today = today or datetime.now(UTC)
    s = lambda k: [r for r in rows if r["kind"] == k]  # noqa: E731
    income = sum(r["amount"] for r in s("income"))
    spend = sum(r["amount"] for r in s("expense"))
    emi = sum(r["monthly_payment"] for r in s("debt"))
    by_cat: dict[str, int] = {}
    for r in s("expense"):
        c = r["category"] or "Other"
        by_cat[c] = by_cat.get(c, 0) + r["amount"]
    debt_total = sum(r["amount"] for r in s("debt"))
    # shortcut: simple annual interest on the outstanding balance, not an amortisation schedule; upgrade if users want payoff dates
    interest_year = round(sum(r["amount"] * r["apr"] / 100 for r in s("debt")))
    liquid = sum(r["amount"] for r in s("saving") if r["liquid"])
    outgo = spend + emi
    surplus = income - outgo
    dom = today.day
    upcoming = sorted(
        ({"label": r["label"], "amount": r["monthly_payment"] or r["amount"], "in_days": (r["due_day"] - dom) % 31}
         for r in s("expense") + s("debt") if r["due_day"]),
        key=lambda x: x["in_days"])
    flags = []
    if income and surplus < 0:
        flags.append("Spending plus EMIs is more than income.")
    if income and emi / income > 0.4:
        flags.append("EMIs take more than 40% of income.")
    if any(r["apr"] >= 18 for r in s("debt")):
        flags.append("A debt costs 18% a year or more; paying it down usually beats most investments.")
    if outgo and liquid / outgo < 3 and income:
        flags.append("Emergency fund covers under 3 months of outgo.")
    return {
        "monthly_income": income, "monthly_expenses": spend, "monthly_emi": emi, "monthly_surplus": surplus,
        "savings_rate_pct": round(surplus / income * 100, 1) if income else None,
        "emi_to_income_pct": round(emi / income * 100, 1) if income else None,
        "expenses_by_category": dict(sorted(by_cat.items(), key=lambda x: -x[1])),
        "debt_total": debt_total, "interest_per_year": interest_year,
        "emergency_fund": liquid, "emergency_months": round(liquid / outgo, 1) if outgo else None,
        "goals": [{"label": r["label"], "target": r["amount"]} for r in s("goal")],
        "upcoming_payments": upcoming[:8], "flags": flags, "missing": missing_info(rows),
    }


def _fallback(sm: dict) -> str:
    lines = [f"Income Rs {sm['monthly_income']}, spending Rs {sm['monthly_expenses']}, EMIs Rs {sm['monthly_emi']}, left over Rs {sm['monthly_surplus']} a month."]
    lines += sm["flags"] + [f"To answer better: {m}" for m in sm["missing"][:3]]
    return "\n".join(lines)


SYSTEM = (
    "You are the money-coach in Fund Horizon's customer account. Answer the customer's question using ONLY the JSON facts "
    "given. Quote only numbers present in the facts; if a figure is not there, say it is not available. If facts needed for "
    "the answer are in `missing`, ask for them first. Be short, plain and in Indian rupees. Do not recommend specific "
    "securities or promise returns; this is education, not investment advice."
)


def answer(question: str, sm: dict) -> dict:
    facts = scrub_pii({"facts": sm})
    out, provider = call_llm(f"{json.dumps(facts, default=str)}\n\nQuestion: {question}", SYSTEM)
    if out and verify_number_consistency(out, extract_numbers_from_payload(facts)) and scan_banned_wording(out):
        return {"answer": append_statutory_disclosures(out), "ai_generated": True, "provider": provider}
    return {"answer": append_statutory_disclosures(_fallback(sm)), "ai_generated": False, "provider": "deterministic_template"}


# ---------------------------------------------------------------- customer
@router.get("/api/me/finance")
def my_finance(me: Annotated[dict, Depends(get_current_customer)]):
    rows = _rows(me["id"])
    return {"entries": rows, "summary": summarize(rows)}


@router.post("/api/me/finance", status_code=201)
def add_entry(body: EntryIn, me: Annotated[dict, Depends(get_current_customer)]):
    repo = get_repository()
    if len(_rows(me["id"])) >= MAX_ENTRIES:
        raise HTTPException(400, f"Limit of {MAX_ENTRIES} entries reached. Remove some first.")
    eid = uuid.uuid4().hex
    repo._run(
        "INSERT INTO fin_entries (id, customer_id, kind, label, amount, category, monthly_payment, apr, due_day, liquid, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (eid, me["id"], body.kind, body.label.strip(), body.amount, body.category.strip(), body.monthly_payment, body.apr,
         body.due_day, int(body.liquid), datetime.now(UTC).isoformat()))
    return {"id": eid}


@router.delete("/api/me/finance/{entry_id}")
def delete_entry(entry_id: str, me: Annotated[dict, Depends(get_current_customer)]):
    get_repository()._run("DELETE FROM fin_entries WHERE id = ? AND customer_id = ?", (entry_id, me["id"]))
    return {"ok": True}


@router.post("/api/me/finance/ask")
def ask(body: AskIn, me: Annotated[dict, Depends(get_current_customer)]):
    return answer(body.question.strip(), summarize(_rows(me["id"])))


# ---------------------------------------------------------------- staff (also what the MCP tool calls)
@router.get("/api/staff/finance/{customer_id}")
def staff_finance(customer_id: str, _: Annotated[dict, Depends(staff_only)]):
    repo = get_repository()
    if not repo._first("SELECT 1 FROM customers WHERE id = ?", (customer_id,)):
        raise HTTPException(404, "Customer not found")
    rows = _rows(customer_id)
    return {"entries": rows, "summary": summarize(rows)}
