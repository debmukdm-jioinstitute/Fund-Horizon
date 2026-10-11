"""Client-ready PDF (A4) built with ReportLab; charts via matplotlib. Fully offline."""
from __future__ import annotations

# TODO(owner-compliance-review): this module contains user-facing report copy.
import io
from datetime import date
from pathlib import Path

import matplotlib
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.config.disclosures import (
    ALLOCATION_HEADING,
    FIRM,
    SCHEME_DOCS_NOTE,
    SHORTLIST_HEADING,
    SUCCESS_PROB_NOTE,
    TAX_INFO,
    TAX_PER_GOAL_NOTE,
    all_disclosures,
)
from app.report import charts
from app.report.fmt import canvas_text, inr, pct, short_inr, sized_status, xml_escape

NAVY, TEAL = colors.HexColor("#0B2545"), colors.HexColor("#13A89E")
LIGHT = colors.HexColor("#EEF6F6")

_FONTS = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
pdfmetrics.registerFont(TTFont("DV", str(_FONTS / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DV-B", str(_FONTS / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFontFamily("DV", normal="DV", bold="DV-B", italic="DV", boldItalic="DV-B")

BODY = ParagraphStyle("body", fontName="DV", fontSize=8.5, leading=11.5, alignment=TA_LEFT)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=7, leading=9)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=7.2, leading=9)
H1 = ParagraphStyle("h1", parent=BODY, fontName="DV-B", fontSize=15, leading=19, textColor=NAVY, spaceAfter=6)
H2 = ParagraphStyle("h2", parent=BODY, fontName="DV-B", fontSize=10.5, leading=14, textColor=NAVY,
                    spaceBefore=8, spaceAfter=4)

LABELS = charts.LABELS
FACTOR_LABELS = {
    "age": "Age", "income_stability": "Income stability", "dependents": "Dependents",
    "savings_rate": "Savings rate", "emergency_fund": "Emergency fund (months)", "net_worth": "Net worth / annual income",
    "debt_burden": "Debt burden (EMI / income)", "insurance": "Insurance adequacy",
}


def _tbl(rows, widths, header=True, zebra=True):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [("FONT", (0, 0), (-1, -1), "DV", 7.2), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#D5DCE4")),
             ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                  ("FONT", (0, 0), (-1, 0), "DV-B", 7.2)]
    if zebra:
        style += [("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, LIGHT])]
    t.setStyle(TableStyle(style))
    return t


def _img(png: bytes, width_mm: float) -> Image:
    from PIL import Image as PILImage
    w, h = PILImage.open(io.BytesIO(png)).size
    img = Image(io.BytesIO(png), width=width_mm * mm, height=width_mm * mm * h / w)
    return img


def _P(text, style=CELL):
    return Paragraph(xml_escape(text), style)


def build_pdf(first_name: str, r: dict) -> bytes:
    """Render the report for a stored plan result dict `r` (see pipeline.build_full_plan)."""
    disc = all_disclosures()
    buf = io.BytesIO()
    today = date.today().strftime("%d %b %Y")

    def decorate(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(NAVY)
        canvas.rect(0, h - 16 * mm, w, 16 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("DV-B", 12)
        canvas.drawString(15 * mm, h - 10.5 * mm, FIRM)
        canvas.setFont("DV", 8)
        canvas.drawRightString(w - 15 * mm, h - 10.5 * mm, f"Illustrative plan for {canvas_text(first_name)}  |  {today}")
        canvas.setFillColor(TEAL)
        canvas.rect(0, h - 17 * mm, w, 1 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#444444"))
        canvas.setFont("DV", 5.8)
        y = 24 * mm
        for line in disc["lines"]:
            for part in _wrap(line, 145):
                canvas.drawString(15 * mm, y, part)
                y -= 2.4 * mm
        canvas.drawRightString(w - 15 * mm, 6 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=22 * mm,
                          bottomMargin=42 * mm, title=f"{FIRM} illustrative plan", author=FIRM)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=decorate)])
    W = doc.width

    prof, alloc, plan, stress = r["profile"], r["allocation"], r["planning"], r["stress_test"]
    story: list = []

    # 1. Summary
    story += [Paragraph(f"Your illustrative plan, {xml_escape(first_name)}", H1)]
    story += [Paragraph(
        f"Risk profile: <b>{xml_escape(prof['band'])}</b> (score {prof['final_score']:.0f}/100). Data as of {r['data_asof']}. "
        "All projections use the editable assumptions listed on the last page.", BODY)]
    if prof["priority_actions"]:
        story += [Paragraph("Priority actions", H2)]
        story += [Paragraph(f"• {xml_escape(a)}", BODY) for a in prof["priority_actions"]]
    cf, tot = plan["cashflow"], plan["totals"]
    story += [Paragraph("Cash flow snapshot", H2), _tbl([
        ["Monthly income", "Monthly outgo", "Monthly surplus", "Savings rate", "Total SIP needed"],
        [inr(cf["monthly_income"]), inr(cf["monthly_outgo"]), inr(cf["monthly_surplus"]),
         pct(cf["savings_rate"]), inr(tot["required_sip"])]], [W / 5] * 5)]
    rows = [["Goal", "Yrs", "Future cost", "SIP needed", "SIP allocated", "Sized?*", "P(success)*", "SIP ~80%"]]
    for g in plan["goals"]:
        mc = g["monte_carlo"]
        rows.append([
            _P(g["name"]), g["years"], short_inr(g["future_cost"]), inr(g["required_sip"]),
            inr(g["allocated_sip"]), _P(sized_status(g["status"])), pct(mc["success_prob"], 0),
            inr(mc["sip_for_target_success"]),
        ])
    story += [Paragraph("Goals at a glance", H2),
              _tbl(rows, [W * x for x in (.18, .06, .12, .12, .12, .16, .12, .12)]),
              Paragraph(SUCCESS_PROB_NOTE, SMALL), PageBreak()]

    # 2. Profile
    story += [Paragraph("Your risk profile", H1)]
    cap = prof["capacity"]
    story += [Paragraph(
        f"Capacity to take risk <b>{cap['score']:.0f}</b> &nbsp;|&nbsp; Comfort with risk <b>{prof['tolerance']:.0f}</b> "
        f"&nbsp;|&nbsp; Final (lower of the two) <b>{prof['final_score']:.0f}</b> &rarr; <b>{xml_escape(prof['band'])}</b>", BODY)]
    for n in prof["notes"]:
        story += [Paragraph(xml_escape(n), BODY)]
    rows = [["Factor", "Your value", "Score", "Weight", "Contribution"]]
    for f in cap["factors"]:
        v = f["value"]
        if f["factor"] == "insurance":
            v = f"Term cover {inr(v['term_cover'])} vs need {inr(v['term_need'])}; health {inr(v['health_cover'])}"
        elif f["factor"] in ("savings_rate", "debt_burden"):
            v = pct(v)
        rows.append([FACTOR_LABELS[f["factor"]], _P(v), f["score"], f"{f['weight']:.0%}", f"{f['contribution']:.1f}"])
    story += [Spacer(1, 4), _tbl(rows, [W * x for x in (.28, .42, .08, .10, .12)]), PageBreak()]

    # 3. Allocation
    story += [Paragraph(ALLOCATION_HEADING, H1),
              _img(charts.donut(alloc["by_category"]), 120)]
    ac = alloc["by_asset_class"]
    story += [Paragraph(
        f"Equity {ac['equity']:.1f}% &nbsp; Debt {ac['debt']:.1f}% &nbsp; Gold {ac['gold']:.1f}% &nbsp; "
        f"Liquid {ac['liquid']:.1f}%. The mix is the goal-weighted average of per-goal allocations; shorter "
        "goals hold less equity.", BODY), Paragraph("Per-goal allocation", H2)]
    rows = [["Goal", "Years", "Equity", "Debt", "Gold", "Liquid"]]
    for g in alloc["per_goal"]:
        m = g["by_asset_class"]
        rows.append([_P(g["name"]), g["years"], f"{m['equity']:.0f}%", f"{m['debt']:.0f}%", f"{m['gold']:.0f}%",
                     f"{m['liquid']:.0f}%"])
    story += [_tbl(rows, [W * x for x in (.4, .1, .125, .125, .125, .125)]), PageBreak()]

    # 4. Shortlist
    story += [Paragraph(SHORTLIST_HEADING, H1)]
    rows = [["Fund", "Category", "Wt", "3Y", "5Y", "3Y vol", "Max DD", "Score", "Why it ranked"]]
    for f in r["funds"]:
        m = f["metrics"]
        rows.append([_P(f["scheme_name"]), _P(LABELS.get(f["cat"], f["cat"])), f"{f['weight_pct']:.1f}%",
                     pct(m["cagr_3y"]), pct(m["cagr_5y"]), pct(m["vol_3y"]), pct(m["max_drawdown_3y"]),
                     f"{f['score']:.2f}", _P("; ".join(f["explain"][:3]))])
    story += [_tbl(rows, [W * x for x in (.20, .10, .06, .06, .06, .06, .07, .06, .33)]),
              Paragraph("Direct plans carry lower expense ratios than the Regular plans shown. CAGR is "
                        "annualised, pre-tax, NAV-based. Past performance may or may not be sustained.", SMALL),
              Paragraph(SCHEME_DOCS_NOTE, SMALL)]
    if any(f["merged_from"] for f in r["funds"]):
        story += [Paragraph("Small positions are merged into the nearest fund so the list stays at 8 funds or fewer.", SMALL)]
    story += [PageBreak()]

    # 5. Stress
    story += [Paragraph("Stress test on past data", H1), _img(charts.stress_chart(stress["path"]), 175)]
    story += [_tbl([
        ["Feb-Mar 2020 fall", "Worst peak-to-trough", "Worst rolling 12 months"],
        [pct(stress["crash_2020_drawdown"]), pct(stress["worst_peak_to_trough"]), pct(stress["worst_rolling_12m"])]],
        [W / 3] * 3), Paragraph(xml_escape(stress["note"]) + " Funds without history for a period use the category median "
                                "return for that period." + (" Some funds here were substituted." if stress["any_substituted"] else ""), SMALL)]
    story += [PageBreak()]

    # 6. Goals (three per page)
    story += [Paragraph("Goal-by-goal plan", H1)]
    for i, g in enumerate(plan["goals"]):
        mc = g["monte_carlo"]
        if mc["p90"] <= 0:
            fan = Paragraph("No SIP is allocated for this goal in the current plan, so no projection chart is shown.", SMALL)
        else:
            fan = _img(charts.fan_chart(mc["fan"], g["future_cost"], f"{g['name']}: projected value"), 80)
        facts = [
            Paragraph(f"<b>{xml_escape(g['name'])}</b> ({g['years']} years, priority {g['priority']})", BODY),
            Paragraph(f"Future cost: <b>{short_inr(g['future_cost'])}</b> (inflation {g['inflation']:.0%})<br/>"
                      f"Expected return used: {g['expected_return']:.1%} a year<br/>"
                      f"SIP needed: <b>{inr(g['required_sip'])}</b>/month; allocated {inr(g['allocated_sip'])}<br/>"
                      f"Sized?: <b>{xml_escape(sized_status(g['status']))}</b> — not the same as likely to succeed<br/>"
                      f"P(success) with allocated SIP: <b>{pct(mc['success_prob'], 0)}</b><br/>"
                      f"P10 / P50 / P90 end value: {short_inr(mc['p10'])} / {short_inr(mc['p50'])} / {short_inr(mc['p90'])}<br/>"
                      f"SIP for about {mc['target_success']:.0%} chance: {inr(mc['sip_for_target_success'])}", BODY),
            Paragraph(TAX_PER_GOAL_NOTE, SMALL)]
        lv = g.get("levers")
        if lv:
            txt = []
            if lv.get("extend_horizon"):
                txt.append(f"extend by {lv['extend_horizon']['extra_years']} yr (SIP {inr(lv['extend_horizon']['required_sip'])})")
            for s in lv.get("step_up", []):
                txt.append(f"{s['step_up']:.0%} yearly step-up (first-year SIP {inr(s['first_year_sip'])})")
            if lv.get("lower_target"):
                txt.append(f"lower target to {inr(lv['lower_target']['target_today'])} in today's rupees")
            facts.append(Paragraph("Ways to close the gap: " + "; ".join(txt) + ".", SMALL))
        t = Table([[fan, facts]], colWidths=[W * 0.47, W * 0.53])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
        story += [KeepTogether([t, Spacer(1, 4)])]
    story += [PageBreak()]

    # 7. Insurance, emergency fund, assumptions
    ef, ins = plan["emergency_fund"], plan["insurance"]
    story += [Paragraph("Emergency fund and insurance", H1), _tbl([
        ["Emergency fund target", "Current", "Gap", "Months to close"],
        [f"{inr(ef['target'])} ({ef['target_months']} months)", inr(ef["current"]), inr(ef["gap"]),
         "-" if ef["months_to_close"] is None else str(ef["months_to_close"])]], [W / 4] * 4)]
    t = ins["term"]
    story += [Spacer(1, 6), _tbl([
        ["Cover", "Illustrative need", "Existing", "Gap"],
        ["Term life", inr(t["need"]), inr(t["cover"]), inr(t["gap"])],
        ["Health (family floater)", inr(ins["health"]["target"]), inr(ins["health"]["cover"]), inr(ins["health"]["gap"])]],
        [W * x for x in (.34, .22, .22, .22)])]
    ref = t["reference"]
    story += [Paragraph(f"Term need is a human-life-value estimate. Simple income rules for reference: "
                        f"15x income {inr(ref['15x_income'])}, 20x income {inr(ref['20x_income'])}.", SMALL)]
    sugg = r.get("insurance_suggestions") or {}
    blocks = [b for b in (sugg.get("term"), sugg.get("health")) if b]
    if blocks:
        story += [Spacer(1, 6), Paragraph("Cover plans worth researching (illustrative shortlist)", H2)]
        for b in blocks:
            title = "Term cover" if b["kind"] == "term" else "Health cover"
            pick = next((p for p in b["plans"] if p["marked_pick"]), b["plans"][0])
            story += [Paragraph(
                f"{title}: gap {inr(b['gap'])}. Marked pick — {xml_escape(pick['insurer'])} "
                f"{xml_escape(pick['plan'])} (claim settlement {xml_escape(pick['claim_settlement'])}).", BODY)]
            rows = [["Insurer", "Plan", "Claim settlement", "Key features"]]
            for p in b["plans"]:
                rows.append([
                    _P(("★ " if p["marked_pick"] else "") + p["insurer"]),
                    _P(p["plan"]),
                    _P(p["claim_settlement"]),
                    _P("; ".join(p["features"])),
                ])
            story += [_tbl(rows, [W * x for x in (.22, .24, .22, .32)])]
        story += [Paragraph(xml_escape(blocks[0]["note"]), SMALL)]
    story += [Paragraph("Rebalancing rules", H2)] + [Paragraph(f"• {xml_escape(x)}", BODY) for x in plan["rebalancing"]]
    story += [Paragraph("Tax", H2), Paragraph(TAX_INFO, BODY), Paragraph(SCHEME_DOCS_NOTE, SMALL)]
    story += [Paragraph("Assumptions used", H2)]
    a = r["assumptions"]
    rows = [["Assumption", "Value"],
            ["Expected returns (equity / debt / gold / liquid)",
             " / ".join(f"{a['asset_returns'][k]:.1%}" for k in ("equity", "debt", "gold", "liquid"))],
            ["Goal inflation (education / marriage / home / other)",
             f"{a['inflation']['education']:.0%} / {a['inflation']['child_marriage']:.0%} / {a['inflation']['home']:.0%} / {a['inflation']['custom']:.0%}"],
            ["Post-retirement return; life expectancy",
             f"{a['retirement']['post_retirement_return']:.1%}; {a['retirement']['life_expectancy']} years"],
            ["Simulation (mean return / volatility: equity)",
             f"{a['monte_carlo']['asset_mean']['equity']:.0%} / {a['monte_carlo']['asset_vol']['equity']:.0%}, {a['monte_carlo']['sims']:,} paths"],
            ["Rebalance band", f"{a['rebalancing']['drift_band_pp']} percentage points, reviewed annually"],
            ["Non-equity pre-tax haircut", "0% unless configured (SIPs are pre-tax illustrations)"]]
    story += [_tbl(rows, [W * .55, W * .45]), Paragraph(SUCCESS_PROB_NOTE, SMALL)]

    doc.build(story)
    return buf.getvalue()


def _wrap(text: str, width: int) -> list[str]:
    import textwrap
    return textwrap.wrap(text, width)
