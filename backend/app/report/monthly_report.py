from __future__ import annotations
"""Monthly client report (Paperwork Processing): parse the one-page bucket report
("PORTFOLIO XIRR" + "COMPLETE PORTFOLIO") that goes out every month, and render the
same one-page layout as a PDF.

This is a different document from the folio-wise valuation handled by
``client_report.py``: buckets, not funds. A folio-wise valuation uploaded alongside
is kept only as a cross-check total, never as the report itself.

Totals rule that matters: a bucket XIRR is a cash-flow figure for that bucket, so the
portfolio XIRR is carried from the source (or typed in) and is never an average of
the bucket XIRRs. Gains and weights, by contrast, are always recomputed from the
invested and current amounts.
"""

import io
import re
from typing import Any

from app.config.disclosures import ARN
from app.report.client_report import NOTES, extract_text, ind, parse_factsheet, parse_statement, summarize
from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

_NUM = re.compile(r"^[₹(]?-?[\d,]*\d(?:\.\d+)?%?\)?$")
_VALUE_ON = re.compile(r"Value As On[^0-9]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})", re.IGNORECASE)
_INCEPTION = re.compile(r"Inception Date[^A-Za-z0-9]*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", re.IGNORECASE)


def _num(tok: str) -> float:
    t = tok.replace("₹", "").replace(",", "").replace("%", "").strip("()")
    return -float(t) if tok.startswith("(") else float(t)


def _trailing5(tokens: list[str]) -> tuple[str, list[float]] | None:
    """Split a table line into (name, [invested, current, gain, weight, xirr])."""
    if len(tokens) < 6:
        return None
    tail = tokens[-5:]
    if not all(_NUM.match(t) for t in tail):
        return None
    return " ".join(tokens[:-5]), [_num(t) for t in tail]


def parse_monthly_buckets(text: str) -> dict[str, Any] | None:
    """Bucket table -> client header + buckets + PMS row + portfolio XIRR. None when no bucket rows."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    title_i = next((i for i, ln in enumerate(lines) if "portfolio xirr" in ln.lower()), -1)
    # A folio-wise valuation also has 5-number trailing runs, so a monthly report
    # is only recognised by its own markers, never by number shape alone.
    if title_i < 0 and "complete portfolio" not in text.lower():
        return None
    scan = lines[title_i + 1:] if title_i >= 0 else lines
    name = ""
    if title_i >= 0 and title_i + 1 < len(lines):
        nxt = lines[title_i + 1]
        if not re.search(r"(?i)value as on|inception|investments", nxt):
            name = nxt
    value_on = _VALUE_ON.search(text)
    inception = _INCEPTION.search(text)
    buckets: list[dict[str, Any]] = []
    pms: dict[str, Any] = {"invested": 0.0, "current": 0.0, "xirr": None}
    totals: dict[str, Any] | None = None
    total_xirr: float | None = None
    in_complete = False
    for ln in scan:
        low = ln.lower()
        if "complete portfolio" in low:
            in_complete = True
            continue
        if not in_complete:
            if re.match(r"(?i)^total\b", ln):
                parsed = _trailing5(ln.split())
                if parsed:
                    _, vals = parsed
                    totals = {"invested": vals[0], "current": vals[1], "gain": vals[2]}
                    total_xirr = vals[4]
                continue
            if re.search(r"(?i)portfolio xirr|investments|invested amount|mutual funds$", ln) and not _trailing5(ln.split()):
                continue
            if ln.split()[0].isdigit():
                continue  # folio-wise serial row, not a bucket
            parsed = _trailing5(ln.split())
            if parsed:
                bname, vals = parsed
                if bname.lower() in ("mutual funds",):
                    continue
                buckets.append({"name": bname, "invested": vals[0], "current": vals[1], "xirr": vals[4]})
            continue
        # COMPLETE PORTFOLIO section: only the PMS row carries new information.
        if re.match(r"(?i)^pms\b", ln):
            parsed = _trailing5(ln.split())
            if parsed:
                _, vals = parsed
                pms = {"invested": vals[0], "current": vals[1], "xirr": vals[4]}
    if not buckets:
        return None
    if totals is None:
        inv = sum(b["invested"] for b in buckets)
        cur = sum(b["current"] for b in buckets)
        totals = {"invested": inv, "current": cur, "gain": cur - inv}
    return {
        "client": {"name": name, "date": value_on.group(1) if value_on else "", "arn": "", "phone": ""},
        "inception": inception.group(1) if inception else "",
        "buckets": buckets,
        "pms": pms,
        "total_xirr": total_xirr,
        "totals": totals,
    }


def parse_monthly_files(files: list[tuple[str, bytes]]) -> dict[str, Any]:
    """Parse uploaded monthly reports, folio-wise valuations (cross-check only) and factsheets."""
    out: dict[str, Any] = {
        "client": {"name": "", "date": "", "arn": "", "phone": ""},
        "inception": "", "buckets": [], "pms": {"invested": 0.0, "current": 0.0, "xirr": None},
        "total_xirr": None, "valuation": None, "factsheets": [], "warnings": [],
    }
    for fname, data in files:
        try:
            text = extract_text(fname, data)
        except ValueError as e:
            out["warnings"].append(str(e))
            continue
        monthly = parse_monthly_buckets(text)
        if monthly:
            if out["buckets"]:
                out["warnings"].append(f"{fname}: a second monthly report was found; its bucket rows were ignored.")
            else:
                out["buckets"] = monthly["buckets"]
                out["pms"] = monthly["pms"]
                out["total_xirr"] = monthly["total_xirr"]
                out["inception"] = monthly["inception"]
                out["client"] = {k: out["client"][k] or v for k, v in monthly["client"].items()}
                if not (out["client"]["name"] and out["client"]["date"]):
                    out["warnings"].append(f"{fname}: client name or value-as-on date not detected; please fill them in. Review all values.")
            continue
        statement = parse_statement(text)
        if statement:
            if out["valuation"] is not None:
                out["warnings"].append(f"{fname}: a second valuation was found; the first one is kept as the cross-check.")
            else:
                s = summarize(statement)
                out["valuation"] = {
                    "invested": s["invested"], "value": s["value"], "gain": s["gain"],
                    "xirr": statement["xirr"], "date": statement["client"]["date"],
                    "rows": len(statement["rows"]),
                }
                out["client"] = {k: out["client"][k] or v for k, v in statement["client"].items()}
            continue
        fact = parse_factsheet(fname, text)
        if fact:
            out["factsheets"].append(fact)
        else:
            out["warnings"].append(f"{fname}: no monthly bucket rows, fund statement rows, or factsheet figures recognised.")
    if not out["client"]["arn"]:
        out["client"]["arn"] = ARN.replace("ARN ", "")
    return out


# ---------- totals + PDF ----------

def summarize_monthly(data: dict[str, Any]) -> dict[str, Any]:
    """Recompute gains and weights from the (possibly edited) buckets. XIRRs are never averaged."""
    buckets = data.get("buckets", [])
    inv = sum(b["invested"] for b in buckets)
    cur = sum(b["current"] for b in buckets)
    for b in buckets:
        b["gain"] = b["current"] - b["invested"]
        b["weight"] = b["current"] / cur * 100 if cur else 0.0
    pms = data.get("pms") or {"invested": 0.0, "current": 0.0, "xirr": None}
    pms_gain = pms["current"] - pms["invested"]
    comp_inv, comp_cur = inv + pms["invested"], cur + pms["current"]
    return {
        "invested": inv, "current": cur, "gain": cur - inv,
        "pms": {**pms, "gain": pms_gain,
                "weight": pms["current"] / comp_cur * 100 if comp_cur else 0.0},
        "complete": {"invested": comp_inv, "current": comp_cur, "gain": comp_cur - comp_inv,
                     "mf_weight": cur / comp_cur * 100 if comp_cur else 0.0,
                     "pms_weight": pms["current"] / comp_cur * 100 if comp_cur else 0.0},
    }


def _pct(v: float | None) -> str:
    return "-" if v is None else f"{v:.2f}%"


def build_monthly_report(data: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    t, c = summarize_monthly(data), data["client"]
    month = (data.get("month") or "").strip()
    inception = (data.get("inception") or "").strip()
    total_xirr = data.get("total_xirr")
    grey, ink = colors.HexColor("#9AA3B2"), colors.HexColor("#1B2333")
    blue = colors.HexColor("#E8EEFB")
    body = ParagraphStyle("mr", fontName=BODY_FONT, fontSize=9, leading=12, textColor=ink)
    bold = ParagraphStyle("mrb", parent=body, fontName=BOLD_FONT)
    right = ParagraphStyle("mrr", parent=body, alignment=2)
    right_b = ParagraphStyle("mrrb", parent=right, fontName=BOLD_FONT)
    head = ParagraphStyle("mrh", parent=bold, alignment=1, fontSize=8)
    small = ParagraphStyle("mrs", parent=body, fontSize=8, textColor=colors.HexColor("#5B6577"))
    P = lambda s, st=body: Paragraph(xml_escape(str(s)), st)  # noqa: E731

    story: list[Any] = [
        P("PORTFOLIO XIRR", ParagraphStyle("t", parent=bold, fontSize=16, leading=20)),
        P(c["name"], ParagraphStyle("n", parent=bold, fontSize=12, leading=15)),
        P(f"Value As On- {c['date']}", body),
        P(f"Inception Date - {inception}", body),
        Spacer(1, 6),
        P("Mutual funds", bold),
    ]
    cols = ["Investments", "Invested amount", "Current value", "Gain/losses", "Weightage (%)", "XIRR"]
    rows = [[P(h, head) for h in cols]]
    for b in data["buckets"]:
        rows.append([P(b["name"]), P(ind(b["invested"], 0), right), P(ind(b["current"], 0), right),
                     P(ind(b["gain"], 0), right), P(f"{b['weight']:.2f}%", right), P(_pct(b["xirr"]), right)])
    rows.append([P("Total", bold), P(ind(t["invested"], 0), right_b), P(ind(t["current"], 0), right_b),
                 P(ind(t["gain"], 0), right_b), P("100.00%", right_b), P(_pct(total_xirr), right_b)])
    table = Table(rows, colWidths=[52 * mm, 30 * mm, 30 * mm, 30 * mm, 22 * mm, 16 * mm], repeatRows=1)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, grey), ("BACKGROUND", (0, 0), (-1, 0), blue),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                               ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                               ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F3F6FC"))]))
    story += [table, Spacer(1, 10), P("COMPLETE PORTFOLIO", bold)]
    comp = t["complete"]
    pms = t["pms"]
    crows = [[P(h, head) for h in cols],
             [P("Mutual funds"), P(ind(t["invested"], 0), right), P(ind(t["current"], 0), right),
              P(ind(t["gain"], 0), right), P(f"{comp['mf_weight']:.2f}%", right), P(_pct(total_xirr), right)],
             [P("PMS"), P(ind(pms["invested"], 0), right), P(ind(pms["current"], 0), right),
              P(ind(pms["gain"], 0), right), P(f"{comp['pms_weight']:.2f}%", right), P(_pct(pms["xirr"]), right)],
             [P("Total", bold), P(ind(comp["invested"], 0), right_b), P(ind(comp["current"], 0), right_b),
              P(ind(comp["gain"], 0), right_b), P("100.00%", right_b), P(_pct(total_xirr), right_b)]]
    ctable = Table(crows, colWidths=[52 * mm, 30 * mm, 30 * mm, 30 * mm, 22 * mm, 16 * mm], repeatRows=1)
    ctable.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, grey), ("BACKGROUND", (0, 0), (-1, 0), blue),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                                ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F3F6FC"))]))
    story += [ctable, Spacer(1, 10),
              P(NOTES[1], small),
              P(f"AMFI Registered Mutual Fund Distributor, {ARN}.", small)]
    for fs in data.get("factsheets") or []:
        ft = Table([[P(fs["source"], bold), ""]] + [[P(it["label"]), P(it["value"])] for it in fs["items"]],
                   colWidths=[60 * mm, 120 * mm])
        ft.setStyle(TableStyle([("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), blue),
                                ("GRID", (0, 0), (-1, -1), 0.4, grey)]))
        story += [Spacer(1, 10), KeepTogether([P("Factsheet highlights", bold), Spacer(1, 3), ft])]

    def later(cv, _doc):
        cv.setFont(BODY_FONT, 7)
        cv.setFillColor(colors.HexColor("#5B6577"))
        cv.drawRightString(A4[0] - 15 * mm, A4[1] - 10 * mm,
                           f"Monthly report  |  {c['name']}  |  {c['date']}".replace("<", "‹"))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm,
                      bottomMargin=14 * mm,
                      title=f"{c['name']} Monthly report {month}".strip()).build(story, onLaterPages=later)
    return buf.getvalue()
