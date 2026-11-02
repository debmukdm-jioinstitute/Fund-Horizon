from __future__ import annotations
"""HRMS document generation: Offer Letters, Termination Letters, Promotion Letters,
Relieving/Experience Certificates, and Monthly Salary Slips using ReportLab and Google Sans."""

import io
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.report.fonts import BODY_FONT, BOLD_FONT, register

# Ensure Google Sans fonts are registered
try:
    register()
except Exception:
    pass

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
LOGO_PATH = ASSETS_DIR / "fund-horizon-logo.png"
STAMP_PATH = ASSETS_DIR / "signature_stamp.png"

PRIMARY_COLOR = colors.HexColor("#0176D3")
DARK_NAVY = colors.HexColor("#0D1B2A")
TEXT_MUTED = colors.HexColor("#5A6A80")
BORDER_COLOR = colors.HexColor("#E2E8F0")
BG_LIGHT = colors.HexColor("#F8FAFC")
ACCENT_GREEN = colors.HexColor("#0D8A56")

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]


def _format_inr(v: int | float | None) -> str:
    """Format number in Indian numbering format: ₹1,50,000."""
    if v is None:
        return "₹0"
    n = int(v)
    neg = n < 0
    n = abs(n)
    s = str(n)
    if len(s) <= 3:
        res = s
    else:
        last3 = s[-3:]
        rem = s[:-3]
        groups = []
        while len(rem) > 2:
            groups.append(rem[-2:])
            rem = rem[:-2]
        if rem:
            groups.append(rem)
        groups.reverse()
        res = ",".join(groups) + "," + last3
    return ("-₹" if neg else "₹") + res


def _num_to_words(n: int) -> str:
    """Convert integer to Indian English words."""
    if n == 0:
        return "Zero"

    units = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen"
    ]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def _two_digits(val: int) -> str:
        if val < 20:
            return units[val]
        t = tens[val // 10]
        u = units[val % 10]
        return f"{t} {u}".strip()

    def _three_digits(val: int) -> str:
        h = val // 100
        rem = val % 100
        parts = []
        if h > 0:
            parts.append(f"{units[h]} Hundred")
        if rem > 0:
            if parts:
                parts.append("and")
            parts.append(_two_digits(rem))
        return " ".join(parts)

    parts = []
    crores = n // 10000000
    n %= 10000000
    if crores > 0:
        parts.append(f"{_three_digits(crores)} Crore")

    lakhs = n // 100000
    n %= 100000
    if lakhs > 0:
        parts.append(f"{_three_digits(lakhs)} Lakh")

    thousands = n // 1000
    n %= 1000
    if thousands > 0:
        parts.append(f"{_three_digits(thousands)} Thousand")

    if n > 0:
        parts.append(_three_digits(n))

    return " ".join(parts).strip()


def render_hrms_letter_pdf(
    letter_type: str,
    title: str,
    recipient: dict[str, Any],
    placeholders: dict[str, Any],
    content: str,
) -> bytes:
    """Generate official company letter PDF (Offer, Promotion, Termination, Relieving)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "LetterTitle",
        fontName=BOLD_FONT,
        fontSize=15,
        leading=19,
        textColor=DARK_NAVY,
        alignment=1,  # Center
    )
    meta_style = ParagraphStyle(
        "LetterMeta",
        fontName=BODY_FONT,
        fontSize=9.5,
        leading=14,
        textColor=TEXT_MUTED,
    )
    body_style = ParagraphStyle(
        "LetterBody",
        fontName=BODY_FONT,
        fontSize=10,
        leading=15,
        textColor=DARK_NAVY,
    )
    heading_style = ParagraphStyle(
        "LetterH2",
        fontName=BOLD_FONT,
        fontSize=11,
        leading=15,
        textColor=DARK_NAVY,
        spaceBefore=10,
        spaceAfter=4,
    )

    story: list[Any] = []

    # 1. Official Header
    logo_img = None
    if LOGO_PATH.exists():
        try:
            logo_img = RLImage(str(LOGO_PATH), width=42 * mm, height=13 * mm)
            logo_img.hAlign = "LEFT"
        except Exception:
            logo_img = None

    firm_info = Paragraph(
        f"<b>FUND HORIZON PRIVATE LIMITED</b><br/>"
        f"<font size=8 color='#5A6A80'>AMFI Registered Mutual Fund Distributor · ARN 345439<br/>"
        f"CIN: U67190MH2023PTC402918 · Mumbai, Maharashtra, India<br/>"
        f"hr@fundhorizon.com · www.fundhorizon.com</font>",
        meta_style,
    )

    header_table = Table(
        [[logo_img if logo_img else Paragraph("<b>FUND HORIZON</b>", title_style), firm_info]],
        colWidths=[48 * mm, 126 * mm],
    )
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ])
    )
    story.append(header_table)
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_COLOR, spaceAfter=5 * mm))

    # 2. Date and Reference
    today_str = datetime.now().strftime("%B %d, %Y")
    ref_no = f"FH/HR/{letter_type.upper()[:3]}/{datetime.now().strftime('%Y%m')}/{recipient.get('emp_code', 'APP-01')}"
    ref_table = Table(
        [[
            Paragraph(f"<b>Ref No:</b> {ref_no}", meta_style),
            Paragraph(f"<b>Date:</b> {placeholders.get('date', today_str)}", ParagraphStyle("DateStyle", parent=meta_style, alignment=2)),
        ]],
        colWidths=[87 * mm, 87 * mm],
    )
    story.append(ref_table)
    story.append(Spacer(1, 5 * mm))

    # 3. Recipient Details
    emp_name = placeholders.get("employee_name") or recipient.get("name", "Candidate")
    recip_lines = [
        f"<b>To,</b>",
        f"<b>{emp_name}</b>",
    ]
    if recipient.get("designation"):
        recip_lines.append(recipient["designation"])
    if recipient.get("email"):
        recip_lines.append(f"Email: {recipient['email']}")
    if recipient.get("phone"):
        recip_lines.append(f"Mobile: {recipient['phone']}")
    story.append(Paragraph("<br/>".join(recip_lines), body_style))
    story.append(Spacer(1, 6 * mm))

    # 4. Document Title
    doc_title = title.upper() if title else f"{letter_type.upper()} LETTER"
    story.append(Paragraph(f"<b><u>{doc_title}</u></b>", title_style))
    story.append(Spacer(1, 6 * mm))

    # 5. Letter Body (Replace dynamic placeholders in content)
    resolved_content = content
    for k, v in placeholders.items():
        resolved_content = resolved_content.replace(f"{{{{{k}}}}}", str(v))

    paragraphs = resolved_content.split("\n\n")
    for para in paragraphs:
        p_clean = para.strip()
        if not p_clean:
            continue
        if p_clean.startswith("### "):
            story.append(Paragraph(p_clean.replace("### ", ""), heading_style))
        elif p_clean.startswith("## "):
            story.append(Paragraph(p_clean.replace("## ", ""), heading_style))
        else:
            p_html = p_clean.replace("\n", "<br/>")
            story.append(Paragraph(p_html, body_style))
            story.append(Spacer(1, 3 * mm))

    # 6. Salary / CTC Schedule Table (if Offer or Promotion with CTC)
    ctc_val = placeholders.get("ctc") or recipient.get("ctc")
    if ctc_val and letter_type in ("offer", "promotion"):
        try:
            ctc_num = int(str(ctc_val).replace("₹", "").replace(",", "").strip())
        except ValueError:
            ctc_num = 0

        if ctc_num > 0:
            m_gross = ctc_num // 12
            basic = int(m_gross * 0.50)
            hra = int(basic * 0.50)
            sa = max(0, m_gross - basic - hra)
            pf = int(basic * 0.12)
            pt = 200

            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph("<b>Annexure A: Salary Breakdown & Compensation Structure</b>", heading_style))
            story.append(Spacer(1, 2 * mm))

            sal_rows = [
                ["Salary Component", "Monthly Amount (₹)", "Annual Amount (₹)"],
                ["Basic Salary (50%)", _format_inr(basic), _format_inr(basic * 12)],
                ["House Rent Allowance (HRA)", _format_inr(hra), _format_inr(hra * 12)],
                ["Special Allowance", _format_inr(sa), _format_inr(sa * 12)],
                ["Total Gross Pay", _format_inr(m_gross), _format_inr(ctc_num)],
                ["Statutory Provident Fund (EPF)", _format_inr(pf), _format_inr(pf * 12)],
                ["Professional Tax (PT)", _format_inr(pt), _format_inr(pt * 12)],
                ["Total Annual Cost to Company (CTC)", "", _format_inr(ctc_num)],
            ]
            sal_table = Table(sal_rows, colWidths=[80 * mm, 47 * mm, 47 * mm])
            sal_table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY_COLOR),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), BOLD_FONT),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, BG_LIGHT]),
                    ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
                    ("FONTNAME", (0, -1), (-1, -1), BOLD_FONT),
                ])
            )
            story.append(sal_table)
            story.append(Spacer(1, 4 * mm))

    # 7. Signature Block
    story.append(Spacer(1, 8 * mm))
    stamp_img = None
    if STAMP_PATH.exists():
        try:
            stamp_img = RLImage(str(STAMP_PATH), width=32 * mm, height=18 * mm)
            stamp_img.hAlign = "LEFT"
        except Exception:
            stamp_img = None

    sign_data = [
        [
            Paragraph("<b>For Fund Horizon Private Limited</b>", body_style),
            Paragraph("<b>Accepted & Acknowledged:</b>", body_style),
        ],
        [
            stamp_img if stamp_img else Spacer(1, 14 * mm),
            Spacer(1, 14 * mm),
        ],
        [
            Paragraph("<b>Authorized Signatory</b><br/>Human Resources & Compliance", meta_style),
            Paragraph(f"<b>{emp_name}</b><br/>Signature & Date", meta_style),
        ],
    ]
    sign_table = Table(sign_data, colWidths=[87 * mm, 87 * mm])
    sign_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(sign_table)

    doc.build(story)
    return buf.getvalue()


def render_payslip_pdf(emp: dict[str, Any], slip: dict[str, Any]) -> bytes:
    """Generate official corporate monthly payslip PDF with Indian formatting."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PayslipTitle",
        fontName=BOLD_FONT,
        fontSize=14,
        leading=18,
        textColor=DARK_NAVY,
        alignment=1,
    )
    meta_style = ParagraphStyle(
        "PayslipMeta",
        fontName=BODY_FONT,
        fontSize=8.5,
        leading=12,
        textColor=TEXT_MUTED,
    )
    cell_bold = ParagraphStyle(
        "CellBold",
        fontName=BOLD_FONT,
        fontSize=8.5,
        leading=12,
        textColor=DARK_NAVY,
    )
    cell_regular = ParagraphStyle(
        "CellRegular",
        fontName=BODY_FONT,
        fontSize=8.5,
        leading=12,
        textColor=DARK_NAVY,
    )
    cell_right = ParagraphStyle(
        "CellRight",
        fontName=BODY_FONT,
        fontSize=8.5,
        leading=12,
        textColor=DARK_NAVY,
        alignment=2,
    )
    cell_right_bold = ParagraphStyle(
        "CellRightBold",
        fontName=BOLD_FONT,
        fontSize=8.5,
        leading=12,
        textColor=DARK_NAVY,
        alignment=2,
    )

    story: list[Any] = []

    # 1. Header with Logo & Company Title
    logo_img = None
    if LOGO_PATH.exists():
        try:
            logo_img = RLImage(str(LOGO_PATH), width=38 * mm, height=12 * mm)
            logo_img.hAlign = "LEFT"
        except Exception:
            logo_img = None

    company_head = Paragraph(
        f"<b>FUND HORIZON PRIVATE LIMITED</b><br/>"
        f"<font size=7.5 color='#5A6A80'>CIN: U67190MH2023PTC402918 · ARN 345439<br/>"
        f"B-401, Financial District, BKC, Mumbai 400051<br/>"
        f"payroll@fundhorizon.com · www.fundhorizon.com</font>",
        meta_style,
    )
    header_table = Table([[logo_img if logo_img else "", company_head]], colWidths=[42 * mm, 136 * mm])
    header_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    story.append(header_table)
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_COLOR, spaceAfter=3 * mm))

    # 2. Payslip Banner (Month & Year)
    month_name = MONTH_NAMES[slip.get("month", 1)]
    year_val = slip.get("year", 2026)
    banner_p = Paragraph(f"<b>SALARY SLIP FOR THE MONTH OF {month_name.upper()} {year_val}</b>", title_style)
    story.append(banner_p)
    story.append(Spacer(1, 4 * mm))

    # 3. Employee & Job Details Grid
    emp_details = [
        [
            Paragraph("<b>Employee Code:</b>", cell_bold),
            Paragraph(emp.get("emp_code", "–"), cell_regular),
            Paragraph("<b>Employee Name:</b>", cell_bold),
            Paragraph(f"<b>{emp.get('name', '–')}</b>", cell_bold),
        ],
        [
            Paragraph("<b>Designation:</b>", cell_bold),
            Paragraph(emp.get("designation", "–"), cell_regular),
            Paragraph("<b>Department:</b>", cell_bold),
            Paragraph(emp.get("department", "–"), cell_regular),
        ],
        [
            Paragraph("<b>Date of Joining:</b>", cell_bold),
            Paragraph(emp.get("joining_date", "–"), cell_regular),
            Paragraph("<b>Reporting Manager:</b>", cell_bold),
            Paragraph(emp.get("manager_name", "–"), cell_regular),
        ],
        [
            Paragraph("<b>Bank Name:</b>", cell_bold),
            Paragraph(emp.get("bank_name", "HDFC Bank"), cell_regular),
            Paragraph("<b>Bank Account No:</b>", cell_bold),
            Paragraph(emp.get("bank_account", "–"), cell_regular),
        ],
        [
            Paragraph("<b>Bank IFSC:</b>", cell_bold),
            Paragraph(emp.get("bank_ifsc", "–"), cell_regular),
            Paragraph("<b>PAN Number:</b>", cell_bold),
            Paragraph(emp.get("pan", "–"), cell_regular),
        ],
        [
            Paragraph("<b>UAN / PF Number:</b>", cell_bold),
            Paragraph(emp.get("uan", "–"), cell_regular),
            Paragraph("<b>Days Worked / Paid:</b>", cell_bold),
            Paragraph(f"{slip.get('days_worked', 30)} / {slip.get('days_in_month', 30)} Days", cell_regular),
        ],
    ]
    info_table = Table(emp_details, colWidths=[38 * mm, 51 * mm, 38 * mm, 51 * mm])
    info_table.setStyle(
        TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ("BACKGROUND", (0, 0), (0, -1), BG_LIGHT),
            ("BACKGROUND", (2, 0), (2, -1), BG_LIGHT),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ])
    )
    story.append(info_table)
    story.append(Spacer(1, 5 * mm))

    # 4. Earnings vs Deductions Table
    basic = slip.get("basic", 0)
    hra = slip.get("hra", 0)
    sa = slip.get("special_allowance", 0)
    gross = slip.get("gross_pay", basic + hra + sa)

    pf = slip.get("pf_deduction", 0)
    pt = slip.get("pt_deduction", 0)
    tds = slip.get("tds_deduction", 0)
    tot_ded = slip.get("total_deductions", pf + pt + tds)
    net_pay = slip.get("net_pay", max(0, gross - tot_ded))

    fin_rows = [
        [
            Paragraph("<b>EARNINGS</b>", cell_bold),
            Paragraph("<b>AMOUNT (₹)</b>", cell_right_bold),
            Paragraph("<b>DEDUCTIONS</b>", cell_bold),
            Paragraph("<b>AMOUNT (₹)</b>", cell_right_bold),
        ],
        [
            Paragraph("Basic Salary", cell_regular),
            Paragraph(_format_inr(basic), cell_right),
            Paragraph("Provident Fund (EPF)", cell_regular),
            Paragraph(_format_inr(pf), cell_right),
        ],
        [
            Paragraph("House Rent Allowance (HRA)", cell_regular),
            Paragraph(_format_inr(hra), cell_right),
            Paragraph("Professional Tax (PT)", cell_regular),
            Paragraph(_format_inr(pt), cell_right),
        ],
        [
            Paragraph("Special Allowance", cell_regular),
            Paragraph(_format_inr(sa), cell_right),
            Paragraph("Income Tax / TDS", cell_regular),
            Paragraph(_format_inr(tds), cell_right),
        ],
        [
            Paragraph("<b>Total Gross Earnings</b>", cell_bold),
            Paragraph(f"<b>{_format_inr(gross)}</b>", cell_right_bold),
            Paragraph("<b>Total Deductions</b>", cell_bold),
            Paragraph(f"<b>{_format_inr(tot_ded)}</b>", cell_right_bold),
        ],
    ]
    fin_table = Table(fin_rows, colWidths=[55 * mm, 34 * mm, 55 * mm, 34 * mm])
    fin_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (1, 0), colors.HexColor("#E0E7FF")),
            ("BACKGROUND", (2, 0), (3, 0), colors.HexColor("#FEE2E2")),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("BACKGROUND", (0, -1), (1, -1), colors.HexColor("#F1F5F9")),
            ("BACKGROUND", (2, -1), (3, -1), colors.HexColor("#F1F5F9")),
        ])
    )
    story.append(fin_table)
    story.append(Spacer(1, 4 * mm))

    # 5. Net Salary Take-Home Block
    words = _num_to_words(net_pay)
    net_rows = [
        [
            Paragraph(f"<b>NET SALARY PAYABLE:</b> {_format_inr(net_pay)}", ParagraphStyle("NetAmt", fontName=BOLD_FONT, fontSize=11, leading=15, textColor=ACCENT_GREEN)),
            Paragraph(f"<b>Status:</b> {slip.get('status', 'Processed').upper()}", cell_right_bold),
        ],
        [
            Paragraph(f"<b>In Words:</b> Indian Rupees {words} Only", cell_regular),
            Paragraph(f"Dispatched via Direct Bank Transfer", cell_right),
        ],
    ]
    net_table = Table(net_rows, colWidths=[120 * mm, 58 * mm])
    net_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECFDF5")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#A7F3D0")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(net_table)
    story.append(Spacer(1, 8 * mm))

    # 6. Signature and Seal
    stamp_img = None
    if STAMP_PATH.exists():
        try:
            stamp_img = RLImage(str(STAMP_PATH), width=30 * mm, height=17 * mm)
            stamp_img.hAlign = "LEFT"
        except Exception:
            stamp_img = None

    sign_data = [
        [
            Paragraph(
                "<i>Note: This is a system-generated salary slip and does not require a manual physical signature.<br/>"
                "Issued by Fund Horizon Finance & Payroll Division.</i>",
                meta_style,
            ),
            stamp_img if stamp_img else Spacer(1, 10 * mm),
        ],
        [
            "",
            Paragraph("<b>Authorized Payroll Officer</b><br/>Fund Horizon Private Limited", cell_right),
        ],
    ]
    sign_table = Table(sign_data, colWidths=[120 * mm, 58 * mm])
    sign_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(sign_table)

    doc.build(story)
    return buf.getvalue()

