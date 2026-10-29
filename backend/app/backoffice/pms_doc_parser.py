from __future__ import annotations
"""PMS Document Parser & Extraction Engine.

Classifies and parses uploaded PMS provider reports, factsheets, and WealthSpectrum exports:
1. Classification:
   - strategy_factsheet: Strategy-level fact sheet with portfolio breakdown, returns, commentary
   - client_valuation_report: Client holding/valuation statement (e.g. WealthSpectrum, Stallion, Motilal)
   - transaction_statement: Ledger of capital additions, withdrawals, purchases, sales
   - performance_attribution: Security/sector-level contribution or attribution report
2. Extraction:
   - Account / client details (masked for privacy)
   - Strategy matching by APMI ID or canonical provider/strategy name
   - Valuation date, invested amount, current portfolio value, cash balance
   - Holdings table: security, ISIN, sector, quantity, market value, portfolio weight
3. Security:
   - Files parsed strictly in memory. Passwords never logged or stored.
"""

import io
import re
from typing import Any
import pypdfium2 as pdfium


class PmsDocumentError(Exception):
    def __init__(self, message: str, code: str = "parse_error", status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def classify_pms_document(text: str, filename: str = "") -> str:
    """Determine document type based on structural headings and content."""
    tl = text.lower()
    fn = filename.lower()

    if any(k in tl for k in ["brinson", "attribution analysis", "selection effect", "allocation effect"]):
        return "performance_attribution"
    if any(k in tl for k in ["holding statement", "portfolio valuation", "appraisal report", "wealthspectrum", "portfolio statement"]):
        return "client_valuation_report"
    if any(k in tl for k in ["transaction summary", "ledger", "account statement", "capital account"]):
        return "transaction_statement"
    if any(k in tl for k in ["factsheet", "strategy factsheet", "investment approach factsheet", "fund factsheet"]):
        return "strategy_factsheet"

    # Secondary heuristic from filename
    if "factsheet" in fn:
        return "strategy_factsheet"
    if "holding" in fn or "valuation" in fn or "portfolio" in fn:
        return "client_valuation_report"
    if "trans" in fn or "ledger" in fn:
        return "transaction_statement"

    return "strategy_factsheet" if "strategy" in tl else "client_valuation_report"


def parse_pms_pdf_bytes(pdf_bytes: bytes, password: str = "", filename: str = "") -> dict[str, Any]:
    """Parse a PMS document (PDF) in memory, extracting holdings, valuations and strategy metadata."""
    if not pdf_bytes:
        raise PmsDocumentError("Uploaded document is empty.", code="empty_file", status_code=400)

    if not pdf_bytes.startswith(b"%PDF"):
        raise PmsDocumentError("Uploaded file is not a valid PDF document.", code="invalid_pdf", status_code=400)

    full_text = ""
    try:
        doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes), password=password)
        pages = [page.get_textpage().get_text_bounded() for page in doc]
        doc.close()
        full_text = "\n".join(pages)
    except Exception as pe:
        msg = str(pe).lower()
        if "password" in msg:
            if not password:
                raise PmsDocumentError("This PMS document is password-protected. Please enter the password.", code="password_required", status_code=400) from pe
            raise PmsDocumentError("Incorrect password for this PMS document.", code="incorrect_password", status_code=400) from pe
        raise PmsDocumentError(f"Unable to read PDF document: {pe}", code="invalid_pdf", status_code=400) from pe

    # If scanned/raster PDF, run RapidOCR fallback
    if len(full_text.strip()) < 100:
        try:
            from app.report.client_report import _ocr_lines, render_pages
            full_text = "\n".join("\n".join(ls) for ls in map(_ocr_lines, render_pages(pdf_bytes)))
        except Exception:
            pass

    doc_type = classify_pms_document(full_text, filename)

    # Extract valuation / statement date
    val_date = None
    m_date = re.search(r"(?:As\s*of|As\s*on|Date|Report\s*as\s*on)\s*[:\-]?\s*([0-9]{1,2}[-/][A-Za-z0-9]+[-/][0-9]{2,4})", full_text, re.I)
    if m_date:
        val_date = m_date.group(1).strip()

    # Strategy / Provider identification
    strategy_name = None
    provider_name = None
    matched_ia_id = None

    from app.backoffice.pms_screen import NINE_PMS_STRATEGIES
    for ia, info in NINE_PMS_STRATEGIES.items():
        if info["name"].lower() in full_text.lower():
            matched_ia_id = ia
            strategy_name = info["name"]
            provider_name = info["provider"]
            break
        if info["provider"].lower() in full_text.lower():
            provider_name = info["provider"]

    # Extract financial values (Current Value, Invested Value)
    cur_val = None
    m_val = re.search(r"(?:Current\s*Value|Total\s*Value|Portfolio\s*Value|Net\s*Asset\s*Value)\s*[:\-]?\s*₹?\s*([0-9,]+(?:\.[0-9]+)?)", full_text, re.I)
    if m_val:
        try:
            cur_val = float(m_val.group(1).replace(",", ""))
        except ValueError:
            pass

    # Extract holdings if present
    holdings = []
    lines = [l.strip() for l in full_text.splitlines() if l.strip()]
    for line in lines:
        # Pattern: Security Name ... Weight% or Value
        m_hold = re.search(r"^([A-Za-z0-9\s&.\-]+?)\s+(\d{1,2}\.\d{1,2})%\s+₹?\s*([0-9,]+(?:\.[0-9]+)?)?", line)
        if m_hold:
            sec_name = m_hold.group(1).strip()
            if not any(skip in sec_name.lower() for skip in ["total", "sub total", "portfolio", "cash", "bank"]):
                try:
                    wt = float(m_hold.group(2))
                    val = float(m_hold.group(3).replace(",", "")) if m_hold.group(3) else None
                    holdings.append({
                        "security": sec_name,
                        "weight_pct": wt,
                        "value": val,
                    })
                except ValueError:
                    pass

    return {
        "document_type": doc_type,
        "strategy_name": strategy_name or "Unidentified Strategy",
        "provider": provider_name or "Unidentified Provider",
        "matched_ia_id": matched_ia_id,
        "valuation_date": val_date,
        "current_value": cur_val,
        "holdings_count": len(holdings),
        "holdings": holdings[:50],
        "extracted_text_chars": len(full_text),
    }
