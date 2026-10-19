"""Tests for Operations module PDF generation and status."""
from __future__ import annotations

import re
from app.report.operations_doc import build_operations_form_pdf


def test_build_operations_form_pdf_google_sans():
    """Verify operations PDF generates cleanly and only embeds Google Sans."""
    sample_payload = {
        "form_id": "bank_change",
        "title": "Change of Bank Mandate Form",
        "repository": "CAMS",
        "category": "Old Client",
        "form_code": "CAMS-SR-BNK-01",
        "investor_name": "Rajesh Kumar",
        "pan": "ABCDE1234F",
        "dob": "15/08/1985",
        "mobile": "+91 98765 43210",
        "email": "rajesh.kumar@example.com",
        "tax_status": "Resident Individual",
        "ckyc": "10023456789012",
        "address": "402, High Point Apartments, Worli, Mumbai 400018",
        "folio_number": "1029384756",
        "amc_name": "HDFC Mutual Fund",
        "scheme_name": "HDFC Flexi Cap Fund - Growth",
        "details": {
            "new_bank_name": "HDFC Bank Ltd",
            "new_account_number": "50100234567890",
            "new_account_type": "Savings",
            "new_ifsc": "HDFC0000123",
            "new_branch": "Worli, Mumbai",
            "old_bank_name": "State Bank of India",
            "old_account_number": "30129847561",
            "proof_attached": "Original Cancelled Cheque with name pre-printed",
        },
    }

    pdf_bytes = build_operations_form_pdf(sample_payload)
    assert len(pdf_bytes) > 5000
    assert pdf_bytes.startswith(b"%PDF")

    # Verify embedded fonts only contain GoogleSans
    base_fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf_bytes)}
    assert base_fonts, "expected embedded fonts in the PDF"
    assert all(f.startswith("GoogleSans") for f in base_fonts), f"Non-GoogleSans fonts found: {base_fonts}"
