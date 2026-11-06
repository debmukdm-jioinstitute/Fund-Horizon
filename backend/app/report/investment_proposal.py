from __future__ import annotations
"""Client-ready lumpsum investment proposal (A4, ReportLab). Fonts are Google Sans only (see report/fonts.py)."""

import io
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

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


def kpi_text(x: dict) -> str:
    v = x["value"]
    return {"inr": lambda: inr(v), "pct": lambda: f"{v:.2f}% p.a.", "yrs": lambda: f"{v:g} years"}.get(x["fmt"], lambda: str(v))()


def _kpis(r: dict, W: float) -> Table:
    k = ParagraphStyle("k", parent=BODY, fontName=BOLD_FONT, fontSize=15, leading=19, textColor=NAVY, alignment=1)
    l = ParagraphStyle("l", parent=BODY, fontSize=7.5, textColor=colors.HexColor("#5A6472"), alignment=1)
    items = [(kpi_text(x), x["label"]) for x in r["kpis"]]
    t = Table([[Paragraph(xml_escape(a), k) for a, _ in items], [Paragraph(b, l) for _, b in items]], colWidths=[W / len(items)] * len(items))
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


def _split(title, rows, W, col="Amount (Rs.)"):
    body = [[title, col, "Allocation (%)"]] + [[_p(r["name"]), inr(r["amount"]), f"{r['pct']:.2f}"] for r in rows]
    body.append(["Grand Total", inr(sum(r["amount"] for r in rows)), "100.00"])
    return _tbl(body, [W - 70 * mm, 35 * mm, 35 * mm])


def build_pdf(r: dict, client: str, risk: str, purpose: str, cover: bool = True) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=14 * mm, rightMargin=14 * mm, topMargin=20 * mm, bottomMargin=14 * mm,
                            title="Investment Proposal", author="Fund Horizon")
    W = landscape(A4)[0] - 28 * mm
    today = date.today().strftime("%d-%m-%Y")
    title = r.get("title", "Lumpsum")

    def decorate(c, d):
        w, h = landscape(A4)
        c.saveState()
        if not (cover and d.page == 1):  # the cover carries the big logo instead
            if LOGO.exists():
                c.drawImage(str(LOGO), 14 * mm, h - 13 * mm, width=19.4 * mm, height=10 * mm, mask="auto")
            c.setFont(BODY_FONT, 7.5)
            c.setFillColor(NAVY)
            c.drawRightString(w - 14 * mm, h - 8 * mm, f"Investment Proposal - {r.get('title', 'Lumpsum')}  |  {canvas_text(client or 'Client')}")
            c.setFillColor(GREEN)
            c.rect(14 * mm, h - 14.5 * mm, w - 28 * mm, 0.8 * mm, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#5A6472"))
        c.setFont(BODY_FONT, 6.5)
        c.drawString(14 * mm, 7 * mm, f"{FIRM}  |  AMFI-registered Mutual Fund Distributor, {ARN}  |  {today}  |  Mutual fund investments are subject to market risks.")
        c.drawRightString(w - 14 * mm, 7 * mm, f"Page {d.page}")
        c.restoreState()

    def sec(heading, *flow):  # a heading always travels with its content, so no heading or chart is stranded alone on a page
        return KeepTogether([Paragraph(xml_escape(heading), H2), *flow])

    s: list = []
    if cover:
        s += [Spacer(1, 12 * mm), _img(LOGO.read_bytes(), 70) if LOGO.exists() else Spacer(1, 1), Spacer(1, 14 * mm),
              Paragraph(f"Investment Proposal - {title}", ParagraphStyle("t", parent=H1, fontSize=28, leading=34)),
              Paragraph(xml_escape(f"Prepared for {client or 'Client'}"), H2), Paragraph(today, BODY), Spacer(1, 16 * mm), _kpis(r, W), PageBreak()]
    summary = [["Client", client or "-"], ["Risk profile", risk or "-"], ["Investment purpose", purpose or "-"]] + [[x["label"], kpi_text(x)] for x in r["kpis"]]
    if r.get("source"):
        summary.append(["STP source fund", r["source"]["name"]])
    summary += [["", ""]] * (len(summary) % 2)
    pairs = [[_p(a), _p(b), _p(c), _p(d)] for (a, b), (c, d) in zip(summary[0::2], summary[1::2])]  # two label/value pairs per row keeps page 2 compact
    s += [Paragraph(f"Investment Proposal - {title}", H1), _tbl(pairs, [42 * mm, W / 2 - 42 * mm, 42 * mm, W / 2 - 42 * mm], 1, header=False)]
    lump, sip = r["amount"] > 0, r.get("sip", 0) > 0
    head = ["Scheme", "Category", "1 Yr Ret (%)", "3 Yrs Ret (%)", "5 Yrs Ret (%)", "Expected Ret (%)"] + (["Amount (Rs.)"] if lump else []) + (["SIP (Rs./month)"] if sip else []) + ["Allocation (%)"]
    rows = [head] + [[_p(x["name"]), _p(x["category"]), _f(x["ret_1y"]), _f(x["ret_3y"]), _f(x["ret_5y"]), _f(x["exp_ret"])]
                     + ([inr(x["amount"])] if lump else []) + ([inr(x["sip"])] if sip else []) + [f"{x['alloc_pct']:.2f}"] for x in r["schemes"]]
    rows.append(["Grand Total", "", "", "", "", f"{r['expected_return']:.2f}"] + ([inr(r["amount"])] if lump else []) + ([inr(r["sip"])] if sip else []) + ["100.00"])
    extra = 26 * mm * (lump + sip)
    s += [CondPageBreak(60 * mm), sec("Suggested Portfolio Allocation", _tbl(rows, [W - 139 * mm - extra, 38 * mm] + [19 * mm] * 3 + [24 * mm] + [26 * mm] * (lump + sip) + [20 * mm], 2),
          Spacer(1, 1.5 * mm), Paragraph(xml_escape(f"Expected value after {r['years']:g} years at {r['expected_return']:.2f}% p.a.: Rs. {inr(r['future_value'])}. "
                                                    "Expected returns are the category assumptions (mean 10-year rolling returns per AMFI circular 135/BP/109/2023-24) unless changed by the adviser."), BODY))]
    labels = {"stp": ("Value of STP portfolio", "Amount in source fund"), "swp": ("Corpus remaining", "Starting corpus")}.get(r.get("mode"), (f"Projected value @ {r['expected_return']:.2f}% p.a.", "Amount invested"))
    half = (W - 6 * mm) / 2
    s += [CondPageBreak(65 * mm), sec("Growth and Category Mix", _row(_img(charts.growth_chart(r["curve"], *labels), 95),
                                                                       _img(charts.donut({x["name"]: x["pct"] for x in r["category"]}, BRAND), 80), widths=[half + 3 * mm, half - 3 * mm]))]

    rk = lambda t, k: (f"{_f(t['returns'][k])} / {t['rank'][k]}" if t["rank"][k] else _f(t["returns"][k]))  # noqa: E731
    head = ["Scheme", "AUM (Cr)", "TER (%)"] + [f"{p} Ret (%) / Rank" for p in ("1 Yr", "3 Yrs", "5 Yrs", "10 Yrs")]
    rows = [head] + [[_p(t["name"]), _f(t["aum_cr"], 0), _f(t["ter"])] + [rk(t, k) for k in ("1y", "3y", "5y", "10y")] for t in r["trailing"]]
    for cat in dict.fromkeys(t["category"] for t in r["trailing"]):  # one average row per category, not one per scheme
        t = next(x for x in r["trailing"] if x["category"] == cat)
        rows.append([_p(f"Category average - {cat} ({t['peers']} funds)"), "", ""] + [_f(t["avg"][k]) for k in ("1y", "3y", "5y", "10y")])
    s += [CondPageBreak(70 * mm), sec("Trailing Returns", _tbl(rows, [W - 205 * mm, 25 * mm, 20 * mm] + [40 * mm] * 4, 1))]
    if any(t["returns"]["3y"] is not None for t in r["trailing"]):
        s += [sec("3-Year Return vs Category Average", _img(charts.returns_bar(r["trailing"], "3y"), 100))]
    if r["rolling"]:
        head = ["Scheme", "Average", "Median", "Maximum", "Minimum", "Negative", "0 - 8%", "8 - 12%", "12 - 15%", "15 - 20%", "> 20%"]
        rows = [head] + [[_p(x["name"]), _f(x["average"]), _f(x["median"]), _f(x["maximum"]), _f(x["minimum"])] + [_f(x["distribution"][k]) for k in ("negative", "0-8", "8-12", "12-15", "15-20", ">20")] for x in r["rolling"]]
        s += [CondPageBreak(50 * mm), sec("Rolling Return Analysis (Equity & Hybrid Schemes), 3-year rolling", _tbl(rows, [W - 190 * mm] + [19 * mm] * 10, 1))]
    col = "Total Invested (Rs.)" if r.get("sip") else "Amount (Rs.)"
    s += [CondPageBreak(75 * mm), sec("Portfolio Composition", _row(_img(charts.donut({x["name"]: x["pct"] for x in r["asset"]}, BRAND), 85),
                                                                 _img(charts.donut({x["name"]: x["pct"] for x in r["amc"]}, BRAND), 85), widths=[W / 2] * 2))]
    for t, k in (("AMC Allocation", "amc"), ("Asset Allocation", "asset"), ("Category Allocation", "category")):
        s += [Spacer(1, 3 * mm), sec(t, _split(t.replace(" Allocation", ""), r[k], W, col))]
    h = r["holdings"]
    if h["sector"] or h["equity"] or h["debt"]:
        asof = "-" if not h["as_of"] else "-".join(reversed(str(h["as_of"])[:10].split("-")))
        s += [Spacer(1, 3 * mm), Paragraph(f"Portfolio holdings: latest disclosures as of {asof}, covering {h['coverage_pct']:.0f}% of the amount.", BODY)]
        for title_, key, c in (("Top 10 Sector Allocation", "sector", "Sector"), ("Top 10 Equity Holdings", "equity", "Company"), ("Top 10 Debt Holdings", "debt", "Company")):
            if h[key]:
                s += [sec(title_, _tbl([[c, "Allocation (%)"]] + [[_p(x["name"]), f"{x['pct']:.2f}"] for x in h[key]], [W - 40 * mm, 40 * mm]))]
    s += [Spacer(1, 6 * mm), sec("Disclaimer", Paragraph(xml_escape(DISCLAIMER), BODY))]
    doc.build(s, onFirstPage=decorate, onLaterPages=decorate)
    return buf.getvalue()
