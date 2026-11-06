"""Consolidated valuation PDF. Input is ONLY an approved snapshot payload: nothing here recomputes a financial figure
(only layout: formatting, ordering, page numbers). Fonts: Google Sans via app.report.fonts."""
from __future__ import annotations

import io
from datetime import date
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.config.disclosures import DISCLOSURE_LINES, FIRM
from app.engine.finmath import indian_format
from app.report import charts
from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

NAVY, BLUE, GREY, RULE = colors.HexColor("#0B2545"), colors.HexColor("#2F6FDE"), colors.HexColor("#5B6573"), colors.HexColor("#D9DEE6")
LOGO = Path(__file__).resolve().parents[2] / "report" / "assets" / "fund-horizon-logo.png"
PROVIDER_ANNEXURES = [("fundsindia", "Annexure A: Mutual funds (FundsIndia)"), ("proaffluence", "Annexure B: ProAffluence PMS"),
                      ("stallion", "Annexure C: Stallion PMS")]
PROVIDER_LABEL = {"fundsindia": "FundsIndia", "proaffluence": "ProAffluence", "stallion": "Stallion"}
ASSET_LABEL = {"mutual_fund": "Mutual funds", "equity": "Equity", "debt": "Debt", "cash": "Cash", "other": "Unclassified"}

H1 = ParagraphStyle("h1", fontName=BOLD_FONT, fontSize=15, leading=19, textColor=NAVY, spaceBefore=4, spaceAfter=6, keepWithNext=1)
H2 = ParagraphStyle("h2", fontName=BOLD_FONT, fontSize=10.5, leading=14, textColor=BLUE, spaceBefore=10, spaceAfter=4, keepWithNext=1)
P = ParagraphStyle("p", fontName=BODY_FONT, fontSize=8.5, leading=12, textColor=colors.HexColor("#1F2937"))
SM = ParagraphStyle("sm", parent=P, fontSize=7.5, leading=10, textColor=GREY)
CELL = ParagraphStyle("c", parent=P, fontSize=7.5, leading=9.5)
CELLR = ParagraphStyle("cr", parent=CELL, alignment=TA_RIGHT)


def _m(v: float | None) -> str:
    """Rupees with paise and Indian grouping; reuses the app's grouping helper for the whole-rupee part."""
    if v is None:
        return "Not available"
    rupees, paise = divmod(abs(round(v * 100)), 100)
    return f"{'-' if v < 0 and (rupees or paise) else ''}{indian_format(rupees)}.{paise:02d}"


def _pct(v: float | None, d: int = 2) -> str:
    return "Not available" if v is None else f"{v:.{d}f}%"


def _dt(s: str | None) -> str:
    try:
        return date.fromisoformat(s).strftime("%d %b %Y") if s else "-"
    except ValueError:
        return s or "-"


def _month(s: str) -> str:
    return date.fromisoformat(s + "-01").strftime("%B %Y")


def _tbl(rows: list[list[Any]], widths: list[float], right_from: int = 1, header: bool = True) -> Table:
    data = [[Paragraph(xml_escape(c), CELLR if i >= right_from else CELL) if not isinstance(c, Paragraph) else c for i, c in enumerate(r)] for r in rows]
    if header:
        data[0] = [Paragraph(f"<b>{xml_escape(c)}</b>", CELLR if i >= right_from else CELL) for i, c in enumerate(rows[0])]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 0.8, NAVY), ("LINEBELOW", (0, 1), (-1, -1), 0.25, RULE),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                           ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    return t


class _Numbered(rl_canvas.Canvas):
    meta: dict[str, str] = {}

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._pages: list[dict] = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._pages)
        for st in self._pages:
            self.__dict__.update(st)
            if self._pageNumber > 1:
                self.setFont(BODY_FONT, 7)
                self.setFillColor(GREY)
                self.setStrokeColor(RULE)
                self.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
                self.drawString(18 * mm, 10 * mm, self.meta.get("footer", ""))
                self.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {self._pageNumber} of {n}")
            super().showPage()
        super().save()


def build_pdf(payload: dict, client_name: str, version_no: int = 1, evidence: list[dict] | None = None) -> bytes:
    t, W = payload["totals"], A4[0] - 36 * mm
    un = payload.get("unavailable", {})
    month = _month(payload["report_month"])
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                            title=f"Consolidated valuation {month}", author=FIRM)
    S: list[Any] = []

    # 1 cover -------------------------------------------------------------
    if LOGO.exists():
        S.append(Image(str(LOGO), width=46 * mm, height=14 * mm, kind="proportional"))
    S += [Spacer(1, 60 * mm), Paragraph("Consolidated portfolio valuation", ParagraphStyle("t", parent=H1, fontSize=24, leading=30)),
          Paragraph(month, ParagraphStyle("m", parent=H2, fontSize=14, leading=18)), Spacer(1, 8 * mm),
          Paragraph(xml_escape(client_name), ParagraphStyle("cn", parent=P, fontName=BOLD_FONT, fontSize=13, leading=17)),
          Paragraph(f"Valuation date requested: {_dt(payload['valuation_date'])}", P),
          Paragraph(f"Provider valuation dates: {', '.join(_dt(d) for d in payload['valuation_dates']) or '-'}", P),
          Paragraph(f"Report version {version_no} · valuation revision {payload['revision_no']}", SM), Spacer(1, 40 * mm),
          Paragraph("Prepared from approved provider statements. Every figure in this document is taken from the approved valuation "
                    "snapshot and can be traced to a source file, page and row listed in the annexures.", SM), PageBreak()]

    # 2 client & reporting details -------------------------------------------
    S += [Paragraph("Client and reporting details", H1), _tbl([
        ["Client", client_name], ["Reporting month", month], ["Requested valuation date", _dt(payload["valuation_date"])],
        ["Accounts included", str(len(payload["accounts"]))], ["Source statements", str(len(payload["sources"]))]], [55 * mm, W - 55 * mm], 99, False)]
    S.append(Paragraph("Source statements", H2))
    S.append(_tbl([["File", "Provider", "Statement date", "SHA-256 (first 12)"]] +
                  [[s["filename"], PROVIDER_LABEL.get(s["provider"], s["provider"]), _dt(s["statement_date"]), s["sha256"][:12]] for s in payload["sources"]],
                  [W * .42, W * .18, W * .2, W * .2], 99))

    # 3-5 executive summary --------------------------------------------------
    S += [Paragraph("Executive portfolio summary", H1), _tbl([
        ["Measure", "Amount"], ["Current value", _m(t["total_value"])], ["Total invested", _m(t["invested"])],
        ["Gain / loss (current value less invested)", _m(t["gain"])], ["Absolute return", _pct(t["absolute_return_pct"])],
        ["Unrealised gain / loss (holdings)", _m(t["unrealised_gain"])], ["Realised gain / loss", _m(t["realised_gain"])],
        ["Net external flows in statements", _m(t["net_external_flows"])]], [W * .65, W * .35])]
    for k, why in un.items():
        S.append(Paragraph(f"<b>{xml_escape(k.replace('_', ' ').capitalize())}</b> is not shown: {xml_escape(why)}", SM))
    if len(payload["valuation_dates"]) > 1:
        S.append(Paragraph("Providers report different valuation dates; each provider is valued as at its own date (see the provider table).", SM))

    # 6 allocation -----------------------------------------------------------
    S.append(Paragraph("Asset allocation", H2))
    alloc = [a for a in payload["allocation"] if a["value"] and a["value"] > 0]
    if alloc:
        png = charts.donut({ASSET_LABEL.get(a["asset_type"], a["asset_type"]): a["pct"] or 0 for a in alloc})
        S.append(Image(io.BytesIO(png), width=100 * mm, height=80 * mm))
        S.append(_tbl([["Asset class", "Value", "Share"]] + [[ASSET_LABEL.get(a["asset_type"], a["asset_type"]), _m(a["value"]), _pct(a["pct"])] for a in alloc],
                      [W * .5, W * .3, W * .2]))

    # 7 provider table -------------------------------------------------------
    S.append(Paragraph("Provider-wise valuation", H1))
    S.append(_tbl([["Provider", "Accounts", "Valuation date", "Value", "Share", "Invested", "Gain / loss"]] +
                  [[PROVIDER_LABEL.get(p["provider"], p["provider"]), str(p["accounts"]), ", ".join(_dt(d) for d in p["valuation_dates"]),
                    _m(p["value"]), _pct(p["pct"]), _m(p["invested"]), _m(p["gain"])] for p in payload["provider_contribution"]] +
                  [["Total", str(len(payload["accounts"])), "", _m(t["total_value"]), "100.00%", _m(t["invested"]), _m(t["gain"])]],
                  [W * .15, W * .09, W * .19, W * .15, W * .1, W * .16, W * .16], 1))
    S.append(Paragraph("Account detail", H2))
    S.append(_tbl([["Provider", "Account", "Basis", "Closing value", "Invested", "Cash-flow history"]] +
                  [[PROVIDER_LABEL.get(a["provider"], a["provider"]), a["account_no"] or "-", (a["value_basis"] or "").replace("_", " "), _m(a["closing_value"]),
                    _m(a["invested"]), "Confirmed complete" if a["flows_complete"] else "Not confirmed"] for a in payload["accounts"]],
                  [W * .14, W * .18, W * .2, W * .16, W * .16, W * .16], 3))

    # 8-10 annexures ---------------------------------------------------------
    for pid, title in PROVIDER_ANNEXURES:
        S.append(PageBreak())
        S.append(Paragraph(title, H1))
        accts = [a for a in payload["accounts"] if a["provider"] == pid]
        if not accts:
            S.append(Paragraph("No statement was received from this provider for the reporting month.", P))
            continue
        for a in accts:
            S.append(Paragraph(f"Account {xml_escape(a['account_no'] or 'not stated')} · valued {_dt(a['valuation_date'])} · "
                               f"{_m(a['closing_value'])}", H2))
            hs = [h for h in payload["holdings"] if h["provider"] == pid and h["account_no"] == a["account_no"]]
            rows = [["Security / scheme", "ISIN", "Qty / units", "Avg cost", "Invested", "Price", "Market value", "Gain", "Source"]]
            rows += [[h["security_name"], h["isin"] or "-", "-" if h["quantity"] is None else f"{h['quantity']:,.4f}".rstrip("0").rstrip("."),
                      _short(h["avg_cost"]), _short(h["invested_amount"]), _short(h["price"]), _short(h["market_value"]), _short(h["gain"]),
                      f"{h['source_page'] or ''} r{h['source_row'] or ''}"] for h in hs]
            S.append(_tbl(rows, [W * .21, W * .12, W * .07, W * .08, W * .1, W * .08, W * .11, W * .11, W * .12], 2))
            if a["value_basis"] == "holdings_plus_cash" and a["cash_added"]:
                S.append(Paragraph(f"Cash balance of {_m(a['cash_added'])} is separate from the holdings above and is included in the closing value.", SM))
            fl = [f for f in payload["flows"] if f["account_key"] == a["key"]]
            if fl:
                S.append(Paragraph("Cash flows in statement", H2))
                S.append(_tbl([["Date", "Type", "Amount", "Counted as external"]] + [[_dt(f["flow_date"]), f["kind"].replace("_", " "), _m(f["amount"]),
                                                                                     "Yes" if f["external"] and f["kind"] in ("deposit", "withdrawal", "transfer_in", "transfer_out") else "No"] for f in fl],
                              [W * .2, W * .3, W * .25, W * .25], 2))

    # 11 holding-level (all providers, never merged across accounts) ------------
    S += [PageBreak(), Paragraph("Holding-level details", H1),
          Paragraph("Holdings are listed per provider account. Identical securities held in different accounts are shown separately.", SM)]
    S.append(_tbl([["Security", "Provider / account", "Market value", "Weight", "Prev. month"]] +
                  [[h["security_name"], f"{PROVIDER_LABEL.get(h['provider'], h['provider'])} / {h['account_no'] or '-'}", _m(h["market_value"]),
                    _pct(h["weight_pct"]), _m(h["prev_market_value"]) if h["prev_market_value"] is not None else "-"] for h in payload["holdings"]],
                  [W * .38, W * .26, W * .14, W * .08, W * .14], 2))

    # 12 performance ---------------------------------------------------------
    pf = payload["performance"]["consolidated"]
    S.append(Paragraph("Performance metrics", H1))
    rows = [["Metric", "Result", "Basis / reason"]]
    for label, k in (("XIRR (since inception, annualised)", "xirr"), ("Modified Dietz (month)", "modified_dietz"), ("CAGR", "cagr")):
        r = pf[k]
        rows.append([label, _pct(r["value"]) if r.get("value") is not None else "Not available", r.get("method") or r.get("reason") or ""])
    S.append(_tbl(rows, [W * .3, W * .18, W * .52], 1))
    S.append(Paragraph("Consolidated XIRR is computed from the combined dated external cash flows of all accounts; it is never an average of provider "
                       "figures. A metric is shown only when its inputs are complete.", SM))

    # 12b provider-reported returns --------------------------------------------
    rp = payload.get("reported") or {}
    S.append(Paragraph("Returns printed by providers", H2))
    if rp.get("statement_xirr"):
        S.append(_tbl([["Provider / strategy", "Account", "Return (% p.a.)", "Basis"]] + [
            [f"{PROVIDER_LABEL.get(r['provider'], r['provider'])}{' / ' + r['strategy'] if r.get('strategy') else ''}", r.get("account_no") or "-",
             _pct(r["xirr_pct"]), r["basis"] + (f" (since {_dt(r['since'])})" if r.get("since") else "")] for r in rp["statement_xirr"]],
            [W * .3, W * .14, W * .14, W * .42], 2))
    d = rp.get("dashboard")
    if d:
        S.append(Paragraph("Distributor dashboard cross-check", H2))
        S.append(_tbl([["Measure", "Value"], ["Dashboard since-inception XIRR (portfolio / MF / PMS / stock)",
                       " / ".join(_pct(d["xirr_by_class"].get(k)) for k in ("portfolio", "mf", "pms", "stock")) if d.get("xirr_by_class") else "-"],
                       [f"Dashboard value, FY {d['latest_fy']}", _m(d["latest_value"])], ["Sum of this report's statements from the same bundle", _m(d["statements_total"])],
                       ["Difference", f"{_m(d['difference'])} ({_pct(d['difference_pct'])})"]], [W * .62, W * .38]))
        S.append(Paragraph(xml_escape(d["xirr_basis"]) + ". A non-zero difference means the dashboard and the statements use different dates or "
                           "scope; it has not been adjusted.", SM))
    S.append(Paragraph("These are the providers' own printed figures, shown with their source. They are not recomputed by Fund Horizon unless "
                       "dated cash flows are present (see Performance metrics).", SM))

    # 13 month on month ------------------------------------------------------
    S.append(Paragraph("Month-on-month comparison", H1))
    mom = payload.get("month_on_month")
    if not mom:
        S.append(Paragraph("No earlier approved valuation exists for this client, so no comparison is shown.", P))
    else:
        S.append(_tbl([["Measure", "Amount"], [f"Value at {_dt(mom['previous_valuation_date'])} ({_month(mom['previous_month'])})", _m(mom["previous_total"])],
                       ["Value now", _m(t["total_value"])], ["Change", f"{_m(mom['change'])} ({_pct(mom['change_pct'])})"],
                       ["Net external flows", _m(mom["net_external_flows"])], ["Market and other movement", _m(mom["market_and_other_change"])]],
                      [W * .65, W * .35]))
        S.append(_tbl([["Provider", "Now", "Previous", "Change"]] + [[PROVIDER_LABEL.get(p["provider"], p["provider"]), _m(p["value"]), _m(p["previous"]),
                                                                       _m(p["change"])] for p in mom["by_provider"]], [W * .34, W * .22, W * .22, W * .22]))

    # Annexure D: fund factsheet data ---------------------------------------------
    fs = payload.get("fund_sheets") or []
    if fs:
        S += [PageBreak(), Paragraph("Annexure D: Mutual fund factsheet data", H1),
              Paragraph("Each statement line is matched to an AMFI scheme only when its name and its NAV both agree. Figures are from AMFI NAV history "
                        "(Fund Horizon dataset) as on the date shown; returns above one year are annualised. Lines that could not be matched are listed "
                        "without data.", SM)]
        f1 = lambda v, d=2: "-" if v is None else f"{v:.{d}f}"  # noqa: E731
        S.append(_tbl([["Scheme (AMFI)", "NAV (as on)", "AUM Cr", "1Y %", "3Y %", "5Y %", "10Y %", "Since launch %", "NAV check"]] + [
            [e["scheme_name"], f"{f1(e['data']['latest_nav'])} ({e['data']['latest_nav_date']})", f1(e["data"]["aum_cr"], 0), f1(e["data"]["ret_1y"]),
             f1(e["data"]["cagr_3y"]), f1(e["data"]["cagr_5y"]), f1(e["data"]["cagr_10y"]), f1(e["data"]["cagr_since_inception"]),
             {True: "Agrees", False: f"Differs {e['nav_check'].get('difference_pct')}%"}.get(e["nav_check"].get("ok"), "Not comparable")]
            for e in fs if e["matched"]], [W * .27, W * .15, W * .08, W * .07, W * .07, W * .07, W * .07, W * .1, W * .12], 1))
        S.append(Paragraph("Risk (3 years)", H2))
        S.append(_tbl([["Scheme (AMFI)", "Category", "Volatility %", "Sharpe", "Max drawdown %", "Beta", "Alpha %"]] + [
            [e["scheme_name"], e["data"]["category"] or "-", f1(e["data"]["vol_3y"]), f1(e["data"]["sharpe_3y"]), f1(e["data"]["max_drawdown_3y"]),
             f1(e["data"]["beta_3y"]), f1(e["data"]["alpha_3y"])] for e in fs if e["matched"]], [W * .3, W * .2, W * .1, W * .08, W * .12, W * .1, W * .1], 2))
        miss = [e for e in fs if not e["matched"]]
        if miss:
            S.append(Paragraph("Not matched (no data shown)", H2))
            S.append(_tbl([["Statement line", "Reason"]] + [[e["security_name"], e["match"]] for e in miss], [W * .45, W * .55], 99))
        if evidence is not None:
            S.append(Paragraph("Official AMC factsheet pages", H2))
            S.append(_tbl([["Scheme", "AMC factsheet", "Period", "Status", "Pages"]] + [
                [e["scheme"], e["amc"], e.get("period") or "-", e["status"], str(e["pages"])] for e in evidence], [W * .3, W * .2, W * .1, W * .32, W * .08], 99))
            S.append(Paragraph("Pages that follow this report are cut unmodified from the AMC's own factsheet PDF (source URL and SHA-256 are in the "
                               "report audit record).", SM))

    # 14 methodology & disclosures --------------------------------------------
    S += [PageBreak(), Paragraph("Methodology and disclosures", H1)]
    rec = payload["reconciliation"]
    for line in [
        "Values are taken from provider statements as received and checked against each provider's own printed totals within a stated rounding tolerance.",
        "Cash is added to a provider valuation only where the provider's total shows it is separate from the listed holdings; cash already inside a provider total is not counted twice.",
        "Accounts are never merged. Securities are matched by ISIN and account; names alone are not used to combine holdings.",
        "XIRR uses dated external cash flows (deposits and withdrawals) and each account's closing value on its own valuation date. Internal transfers between accounts are excluded.",
        "Modified Dietz is shown only when every account has an opening value for the same period. CAGR is shown only for a window of at least 90 days with no external flows.",
        "Where a source figure is missing it is shown as Not available; no value has been estimated.",
        f"Reconciliation run {rec.get('run_no')}: {rec.get('passed', 0)} checks passed, {rec.get('warnings_open', 0)} warning(s) open, "
        f"{len(rec.get('resolutions', []))} exception(s) resolved or overridden by a reviewer."]:
        S.append(Paragraph("• " + xml_escape(line), P))
    if rec.get("resolutions"):
        S.append(Paragraph("Reviewer resolutions", H2))
        S.append(_tbl([["Check", "Status", "Difference", "Reason"]] + [[r["check"].replace("_", " "), r["status"], _m(r["difference"]), r["reason"] or ""] for r in rec["resolutions"]],
                      [W * .25, W * .13, W * .15, W * .47], 99))
    S.append(Paragraph("Disclosures", H2))
    for d in DISCLOSURE_LINES:
        S.append(Paragraph("• " + xml_escape(d), SM))
    S.append(Paragraph("This document reports holdings and values taken from provider statements. It is not an official provider statement.", SM))

    _Numbered.meta = {"footer": f"{FIRM} · Consolidated valuation · {client_name} · {month} · v{version_no}"}
    doc.build(S, canvasmaker=_Numbered)
    return buf.getvalue()


def _short(v: float | None) -> str:
    return "-" if v is None else f"{v:,.2f}"
