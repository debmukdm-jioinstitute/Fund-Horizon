from __future__ import annotations
"""HRMS database schema, models, and persistence layer for Fund Horizon."""

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def get_db_path() -> Path:
    env_path = os.environ.get("FH_DB_PATH")
    if env_path:
        return Path(env_path)
    return Path(__file__).resolve().parents[2] / "plans.db"


DB_PATH = get_db_path()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    p = get_db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    return conn


def init_hrms_tables() -> None:
    """Idempotently create all HRMS tables and indexes."""
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS hrms_employees (
                id TEXT PRIMARY KEY,
                emp_code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                designation TEXT NOT NULL,
                department TEXT NOT NULL,
                joining_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                manager_name TEXT,
                pan TEXT,
                uan TEXT,
                bank_name TEXT,
                bank_account TEXT,
                bank_ifsc TEXT,
                ctc INTEGER NOT NULL DEFAULT 0,
                basic INTEGER NOT NULL DEFAULT 0,
                hra INTEGER NOT NULL DEFAULT 0,
                special_allowance INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS hrms_letters (
                id TEXT PRIMARY KEY,
                employee_id TEXT REFERENCES hrms_employees(id),
                letter_type TEXT NOT NULL,
                title TEXT NOT NULL,
                placeholders_json TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                generated_by TEXT
            );

            CREATE TABLE IF NOT EXISTS hrms_payroll_runs (
                id TEXT PRIMARY KEY,
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                total_gross INTEGER NOT NULL DEFAULT 0,
                total_deductions INTEGER NOT NULL DEFAULT 0,
                total_net INTEGER NOT NULL DEFAULT 0,
                employee_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS hrms_payslips (
                id TEXT PRIMARY KEY,
                run_id TEXT REFERENCES hrms_payroll_runs(id),
                employee_id TEXT REFERENCES hrms_employees(id),
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                days_in_month INTEGER NOT NULL DEFAULT 30,
                days_worked INTEGER NOT NULL DEFAULT 30,
                gross_pay INTEGER NOT NULL DEFAULT 0,
                basic INTEGER NOT NULL DEFAULT 0,
                hra INTEGER NOT NULL DEFAULT 0,
                special_allowance INTEGER NOT NULL DEFAULT 0,
                pf_deduction INTEGER NOT NULL DEFAULT 0,
                pt_deduction INTEGER NOT NULL DEFAULT 0,
                tds_deduction INTEGER NOT NULL DEFAULT 0,
                total_deductions INTEGER NOT NULL DEFAULT 0,
                net_pay INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'draft',
                dispatched_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS hrms_attendance (
                id TEXT PRIMARY KEY,
                employee_id TEXT REFERENCES hrms_employees(id),
                date TEXT NOT NULL,
                status TEXT NOT NULL,
                punch_in TEXT,
                punch_out TEXT,
                notes TEXT,
                UNIQUE(employee_id, date)
            );

            CREATE TABLE IF NOT EXISTS hrms_leaves (
                id TEXT PRIMARY KEY,
                employee_id TEXT REFERENCES hrms_employees(id),
                leave_type TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                days INTEGER NOT NULL DEFAULT 1,
                reason TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                reviewed_by TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_hrms_emp_dept ON hrms_employees(department, status);
            CREATE INDEX IF NOT EXISTS ix_hrms_payslips_emp ON hrms_payslips(employee_id, year, month);
            CREATE INDEX IF NOT EXISTS ix_hrms_attendance_date ON hrms_attendance(date);
            CREATE INDEX IF NOT EXISTS ix_hrms_leaves_emp ON hrms_leaves(employee_id, status);
            """
        )

        # Seed initial dummy/starter employees if table is empty
        cnt = conn.execute("SELECT COUNT(*) FROM hrms_employees").fetchone()[0]
        if cnt == 0:
            now = _utcnow()
            seed_emps = [
                (
                    "emp_1", "FH-001", "Arun Sharma", "arun.sharma@fundhorizon.com", "+91 98201 12345",
                    "Principal Wealth Strategist", "Wealth Advisory", "2023-04-01", "active",
                    "Debabrata Mukherjee", "ABCPS1234A", "100293847561", "HDFC Bank", "50100234918231", "HDFC0000123",
                    2400000, 100000, 50000, 50000, now, now
                ),
                (
                    "emp_2", "FH-002", "Priya Nair", "priya.nair@fundhorizon.com", "+91 98192 67890",
                    "Senior Research Analyst", "Research & Analytics", "2023-08-15", "active",
                    "Arun Sharma", "BPRPN5678B", "100984736251", "ICICI Bank", "001101928374", "ICIC0000011",
                    1500000, 62500, 31250, 31250, now, now
                ),
                (
                    "emp_3", "FH-003", "Rohan Verma", "rohan.verma@fundhorizon.com", "+91 98765 43210",
                    "Operations Specialist", "Operations", "2024-01-10", "active",
                    "Arun Sharma", "CPRPV9012C", "100473829104", "Axis Bank", "91401004827189", "UTIB0000914",
                    900000, 37500, 18750, 18750, now, now
                ),
                (
                    "emp_4", "FH-004", "Ananya Deshmukh", "ananya.d@fundhorizon.com", "+91 99203 11223",
                    "Client Relationship Manager", "Client Services", "2024-06-01", "probation",
                    "Arun Sharma", "DPRAD3456D", "100674829105", "Kotak Mahindra Bank", "4019283746", "KKBK0000401",
                    1200000, 50000, 25000, 25000, now, now
                ),
            ]
            conn.executemany(
                """
                INSERT INTO hrms_employees (
                    id, emp_code, name, email, phone, designation, department, joining_date,
                    status, manager_name, pan, uan, bank_name, bank_account, bank_ifsc,
                    ctc, basic, hra, special_allowance, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                seed_emps,
            )


def calculate_salary_breakdown(annual_ctc: int) -> dict[str, int]:
    """Calculate monthly earnings and statutory deductions from annual CTC (in INR)."""
    monthly_gross = int(annual_ctc / 12) if annual_ctc > 0 else 0
    basic = int(monthly_gross * 0.50)
    hra = int(basic * 0.50)
    special_allowance = max(0, monthly_gross - basic - hra)
    # EPF: 12% of basic
    pf = int(basic * 0.12)
    # Professional tax: fixed standard ₹200/mo
    pt = 200 if monthly_gross > 15000 else 0
    # Simplified estimated TDS based on annual bracket (approx 5-10% above threshold)
    tds = 0
    if annual_ctc > 1200000:
        tds = int((monthly_gross * 0.10))
    elif annual_ctc > 700000:
        tds = int((monthly_gross * 0.05))

    total_deductions = pf + pt + tds
    net_pay = max(0, monthly_gross - total_deductions)

    return {
        "monthly_gross": monthly_gross,
        "basic": basic,
        "hra": hra,
        "special_allowance": special_allowance,
        "pf_deduction": pf,
        "pt_deduction": pt,
        "tds_deduction": tds,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
    }


# Initialize on import
try:
    init_hrms_tables()
except Exception:
    pass

