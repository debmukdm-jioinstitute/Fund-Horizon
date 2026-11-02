from __future__ import annotations
"""FastAPI router for Fund Horizon HRMS (Human Resource Management System).
Handles employee directory, automated letter generation, Indian payroll runs,
payslips dispatch, and attendance/leave management.
"""

import json
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.api.auth import require_staff
from app.hrms_db import (
    calculate_salary_breakdown,
    get_db,
    init_hrms_tables,
)
from app.report.hrms_docs import (
    render_hrms_letter_pdf,
    render_payslip_pdf,
)

router = APIRouter(prefix="/api/hrms", tags=["hrms"])


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# -------------------------------------------------------------------------
# Pydantic Request Models
# -------------------------------------------------------------------------

class EmployeeCreate(BaseModel):
    emp_code: str
    name: str
    email: str
    phone: str = ""
    designation: str
    department: str
    joining_date: str
    status: str = "active"
    manager_name: str = ""
    pan: str = ""
    uan: str = ""
    bank_name: str = ""
    bank_account: str = ""
    bank_ifsc: str = ""
    ctc: int = 0
    basic: int | None = None
    hra: int | None = None
    special_allowance: int | None = None


class EmployeeUpdate(BaseModel):
    emp_code: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    designation: str | None = None
    department: str | None = None
    joining_date: str | None = None
    status: str | None = None
    manager_name: str | None = None
    pan: str | None = None
    uan: str | None = None
    bank_name: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    ctc: int | None = None
    basic: int | None = None
    hra: int | None = None
    special_allowance: int | None = None


class LetterGenerateRequest(BaseModel):
    employee_id: str | None = None
    letter_type: str  # offer, promotion, termination, relieving
    title: str
    placeholders: dict[str, Any]
    content: str


class PayrollRunRequest(BaseModel):
    month: int
    year: int


class AttendancePunchRequest(BaseModel):
    employee_id: str
    date: str
    status: str  # present, absent, half_day, wfh, on_leave
    punch_in: str | None = None
    punch_out: str | None = None
    notes: str | None = None


class LeaveRequestCreate(BaseModel):
    employee_id: str
    leave_type: str  # casual, sick, earned, unpaid
    start_date: str
    end_date: str
    days: int = 1
    reason: str = ""


class LeaveStatusUpdate(BaseModel):
    status: str  # approved, rejected, pending


# -------------------------------------------------------------------------
# KPI / Dashboard Overview
# -------------------------------------------------------------------------

@router.get("/stats")
def get_hrms_stats(user: Annotated[dict, Depends(require_staff)]):
    """Return top-level KPIs for HRMS dashboard."""
    init_hrms_tables()
    with get_db() as conn:
        # Headcount & status breakdown
        emp_rows = conn.execute("SELECT status, ctc, department FROM hrms_employees").fetchall()
        total_employees = len(emp_rows)
        active_count = sum(1 for r in emp_rows if r["status"] == "active")
        probation_count = sum(1 for r in emp_rows if r["status"] == "probation")
        notice_count = sum(1 for r in emp_rows if r["status"] == "notice_period")
        total_monthly_payroll = sum(int(r["ctc"] / 12) for r in emp_rows if r["status"] in ("active", "probation"))

        # Department breakdown
        dept_counts: dict[str, int] = {}
        for r in emp_rows:
            d = r["department"] or "General"
            dept_counts[d] = dept_counts.get(d, 0) + 1

        # Today's attendance
        today_str = date.today().isoformat()
        att_rows = conn.execute(
            "SELECT status, COUNT(*) as cnt FROM hrms_attendance WHERE date = ? GROUP BY status",
            (today_str,),
        ).fetchall()
        attendance_today = {r["status"]: r["cnt"] for r in att_rows}
        present_count = attendance_today.get("present", 0) + attendance_today.get("wfh", 0)

        # Pending leaves
        pending_leaves = conn.execute(
            "SELECT COUNT(*) FROM hrms_leaves WHERE status = 'pending'"
        ).fetchone()[0]

        # Recent letters count
        letters_count = conn.execute("SELECT COUNT(*) FROM hrms_letters").fetchone()[0]

        # Recent payroll run
        last_run = conn.execute(
            "SELECT * FROM hrms_payroll_runs ORDER BY year DESC, month DESC LIMIT 1"
        ).fetchone()

        return {
            "total_employees": total_employees,
            "active_count": active_count,
            "probation_count": probation_count,
            "notice_count": notice_count,
            "total_monthly_payroll": total_monthly_payroll,
            "departments": dept_counts,
            "today_attendance": {
                "date": today_str,
                "present": present_count,
                "absent": attendance_today.get("absent", 0),
                "half_day": attendance_today.get("half_day", 0),
                "wfh": attendance_today.get("wfh", 0),
                "on_leave": attendance_today.get("on_leave", 0),
            },
            "pending_leaves": pending_leaves,
            "letters_count": letters_count,
            "last_payroll_run": dict(last_run) if last_run else None,
        }


# -------------------------------------------------------------------------
# Employee Directory Endpoints
# -------------------------------------------------------------------------

@router.get("/employees")
def list_employees(
    user: Annotated[dict, Depends(require_staff)],
    department: str | None = None,
    status: str | None = None,
    q: str | None = None,
):
    init_hrms_tables()
    with get_db() as conn:
        query = "SELECT * FROM hrms_employees WHERE 1=1"
        params: list[Any] = []
        if department:
            query += " AND department = ?"
            params.append(department)
        if status:
            query += " AND status = ?"
            params.append(status)
        if q:
            query += " AND (name LIKE ? OR emp_code LIKE ? OR designation LIKE ? OR email LIKE ?)"
            term = f"%{q.strip()}%"
            params.extend([term, term, term, term])
        query += " ORDER BY emp_code ASC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.get("/employees/{emp_id}")
def get_employee(emp_id: str, user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM hrms_employees WHERE id = ?", (emp_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Employee not found")
        data = dict(row)
        data["salary_breakdown"] = calculate_salary_breakdown(data["ctc"])
        return data


@router.post("/employees")
def create_employee(req: EmployeeCreate, user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    now = _utcnow()
    emp_id = f"emp_{uuid.uuid4().hex[:8]}"

    # Auto-calculate breakdown if not specified
    breakdown = calculate_salary_breakdown(req.ctc)
    basic = req.basic if req.basic is not None else breakdown["basic"]
    hra = req.hra if req.hra is not None else breakdown["hra"]
    special_allowance = (
        req.special_allowance if req.special_allowance is not None else breakdown["special_allowance"]
    )

    with get_db() as conn:
        # Check emp_code & email uniqueness
        existing = conn.execute(
            "SELECT id FROM hrms_employees WHERE emp_code = ? OR email = ?",
            (req.emp_code.strip(), req.email.strip().lower()),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Employee code or email already exists")

        conn.execute(
            """
            INSERT INTO hrms_employees (
                id, emp_code, name, email, phone, designation, department, joining_date,
                status, manager_name, pan, uan, bank_name, bank_account, bank_ifsc,
                ctc, basic, hra, special_allowance, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                emp_id, req.emp_code.strip().upper(), req.name.strip(), req.email.strip().lower(),
                req.phone.strip(), req.designation.strip(), req.department.strip(), req.joining_date,
                req.status, req.manager_name.strip(), req.pan.strip().upper(), req.uan.strip(),
                req.bank_name.strip(), req.bank_account.strip(), req.bank_ifsc.strip().upper(),
                req.ctc, basic, hra, special_allowance, now, now
            ),
        )

        row = conn.execute("SELECT * FROM hrms_employees WHERE id = ?", (emp_id,)).fetchone()
        return dict(row)


@router.patch("/employees/{emp_id}")
def update_employee(emp_id: str, req: EmployeeUpdate, user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM hrms_employees WHERE id = ?", (emp_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Employee not found")

        curr = dict(row)
        updates = req.model_dump(exclude_unset=True)

        if "ctc" in updates and updates["ctc"] is not None:
            # Recompute default components if not explicitly provided
            bd = calculate_salary_breakdown(updates["ctc"])
            if "basic" not in updates:
                updates["basic"] = bd["basic"]
            if "hra" not in updates:
                updates["hra"] = bd["hra"]
            if "special_allowance" not in updates:
                updates["special_allowance"] = bd["special_allowance"]

        updates["updated_at"] = _utcnow()

        set_clauses = [f"{k} = ?" for k in updates.keys()]
        values = list(updates.values()) + [emp_id]

        conn.execute(
            f"UPDATE hrms_employees SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )

        updated_row = conn.execute("SELECT * FROM hrms_employees WHERE id = ?", (emp_id,)).fetchone()
        return dict(updated_row)


@router.delete("/employees/{emp_id}")
def delete_employee(emp_id: str, user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    with get_db() as conn:
        conn.execute("DELETE FROM hrms_employees WHERE id = ?", (emp_id,))
        return {"status": "ok", "deleted_id": emp_id}


# -------------------------------------------------------------------------
# Letters & Document Generator Endpoints
# -------------------------------------------------------------------------

TEMPLATES = {
    "internship_offer": {
        "title": "Internship Offer - Financial Analyst",
        "description": "Exact Fund Horizon official internship offer letter with tenure, AI analytics responsibilities, confidentiality, and Mr. Manohar's signature & stamp.",
        "default_placeholders": {
            "employee_name": "Debabrata Mukherjee",
            "subject": "Internship Offer - Financial Analyst",
            "designation": "Financial Analyst",
            "department": "Research & Analytics",
            "duration": "2 months",
            "date": "October 12, 2026",
            "joining_date": "October 12, 2026",
        },
        "content": (
            "We are delighted to extend an offer to you for an internship position as a Financial Analyst at Fund Horizon. "
            "Your skills and academic background have impressed us, and we are confident that you will be a valuable addition to our team.\n\n"
            "1. Tenure and Schedule\n"
            "Your internship will span a duration of {{duration}} commencing from {{joining_date}}.\n\n"
            "2. Role and Responsibilities\n"
            "During your internship, you will be expected to undertake the following responsibilities:\n"
            "• Conducting in-depth research and quantitative analysis on Mutual Funds and Portfolio Management Services (PMS).\n"
            "• Assisting in portfolio management strategies, asset allocation, and tracking fund performance.\n"
            "• Building and integrating Artificial Intelligence (AI) models and tools to automate research workflows, forecast trends, and enhance decision-making.\n"
            "• Designing data-driven dashboards and presenting actionable insights to the management team.\n\n"
            "3. Confidentiality and Policies\n"
            "As an intern, you will have access to confidential company data, client information, and proprietary workflows. "
            "You are strictly required to maintain confidentiality and not disclose any sensitive information to third parties during or after your internship tenure. "
            "All work products, AI tools, and dashboards created during this period will remain the intellectual property of Fund Horizon.\n\n"
            "4. Conclusion\n"
            "We hope that this internship will be a mutually beneficial experience, providing you with robust practical exposure to AI-driven financial analytics while contributing significantly to our firm's goals.\n\n"
            "To accept this offer, please sign and return a copy of this letter. Should you have any queries regarding your onboarding, please feel free to reach out to HR at +91 9702019449 or via email at support@fundhorizon.com.\n\n"
            "We look forward to welcoming you to the Fund Horizon team!"
        ),
    },
    "offer": {
        "title": "Offer of Employment",
        "description": "Formal job offer with role specifics and Indian CTC compensation annexure.",
        "default_placeholders": {
            "employee_name": "Aryan Mehrotra",
            "designation": "Wealth Management Associate",
            "department": "Wealth Advisory",
            "joining_date": date.today().strftime("%B %d, %Y"),
            "ctc": "12,00,000",
            "manager": "Arun Sharma (Principal Wealth Strategist)",
            "location": "Mumbai, Maharashtra",
            "valid_until": (date.today()).strftime("%B %d, %Y"),
        },
        "content": (
            "Dear {{employee_name}},\n\n"
            "We are pleased to offer you the position of {{designation}} in the {{department}} Department "
            "at Fund Horizon Private Limited ('Fund Horizon'). We believe your expertise, discipline, and "
            "energy will make a substantial contribution to our high-conviction wealth management philosophy.\n\n"
            "Your employment will officially commence on {{joining_date}}, based out of our Mumbai Headquarters. "
            "You will report directly to {{manager}}.\n\n"
            "Your Annual Cost to Company (CTC) will be INR {{ctc}}, structured as detailed in Annexure A below. "
            "All statutory deductions including Provident Fund, Professional Tax, and Income Tax (TDS) shall be "
            "deducted in accordance with prevailing Indian laws.\n\n"
            "This offer is contingent upon successful verification of your credentials, past employment records, "
            "and references. Please sign and return a duplicate copy of this letter on or before {{valid_until}} "
            "to confirm your acceptance.\n\n"
            "We warmly welcome you to the Fund Horizon family and look forward to building enduring wealth together."
        ),
    },
    "promotion": {
        "title": "Promotion & Compensation Revision",
        "description": "Recognition of performance with elevation in designation and CTC.",
        "default_placeholders": {
            "employee_name": "Priya Nair",
            "designation": "Vice President - Research & Analytics",
            "department": "Research & Analytics",
            "effective_date": date.today().strftime("%B %d, %Y"),
            "ctc": "18,00,000",
            "manager": "Debabrata Mukherjee (Director)",
        },
        "content": (
            "Dear {{employee_name}},\n\n"
            "In recognition of your outstanding performance, exceptional dedication, and leadership contributions "
            "to Fund Horizon, the Management is pleased to promote you to the role of {{designation}} in the "
            "{{department}} Department, effective {{effective_date}}.\n\n"
            "In your new capacity, you will continue to report to {{manager}}. With this promotion, your revised "
            "Annual Cost to Company (CTC) will be INR {{ctc}}, structured as outlined in Annexure A below.\n\n"
            "We have full faith in your capability to spearhead our strategic research objectives and uphold our "
            "rigorous fiduciary governance. Congratulations on this well-deserved milestone!"
        ),
    },
    "termination": {
        "title": "Separation and Termination of Employment",
        "description": "Formal notice of separation with handover instructions and final settlement terms.",
        "default_placeholders": {
            "employee_name": "Rohan Verma",
            "designation": "Operations Specialist",
            "department": "Operations",
            "effective_date": date.today().strftime("%B %d, %Y"),
            "last_working_day": date.today().strftime("%B %d, %Y"),
            "reason": "Organizational restructuring and realignment of operational requirements",
        },
        "content": (
            "Dear {{employee_name}},\n\n"
            "This formal notice serves to advise you that your employment with Fund Horizon Private Limited as "
            "{{designation}} in the {{department}} Department shall stand terminated effective {{effective_date}}.\n\n"
            "Your last working day with the organization will be {{last_working_day}}. This decision has been taken "
            "following administrative review on grounds of: {{reason}}.\n\n"
            "You are instructed to complete full hand-over of all company properties, client records, and access "
            "credentials to your reporting manager by 5:00 PM on your last working day. Your final settlement "
            "(Full & Final), including earned salary, accrued leaves, and statutory dues, will be disbursed within "
            "45 days upon receipt of a complete department clearance certificate."
        ),
    },
    "relieving": {
        "title": "Relieving & Experience Certificate",
        "description": "Official service certificate confirming tenure, designation, and clean conduct.",
        "default_placeholders": {
            "employee_name": "Rohan Verma",
            "designation": "Operations Specialist",
            "department": "Operations",
            "joining_date": "January 10, 2024",
            "last_working_day": date.today().strftime("%B %d, %Y"),
            "conduct": "exemplary, professional, and ethical",
        },
        "content": (
            "TO WHOMSOEVER IT MAY CONCERN\n\n"
            "This is to certify that {{employee_name}} was employed with Fund Horizon Private Limited from "
            "{{joining_date}} to {{last_working_day}}. During their tenure with us, they served with dedication "
            "as {{designation}} in the {{department}} Department.\n\n"
            "During their tenure, we found {{employee_name}} to be conscientious, proactive, and deeply committed "
            "to organizational objectives. Their conduct and character have been {{conduct}}.\n\n"
            "{{employee_name}} has been officially relieved of all professional duties and responsibilities with "
            "Fund Horizon at the close of business on {{last_working_day}}. We have no outstanding claims or liabilities.\n\n"
            "We thank {{employee_name}} for their valuable contributions and wish them every success in all future "
            "professional endeavors."
        ),
    },
}


@router.get("/letters/templates")
def get_letter_templates(user: Annotated[dict, Depends(require_staff)]):
    """Return available letter templates with default placeholders and texts."""
    return TEMPLATES


@router.get("/letters")
def list_letters(
    user: Annotated[dict, Depends(require_staff)],
    letter_type: str | None = None,
    employee_id: str | None = None,
):
    init_hrms_tables()
    with get_db() as conn:
        q = """
            SELECT l.*, e.name as emp_name, e.emp_code
            FROM hrms_letters l
            LEFT JOIN hrms_employees e ON l.employee_id = e.id
            WHERE 1=1
        """
        params: list[Any] = []
        if letter_type:
            q += " AND l.letter_type = ?"
            params.append(letter_type)
        if employee_id:
            q += " AND l.employee_id = ?"
            params.append(employee_id)
        q += " ORDER BY l.created_at DESC"
        rows = conn.execute(q, params).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["placeholders"] = json.loads(d["placeholders_json"])
            except Exception:
                d["placeholders"] = {}
            result.append(d)
        return result


@router.post("/letters/generate")
def generate_letter(req: LetterGenerateRequest, user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    letter_id = f"let_{uuid.uuid4().hex[:8]}"
    now = _utcnow()

    # Resolve placeholders in text
    resolved_content = req.content
    for k, v in req.placeholders.items():
        placeholder_key = f"{{{{{k}}}}}"
        resolved_content = resolved_content.replace(placeholder_key, str(v))

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO hrms_letters (
                id, employee_id, letter_type, title, placeholders_json, content, created_at, generated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                letter_id,
                req.employee_id,
                req.letter_type,
                req.title,
                json.dumps(req.placeholders),
                resolved_content,
                now,
                user.get("name") or user.get("email") or "Backoffice HR",
            ),
        )

        row = conn.execute("SELECT * FROM hrms_letters WHERE id = ?", (letter_id,)).fetchone()
        data = dict(row)
        data["placeholders"] = req.placeholders
        return data


@router.get("/letters/{letter_id}/pdf")
def download_letter_pdf(letter_id: str, user: Annotated[dict, Depends(require_staff)]):
    """Generate and return official letter PDF with company letterhead and signature stamp."""
    init_hrms_tables()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM hrms_letters WHERE id = ?", (letter_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Letter not found")

        letter = dict(row)
        emp = {}
        if letter.get("employee_id"):
            emp_row = conn.execute(
                "SELECT * FROM hrms_employees WHERE id = ?", (letter["employee_id"],)
            ).fetchone()
            if emp_row:
                emp = dict(emp_row)

        placeholders = {}
        try:
            placeholders = json.loads(letter["placeholders_json"])
        except Exception:
            pass

        pdf_bytes = render_hrms_letter_pdf(
            letter_type=letter["letter_type"],
            title=letter["title"],
            recipient=emp,
            placeholders=placeholders,
            content=letter["content"],
        )

        filename = f"FundHorizon_{letter['letter_type'].capitalize()}_{emp.get('emp_code', 'DOC')}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )


# -------------------------------------------------------------------------
# Payroll & Salary Slips Endpoints
# -------------------------------------------------------------------------

@router.get("/payroll/runs")
def list_payroll_runs(user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM hrms_payroll_runs ORDER BY year DESC, month DESC"
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/payroll/run")
def create_payroll_run(req: PayrollRunRequest, user: Annotated[dict, Depends(require_staff)]):
    """Execute monthly payroll run for all active and probation staff."""
    init_hrms_tables()
    now = _utcnow()
    run_id = f"pay_{req.year}_{req.month:02d}_{uuid.uuid4().hex[:4]}"

    with get_db() as conn:
        # Check if run already exists
        existing = conn.execute(
            "SELECT id FROM hrms_payroll_runs WHERE month = ? AND year = ?",
            (req.month, req.year),
        ).fetchone()
        if existing:
            # Delete prior run or abort
            conn.execute("DELETE FROM hrms_payslips WHERE run_id = ?", (existing["id"],))
            conn.execute("DELETE FROM hrms_payroll_runs WHERE id = ?", (existing["id"],))

        # Get all eligible staff
        employees = conn.execute(
            "SELECT * FROM hrms_employees WHERE status IN ('active', 'probation', 'notice_period')"
        ).fetchall()

        if not employees:
            raise HTTPException(status_code=400, detail="No active employees found to run payroll")

        total_gross = 0
        total_ded = 0
        total_net = 0
        slips_to_insert = []

        days_in_month = 30
        if req.month in (1, 3, 5, 7, 8, 10, 12):
            days_in_month = 31
        elif req.month == 2:
            days_in_month = 29 if req.year % 4 == 0 else 28

        for e in employees:
            ed = dict(e)
            ctc = ed["ctc"]
            bd = calculate_salary_breakdown(ctc)

            # Check attendance if recorded for that month
            att_cnt = conn.execute(
                """
                SELECT COUNT(*) FROM hrms_attendance
                WHERE employee_id = ? AND date LIKE ? AND status IN ('present', 'wfh')
                """,
                (ed["id"], f"{req.year}-{req.month:02d}%"),
            ).fetchone()[0]

            days_worked = days_in_month
            # If attendance is actively logged, respect days_worked
            if att_cnt > 0:
                days_worked = min(days_in_month, max(1, att_cnt))

            # Prorate pay if days_worked < days_in_month
            ratio = days_worked / days_in_month
            gross = int(bd["monthly_gross"] * ratio)
            basic = int(bd["basic"] * ratio)
            hra = int(bd["hra"] * ratio)
            sa = int(bd["special_allowance"] * ratio)
            pf = int(bd["pf_deduction"] * ratio)
            pt = bd["pt_deduction"]
            tds = int(bd["tds_deduction"] * ratio)
            ded = pf + pt + tds
            net = max(0, gross - ded)

            total_gross += gross
            total_ded += ded
            total_net += net

            slip_id = f"slip_{req.year}_{req.month:02d}_{ed['emp_code']}"
            slips_to_insert.append((
                slip_id,
                run_id,
                ed["id"],
                req.month,
                req.year,
                days_in_month,
                days_worked,
                gross,
                basic,
                hra,
                sa,
                pf,
                pt,
                tds,
                ded,
                net,
                "generated",
                None,
                now,
            ))

        # Insert run
        conn.execute(
            """
            INSERT INTO hrms_payroll_runs (
                id, month, year, total_gross, total_deductions, total_net, employee_count, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                req.month,
                req.year,
                total_gross,
                total_ded,
                total_net,
                len(employees),
                "generated",
                now,
            ),
        )

        # Insert payslips
        conn.executemany(
            """
            INSERT INTO hrms_payslips (
                id, run_id, employee_id, month, year, days_in_month, days_worked,
                gross_pay, basic, hra, special_allowance, pf_deduction, pt_deduction,
                tds_deduction, total_deductions, net_pay, status, dispatched_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            slips_to_insert,
        )

        row = conn.execute("SELECT * FROM hrms_payroll_runs WHERE id = ?", (run_id,)).fetchone()
        return dict(row)


@router.get("/payslips")
def list_payslips(
    user: Annotated[dict, Depends(require_staff)],
    run_id: str | None = None,
    month: int | None = None,
    year: int | None = None,
    employee_id: str | None = None,
):
    init_hrms_tables()
    with get_db() as conn:
        q = """
            SELECT p.*, e.name as emp_name, e.emp_code, e.designation, e.department,
                   e.pan, e.uan, e.bank_name, e.bank_account, e.bank_ifsc
            FROM hrms_payslips p
            JOIN hrms_employees e ON p.employee_id = e.id
            WHERE 1=1
        """
        params: list[Any] = []
        if run_id:
            q += " AND p.run_id = ?"
            params.append(run_id)
        if month:
            q += " AND p.month = ?"
            params.append(month)
        if year:
            q += " AND p.year = ?"
            params.append(year)
        if employee_id:
            q += " AND p.employee_id = ?"
            params.append(employee_id)
        q += " ORDER BY e.emp_code ASC"
        rows = conn.execute(q, params).fetchall()
        return [dict(r) for r in rows]


@router.get("/payslips/{slip_id}/pdf")
def download_payslip_pdf(slip_id: str, user: Annotated[dict, Depends(require_staff)]):
    """Generate and return official monthly salary slip PDF."""
    init_hrms_tables()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM hrms_payslips WHERE id = ?", (slip_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Salary slip not found")

        slip = dict(row)
        emp_row = conn.execute("SELECT * FROM hrms_employees WHERE id = ?", (slip["employee_id"],)).fetchone()
        if not emp_row:
            raise HTTPException(status_code=404, detail="Employee not found")

        emp = dict(emp_row)
        pdf_bytes = render_payslip_pdf(emp=emp, slip=slip)

        filename = f"Payslip_{slip['year']}_{slip['month']:02d}_{emp['emp_code']}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )


@router.post("/payslips/{slip_id}/dispatch")
def dispatch_payslip(slip_id: str, user: Annotated[dict, Depends(require_staff)]):
    """Mark a salary slip as dispatched to employee via company portal/email."""
    init_hrms_tables()
    now = _utcnow()
    with get_db() as conn:
        conn.execute(
            "UPDATE hrms_payslips SET status = 'dispatched', dispatched_at = ? WHERE id = ?",
            (now, slip_id),
        )
        return {"status": "dispatched", "slip_id": slip_id, "dispatched_at": now}


@router.post("/payroll/runs/{run_id}/dispatch-all")
def dispatch_all_payslips(run_id: str, user: Annotated[dict, Depends(require_staff)]):
    """Bulk dispatch all salary slips in a payroll run."""
    init_hrms_tables()
    now = _utcnow()
    with get_db() as conn:
        conn.execute(
            "UPDATE hrms_payslips SET status = 'dispatched', dispatched_at = ? WHERE run_id = ?",
            (now, run_id),
        )
        conn.execute(
            "UPDATE hrms_payroll_runs SET status = 'completed' WHERE id = ?",
            (run_id,),
        )
        return {"status": "all_dispatched", "run_id": run_id, "dispatched_at": now}


# -------------------------------------------------------------------------
# Attendance & Leave Register
# -------------------------------------------------------------------------

@router.get("/attendance")
def list_attendance(
    user: Annotated[dict, Depends(require_staff)],
    date: str | None = None,
    month: str | None = None,  # YYYY-MM
    employee_id: str | None = None,
):
    init_hrms_tables()
    with get_db() as conn:
        q = """
            SELECT a.*, e.name as emp_name, e.emp_code, e.designation, e.department
            FROM hrms_attendance a
            JOIN hrms_employees e ON a.employee_id = e.id
            WHERE 1=1
        """
        params: list[Any] = []
        if date:
            q += " AND a.date = ?"
            params.append(date)
        elif month:
            q += " AND a.date LIKE ?"
            params.append(f"{month}%")
        if employee_id:
            q += " AND a.employee_id = ?"
            params.append(employee_id)
        q += " ORDER BY a.date DESC, e.emp_code ASC"
        rows = conn.execute(q, params).fetchall()
        return [dict(r) for r in rows]


@router.post("/attendance/punch")
def punch_attendance(req: AttendancePunchRequest, user: Annotated[dict, Depends(require_staff)]):
    """Record or update employee daily attendance punch."""
    init_hrms_tables()
    att_id = f"att_{req.employee_id}_{req.date}"
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO hrms_attendance (id, employee_id, date, status, punch_in, punch_out, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(employee_id, date) DO UPDATE SET
                status = excluded.status,
                punch_in = COALESCE(excluded.punch_in, hrms_attendance.punch_in),
                punch_out = COALESCE(excluded.punch_out, hrms_attendance.punch_out),
                notes = COALESCE(excluded.notes, hrms_attendance.notes)
            """,
            (
                att_id,
                req.employee_id,
                req.date,
                req.status,
                req.punch_in,
                req.punch_out,
                req.notes,
            ),
        )
        row = conn.execute("SELECT * FROM hrms_attendance WHERE id = ?", (att_id,)).fetchone()
        return dict(row)


@router.post("/attendance/bulk")
def mark_bulk_attendance(
    payload: dict[str, Any],
    user: Annotated[dict, Depends(require_staff)],
):
    """Mark all active employees present/absent for a given date."""
    init_hrms_tables()
    att_date = payload.get("date") or date.today().isoformat()
    status = payload.get("status", "present")
    punch_in = payload.get("punch_in", "09:30 AM")
    punch_out = payload.get("punch_out", "06:30 PM")

    with get_db() as conn:
        emps = conn.execute("SELECT id FROM hrms_employees WHERE status = 'active'").fetchall()
        for e in emps:
            att_id = f"att_{e['id']}_{att_date}"
            conn.execute(
                """
                INSERT INTO hrms_attendance (id, employee_id, date, status, punch_in, punch_out)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(employee_id, date) DO UPDATE SET
                    status = excluded.status,
                    punch_in = excluded.punch_in,
                    punch_out = excluded.punch_out
                """,
                (att_id, e["id"], att_date, status, punch_in, punch_out),
            )
        return {"status": "ok", "marked_count": len(emps), "date": att_date}


@router.get("/leaves")
def list_leaves(
    user: Annotated[dict, Depends(require_staff)],
    status: str | None = None,
    employee_id: str | None = None,
):
    init_hrms_tables()
    with get_db() as conn:
        q = """
            SELECT l.*, e.name as emp_name, e.emp_code, e.department, e.designation
            FROM hrms_leaves l
            JOIN hrms_employees e ON l.employee_id = e.id
            WHERE 1=1
        """
        params: list[Any] = []
        if status:
            q += " AND l.status = ?"
            params.append(status)
        if employee_id:
            q += " AND l.employee_id = ?"
            params.append(employee_id)
        q += " ORDER BY l.created_at DESC"
        rows = conn.execute(q, params).fetchall()
        return [dict(r) for r in rows]


@router.post("/leaves")
def apply_leave(req: LeaveRequestCreate, user: Annotated[dict, Depends(require_staff)]):
    init_hrms_tables()
    leave_id = f"leave_{uuid.uuid4().hex[:8]}"
    now = _utcnow()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO hrms_leaves (
                id, employee_id, leave_type, start_date, end_date, days, reason, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                leave_id,
                req.employee_id,
                req.leave_type,
                req.start_date,
                req.end_date,
                req.days,
                req.reason.strip(),
                now,
            ),
        )
        row = conn.execute("SELECT * FROM hrms_leaves WHERE id = ?", (leave_id,)).fetchone()
        return dict(row)


@router.patch("/leaves/{leave_id}/status")
def update_leave_status(
    leave_id: str,
    req: LeaveStatusUpdate,
    user: Annotated[dict, Depends(require_staff)],
):
    init_hrms_tables()
    reviewer = user.get("name") or user.get("email") or "HR Admin"
    with get_db() as conn:
        conn.execute(
            "UPDATE hrms_leaves SET status = ?, reviewed_by = ? WHERE id = ?",
            (req.status, reviewer, leave_id),
        )
        row = conn.execute("SELECT * FROM hrms_leaves WHERE id = ?", (leave_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Leave request not found")
        return dict(row)

