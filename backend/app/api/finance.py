from __future__ import annotations
"""Personal finance, in-house: the customer types in income, expenses, debts and savings (no bank link, no third party).

The numbers come from `summarize` (plain arithmetic). The AI only explains them: its answer is dropped for the
deterministic one if it quotes a number we did not compute or uses banned compliance wording.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
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
from app import finance_calc as fc
from app.api.customer_portal import _post as post_chat
from app.api.customer_portal import staff_only
from app.db import get_repository

router = APIRouter(tags=["finance"])

Kind = Literal["income", "expense", "debt", "saving", "goal", "budget", "insurance"]
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
    years: int | None = Field(default=None, ge=1, le=60, description="Goal: years left to reach it")
    saved: int = Field(default=0, ge=0, le=10**10, description="Goal: already set aside for it")


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class ImportIn(BaseModel):
    csv: str = Field(min_length=10, max_length=3_000_000)


class AffordIn(BaseModel):
    loan_amount: int = Field(default=0, ge=0, le=10**10)
    apr: float = Field(default=0, ge=0, le=100)
    years: float = Field(default=1, gt=0, le=40)
    emi: int = Field(default=0, ge=0, le=10**9, description="Use instead of loan_amount when you already know the payment")


class TaxIn(BaseModel):
    age: int = Field(default=35, ge=18, le=100)
    gross_annual: int | None = Field(default=None, ge=0, le=10**10, description="Yearly gross income; default is 12 x your monthly income entry")
    ded_80c: int = Field(default=0, ge=0, le=10**7)


def _rows(customer_id: str) -> list[dict]:
    return get_repository()._all(
        "SELECT id, kind, label, amount, category, monthly_payment, apr, due_day, liquid, years, saved FROM fin_entries "
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
        q.append("What are you saving for (home, education, retirement)? Add the target amount and years left.")
    if "insurance" not in kinds:
        q.append("Do you have life and health insurance? Add the cover amount (sum assured) for each.")
    return q


def summarize(rows: list[dict], today: datetime | None = None, portfolio: dict | None = None) -> dict:
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
    budgets = [{"category": r["category"] or r["label"], "limit": r["amount"], "spent": by_cat.get(r["category"] or r["label"], 0)} for r in s("budget")]
    for b in budgets:
        b["pct"] = round(b["spent"] / b["limit"] * 100)
        if b["pct"] >= 80:
            flags.append(f"{b['category']} spending is {b['pct']}% of its limit of Rs {b['limit']}.")
    cover = lambda cat: sum(r["amount"] for r in s("insurance") if (r["category"] or "").lower() == cat)  # noqa: E731
    if s("insurance"):
        if income and cover("life") < income * 12 * 10:
            flags.append("Life cover is under 10 times your yearly income.")
        if cover("health") < 500000:
            flags.append("Health cover is under Rs 500000.")
    pf = portfolio or {"invested": 0, "sip_monthly": 0}
    goal_plan = fc.goal_plan(s("goal"))
    sip_needed = sum(g["monthly_needed"] or 0 for g in goal_plan)
    if sip_needed > max(surplus, 0):
        flags.append(f"Your goals need Rs {sip_needed} a month but only Rs {max(surplus, 0)} is left over.")
    return {
        "monthly_income": income, "monthly_expenses": spend, "monthly_emi": emi, "monthly_surplus": surplus,
        "savings_rate_pct": round(surplus / income * 100, 1) if income else None,
        "emi_to_income_pct": round(emi / income * 100, 1) if income else None,
        "expenses_by_category": dict(sorted(by_cat.items(), key=lambda x: -x[1])),
        "debt_total": debt_total, "interest_per_year": interest_year,
        "emergency_fund": liquid, "emergency_months": round(liquid / outgo, 1) if outgo else None,
        "goals": [{"label": r["label"], "target": r["amount"]} for r in s("goal")],
        "goal_plan": goal_plan, "goals_monthly_sip_needed": sip_needed, "debt_plan": fc.debt_plan([r for r in s("debt") if r["monthly_payment"]]),
        "budgets": budgets, "insurance": {"life": cover("life"), "health": cover("health")},
        "portfolio_invested": pf["invested"], "portfolio_sip_monthly": pf["sip_monthly"],
        "net_worth": sum(r["amount"] for r in s("saving")) + pf["invested"] - debt_total,
        "upcoming_payments": upcoming[:8], "flags": flags, "missing": missing_info(rows),
    }


def _fallback(sm: dict) -> str:
    lines = [f"Income Rs {sm['monthly_income']}, spending Rs {sm['monthly_expenses']}, EMIs Rs {sm['monthly_emi']}, left over Rs {sm['monthly_surplus']} a month."]
    lines += sm["flags"] + [f"To answer better: {m}" for m in sm["missing"][:3]]
    return "\n".join(lines)


SYSTEM = (
    "You are the money-coach in Fund Horizon's customer account. Answer the customer's question using ONLY the JSON facts "
    "given. Quote only numbers present in the facts; if a figure is not there, say it is not available. If facts needed for "
    "the answer are in `missing`, ask for them first. Be short, plain and in Indian rupees. Do not name specific "
    "securities or promise returns; this is education only."
)


def answer(question: str, sm: dict) -> dict:
    facts = scrub_pii({"facts": sm})
    out, provider = call_llm(f"{json.dumps(facts, default=str)}\n\nQuestion: {question}", SYSTEM)
    if out and verify_number_consistency(out, extract_numbers_from_payload(facts)) and scan_banned_wording(out):
        return {"answer": append_statutory_disclosures(out), "ai_generated": True, "provider": provider}
    return {"answer": append_statutory_disclosures(_fallback(sm)), "ai_generated": False, "provider": "deterministic_template"}


# ---------------------------------------------------------------- customer
def _portfolio(customer_id: str) -> dict:
    """What the customer already holds with us (cost, not market value) and their running SIPs."""
    repo = get_repository()
    own = "(SELECT id FROM contacts WHERE customer_id = ?)"
    one = lambda sql: (repo._first(sql, (customer_id,)) or {}).get("v") or 0  # noqa: E731  (_first gives None if the table is absent)
    cost = one(f"SELECT SUM(cost_paise) AS v FROM holdings WHERE contact_id IN {own}")
    sip = one(f"SELECT SUM(amount_paise) AS v FROM sip_schedules WHERE status = 'active' AND contact_id IN {own}")
    return {"invested": round(cost / 100), "sip_monthly": round(sip / 100)}


def _full(customer_id: str) -> tuple[list[dict], dict]:
    rows = _rows(customer_id)
    return rows, summarize(rows, portfolio=_portfolio(customer_id))


def _snapshot(customer_id: str, sm: dict) -> dict | None:
    """Keep this month's headline numbers (once a month is enough) and return last month's for comparison."""
    repo, month = get_repository(), datetime.now(UTC).strftime("%Y-%m")
    keep = {k: sm[k] for k in ("monthly_income", "monthly_expenses", "monthly_emi", "monthly_surplus", "debt_total", "net_worth")}
    repo._run("INSERT OR REPLACE INTO fin_snapshots (customer_id, month, data) VALUES (?, ?, ?)", (customer_id, month, json.dumps(keep)))
    prev = repo._first("SELECT month, data FROM fin_snapshots WHERE customer_id = ? AND month < ? ORDER BY month DESC LIMIT 1", (customer_id, month))
    return {"month": prev["month"], **json.loads(prev["data"])} if prev else None


def _changes(sm: dict, prev: dict | None) -> dict | None:
    return None if not prev else {"since": prev["month"], **{k: sm[k] - prev[k] for k in ("monthly_expenses", "monthly_surplus", "debt_total", "net_worth")}}


@router.get("/api/me/finance")
def my_finance(me: Annotated[dict, Depends(get_current_customer)]):
    rows, sm = _full(me["id"])
    return {"entries": rows, "summary": sm, "changes": _changes(sm, _snapshot(me["id"], sm))}


def _insert(repo, customer_id: str, e: EntryIn) -> str:
    eid = uuid.uuid4().hex
    repo._run(
        "INSERT INTO fin_entries (id, customer_id, kind, label, amount, category, monthly_payment, apr, due_day, liquid, years, saved, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (eid, customer_id, e.kind, e.label.strip(), e.amount, e.category.strip(), e.monthly_payment, e.apr, e.due_day, int(e.liquid),
         e.years, e.saved, datetime.now(UTC).isoformat()))
    return eid


@router.post("/api/me/finance", status_code=201)
def add_entry(body: EntryIn, me: Annotated[dict, Depends(get_current_customer)]):
    if len(_rows(me["id"])) >= MAX_ENTRIES:
        raise HTTPException(400, f"Limit of {MAX_ENTRIES} entries reached. Remove some first.")
    return {"id": _insert(get_repository(), me["id"], body)}


@router.delete("/api/me/finance/{entry_id}")
def delete_entry(entry_id: str, me: Annotated[dict, Depends(get_current_customer)]):
    get_repository()._run("DELETE FROM fin_entries WHERE id = ? AND customer_id = ?", (entry_id, me["id"]))
    return {"ok": True}


@router.post("/api/me/finance/import")
def import_statement(body: ImportIn, me: Annotated[dict, Depends(get_current_customer)]):
    """Bank statement CSV -> one monthly-average expense per category and one income line. Replaces the previous import."""
    try:
        got = fc.parse_statement(body.csv)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    repo = get_repository()
    repo._run("DELETE FROM fin_entries WHERE customer_id = ? AND label LIKE ?", (me["id"], "%" + fc.STMT_SUFFIX))
    new = [EntryIn(kind="expense", label=c + fc.STMT_SUFFIX, amount=v, category=c) for c, v in got["expense"].items()]
    new += [EntryIn(kind="income", label=c + fc.STMT_SUFFIX, amount=v) for c, v in got["income"].items()]
    if len(_rows(me["id"])) + len(new) > MAX_ENTRIES:
        raise HTTPException(400, "Not enough room for the imported lines. Remove some entries first.")
    for e in new:
        _insert(repo, me["id"], e)
    return {"added": len(new), "months": got["months"], "rows": got["rows"], "skipped": got["skipped"]}


@router.post("/api/me/finance/ask")
def ask(body: AskIn, me: Annotated[dict, Depends(get_current_customer)]):
    return answer(body.question.strip(), _full(me["id"])[1])


@router.post("/api/me/finance/afford")
def check_afford(body: AffordIn, me: Annotated[dict, Depends(get_current_customer)]):
    sm = _full(me["id"])[1]
    emi = body.emi
    if not emi:
        if not body.loan_amount:
            raise HTTPException(422, "Give a loan amount or an EMI.")
        emi = fc.emi_for(body.loan_amount, body.apr, body.years)
    return fc.afford(sm["monthly_income"], sm["monthly_expenses"] + sm["monthly_emi"], sm["monthly_emi"], emi)


@router.post("/api/me/finance/tax")
def tax_view(body: TaxIn, me: Annotated[dict, Depends(get_current_customer)]):
    income = _full(me["id"])[1]["monthly_income"] * 12
    gross = body.gross_annual if body.gross_annual is not None else income
    if not gross:
        raise HTTPException(422, "Add your income first, or give your yearly gross income.")
    return {**fc.tax_view(body.age, gross, body.ded_80c), "gross_annual": gross}


@router.post("/api/me/finance/bills.ics")
def bills_calendar(me: Annotated[dict, Depends(get_current_customer)]):
    bills = [{"id": r["id"], "label": r["label"], "due_day": r["due_day"], "amount": r["monthly_payment"] or r["amount"]}
             for r in _rows(me["id"]) if r["kind"] in ("expense", "debt") and r["due_day"]]
    if not bills:
        raise HTTPException(400, "Add a due day to a bill or loan first.")
    return Response(fc.bills_ics(bills), media_type="text/calendar", headers={"Content-Disposition": 'attachment; filename="my-bills.ics"'})


@router.post("/api/me/finance/report.pdf")
def report(me: Annotated[dict, Depends(get_current_customer)]):
    sm = _full(me["id"])[1]
    prev = _snapshot(me["id"], sm)
    month = datetime.now(UTC).strftime("%B %Y")
    return Response(fc.report_pdf(sm, prev, month), media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="my-money.pdf"'})


@router.post("/api/me/finance/share", status_code=201)
def share_with_advisor(me: Annotated[dict, Depends(get_current_customer)]):
    """Send a short summary to the Fund Horizon team through the existing chat."""
    sm = _full(me["id"])[1]
    text = (f"My money summary: income Rs {sm['monthly_income']}, spending Rs {sm['monthly_expenses']}, EMIs Rs {sm['monthly_emi']}, "
            f"left over Rs {sm['monthly_surplus']} a month, debt Rs {sm['debt_total']}, emergency fund {sm['emergency_months']} months. "
            + " ".join(sm["flags"]))[:1900]
    return post_chat(me["id"], me["id"], 0, text)


# ---------------------------------------------------------------- staff (also what the MCP tool calls)
@router.get("/api/staff/finance/{customer_id}")
def staff_finance(customer_id: str, _: Annotated[dict, Depends(staff_only)]):
    if not get_repository()._first("SELECT 1 FROM customers WHERE id = ?", (customer_id,)):
        raise HTTPException(404, "Customer not found")
    rows, sm = _full(customer_id)
    return {"entries": rows, "summary": sm}
