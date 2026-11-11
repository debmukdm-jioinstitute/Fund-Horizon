from __future__ import annotations
"""Monthly client report: parse uploaded statements/factsheets (text layer, else OCR) and render the
"Portfolio Valuation Report - Folio Wise" PDF. Google Sans only (see CLAUDE.md)."""

import hashlib
import html
import io
import re
import threading
import zipfile
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
    global _OCR
    with _OCR_LOCK:  # one OCR at a time: the CPU is already saturated, and identical pages queued behind hit the cache
        if key in _OCR_CACHE:
            return _OCR_CACHE[key]
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


_IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
_IMG_MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"BM", b"II*\x00", b"MM\x00*")


def is_pdf(name: str, data: bytes) -> bool:
    if b"%PDF" in data[:1024]:
        return True
    # content wins over the extension: a .docx/.xlsx/image/text file renamed .pdf is not a PDF
    return name.lower().endswith(".pdf") and not data.startswith((b"PK", b"\xd0\xcf\x11\xe0", *_IMG_MAGIC)) and b"\x00" not in data[:512]


def is_image(name: str, data: bytes) -> bool:
    return name.lower().endswith(_IMG_EXT) or data.startswith(_IMG_MAGIC) or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")


def _xml_text(xml: str) -> str:
    xml = re.sub(r"</(?:w:p|a:p|p|tr|div|br|li|h\d)\s*>|<(?:w:br|br)\s*/?>", "\n", xml)
    xml = re.sub(r"</(?:w:tc|td|th)\s*>", "   ", xml)
    return "\n".join(ln.strip() for ln in html.unescape(re.sub(r"<[^>]+>", "", xml)).splitlines() if ln.strip())


def _zip_text(name: str, data: bytes) -> str | None:
    """docx / pptx / odt / xlsx-as-zip -> text. None when the zip is not an office file."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return None
    names = z.namelist()
    if "word/document.xml" in names:
        parts = ["word/document.xml"]
    elif any(n.startswith("ppt/slides/slide") for n in names):
        parts = sorted((n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=lambda n: int(re.findall(r"\d+", n)[0]))
    elif "content.xml" in names:  # OpenDocument
        parts = ["content.xml"]
    else:
        return None
    return "\n".join(_xml_text(z.read(n).decode("utf-8", "replace")) for n in parts)


def _sheet_text(data: bytes) -> str:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    return "\n".join("   ".join(str(c) for c in row if c is not None)
                     for ws in wb.worksheets for row in ws.iter_rows(values_only=True) if any(c is not None for c in row))


def _decode(name: str, data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16") if data[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f"{name}: unsupported file type (not text, PDF, image, Word, Excel or PowerPoint).")
    if "\x00" in text[:2000] or sum(ch.isprintable() or ch in "\n\r\t" for ch in text[:4000]) < 0.9 * len(text[:4000]):
        raise ValueError(f"{name}: unsupported binary file type.")
    low = name.lower()
    if low.endswith((".csv", ".tsv")):
        import csv

        return "\n".join("   ".join(c.strip() for c in row if c.strip()) for row in csv.reader(io.StringIO(text), delimiter="\t" if low.endswith(".tsv") else ","))
    if low.endswith((".html", ".htm", ".xml")) or text.lstrip()[:15].lower().startswith(("<!doctype", "<html")):
        return _xml_text(re.sub(r"(?is)<(script|style)\b.*?</\1>", "", text))
    if low.endswith(".rtf") or text.startswith("{\\rtf"):
        return re.sub(r"\\[a-z]+-?\d* ?|[{}]", "", text.replace("\\par", "\n"))
    return text  # .md .txt .json .log and anything else that is plain text


def extract_text(name: str, data: bytes) -> str:
    """Any supported upload -> text. PDF: text layer, else OCR. Image: OCR. Word/Excel/PowerPoint/CSV/HTML/Markdown/plain text: read directly."""
    if not data:
        raise ValueError(f"{name}: the file is empty.")
    if is_image(name, data) and not is_pdf(name, data):
        from PIL import Image

        try:
            return "\n".join(_ocr_lines(Image.open(io.BytesIO(data))))
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"{name}: not a readable image ({e}).") from e
    if not is_pdf(name, data):
        if data.startswith(b"PK"):
            if name.lower().endswith((".xlsx", ".xlsm")) or b"xl/" in data[:4096] + data[-4096:]:
                try:
                    return _sheet_text(data)
                except Exception as e:
                    raise ValueError(f"{name}: not a readable Excel file ({e}).") from e
            text = _zip_text(name, data)
            if text is None:
                raise ValueError(f"{name}: unsupported archive (expected .docx, .xlsx or .pptx).")
            return text
        if data.startswith(b"\xd0\xcf\x11\xe0"):  # legacy OLE: .xls / .doc / .ppt
            if name.lower().endswith(".xls"):
                try:
                    import pandas as pd

                    return "\n".join("   ".join(str(c) for c in r if str(c) != "nan") for df in pd.read_excel(io.BytesIO(data), sheet_name=None, header=None).values() for r in df.values.tolist())
                except Exception as e:
                    raise ValueError(f"{name}: old .xls could not be read ({e}); save it as .xlsx and retry.") from e
            raise ValueError(f"{name}: old Word/PowerPoint format; save it as .docx/.pptx or PDF and retry.")
        return _decode(name, data)
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError(f"{name}: the PDF is password-protected; remove the password and retry.")
        pages = [p.extract_text(extraction_mode="layout") or "" for p in reader.pages]
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"{name}: not a readable PDF ({type(e).__name__}: {e}).") from e
    if len("".join(pages).strip()) >= 80:
        return "\n".join(pages)
    try:
        import pypdfium2  # noqa: F401
    except ImportError as e:  # pragma: no cover
        raise ValueError(f"{name}: scanned PDF needs OCR (pip install pypdfium2 rapidocr-onnxruntime).") from e
    return "\n".join("\n".join(ls) for ls in map(_ocr_lines, render_pages(data)))


# ---------- parsing ----------

def _trailing_numbers(tokens: list[str], n: int) -> list[str] | None:
    tail = tokens[-n:]
    return tail if len(tail) == n and len(tokens) > n and all(_NUM.match(t) for t in tail) else None


def parse_statement(text: str) -> dict[str, Any] | None:
    """Folio-wise or Transaction-wise valuation table -> client header + rows. None when no fund rows are found."""
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    head = "\n".join(lines[:16])
    title_i = next((i for i, ln in enumerate(lines) if "valuation report" in ln.lower()), -1)
    name = re.split(r"\s{2,}", lines[title_i + 1].strip())[0] if title_i >= 0 and title_i + 1 < len(lines) else ""
    date = re.search(r"\b\d{1,2}\s?[A-Z][a-z]{2}\s?\d{4}\b", head)
    arn, phone = re.search(r"ARN[:\s]*(\d+)", head), re.search(r"Phone[:\s]*(\d{8,})", head)
    client_hdr = {
        "name": name, "date": date.group(0) if date else "",
        "arn": arn.group(1) if arn else ARN.replace("ARN ", ""),
        "phone": phone.group(1) if phone else "",
    }

    # 1. Check for 'Portfolio Valuation Report - Transaction Wise' (per-scheme section headers + dated purchase rows + Sub Total)
    if "Transaction Wise" in head or re.search(r"Unrealised\s+Gain\s*/\s*\(Loss\)\s*:\s*₹", text):
        from app.backoffice.valuation.layouts import _TX_WISE_HDR, _TX_WISE_ROW, _TX_WISE_SUB

        tx_rows: list[dict[str, Any]] = []
        kpi_m = re.search(r"ANNUALISED\s+RETURN\s*\(XIRR\)\s*(?:\n|\s)+(-?[\d.]+)%", text[:2500], re.I)
        tx_xirr = float(kpi_m.group(1)) if kpi_m else None
        if tx_xirr is None:
            flat_head = re.sub(r"\s+", " ", head)
            m_flat = re.search(r"ANNUALISED RETURN \(XIRR\).*?(-?[\d.]+)%", flat_head)
            if m_flat:
                all_pcts = re.findall(r"(-?[\d.]+)%", flat_head[flat_head.find("INVESTED AMOUNT"):])
                if len(all_pcts) >= 2:
                    tx_xirr = float(all_pcts[1])
                else:
                    tx_xirr = float(m_flat.group(1))
        cur_sec: dict[str, Any] | None = None
        secs: list[dict[str, Any]] = []
        for ln in lines:
            s_ln = ln.strip()
            if m := _TX_WISE_HDR.match(s_ln):
                xs = m.group("xirr").rstrip("%").strip()
                cur_sec = {"name": re.sub(r"\s+", " ", m.group("name")).strip(), "abs_ret": _num(m.group("abs")),
                           "ann_ret": 0.0 if xs == "-" else _num(xs), "rows": [], "sub": None}
                secs.append(cur_sec)
            elif (m := _TX_WISE_ROW.match(s_ln)) and cur_sec is not None:
                cur_sec["rows"].append({
                    "folio": m.group("folio"), "inv": _num(m.group("inv")), "div_reinv": _num(m.group("div_reinv")),
                    "bal": _num(m.group("bal")), "cnav": _num(m.group("cnav")), "val": _num(m.group("val")),
                })
            elif (m := _TX_WISE_SUB.match(s_ln)) and cur_sec is not None:
                xs = m.group("xirr").rstrip("%").strip()
                cur_sec["sub"] = {"inv": _num(m.group("inv")), "val": _num(m.group("val")),
                                  "abs_ret": _num(m.group("abs")), "ann_ret": 0.0 if xs == "-" else _num(xs)}
        for sec in secs:
            r_list = sec["rows"]
            if not r_list:
                continue
            sub = sec["sub"]
            div_reinv = round(sum(r["div_reinv"] for r in r_list), 2)
            investments = round(sum(r["inv"] for r in r_list), 2)
            invested = sub["inv"] if sub else round(investments + div_reinv, 2)
            value = sub["val"] if sub else round(sum(r["val"] for r in r_list), 2)
            tx_rows.append({
                "name": sec["name"], "folio": r_list[-1]["folio"],
                "invested": invested, "investments": investments, "div_reinv": div_reinv, "div_payout": 0.0,
                "units": r_list[-1]["bal"], "nav": r_list[-1]["cnav"], "value": value,
                "weight": 0.0, "abs_ret": sec["abs_ret"], "ann_ret": sec["ann_ret"],
            })
        if tx_rows:
            tot_v = sum(r["value"] for r in tx_rows)
            for r in tx_rows:
                r["weight"] = round(r["value"] / tot_v * 100, 2) if tot_v else 0.0
            return {"client": client_hdr, "xirr": tx_xirr, "rows": tx_rows}

    # 2. Check for ProAffluence 'MF Summary Report'
    if "MF Summary Report" in text and "|" in text:
        pa_rows: list[dict[str, Any]] = []
        pa_xirr = None
        if g := re.search(r"Grand\s+total[^\n₹]*₹\s*([^\n]+)", text, re.I):
            g_nums = [_num(t) for t in re.findall(r"-?[\d,]+(?:\.\d+)?", g.group(1))]
            if len(g_nums) >= 6:
                pa_xirr = g_nums[5]
        elif g_multi := re.search(r"Grand\s+total([\s\S]{1,220})", text, re.I):
            g_nums = [_num(t) for t in re.findall(r"-?\d[\d,]*(?:\.\d+)?", g_multi.group(1))]
            if len(g_nums) >= 6:
                pa_xirr = g_nums[5]
        c_m = re.search(r"^[ \t]*([A-Za-z][A-Za-z .]{2,50}?)\s*\(([A-Z]{5}\d{4}[A-Z])\)", text, re.M)
        on_m = re.search(r"Report\s+as\s+on:?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})", text, re.I)
        hdr_re = re.compile(r"^\s*(?P<name>.+?\S)\s*\|\s*(?P<folio>[A-Za-z0-9/\-]+)\s*\|\s*(?P<holder>[A-Za-z][A-Za-z .]+?)\s*$")
        for idx, ln in enumerate(lines):
            hm = hdr_re.match(ln)
            if not hm:
                continue
            fig_ln = next((lines[k] for k in range(idx + 1, min(len(lines), idx + 5)) if "₹" in lines[k]), None)
            if not fig_ln:
                continue
            pre, post = fig_ln.split("₹", 1)
            pre_clean = re.sub(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", " ", pre)
            p_nums = [_num(t) for t in re.findall(r"\d[\d,]*(?:\.\d+)?", pre_clean)]
            post_nums = [_num(t) for t in re.findall(r"-?[\d,]+(?:\.\d+)?", post)]
            if len(post_nums) >= 2 and p_nums:
                inv, val = post_nums[0], post_nums[1]
                div_pay = post_nums[4] if len(post_nums) >= 5 else 0.0
                ann = post_nums[5] if len(post_nums) >= 6 else 0.0
                pa_rows.append({
                    "name": hm.group("name").strip(), "folio": hm.group("folio").strip(),
                    "invested": inv, "investments": inv, "div_reinv": 0.0, "div_payout": div_pay,
                    "units": p_nums[-1], "nav": p_nums[0], "value": val,
                    "weight": 0.0, "abs_ret": post_nums[3] if len(post_nums) >= 4 else 0.0, "ann_ret": ann,
                })
        if pa_rows:
            tot_v = sum(r["value"] for r in pa_rows)
            for r in pa_rows:
                r["weight"] = round(r["value"] / tot_v * 100, 2) if tot_v else 0.0
            return {
                "client": {
                    **client_hdr,
                    "name": client_hdr["name"] or (c_m.group(1).strip() if c_m else ""),
                    "date": client_hdr["date"] or (on_m.group(1).replace("-", " ") if on_m else ""),
                },
                "xirr": pa_xirr, "rows": pa_rows,
            }

    # 3. Folio-wise valuation table (10 trailing numeric columns per S.No row)
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
    return {"client": client_hdr, "xirr": xirr, "rows": rows}


def parse_factsheet(name: str, text: str) -> dict[str, Any] | None:
    items = []
    for label in _FACTS:
        m = re.search(rf"(?im)^\s*{re.escape(label)}\b[^\S\n]*[:\-]?[^\S\n]*(\S[^\n]{{0,60}})$", text)
        if m:
            items.append({"label": label, "value": re.sub(r"\s{2,}", "  ", m.group(1).strip())})
    title = next((ln.strip() for ln in text.splitlines() if re.search(r"(?i)fund|portfolio|pms|strategy", ln) and len(ln.strip()) < 90), name)
    return {"source": title, "items": items} if items else None


def parse_files(files: list[tuple[str, bytes]]) -> dict[str, Any]:
    from app.backoffice.valuation import bundle
    from app.report import statements

    out: dict[str, Any] = {"client": {"name": "", "date": "", "arn": ARN.replace("ARN ", ""), "phone": ""}, "xirr": None, "rows": [], "factsheets": [], "warnings": []}
    expanded: list[tuple[str, bytes, bool]] = []
    for name, data in files:
        if is_pdf(name, data):
            try:
                secs, _ = bundle.split(data)
            except Exception:
                secs = []
            if secs:
                stem = name.rsplit(".", 1)[0]
                expanded.extend((f"{stem} - {s['label']}.pdf", s["data"], True) for s in secs)
                continue
        expanded.append((name, data, False))
    for name, data, from_bundle in expanded:
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
        pms_st = statements.parse_pms(text)
        if pms_st:
            out["factsheets"].append(statements.pms_factsheet(pms_st))
            continue
        fs = parse_factsheet(name, text)
        if fs:
            out["factsheets"].append(fs)
        elif not from_bundle:
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
