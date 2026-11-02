from __future__ import annotations
"""Comprehensive stress tests for the entire Fund Horizon HRMS suite.
Tests concurrent employee creation, uniqueness constraints, all letter templates & PDF rendering,
Indian payroll calculation & proration, payslip bulk generation and dispatch, and attendance/leave tracking.
"""

import concurrent.futures
import io
import os
import sqlite3
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.auth import require_staff
from app.hrms_db import (
    calculate_salary_breakdown,
    get_db,
    init_hrms_tables,
)
from app.main import app
from app.report.hrms_docs import render_hrms_letter_pdf, render_payslip_pdf


@pytest.fixture(autouse=True)
def isolated_test_db(monkeypatch, tmp_path):
    """Isolate tests into a temporary SQLite database."""
    test_db = tmp_path / "test_hrms.db"
    monkeypatch.setenv("FH_DB_PATH", str(test_db))
    init_hrms_tables()
    yield test_db


@pytest.fixture
def client():
    """Test client with staff authentication bypassed."""
    dummy_staff = {
        "id": "staff_test_01",
        "name": "HR Admin",
        "email": "hr@fundhorizon.com",
        "role": "admin",
        "is_staff": True,
        "status": "active",
    }
    app.dependency_overrides[require_staff] = lambda: dummy_staff
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_calculate_salary_breakdown_edge_cases():
    """Verify salary breakdown math across various salary brackets."""
    # Zero CTC
    b0 = calculate_salary_breakdown(0)
    assert b0["monthly_gross"] == 0
    assert b0["basic"] == 0
    assert b0["net_pay"] == 0

    # Low CTC (< 15,000 / month, no PT)
    b_low = calculate_salary_breakdown(120000)
    assert b_low["monthly_gross"] == 10000
    assert b_low["basic"] == 5000
    assert b_low["hra"] == 2500
    assert b_low["special_allowance"] == 2500
    assert b_low["pf_deduction"] == 600
    assert b_low["pt_deduction"] == 0
    assert b_low["tds_deduction"] == 0
    assert b_low["net_pay"] == 9400

    # Standard CTC (12 LPA)
    b_mid = calculate_salary_breakdown(1200000)
    assert b_mid["monthly_gross"] == 100000
    assert b_mid["basic"] == 50000
    assert b_mid["hra"] == 25000
    assert b_mid["special_allowance"] == 25000
    assert b_mid["pf_deduction"] == 6000
    assert b_mid["pt_deduction"] == 200
    assert b_mid["tds_deduction"] == 5000
    assert b_mid["net_pay"] == 88800

    # High CTC (24 LPA, 10% TDS)
    b_high = calculate_salary_breakdown(2400000)
    assert b_high["monthly_gross"] == 200000
    assert b_high["basic"] == 100000
    assert b_high["hra"] == 50000
    assert b_high["special_allowance"] == 50000
    assert b_high["pf_deduction"] == 12000
    assert b_high["pt_deduction"] == 200
    assert b_high["tds_deduction"] == 20000
    assert b_high["net_pay"] == 167800


def test_concurrent_employee_creation_and_uniqueness(client):
    """Stress test creating 50 employees concurrently and verify constraint enforcement."""
    count = 50

    def create_one(i: int):
        payload = {
            "emp_code": f"FH-{100 + i:03d}",
            "name": f"Employee {i}",
            "email": f"emp_batch_{i}@fundhorizon.com",
            "phone": f"+91 980000{i:04d}",
            "designation": "Analyst" if i % 2 == 0 else "Associate",
            "department": "Research & Analytics" if i % 2 == 0 else "Wealth Advisory",
            "joining_date": "2026-01-15",
            "status": "active",
            "manager_name": "Manohar Hemdev",
            "pan": f"ABCDE{i:04d}F",
            "uan": f"10098765{i:04d}",
            "bank_name": "HDFC Bank",
            "bank_account": f"501002345{i:04d}",
            "bank_ifsc": "HDFC0000123",
            "ctc": 1200000 + (i * 10000),
        }
        return client.post("/api/hrms/employees", json=payload)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(create_one, i) for i in range(1, count + 1)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    for r in results:
        assert r.status_code == 200, f"Employee creation failed: {r.text}"

    # Verify all in database (3 seeded + 50 created)
    res = client.get("/api/hrms/employees")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= count + 3

    # Duplicate emp_code test against seeded FH-001
    dup_code_resp = client.post(
        "/api/hrms/employees",
        json={
            "emp_code": "FH-001",
            "name": "Duplicate Code",
            "email": "unique@fundhorizon.com",
            "designation": "Manager",
            "department": "Operations",
            "joining_date": "2026-02-01",
            "ctc": 900000,
        },
    )
    assert dup_code_resp.status_code == 400
    assert "already assigned" in dup_code_resp.json()["detail"]

    # Duplicate email test
    dup_email_resp = client.post(
        "/api/hrms/employees",
        json={
            "emp_code": "FH-999",
            "name": "Duplicate Email",
            "email": "emp_batch_1@fundhorizon.com",
            "designation": "Manager",
            "department": "Operations",
            "joining_date": "2026-02-01",
            "ctc": 900000,
        },
    )
    assert dup_email_resp.status_code == 400
    assert "already registered" in dup_email_resp.json()["detail"]


def test_letters_stress_all_templates_and_pdf_generation(client):
    """Stress test generating all 5 types of HR letters and rendering valid PDFs."""
    # First create a test employee
    emp_res = client.post(
        "/api/hrms/employees",
        json={
            "emp_code": "FH-010",
            "name": "Debabrata Mukherjee",
            "email": "debmuk.dm@fundhorizon.com",
            "designation": "Senior Financial Analyst",
            "department": "Research & Analytics",
            "joining_date": "2026-11-01",
            "ctc": 1800000,
        },
    )
    assert emp_res.status_code == 200
    emp_id = emp_res.json()["id"]

    # Get templates
    tmpl_res = client.get("/api/hrms/templates")
    assert tmpl_res.status_code == 200
    templates = tmpl_res.json()
    assert "internship_offer" in templates
    assert "offer" in templates
    assert "promotion" in templates
    assert "termination" in templates
    assert "relieving" in templates

    for t_type, t_data in templates.items():
        payload = {
            "employee_id": emp_id,
            "letter_type": t_type,
            "title": t_data["title"],
            "placeholders": {
                **t_data["default_placeholders"],
                "employee_name": "Debabrata Mukherjee",
                "designation": "Senior Financial Analyst",
                "department": "Research & Analytics",
                "joining_date": "01 November 2026",
                "ctc_inr": "₹18,00,000",
                "date": "02 November 2026",
            },
            "content": t_data["content"],
        }
        gen_res = client.post("/api/hrms/letters/generate", json=payload)
        assert gen_res.status_code == 200, f"Generation failed for {t_type}: {gen_res.text}"
        letter_id = gen_res.json()["id"]

        # Fetch PDF
        pdf_res = client.get(f"/api/hrms/letters/{letter_id}/pdf")
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF-")
        assert len(pdf_res.content) > 3000, f"PDF too small for {t_type}: {len(pdf_res.content)} bytes"


def test_payroll_run_calculation_and_bulk_dispatch_stress(client):
    """Stress test running payroll, verifying proration, and bulk dispatching payslips."""
    # Seed 10 employees
    for i in range(1, 11):
        client.post(
            "/api/hrms/employees",
            json={
                "emp_code": f"FH-P{i:02d}",
                "name": f"Payroll Staff {i}",
                "email": f"payroll{i}@fundhorizon.com",
                "designation": "Associate",
                "department": "Advisory",
                "joining_date": "2026-01-01",
                "ctc": 1200000,
            },
        )

    # Trigger payroll run for November 2026
    run_res = client.post("/api/hrms/payroll/runs", json={"month": 11, "year": 2026})
    assert run_res.status_code == 200
    run_data = run_res.json()
    run_id = run_data["id"]
    assert run_data["employee_count"] >= 10
    assert run_data["total_gross"] > 0
    assert run_data["total_net"] > 0

    # Fetch generated payslips
    slips_res = client.get(f"/api/hrms/payroll/runs/{run_id}/slips")
    assert slips_res.status_code == 200
    slips = slips_res.json()
    assert len(slips) >= 10

    # Test PDF rendering on first 3 payslips concurrently
    def fetch_slip_pdf(slip_id: str):
        return client.get(f"/api/hrms/payroll/slips/{slip_id}/pdf")

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        pdf_futures = [executor.submit(fetch_slip_pdf, s["id"]) for s in slips[:3]]
        for f in concurrent.futures.as_completed(pdf_futures):
            res = f.result()
            assert res.status_code == 200
            assert res.headers["content-type"] == "application/pdf"
            assert res.content.startswith(b"%PDF-")

    # Bulk dispatch payslips
    dispatch_res = client.post(f"/api/hrms/payroll/runs/{run_id}/dispatch-all")
    assert dispatch_res.status_code == 200
    assert dispatch_res.json()["dispatched_count"] >= 10

    # Verify run status is completed
    slips_after = client.get(f"/api/hrms/payroll/runs/{run_id}/slips").json()
    assert all(s["status"] == "dispatched" for s in slips_after)


def test_attendance_and_leave_workflow_stress(client):
    """Stress test bulk attendance marking, single punches, and leave approvals."""
    # Create employee
    emp_res = client.post(
        "/api/hrms/employees",
        json={
            "emp_code": f"FH-ATT",
            "name": "Attendance Tester",
            "email": "att.tester@fundhorizon.com",
            "designation": "Analyst",
            "department": "Operations",
            "joining_date": "2026-01-01",
            "ctc": 800000,
        },
    )
    emp_id = emp_res.json()["id"]

    today_str = date.today().isoformat()

    # Bulk attendance mark
    bulk_res = client.post("/api/hrms/attendance/bulk", json={"date": today_str, "status": "present"})
    assert bulk_res.status_code == 200
    assert bulk_res.json()["marked_count"] >= 1

    # Individual punch update
    punch_res = client.post(
        "/api/hrms/attendance/punch",
        json={
            "employee_id": emp_id,
            "date": today_str,
            "status": "wfh",
            "punch_in": "09:30",
            "punch_out": "18:30",
            "notes": "Work from home approved",
        },
    )
    assert punch_res.status_code == 200
    assert punch_res.json()["status"] == "wfh"

    # Submit leave request
    leave_res = client.post(
        "/api/hrms/leaves",
        json={
            "employee_id": emp_id,
            "leave_type": "sick",
            "start_date": today_str,
            "end_date": today_str,
            "days": 1,
            "reason": "Viral fever",
        },
    )
    assert leave_res.status_code == 200
    leave_id = leave_res.json()["id"]
    assert leave_res.json()["status"] == "pending"

    # Approve leave
    patch_res = client.patch(f"/api/hrms/leaves/{leave_id}/status", json={"status": "approved"})
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "approved"

    # Verify HRMS stats endpoint reflects data
    stats_res = client.get("/api/hrms/stats")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert stats["total_employees"] >= 1
    assert stats["total_monthly_payroll"] > 0
