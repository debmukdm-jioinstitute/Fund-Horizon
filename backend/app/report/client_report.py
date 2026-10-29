from __future__ import annotations
"""Monthly client report: parse uploaded statements/factsheets (text layer, else OCR) and render the
"Portfolio Valuation Report - Folio Wise" PDF. Google Sans only (see CLAUDE.md)."""

import hashlib
import io
import re
import threading
from typing import Any

from app.config.disclosures import ARN, FIRM
from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

ROW_FIELDS = ("invested", "investments", "div_reinv", "div_payout", "units", "nav", "value", "weight", "abs_ret", "ann_ret")
NOTES = [
    "Annualized Return is calculated on an Absolute basis for < 1 Year And on XIRR basis for >= 1 Year.",
    f"This Report is Strictly Private and confidential only for clients of {FIRM}. The Information given above is correct and to the best of our knowledge.",
]
_NUM = re.compile(r"^[₹(]?-?[\d,]*\d(?:\.\d+)?%?\)?$")
_FACTS = ("AUM", "NAV", "Expense Ratio", "Benchmark", "Exit Load", "Fund Manager", "Riskometer", "Inception Date", "Minimum Investment",
          "1 Year", "3 Year", "5 Year", "Since Inception", "Standard Deviation", "Sharpe Ratio", "Portfolio Turnover")


def _num(tok: str) -> float:
    t = tok.replace("₹", "").replace(",", "").replace("%", "").strip("()")
    return -float(t) if tok.startswith("(") else float(t)


def ind(v: float | None, d: int = 2) -> str:
    """Indian digit grouping: 3,23,64,866.08."""
    if v is None:
        return "-"
    i, _, f = f"{abs(v):.{d}f}".partition(".")
    if len(i) > 3:
        i = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", i[:-3]) + "," + i[-3:]
    return ("-" if v < 0 and float(f"{abs(v):.{d}f}") else "") + i + (f".{f}" if d else "")


# ---------- text extraction (text layer first, OCR fallback) ----------

_OCR_LOCK = threading.Lock()
_OCR_CACHE: dict[bytes, list] = {}  # same page OCR'd twice (text pass + FundsIndia box pass) or re-uploaded -> instant


def _ocr_raw(img: Any) -> list:
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as e:  # pragma: no cover - optional heavy dependency
        raise ValueError("OCR engine not installed (pip install rapidocr-onnxruntime pypdfium2).") from e
    rgb = img.convert("RGB")
    key = hashlib.blake2b(rgb.tobytes(), digest_size=16).digest()
    if key in _OCR_CACHE:
        return _OCR_CACHE[key]
    global _OCR
    with _OCR_LOCK:
        _OCR = globals().get("_OCR") or RapidOCR()
    res, _ = _OCR(np.asarray(rgb))
    if len(_OCR_CACHE) >= 64:
        _OCR_CACHE.pop(next(iter(_OCR_CACHE)))
    _OCR_CACHE[key] = res or []
    return _OCR_CACHE[key]


def _ocr_boxes(img: Any) -> list[tuple[float, float, str]]:
    """(left x, centre y, text) per OCR box, in image pixels."""
    return [(b[0][0], (b[0][1] + b[3][1]) / 2, t) for b, t, _ in _ocr_raw(img)]


def _ocr_lines(img: Any) -> list[str]:
    res = _ocr_raw(img)
    boxes = sorted(((sum(p[1] for p in b) / 4, b[0][0], t, abs(b[3][1] - b[0][1])) for b, t, _ in (res or [])), key=lambda r: (r[0], r[1]))
    lines: list[list[tuple[float, str]]] = []
    ys: list[float] = []
    for y, x, t, h in boxes:
        if lines and abs(y - ys[-1]) < max(h, 8) * 0.6:
            lines[-1].append((x, t))
        else:
            lines.append([(x, t)])
            ys.append(y)
    return ["   ".join(t for _, t in sorted(ln)) for ln in lines]


_PDFIUM_LOCK = threading.Lock()


def render_pages(data: bytes, scale: float = 3) -> list:
    """PDF -> PIL pages. PDFium is not thread-safe, so rendering is serialised; OCR stays parallel."""
    import pypdfium2

    with _PDFIUM_LOCK:
        pdf = pypdfium2.PdfDocument(data)
        return [pdf[i].render(scale=scale).to_pil() for i in range(len(pdf))]


def extract_text(name: str, data: bytes) -> str:
    if name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        from PIL import Image

        return "\n".join(_ocr_lines(Image.open(io.BytesIO(data))))
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [p.extract_text(extraction_mode="layout") or "" for p in reader.pages]
    except Exception as e:
        raise ValueError(f"{name}: not a readable PDF.") from e
    if len("".join(pages).strip()) >= 80:
        return "\n".join(pages)
    try:
        import pypdfium2
    except ImportError as e:  # pragma: no cover
        raise ValueError(f"{name}: scanned PDF needs OCR (pip install pypdfium2 rapidocr-onnxruntime).") from e
    return "\n".join("\n".join(ls) for ls in map(_ocr_lines, render_pages(data)))


# ---------- parsing ----------

def _trailing_numbers(tokens: list[str], n: int) -> list[str] | None:
    tail = tokens[-n:]
    return tail if len(tail) == n and len(tokens) > n and all(_NUM.match(t) for t in tail) else None


def parse_statement(text: str) -> dict[str, Any] | None:
    """Folio-wise valuation table -> client header + rows. None when no fund rows are found."""
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    rows: list[dict[str, Any]] = []
    xirr = None
    for ln in lines:
        tok = ln.split()
        if re.match(r"(?i)^grand\s+total", ln.strip()):
            tail = [t for t in tok if _NUM.match(t)]
            xirr = _num(tail[-1]) if len(tail) >= 2 else None
            break
        nums = _trailing_numbers(tok, len(ROW_FIELDS))
        if nums and tok[0].isdigit():
            rows.append({"name": " ".join(tok[1:-len(ROW_FIELDS) - 1]), "folio": tok[-len(ROW_FIELDS) - 1], **dict(zip(ROW_FIELDS, map(_num, nums)))})
        elif rows and sum(bool(_NUM.match(t)) for t in tok) < 3 and not re.search(r"(?i)s\.?\s*no|fund name|folio|invested|\(a\s*\+|current|note", ln):
            rows[-1]["name"] += " " + " ".join(tok)  # wrapped fund name
    if not rows:
        return None
    head = "\n".join(lines[:12])
    title_i = next((i for i, ln in enumerate(lines) if "valuation report" in ln.lower()), -1)
    name = re.split(r"\s{2,}", lines[title_i + 1].strip())[0] if title_i >= 0 and title_i + 1 < len(lines) else ""
    date = re.search(r"\b\d{1,2}\s?[A-Z][a-z]{2}\s?\d{4}\b", head)
    arn, phone = re.search(r"ARN[:\s]*(\d+)", head), re.search(r"Phone[:\s]*(\d{8,})", head)
    return {
        "client": {"name": name, "date": date.group(0) if date else "", "arn": arn.group(1) if arn else ARN.replace("ARN ", ""), "phone": phone.group(1) if phone else ""},
        "xirr": xirr, "rows": rows,
    }


def parse_factsheet(name: str, text: str) -> dict[str, Any] | None:
    items = []
    for label in _FACTS:
        m = re.search(rf"(?im)^\s*{re.escape(label)}\b[^\S\n]*[:\-]?[^\S\n]*(\S[^\n]{{0,60}})$", text)
        if m:
            items.append({"label": label, "value": re.sub(r"\s{2,}", "  ", m.group(1).strip())})
    title = next((ln.strip() for ln in text.splitlines() if re.search(r"(?i)fund|portfolio|pms|strategy", ln) and len(ln.strip()) < 90), name)
    return {"source": title, "items": items} if items else None


def parse_files(files: list[tuple[str, bytes]]) -> dict[str, Any]:
    out: dict[str, Any] = {"client": {"name": "", "date": "", "arn": ARN.replace("ARN ", ""), "phone": ""}, "xirr": None, "rows": [], "factsheets": [], "warnings": []}
    for name, data in files:
        try:
            text = extract_text(name, data)
        except ValueError as e:
            out["warnings"].append(str(e))
            continue
        st = parse_statement(text)
        if st:
            if out["rows"]:
                out["warnings"].append(f"{name}: a second statement was found; its rows were appended.")
            out["rows"] += st["rows"]
            out["xirr"] = out["xirr"] if out["xirr"] is not None else st["xirr"]
            out["client"] = {k: out["client"][k] or v for k, v in st["client"].items()}
            if not (out["client"]["name"] and out["client"]["date"]):
                out["warnings"].append(f"{name}: client name or date not detected (scan quality?); please fill them in. Review all OCR values.")
            continue
        fs = parse_factsheet(name, text)
        if fs:
            out["factsheets"].append(fs)
        else:
            out["warnings"].append(f"{name}: no fund statement rows or factsheet figures recognised.")
    return out


# ---------- totals + PDF ----------

def summarize(data: dict[str, Any]) -> dict[str, Any]:
    """Recompute gain, weights and absolute returns from the (possibly edited) rows."""
    rows = data.get("rows", [])
    inv, val = sum(r["invested"] for r in rows), sum(r["value"] for r in rows)
    for r in rows:
        r["weight"] = r["value"] / val * 100 if val else 0.0
        r["abs_ret"] = (r["value"] / r["invested"] - 1) * 100 if r["invested"] else 0.0
    return {"invested": inv, "value": val, "gain": val - inv, "abs_ret": (val / inv - 1) * 100 if inv else 0.0,
            "investments": sum(r["investments"] for r in rows), "div_reinv": sum(r["div_reinv"] for r in rows), "div_payout": sum(r["div_payout"] for r in rows)}


def build_client_report(data: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    t, c = summarize(data), data["client"]
    blue, grey, ink = colors.HexColor("#E8EEFB"), colors.HexColor("#9AA3B2"), colors.HexColor("#1B2333")
    body = ParagraphStyle("cr", fontName=BODY_FONT, fontSize=7.4, leading=9, textColor=ink)
    bold = ParagraphStyle("crb", parent=body, fontName=BOLD_FONT)
    right = ParagraphStyle("crr", parent=body, alignment=2)
    right_b = ParagraphStyle("crrb", parent=right, fontName=BOLD_FONT)
    head = ParagraphStyle("crh", parent=bold, alignment=1, fontSize=6.6)
    small = ParagraphStyle("crs", parent=body, fontSize=6.6, textColor=colors.HexColor("#5B6577"))
    P = lambda s, st=body: Paragraph(xml_escape(s), st)  # noqa: E731

    left_head = [P("Portfolio Valuation Report - Folio Wise", ParagraphStyle("t", parent=bold, fontSize=16, leading=20)),
                 P(c["name"], ParagraphStyle("n", parent=bold, fontSize=11, leading=14)), P(c["date"], ParagraphStyle("d", parent=body, fontSize=9))]
    right_head = [P(FIRM, ParagraphStyle("f", parent=right_b, fontSize=13, leading=17)),
                  P(f"ARN: {c['arn']}  |  Phone: {c['phone']}", ParagraphStyle("a", parent=right, fontSize=8.5)),
                  P("AMFI Registered Mutual Fund Distributor", ParagraphStyle("m", parent=right, fontSize=8.5))]
    top = Table([[left_head, right_head]], colWidths=[170 * mm, 107 * mm])
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 0.5, grey), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))

    kp = [("INVESTED AMOUNT", "₹" + ind(t["invested"])), ("CURRENT VALUE", "₹" + ind(t["value"])), ("UNREALISED GAIN / (LOSS)", "₹" + ind(t["gain"])),
          ("ABSOLUTE RETURN", f"{ind(t['abs_ret'])}%"), ("ANNUALISED RETURN (XIRR)", "-" if data.get("xirr") is None else f"{ind(data['xirr'])}%")]
    kpi = Table([[[P(k, ParagraphStyle("kl", parent=body, fontSize=6.6, textColor=colors.HexColor("#5B6577"))), P(v, ParagraphStyle("kv", parent=bold, fontSize=13, leading=17))] for k, v in kp]],
                colWidths=[55.4 * mm] * 5)
    kpi.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), blue), ("ROUNDEDCORNERS", [6, 6, 6, 6]), ("LINEAFTER", (0, 0), (-2, -1), 4, colors.white),
                             ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7), ("LEFTPADDING", (0, 0), (-1, -1), 9)]))

    cols = ["S. No", "Fund Name", "Folio Number", "Total Invested Amount (₹) (A + B)", "Investments (₹) (A)", "Dividend Reinvested (B)", "Dividend Payout", "Current Units",
            "Current NAV (₹)", "Current Market Value (₹)", "Portfolio Weightage (%)", "Absolute Return (%)", "Annualised Return (%)"]
    rows = [[P(h, head) for h in cols]]
    for i, r in enumerate(data["rows"], 1):
        rows.append([P(str(i), right), P(r["name"]), P(r["folio"]), *[P(ind(r[k]), right) for k in ("invested", "investments", "div_reinv", "div_payout", "units", "nav", "value")],
                     P(f"{r['weight']:.2f}%", right), P(f"{r['abs_ret']:.2f}%", right), P(f"{r['ann_ret']:.2f}%", right)])
    rows.append([P(""), P("Grand Total", bold), P(""), P(ind(t["invested"]), right_b), P(ind(t["investments"]), right_b), P(ind(t["div_reinv"]), right_b), P(ind(t["div_payout"]), right_b),
                 P(""), P(""), P(ind(t["value"]), right_b), P("100.00%", right_b), P(f"{t['abs_ret']:.2f}%", right_b), P("-" if data.get("xirr") is None else f"{data['xirr']:.2f}%", right_b)])
    widths = [8, 48, 22, 24, 23, 19, 16, 22, 16, 26, 17, 17, 19]
    table = Table(rows, colWidths=[w * mm for w in widths], repeatRows=1)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, grey), ("BACKGROUND", (0, 0), (-1, 0), blue), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                               ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F3F6FC"))]))

    story: list[Any] = [top, Spacer(1, 8), kpi, Spacer(1, 10), table, Spacer(1, 8), P("Note:", bold)]
    story += [P(f"{i}. {n}", small) for i, n in enumerate(NOTES, 1)]
    for fs in data.get("factsheets") or []:
        ft = Table([[P(fs["source"], bold), ""]] + [[P(it["label"]), P(it["value"])] for it in fs["items"]], colWidths=[60 * mm, 100 * mm])
        ft.setStyle(TableStyle([("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), blue), ("GRID", (0, 0), (-1, -1), 0.4, grey)]))
        story += [Spacer(1, 10), KeepTogether([P("Factsheet highlights", bold), Spacer(1, 3), ft])]

    def later(cv, _doc):
        cv.setFont(BODY_FONT, 7)
        cv.setFillColor(colors.HexColor("#5B6577"))
        cv.drawRightString(landscape(A4)[0] - 10 * mm, landscape(A4)[1] - 7 * mm, f"Portfolio Valuation Report - Folio Wise  |  {c['name']}  |  {c['date']}".replace("<", "‹"))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=11 * mm, bottomMargin=10 * mm,
                      title=f"Portfolio Valuation Report - {c['name']}").build(story, onLaterPages=later)
    return buf.getvalue()
