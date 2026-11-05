from __future__ import annotations
"""Generic report-table PDF (A4 landscape, ReportLab): title, optional group header row, rows, note. Google Sans only."""

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

NAVY, LIGHT = colors.HexColor("#183883"), colors.HexColor("#EEF2FA")
BODY = ParagraphStyle("b", fontName=BODY_FONT, fontSize=8, leading=11)
H1 = ParagraphStyle("h", parent=BODY, fontName=BOLD_FONT, fontSize=15, leading=19, textColor=NAVY, spaceAfter=4)
DISCLAIMER = ("Mutual fund investments are subject to market risks, read all scheme related documents carefully. Past performance may or may not be sustained in the future. "
              "This is not an investment recommendation or personal financial, investment or professional advice.")
MAX_ROWS, MAX_COLS = 3000, 40


def _cell(v: Any) -> str:
    if v is None:
        return "-"
    return f"{v:,.2f}".rstrip("0").rstrip(".") if isinstance(v, float) and not float(v).is_integer() else (f"{int(v):,}" if isinstance(v, (int, float)) else str(v))


def build_table_pdf(t: dict[str, Any]) -> bytes:
    cols, rows = t["columns"][:MAX_COLS], t["rows"][:MAX_ROWS]
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=12 * mm, bottomMargin=12 * mm, title=str(t["title"])[:120], author="Fund Horizon")
    W = landscape(A4)[0] - 20 * mm
    p = ParagraphStyle("c", parent=BODY, fontSize=6.6, leading=8)
    hp = ParagraphStyle("hh", parent=p, textColor=colors.white, fontName=BOLD_FONT)
    first = max(cols[0]["key"] == "scheme" and 52 * mm or 20 * mm, 20 * mm)
    rest = max(10 * mm, min(22 * mm, (W - first) / max(1, len(cols) - 1)))
    widths = [first] + [rest] * (len(cols) - 1)
    grouped = any(c.get("group") for c in cols)
    data: list[list[Any]] = []
    spans: list[tuple] = []
    if grouped:
        data.append([Paragraph(xml_escape(c.get("group") or ""), hp) if c.get("group") and (i == 0 or cols[i - 1].get("group") != c["group"]) else "" for i, c in enumerate(cols)])
        i = 0
        while i < len(cols):
            if cols[i].get("group"):
                j = i
                while j + 1 < len(cols) and cols[j + 1].get("group") == cols[i]["group"]:
                    j += 1
                spans.append(("SPAN", (i, 0), (j, 0)))
                i = j + 1
            else:
                spans.append(("SPAN", (i, 0), (i, 1)))
                i += 1
        data.append([Paragraph(xml_escape(c["label"]), hp) for c in cols])
        data[0] = [Paragraph(xml_escape(c["label"]), hp) if not c.get("group") else d for c, d in zip(cols, data[0])]
    else:
        data.append([Paragraph(xml_escape(c["label"]), hp) for c in cols])
    for r in rows:
        data.append([Paragraph(xml_escape(str(r.get(c["key"]) or "-")), p) if c["key"] == "scheme" or isinstance(r.get(c["key"]), str) else _cell(r.get(c["key"])) for c in cols])
    head = 2 if grouped else 1
    t_ = Table(data, colWidths=widths, repeatRows=head)
    t_.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), BODY_FONT, 6.6), ("BACKGROUND", (0, 0), (-1, head - 1), NAVY), ("ROWBACKGROUNDS", (0, head), (-1, -1), [colors.white, LIGHT]),
                            ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), *spans]))
    doc.build([Paragraph(xml_escape(str(t["title"])), H1), Paragraph(xml_escape(f"NAV as on {t.get('as_of', '-')}"), BODY), Spacer(1, 3 * mm), t_, Spacer(1, 4 * mm),
               Paragraph(xml_escape(f"{t.get('note', '')} {DISCLAIMER}"), BODY)])
    return buf.getvalue()
