from __future__ import annotations
"""Holdings statement PDF for one client: what the CRM holds, valued at the latest AMFI NAV.

Not an RTA/AMC statement and labelled as such. Google Sans only (see CLAUDE.md)."""

import io
from datetime import datetime
from zoneinfo import ZoneInfo

from app.config.disclosures import ARN, FIRM
from app.report.fmt import inr, xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT


def build_holdings_statement(client_name: str, holdings: list[dict]) -> bytes:
    """``holdings`` are rows from ``repo_crm_phase3.value_holdings`` (paise amounts; value may be None)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    body = ParagraphStyle("st_body", fontName=BODY_FONT, fontSize=8.5, leading=11)
    bold = ParagraphStyle("st_bold", parent=body, fontName=BOLD_FONT)
    title = ParagraphStyle("st_title", parent=bold, fontSize=15, leading=19)
    rupees = lambda paise: "-" if paise is None else inr(paise / 100)  # noqa: E731
    total_value = sum(h["value_paise"] or 0 for h in holdings)
    total_cost = sum(h["cost_paise"] for h in holdings)
    now = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y")

    rows = [[Paragraph(t, bold) for t in ("Scheme", "Folio", "Units", "NAV", "Cost", "Value", "Gain")]]
    for h in holdings:
        rows.append([
            Paragraph(xml_escape(h.get("scheme_name") or h.get("scheme_code") or "-"), body), Paragraph(xml_escape(h.get("folio") or "-"), body),
            f"{h['units']:.3f}", "-" if h["nav"] is None else f"{float(h['nav']):.4f}", rupees(h["cost_paise"]), rupees(h["value_paise"]), rupees(h["gain_paise"]),
        ])
    rows.append([Paragraph("Total (valued positions)", bold), "", "", "", rupees(total_cost), rupees(total_value), ""])
    table = Table(rows, colWidths=[62 * mm, 22 * mm, 20 * mm, 17 * mm, 22 * mm, 22 * mm, 20 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 1), (-1, -1), BODY_FONT), ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.grey), ("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.grey),
    ]))
    unvalued = sum(1 for h in holdings if h["value_paise"] is None)
    note = ("Holdings recorded by " + f"{FIRM} ({ARN})" + f" and valued at the latest available NAV. Dated {now}. "
            "This is not an official statement from any AMC or RTA; refer to the CAS or the AMC for those. "
            + (f"{unvalued} position(s) without a NAV are shown as '-' and left out of the total." if unvalued else ""))
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=f"Holdings statement - {client_name}").build([
        Paragraph(xml_escape(FIRM), bold), Spacer(1, 3), Paragraph(f"Holdings statement: {xml_escape(client_name)}", title), Spacer(1, 10),
        table, Spacer(1, 10), Paragraph(note, body),
    ])
    return buf.getvalue()

