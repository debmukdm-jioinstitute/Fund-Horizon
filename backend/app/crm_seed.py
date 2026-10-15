"""CRM seed data for Fund Horizon Backoffice.
Ensures rich, realistic Indian HNI data for households, contacts, holdings,
SIPs, leads, opportunities, activities, and cases.
Idempotent: skips if households or leads already exist.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.api.auth import _hash_password
from app.db import sqlite
from app.models.crm_core import (
    ActivityModel,
    CaseModel,
    ContactModel,
    HouseholdMemberModel,
    HouseholdModel,
    LeadModel,
    OpportunityModel,
)
from app.models.crm_phase3 import HoldingModel, SipScheduleModel
from app.repo_crm_core import _session

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _future_date(days: int) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).strftime("%Y-%m-%d")


def seed_crm_if_empty() -> None:
    """Populate default CRM records if database is empty."""
    with _session() as s:
        hh_count = s.scalar(select(HouseholdModel.id).limit(1))
        lead_count = s.scalar(select(LeadModel.id).limit(1))
        if hh_count or lead_count:
            return

    logger.info("Seeding initial CRM dataset...")
    now_str = _now()
    dummy_ph = _hash_password("FundHorizon@2026")

    # 1. Staff Members (Advisors / RMs)
    def ensure_staff(email: str, name: str, role: str, mobile: str) -> str:
        existing = sqlite.get_customer_by_email(email)
        if existing:
            return existing["id"]
        c = sqlite.create_customer(
            name=name,
            email=email,
            mobile=mobile,
            password_hash=dummy_ph,
            role=role,
        )
        sqlite.update_customer(c['id'], {'is_staff': 1})
        return c["id"]

    admin_id = ensure_staff("admin@fundhorizon.internal", "Fund Horizon Admin", "admin", "9800000001")
    rm1_id = ensure_staff("rajesh.varma@fundhorizon.internal", "Rajesh Varma", "rm", "9800000002")
    rm2_id = ensure_staff("anita.desai@fundhorizon.internal", "Anita Desai", "rm", "9800000003")

    def ensure_customer(name: str, email: str, mobile: str, role: str = "customer", rm_id: str | None = None) -> str:
        existing = sqlite.get_customer_by_email(email)
        if existing:
            return existing["id"]
        try:
            c = sqlite.create_customer(name=name, email=email, mobile=mobile, password_hash=dummy_ph, role=role, assigned_rm_id=rm_id)
            return c["id"]
        except Exception:
            conn = sqlite.get_default_connection()
            row = conn.execute("SELECT id FROM customers WHERE email = ? OR mobile = ?", (email, mobile)).fetchone()
            return row[0] if row else str(uuid.uuid4())

    with _session() as s:
        # 2. Households & Contacts
        h_sharma_id = str(uuid.uuid4())
        c_vikram_id = str(uuid.uuid4())

        s.add(HouseholdModel(
            id=h_sharma_id,
            name="Sharma Family Office",
            primary_customer_id=c_vikram_id,
            rm_id=rm1_id,
            notes="Mumbai HNI family. Multi-generation wealth with allocation across PMS & Large Cap funds.",
            created_at=now_str,
            created_by=admin_id,
        ))

        # Customers & Contacts for Sharma
        v_cust_id = ensure_customer("Vikram Sharma", "vikram.sharma@sharmagroup.in", "9820112233", "customer", rm1_id)

        s.add(ContactModel(
            id=c_vikram_id,
            customer_id=v_cust_id,
            household_id=h_sharma_id,
            relation="self",
            tax_status="resident",
            nominee_name="Sunita Sharma",
            nominee_relation="spouse",
            nominee_pct=100,
            fatca_crs="resident_india_only",
            kyc_expiry="2028-12-31",
            created_at=now_str,
        ))
        s.add(HouseholdMemberModel(
            id=str(uuid.uuid4()),
            household_id=h_sharma_id,
            customer_id=v_cust_id,
            role="primary",
        ))

        # Holdings for Vikram Sharma (Platinum Tier: ₹24.5 Cr total = 2,450,000,000 paise)
        s.add(HoldingModel(
            id=str(uuid.uuid4()),
            contact_id=c_vikram_id,
            folio="FOLIO-SHARMA-01",
            scheme_code="108466",
            scheme_name="ICICI Prudential Large Cap Fund - Direct Plan",
            units=125000.0,
            cost_paise=1200000000,  # ₹12 Cr
            as_of="2026-10-14",
            source="cams",
            created_at=now_str,
            created_by=admin_id,
        ))
        s.add(HoldingModel(
            id=str(uuid.uuid4()),
            contact_id=c_vikram_id,
            folio="FOLIO-SHARMA-02",
            scheme_code="150799",
            scheme_name="WhiteOak Capital Large Cap Fund",
            units=85000.0,
            cost_paise=1250000000,  # ₹12.5 Cr
            as_of="2026-10-14",
            source="kfin",
            created_at=now_str,
            created_by=admin_id,
        ))

        # SIP Schedule for Vikram Sharma (₹1,50,000/mo)
        s.add(SipScheduleModel(
            id=str(uuid.uuid4()),
            contact_id=c_vikram_id,
            scheme_code="108466",
            scheme_name="ICICI Prudential Large Cap Fund",
            type="sip",
            amount_paise=15000000,  # ₹1.5L
            day=10,
            start_date="2024-04-10",
            status="active",
            created_at=now_str,
            created_by=admin_id,
        ))

        # 3. Patel Wealth Trust (Gold/Platinum)
        h_patel_id = str(uuid.uuid4())
        c_kirit_id = str(uuid.uuid4())
        s.add(HouseholdModel(
            id=h_patel_id,
            name="Patel Wealth Trust",
            primary_customer_id=c_kirit_id,
            rm_id=rm2_id,
            notes="Ahmedabad industrialist family. Focus on Multi-Asset allocation and capital preservation.",
            created_at=now_str,
            created_by=admin_id,
        ))
        k_cust_id = ensure_customer("Kirit Patel", "kirit.patel@patelholdings.com", "9825012345", "customer", rm2_id)

        s.add(ContactModel(
            id=c_kirit_id,
            customer_id=k_cust_id,
            household_id=h_patel_id,
            relation="self",
            tax_status="resident",
            nominee_name="Hansa Patel",
            nominee_relation="spouse",
            nominee_pct=100,
            fatca_crs="resident_india_only",
            kyc_expiry="2027-08-15",
            created_at=now_str,
        ))
        s.add(HouseholdMemberModel(
            id=str(uuid.uuid4()),
            household_id=h_patel_id,
            customer_id=k_cust_id,
            role="primary",
        ))
        s.add(HoldingModel(
            id=str(uuid.uuid4()),
            contact_id=c_kirit_id,
            folio="FOLIO-PATEL-01",
            scheme_code="152053",
            scheme_name="DSP Multi Asset Allocation Fund",
            units=45000.0,
            cost_paise=850000000,
            as_of="2026-10-14",
            source="cams",
            created_at=now_str,
            created_by=admin_id,
        ))

        # 4. Singhania Family (Gold Tier: ₹9.8 Cr)
        h_singhania_id = str(uuid.uuid4())
        c_gautam_id = str(uuid.uuid4())
        s.add(HouseholdModel(
            id=h_singhania_id,
            name="Singhania Family",
            primary_customer_id=c_gautam_id,
            rm_id=rm1_id,
            notes="Delhi NCR business family. Active in Small Cap & Mid Cap strategies.",
            created_at=now_str,
            created_by=admin_id,
        ))
        s_cust_id = ensure_customer("Gautam Singhania", "gautam@singhaniaholdings.in", "9811098765", "customer", rm1_id)

        s.add(ContactModel(
            id=c_gautam_id,
            customer_id=s_cust_id,
            household_id=h_singhania_id,
            relation="self",
            tax_status="resident",
            nominee_name="Radhika Singhania",
            nominee_relation="spouse",
            nominee_pct=100,
            fatca_crs="resident_india_only",
            kyc_expiry="2029-01-01",
            created_at=now_str,
        ))
        s.add(HouseholdMemberModel(
            id=str(uuid.uuid4()),
            household_id=h_singhania_id,
            customer_id=s_cust_id,
            role="primary",
        ))
        s.add(HoldingModel(
            id=str(uuid.uuid4()),
            contact_id=c_gautam_id,
            folio="FOLIO-SINGHANIA-01",
            scheme_code="145139",
            scheme_name="Invesco India Small Cap Fund",
            units=60000.0,
            cost_paise=980000000,
            as_of="2026-10-14",
            source="kfin",
            created_at=now_str,
            created_by=admin_id,
        ))
        s.add(SipScheduleModel(
            id=str(uuid.uuid4()),
            contact_id=c_gautam_id,
            scheme_code="145139",
            scheme_name="Invesco India Small Cap Fund",
            type="sip",
            amount_paise=25000000,  # ₹2.5L/mo
            day=5,
            start_date="2025-01-05",
            status="active",
            created_at=now_str,
            created_by=admin_id,
        ))

        # 5. Mehta Holdings (Silver/Gold)
        h_mehta_id = str(uuid.uuid4())
        s.add(HouseholdModel(
            id=h_mehta_id,
            name="Mehta Holdings",
            primary_customer_id=None,
            rm_id=rm2_id,
            notes="Bangalore tech executives. Corporate FDs and PMS compounder mandates.",
            created_at=now_str,
            created_by=admin_id,
        ))

        # 6. Leads (All data points requested)
        leads_data = [
            ("Priya Nair", "priya.nair@corp.in", "9820144552", "website", "new", rm1_id, "Looking to deploy ₹50L surplus into Multicap & PMS"),
            ("Rajesh Malhotra", "rajesh.malhotra@zenith.com", "9819233441", "referral", "contacted", rm1_id, "Referred by Vikram Sharma. Wants retirement portfolio review."),
            ("Ananya Sen", "ananya.sen@gmail.com", "9930887123", "sip_calculator", "qualified", rm2_id, "Plans ₹2 Lakhs/month SIP across Flexicap and Smallcap."),
            ("Kavita Reddy", "kavita.reddy@techventures.io", "9845012345", "qr_code", "new", rm2_id, "Scanned QR code at wealth seminar. Interested in PMS & corporate FD."),
            ("Aditya Birla", "aditya.birla@consulting.in", "9820011223", "website", "converted", rm1_id, "Converted to Singhania Family member account."),
            ("Nitin Gadgil", "nitin.gadgil@infratech.co", "9821456789", "other", "contacted", None, "HNI tax planning and capital gains bond investment."),
        ]
        created_leads = {}
        for name, email, mobile, source, status, rm, notes in leads_data:
            lid = str(uuid.uuid4())
            created_leads[name] = lid
            s.add(LeadModel(
                id=lid,
                name=name,
                email=email,
                mobile=mobile,
                source=source,
                status=status,
                assigned_rm_id=rm,
                notes=notes,
                created_at=now_str,
                created_by=admin_id,
            ))

        # 7. Opportunities
        opps = [
            (h_sharma_id, v_cust_id, "pms", "Sharma Family - Large Cap & Focused PMS Allocation", 1500000000, "agreement_signed", 90, rm1_id, "Agreement draft shared for 1.5 Cr mandate."),
            (h_patel_id, k_cust_id, "mutual_fund", "Patel Wealth - Multi-Asset Allocation Scheme", 500000000, "invested", 100, rm2_id, "Lumpsum deployment completed."),
            (h_singhania_id, s_cust_id, "mutual_fund", "Singhania Family - Monthly SIP Mandate ₹2.5L", 300000000, "sip_active", 95, rm1_id, "Mandate registered with ICICI Bank."),
            (h_mehta_id, None, "corporate_fd", "Mehta Holdings - Bajaj Finance AAA Corporate FD", 1000000000, "booked", 100, rm2_id, "3-year cumulative deposit booked."),
            (None, None, "mutual_fund", "Priya Nair - Small Cap & Flexicap Strategy", 400000000, "illustration", 40, rm1_id, "Comparison with benchmark quartiles sent."),
            (None, None, "pms", "Rajesh Malhotra - Retirement PMS Advisory", 750000000, "discussion", 60, rm1_id, "Risk profiling completed, moderate growth orientation."),
            (None, None, "corporate_fd", "Kavita Reddy - Corporate Fixed Deposit & Term Life", 250000000, "proposed", 50, rm2_id, "Inquiry from QR intake form."),
        ]
        for h_id, c_id, line, title, amt, stage, prob, rm, notes in opps:
            s.add(OpportunityModel(
                id=str(uuid.uuid4()),
                household_id=h_id,
                customer_id=c_id,
                product_line=line,
                title=title,
                amount=amt,
                stage=stage,
                probability=prob,
                expected_close=_future_date(30),
                assigned_rm_id=rm,
                notes=notes,
                created_at=now_str,
                updated_at=now_str,
                created_by=admin_id,
            ))

        # 8. Activities / Tasks
        s.add(ActivityModel(
            id=str(uuid.uuid4()),
            kind="meeting",
            subject="Quarterly Portfolio Review - Sharma Family",
            body="Review Q3 PMS performance vs Nifty 50 TRI benchmark with Vikram Sharma.",
            household_id=h_sharma_id,
            customer_id=v_cust_id,
            due_at=_future_date(3),
            assigned_rm_id=rm1_id,
            created_at=now_str,
            created_by=admin_id,
        ))
        s.add(ActivityModel(
            id=str(uuid.uuid4()),
            kind="call",
            subject="Follow-up Call: Priya Nair (QR Lead)",
            body="Discuss Multi-cap asset allocation proposal and tax harvesting.",
            lead_id=created_leads.get("Priya Nair"),
            due_at=_future_date(1),
            assigned_rm_id=rm1_id,
            created_at=now_str,
            created_by=admin_id,
        ))
        s.add(ActivityModel(
            id=str(uuid.uuid4()),
            kind="note",
            subject="KYC Re-verification Completed - Kirit Patel",
            body="Aadhaar OTP based re-KYC successfully submitted to CVL KRA.",
            household_id=h_patel_id,
            customer_id=k_cust_id,
            done_at=now_str,
            assigned_rm_id=rm2_id,
            created_at=now_str,
            created_by=admin_id,
        ))

        # 9. Cases
        s.add(CaseModel(
            id=str(uuid.uuid4()),
            customer_id=v_cust_id,
            category="mandate",
            subject="Bank NACH Mandate Registration for ICICI Bank",
            body="Increase daily e-mandate limit to ₹5,00,000 for upcoming SIP step-ups.",
            status="open",
            sla_due_at=_future_date(2),
            created_at=now_str,
            created_by=admin_id,
        ))
        s.add(CaseModel(
            id=str(uuid.uuid4()),
            customer_id=k_cust_id,
            category="nominee",
            subject="Nominee Update - Hansa Patel",
            body="Add secondary nominee for folio FOLIO-PATEL-01.",
            status="resolved",
            sla_due_at=_future_date(1),
            resolved_at=now_str,
            created_at=now_str,
            created_by=admin_id,
        ))

    logger.info("Successfully seeded CRM dataset with households, leads, and opportunities.")
