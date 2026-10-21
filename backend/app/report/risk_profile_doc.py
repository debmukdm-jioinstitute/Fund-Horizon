from __future__ import annotations
from app.db.d1 import on_workers
from fastapi import HTTPException

"""Official Client Risk Profiling & SEBI Suitability Assessment PDF Document.

Uses ReportLab with Google Sans fonts and standard disclosures.
"""

import io
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

if not on_workers():
    from reportlab.lib import colors
if not on_workers():
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
if not on_workers():
    from reportlab.lib.pagesizes import A4
if not on_workers():
    from reportlab.lib.styles import ParagraphStyle
if not on_workers():
    from reportlab.lib.units import mm
if not on_workers():
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
from app.report import charts
from app.report.fmt import canvas_text, inr, pct, short_inr, xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

# Monochrome document. Yellow marks what the advisor wants noticed, red marks a shortfall; nothing else is coloured.
NAVY = colors.HexColor("#111111")  # name kept so the styles below read unchanged; it is black
TEAL = colors.HexColor("#111111")
LIGHT = colors.HexColor("#F2F2F2")
BORDER_COLOR = colors.HexColor("#BDBDBD")
DARK_GRAY = colors.HexColor("#222222")
SLATE = colors.HexColor("#666666")
YELLOW = colors.HexColor("#FFE45C")
RED = colors.HexColor("#C00000")
GREYS = ["#111111", "#4D4D4D", "#808080", "#B3B3B3", "#D9D9D9"]

BODY = ParagraphStyle("rp_body", fontName=BODY_FONT, fontSize=8, leading=11, textColor=DARK_GRAY)
SMALL = ParagraphStyle("rp_small", parent=BODY, fontSize=6.8, leading=9, textColor=SLATE)
CELL = ParagraphStyle("rp_cell", parent=BODY, fontSize=7.2, leading=9.5)
CELL_BOLD = ParagraphStyle("rp_cell_b", parent=CELL, fontName=BOLD_FONT)
H1 = ParagraphStyle("rp_h1", parent=BODY, fontName=BOLD_FONT, fontSize=13, leading=16, textColor=NAVY, spaceAfter=4)
H2 = ParagraphStyle("rp_h2", parent=BODY, fontName=BOLD_FONT, fontSize=9.5, leading=13, textColor=NAVY, spaceBefore=6, spaceAfter=3)

FACTOR_LABELS = {
    "age": "Age",
    "income_stability": "Income Stability",
    "dependents": "Dependents",
    "savings_rate": "Savings Rate (% of income)",
    "emergency_fund": "Emergency Fund (months)",
    "net_worth": "Net Worth / Annual Income Multiple",
    "debt_burden": "Debt Burden (EMI / income)",
    "insurance": "Insurance Adequacy",
}


def _tbl(rows, widths, header=True, zebra=True):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("FONT", (0, 0), (-1, -1), BODY_FONT, 7.2),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#D0D0D0")),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONT", (0, 0), (-1, 0), BOLD_FONT, 7.2),
        ]
    if zebra:
        style += [("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, colors.HexColor("#F7F7F7")])]
    t.setStyle(TableStyle(style))
    return t


def _img(png: bytes, width_mm: float) -> Image:
    from PIL import Image as PILImage
    w, h = PILImage.open(io.BytesIO(png)).size
    return Image(io.BytesIO(png), width=width_mm * mm, height=width_mm * mm * h / w)


def build_risk_profile_pdf(
    client_name: str,
    profile: dict,
    client_inputs: dict | None = None,
    questionnaire_responses: list[dict] | None = None,
) -> bytes:
    """Build a client-ready 2-page A4 Risk Profiling and Suitability Assessment PDF."""
    buf = io.BytesIO()
    today_str = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y, %H:%M IST")
    today_date = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y")

    def decorate(canvas, doc):
        canvas.saveState()
        w, h = A4

        # Header: official logo on white, black rule underneath
        logo = Path(__file__).parent / "assets" / "logo.png"
        if logo.exists():
            canvas.drawImage(str(logo), 15 * mm, h - 21.5 * mm, width=33 * mm, height=17 * mm, mask="auto")
        else:
            canvas.setFillColor(NAVY)
            canvas.setFont(BOLD_FONT, 12)
            canvas.drawString(15 * mm, h - 12 * mm, FIRM)
        canvas.setFillColor(NAVY)
        canvas.setFont(BOLD_FONT, 8)
        canvas.drawRightString(w - 15 * mm, h - 10 * mm, f"Risk Profile: {canvas_text(client_name)}")
        canvas.setFillColor(SLATE)
        canvas.setFont(BODY_FONT, 6.5)
        canvas.drawRightString(w - 15 * mm, h - 14 * mm, f"AMFI ARN {ARN} · SEBI Suitability Record · {today_date}")
        canvas.setStrokeColor(NAVY)
        canvas.setLineWidth(1.5)
        canvas.line(0, h - 23 * mm, w, h - 23 * mm)

        # Footer
        canvas.setStrokeColor(colors.HexColor("#BDBDBD"))
        canvas.setLineWidth(0.5)
        canvas.line(15 * mm, 12 * mm, w - 15 * mm, 12 * mm)

        canvas.setFillColor(SLATE)
        canvas.setFont(BODY_FONT, 6)
        canvas.drawString(
            15 * mm,
            8 * mm,
            f"{FIRM} · Suitability Engine · Confidential Assessment for {canvas_text(client_name)}",
        )
        canvas.drawRightString(w - 15 * mm, 8 * mm, f"Page {doc.page} of 2")
        canvas.restoreState()

    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=27 * mm,
        bottomMargin=16 * mm,
        title=f"{FIRM} Risk Profiling - {client_name}",
        author=FIRM,
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="rp_page", frames=[frame], onPage=decorate)])
    W = doc.width

    cap = profile.get("capacity", {})
    cap_score = cap.get("score", 0)
    tol_score = profile.get("tolerance", 0)
    final_score = profile.get("final_score", min(cap_score, tol_score))
    band = profile.get("band", "Moderate")
    notes = profile.get("notes", [])
    alloc = profile.get("target_allocation") or profile.get("allocation") or {"equity": 50, "debt": 35, "gold": 10, "liquid": 5}

    story: list = []

    # 1. Document Title
    story += [
        Paragraph("Client Risk Profile & Suitability Assessment", H1),
        Paragraph(
            f"Evaluated on {today_str} · Standard SEBI Suitability Matrix · Non-Discretionary Portfolio Allocation",
            SMALL,
        ),
        Spacer(1, 4),
    ]

    # 2. Executive Assessment Summary Table
    summary_rows = [
        [
            Paragraph("<font color='white'><b>Assigned Risk Band</b></font>", CELL_BOLD),
            Paragraph("<font color='white'><b>Composite Score</b></font>", CELL_BOLD),
            Paragraph("<font color='white'><b>Financial Capacity</b></font>", CELL_BOLD),
            Paragraph("<font color='white'><b>Emotional Tolerance</b></font>", CELL_BOLD),
            Paragraph("<font color='white'><b>Governing Rule</b></font>", CELL_BOLD),
        ],
        [
            Paragraph(f"<font size='9'><b>{xml_escape(band)}</b></font>", CELL),
            Paragraph(f"<font size='9'><b>{final_score:.0f} / 100</b></font>", CELL),
            Paragraph(f"{cap_score:.0f} / 100", CELL),
            Paragraph(f"{tol_score:.0f} / 100", CELL),
            Paragraph("Min(Capacity, Tolerance)", CELL),
        ],
    ]
    summary = _tbl(summary_rows, [W * 0.25, W * 0.18, W * 0.18, W * 0.18, W * 0.21], header=True, zebra=False)
    summary.setStyle(TableStyle([("BACKGROUND", (0, 1), (1, 1), YELLOW)]))  # manual highlight: band and score
    story += [summary, Spacer(1, 4)]

    # 3. Client Capacity Financial Background
    if client_inputs:
        ci = client_inputs
        client_rows = [
            [
                Paragraph("<b>Age</b>", CELL_BOLD),
                Paragraph(str(ci.get("age", "—")), CELL),
                Paragraph("<b>Monthly Income</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("monthly_income")), CELL),
                Paragraph("<b>Monthly Expenses</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("monthly_expenses")), CELL),
            ],
            [
                Paragraph("<b>Monthly EMI</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("monthly_emi")), CELL),
                Paragraph("<b>Liquid Assets</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("liquid_assets")), CELL),
                Paragraph("<b>Total Investments</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("investments")), CELL),
            ],
            [
                Paragraph("<b>Total Liabilities</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("liabilities")), CELL),
                Paragraph("<b>Term Cover</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("term_cover")), CELL),
                Paragraph("<b>Health Cover</b>", CELL_BOLD),
                Paragraph(short_inr(ci.get("health_cover")), CELL),
            ],
        ]
        story += [
            Paragraph("Client Financial Profile", H2),
            _tbl(client_rows, [W * 0.16, W * 0.17, W * 0.17, W * 0.17, W * 0.17, W * 0.16], header=False, zebra=True),
            Spacer(1, 4),
        ]

    # 4. Capacity Breakdown (8 Factors)
    factors = cap.get("factors", [])
    if factors:
        story += [Paragraph("Risk Capacity Breakdown (8 Objective Financial Factors)", H2)]
        f_rows = [["Factor", "Client Metric", "Sub-Score", "Weight", "Contribution"]]
        for f in factors:
            factor_key = f.get("factor", "")
            label = FACTOR_LABELS.get(factor_key, factor_key.replace("_", " ").title())
            v = f.get("value")
            if factor_key == "insurance" and isinstance(v, dict):
                val_str = f"Term {short_inr(v.get('term_cover'))} (need {short_inr(v.get('term_need'))}); Health {short_inr(v.get('health_cover'))}"
            elif factor_key in ("savings_rate", "debt_burden"):
                val_str = pct(v)
            elif factor_key == "emergency_fund":
                val_str = f"{v:.1f} months" if isinstance(v, (int, float)) else str(v)
            elif factor_key == "net_worth":
                val_str = f"{v:.1f}x annual income" if isinstance(v, (int, float)) else str(v)
            else:
                val_str = str(v)

            f_rows.append([
                Paragraph(label, CELL),
                Paragraph(xml_escape(val_str), CELL),
                Paragraph(f"<font color='#C00000'><b>{f.get('score', 0):.0f} / 100</b></font>", CELL) if f.get("score", 0) < 50 else f"{f.get('score', 0):.0f} / 100",
                f"{f.get('weight', 0):.0%}",
                f"{f.get('contribution', 0):.1f} pts",
            ])
        story += [_tbl(f_rows, [W * 0.28, W * 0.38, W * 0.12, W * 0.10, W * 0.12]), Spacer(1, 4)]

    # 5. Strategic Asset Allocation
    story += [Paragraph("Target Strategic Asset Allocation", H2)]
    eq = alloc.get("equity", 0)
    debt = alloc.get("debt", 0)
    gold = alloc.get("gold", 0)
    liquid = alloc.get("liquid", 0)

    try:
        donut_bytes = charts.donut({"large_cap": eq, "corporate_bond": debt, "gold": gold, "liquid": liquid}, GREYS)
        donut_img = _img(donut_bytes, 75)
    except Exception:
        donut_img = None

    alloc_table_rows = [
        ["Asset Class", "Target Weight", "Strategic Role in Portfolio"],
        [Paragraph("<b>Equity</b> (Large, Flexi, Mid & Small Cap)", CELL), f"{eq:.1f}%", Paragraph("Capital compounding & wealth accumulation over 5+ year horizons", CELL)],
        [Paragraph("<b>Debt</b> (Corporate, Banking & PSU, Short Duration)", CELL), f"{debt:.1f}%", Paragraph("Capital preservation, coupon income & downside stabilization", CELL)],
        [Paragraph("<b>Gold</b> (Sovereign Gold Bonds, ETFs)", CELL), f"{gold:.1f}%", Paragraph("Hedge against currency depreciation and macro crisis events", CELL)],
        [Paragraph("<b>Liquid / Cash</b> (Overnight & Liquid Funds)", CELL), f"{liquid:.1f}%", Paragraph("Immediate liquidity buffer and tactical rebalancing reserve", CELL)],
    ]
    alloc_table = _tbl(alloc_table_rows, [W * 0.65 * 0.36, W * 0.65 * 0.17, W * 0.65 * 0.47])

    if donut_img:
        layout_table = Table([[alloc_table, donut_img]], colWidths=[W * 0.65, W * 0.35])
        layout_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        story += [layout_table]
    else:
        story += [alloc_table]

    # Page Break to Page 2
    story += [PageBreak()]

    # Page 2: Behavioral Tolerance Questionnaire & Suitability Notes
    story += [
        Paragraph("Behavioral Risk Tolerance Assessment (SEBI Standard Questionnaire)", H1),
        Paragraph(
            "Evaluation of psychological comfort with market swings, drawdown recovery, and volatility acceptance.",
            SMALL,
        ),
        Spacer(1, 4),
    ]

    if questionnaire_responses:
        q_rows = [["#", "Question", "Client Response", "Tolerance Score"]]
        for idx, q in enumerate(questionnaire_responses, 1):
            q_rows.append([
                str(idx),
                Paragraph(f"<b>{xml_escape(q.get('question', ''))}</b>", CELL),
                Paragraph(xml_escape(q.get("answer", "")), CELL),
                f"{q.get('score', 0):.0f} / 100",
            ])
        story += [_tbl(q_rows, [W * 0.05, W * 0.50, W * 0.33, W * 0.12]), Spacer(1, 6)]
    else:
        story += [
            Paragraph(
                f"Emotional Tolerance Score: <b>{tol_score:.0f} / 100</b>. Assessed across 10 psychometric risk questions measuring investment time horizon, reaction to hypothetical market drops, loss sensitivity, and experience with market cycles.",
                BODY,
            ),
            Spacer(1, 4),
        ]

    # 7. Advisory Hygiene & Risk Shortfall Flags
    if notes:
        story += [Paragraph("Planning Hygiene & Financial Health shortfalls", H2)]
        for n in notes:
            story += [Paragraph(f"<font color='#C00000'>• {xml_escape(n)}</font>", BODY)]
        story += [Spacer(1, 4)]

    # 8. SEBI Suitability Alignment Note
    story += [
        Paragraph("SEBI Suitability Standard & Methodology Declaration", H2),
        Paragraph(
            "In compliance with SEBI (Investment Advisers) Regulations, 2013, an investor's recommended asset allocation must never exceed their objectively evaluated capacity to bear loss. Even when an investor displays high emotional risk tolerance, their portfolio allocation is strictly capped by their financial capacity score.",
            SMALL,
        ),
        Spacer(1, 6),
    ]

    # 9. Client Acknowledgment & Advisor Sign-off Block
    sign_rows = [
        [
            Paragraph("<b>Client Declaration & Acknowledgment</b>", CELL_BOLD),
            Paragraph("<b>Investment Adviser Sign-Off</b>", CELL_BOLD),
        ],
        [
            Paragraph(
                f"I, <b>{xml_escape(client_name)}</b>, confirm that the financial inputs and risk tolerance responses provided above are accurate and complete. I understand the risks inherent to mutual funds and market-linked instruments.",
                SMALL,
            ),
            Paragraph(
                f"Assessed by Registered Investment Professional on behalf of <b>{FIRM}</b> (AMFI ARN: {ARN}). Risk categorization and suitability checks verified.",
                SMALL,
            ),
        ],
        [
            Paragraph("<br/><br/>________________________________________<br/>Client Signature & Date", CELL),
            Paragraph(f"<br/><br/>________________________________________<br/>Authorized Signatory & Stamp<br/>Date: {today_date}", CELL),
        ],
    ]
    story += [
        _tbl(sign_rows, [W * 0.5, W * 0.5], header=False, zebra=False),
    ]

    doc.build(story)
    return buf.getvalue()