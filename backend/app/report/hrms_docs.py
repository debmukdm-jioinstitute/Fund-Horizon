from __future__ import annotations
"""HRMS document generation: Offer Letters, Internship Offers, Termination Letters,
Promotion Letters, Relieving/Experience Certificates, and Monthly Salary Slips
matching official Fund Horizon letterhead, ARN 345439, and Mr. Manohar's signature/stamp."""

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

# Register Google Sans fonts
try:
    register()
except Exception:
    pass

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
LOGO_PATH = ASSETS_DIR / "offer_header_logo.png"
if not LOGO_PATH.exists():
    LOGO_PATH = ASSETS_DIR / "fund-horizon-logo.png"

MANOHAR_STAMP_PATH = ASSETS_DIR / "manohar_signature_and_stamp.png"
MANOHAR_SIG_PATH = ASSETS_DIR / "signature_manohar.png"
STAMP_PATH = ASSETS_DIR / "signature_stamp.png"

PRIMARY_COLOR = colors.HexColor("#0B2545")
SECONDARY_TEAL = colors.HexColor("#006F64")
DARK_NAVY = colors.HexColor("#172033")
TEXT_MUTED = colors.HexColor("#4A5568")
BORDER_COLOR = colors.HexColor("#CBD5E1")
BG_LIGHT = colors.HexColor("#F8FAFC")

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]


def _format_inr(v: int | float | None) -> str:
    """Format number in Indian numbering format: ₹1,50,000."""
    if v is None:
        return "₹0"
    n = int(round(v))
    neg = n < 0
    n = abs(n)
    s = str(n)
    if len(s) <= 3:
        res = s
    else:
        last3 = s[-3:]
        rem = s[:-3]
        groups = []
        while rem:
            groups.insert(0, rem[-2:])
            rem = rem[:-2]
        res = ",".join(groups) + "," + last3
    return f"{'-' if neg else ''}₹{res}"


def _num_to_words(n: int) -> str:
    """Convert integer to Indian English words (Lakhs / Crores)."""
    if n == 0:
        return "Zero"
    units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
             "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
             "Seventeen", "Eighteen", "Nineteen"]
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
            parts.append(_two_digits(rem))
        return " ".join(parts).strip()

    crore = n // 10000000
    n %= 10000000
    lakh = n // 100000
    n %= 100000
    thousand = n // 1000
    n %= 1000
    hundreds = n

    out: list[str] = []
    if crore > 0:
        out.append(f"{_two_digits(crore)} Crore")
    if lakh > 0:
        out.append(f"{_two_digits(lakh)} Lakh")
    if thousand > 0:
        out.append(f"{_two_digits(thousand)} Thousand")
    if hundreds > 0:
        out.append(_three_digits(hundreds))
    return " ".join(out).strip()


def render_hrms_letter_pdf(
    letter_type: str,
    title: str,
    recipient: dict[str, Any],
    placeholders: dict[str, Any],
    content: str,
) -> bytes:
    """Generate official company letter PDF matching the Fund Horizon paper template."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
    )

    header_style = ParagraphStyle(
        "HeaderMeta",
        fontName=BODY_FONT,
        fontSize=9,
        leading=13.5,
        textColor=TEXT_MUTED,
        alignment=1,  # Centered
    )
    subject_style = ParagraphStyle(
        "LetterSubject",
        fontName=BOLD_FONT,
        fontSize=11.5,
        leading=16,
        textColor=DARK_NAVY,
        alignment=1,  # Centered
    )
    body_style = ParagraphStyle(
        "LetterBody",
        fontName=BODY_FONT,
        fontSize=10,
        leading=15.5,
        textColor=DARK_NAVY,
    )
    bullet_style = ParagraphStyle(
        "LetterBullet",
        fontName=BODY_FONT,
        fontSize=10,
        leading=15,
        textColor=DARK_NAVY,
        leftIndent=16,
        firstLineIndent=-11,
    )
    heading_style = ParagraphStyle(
        "LetterH2",
        fontName=BOLD_FONT,
        fontSize=10.5,
        leading=15,
        textColor=DARK_NAVY,
        spaceBefore=10,
        spaceAfter=4,
    )

    story: list[Any] = []

    # 1. Header: Logo centered
    if LOGO_PATH.exists():
        try:
            # Aspect ratio of logo is 500x319
            logo_img = RLImage(str(LOGO_PATH), width=42 * mm, height=26.8 * mm)
            logo_img.hAlign = "CENTER"
            story.append(logo_img)
            story.append(Spacer(1, 2 * mm))
        except Exception:
            pass

    # 2. Centered Company Address & AMFI Registration
    header_text = (
        "<b>AMFI Registered Mutual Fund Distributor (ARN-345439)</b><br/>"
        "Flat No - 502, 5th Floor, Whispering Palms, Welfare CHSL,<br/>"
        "Plot No-33, Sector-12, Kharghar, Navi Mumbai, Raigad - 410210<br/>"
        "Email: support@fundhorizon.com | HR Contact: +91 9702019449 | Website: www.fundhorizon.com"
    )
    story.append(Paragraph(header_text, header_style))
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width="100%", thickness=1.2, color=PRIMARY_COLOR, spaceAfter=5 * mm))

    # 3. Date & Recipient Details
    today_str = datetime.now().strftime("%B %d, %Y")
    date_val = placeholders.get("date") or today_str
    emp_name = placeholders.get("employee_name") or recipient.get("name", "Candidate")

    meta_table_data = [
        [
            Paragraph(f"<b>Date:</b> {date_val}<br/><br/><b>To,</b><br/><b>{emp_name}</b>", body_style),
            Paragraph(f"<font size=8 color='#64748B'><b>Ref:</b> FH/HR/{letter_type.upper()[:3]}/{datetime.now().strftime('%Y%m')}/{recipient.get('emp_code', 'DOC-01')}</font>", ParagraphStyle("RightRef", parent=body_style, alignment=2)),
        ]
    ]
    meta_table = Table(meta_table_data, colWidths=[100 * mm, 74 * mm])
    meta_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(meta_table)
    story.append(Spacer(1, 4 * mm))

    # 4. Subject Line (Centered, Bold, Underlined)
    subject_val = placeholders.get("subject") or title or f"{letter_type.capitalize()} Offer"
    if not subject_val.lower().startswith("subject:"):
        subject_line = f"<u><b>Subject: {subject_val}</b></u>"
    else:
        subject_line = f"<u><b>{subject_val}</b></u>"
    story.append(Paragraph(subject_line, subject_style))
    story.append(Spacer(1, 5 * mm))

    # 5. Salutation
    first_name = emp_name.split()[0] if emp_name else "Candidate"
    story.append(Paragraph(f"Dear {first_name},", body_style))
    story.append(Spacer(1, 3 * mm))

    # 6. Letter Content (Resolve dynamic placeholders)
    resolved = content
    # If the user's template content already had the opening salutation, avoid repeating it
    if resolved.strip().startswith("Dear "):
        parts = resolved.split("\n\n", 1)
        if len(parts) > 1:
            resolved = parts[1]

    for k, v in placeholders.items():
        resolved = resolved.replace(f"{{{{{k}}}}}", str(v))

    paragraphs = resolved.split("\n\n")
    for para in paragraphs:
        p_clean = para.strip()
        if not p_clean:
            continue
        # Check if line is a numbered header or bullet
        lines = p_clean.split("\n")
        first_line = lines[0].strip()
        if any(first_line.startswith(prefix) for prefix in ("1.", "2.", "3.", "4.", "5.", "6.", "###", "##")):
            header_text = first_line.lstrip("#").strip()
            story.append(Paragraph(f"<b>{header_text}</b>", heading_style))
            rest = lines[1:]
            if rest:
                p_clean = "\n".join(rest).strip()
            else:
                continue

        # Render bullets vs normal paragraphs
        for subline in p_clean.split("\n"):
            sub_clean = subline.strip()
            if not sub_clean:
                continue
            if sub_clean.startswith("•") or sub_clean.startswith("- "):
                bullet_txt = sub_clean.lstrip("•- ").strip()
                story.append(Paragraph(f"• {bullet_txt}", bullet_style))
                story.append(Spacer(1, 1.2 * mm))
            else:
                story.append(Paragraph(sub_clean, body_style))
                story.append(Spacer(1, 2.2 * mm))

    # 7. Salary Annexure A (if Offer or Promotion with CTC)
    ctc_val = placeholders.get("ctc") or recipient.get("ctc")
    if ctc_val and letter_type.lower() in ("offer", "promotion"):
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
            story.append(Paragraph("<b>Annexure A: Compensation & Benefits Structure</b>", heading_style))
            story.append(Spacer(1, 1.5 * mm))

            sal_rows = [
                ["Salary Component", "Monthly Amount (₹)", "Annual Amount (₹)"],
                ["Basic Salary (50%)", _format_inr(basic), _format_inr(basic * 12)],
                ["House Rent Allowance (HRA)", _format_inr(hra), _format_inr(hra * 12)],
                ["Special Allowance", _format_inr(sa), _format_inr(sa * 12)],
                ["Total Gross Salary", _format_inr(m_gross), _format_inr(ctc_num)],
                ["Statutory Provident Fund (EPF - 12%)", _format_inr(pf), _format_inr(pf * 12)],
                ["Professional Tax (PT)", _format_inr(pt), _format_inr(pt * 12)],
                ["Total Annual Cost to Company (CTC)", "", _format_inr(ctc_num)],
            ]
            sal_table = Table(sal_rows, colWidths=[80 * mm, 47 * mm, 47 * mm])
            sal_table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY_COLOR),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), BOLD_FONT),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                    ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                    ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, BG_LIGHT]),
                    ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
                    ("FONTNAME", (0, -1), (-1, -1), BOLD_FONT),
                ])
            )
            story.append(sal_table)
            story.append(Spacer(1, 4 * mm))

    # 8. Signatory Block (Exactly matching sample paper with Mr. Manohar's signature and stamp)
    story.append(Spacer(1, 6 * mm))

    sign_stamp_img = None
    if MANOHAR_STAMP_PATH.exists():
        try:
            sign_stamp_img = RLImage(str(MANOHAR_STAMP_PATH), width=50 * mm, height=21.7 * mm)
            sign_stamp_img.hAlign = "LEFT"
        except Exception:
            sign_stamp_img = None

    sign_data = [
        [
            Paragraph("<b>For Fund Horizon,</b>", body_style),
            Paragraph("<b>Accepted By:</b>", body_style),
        ],
        [
            sign_stamp_img if sign_stamp_img else Spacer(1, 16 * mm),
            Spacer(1, 16 * mm),
        ],
        [
            Paragraph("________________________<br/><b>Mr. Manohar Hemdev</b><br/>Partner<br/>Fund Horizon", body_style),
            Paragraph(f"________________________<br/><b>{emp_name}</b><br/>Date: __________________", body_style),
        ],
    ]
    sign_table = Table(sign_data, colWidths=[87 * mm, 87 * mm])
    sign_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ])
    )
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

    title_style = ParagraphStyle(
        "PayslipTitle",
        fontName=BOLD_FONT,
        fontSize=15,
        leading=19,
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
        "CellB",
        fontName=BOLD_FONT,
        fontSize=8.5,
        leading=11.5,
        textColor=DARK_NAVY,
    )
    cell_regular = ParagraphStyle(
        "CellR",
        fontName=BODY_FONT,
        fontSize=8.5,
        leading=11.5,
        textColor=DARK_NAVY,
    )

    story: list[Any] = []

    # 1. Header
    logo_img = None
    if LOGO_PATH.exists():
        try:
            logo_img = RLImage(str(LOGO_PATH), width=36 * mm, height=23 * mm)
            logo_img.hAlign = "LEFT"
        except Exception:
            logo_img = None

    month_name = MONTH_NAMES[slip["month"]] if 1 <= slip["month"] <= 12 else str(slip["month"])
    firm_header = Paragraph(
        f"<b>FUND HORIZON PRIVATE LIMITED</b><br/>"
        f"<font size=8 color='#5A6A80'>ARN-345439 · AMFI Registered Mutual Fund Distributor<br/>"
        f"Flat No-502, Whispering Palms, Sector-12, Kharghar, Navi Mumbai - 410210<br/>"
        f"support@fundhorizon.com · +91 9702019449</font>",
        meta_style,
    )
    h_table = Table([[logo_img if logo_img else Paragraph("<b>FUND HORIZON</b>", title_style), firm_header]], colWidths=[42 * mm, 136 * mm])
    h_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    story.append(h_table)
    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_COLOR, spaceAfter=4 * mm))

    # Banner
    story.append(Paragraph(f"<b>PAYSLIP FOR {month_name.upper()} {slip['year']}</b>", title_style))
    story.append(Spacer(1, 4 * mm))

    # 2. Employee Metadata
    emp_meta = [
        [
            Paragraph("<b>Employee Name:</b>", cell_bold), Paragraph(emp.get("name", ""), cell_regular),
            Paragraph("<b>Employee ID:</b>", cell_bold), Paragraph(emp.get("emp_code", ""), cell_regular),
        ],
        [
            Paragraph("<b>Designation:</b>", cell_bold), Paragraph(emp.get("designation", ""), cell_regular),
            Paragraph("<b>Department:</b>", cell_bold), Paragraph(emp.get("department", ""), cell_regular),
        ],
        [
            Paragraph("<b>Date of Joining:</b>", cell_bold), Paragraph(emp.get("joining_date", ""), cell_regular),
            Paragraph("<b>PAN:</b>", cell_bold), Paragraph(emp.get("pan", "—"), cell_regular),
        ],
        [
            Paragraph("<b>UAN / PF No:</b>", cell_bold), Paragraph(emp.get("uan", "—"), cell_regular),
            Paragraph("<b>Bank A/C:</b>", cell_bold), Paragraph(emp.get("bank_account", "—"), cell_regular),
        ],
        [
            Paragraph("<b>Bank Name / IFSC:</b>", cell_bold), Paragraph(f"{emp.get('bank_name', '')} · {emp.get('bank_ifsc', '')}", cell_regular),
            Paragraph("<b>Days Worked:</b>", cell_bold), Paragraph(f"{slip.get('days_worked', 30)} / {slip.get('days_in_month', 30)} days", cell_regular),
        ],
    ]
    meta_table = Table(emp_meta, colWidths=[36 * mm, 53 * mm, 36 * mm, 53 * mm])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BG_LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 5 * mm))

    # 3. Earnings & Deductions Split Table
    earnings = [
        ("Basic Salary", slip["basic"]),
        ("House Rent Allowance (HRA)", slip["hra"]),
        ("Special Allowance", slip["special_allowance"]),
    ]
    deductions = [
        ("Provident Fund (EPF)", slip["pf_deduction"]),
        ("Professional Tax (PT)", slip["pt_deduction"]),
        ("Tax Deducted at Source (TDS)", slip["tds_deduction"]),
    ]

    split_rows = [
        [
            Paragraph("<b>EARNINGS</b>", ParagraphStyle("EH", fontName=BOLD_FONT, fontSize=9, textColor=colors.white)),
            Paragraph("<b>AMOUNT (₹)</b>", ParagraphStyle("EA", fontName=BOLD_FONT, fontSize=9, textColor=colors.white, alignment=2)),
            Paragraph("<b>DEDUCTIONS</b>", ParagraphStyle("DH", fontName=BOLD_FONT, fontSize=9, textColor=colors.white)),
            Paragraph("<b>AMOUNT (₹)</b>", ParagraphStyle("DA", fontName=BOLD_FONT, fontSize=9, textColor=colors.white, alignment=2)),
        ]
    ]

    for (e_label, e_amt), (d_label, d_amt) in zip(earnings, deductions):
        split_rows.append([
            Paragraph(e_label, cell_regular),
            Paragraph(_format_inr(e_amt), ParagraphStyle("EVal", parent=cell_regular, alignment=2)),
            Paragraph(d_label, cell_regular),
            Paragraph(_format_inr(d_amt), ParagraphStyle("DVal", parent=cell_regular, alignment=2, textColor=colors.HexColor("#DC2626"))),
        ])

    split_rows.append([
        Paragraph("<b>Total Gross Pay</b>", cell_bold),
        Paragraph(f"<b>{_format_inr(slip['gross_pay'])}</b>", ParagraphStyle("TG", parent=cell_bold, alignment=2)),
        Paragraph("<b>Total Deductions</b>", cell_bold),
        Paragraph(f"<b>{_format_inr(slip['total_deductions'])}</b>", ParagraphStyle("TD", parent=cell_bold, alignment=2, textColor=colors.HexColor("#DC2626"))),
    ])

    split_table = Table(split_rows, colWidths=[55 * mm, 34 * mm, 55 * mm, 34 * mm])
    split_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (1, 0), PRIMARY_COLOR),
        ("BACKGROUND", (2, 0), (3, 0), colors.HexColor("#475569")),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    story.append(split_table)
    story.append(Spacer(1, 5 * mm))

    # 4. Net Salary Banner
    net_words = _num_to_words(slip["net_pay"])
    net_card = [
        [
            Paragraph(f"<font size=10 color='#1E293B'><b>NET SALARY PAYABLE:</b></font><br/>"
                      f"<font size=15 color='#0D8A56'><b>{_format_inr(slip['net_pay'])}</b></font><br/>"
                      f"<font size=8 color='#64748B'><i>(Indian Rupees {net_words} Only)</i></font>", cell_bold),
        ]
    ]
    net_table = Table(net_card, colWidths=[178 * mm])
    net_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F0FDF4")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#86EFAC")),
        ("PADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(net_table)
    story.append(Spacer(1, 7 * mm))

    # 5. Signatory Footer with Manohar signature/stamp
    stamp_img = None
    if MANOHAR_STAMP_PATH.exists():
        try:
            stamp_img = RLImage(str(MANOHAR_STAMP_PATH), width=44 * mm, height=19 * mm)
            stamp_img.hAlign = "RIGHT"
        except Exception:
            stamp_img = None

    sign_footer = [
        [
            Paragraph("<font size=7.5 color='#64748B'>This is a system generated payslip of Fund Horizon Private Limited.<br/>"
                      "For tax queries contact: hr@fundhorizon.com · +91 9702019449</font>", meta_style),
            stamp_img if stamp_img else Paragraph("<b>Mr. Manohar Hemdev</b><br/>Partner", meta_style),
        ]
    ]
    ft_table = Table(sign_footer, colWidths=[118 * mm, 60 * mm])
    ft_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    story.append(ft_table)

    doc.build(story)
    return buf.getvalue()
