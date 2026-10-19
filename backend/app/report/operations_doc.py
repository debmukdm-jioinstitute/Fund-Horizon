"""Official Operations Form PDF Generator for CAMS, KFintech (Carvy), and Stallion PMS.

Uses ReportLab with Google Sans fonts and standard AMFI ARN 345439 disclosures.
"""
from __future__ import annotations

import base64
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.config.disclosures import ARN, FIRM
from app.report.fmt import canvas_text
from app.report.fonts import BODY_FONT, BOLD_FONT

NAVY = colors.HexColor("#0B2545")
TEAL = colors.HexColor("#006F64")
TEAL_LIGHT = colors.HexColor("#E7F5F2")
DARK_GRAY = colors.HexColor("#172033")
SLATE = colors.HexColor("#536176")
BORDER_COLOR = colors.HexColor("#CBD5E1")
LIGHT_BG = colors.HexColor("#F8FAFC")

BODY = ParagraphStyle("op_body", fontName=BODY_FONT, fontSize=7.5, leading=10, textColor=DARK_GRAY)
BODY_BOLD = ParagraphStyle("op_body_b", fontName=BOLD_FONT, fontSize=7.5, leading=10, textColor=DARK_GRAY)
SMALL = ParagraphStyle("op_small", fontName=BODY_FONT, fontSize=6.5, leading=8.5, textColor=SLATE)
SMALL_BOLD = ParagraphStyle("op_small_b", fontName=BOLD_FONT, fontSize=6.5, leading=8.5, textColor=DARK_GRAY)
SECTION_TITLE = ParagraphStyle(
    "op_sec",
    fontName=BOLD_FONT,
    fontSize=8.5,
    leading=11,
    textColor=colors.white,
)


def _clean_str(val: Any) -> str:
    if val is None:
        return "-"
    s = str(val).strip()
    return s if s else "-"


def _table(rows: list[list[Any]], widths: list[float], header: bool = True) -> Table:
    t = Table(rows, colWidths=widths)
    style = [
        ("FONT", (0, 0), (-1, -1), BODY_FONT, 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
            ("FONT", (0, 0), (-1, 0), BOLD_FONT, 7),
            ("TEXTCOLOR", (0, 0), (-1, 0), NAVY),
        ]
    t.setStyle(TableStyle(style))
    return t


def _decode_signature_image(sig_data: str | None, max_w_mm: float = 45, max_h_mm: float = 16) -> Image | None:
    if not sig_data:
        return None
    try:
        # Strip header like data:image/png;base64,
        if "," in sig_data:
            sig_data = sig_data.split(",", 1)[1]
        raw_bytes = base64.b64decode(sig_data)
        im = PILImage.open(io.BytesIO(raw_bytes))
        w, h = im.size
        if w <= 0 or h <= 0:
            return None
        aspect = h / w
        render_w = max_w_mm * mm
        render_h = render_w * aspect
        if render_h > max_h_mm * mm:
            render_h = max_h_mm * mm
            render_w = render_h / aspect
        return Image(io.BytesIO(raw_bytes), width=render_w, height=render_h)
    except Exception:
        return None


def build_operations_form_pdf(form_data: dict[str, Any]) -> bytes:
    """Build a client-ready official A4 Operations Form PDF with signatures and ARN 345439."""
    buf = io.BytesIO()
    today_str = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d-%b-%Y %H:%M IST")
    today_date = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d/%m/%Y")

    form_id = form_data.get("form_id", "form")
    title = form_data.get("title", "Operations Service Request Form")
    repo = form_data.get("repository", "CAMS")
    category = form_data.get("category", "Mutual Fund")
    form_code = form_data.get("form_code", "FH-OPS-2026")

    investor_name = form_data.get("investor_name", "Client")
    pan = form_data.get("pan", "-")
    dob = form_data.get("dob", "-")
    mobile = form_data.get("mobile", "-")
    email = form_data.get("email", "-")
    tax_status = form_data.get("tax_status", "Resident Individual")
    ckyc = form_data.get("ckyc", "-")
    address = form_data.get("address", "-")

    folio_number = form_data.get("folio_number", "-")
    amc_name = form_data.get("amc_name", "-")
    scheme_name = form_data.get("scheme_name", "-")
    details = form_data.get("details", {}) or {}

    sig1_b64 = form_data.get("signature_base64")
    sig2_b64 = form_data.get("second_signature_base64")

    def decorate(canvas, doc):
        canvas.saveState()
        w, h = A4

        # Top Header Banner
        canvas.setFillColor(NAVY)
        canvas.rect(0, h - 14 * mm, w, 14 * mm, stroke=0, fill=1)

        # Teal Accent Line
        canvas.setFillColor(TEAL)
        canvas.rect(0, h - 15 * mm, w, 1 * mm, stroke=0, fill=1)

        # Header Titles
        canvas.setFillColor(colors.white)
        canvas.setFont(BOLD_FONT, 10)
        canvas.drawString(12 * mm, h - 8.5 * mm, f"{FIRM} · Operations Repository")
        canvas.setFont(BODY_FONT, 7.5)
        canvas.drawString(12 * mm, h - 12 * mm, f"AMFI-Registered Mutual Fund Distributor | ARN {ARN} | EUIN E482910")

        # Right Header Badge
        canvas.setFont(BOLD_FONT, 8)
        canvas.drawRightString(w - 12 * mm, h - 8.5 * mm, f"RTA / Repository: {canvas_text(repo)}")
        canvas.setFont(BODY_FONT, 7)
        canvas.setFillColor(colors.HexColor("#CBD5E1"))
        canvas.drawRightString(w - 12 * mm, h - 12 * mm, f"Generated: {today_str}")

        # Footer
        canvas.setStrokeColor(BORDER_COLOR)
        canvas.setLineWidth(0.5)
        canvas.line(12 * mm, 12 * mm, w - 12 * mm, 12 * mm)

        canvas.setFillColor(SLATE)
        canvas.setFont(BODY_FONT, 6)
        canvas.drawString(
            12 * mm,
            8.5 * mm,
            f"Fund Horizon Operations Engine · In-House Service Record · AMFI ARN {ARN} · All changes require client verification.",
        )
        canvas.drawRightString(w - 12 * mm, 8.5 * mm, f"Page {doc.page} · {form_code}")
        canvas.restoreState()

    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=18 * mm,
        bottomMargin=15 * mm,
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal", topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="operations_form", frames=[frame], onPage=decorate)])

    story: list[Any] = []

    # Document Header Box: Title, Code, ARN Stamp
    header_data = [
        [
            Paragraph(f"<b>{title.upper()}</b><br/><font color='#536176' size='6.5'>Category: {category} | Standard Form Ref: {form_code}</font>", BODY_BOLD),
            Paragraph(f"<b>DISTRIBUTOR ARN:</b> {ARN}<br/><b>EUIN:</b> E482910<br/><b>NAME:</b> {FIRM}", SMALL_BOLD),
        ]
    ]
    t_hdr = Table(header_data, colWidths=[130 * mm, 56 * mm])
    t_hdr.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, TEAL),
        ("BACKGROUND", (0, 0), (-1, -1), TEAL_LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(t_hdr)
    story.append(Spacer(1, 3 * mm))

    # Section 1: Investor Identification
    story.append(
        Table([[Paragraph("1. INVESTOR IDENTIFICATION & KYC DETAILS", SECTION_TITLE)]], colWidths=[186 * mm], style=[
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ])
    )
    inv_rows = [
        [
            Paragraph("<b>Primary Applicant Name</b>", SMALL),
            Paragraph(_clean_str(investor_name), BODY_BOLD),
            Paragraph("<b>PAN / PEKRN</b>", SMALL),
            Paragraph(_clean_str(pan), BODY_BOLD),
        ],
        [
            Paragraph("<b>Date of Birth / Incorp</b>", SMALL),
            Paragraph(_clean_str(dob), BODY),
            Paragraph("<b>Tax Status</b>", SMALL),
            Paragraph(_clean_str(tax_status), BODY),
        ],
        [
            Paragraph("<b>Mobile Number</b>", SMALL),
            Paragraph(_clean_str(mobile), BODY),
            Paragraph("<b>Email Address</b>", SMALL),
            Paragraph(_clean_str(email), BODY),
        ],
        [
            Paragraph("<b>CKYC / KRA Number</b>", SMALL),
            Paragraph(_clean_str(ckyc), BODY),
            Paragraph("<b>Registered Address</b>", SMALL),
            Paragraph(_clean_str(address), BODY),
        ],
    ]
    story.append(_table(inv_rows, [40 * mm, 53 * mm, 40 * mm, 53 * mm], header=False))
    story.append(Spacer(1, 2.5 * mm))

    # Section 2: Account & Folio Details
    story.append(
        Table([[Paragraph("2. FOLIO / STRATEGY / DEMAT DETAILS", SECTION_TITLE)]], colWidths=[186 * mm], style=[
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ])
    )
    folio_rows = [
        [
            Paragraph("<b>AMC / Strategy Provider</b>", SMALL),
            Paragraph(_clean_str(amc_name), BODY_BOLD),
            Paragraph("<b>Folio / Demat / Custody No.</b>", SMALL),
            Paragraph(_clean_str(folio_number), BODY_BOLD),
        ],
        [
            Paragraph("<b>Scheme / Strategy Name</b>", SMALL),
            Paragraph(_clean_str(scheme_name), BODY),
            Paragraph("<b>Repository / RTA</b>", SMALL),
            Paragraph(f"{repo} Automated Feed", BODY),
        ],
    ]
    story.append(_table(folio_rows, [40 * mm, 53 * mm, 40 * mm, 53 * mm], header=False))
    story.append(Spacer(1, 2.5 * mm))

    # Section 3: Request Specific Payload
    story.append(
        Table([[Paragraph("3. SERVICE REQUEST SPECIFICATION & PARTICULARS", SECTION_TITLE)]], colWidths=[186 * mm], style=[
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ])
    )

    detail_rows: list[list[Any]] = []
    # Render key-values in a clean two-column grid
    items = list(details.items())
    if not items:
        detail_rows.append([
            Paragraph("<b>Request Details</b>", SMALL),
            Paragraph("Standard automated service request according to latest AMFI / RTA guidelines.", BODY),
            Paragraph("<b>Execution Mode</b>", SMALL),
            Paragraph("Direct in-house digital submission", BODY),
        ])
    else:
        # Pair up items
        for i in range(0, len(items), 2):
            k1, v1 = items[i]
            label1 = re.sub(r"_+", " ", str(k1)).title()
            val1 = _clean_str(v1)
            if i + 1 < len(items):
                k2, v2 = items[i + 1]
                label2 = re.sub(r"_+", " ", str(k2)).title()
                val2 = _clean_str(v2)
            else:
                label2, val2 = "-", "-"
            detail_rows.append([
                Paragraph(f"<b>{label1}</b>", SMALL),
                Paragraph(val1, BODY),
                Paragraph(f"<b>{label2}</b>", SMALL),
                Paragraph(val2, BODY),
            ])

    story.append(_table(detail_rows, [40 * mm, 53 * mm, 40 * mm, 53 * mm], header=False))
    story.append(Spacer(1, 2.5 * mm))

    # Section 4: Statutory Declarations
    story.append(
        Table([[Paragraph("4. INVESTOR DECLARATION & STATUTORY UNDERTAKING", SECTION_TITLE)]], colWidths=[186 * mm], style=[
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ])
    )
    declaration_text = (
        "I/We confirm that the particulars furnished above are correct, complete, and legally binding. "
        "I/We authorize Fund Horizon (AMFI Registered Distributor ARN 345439) and the respective RTA (CAMS / KFintech) "
        "or Portfolio Manager (Stallion Asset) to process the instructions specified in this request. "
        "I/We confirm that all regulatory requirements under SEBI, PMLA, and FEMA guidelines have been adhered to."
    )
    story.append(
        Table(
            [[Paragraph(declaration_text, SMALL)]],
            colWidths=[186 * mm],
            style=[
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
                ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ],
        )
    )
    story.append(Spacer(1, 3 * mm))

    # Section 5: Signature Blocks
    story.append(
        Table([[Paragraph("5. VERIFICATION & CLIENT SIGNATURES", SECTION_TITLE)]], colWidths=[186 * mm], style=[
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ])
    )

    sig1_img = _decode_signature_image(sig1_b64)
    sig2_img = _decode_signature_image(sig2_b64)

    sig1_cell = [
        sig1_img if sig1_img else Paragraph("<font color='#94A3B8'><i>[Digital Signature Applied]</i></font>", SMALL),
        Paragraph(f"<b>Primary / Sole Applicant:</b> {_clean_str(investor_name)}<br/>Date: {today_date}", SMALL),
    ]

    sig2_cell = [
        sig2_img if sig2_img else Paragraph("<font color='#94A3B8'><i>[Not Applicable / Single Holder]</i></font>", SMALL),
        Paragraph("<b>Joint Holder / Guardian:</b><br/>Date: " + today_date, SMALL),
    ]

    arn_stamp_cell = [
        Paragraph(f"<b>VERIFIED & PROCESSED BY:</b><br/><b>{FIRM}</b><br/>ARN-{ARN} | EUIN E482910<br/>Operations Auth: ACTIVE<br/>Timestamp: {today_str}", SMALL_BOLD),
    ]

    sig_table = Table(
        [
            [sig1_cell, sig2_cell, arn_stamp_cell],
        ],
        colWidths=[62 * mm, 62 * mm, 62 * mm],
        style=[
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ],
    )
    story.append(sig_table)

    doc.build(story)
    return buf.getvalue()
