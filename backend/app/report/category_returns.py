from __future__ import annotations
"""Category returns PDF (A4 landscape, ReportLab). Google Sans only."""

import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.backoffice.category_returns import flat_rows
from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

NAVY, LIGHT = colors.HexColor("#183883"), colors.HexColor("#EEF2FA")
BODY = ParagraphStyle("b", fontName=BODY_FONT, fontSize=8, leading=11)
H1 = ParagraphStyle("h", parent=BODY, fontName=BOLD_FONT, fontSize=15, leading=19, textColor=NAVY, spaceAfter=4)
DISCLAIMER = ("Mutual fund investments are subject to market risks, read all scheme related documents carefully. Past performance may or may not be sustained in the future. "
              "This is not an investment recommendation or personal financial, investment or professional advice.")


def build_pdf(r: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm, title="Mutual Fund Category Returns", author="Fund Horizon")
    W = landscape(A4)[0] - 24 * mm
    head, body = flat_rows(r)
    cell = lambda v: "-" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))  # noqa: E731
    p = ParagraphStyle("c", parent=BODY, fontSize=7, leading=8.5)
    rows = [[Paragraph(xml_escape(h), ParagraphStyle("hh", parent=p, textColor=colors.white, fontName=BOLD_FONT)) for h in head]] + [[Paragraph(xml_escape(row[0]), p)] + [cell(v) for v in row[1:]] for row in body]
    t = Table(rows, colWidths=[max(48 * mm, W - (len(head) - 1) * 14 * mm)] + [14 * mm] * (len(head) - 1), repeatRows=1)
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), BODY_FONT, 7), ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                           ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    doc.build([Paragraph("Mutual Fund Category Returns", H1), Paragraph(xml_escape(f"{r['fund_type']} · {r['plan']} plans · NAV as on {r['nav_as_of']}"), BODY), Spacer(1, 3 * mm), t,
               Spacer(1, 4 * mm), Paragraph(xml_escape(r["note"] + " " + DISCLAIMER), BODY)])
    return buf.getvalue()
