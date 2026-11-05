from __future__ import annotations
"""Client-ready lumpsum investment proposal (A4, ReportLab). Fonts are Google Sans only (see report/fonts.py)."""

import io
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.config.disclosures import ARN, FIRM
from app.report import charts
from app.report.fmt import canvas_text, inr, xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

NAVY, LIGHT, GREEN = colors.HexColor("#183883"), colors.HexColor("#EEF2FA"), colors.HexColor("#5BB031")
BRAND = ["#183883", "#5BB031", "#13A89E", "#F2A541", "#6C8EAD", "#8E5572", "#B8B8D1", "#3D5A80", "#98C1D9"]
LOGO = Path(__file__).parent / "assets" / "logo-full.png"
BODY = ParagraphStyle("b", fontName=BODY_FONT, fontSize=8.5, leading=11.5)
CELL = ParagraphStyle("c", parent=BODY, fontSize=7.4, leading=9.2)
H1 = ParagraphStyle("h1", parent=BODY, fontName=BOLD_FONT, fontSize=17, leading=22, textColor=NAVY, spaceAfter=6)
H2 = ParagraphStyle("h2", parent=BODY, fontName=BOLD_FONT, fontSize=11, leading=14, textColor=NAVY, spaceBefore=9, spaceAfter=4)
DISCLAIMER = (
    "Mutual fund investments are subject to market risks, read all scheme related documents carefully. Past performance may or may not be "
    "sustained in the future. This is not an investment recommendation or personal financial, investment or professional advice. Expected "
    "returns are assumptions, not guarantees. Returns under 1 year are absolute; over 1 year are annualised (CAGR). The risk level of any "
    "scheme must be commensurate with the investor's risk profile, objective and goals; consult your Mutual Fund Distributor or Financial Advisor."
)


def _img(png: bytes, w_mm: float) -> Image:
    from PIL import Image as PILImage
    w, h = PILImage.open(io.BytesIO(png)).size
    return Image(io.BytesIO(png), width=w_mm * mm, height=w_mm * mm * h / w, hAlign="LEFT")


def _row(*cells, widths):
    t = Table([list(cells)], colWidths=widths)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t


def _kpis(r: dict, W: float) -> Table:
    k = ParagraphStyle("k", parent=BODY, fontName=BOLD_FONT, fontSize=15, leading=19, textColor=NAVY, alignment=1)
    l = ParagraphStyle("l", parent=BODY, fontSize=7.5, textColor=colors.HexColor("#5A6472"), alignment=1)
    items = [(inr(r["amount"]), "Lumpsum amount"), (f"{r['years']:g} years", "Investment period"),
             (f"{r['expected_return']:.2f}% p.a.", "Expected return"), (inr(r["future_value"]), "Expected value at maturity")]
    t = Table([[Paragraph(xml_escape(a), k) for a, _ in items], [Paragraph(b, l) for _, b in items]], colWidths=[W / 4] * 4)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), LIGHT), ("LINEABOVE", (0, 0), (-1, 0), 2, GREEN),
                           ("TOPPADDING", (0, 0), (-1, 0), 8), ("BOTTOMPADDING", (0, 1), (-1, 1), 8), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return t


def _p(t, st=CELL):
    return Paragraph(xml_escape(str(t)), st)


def _f(v, d=2):
    return "-" if v is None else f"{v:,.{d}f}"


def _tbl(rows, widths, right_from=1, header=True):
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), BODY_FONT, 7.4),
        *([("FONT", (0, 0), (-1, 0), BOLD_FONT, 7.4), ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)] if header else []),
        ("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, LIGHT]), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (right_from, 0), (-1, -1), "RIGHT"), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#D5DCE4")),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    return t


def _split(title, rows, W):
    body = [[title, "Amount (Rs.)", "Allocation (%)"]] + [[_p(r["name"]), inr(r["amount"]), f"{r['pct']:.2f}"] for r in rows]
    body.append(["Grand Total", inr(sum(r["amount"] for r in rows)), "100.00"])
    return _tbl(body, [W - 70 * mm, 35 * mm, 35 * mm])


def build_pdf(r: dict, client: str, risk: str, purpose: str, cover: bool = True) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=14 * mm, rightMargin=14 * mm, topMargin=20 * mm, bottomMargin=14 * mm,
                            title="Investment Proposal", author="Fund Horizon")
    W = landscape(A4)[0] - 28 * mm
    today = date.today().strftime("%d-%m-%Y")

    def decorate(c, d):
        w, h = landscape(A4)
        c.saveState()
        if not (cover and d.page == 1):  # the cover carries the big logo instead
            if LOGO.exists():
                c.drawImage(str(LOGO), 14 * mm, h - 13 * mm, width=19.4 * mm, height=10 * mm, mask="auto")
            c.setFont(BODY_FONT, 7.5)
            c.setFillColor(NAVY)
            c.drawRightString(w - 14 * mm, h - 8 * mm, f"Investment Proposal - Lumpsum  |  {canvas_text(client or 'Client')}")
            c.setFillColor(GREEN)
            c.rect(14 * mm, h - 14.5 * mm, w - 28 * mm, 0.8 * mm, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#5A6472"))
        c.setFont(BODY_FONT, 6.5)
        c.drawString(14 * mm, 7 * mm, f"{FIRM}  |  AMFI-registered Mutual Fund Distributor, {ARN}  |  {today}  |  Mutual fund investments are subject to market risks.")
        c.drawRightString(w - 14 * mm, 7 * mm, f"Page {d.page}")
        c.restoreState()

    s: list = []
    if cover:
        s += [Spacer(1, 12 * mm), _img(LOGO.read_bytes(), 70) if LOGO.exists() else Spacer(1, 1), Spacer(1, 14 * mm),
              Paragraph("Investment Proposal - Lumpsum", ParagraphStyle("t", parent=H1, fontSize=28, leading=34)),
              Paragraph(xml_escape(f"Prepared for {client or 'Client'}"), H2), Paragraph(today, BODY), Spacer(1, 16 * mm), _kpis(r, W), PageBreak()]
    summary = [["Client", client or "-"], ["Risk profile", risk or "-"], ["Investment purpose", purpose or "-"], ["Lumpsum amount (Rs.)", inr(r["amount"])],
               ["Period", f"{r['years']:g} years"], ["Expected return (% p.a.)", f"{r['expected_return']:.2f}"], ["Expected value at maturity (Rs.)", inr(r["future_value"])]]
    s += [Paragraph("Investment Proposal - Lumpsum", H1), _tbl([[_p(a), _p(b)] for a, b in summary], [70 * mm, W - 70 * mm], 1, header=False)]
    s += [Paragraph("Suggested Portfolio Allocation", H2)]
    head = ["Scheme", "Category", "1 Yr Ret (%)", "3 Yrs Ret (%)", "5 Yrs Ret (%)", "Expected Ret (%)", "Amount (Rs.)", "Allocation (%)"]
    rows = [head] + [[_p(x["name"]), _p(x["category"]), _f(x["ret_1y"]), _f(x["ret_3y"]), _f(x["ret_5y"]), _f(x["exp_ret"]), inr(x["amount"]), f"{x['alloc_pct']:.2f}"] for x in r["schemes"]]
    rows.append(["Grand Total", "", "", "", "", f"{r['expected_return']:.2f}", inr(r["amount"]), "100.00"])
    s += [_tbl(rows, [W - 190 * mm, 40 * mm] + [22 * mm] * 3 + [26 * mm, 30 * mm, 24 * mm], 2)]
    s += [Paragraph(xml_escape(f"Expected value after {r['years']:g} years at {r['expected_return']:.2f}% p.a.: Rs. {inr(r['future_value'])}. "
                               "Expected returns are the category assumptions (mean 10-year rolling returns per AMFI circular 135/BP/109/2023-24) unless changed by the adviser."), BODY)]
    half = (W - 6 * mm) / 2
    s += [Spacer(1, 3 * mm), _row(_img(charts.growth_chart(r["amount"], r["expected_return"], r["years"]), 105),
                                  _img(charts.donut({x["name"]: x["pct"] for x in r["category"]}, BRAND), 105), widths=[half + 3 * mm, half - 3 * mm])]
    s += [PageBreak(), Paragraph("Trailing Returns", H2)]
    head = ["Scheme", "AUM (Cr)", "TER (%)"] + [f"{p} Ret (%) / Rank" for p in ("1 Yr", "3 Yrs", "5 Yrs", "10 Yrs")]
    rows = [head]
    for t in r["trailing"]:
        rows.append([_p(t["name"]), _f(t["aum_cr"], 0), _f(t["ter"])] + [f"{_f(t['returns'][k])} / {t['rank'][k] or '-'}" for k in ("1y", "3y", "5y", "10y")])
        rows.append([_p(f"Category average ({t['category']}, {t['peers']} funds)"), "", ""] + [_f(t["avg"][k]) for k in ("1y", "3y", "5y", "10y")])
    s += [_tbl(rows, [W - 205 * mm, 25 * mm, 20 * mm] + [40 * mm] * 4, 1)]
    if any(t["returns"]["3y"] is not None for t in r["trailing"]):
        s += [Spacer(1, 3 * mm), _img(charts.returns_bar(r["trailing"], "3y"), 120)]
    if r["rolling"]:
        s += [Paragraph("Rolling Return Analysis (Equity & Hybrid Schemes), 3-year rolling", H2)]
        head = ["Scheme", "Average", "Median", "Maximum", "Minimum", "Negative", "0 - 8%", "8 - 12%", "12 - 15%", "15 - 20%", "> 20%"]
        rows = [head] + [[_p(x["name"]), _f(x["average"]), _f(x["median"]), _f(x["maximum"]), _f(x["minimum"])] + [_f(x["distribution"][k]) for k in ("negative", "0-8", "8-12", "12-15", "15-20", ">20")] for x in r["rolling"]]
        s += [_tbl(rows, [W - 190 * mm] + [19 * mm] * 10, 1)]
    s += [PageBreak(), Paragraph("Portfolio Composition", H2),
          _row(_img(charts.donut({x["name"]: x["pct"] for x in r["asset"]}, BRAND), 85), _img(charts.donut({x["name"]: x["pct"] for x in r["amc"]}, BRAND), 85), widths=[W / 2] * 2),
          Spacer(1, 3 * mm), _split("AMC", r["amc"], W), Spacer(1, 4 * mm), _split("Asset Allocation", r["asset"], W), Spacer(1, 4 * mm),
          _split("Category", r["category"], W)]
    h = r["holdings"]
    if h["sector"] or h["equity"] or h["debt"]:
        s += [PageBreak(), Paragraph(f"Portfolio Holdings (disclosures as of {h['as_of'] or '-'}; cover {h['coverage_pct']:.0f}% of the amount)", H2)]
        for title, key, col in (("Top 10 Sector Allocation", "sector", "Sector"), ("Top 10 Equity Holdings", "equity", "Company"), ("Top 10 Debt Holdings", "debt", "Company")):
            if h[key]:
                s += [Paragraph(title, H2), _tbl([[col, "Allocation (%)"]] + [[_p(x["name"]), f"{x['pct']:.2f}"] for x in h[key]], [W - 40 * mm, 40 * mm])]
    s += [Spacer(1, 6 * mm), Paragraph("Disclaimer", H2), Paragraph(xml_escape(DISCLAIMER), BODY)]
    doc.build(s, onFirstPage=decorate, onLaterPages=decorate)
    return buf.getvalue()
