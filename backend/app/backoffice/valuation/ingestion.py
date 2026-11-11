"""Format-level reading (PDF text layer, Excel, CSV) and header-driven table/label extraction shared by adapters.

No OCR on purpose: a PDF without a text layer is flagged for manual review rather than guessed.
Layouts are never assumed by position: columns are found from header words, and a row whose figures do not match the
header's column count is skipped with a warning instead of being mapped by guesswork.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, datetime
from typing import Any

from app.backoffice.valuation.canonical import ExtractionError, FlowRec, HoldingRec

MIN_TEXT_LETTERS = 150


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------- readers
def kind_of(name: str, data: bytes) -> str:
    low = name.lower()
    if b"%PDF" in data[:1024]:
        return "pdf"
    if data.startswith(b"PK") and low.endswith((".xlsx", ".xlsm")):
        return "xlsx"
    if data.startswith(b"\xd0\xcf\x11\xe0") and low.endswith(".xls"):
        return "xls"
    if low.endswith((".csv", ".tsv", ".txt")) and b"\x00" not in data[:512]:
        return "csv"
    raise ExtractionError("unsupported_file", f"{name}: unsupported file type (PDF, XLSX, XLS or CSV expected).")


def read_pdf_pages(data: bytes, password: str = "", mode: str = "layout") -> list[str]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        rd = PdfReader(io.BytesIO(data))
        if rd.is_encrypted and not rd.decrypt(password or ""):
            raise ExtractionError("password_required", "The PDF is password-protected; supply the correct password.")
        return [(p.extract_text(extraction_mode=mode) or "") for p in rd.pages]
    except ExtractionError:
        raise
    except (PdfReadError, ValueError, KeyError, OSError) as e:
        raise ExtractionError("corrupt_file", f"The PDF could not be read ({type(e).__name__}).") from e


def is_scanned(pages: list[str]) -> bool:
    return sum(len(re.findall(r"[A-Za-z]", p)) for p in pages) < MIN_TEXT_LETTERS


def read_sheets(name: str, data: bytes) -> dict[str, list[list[Any]]]:
    k = kind_of(name, data)
    try:
        if k == "csv":
            text = data.decode("utf-8-sig", "replace")
            delim = "\t" if text[:4096].count("\t") > text[:4096].count(",") else ","
            return {"csv": [list(r) for r in csv.reader(io.StringIO(text), delimiter=delim)]}
        import pandas as pd

        frames = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None)
        return {str(n): df.astype(object).where(df.notna(), None).values.tolist() for n, df in frames.items()}
    except Exception as e:  # corrupt / encrypted workbook
        raise ExtractionError("corrupt_file", f"The spreadsheet could not be read ({type(e).__name__}).") from e


# --------------------------------------------------------------------------- scalars
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DATE_RE = (r"\d{1,2}[-/. ]\d{1,2}[-/. ]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[-/. ](?:[A-Za-z]{3,9})[-/. ,]+\d{4}|[A-Za-z]{3,9} \d{1,2}, \d{4}")


def parse_date(v: Any) -> str | None:
    """ISO date or None. Day-first for numeric formats (Indian statements); never guesses an ambiguous two-digit year."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    if m := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?", s):
        y, mo, d = map(int, m.groups())
    elif m := re.fullmatch(r"(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})", s):
        d, mo, y = map(int, m.groups())
    elif m := re.fullmatch(r"(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{4})", s):
        d, y = int(m.group(1)), int(m.group(3))
        mo = _MONTHS.get(m.group(2)[:3].lower(), 0)
    elif m := re.fullmatch(r"([A-Za-z]{3,9}) (\d{1,2}), (\d{4})", s):
        mo, d, y = _MONTHS.get(m.group(1)[:3].lower(), 0), int(m.group(2)), int(m.group(3))
    else:
        return None
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def to_num(v: Any) -> float | None:
    """'1,23,456.78' / '(1,234.00)' / '-12' / 12 -> float. Blank, '-', 'NA', text -> None (never 0)."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)
    s = str(v).strip().replace("₹", "").replace("Rs.", "").replace("Rs", "").replace(",", "").replace(" ", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if s.endswith("-"):
        neg, s = True, s[:-1]
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", s):
        return None
    f = float(s)
    return -f if neg else f


_NUM_TOK = re.compile(r"^[₹(]?-?\d[\d,]*(?:\.\d+)?%?\)?-?$")


def is_num_tok(t: str) -> bool:
    return bool(_NUM_TOK.match(t))


# --------------------------------------------------------------------------- header driven columns
_SKIP = r"%|percent|xirr|return|weight|allocation|holding\s*period|days?\b"
# (field, regex) in priority order; the first regex that matches a header cell claims it.
COLUMN_PATTERNS: list[tuple[str, str]] = [
    ("skip", _SKIP),
    ("isin", r"\bisin\b"),
    ("unrealised_gain", r"unreali[sz]ed|appreciation|notional|gain\s*/\s*loss|gain\b|profit"),
    ("realised_gain", r"reali[sz]ed"),
    ("avg_cost", r"avg\.?\s*(cost|price|rate)|average\s*(cost|price|rate)|purchase\s*(price|rate|nav)|cost\s*(per\s*unit|price|rate|nav)"),
    ("market_value", r"market\s*val|mkt\s*val|current\s*(market\s*)?val|valuation|value\s*as\s*on|closing\s*value|^value$"),
    ("price", r"market\s*price|current\s*(price|nav)|closing\s*price|\bcmp\b|\bltp\b|\bnav\b|^price$|^rate$"),
    ("invested_amount", r"cost\s*val|total\s*cost|holding\s*cost|book\s*val|invested|purchase\s*(val|amount)|amount\s*invested|^cost$|cost\s*of\s*(acq|inv)"),
    ("quantity", r"quantity|\bqty\b|\bunits?\b|no\.?\s*of\s*(shares|units)|balance\s*units"),
    ("income", r"dividend|income|interest|coupon"),
    ("folio", r"folio|account\s*(no|number|code)|client\s*code"),
    ("asset_type", r"asset\s*(class|type)|category|instrument\s*type|security\s*type"),
    ("security_name", r"scheme|security|instrument|stock|scrip|script|company|particulars|asset\s*name|^name$|fund\s*name|name\s*of"),
]
_COL_RES = [(f, re.compile(p, re.I)) for f, p in COLUMN_PATTERNS]
_TEXT_ORDER_RE = re.compile("|".join(f"(?P<{f}{i}>{p})" for i, (f, p) in enumerate(COLUMN_PATTERNS)), re.I)
_TOTAL_NAME = re.compile(r"(?i)^\s*(grand\s+)?(sub\s*)?total\b|^net\s+total")


def classify_header(cell: Any) -> str | None:
    h = re.sub(r"\s+", " ", str(cell or "").strip().lower())
    if not h:
        return None
    for field, rx in _COL_RES:
        if rx.search(h):
            return None if field == "skip" else field
    return None


def map_header_row(row: list[Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for i, c in enumerate(row):
        f = classify_header(c)
        if f and f not in out:
            out[f] = i
    return out


def is_holdings_header(cols: dict[str, int]) -> bool:
    return "security_name" in cols and "market_value" in cols


def valid_isin(s: str | None) -> bool:
    """ISIN format + check digit (Luhn over the digit-expanded string)."""
    if not s or not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", s):
        return False
    digits = "".join(str(int(c, 36)) for c in s)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            n -= 9 if n > 9 else 0
        total += n
    return total % 10 == 0


def _holding_from_cells(cell: dict[str, Any], page: str, row_no: int, warnings: list[str]) -> HoldingRec | None:
    name = re.sub(r"\s+", " ", str(cell.get("security_name") or "")).strip()
    nums = {f: to_num(cell.get(f)) for f in ("quantity", "avg_cost", "invested_amount", "price", "market_value",
                                            "unrealised_gain", "realised_gain", "income")}
    if len(re.findall(r"[A-Za-z]", name)) < 3:
        return None
    if all(v is None for v in nums.values()):
        return None  # section heading / blank line
    isin = str(cell.get("isin") or "").strip().upper() or None
    if not isin and (m := re.search(r"\b(IN[A-Z0-9]{10})\b", name.upper())):
        isin = m.group(1)
    h = HoldingRec(security_name=name, isin=isin, account_no=(str(cell.get("folio")).strip() or None) if cell.get("folio") not in (None, "") else None,
                   source_page=page, source_row=row_no, **nums)
    h.issues.append(f"asset_type_hint:{cell['asset_type']}") if cell.get("asset_type") else None
    return h


def holdings_from_rows(rows: list[list[Any]], sheet: str) -> tuple[list[HoldingRec], dict[str, float | None], list[str], list[tuple[HoldingRec, str]]]:
    """Find holdings tables in a sheet. Returns (holdings, printed_total_row, warnings, [(holding, section_hint)])."""
    holdings: list[HoldingRec] = []
    hints: list[tuple[HoldingRec, str]] = []
    totals: dict[str, float | None] = {}
    warnings: list[str] = []
    cols: dict[str, int] = {}
    section = ""
    for n, row in enumerate(rows, 1):
        mapped = map_header_row(row)
        if is_holdings_header(mapped):
            cols, section = mapped, ""
            continue
        if not cols:
            continue
        cell = {f: (row[i] if i < len(row) else None) for f, i in cols.items()}
        name = str(cell.get("security_name") or "").strip()
        first_text = next((str(c).strip() for c in row if isinstance(c, str) and c.strip()), "")
        if _TOTAL_NAME.match(name) or (not name and _TOTAL_NAME.match(first_text)):
            tv, ti = to_num(cell.get("market_value")), to_num(cell.get("invested_amount"))
            if tv is not None:
                totals["table_total_value"] = tv
            if ti is not None:
                totals["table_total_invested"] = ti
            continue
        h = _holding_from_cells(cell, sheet, n, warnings)
        if h is None:
            if name and len(name) < 60 and not any(c for k, c in cell.items() if k != "security_name" and c not in (None, "")):
                section = name  # a name-only line is a section heading ("Equity", "Debt")
            continue
        if h.market_value is None:
            warnings.append(f"{sheet} row {n}: '{h.security_name[:40]}' has no market value.")
        holdings.append(h)
        hints.append((h, section))
    return holdings, totals, warnings, hints


def holdings_from_text(pages: list[str]) -> tuple[list[HoldingRec], dict[str, float | None], list[str], list[tuple[HoldingRec, str]]]:
    """PDF text lines -> holdings using the header line's column ORDER. A row whose trailing numeric run does not equal the
    number of numeric header columns is skipped and reported (never mapped by guesswork)."""
    holdings: list[HoldingRec] = []
    hints: list[tuple[HoldingRec, str]] = []
    totals: dict[str, float | None] = {}
    warnings: list[str] = []
    order: list[str] = []  # numeric/other fields in header order, skip columns included as "skip"
    section = ""
    for pno, text in enumerate(pages, 1):
        for lno, line in enumerate(text.splitlines(), 1):
            ln = line.strip()
            if not ln:
                continue
            fields = []
            for m in _TEXT_ORDER_RE.finditer(ln.lower()):
                g = re.sub(r"\d+$", "", m.lastgroup or "")
                fields.append(g)
            fields = [f for i, f in enumerate(fields) if f not in fields[:i] or f == "skip"]
            if "security_name" in fields and "market_value" in fields and len(fields) >= 3 and not re.search(r"\d{3,}", ln):
                order = [f for f in fields if f not in ("security_name", "isin", "folio", "asset_type")]
                continue
            toks = ln.split()
            end = len(toks)
            while end and not is_num_tok(toks[end - 1]):
                end -= 1
            start = end
            while start and is_num_tok(toks[start - 1]):
                start -= 1
            run, prefix = toks[start:end], " ".join(toks[:start])
            if _TOTAL_NAME.match(prefix) and run and order:
                vals = [to_num(t.rstrip("%")) for t in run]
                if len(vals) == len(order):
                    d = dict(zip(order, vals))
                    if d.get("market_value") is not None:
                        totals["table_total_value"] = d["market_value"]
                    if d.get("invested_amount") is not None:
                        totals["table_total_invested"] = d["invested_amount"]
                continue
            if not run:
                if 2 < len(ln) < 50 and not re.search(r"\d", ln):
                    section = ln
                continue
            if not order:
                continue
            if len(re.findall(r"[A-Za-z]", prefix)) < 4:
                continue
            if len(run) != len(order):
                if len(run) >= 3:
                    warnings.append(f"p{pno} line {lno}: skipped '{prefix[:40]}' ({len(run)} figures, header has {len(order)}).")
                continue
            cell: dict[str, Any] = {"security_name": prefix}
            for f, t in zip(order, run):
                if f != "skip":
                    cell[f] = t
            if m := re.search(r"\b(IN[A-Z0-9]{10})\b", prefix.upper()):
                cell["isin"] = m.group(1)
                cell["security_name"] = re.sub(r"\s*\b" + m.group(1) + r"\b\s*", " ", prefix, flags=re.I).strip()
            h = _holding_from_cells(cell, f"p{pno}", lno, warnings)
            if h:
                holdings.append(h)
                hints.append((h, section))
    return holdings, totals, warnings, hints


# --------------------------------------------------------------------------- real-statement readers
# Extra readers tried when the header-line reader (holdings_from_text) finds nothing or does not add up to the printed total.
def pdfium_pages(data: bytes, password: str = "") -> list[str]:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data, password=password or None)
        return [pg.get_textpage().get_text_range().replace("\r", "") for pg in pdf]
    except Exception:
        return []


def holdings_from_columns(data: bytes, password: str = ""):
    """Positional reader for multi-column PDFs (side panels, wrapped cells): columns come from the header words' x-range,
    rows from the market-value cells' y. Wrapped names are joined by nearest row."""
    import pypdfium2 as pdfium

    holdings: list[HoldingRec] = []
    hints: list[tuple[HoldingRec, str]] = []
    totals: dict[str, float | None] = {}
    warnings: list[str] = []
    try:
        pdf = pdfium.PdfDocument(data, password=password or None)
        pages = [pg.get_textpage() for pg in pdf]
    except Exception:
        return holdings, totals, warnings, hints
    cols: dict[str, tuple[float, float]] = {}
    name_hi = hdr_y = 0.0
    for pno, tp in enumerate(pages, 1):
        spans = []
        for i in range(tp.count_rects()):
            l, b, r, t = tp.get_rect(i)
            txt = tp.get_text_bounded(l, b, r, t).strip()
            if txt:
                spans.append(((b + t) / 2, l, r, txt))
        lines_: list[list] = []
        for sp in sorted(spans, key=lambda s: -s[0]):
            if lines_ and lines_[-1][-1][0] - sp[0] <= 2.5:
                lines_[-1].append(sp)
            else:
                lines_.append([sp])
        for line in lines_:
            mapped = {}
            for y, l, r, txt in sorted(line, key=lambda s: s[1]):
                f = classify_header(txt)
                if f and f not in mapped and not re.search(r"\d{3,}", txt):
                    mapped[f] = (y, l, r)
            if is_holdings_header(mapped):
                hdr_y = mapped["security_name"][0]
                cols = {f: (l, r) for f, (y, l, r) in mapped.items()}
                lefts = sorted(sp[1] for sp in line)
                nl = cols["security_name"][0]
                nxt = [x for x in lefts if x > nl + 5]
                name_hi = (nxt[0] - 2) if nxt else 1e9
                break
        else:
            if not cols:
                continue
        mv_l, mv_r = cols["market_value"]
        anchors = [sp for sp in spans if sp[0] < hdr_y - 3 and sp[2] > mv_l - 6 and sp[1] < mv_r + 6 and to_num(sp[3]) is not None]
        if not anchors:
            continue
        nl = cols["security_name"][0]
        names = [sp for sp in spans if sp[0] < hdr_y - 3 and nl - 4 <= sp[1] < name_hi]
        for y, l, r, txt in sorted(anchors, key=lambda a: -a[0]):
            mine = [n for n in names if min(anchors, key=lambda a: abs(a[0] - n[0])) is (y, l, r, txt) or
                    min(anchors, key=lambda a: abs(a[0] - n[0]))[0] == y]
            name = " ".join(n[3] for n in sorted(mine, key=lambda n: -n[0]))
            if not name:  # a label left of the value column that is not in the name column ("Total")
                name = " ".join(sp[3] for sp in spans if abs(sp[0] - y) < 3 and sp[2] < mv_l)
            if _TOTAL_NAME.match(name):
                totals["table_total_value"] = to_num(txt)
                continue
            cell: dict[str, Any] = {"security_name": name, "market_value": txt}
            for f, (cl, cr) in cols.items():
                if f in ("security_name", "market_value", "isin", "folio", "asset_type"):
                    continue
                hit = next((sp[3] for sp in spans if abs(sp[0] - y) < 4 and sp[2] > cl - 6 and sp[1] < cr + 6), None)
                if hit is not None:
                    cell[f] = hit
            h = _holding_from_cells(cell, f"p{pno}", int(y), warnings)
            if h:
                holdings.append(h)
                hints.append((h, ""))
    return holdings, totals, warnings, hints


_MF_NAME = re.compile(r"^\s*(?P<name>.+?\S)\s*\|\s*(?P<folio>[A-Za-z0-9/\-]+)\s*\|\s*(?P<holder>.+?)\s*$")
_MF_FIG = re.compile(r"^\s*(?P<nav>\d[\d,]*\.\d+)\s+(?P<date>\d{1,2}-\d{1,2}-\d{4})\s+(?P<units>\d[\d,]*(?:\.\d+)?)\s+₹\s*(?P<inv>-?[\d,.]+)\s+₹\s*(?P<cur>-?[\d,.]+)(?:\s+₹\s*(?P<gain>-?[\d,.]+))?")


def holdings_from_mf_blocks(pages: list[str]):
    """Distributor 'MF summary': '<scheme> | <folio> | <holder>' then 'NAV  date  units  ₹invested  ₹current  ₹gain ...'."""
    holdings: list[HoldingRec] = []
    hints: list[tuple[HoldingRec, str]] = []
    warnings: list[str] = []
    totals: dict[str, float | None] = {}
    for pno, text in enumerate(pages, 1):
        if m := re.search(r"Grand total\s+₹\s*(-?[\d,.]+)\s+₹\s*(-?[\d,.]+)", text, re.I):
            totals["table_total_invested"], totals["table_total_value"] = to_num(m[1]), to_num(m[2])
        pending = None
        for lno, line in enumerate(text.splitlines(), 1):
            if m := _MF_NAME.match(line):
                pending = m
                continue
            if pending and (f := _MF_FIG.match(line)):
                nav, units, cur = to_num(f["nav"]), to_num(f["units"]), to_num(f["cur"])
                h = HoldingRec(security_name=pending["name"], account_no=pending["folio"], quantity=units, price=nav,
                               invested_amount=to_num(f["inv"]), market_value=cur, unrealised_gain=to_num(f["gain"]),
                               source_page=f"p{pno}", source_row=lno)
                holdings.append(h)
                hints.append((h, "mutual fund"))
                pending = None
    return holdings, totals, warnings, hints


_TX_SCHEME = re.compile(r"^\s*(?P<name>.+?)\s*\|\s*(?P<isin>IN[A-Z0-9]{10})\s+Avg NAV:\s*[\d.,]+\s*\|\s*Curt NAV:\s*(?P<nav>[\d.,]+)")
_TX_VAL = re.compile(r"Amt inv:\s*₹?\s*(?P<inv>[\d,.]+)\s*\|\s*Curt val:\s*₹?\s*(?P<cur>[\d,.]+)")
_TX_FOLIO = re.compile(r"\(PAN:[^)]*\)\s*\|\s*(?P<folio>[A-Za-z0-9/\-]+)\s*$")
_TX_OPEN = re.compile(r"Opening balance\s+\d{1,2}-\d{1,2}-\d{4}\s+₹\s*0(?:\.0+)?\s+0\s+0\b")
_TX_ROW = re.compile(r"^\s*\d+\s+(?P<type>[A-Za-z][A-Za-z ./-]*?)\s+(?P<date>\d{1,2}-\d{1,2}-\d{4})\s+₹\s*(?P<amt>[\d,]+(?:\.\d+)?)"
                     r"\s+(?P<nav>[\d,]+\.?\d*)\s+(?P<units>[\d,]+\.?\d*)\s+(?P<bal>[\d,]+\.?\d*)\s+\d+")


def mf_txn_report(pages: list[str]):
    """Distributor 'MF Transaction Report': per scheme a '<name> | <ISIN> ... Curt NAV' line, an 'Amt inv | Curt val' line, a
    '<holder>(PAN:..)|<folio>' line, then dated rows. Holding = scheme totals; flows = the dated rows (SIP/purchase in, redemption out)."""
    holdings: list[HoldingRec] = []
    flows: list[FlowRec] = []
    hints: list[tuple[HoldingRec, str]] = []
    warnings: list[str] = []
    cur: HoldingRec | None = None
    zero_open = 0
    for pno, text in enumerate(pages, 1):
        for lno, line in enumerate(text.splitlines(), 1):
            if _TX_OPEN.search(line):
                zero_open += 1
            elif m := _TX_SCHEME.match(line):
                cur = HoldingRec(security_name=m["name"].strip(), isin=m["isin"], price=to_num(m["nav"]), source_page=f"p{pno}", source_row=lno)
                holdings.append(cur)
                hints.append((cur, "mutual fund"))
            elif cur is None:
                continue
            elif m := _TX_VAL.search(line):
                cur.invested_amount, cur.market_value = to_num(m["inv"]), to_num(m["cur"])
                cur.unrealised_gain = round(cur.market_value - cur.invested_amount, 2)
            elif m := _TX_FOLIO.search(line):
                cur.account_no = m["folio"]
            elif m := _TX_ROW.match(line):
                cur.quantity = to_num(m["bal"])
                kind, amt = classify_flow(m["type"]), to_num(m["amt"])
                if kind is None:
                    warnings.append(f"p{pno} line {lno}: transaction '{m['type']}' not classified; flows may be incomplete.")
                elif amt:
                    flows.append(FlowRec(flow_date=parse_date(m["date"]), kind=kind, amount=round(amt, 2), description=f"{cur.security_name[:60]} {m['type']}",
                                         account_no=cur.account_no, source_page=f"p{pno}", source_row=lno))
    # every scheme starts from nil on the report's first date, so the dated rows ARE the full history (shortcut: schemes fully
    # exited before the holding scheme list cannot be seen here, so the operator still sees the attested-complete flag)
    return holdings, {}, warnings, hints, flows, bool(holdings) and zero_open == len(holdings)


_CARD_AMT = re.compile(r"^₹(?P<inv>[\d,]+(?:\.\d+)?)\s+₹(?P<cur>[\d,]+(?:\.\d+)?)")
_CARD_SKIP = re.compile(r"^(invested|current|gains|prev\.? day|change|ann\. ret\.|\.\.\.|all|sort|total\b)", re.I)


def holdings_from_cards(pages: list[str]):
    """Web-page print of a portfolio (FundsIndia): wrapped scheme name lines, then '₹invested ₹current ...'. No units/NAV."""
    holdings: list[HoldingRec] = []
    hints: list[tuple[HoldingRec, str]] = []
    totals: dict[str, float | None] = {}
    buf: list[str] = []
    joined = "\n".join(pages)
    if m := re.search(r"Invested Value\s*₹([\d,.]+)\s*Current Value\s*₹([\d,.]+)", joined):
        totals["total_invested"], totals["table_total_value"] = to_num(m[1]), to_num(m[2])
    for pno, text in enumerate(pages, 1):
        buf = []
        for lno, raw in enumerate(text.splitlines(), 1):
            ln = re.sub(r"[\ufffe\uffff\xad]", "-", raw).strip()
            if not ln:
                continue
            if m := _CARD_AMT.match(ln):
                while len(buf) > 1 and re.search(r"\s\d{1,2}$", buf[0]):  # portfolio / member heading with scheme count
                    buf.pop(0)
                name = re.sub(r"\s+", " ", " ".join(buf)).strip()
                if name and re.search(r"[A-Za-z]{3}", name):
                    inv, cur = to_num(m["inv"]), to_num(m["cur"])
                    h = HoldingRec(security_name=name, invested_amount=inv, market_value=cur,
                                   unrealised_gain=round(cur - inv, 2) if inv is not None and cur is not None else None,
                                   source_page=f"p{pno}", source_row=lno)
                    holdings.append(h)
                    hints.append((h, "mutual fund"))
                buf = []
            elif re.match(r"^total\b", ln, re.I) or ln.startswith("...") or re.match(r"^ann\. ret", ln, re.I):
                buf = []
            elif re.search(r"market risks?|scheme information|performance is not|disclaimer|SEBI Reg|©|ARN", ln, re.I):
                continue
            elif "₹" in ln or _CARD_SKIP.match(ln) or re.search(r"^(dashboard|mutual fund|bonds|equity|fd|nps|msci|portfolio\b|include zero|holdings|summary|performance|deep|dive|capital gains|external|monthly sip|scheme name|https?:|\d+/\d+|\d{2}/\d{2}/\d{4})", ln, re.I):
                continue
            else:
                buf.append(ln)
    return holdings, totals, [], hints


_PRINT_DATE = re.compile(r"(\d{1,2}/\d{1,2}/\d{4}),\s*\d{1,2}:\d{2}")


def pick_best(cands: list[tuple]) -> tuple:
    """Candidate readers' (holdings, totals, warnings, hints): prefer one whose sum matches the printed total, else most rows."""
    def score(c):
        hs, tot = c[0], c[1]
        s, tv = sum(h.market_value or 0 for h in hs), tot.get("table_total_value")
        ok = bool(hs and tv and abs(s - tv) <= max(1.0, 0.005 * tv))
        return (ok, len(hs))
    return max(cands, key=score)


# --------------------------------------------------------------------------- labelled scalars
LABELS: dict[str, str] = {
    "total_value": r"(?:total\s+)?(?:portfolio|market|closing|current|net)\s+(?:value|valuation)|total\s+(?:value|aum)|closing\s+(?:aum|balance|value)|\baum\b|net\s+asset\s+value",
    "total_invested": r"(?:total\s+)?(?:capital|amount|net)?\s*(?:invested|investment)|cost\s+of\s+investment",
    "cash_balance": r"cash\s*(?:&|and)?\s*(?:bank\s*)?(?:balance|equivalents?)|cash\s+balance|bank\s+balance|^cash$",
    "opening_value": r"opening\s+(?:value|balance|aum|market\s+value|portfolio)|beginning\s+(?:value|balance)|value\s+at\s+start",
    "realised_gain": r"(?:total\s+)?reali[sz]ed\s+(?:gain|profit|p\s*&\s*l)",
    "unrealised_gain": r"(?:total\s+)?unreali[sz]ed\s+(?:gain|profit|p\s*&\s*l|appreciation)",
    "income": r"(?:total\s+)?(?:dividend|interest|income)(?:\s+(?:received|income))?",
    "fees": r"(?:total\s+)?(?:management|performance|fees?|charges|brokerage|expenses)(?:\s+(?:fees?|charges))?",
}
_LABEL_RES = {k: re.compile(v, re.I) for k, v in LABELS.items()}
_ACCT = re.compile(r"(?i)\b(?:client|account|a/c|ucc|portfolio|pms|investor)(?:\s*(?:code|no\.?|number|id)\s*[:\-]?|\s*:)\s*((?=[A-Z0-9/\-]*\d)[A-Z0-9][A-Z0-9/\-]{2,})")
_DATE_KW = re.compile(r"(?i)(?:as\s+(?:on|of|at)|valuation\s+date|statement\s+date|portfolio\s+date|period\s+ended?|for\s+the\s+month\s+ended?|up\s*to|to)\s*[:\-]?\s*(" + DATE_RE + ")")
_PERIOD = re.compile(r"(?i)(?:period|from)\s*[:\-]?\s*(" + DATE_RE + r")\s*(?:to|-|–)\s*(" + DATE_RE + ")")


def scan_scalars(lines: list[str], skip_prefixes: tuple[str, ...] = ()) -> tuple[dict[str, float | None], dict[str, Any], list[str]]:
    """Label -> number pairs ('Cash Balance : 12,345.00'), statement/period dates and account number from free text lines.
    Conflicting values for one label leave it unset with a warning (never pick one)."""
    found: dict[str, list[float]] = {}
    meta: dict[str, Any] = {"statement_date": None, "period_start": None, "account_no": None}
    warnings: list[str] = []
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if m := _PERIOD.search(s):
            meta["period_start"] = meta["period_start"] or parse_date(m.group(1))
            meta["statement_date"] = meta["statement_date"] or parse_date(m.group(2))
        elif m := _DATE_KW.search(s):
            meta["statement_date"] = meta["statement_date"] or parse_date(m.group(1))
        if (m := _ACCT.search(s)) and not meta["account_no"]:
            meta["account_no"] = m.group(1)
        if re.search(r"\bIN[A-Z0-9]{10}\b", s) or re.match(DATE_RE, s):
            continue  # a holding row or a dated transaction line, not a summary line
        for key, rx in _LABEL_RES.items():
            m = rx.search(s)
            if not m:
                continue
            tail = s[m.end():]
            tail = re.sub(DATE_RE, " ", tail)
            nm = re.search(r"[:\-\s]*(?:Rs\.?|₹)?\s*(\(?-?[\d,]+(?:\.\d+)?\)?)(?!\d|\s*%)", tail)
            # a bare small integer is a row number / count, not money
            if nm and not re.search(r"[,.]", nm.group(1)) and abs(to_num(nm.group(1)) or 0) < 1000:
                continue
            if nm and (v := to_num(nm.group(1))) is not None and s[: m.start()].strip().count(" ") < 3:
                found.setdefault(key, []).append(v)
                break
    totals: dict[str, float | None] = {}
    for k, vals in found.items():
        uniq = sorted(set(round(v, 2) for v in vals))
        if len(uniq) == 1:
            totals[k] = uniq[0]
        else:
            warnings.append(f"Label '{k}' appears with different values {uniq[:4]}; left blank for review.")
    return totals, meta, warnings


def sheet_lines(rows: list[list[Any]]) -> list[str]:
    """Spreadsheet rows -> 'label  value' lines so the same label scanner works on Excel and PDF."""
    out = []
    for r in rows:
        cells = [str(c).strip() for c in r if c is not None and str(c).strip() != ""]
        if cells:
            out.append("   ".join(cells[:6]))
    return out


# --------------------------------------------------------------------------- cash flows
FLOW_WORDS: list[tuple[str, str]] = [
    ("transfer_in", r"switch\s*in|transfer\s*in|stp\s*in|in-?specie\s*in"),
    ("transfer_out", r"switch\s*out|transfer\s*out|stp\s*out|in-?specie\s*out"),
    ("fee", r"fees?\b|charges?|brokerage|\bstt\b|\bgst\b|expenses?|stamp"),
    ("income", r"dividend|interest|coupon|idcw\s*payout"),
    ("deposit", r"contribution|capital\s*(?:infusion|inflow|introduced|addition|in\b)|deposit|subscription|purchase|\bsip\b|inflow|top.?up|funds?\s*received|investment"),
    ("withdrawal", r"withdraw|redemption|redeem|capital\s*(?:outflow|out\b)|outflow|payout|repatriat"),
]
_FLOW_RES = [(k, re.compile(v, re.I)) for k, v in FLOW_WORDS]


def classify_flow(text: str) -> str | None:
    for kind, rx in _FLOW_RES:
        if rx.search(text or ""):
            return kind
    return None


def flows_from_rows(rows: list[list[Any]], sheet: str) -> tuple[list[FlowRec], list[str]]:
    """Transaction tables: header with a date column, a description/type column and amount (or debit/credit) columns."""
    flows: list[FlowRec] = []
    warnings: list[str] = []
    hdr: dict[str, int] | None = None
    for n, row in enumerate(rows, 1):
        low = [re.sub(r"\s+", " ", str(c or "").strip().lower()) for c in row]
        if hdr is None or any(c in ("date", "transaction date", "trade date", "txn date") for c in low) and sum(bool(c) for c in low) >= 3:
            d = next((i for i, c in enumerate(low) if re.fullmatch(r"(txn |transaction |trade |value |flow )?date", c)), None)
            t = next((i for i, c in enumerate(low) if re.search(r"type|transaction|particulars|narration|description|nature|remarks", c) and "date" not in c), None)
            amt = next((i for i, c in enumerate(low) if re.fullmatch(r"(net )?amount( \(.*\))?|value", c)), None)
            cr = next((i for i, c in enumerate(low) if re.search(r"credit|inflow|deposit|contribution|in\b", c)), None)
            dr = next((i for i, c in enumerate(low) if re.search(r"debit|outflow|withdrawal|redemption|out\b", c)), None)
            if d is not None and (t is not None) and (amt is not None or cr is not None or dr is not None):
                hdr = {"d": d, "t": t, "a": amt, "cr": cr, "dr": dr}  # type: ignore[assignment]
                continue
        if not hdr:
            continue
        dt = parse_date(row[hdr["d"]]) if hdr["d"] < len(row) else None
        if not dt:
            continue
        desc = str(row[hdr["t"]]).strip() if hdr["t"] < len(row) and row[hdr["t"]] is not None else ""
        def get(k, row=row, hdr=hdr):
            return to_num(row[hdr[k]]) if hdr.get(k) is not None and hdr[k] < len(row) else None

        a, cr, dr = get("a"), get("cr"), get("dr")
        kind = classify_flow(desc)
        if hdr.get("a") is None:
            if cr:
                amount, kind = abs(cr), kind or "deposit"
            elif dr:
                amount, kind = abs(dr), kind or "withdrawal"
            else:
                continue
        else:
            amount = abs(a) if a is not None else None
        if amount is None or amount == 0:
            continue
        if kind is None:
            warnings.append(f"{sheet} row {n}: transaction '{desc[:40]}' not classified; flows may be incomplete.")
            continue
        flows.append(FlowRec(flow_date=dt, kind=kind, amount=round(amount, 2), description=desc[:200] or None,
                             source_page=sheet, source_row=n))
    return flows, warnings
