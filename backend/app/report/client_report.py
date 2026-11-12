"""Monthly client report: parse ANY uploaded statements/factsheets (CAS, Folio-Wise, Transaction-Wise,
ProAffluence MF Summary & Transaction, FundsIndia Web/OCR, PMS, Direct Equity, Excel, CSV, Word, HTML, OCR images),
calculate XIRR and all investment matrices, and render the Fund Horizon branded consolidated PDF.
Google Sans only (see CLAUDE.md)."""
from __future__ import annotations

import hashlib
import html
import io
import math
import re
import threading
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.config.disclosures import ARN, DISCLOSURE_LINES, FIRM
from app.report.fmt import xml_escape
from app.report.fonts import BODY_FONT, BOLD_FONT

LOGO_PATH = Path(__file__).resolve().parent / "assets" / "fund-horizon-logo.png"
LOGO_DARK_PATH = Path(__file__).resolve().parent / "assets" / "logo-header-dark.png"

ROW_FIELDS = ("invested", "investments", "div_reinv", "div_payout", "units", "nav", "value", "weight", "abs_ret", "ann_ret")
NOTES = [
    "Annualised Return is calculated on an Absolute basis for < 1 Year (marked †) and on an XIRR basis for >= 1 Year.",
    "Same-instalment index comparison invests each dated purchase into Nifty 50, Nifty 500 TRI, Nifty Midcap 150 TRI and Nifty Smallcap 250 TRI on the exact purchase date.",
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
                    "folio": m.group("folio"), "inv": _num(m.group("inv")), "date": m.group("date"),
                    "div_reinv": _num(m.group("div_reinv")), "bal": _num(m.group("bal")), "days": int(m.group("days")),
                    "cnav": _num(m.group("cnav")), "val": _num(m.group("val")),
                })
            elif (m := _TX_WISE_SUB.match(s_ln)) and cur_sec is not None:
                xs = m.group("xirr").rstrip("%").strip()
                cur_sec["sub"] = {"inv": _num(m.group("inv")), "val": _num(m.group("val")),
                                  "abs_ret": _num(m.group("abs")), "ann_ret": 0.0 if xs == "-" else _num(xs)}
        from app.backoffice.valuation import ingestion as ing
        for sec in secs:
            r_list = sec["rows"]
            if not r_list:
                continue
            sub = sec["sub"]
            div_reinv = round(sum(r["div_reinv"] for r in r_list), 2)
            investments = round(sum(r["inv"] for r in r_list), 2)
            invested = sub["inv"] if sub else round(investments + div_reinv, 2)
            value = sub["val"] if sub else round(sum(r["val"] for r in r_list), 2)
            flows = [(ing.parse_date(r["date"]), round(r["inv"] + r["div_reinv"], 2)) for r in r_list if ing.parse_date(r.get("date")) and (r["inv"] + r["div_reinv"]) > 0]
            dates = sorted(d for d, _ in flows if d)
            max_days = max((r.get("days") or 0 for r in r_list), default=0)
            tx_rows.append({
                "name": sec["name"], "folio": r_list[-1]["folio"],
                "invested": invested, "investments": investments, "div_reinv": div_reinv, "div_payout": 0.0,
                "units": r_list[-1]["bal"], "nav": r_list[-1]["cnav"], "value": value,
                "weight": 0.0, "abs_ret": sec["abs_ret"], "ann_ret": sec["ann_ret"],
                "from_date": dates[0] if dates else "", "to_date": (dates[0] if len(dates) == 1 else dates[-1]) if dates else "",
                "days": max_days or None, "inst": str(len(flows)) if flows else "",
                "flag": "†" if (0 < max_days < 365 or sec["ann_ret"] == 0.0 and abs(sec["abs_ret"]) > 0) else "",
                "flows": [[d, a] for d, a in flows],
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
        from app.backoffice.valuation import ingestion as ing
        hdr_re = re.compile(r"^\s*(?P<name>.+?\S)\s*\|\s*(?P<folio>[A-Za-z0-9/\-]+)\s*\|\s*(?P<holder>[A-Za-z][A-Za-z .]+?)\s*$")
        for idx, ln in enumerate(lines):
            hm = hdr_re.match(ln)
            if not hm:
                continue
            block = lines[idx + 1 : min(len(lines), idx + 5)]
            fig_ln = next((b for b in block if "₹" in b), None)
            if not fig_ln:
                continue
            pre, post = fig_ln.split("₹", 1)
            all_dates = [ing.parse_date(d) for b in block[: block.index(fig_ln) + 1] for d in re.findall(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", b)]
            all_dates = [d for d in all_dates if d]
            pre_dates = [ing.parse_date(d) for d in re.findall(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", pre)]
            pre_dates = [d for d in pre_dates if d]
            start_iso = pre_dates[-1] if pre_dates else (min(all_dates) if len(all_dates) >= 2 else "")
            pre_clean = re.sub(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", " ", pre)
            p_nums = [_num(t) for t in re.findall(r"\d[\d,]*(?:\.\d+)?", pre_clean)]
            post_nums = [_num(t) for t in re.findall(r"-?[\d,]+(?:\.\d+)?", post)]
            if len(post_nums) >= 2 and p_nums:
                inv, val = post_nums[0], post_nums[1]
                div_pay = post_nums[4] if len(post_nums) >= 5 else 0.0
                ann = post_nums[5] if len(post_nums) >= 6 else 0.0
                days = int(post_nums[6]) if len(post_nums) >= 7 and post_nums[6] > 0 else None
                nav_v = p_nums[0] if len(p_nums) >= 2 else (_num(block[0]) if block and block[0] != fig_ln and _NUM.match(block[0].strip()) else p_nums[0])
                pa_rows.append({
                    "name": hm.group("name").strip(), "folio": hm.group("folio").strip(),
                    "invested": inv, "investments": inv, "div_reinv": 0.0, "div_payout": div_pay,
                    "units": p_nums[-1], "nav": nav_v, "value": val,
                    "weight": 0.0, "abs_ret": post_nums[3] if len(post_nums) >= 4 else 0.0, "ann_ret": ann,
                    "from_date": start_iso or "", "to_date": "", "days": days,
                    "flag": "†" if days is not None and 0 < days < 365 else "",
                    "flows": [[start_iso, inv]] if start_iso and inv > 0 else [],
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


def _fmt_date(s: str | None) -> str:
    if not s:
        return ""
    from app.backoffice.valuation import ingestion as ing
    iso = ing.parse_date(s)
    if iso:
        try:
            return date.fromisoformat(iso).strftime("%d %b %Y")
        except ValueError:
            pass
    return str(s).strip()


def _iso_date(s: str | None) -> str:
    if not s:
        return ""
    from app.backoffice.valuation import ingestion as ing
    return ing.parse_date(s) or ""


def _period_label(from_d: str, to_d: str, days: int | None = None, inst: str = "") -> str:
    f_iso = _iso_date(from_d) or (from_d if re.fullmatch(r"\d{4}-\d{2}", from_d or "") else "")
    t_iso = _iso_date(to_d) or (to_d if re.fullmatch(r"\d{4}-\d{2}", to_d or "") else "")
    mon = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    def ym(x: str) -> str:
        if len(x) >= 7 and x[:4].isdigit() and x[5:7].isdigit():
            m = int(x[5:7])
            if 1 <= m <= 12:
                return f"{mon[m - 1]}-{x[2:4]}"
        return x
    base = ""
    if f_iso and t_iso:
        if f_iso[:7] == t_iso[:7]:
            base = f"{ym(f_iso)} (one-time)" if inst in ("", "1") else f"{ym(f_iso)} ({inst} inst.)"
        else:
            base = f"{ym(f_iso)} – {ym(t_iso)}"
    elif f_iso:
        base = f"Since {ym(f_iso)}"
    if days and days > 0:
        yrs = f"{days / 365.25:.1f} yrs" if days >= 365 else f"{days}d"
        base = f"{base} · {yrs}" if base else yrs
    return base


def _make_row(
    name: str,
    folio: str = "",
    invested: float = 0.0,
    investments: float | None = None,
    div_reinv: float = 0.0,
    div_payout: float = 0.0,
    units: float = 0.0,
    nav: float = 0.0,
    value: float = 0.0,
    ann_ret: float = 0.0,
    *,
    isin: str | None = None,
    code: str | None = None,
    asset_class: str = "Mutual Fund",
    category: str = "",
    from_date: str = "",
    to_date: str = "",
    days: int | None = None,
    inst: str = "",
    flag: str = "",
    flows: list | None = None,
) -> dict[str, Any]:
    inv = round(float(invested or 0.0), 2)
    val = round(float(value or 0.0), 2)
    invs = round(float(investments if investments is not None else inv - float(div_reinv or 0.0)), 2)
    abs_r = round((val / inv - 1) * 100, 2) if inv > 0 else 0.0
    return {
        "name": str(name or "").strip(),
        "folio": str(folio or "-").strip() or "-",
        "isin": isin or None,
        "code": str(code).strip() if code else None,
        "asset_class": asset_class or "Mutual Fund",
        "category": category or "",
        "invested": inv,
        "investments": invs,
        "div_reinv": round(float(div_reinv or 0.0), 2),
        "div_payout": round(float(div_payout or 0.0), 2),
        "units": round(float(units or 0.0), 4),
        "nav": round(float(nav or 0.0), 4),
        "value": val,
        "weight": 0.0,
        "abs_ret": abs_r,
        "ann_ret": round(float(ann_ret or 0.0), 2),
        "from_date": str(from_date or ""),
        "to_date": str(to_date or ""),
        "days": int(days) if days and days > 0 else None,
        "inst": str(inst or ""),
        "period": _period_label(str(from_date or ""), str(to_date or ""), int(days) if days and days > 0 else None, str(inst or "")),
        "flag": flag if flag in ("†", "*") else "",
        "flows": [[str(d), round(float(a), 2)] for d, a in (flows or []) if d and a],
    }


def enrich_and_compute_matrices(data: dict[str, Any]) -> dict[str, Any]:
    """Match rows against AMFI/FH universe, calculate exact XIRR from dated cash flows (or implied dates),
    and compute all investment matrices (4-index Nifty matrix, SEBI benchmark matrix, capture/drawdown, asset/category allocation, stress tests)."""
    from app.api import portfolio_review as pr_api
    from app.backoffice.analytics.pms_math import calculate_xirr
    from app.engine import cas

    rows = data.get("rows") or []
    client = data.get("client") or {}
    val_iso = _iso_date(client.get("date")) or date.today().isoformat()
    try:
        val_d = date.fromisoformat(val_iso)
    except ValueError:
        val_d = date.today()
        val_iso = val_d.isoformat()
    if not client.get("date"):
        client["date"] = val_d.strftime("%d %b %Y")

    try:
        frame = pr_api._frame()
        lookups = pr_api._build_lookups(frame)
    except Exception:
        frame = None
        lookups = ({}, {}, {"Direct": [], "Regular": [], "All": []})

    all_dated_flows: list[tuple[str, float]] = []
    mf_holdings: list[dict[str, Any]] = []
    earliest_date: str | None = None
    latest_date: str = val_iso

    for idx, r in enumerate(rows, 1):
        r.setdefault("asset_class", "Mutual Fund")
        r.setdefault("category", "")
        r.setdefault("isin", None)
        r.setdefault("code", None)
        r.setdefault("from_date", "")
        r.setdefault("to_date", "")
        r.setdefault("days", None)
        r.setdefault("inst", "")
        r.setdefault("flag", "")
        r.setdefault("flows", [])

        ac_low = str(r.get("asset_class") or "").lower()
        is_mf = "pms" not in ac_low and "equity" not in ac_low or "mutual" in ac_low or r.get("AssetClass") == "Mutual Fund"
        if r.get("asset_class") in ("Direct Equity", "PMS"):
            is_mf = False

        if is_mf and lookups[0]:
            matched, _m_type, _m_warn = pr_api._match_scheme(
                r.get("name") or "", r.get("isin"), r.get("code"), lookups, idx
            )
            if matched:
                if not r.get("code") and matched.get("code"):
                    r["code"] = str(matched["code"])
                if not r.get("category") and matched.get("cat_label"):
                    r["category"] = str(matched["cat_label"])
        if not r.get("category"):
            r["category"] = (
                "PMS Strategy" if r.get("asset_class") == "PMS"
                else "Direct Equity" if r.get("asset_class") == "Direct Equity"
                else cas.infer_scheme_category(r.get("name") or "")
            )

        inv = float(r.get("invested") or 0.0)
        val = float(r.get("value") or 0.0)
        r["abs_ret"] = round((val / inv - 1) * 100, 2) if inv > 0 else 0.0

        # Resolve per-row cash flows and XIRR / implied timeframe
        raw_fl = [( _iso_date(str(d)) or str(d), float(a) ) for d, a in (r.get("flows") or []) if d and a]
        raw_fl = [(d, a) for d, a in raw_fl if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)]
        if raw_fl:
            dates_only = sorted(d for d, _ in raw_fl)
            if not r.get("from_date"):
                r["from_date"] = dates_only[0]
            if not r.get("to_date") and len(dates_only) > 1:
                r["to_date"] = dates_only[-1]
            if not r.get("inst"):
                r["inst"] = str(sum(1 for _, a in raw_fl if a > 0))
            span_d = max((val_d - date.fromisoformat(dates_only[0])).days, 1)
            r["days"] = r.get("days") or span_d
            if span_d < 365 and not r.get("flag"):
                r["flag"] = "†"
            if not r.get("ann_ret"):
                if span_d >= 365 and val > 0:
                    cf_xirr = [(d, -a) for d, a in raw_fl if d < val_iso]
                    if cf_xirr:
                        res_x = calculate_xirr(cf_xirr, terminal_value=val, terminal_date=val_iso)
                        if res_x.get("xirr") is not None:
                            r["ann_ret"] = round(res_x["xirr"] * 100, 2)
                if not r.get("ann_ret"):
                    r["ann_ret"] = r["abs_ret"]
            for d, a in raw_fl:
                all_dated_flows.append((d, -a))
                if earliest_date is None or d < earliest_date:
                    earliest_date = d
            if val > 0:
                all_dated_flows.append((val_iso, val))
        else:
            # Derive timeframe & synthetic flow from from_date, days, or XIRR / NAV history
            f_iso = _iso_date(r.get("from_date"))
            if not f_iso and r.get("days") and int(r["days"]) > 0:
                f_iso = (val_d - timedelta(days=int(r["days"]))).isoformat()
                r["from_date"] = f_iso
            ann = float(r.get("ann_ret") or 0.0)
            abs_r = float(r.get("abs_ret") or 0.0)
            if not f_iso and inv > 0 and val > 0:
                if abs(ann - abs_r) <= 0.06 and abs(abs_r) > 0.1 and r.get("code"):
                    imp_d = pr_api._solve_implied_date(str(r["code"]), val_d, inv, val)
                    if imp_d:
                        f_iso = imp_d.isoformat()
                        r["from_date"] = f_iso
                        r["days"] = (val_d - imp_d).days
                        r["flag"] = "†"
                elif ann and 1 + ann / 100 > 0.1 and val / inv > 0 and abs(ann) > 0.05:
                    try:
                        yrs = math.log(val / inv) / math.log(1 + ann / 100)
                    except (ValueError, ZeroDivisionError):
                        yrs = 0.0
                    if 0.1 <= yrs <= 35:
                        span_days = max(30, round(yrs * 365.25))
                        imp_d = val_d - timedelta(days=span_days)
                        f_iso = imp_d.isoformat()
                        r["from_date"] = f_iso
                        r["days"] = span_days
                        r["flag"] = r.get("flag") or ("†" if yrs < 1.0 else "*")
                elif r.get("code"):
                    imp_d = pr_api._solve_implied_date(str(r["code"]), val_d, inv, val)
                    if imp_d:
                        f_iso = imp_d.isoformat()
                        r["from_date"] = f_iso
                        r["days"] = (val_d - imp_d).days
                        r["flag"] = r.get("flag") or ("†" if r["days"] < 365 else "*")
            if f_iso:
                try:
                    fd_obj = date.fromisoformat(f_iso[:10])
                    span_d = max((val_d - fd_obj).days, 1)
                    r["days"] = r.get("days") or span_d
                    if not r.get("ann_ret") and inv > 0 and val > 0:
                        if span_d >= 365:
                            cagr_v = (math.pow(val / inv, 365.25 / span_d) - 1.0) * 100
                            r["ann_ret"] = round(cagr_v, 2)
                        else:
                            r["ann_ret"] = r["abs_ret"]
                            r["flag"] = r.get("flag") or "†"
                    if inv > 0 and val > 0 and fd_obj < val_d:
                        all_dated_flows.append((fd_obj.isoformat(), -inv))
                        all_dated_flows.append((val_iso, val))
                        if earliest_date is None or fd_obj.isoformat() < earliest_date:
                            earliest_date = fd_obj.isoformat()
                except ValueError:
                    pass

        r["period"] = _period_label(r.get("from_date") or "", r.get("to_date") or "", r.get("days"), str(r.get("inst") or ""))

        if is_mf and (inv > 0 or val > 0):
            f_ym = (r.get("from_date") or "")[:7] if re.match(r"^\d{4}-\d{2}", str(r.get("from_date") or "")) else ""
            t_ym = (r.get("to_date") or "")[:7] if re.match(r"^\d{4}-\d{2}", str(r.get("to_date") or "")) else ""
            mf_holdings.append({
                "code": str(r.get("code") or f"{990000 + idx}"),
                "name": re.sub(r" - (Regular|Direct) Plan.*$", "", str(r.get("name") or "")),
                "typ": str(r.get("category") or ""),
                "invested": inv,
                "value": val,
                "from": f_ym,
                "to": t_ym,
                "period": r["period"],
                "inst": str(r.get("inst") or ""),
                "ret": float(r["ann_ret"]) if r.get("ann_ret") else None,
                "flag": r.get("flag") if r.get("flag") in ("†", "*") else "",
                "flows": [[d, a] for d, a in raw_fl],
            })

    # Calculate overall portfolio XIRR if not already printed or if computable from flows
    if data.get("xirr") is None and len(all_dated_flows) >= 2:
        rx = calculate_xirr(all_dated_flows)
        if rx.get("xirr") is not None:
            data["xirr"] = round(rx["xirr"] * 100, 2)
    if data.get("xirr") is None:
        weighted = [(float(r.get("value") or 0.0), float(r.get("ann_ret") or 0.0)) for r in rows if (r.get("value") or 0) > 0 and r.get("ann_ret")]
        tot_w = sum(w for w, _ in weighted)
        if tot_w > 0:
            data["xirr"] = round(sum(w * x for w, x in weighted) / tot_w, 2)

    # Aggregate MF holdings by code for benchmark comparison & FH live analysis
    by_code: dict[str, dict[str, Any]] = {}
    for mh in mf_holdings:
        c = mh["code"]
        if c not in by_code:
            by_code[c] = dict(mh, flows=list(mh["flows"]), _rw=(mh["ret"] or 0.0) * mh["value"])
        else:
            cur = by_code[c]
            cur["invested"] = round(cur["invested"] + mh["invested"], 2)
            cur["value"] = round(cur["value"] + mh["value"], 2)
            cur["flows"].extend(mh["flows"])
            if mh["from"] and (not cur["from"] or mh["from"] < cur["from"]):
                cur["from"] = mh["from"]
            if mh["to"] and (not cur["to"] or mh["to"] > cur["to"]):
                cur["to"] = mh["to"]
            if mh["ret"] is not None:
                cur["_rw"] += mh["ret"] * mh["value"]
                if cur["value"] > 0:
                    cur["ret"] = round(cur["_rw"] / cur["value"], 2)
    agg_mf = list(by_code.values())
    for mh in agg_mf:
        mh.pop("_rw", None)

    cmp_data, fh_analysis = (None, None)
    if agg_mf:
        try:
            cmp_data, fh_analysis = pr_api.build_analysis(agg_mf, val_iso, portfolio_xirr=data.get("xirr"))
        except Exception:
            cmp_data, fh_analysis = (None, None)

    # Asset Allocation & Category Allocation Matrices across ALL rows (MF + PMS + Direct Equity)
    tot_val = sum(float(r.get("value") or 0.0) for r in rows)
    asset_map: dict[str, dict[str, Any]] = {}
    cat_map: dict[str, dict[str, Any]] = {}
    for r in rows:
        ac = str(r.get("asset_class") or "Mutual Fund")
        cat = str(r.get("category") or "Other")
        inv = float(r.get("invested") or 0.0)
        val = float(r.get("value") or 0.0)
        for m_dict, key in ((asset_map, ac), (cat_map, cat)):
            entry = m_dict.setdefault(key, {"name": key, "count": 0, "invested": 0.0, "value": 0.0, "gain": 0.0, "weight": 0.0, "abs_ret": 0.0})
            entry["count"] += 1
            entry["invested"] = round(entry["invested"] + inv, 2)
            entry["value"] = round(entry["value"] + val, 2)
    for m_dict in (asset_map, cat_map):
        for entry in m_dict.values():
            entry["gain"] = round(entry["value"] - entry["invested"], 2)
            entry["weight"] = round(entry["value"] / tot_val * 100, 2) if tot_val > 0 else 0.0
            entry["abs_ret"] = round((entry["value"] / entry["invested"] - 1) * 100, 2) if entry["invested"] > 0 else 0.0

    asset_allocation = sorted(asset_map.values(), key=lambda x: -x["value"])
    category_allocation = sorted(cat_map.values(), key=lambda x: -x["value"])

    # Attach live FH score/signal back onto each row
    live_lookup = (fh_analysis or {}).get("live") or {}
    per_fund_cmp = (cmp_data or {}).get("per_fund") or {}
    for r in rows:
        c = str(r.get("code") or "")
        lv = live_lookup.get(c) or {}
        pf = per_fund_cmp.get(c) or {}
        r["fh_score"] = lv.get("fh_score")
        r["fh_signal"] = lv.get("fh_signal")
        r["fh_recommended"] = bool(lv.get("recommended"))
        r["lead_n500_pct"] = pf.get("pct")
        r["lead_n500_inr"] = pf.get("inr")

    # Build risk & capture matrix for funds with live data
    risk_matrix = []
    seen_codes: set[str] = set()
    for r in rows:
        c = str(r.get("code") or "")
        if not c or c in seen_codes or c not in live_lookup:
            continue
        seen_codes.add(c)
        lv = live_lookup[c]
        risk_matrix.append({
            "code": c,
            "name": re.sub(r" - (Regular|Direct) Plan.*$", "", str(r.get("name") or lv.get("name") or c)),
            "category": str(r.get("category") or lv.get("cat_label") or ""),
            "value": round(sum(float(x.get("value") or 0.0) for x in rows if str(x.get("code") or "") == c), 2),
            "cagr_3y": lv.get("cagr_3y"),
            "cap_up_3y": lv.get("cap_up_3y"),
            "cap_down_3y": lv.get("cap_down_3y"),
            "cap_ratio_3y": lv.get("cap_ratio_3y"),
            "max_dd_3y": lv.get("max_dd_3y"),
            "max_dd_all": lv.get("max_dd_all"),
            "history_years": lv.get("history_years"),
            "fh_score": lv.get("fh_score"),
            "fh_signal": lv.get("fh_signal"),
            "recommended": bool(lv.get("recommended")),
            "nav_date": lv.get("nav_date"),
            "reason": lv.get("reason") or "",
        })

    inc_iso = _iso_date(client.get("inception"))
    if earliest_date and (not inc_iso or earliest_date < inc_iso):
        client["inception"] = _fmt_date(earliest_date)
    elif inc_iso and not earliest_date:
        earliest_date = inc_iso
    timeframe_days = (val_d - date.fromisoformat(earliest_date)).days if earliest_date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", earliest_date) else None
    timeframe_str = ""
    if earliest_date:
        yrs_s = f"{timeframe_days / 365.25:.1f} years ({timeframe_days} days)" if timeframe_days and timeframe_days >= 365 else (f"{timeframe_days} days" if timeframe_days else "")
        timeframe_str = f"{_fmt_date(earliest_date)} to {_fmt_date(latest_date)}" + (f" · {yrs_s}" if yrs_s else "")
    elif client.get("inception"):
        timeframe_str = f"{client['inception']} to {client.get('date') or _fmt_date(latest_date)}"
    client["timeframe"] = client.get("timeframe") or timeframe_str

    data["matrices"] = {
        "timeframe": {
            "inception_date": client.get("inception") or (_fmt_date(earliest_date) if earliest_date else ""),
            "valuation_date": client.get("date") or _fmt_date(latest_date),
            "generated_at": datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y, %H:%M IST"),
            "span_days": timeframe_days,
            "summary": client.get("timeframe") or "",
            "live_nav_date": (fh_analysis or {}).get("nav_date"),
        },
        "asset_allocation": asset_allocation,
        "category_allocation": category_allocation,
        "compare": cmp_data,
        "risk_matrix": risk_matrix,
        "signals": (fh_analysis or {}).get("signals") or {},
        "recommendations": (fh_analysis or {}).get("recommendations") or [],
        "stress_test": (fh_analysis or {}).get("stress_test") or [],
    }
    return data


def _extract_universal_file(name: str, data: bytes, password: str = "", from_bundle: bool = False) -> dict[str, Any]:
    """One unified scraping pipeline for ANY statement file:
    1) Valuation / Folio-wise / Transaction-wise / ProAffluence MF Summary
    2) ProAffluence MF Transaction Report
    3) CAMS / KFintech / NSDL / CDSL Consolidated Account Statement (CAS)
    4) Direct Equity statement
    5) PMS Portfolio Summary & Factsheet
    6) FundsIndia Web Printout / Cards or OCR Boxes
    7) Spreadsheet / CSV / Word / HTML / Generic PDF Table / Universal Text & OCR fallback
    """
    from app.api import portfolio_review as pr_api
    from app.backoffice import portfolio_screen
    from app.backoffice.valuation import ingestion as ing
    from app.backoffice.valuation import layouts
    from app.report import statements

    res: dict[str, Any] = {
        "client": {"name": "", "date": "", "arn": ARN.replace("ARN ", ""), "phone": "", "email": "", "pan": "", "inception": ""},
        "xirr": None,
        "rows": [],
        "factsheets": [],
        "warnings": [],
        "kind": "unrecognised",
        "method": "ocr" if is_image(name, data) else "text",
    }

    # A. Non-PDF spreadsheets (XLSX, XLS, CSV, TSV)
    if not is_pdf(name, data) and not is_image(name, data):
        sheet_list = portfolio_screen.read_table_rows(name, data)
        if sheet_list:
            s_rows: list[dict[str, Any]] = []
            all_flows: list[ing.FlowRec] = []
            c_name, st_date, warns = "", "", []
            for idx, t_rows in enumerate(sheet_list):
                h_list, cn, sd = pr_api._extract_table_rows(t_rows)
                if not h_list:
                    l_h, l_sd = portfolio_screen.extract_from_layout_text(
                        "\n".join("   ".join(str(c) for c in r if c is not None and str(c).strip()) for r in t_rows)
                    )
                    h_list = [{
                        "raw_name": x["raw_name"], "isin": x.get("isin"), "amfi_code": x.get("amfi_code"),
                        "folio": x.get("folio"), "units": x.get("units"), "nav": x.get("statement_nav"),
                        "invested": None, "value": x.get("statement_value") or 0.0,
                        "from": "", "to": "", "inst": "", "ret": None, "flag": "", "flows": [],
                    } for x in l_h]
                    sd = sd or (ing.parse_date(l_sd) if l_sd else "")
                c_name = c_name or cn
                st_date = st_date or sd
                fl, fw = ing.flows_from_rows(t_rows, f"sheet{idx + 1}")
                all_flows.extend(fl)
                warns.extend(fw)
                for h in h_list:
                    inv = float(h.get("invested") or 0.0)
                    val = float(h.get("value") or 0.0)
                    s_rows.append(_make_row(
                        name=h.get("raw_name") or h.get("amfi_code") or "Scheme",
                        folio=h.get("folio") or "-",
                        invested=inv,
                        units=float(h.get("units") or 0.0),
                        nav=float(h.get("nav") or 0.0),
                        value=val,
                        ann_ret=float(h["ret"]) if h.get("ret") is not None else 0.0,
                        isin=h.get("isin"),
                        code=h.get("amfi_code"),
                        from_date=h.get("from") or "",
                        to_date=h.get("to") or "",
                        inst=str(h.get("inst") or ""),
                        flag=str(h.get("flag") or ""),
                        flows=h.get("flows") or [],
                    ))
            if s_rows:
                if all_flows and len(s_rows) == 1 and not s_rows[0]["flows"]:
                    s_rows[0]["flows"] = [[f.flow_date, round(f.amount if f.kind in ("deposit", "transfer_in") else -f.amount, 2)]
                                          for f in all_flows if f.flow_date and f.amount]
                res["client"]["name"] = c_name
                res["client"]["date"] = _fmt_date(st_date)
                res["rows"] = s_rows
                res["warnings"] = warns
                res["kind"] = "spreadsheet"
                return res

    # B. PDF-specific structural & encrypted checks
    pages_layout: list[str] = []
    pages_plain: list[str] = []
    pages_pdfium: list[str] = []
    if is_pdf(name, data):
        try:
            text_direct = extract_text(name, data)
        except Exception:
            text_direct = ""
        try:
            pages_layout = ing.read_pdf_pages(data, password, "layout")
            pages_plain = ing.read_pdf_pages(data, password, "plain")
        except ing.ExtractionError as e:
            if e.code == "password_required":
                raise PermissionError(f"{name}: PDF is password-protected; enter the password and click Unlock & parse.") from e
            if not text_direct:
                raise ValueError(f"{name}: {e.args[0]}") from e
        if pages_layout:
            pages_pdfium = ing.pdfium_pages(data, password)
            text = "\n".join(pages_layout)
            if len("".join(pages_layout).strip()) < 80:
                res["method"] = "ocr"
                text = text_direct or "\n".join("\n".join(ls) for ls in map(_ocr_lines, render_pages(data)))
        else:
            text = text_direct
    else:
        text = extract_text(name, data)

    full_plain = "\n".join(pages_plain) if pages_plain else text
    full_pdfium = "\n".join(pages_pdfium) if pages_pdfium else text

    # 1. Folio-wise / Transaction-wise / ProAffluence MF Summary via parse_statement
    st = parse_statement(text) or (parse_statement(full_plain) if full_plain != text else None)
    if st and st.get("rows"):
        c_info = st["client"]
        # Also check ProAffluence client contact info (PAN, email, mobile)
        pa_c = statements.parse_proaffluence(text)
        if pa_c:
            c_info["name"] = c_info.get("name") or pa_c["client"].get("name") or ""
            c_info["phone"] = c_info.get("phone") or pa_c["client"].get("mobile") or ""
            c_info["email"] = pa_c["client"].get("email") or ""
            c_info["pan"] = pa_c["client"].get("pan") or ""
        res["client"].update({k: v for k, v in c_info.items() if v})
        if res["client"]["date"]:
            res["client"]["date"] = _fmt_date(res["client"]["date"])
        res["xirr"] = st.get("xirr")
        res["rows"] = [_make_row(
            name=r["name"], folio=r["folio"], invested=r["invested"], investments=r.get("investments"),
            div_reinv=r.get("div_reinv", 0.0), div_payout=r.get("div_payout", 0.0),
            units=r.get("units", 0.0), nav=r.get("nav", 0.0), value=r["value"], ann_ret=r.get("ann_ret", 0.0),
            from_date=r.get("from_date", ""), to_date=r.get("to_date", ""), days=r.get("days"),
            inst=r.get("inst", ""), flag=r.get("flag", ""), flows=r.get("flows"),
        ) for r in st["rows"]]
        res["kind"] = "transaction_wise" if any(r.get("flows") for r in st["rows"]) else ("mf_summary" if "MF Summary Report" in text else "folio_wise")
        return res

    # 2. ProAffluence MF Transaction Report
    txn = pr_api._parse_mf_txn_report(pages_layout or [text]) or (pr_api._parse_mf_txn_report(pages_pdfium) if pages_pdfium else None)
    if txn and txn.get("holdings"):
        res["client"]["name"] = txn.get("client_name") or ""
        res["client"]["date"] = _fmt_date(txn.get("val_date"))
        res["xirr"] = txn.get("portfolio_xirr")
        for h in txn["holdings"]:
            fls = [(d, a) for d, a in (h.get("flows") or []) if d and a]
            pos_dates = sorted(d for d, a in fls if a > 0)
            res["rows"].append(_make_row(
                name=h.get("raw_name") or "Scheme", folio=h.get("folio") or "-",
                invested=float(h.get("invested") or 0.0), units=float(h.get("units") or 0.0),
                nav=float(h.get("nav") or 0.0), value=float(h.get("value") or 0.0),
                isin=h.get("isin"), code=h.get("amfi_code"),
                from_date=pos_dates[0] if pos_dates else "",
                to_date=(pos_dates[0] if len(pos_dates) == 1 else pos_dates[-1]) if pos_dates else "",
                inst=str(len(pos_dates)) if pos_dates else "",
                flows=fls,
            ))
        res["kind"] = "mf_txn"
        return res

    # 3. CAMS / KFintech / NSDL / CDSL Consolidated Account Statement (CAS)
    if is_pdf(name, data):
        try:
            cas_res = pr_api._parse_cas_pdf(data, password)
        except Exception as e:
            if "password" in str(e).lower():
                raise PermissionError(f"{name}: incorrect password for this PDF statement.") from e
            cas_res = None
        if cas_res and cas_res.get("holdings"):
            res["client"]["name"] = cas_res.get("client_name") or ""
            res["client"]["date"] = _fmt_date(cas_res.get("val_date"))
            res["xirr"] = cas_res.get("portfolio_xirr")
            for h in cas_res["holdings"]:
                fls = [(d, a) for d, a in (h.get("flows") or []) if d and a]
                pos_dates = sorted(d for d, a in fls if a > 0)
                res["rows"].append(_make_row(
                    name=h.get("raw_name") or "Scheme", folio=h.get("folio") or "-",
                    invested=float(h.get("invested") or 0.0), units=float(h.get("units") or 0.0),
                    nav=float(h.get("nav") or 0.0), value=float(h.get("value") or 0.0),
                    isin=h.get("isin"), code=h.get("amfi_code"),
                    from_date=pos_dates[0] if pos_dates else "",
                    to_date=(pos_dates[0] if len(pos_dates) == 1 else pos_dates[-1]) if pos_dates else "",
                    inst=str(len(pos_dates)) if pos_dates else "",
                    flows=fls,
                ))
            res["kind"] = "cas"
            return res

    # 4. Direct Equity Statement
    dh, _dt, ddate, _ = layouts.direct_equity(pages_plain or [text])
    if dh:
        res["client"]["date"] = _fmt_date(ddate)
        for h in dh:
            res["rows"].append(_make_row(
                name=h.security_name, folio="Direct Equity",
                invested=float(h.invested_amount or 0.0), units=float(h.quantity or 0.0),
                nav=float(h.price or 0.0), value=float(h.market_value or 0.0),
                asset_class="Direct Equity", category="Direct Equity",
            ))
        res["kind"] = "direct_equity"
        return res

    # 5. PMS Statement / Factsheet
    pms_st = statements.parse_pms(text)
    if pms_st:
        p = pms_st["pms"]
        res["client"]["name"] = pms_st["client"].get("name") or ""
        res["client"]["date"] = _fmt_date(pms_st.get("as_on"))
        res["client"]["inception"] = _fmt_date(p.get("inception"))
        res["xirr"] = pms_st["grand_total"].get("xirr")
        net_inv = float(p["contribution"]) - float(p.get("withdrawal") or 0.0)
        res["rows"].append(_make_row(
            name=f"{pms_st['provider']} - {p.get('strategy') or 'PMS'}".strip(" -"),
            folio=p.get("account") or "PMS",
            invested=net_inv if net_inv > 0 else float(p["contribution"]),
            investments=float(p["contribution"]),
            div_payout=float(p.get("withdrawal") or 0.0),
            units=1.0,
            nav=float(p["value"]),
            value=float(p["value"]),
            ann_ret=float(pms_st["grand_total"].get("xirr") or 0.0),
            asset_class="PMS",
            category="PMS Strategy",
            from_date=_iso_date(p.get("inception")),
        ))
        res["factsheets"].append(statements.pms_factsheet(pms_st))
        res["warnings"].extend(pms_st.get("warnings") or [])
        res["kind"] = "pms"
        return res

    # 6. FundsIndia Web Printout / Cards or OCR Boxes
    if is_pdf(name, data) and (pages_pdfium or pages_layout):
        card_h, card_tot, _, _ = ing.holdings_from_cards(pages_pdfium or pages_layout)
        if card_h:
            if m := ing._PRINT_DATE.search(full_pdfium or text):
                res["client"]["date"] = _fmt_date(ing.parse_date(m.group(1)))
            for h in card_h:
                res["rows"].append(_make_row(
                    name=h.security_name, folio=h.account_no or "FundsIndia",
                    invested=float(h.invested_amount or 0.0), value=float(h.market_value or 0.0),
                ))
            res["kind"] = "cards"
            return res

    if is_image(name, data) or re.search(r"funds[il1]ndia", (text + full_pdfium).lower()):
        try:
            fi_ocr = statements.parse_fundsindia(statements.fundsindia_pages(name, data))
            if fi_ocr and fi_ocr.get("categories"):
                res["client"]["name"] = fi_ocr["client"].get("name") or ""
                res["client"]["date"] = _fmt_date(fi_ocr.get("as_on"))
                res["xirr"] = fi_ocr["grand_total"].get("xirr")
                for c in fi_ocr["categories"]:
                    for f in c.get("funds") or []:
                        res["rows"].append(_make_row(
                            name=f["name"], folio=c.get("name") or "FundsIndia",
                            invested=float(f.get("invested") or 0.0), value=float(f.get("current") or 0.0),
                            ann_ret=float(f.get("ann_ret") or 0.0),
                        ))
                if res["rows"]:
                    res["warnings"].extend(fi_ocr.get("warnings") or [])
                    res["kind"] = "ocr"
                    res["method"] = "ocr"
                    return res
        except Exception:
            pass

    # 7. Generic tabular PDF (header-driven or positional columns)
    if is_pdf(name, data) and pages_layout:
        cands = [ing.holdings_from_text(pages_layout), ing.holdings_from_columns(data, password)]
        best_h, best_tot, best_w, _ = ing.pick_best(cands)
        if best_h:
            _, meta, _ = ing.scan_scalars(text.splitlines())
            res["client"]["date"] = _fmt_date(meta.get("statement_date"))
            res["xirr"] = best_tot.get("reported_xirr")
            for h in best_h:
                if (h.market_value or 0) <= 0 and (h.quantity or 0) <= 0:
                    continue
                res["rows"].append(_make_row(
                    name=h.security_name, folio=h.account_no or meta.get("account_no") or "-",
                    invested=float(h.invested_amount or 0.0), units=float(h.quantity or 0.0),
                    nav=float(h.price or 0.0), value=float(h.market_value or 0.0),
                    ann_ret=float(h.reported_xirr or 0.0), isin=h.isin,
                ))
            if res["rows"]:
                res["warnings"].extend(best_w)
                res["kind"] = "table_pdf"
                return res

    # 8. Universal text / layout fallback (Word, HTML, pasted text, custom broker statements, OCR text)
    t_rows = [[c.strip() for c in re.split(r"[,\t]", ln)] for ln in text.splitlines() if ln.strip()]
    h_paste, cn_p, sd_p = pr_api._extract_table_rows(t_rows)
    if h_paste:
        res["client"]["name"] = cn_p
        res["client"]["date"] = _fmt_date(sd_p)
        for h in h_paste:
            res["rows"].append(_make_row(
                name=h.get("raw_name") or h.get("amfi_code") or "Scheme",
                folio=h.get("folio") or "-",
                invested=float(h.get("invested") or 0.0), units=float(h.get("units") or 0.0),
                nav=float(h.get("nav") or 0.0), value=float(h.get("value") or 0.0),
                ann_ret=float(h["ret"]) if h.get("ret") is not None else 0.0,
                isin=h.get("isin"), code=h.get("amfi_code"),
                from_date=h.get("from") or "", to_date=h.get("to") or "",
                inst=str(h.get("inst") or ""), flag=str(h.get("flag") or ""),
            ))
        res["kind"] = "text"
        return res

    for cand_txt in (text, full_pdfium):
        for ext in (portfolio_screen.extract_from_layout_text, portfolio_screen.extract_universal_from_text):
            eh, esd = ext(cand_txt)
            if eh:
                res["client"]["date"] = _fmt_date(esd)
                for x in eh:
                    res["rows"].append(_make_row(
                        name=x["raw_name"], folio=x.get("folio") or "-",
                        invested=float(x.get("invested_value") or 0.0),
                        units=float(x.get("units") or 0.0), nav=float(x.get("statement_nav") or 0.0),
                        value=float(x.get("statement_value") or 0.0),
                        isin=x.get("isin"), code=x.get("amfi_code"),
                    ))
                res["kind"] = "text"
                return res

    # 9. Factsheet highlights
    fs = parse_factsheet(name, text)
    if fs:
        res["factsheets"].append(fs)
        res["kind"] = "factsheet"
        return res

    if not from_bundle:
        res["warnings"].append(f"{name}: no fund statement rows or factsheet figures recognised.")
    return res


def parse_files(files: list[tuple[str, bytes]], password: str = "") -> dict[str, Any]:
    from app.backoffice.valuation import bundle

    out: dict[str, Any] = {
        "client": {"name": "", "date": "", "arn": ARN.replace("ARN ", ""), "phone": "", "email": "", "pan": "", "inception": "", "timeframe": ""},
        "xirr": None,
        "rows": [],
        "factsheets": [],
        "warnings": [],
        "file_results": [],
        "dashboard": None,
    }
    expanded: list[tuple[str, bytes, bool]] = []
    for name, data in files:
        if is_pdf(name, data):
            try:
                secs, dash = bundle.split(data, password)
            except Exception:
                secs, dash = [], {}
            if dash and not out["dashboard"]:
                out["dashboard"] = dash
                if dash.get("from") and not out["client"]["inception"]:
                    out["client"]["inception"] = _fmt_date(dash["from"])
                if dash.get("to") and not out["client"]["date"]:
                    out["client"]["date"] = _fmt_date(dash["to"])
                if dash.get("since_inception_xirr") is not None and out["xirr"] is None:
                    out["xirr"] = float(dash["since_inception_xirr"])
            if secs:
                stem = name.rsplit(".", 1)[0]
                expanded.extend((f"{stem} - {s['label']}.pdf", s["data"], True) for s in secs)
                continue
        expanded.append((name, data, False))

    for name, data, from_bundle in expanded:
        try:
            r = _extract_universal_file(name, data, password=password, from_bundle=from_bundle)
        except PermissionError as pe:
            out["warnings"].append(str(pe))
            out["file_results"].append({"name": name, "kind": "password_required", "method": "text", "rows": 0, "flows": 0, "error": str(pe)})
            continue
        except ValueError as e:
            out["warnings"].append(str(e))
            out["file_results"].append({"name": name, "kind": "error", "method": "text", "rows": 0, "flows": 0, "error": str(e)})
            continue
        except Exception as e:
            out["warnings"].append(f"{name}: {e}")
            out["file_results"].append({"name": name, "kind": "error", "method": "text", "rows": 0, "flows": 0, "error": str(e)})
            continue

        out["warnings"].extend(r.get("warnings") or [])
        for k, v in (r.get("client") or {}).items():
            if v and not out["client"].get(k):
                out["client"][k] = v
        if r.get("xirr") is not None and out["xirr"] is None:
            out["xirr"] = float(r["xirr"])
        if r.get("rows"):
            # Deduplicate / enrich when both a summary report and a transaction report for the same folio+scheme are uploaded
            for new_row in r["rows"]:
                dup = next(
                    (ex for ex in out["rows"]
                     if ex.get("folio") not in (None, "", "-") and ex.get("folio") == new_row.get("folio")
                     and (ex.get("name", "").lower()[:20] == new_row.get("name", "").lower()[:20] or (ex.get("isin") and ex.get("isin") == new_row.get("isin")))),
                    None,
                )
                if dup is not None:
                    if new_row.get("flows") and not dup.get("flows"):
                        dup["flows"] = new_row["flows"]
                    for fld in ("from_date", "to_date", "days", "inst", "flag", "isin", "code"):
                        if not dup.get(fld) and new_row.get(fld):
                            dup[fld] = new_row[fld]
                    if not dup.get("invested") and new_row.get("invested"):
                        dup["invested"] = new_row["invested"]
                        dup["investments"] = new_row["investments"]
                    if not dup.get("ann_ret") and new_row.get("ann_ret"):
                        dup["ann_ret"] = new_row["ann_ret"]
                else:
                    out["rows"].append(new_row)
            if not (out["client"]["name"] and out["client"]["date"]) and not from_bundle:
                out["warnings"].append(f"{name}: client name or date not detected; please verify them below.")
        if r.get("factsheets"):
            existing_src = {f["source"] for f in out["factsheets"]}
            out["factsheets"].extend(f for f in r["factsheets"] if f["source"] not in existing_src)
        flows_cnt = sum(len(x.get("flows") or []) for x in (r.get("rows") or []))
        out["file_results"].append({
            "name": name, "kind": r.get("kind") or "statement", "method": r.get("method") or "text",
            "rows": len(r.get("rows") or []), "flows": flows_cnt, "error": None,
        })

    summarize(out)
    enrich_and_compute_matrices(out)
    out["warnings"] = list(dict.fromkeys(out["warnings"]))
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
    from reportlab.platypus import Image as RLImage
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    if "matrices" not in data:
        enrich_and_compute_matrices(data)
    t, c = summarize(data), data["client"]
    mat = data.get("matrices") or {}
    tf = mat.get("timeframe") or {}
    navy = colors.HexColor("#0B2545")
    teal = colors.HexColor("#006F64")
    blue = colors.HexColor("#E8EEFB")
    soft = colors.HexColor("#F3F6FC")
    grey = colors.HexColor("#C9D2E3")
    ink = colors.HexColor("#1B2333")
    muted = colors.HexColor("#5B6577")

    body = ParagraphStyle("cr", fontName=BODY_FONT, fontSize=7.2, leading=9.2, textColor=ink)
    bold = ParagraphStyle("crb", parent=body, fontName=BOLD_FONT)
    center = ParagraphStyle("crc", parent=body, alignment=1)
    center_b = ParagraphStyle("crcb", parent=center, fontName=BOLD_FONT)
    right = ParagraphStyle("crr", parent=body, alignment=2)
    right_b = ParagraphStyle("crrb", parent=right, fontName=BOLD_FONT)
    head = ParagraphStyle("crh", parent=bold, alignment=1, fontSize=6.6, leading=8.4, textColor=colors.white)
    head_l = ParagraphStyle("crhl", parent=head, alignment=0)
    sec_h = ParagraphStyle("crsh", parent=bold, fontSize=10.5, leading=14, textColor=navy, spaceBefore=6, spaceAfter=3)
    small = ParagraphStyle("crs", parent=body, fontSize=6.5, leading=8.5, textColor=muted)
    P = lambda s, st=body: Paragraph(xml_escape(str(s if s is not None else "")), st)  # noqa: E731

    # Official Fund Horizon Logo
    logo = None
    try:
        if LOGO_PATH.exists():
            from PIL import Image as PILImage

            with PILImage.open(LOGO_PATH) as im:
                w, h = im.size
            width = 34 * mm
            height = width * h / w
            if height > 13 * mm:
                height = 13 * mm
                width = height * w / h
            logo = RLImage(str(LOGO_PATH), width=width, height=height)
            logo.hAlign = "LEFT"
    except Exception:
        logo = None

    val_date_str = c.get("date") or tf.get("valuation_date") or date.today().strftime("%d %b %Y")
    inc_str = c.get("inception") or tf.get("inception_date") or ""
    tf_summary = c.get("timeframe") or tf.get("summary") or (f"As on {val_date_str}")
    gen_at = tf.get("generated_at") or datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y, %H:%M IST")

    meta_parts = [f"Valuation Date: {val_date_str}"]
    if inc_str:
        meta_parts.append(f"Inception: {inc_str}")
    if tf_summary and tf_summary not in meta_parts[0]:
        meta_parts.append(f"Timeframe: {tf_summary}")
    if c.get("pan"):
        meta_parts.append(f"PAN: {c['pan']}")

    left_title = [
        P("Portfolio Valuation Report - Consolidated & Folio Wise", ParagraphStyle("t", parent=bold, fontSize=14.5, leading=18, textColor=navy)),
        P(c.get("name") or "Valued Client", ParagraphStyle("n", parent=bold, fontSize=11, leading=14, textColor=ink)),
        P("  |  ".join(meta_parts), ParagraphStyle("d", parent=body, fontSize=8.0, leading=10.5, textColor=muted)),
    ]
    if logo is not None:
        left_block = Table([[logo, left_title]], colWidths=[36 * mm, 140 * mm])
        left_block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    else:
        left_block = left_title

    right_contact = f"ARN: {c.get('arn') or ARN.replace('ARN ', '')}" + (f"  |  Phone: {c['phone']}" if c.get("phone") else "")
    right_head = [
        P(FIRM, ParagraphStyle("f", parent=right_b, fontSize=13, leading=16, textColor=navy)),
        P(right_contact, ParagraphStyle("a", parent=right, fontSize=8.0, textColor=ink)),
        P("AMFI Registered Mutual Fund Distributor", ParagraphStyle("m", parent=right, fontSize=7.8, textColor=teal)),
        P(f"Generated: {gen_at}", ParagraphStyle("g", parent=right, fontSize=7.0, textColor=muted)),
    ]
    top = Table([[left_block, right_head]], colWidths=[176 * mm, 101 * mm])
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 1.2, teal), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))

    # Top KPI Banner (6 cards: Invested, Current Value, Gain/Loss, Absolute Return, XIRR, Timeframe / Holdings)
    gain_v = t["gain"]
    kp = [
        ("INVESTED AMOUNT", "₹" + ind(t["invested"])),
        ("CURRENT VALUE", "₹" + ind(t["value"])),
        ("UNREALISED GAIN / (LOSS)", ("+" if gain_v >= 0 else "") + "₹" + ind(gain_v)),
        ("ABSOLUTE RETURN", f"{ind(t['abs_ret'])}%"),
        ("ANNUALISED RETURN (XIRR)", "-" if data.get("xirr") is None else f"{ind(data['xirr'])}% p.a."),
        ("HOLDINGS & TIMEFRAME", f"{len(data.get('rows') or [])} schemes" + (f" · {tf['span_days']}d" if tf.get("span_days") else "")),
    ]
    kpi = Table([[[P(k, ParagraphStyle("kl", parent=bold, fontSize=6.2, textColor=muted)), P(v, ParagraphStyle("kv", parent=bold, fontSize=11.5, leading=15, textColor=navy))] for k, v in kp]],
                colWidths=[46.1 * mm] * 6)
    kpi.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), blue), ("ROUNDEDCORNERS", [5, 5, 5, 5]), ("LINEAFTER", (0, 0), (-2, -1), 3, colors.white),
                             ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("LEFTPADDING", (0, 0), (-1, -1), 7)]))

    # Section 1: Consolidated Holdings Valuation Table (with Investment Period / Timeframe column)
    cols = [
        "S. No", "Scheme / Security Name", "Folio / Account", "Investment Period & Timeframe",
        "Total Invested (₹) (A+B)", "Investments (₹) (A)", "Div. Reinv. (B)", "Div. Payout",
        "Units / Qty", "Current NAV (₹)", "Current Market Value (₹)", "Weight (%)", "Abs. Ret (%)", "Ann. Ret / XIRR (%)",
    ]
    rows = [[P(h, head_l if idx in (1, 2, 3) else head) for idx, h in enumerate(cols)]]
    for i, r in enumerate(data["rows"], 1):
        prd = r.get("period") or _period_label(r.get("from_date") or "", r.get("to_date") or "", r.get("days"), str(r.get("inst") or "")) or "-"
        cat_sub = r.get("category") or r.get("asset_class") or ""
        name_txt = r["name"] + (f" {r['flag']}" if r.get("flag") else "")
        if cat_sub and cat_sub not in name_txt:
            name_cell = Paragraph(f"<b>{xml_escape(name_txt)}</b><br/><font size='6.0' color='#5B6577'>{xml_escape(cat_sub)}</font>", body)
        else:
            name_cell = P(name_txt)
        rows.append([
            P(str(i), right),
            name_cell,
            P(r.get("folio") or "-"),
            P(prd, center),
            *[P(ind(r.get(k, 0.0)), right) for k in ("invested", "investments", "div_reinv", "div_payout", "units", "nav", "value")],
            P(f"{r.get('weight', 0.0):.2f}%", right),
            P(f"{r.get('abs_ret', 0.0):.2f}%", right),
            P(f"{r.get('ann_ret', 0.0):.2f}%", right_b),
        ])
    rows.append([
        P(""), P("Grand Total", bold), P(""), P(tf_summary[:28] if tf_summary else "-", center_b),
        P(ind(t["invested"]), right_b), P(ind(t["investments"]), right_b), P(ind(t["div_reinv"]), right_b), P(ind(t["div_payout"]), right_b),
        P(""), P(""), P(ind(t["value"]), right_b), P("100.00%", right_b), P(f"{t['abs_ret']:.2f}%", right_b),
        P("-" if data.get("xirr") is None else f"{data['xirr']:.2f}%", right_b),
    ])
    # Total width = 277 mm
    widths = [7, 46, 19, 25, 22, 21, 16, 14, 18, 15, 24, 16, 16, 18]
    table = Table(rows, colWidths=[w * mm for w in widths], repeatRows=1)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, grey),
        ("BACKGROUND", (0, 0), (-1, 0), navy),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, soft]),
        ("BACKGROUND", (0, -1), (-1, -1), blue),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
    ]))

    story: list[Any] = [top, Spacer(1, 6), kpi, Spacer(1, 8), P("1. Consolidated Portfolio Valuation — Folio & Holding Wise", sec_h), table]

    # Section 2: Asset Class & Category Allocation Matrices (side-by-side)
    alloc_asset = mat.get("asset_allocation") or []
    alloc_cat = mat.get("category_allocation") or []
    if alloc_asset or alloc_cat:
        def _alloc_tbl(title_col: str, items: list[dict[str, Any]], w_total: float) -> Table:
            hdr = [P(title_col, head_l), P("Schemes", head), P("Invested (₹)", head), P("Current Value (₹)", head), P("Gain / Loss (₹)", head), P("Weight %", head), P("Abs. Ret %", head)]
            arows = [hdr]
            for it in items[:10]:
                arows.append([
                    P(it["name"], bold), P(str(it["count"]), center),
                    P(ind(it["invested"]), right), P(ind(it["value"]), right),
                    P(ind(it["gain"]), right), P(f"{it['weight']:.2f}%", right), P(f"{it['abs_ret']:.2f}%", right),
                ])
            cw = [w_total * x for x in (0.26, 0.09, 0.17, 0.17, 0.15, 0.08, 0.08)]
            at = Table(arows, colWidths=cw, repeatRows=1)
            at.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.35, grey),
                ("BACKGROUND", (0, 0), (-1, 0), navy),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, soft]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
            ]))
            return at

        t_asset = _alloc_tbl("Asset Class", alloc_asset, 136 * mm) if alloc_asset else P("")
        t_cat = _alloc_tbl("Category Breakdown", alloc_cat, 136 * mm) if alloc_cat else P("")
        side = Table([[t_asset, P(""), t_cat]], colWidths=[136 * mm, 5 * mm, 136 * mm])
        side.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        story += [Spacer(1, 8), KeepTogether([P("2. Asset Allocation & Category Matrix", sec_h), side])]

    # Section 3: 4-Index Nifty Benchmark Comparison Matrix (Same-Instalment XIRR)
    cmp_ = mat.get("compare") or {}
    m_rows = cmp_.get("matrix_rows") or []
    idx_tots = cmp_.get("index_totals") or {}
    if m_rows and idx_tots:
        p_key = cmp_.get("primary_bench_key") or "n500"
        m_hdr = [
            P("Fund", head_l), P("Investment Period", head), P("Your Return", head),
            P("Nifty 50" + ("*" if p_key == "n50" else ""), head),
            P("Nifty 500 TRI" + ("*" if p_key == "n500" else ""), head),
            P("Nifty Midcap 150 TRI" + ("*" if p_key == "mid150" else ""), head),
            P("Nifty Smallcap 250 TRI" + ("*" if p_key == "small250" else ""), head),
            P("Official SEBI Benchmark", head_l),
            P("Indices Beaten", head),
        ]
        b_rows = [m_hdr]
        for mr in m_rows:
            cells = mr.get("cells") or {}
            row_cells = [P(mr.get("name") or "-", bold), P(mr.get("period") or "-", center), P(f"{mr.get('ret', 0.0):.2f}%", right_b)]
            for ik in ("n50", "n500", "mid150", "small250"):
                c_obj = cells.get(ik)
                if c_obj and c_obj.get("idx") is not None:
                    lead = float(c_obj.get("lead") or 0.0)
                    col_hex = "#147A3D" if lead >= 0 else "#B42318"
                    sign = "+" if lead >= 0 else ""
                    row_cells.append(Paragraph(f"{c_obj['idx']:.2f}%  <font color='{col_hex}'><b>({sign}{lead:.2f}%)</b></font>", center))
                else:
                    row_cells.append(P("-", center))
            row_cells.append(P(mr.get("bench_label") or "-"))
            row_cells.append(P(f"{mr.get('beaten', 0)} of 4", center_b))
            b_rows.append(row_cells)

        # Total portfolio row
        tot_cells = [P("Total Portfolio (Same Instalments)", bold), P(tf_summary[:26] if tf_summary else "-", center_b), P(f"{cmp_.get('portfolio_xirr') or data.get('xirr') or 0.0:.2f}%", right_b)]
        for ik in ("n50", "n500", "mid150", "small250"):
            tc = idx_tots.get(ik)
            if tc and tc.get("idx") is not None:
                lead = float(tc.get("lead") or 0.0)
                col_hex = "#147A3D" if lead >= 0 else "#B42318"
                sign = "+" if lead >= 0 else ""
                tot_cells.append(Paragraph(f"<b>{tc['idx']:.2f}%  <font color='{col_hex}'>({sign}{lead:.2f}%)</font></b>", center))
            else:
                tot_cells.append(P("-", center_b))
        tot_cells.append(P(cmp_.get("primary_bench_label") or "Nifty 500 TRI", bold))
        tot_cells.append(P(f"{cmp_.get('indices_beaten', 0)} of 4", center_b))
        b_rows.append(tot_cells)

        # Equivalent index value today row
        val_cells = [P("Equivalent Index Value Today (₹)", bold), P(f"Invested ₹{ind(cmp_.get('total_invested') or t['invested'], 0)}", center), P("₹" + ind(cmp_.get("total_value") or t["value"], 0), right_b)]
        for ik in ("n50", "n500", "mid150", "small250"):
            tc = idx_tots.get(ik)
            val_cells.append(P("₹" + ind(tc["val"], 0) if tc and tc.get("val") else "-", center_b))
        ahead_500 = float(cmp_.get("ahead_inr_500") or 0.0)
        val_cells.append(P(f"{'+' if ahead_500 >= 0 else ''}₹{ind(ahead_500, 0)} vs Nifty 500", bold))
        val_cells.append(P("", center))
        b_rows.append(val_cells)

        b_widths = [52, 27, 20, 32, 32, 32, 32, 32, 20]
        bt = Table(b_rows, colWidths=[w * mm for w in b_widths], repeatRows=1)
        bt.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.35, grey),
            ("BACKGROUND", (0, 0), (-1, 0), navy),
            ("ROWBACKGROUNDS", (0, 1), (-1, -3), [colors.white, soft]),
            ("BACKGROUND", (0, -2), (-1, -1), blue),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        story += [Spacer(1, 8), KeepTogether([
            P(f"3. Benchmark & 4-Index Nifty Comparison Matrix — Portfolio beat {cmp_.get('indices_beaten', 0)} of 4 Nifty Indices", sec_h),
            bt,
            Spacer(1, 2),
            P(cmp_.get("benchmark_note") or "Each purchase is notionally invested in each Nifty index on the exact purchase date.", small),
        ])]

    # Section 4: Fund Horizon Quality, Risk, Capture Ratios & Drawdown Matrix
    risk_rows = mat.get("risk_matrix") or []
    if risk_rows:
        r_hdr = [
            P("Scheme", head_l), P("Category", head_l), P("Value (₹)", head),
            P("3Y CAGR", head), P("Up Capture (3Y)", head), P("Down Capture (3Y)", head), P("Capture Ratio", head),
            P("Max Fall (3Y)", head), P("Max Fall (All)", head), P("FH Score", head), P("FH Signal", head), P("Live NAV Date", head),
        ]
        r_tbl_rows = [r_hdr]
        for rm in risk_rows:
            sig = rm.get("fh_signal") or ("Excluded" if rm.get("reason") else "-")
            r_tbl_rows.append([
                P(rm["name"] + (" ★" if rm.get("recommended") else ""), bold),
                P(rm.get("category") or "-"),
                P(ind(rm.get("value"), 0), right),
                P("-" if rm.get("cagr_3y") is None else f"{rm['cagr_3y']:.2f}%", right),
                P("-" if rm.get("cap_up_3y") is None else f"{rm['cap_up_3y']:.0f}%", center),
                P("-" if rm.get("cap_down_3y") is None else f"{rm['cap_down_3y']:.0f}%", center),
                P("-" if rm.get("cap_ratio_3y") is None else f"{rm['cap_ratio_3y']:.2f}", center_b),
                P("-" if rm.get("max_dd_3y") is None else f"{rm['max_dd_3y']:.1f}%", right),
                P("-" if rm.get("max_dd_all") is None else f"{rm['max_dd_all']:.1f}%", right),
                P("-" if rm.get("fh_score") is None else f"{rm['fh_score']:.1f}", center_b),
                P(sig, center_b),
                P(rm.get("nav_date") or "-", center),
            ])
        r_widths = [58, 30, 24, 18, 20, 20, 18, 19, 19, 17, 17, 17]
        rt = Table(r_tbl_rows, colWidths=[w * mm for w in r_widths], repeatRows=1)
        rt.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.35, grey),
            ("BACKGROUND", (0, 0), (-1, 0), navy),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, soft]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        story += [Spacer(1, 8), KeepTogether([P("4. Fund Horizon Quality, Risk, Capture Ratios & Drawdown Matrix", sec_h), rt])]

    # Section 5: Stress Test Matrix & Portfolio Observations
    stress_rows = mat.get("stress_test") or []
    recs = mat.get("recommendations") or []
    if stress_rows or recs:
        st_hdr = [P("Market Stress Scenario", head_l), P("Covered", head), P("Est. Impact (₹)", head), P("Impact (%)", head)]
        st_data = [st_hdr] + [[P(s["scenario"]), P(s["covered"], center), P(s["change_inr"], right_b), P(s["change_pct"], right_b)] for s in stress_rows]
        st_tbl = Table(st_data, colWidths=[76 * mm, 18 * mm, 24 * mm, 18 * mm], repeatRows=1) if stress_rows else P("")
        if stress_rows:
            st_tbl.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.35, grey), ("BACKGROUND", (0, 0), (-1, 0), navy),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, soft]), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]))
        rec_items = [Paragraph(f"• <b>{xml_escape(rc['title'])}:</b> {xml_escape(rc['body'])}", body) for rc in recs[:4]]
        rec_box = Table([[r] for r in rec_items], colWidths=[136 * mm]) if rec_items else P("")
        if rec_items:
            rec_box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), soft), ("BOX", (0, 0), (-1, -1), 0.35, grey), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]))
        s5 = Table([[st_tbl, P(""), rec_box]], colWidths=[136 * mm, 5 * mm, 136 * mm])
        s5.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        story += [Spacer(1, 8), KeepTogether([P("5. Stress Test Matrix & Portfolio Observations", sec_h), s5])]

    # Factsheets (PMS / AMC)
    for fs in data.get("factsheets") or []:
        ft = Table([[P(fs["source"], head_l), P("", head)]] + [[P(it["label"], bold), P(it["value"])] for it in fs["items"]], colWidths=[75 * mm, 202 * mm])
        ft.setStyle(TableStyle([("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), navy), ("GRID", (0, 0), (-1, -1), 0.35, grey), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, soft]), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
        story += [Spacer(1, 8), KeepTogether([P("Factsheet & Strategy Highlights", sec_h), ft])]

    # Notes & Regulatory Disclosures
    story += [Spacer(1, 6), P("Notes & Regulatory Disclosures:", bold)]
    story += [P(f"{i}. {n}", small) for i, n in enumerate(NOTES, 1)]
    for d_line in DISCLOSURE_LINES[:3]:
        story.append(P(f"• {d_line}", small))

    def decorate_page(cv, doc):
        cv.saveState()
        cv.setStrokeColor(teal)
        cv.setLineWidth(0.6)
        cv.line(10 * mm, 9.5 * mm, landscape(A4)[0] - 10 * mm, 9.5 * mm)
        cv.setFont(BODY_FONT, 6.8)
        cv.setFillColor(muted)
        cv.drawString(10 * mm, 6 * mm, f"{FIRM} ({ARN})  ·  Confidential Consolidated Client Report  ·  Generated {gen_at}".replace("<", "‹"))
        cv.drawRightString(landscape(A4)[0] - 10 * mm, 6 * mm, f"{c.get('name') or 'Client'}  |  As on {val_date_str}  |  Page {doc.page}".replace("<", "‹"))
        cv.restoreState()

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=13 * mm,
                      title=f"Portfolio Valuation Report - {c.get('name') or 'Client'}", author=FIRM).build(story, onFirstPage=decorate_page, onLaterPages=decorate_page)
    return buf.getvalue()
