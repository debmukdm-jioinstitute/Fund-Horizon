from __future__ import annotations

import io
from app.hrms_db import (
    calculate_salary_breakdown,
    get_db,
    init_hrms_tables,
)
from app.report.hrms_docs import (
    render_hrms_letter_pdf,
    render_payslip_pdf,
)


def test_salary_breakdown_calculation():
    # 24,00,000 CTC
    res = calculate_salary_breakdown(2400000)
    assert res["monthly_gross"] == 200000
    assert res["basic"] == 100000  # 50%
    assert res["hra"] == 50000    # 50% of basic
    assert res["special_allowance"] == 50000
    assert res["pf_deduction"] == 12000  # 12% of basic
    assert res["pt_deduction"] == 200
    assert res["tds_deduction"] == 20000  # 10%
    assert res["total_deductions"] == 32200
    assert res["net_pay"] == 167800


def test_hrms_database_and_crud():
    init_hrms_tables()
    with get_db() as conn:
        # Check seeded employees
        cnt = conn.execute("SELECT COUNT(*) FROM hrms_employees").fetchone()[0]
        assert cnt >= 4

        # Query single
        emp = conn.execute("SELECT * FROM hrms_employees WHERE emp_code = 'FH-001'").fetchone()
        assert emp is not None
        assert emp["name"] == "Arun Sharma"


def test_hrms_letter_pdf_generation():
    emp = {
        "emp_code": "FH-001",
        "name": "Arun Sharma",
        "designation": "Principal Wealth Strategist",
        "department": "Wealth Advisory",
        "ctc": 2400000,
    }
    placeholders = {
        "employee_name": "Arun Sharma",
        "designation": "Principal Wealth Strategist",
        "department": "Wealth Advisory",
        "ctc": "24,00,000",
        "joining_date": "April 01, 2023",
        "valid_until": "April 15, 2023",
    }
    content = "Dear {{employee_name}}, Welcome to Fund Horizon as {{designation}}."
    pdf = render_hrms_letter_pdf(
        letter_type="offer",
        title="Offer of Employment",
        recipient=emp,
        placeholders=placeholders,
        content=content,
    )
    assert isinstance(pdf, bytes)
    assert len(pdf) > 1000
    assert pdf.startswith(b"%PDF")


def test_hrms_payslip_pdf_generation():
    emp = {
        "emp_code": "FH-002",
        "name": "Priya Nair",
        "designation": "Senior Research Analyst",
        "department": "Research & Analytics",
        "joining_date": "2023-08-15",
        "pan": "BPRPN5678B",
        "uan": "100984736251",
        "bank_name": "ICICI Bank",
        "bank_account": "001101928374",
        "bank_ifsc": "ICIC0000011",
    }
    slip = {
        "month": 11,
        "year": 2026,
        "days_in_month": 30,
        "days_worked": 30,
        "gross_pay": 125000,
        "basic": 62500,
        "hra": 31250,
        "special_allowance": 31250,
        "pf_deduction": 7500,
        "pt_deduction": 200,
        "tds_deduction": 12500,
        "total_deductions": 20200,
        "net_pay": 104800,
    }
    pdf = render_payslip_pdf(emp=emp, slip=slip)
    assert isinstance(pdf, bytes)
    assert len(pdf) > 1000
    assert pdf.startswith(b"%PDF")

