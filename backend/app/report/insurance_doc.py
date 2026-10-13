"""Generates a downloadable PDF specification & product brochure for an insurance plan."""
from __future__ import annotations

import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.config.disclosures import ARN, FIRM, INSURANCE_SHORTLIST_NOTE
from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

NAVY = colors.HexColor("#0B2545")
TEAL = colors.HexColor("#0D9488")
LIGHT = colors.HexColor("#F0FDFA")
BORDER_COLOR = colors.HexColor("#99F6E4")
DARK_GRAY = colors.HexColor("#334155")


BODY = ParagraphStyle("ins_body", fontName=BODY_FONT, fontSize=9, leading=13, textColor=DARK_GRAY)
TITLE = ParagraphStyle("ins_title", fontName=BOLD_FONT, fontSize=18, leading=22, textColor=NAVY)
SUBTITLE = ParagraphStyle("ins_sub", fontName=BODY_FONT, fontSize=11, leading=15, textColor=TEAL)
H2 = ParagraphStyle("ins_h2", fontName=BOLD_FONT, fontSize=12, leading=16, textColor=NAVY, spaceBefore=10, spaceAfter=4)
SMALL = ParagraphStyle("ins_small", fontName=BODY_FONT, fontSize=7.5, leading=10, textColor=colors.HexColor("#64748B"))


def build_insurance_plan_pdf(plan_info: dict) -> bytes:
    """Build an official, downloadable A4 product summary document for an insurance plan."""
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    w = doc.width

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    template = PageTemplate(id="ins_doc", frames=frame)
    doc.addPageTemplates([template])

    insurer = plan_info.get("insurer", "Insurance Partner")
    plan_name = plan_info.get("plan", "Plan Details")
    csr = plan_info.get("claim_settlement", "N/A")
    solvency = plan_info.get("solvency") or "N/A"
    sum_insured = plan_info.get("sum_insured", "N/A")
    features = plan_info.get("features", [])
    why = plan_info.get("why_included", "")
    doc_url = plan_info.get("document_url", "")

    story = [
        # Header banner
        Paragraph(f"<b>{FIRM}</b> · RESEARCH BLUEPRINT & PLAN SPECIFICATION", SMALL),
        Spacer(1, 4),
        Paragraph(xml_escape(f"{insurer} — {plan_name}"), TITLE),
        Paragraph(xml_escape("Official Research Dossier & Plan Features · Researched October 2026"), SUBTITLE),
        Spacer(1, 10),
    ]

    # Metrics table
    metrics_data = [
        ["Insurer", xml_escape(insurer)],
        ["Product Name", xml_escape(plan_name)],
        ["Claim Settlement Ratio", xml_escape(csr)],
        ["Solvency Ratio", xml_escape(solvency)],
        ["Sum Insured Range", xml_escape(sum_insured)],
    ]
    if doc_url:
        metrics_data.append(["Official Web Link", xml_escape(doc_url)])

    t_metrics = Table(metrics_data, colWidths=[w * 0.35, w * 0.65])
    t_metrics.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("TEXTCOLOR", (0, 0), (0, -1), NAVY),
        ("FONTNAME", (0, 0), (0, -1), BOLD_FONT),
        ("FONTNAME", (1, 0), (1, -1), BODY_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("BOX", (0, 0), (-1, -1), 1, TEAL),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t_metrics)
    story.append(Spacer(1, 12))

    # Key Features
    story.append(Paragraph("Key Policy Features & Benefits", H2))
    for f in features:
        story.append(Paragraph(f"• &nbsp; {xml_escape(f)}", BODY))
        story.append(Spacer(1, 2))

    story.append(Spacer(1, 8))

    # Why Included
    story.append(Paragraph("Shortlist Research Assessment", H2))
    story.append(Paragraph(xml_escape(why), BODY))

    story.append(Spacer(1, 14))

    # Statutory Disclosures & Compliance Notes
    story.append(Paragraph("Statutory Disclosures & IRDAI Guidelines", H2))
    story.append(Paragraph(xml_escape(INSURANCE_SHORTLIST_NOTE), SMALL))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Distributed under AMFI Registration {ARN}. Fund Horizon operates as an execution-only distributor and does not underwrite policies. "
        "Policyholders must review the official policy wording, exclusions, waiting periods, and room-rent sub-limits on the insurer website before purchasing.",
        SMALL
    ))

    doc.build(story)
    return buf.getvalue()
