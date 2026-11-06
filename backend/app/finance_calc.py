from __future__ import annotations
"""Pure maths for "My money": statement import, loan payoff, affordability, goal SIPs, tax view, bill calendar, PDF.

No database and no network here, so every function can be tested with plain numbers.
"""

import csv
import io
import re
from datetime import UTC, date, datetime

from app.engine import finmath

EXPECTED_RETURN = 0.10  # shortcut: one illustrative return for every goal, upgrade to the planner's per-asset assumptions
MAX_CSV_BYTES = 2_000_000
MAX_CSV_ROWS = 20_000
STMT_SUFFIX = " (from statement)"

# keyword -> category; first match wins. Simple on purpose: the customer can delete or re-add what it gets wrong.
CATEGORY_WORDS = {
    "Food": ("swiggy", "zomato", "grocer", "bigbasket", "blinkit", "zepto", "restaurant", "cafe", "dominos", "mcdonald"),
    "Travel": ("uber", "ola ", "irctc", "indigo", "flight", "fuel", "petrol", "diesel", "metro", "fastag", "redbus"),
    "Home": ("rent", "electric", "bescom", "maintenance", "gas ", "water", "broadband", "society"),
    "Shopping": ("amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho"),
    "Health": ("pharm", "hospital", "clinic", "apollo", "diagnostic", "1mg"),
    "Bills": ("recharge", "airtel", "jio", "vodafone", "dth", "tata play", "insurance", "lic "),
    "Entertainment": ("netflix", "spotify", "hotstar", "prime video", "bookmyshow", "youtube"),
}
INCOME_WORDS = ("salary", "payroll", "interest credit", "dividend", "refund")


def category_for(desc: str) -> str:
    d = f" {desc.lower()} "
    return next((c for c, ws in CATEGORY_WORDS.items() if any(w in d for w in ws)), "Other")


def _amount(v: str | None) -> float:
    v = re.sub(r"[^\d.\-]", "", v or "")
    try:
        return float(v) if v not in ("", "-", ".") else 0.0
    except ValueError:
        return 0.0


def _month(v: str) -> str | None:
    v = (v or "").strip()
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%y", "%d/%m/%y", "%d %b %Y", "%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    return None


def parse_statement(text: str) -> dict:
    """Bank statement CSV -> monthly averages. Needs a date column and either debit+credit columns or one signed amount column."""
    if len(text.encode()) > MAX_CSV_BYTES:
        raise ValueError("File is larger than 2 MB. Export a shorter period.")
    lines = text.lstrip("﻿").splitlines()
    # statements often have a few lines of account details above the table: start at the first line that has a date column
    start = next((i for i, ln in enumerate(lines) if "date" in ln.lower() and ln.count(",") >= 2), None)
    if start is None:
        raise ValueError("Could not find a header row with a Date column.")
    rd = csv.DictReader(lines[start:])
    cols = {(k or "").strip().lower(): k for k in (rd.fieldnames or [])}
    pick = lambda *keys: next((cols[c] for c in cols for k in keys if k in c), None)  # noqa: E731
    c_date, c_desc = pick("date"), pick("desc", "narration", "particular", "remark", "detail")
    c_dr, c_cr = pick("debit", "withdraw", "dr"), pick("credit", "deposit", "cr")
    c_amt = pick("amount")
    if not c_date or not c_desc or not ((c_dr and c_cr) or c_amt):
        raise ValueError("Need Date, Description and either Debit and Credit columns or one Amount column.")
    spend: dict[str, float] = {}
    earn: dict[str, float] = {}
    months: set[str] = set()
    skipped = n = 0
    for row in rd:
        n += 1
        if n > MAX_CSV_ROWS:
            raise ValueError(f"More than {MAX_CSV_ROWS} rows. Export a shorter period.")
        m = _month(row.get(c_date) or "")
        if not m:
            skipped += 1
            continue
        if c_dr and c_cr:
            dr, cr = _amount(row.get(c_dr)), _amount(row.get(c_cr))
        else:
            a = _amount(row.get(c_amt))
            dr, cr = (-a, 0.0) if a < 0 else (0.0, a)
        desc = row.get(c_desc) or ""
        months.add(m)
        if dr > 0:
            spend[category_for(desc)] = spend.get(category_for(desc), 0) + dr
        if cr > 0 and any(w in desc.lower() for w in INCOME_WORDS):
            earn["Salary / income"] = earn.get("Salary / income", 0) + cr
    k = max(len(months), 1)
    avg = lambda d: {c: round(v / k) for c, v in d.items() if round(v / k) > 0}  # noqa: E731
    return {"months": len(months), "rows": n - skipped, "skipped": skipped, "expense": avg(spend), "income": avg(earn)}


def payoff(balance: float, apr: float, emi: float, extra: float = 0.0) -> dict | None:
    """Months and total interest to clear a loan paying `emi + extra` a month. None if the payment never covers the interest."""
    r, pay, months, interest = apr / 1200, emi + extra, 0, 0.0
    if balance <= 0 or pay <= 0 or pay <= balance * r:
        return None
    while balance > 0.5 and months < 1200:
        i = balance * r
        balance = balance + i - pay
        interest += i
        months += 1
    return {"months": months, "interest": round(interest)}


def debt_plan(debts: list[dict]) -> list[dict]:
    """Per loan: payoff now and with 10% more each month. Listed highest rate first (the order that saves most interest)."""
    out = []
    for d in sorted(debts, key=lambda d: -d["apr"]):
        base = payoff(d["amount"], d["apr"], d["monthly_payment"])
        boost = payoff(d["amount"], d["apr"], d["monthly_payment"], d["monthly_payment"] * 0.1)
        row = {"label": d["label"], "balance": d["amount"], "apr": d["apr"], "emi": d["monthly_payment"], "payoff": base}
        if base and boost:
            row["extra_10pct"] = {"extra_per_month": round(d["monthly_payment"] * 0.1), "months_saved": base["months"] - boost["months"],
                                  "interest_saved": base["interest"] - boost["interest"]}
        out.append(row)
    return out


def emi_for(principal: float, apr: float, years: float) -> float:
    n, r = round(years * 12), apr / 1200
    if n <= 0:
        raise ValueError("Years must be positive.")
    return principal / n if r == 0 else principal * r * (1 + r) ** n / ((1 + r) ** n - 1)


def afford(income: float, outgo: float, existing_emi: float, new_emi: float) -> dict:
    """Would a new monthly payment fit? Comfortable up to 30% of income in EMIs, stretch up to 40%, beyond that too high."""
    ratio = (existing_emi + new_emi) / income * 100 if income else None
    after = income - outgo - new_emi
    if ratio is None:
        verdict = "Add your income first."
    elif after < 0 or ratio > 40:
        verdict = "too high"
    else:
        verdict = "comfortable" if ratio <= 30 else "stretch"
    return {"new_emi": round(new_emi), "emi_to_income_pct": None if ratio is None else round(ratio, 1), "surplus_after": round(after), "verdict": verdict}


def goal_plan(goals: list[dict]) -> list[dict]:
    """Monthly SIP each goal needs, at an illustrative 10% a year, after crediting what is already saved for it."""
    out = []
    for g in goals:
        yrs, saved = g.get("years"), g.get("saved") or 0
        row = {"label": g["label"], "target": g["amount"], "years": yrs, "saved": saved, "monthly_needed": None}
        if yrs:
            r, n = finmath.monthly_rate(EXPECTED_RETURN), int(yrs * 12)
            row["monthly_needed"] = round(finmath.required_sip(g["amount"], r, n, existing_fv=finmath.fv_lumpsum(saved, EXPECTED_RETURN, yrs)))
        out.append(row)
    return out


def tax_view(age: int, gross_annual: float, ded_80c: float = 0.0) -> dict:
    from app.engine import tax

    c = tax.compare_regimes(tax.TaxInputs(age=age, gross_income=gross_annual, ded_80c=ded_80c))
    return {"better": c["better"], "old_tax": c["old"]["total_tax"], "new_tax": c["new"]["total_tax"], "you_save": c["saving"],
            "extra_80c_room": max(c["old_if_maxed"]["extra_deductions"], 0)}


def bills_ics(bills: list[dict], today: date | None = None) -> str:
    """Monthly repeating calendar events for every bill or EMI that has a due day."""
    today = today or datetime.now(UTC).date()
    esc = lambda s: re.sub(r"([,;\\])", r"\\\1", str(s)).replace("\n", " ")  # noqa: E731
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fund Horizon//My money//EN"]
    for b in bills:
        day = min(b["due_day"], 28)  # shortcut: day 29-31 is moved to 28 so every month has the event; upgrade if exact month-end is needed
        start = date(today.year, today.month, day)
        if start < today:
            start = date(start.year + (start.month == 12), start.month % 12 + 1, day)
        out += ["BEGIN:VEVENT", f"UID:{b['id']}@fundhorizon.website", f"DTSTAMP:{today:%Y%m%d}T000000Z", f"DTSTART;VALUE=DATE:{start:%Y%m%d}",
                "RRULE:FREQ=MONTHLY", f"SUMMARY:{esc(b['label'])} due: Rs {b['amount']}", "END:VEVENT"]
    return "\r\n".join(out + ["END:VCALENDAR", ""])


def report_pdf(sm: dict, prev: dict | None, month: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from app.report import fonts
    from app.report.fmt import xml_escape

    fonts.register()
    body = ParagraphStyle("b", fontName=fonts.BODY_FONT, fontSize=10, leading=14)
    h = ParagraphStyle("h", parent=body, fontName=fonts.BOLD_FONT, fontSize=14, leading=18, spaceBefore=8, spaceAfter=4)
    rs = lambda n: f"Rs {n:,}"  # noqa: E731
    rows = [["Income", rs(sm["monthly_income"])], ["Spending", rs(sm["monthly_expenses"])], ["EMIs", rs(sm["monthly_emi"])],
            ["Left over", rs(sm["monthly_surplus"])], ["Debt outstanding", rs(sm["debt_total"])], ["Interest per year", rs(sm["interest_per_year"])],
            ["Net worth", rs(sm["net_worth"])]]
    if prev:
        rows += [[f"Change in left over since {prev['month']}", rs(sm["monthly_surplus"] - prev["monthly_surplus"])]]
    tbl = lambda data: Table(data, colWidths=[95 * mm, 70 * mm], style=TableStyle([  # noqa: E731
        ("FONT", (0, 0), (-1, -1), fonts.BODY_FONT, 10), ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("LINEBELOW", (0, 0), (-1, -1), 0.25, "#CCCCCC")]))
    flow = [Paragraph(f"My money report, {month}", h), tbl(rows), Paragraph("Where the money goes", h),
            tbl([[c, rs(v)] for c, v in sm["expenses_by_category"].items()] or [["No expenses entered", ""]])]
    if sm["goal_plan"]:
        flow += [Paragraph("Goals", h), tbl([[f"{g['label']} ({g['years'] or '?'} yrs)", rs(g["monthly_needed"]) + " / month" if g["monthly_needed"] is not None else "add years"] for g in sm["goal_plan"]])]
    if sm["flags"]:
        flow += [Paragraph("Watch", h)] + [Paragraph("- " + xml_escape(f), body) for f in sm["flags"]]
    flow += [Spacer(1, 8 * mm), Paragraph("Based only on numbers you entered. Goal SIPs assume an illustrative 10% a year. Education only.", body)]
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, title=f"My money {month}", author="Fund Horizon").build(flow)
    return buf.getvalue()

