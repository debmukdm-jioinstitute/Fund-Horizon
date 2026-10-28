"""Generic parser for AMC consolidated monthly-portfolio workbooks (one sheet per scheme).

SEBI prescribes the disclosure columns, so most AMCs publish one workbook (or a zip of them) whose sheets share a
shape: a title block naming the scheme, a header row with ISIN / Industry (or Rating) / % to net assets, section
rows ("Equity & Equity related", "Debt Instruments"...) and holding rows. A sheet is accepted only when that header
is found and holding rows carry a numeric weight; anything else is skipped and reported, never guessed.
Sector is the disclosure's own Industry column. Scheme names are matched to AMFI codes exactly (see mf_holdings).
"""

from __future__ import annotations

import io
import re
import zipfile
from datetime import date, datetime
from typing import Any

from app.backoffice.holdings_ingest import _DEBT_KEYWORDS, _MONTH_NAMES

_MON = [x[:3].lower() for x in _MONTH_NAMES]
_ISIN = re.compile(r"IN[A-Z0-9]{10}")
_CASH = ("treps", "tri-party", "triparty", "tri party", "reverse repo", "repo", "net receivable", "cblo", "net current assets", "cash & cash")
_NOT_TITLE = re.compile(r"mutual fund|asset management|portfolio|as on|statement|live schemes|registered office|toll free|e-mail|www\.", re.I)
_SCHEMEISH = re.compile(r"\b(fund|etf|fof|scheme|plan)\b", re.I)
_TOTAL = re.compile(r"\b(sub\s*total|grand\s*total|total)\b", re.I)
_TITLE_PATTERNS = (
    re.compile(r"portfolio of\s+(.+?)\s+as on", re.I),
    re.compile(r"scheme name\s*:?\s*([^\s:].*)", re.I),
)
_ASON = re.compile(r"as on\s+([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})|as on\s+(\d{1,2})[-/ ]([A-Za-z]+)[-/ ](\d{4})", re.I)


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _instrument(section: str, name: str, isin: str = "") -> str:
    low = name.lower()
    if any(k in low for k in _CASH):
        return "cash"
    if re.fullmatch(r"INE\w{4}01\w{3}", isin):  # ISIN type digits "01" = equity share, whatever the section says
        return "equity"
    sec = section.lower()
    if "equity" in sec:
        return "equity"
    if "mutual fund" in sec:
        return "mf_units"
    if any(k in sec for k in _DEBT_KEYWORDS):
        return "debt"
    return "other"


def _find_header(rows: list[tuple]) -> tuple[int, dict[str, int]] | None:
    for i, row in enumerate(rows[:40]):
        cells = [_s(c).lower().replace("\n", " ") for c in row]
        isin = next((j for j, c in enumerate(cells) if c.startswith("isin")), None)
        wt = next((j for j, c in enumerate(cells) if re.search(r"%\s*(to|of)\b|% to", c)), None)
        nm = next((j for j, c in enumerate(cells) if "name of" in c), None)
        if isin is not None and wt is not None:
            sector = next((j for j, c in enumerate(cells) if "industry" in c or "rating" in c), None)
            return i, {"name_after_isin": nm is not None and nm > isin, "isin": isin, "weight": wt, "sector": sector if sector is not None else -1}
    return None


def _title_and_date(rows: list[tuple]) -> tuple[str | None, str | None]:
    name = as_of = fallback = None
    for row in rows:
        vals = [c for c in row if c not in (None, "")]
        for v in vals:
            if isinstance(v, (datetime, date)) and as_of is None:
                as_of = v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
            text = _s(v).replace("\n", " ")
            if not text:
                continue
            m = _ASON.search(text)
            if m and as_of is None:
                try:
                    if m.group(1):
                        as_of = date(int(m.group(3)), _MON.index(m.group(1)[:3].lower()) + 1, int(m.group(2))).isoformat()
                    else:
                        as_of = date(int(m.group(6)), _MON.index(m.group(5)[:3].lower()) + 1, int(m.group(4))).isoformat()
                except ValueError:
                    pass
            if name is None:
                for pat in _TITLE_PATTERNS:
                    m2 = pat.search(text)
                    if m2:
                        name = m2.group(1).strip()
                        break
        # "SCHEME NAME :" label with the name in the next cell
        if name is None and vals and _s(vals[0]).lower().startswith("scheme name") and len(vals) > 1:
            name = _s(vals[1])
        # [code?, scheme name, "Index"] link row (Nippon, LIC)
        if name is None and len(vals) >= 2 and _s(vals[-1]) == "Index" and isinstance(vals[-2], str) and not _NOT_TITLE.search(vals[-2]):
            name = vals[-2].strip()
        # Axis / Mahindra style: [short code, scheme name]; AMC banners and "Monthly Portfolio Statement" lines are not names
        if name is None and len(vals) == 2 and all(isinstance(v, str) for v in vals) and vals[0].strip() and " " not in vals[0].strip() \
                and " " in vals[1].strip() and not _NOT_TITLE.search(vals[1]):
            name = vals[1].strip()
        if name is None and len(vals) == 1 and isinstance(vals[0], str):
            t = vals[0].strip()
            if t and _SCHEMEISH.search(t) and not _NOT_TITLE.search(t) and not t.startswith("("):
                fallback = fallback or t
    return name or fallback, as_of


def parse_sheet(rows: list[tuple]) -> dict[str, Any] | None:
    """One scheme sheet -> {"scheme_name", "as_of", "holdings", "weight_sum"}; None when it is not a scheme sheet."""
    hdr = _find_header(rows)
    if hdr is None:
        return None
    idx, col = hdr
    after = col.pop("name_after_isin")
    # Data rows often carry an extra leading code column the header lacks (SBI, Axis): anchor on where ISINs really sit.
    real = next((j for row in rows[idx + 1: idx + 60] for j, c in enumerate(row) if isinstance(c, str) and _ISIN.fullmatch(c.strip())), None)
    if real is not None and real != col["isin"]:
        shift = real - col["isin"]
        col = {k: (v + shift if v >= 0 else v) for k, v in col.items()}
    col["name"] = col["isin"] + 1 if after else max(col["isin"] - 1, 0)
    scheme, as_of = _title_and_date(rows[:idx])
    if not scheme:
        return None
    scheme = re.sub(r"^[A-Z]{1,4}\d{1,3}\s*-\s*(?=[A-Za-z])", "", scheme.strip())  # Groww: "IB01-Groww Large Cap Fund"
    scheme = re.sub(r"\s*\((?:erstwhile|formerly)[^)]*\)\s*", "", scheme, flags=re.I)
    scheme = re.sub(r"\s*(?:\(|-\s+)(?:an?\s+)?(?:open|close|interval)[- ]?ended.*$", "", scheme, flags=re.I).strip()  # name annotation, not a different scheme
    holdings: list[dict[str, Any]] = []
    section = ""
    for row in rows[idx + 1:]:
        n = len(row)
        name = _s(row[col["name"]]) if col["name"] < n else ""
        w = row[col["weight"]] if col["weight"] < n else None
        if name and not isinstance(w, (int, float)):
            others = [c for c in row if c not in (None, "") and not isinstance(c, (int, float))]
            if len(others) == 1:  # a section heading row, e.g. "Equity & Equity related"
                section = name
            continue
        if not name or isinstance(w, bool) or not isinstance(w, (int, float)) or _TOTAL.search(name):
            continue
        isin = _s(row[col["isin"]]) if col["isin"] < n else ""
        sector = _s(row[col["sector"]]) if 0 <= col["sector"] < n else ""
        inst = _instrument(section, name, isin)
        # Derivative / hedge / summary tables below the main one use other columns: a holding needs an ISIN (cash rows excepted).
        if (not isin and inst != "cash") or abs(w) > 100:
            continue
        holdings.append({"name": name, "isin": isin or None, "sector": sector or None, "weight_pct": float(w),
                         "instrument_type": inst})
    if not holdings:
        return None
    total = sum(h["weight_pct"] for h in holdings)
    if total <= 1.5:  # some AMCs store fractions (0.0379), others percent (3.79)
        for h in holdings:
            h["weight_pct"] *= 100
        total *= 100
    for h in holdings:
        h["weight_pct"] = round(h["weight_pct"], 2)
        if h["instrument_type"] != "equity":
            h["sector"] = None  # debt rows carry a credit rating in that column, not a sector
    return {"scheme_name": scheme, "as_of": as_of, "holdings": holdings, "weight_sum": round(total, 2)}


def _xls_sheets(data: bytes) -> list[list[tuple]]:
    """Rows of every sheet of a legacy .xls (needs xlrd: run the ingest with `uv run --with xlrd`)."""
    try:
        import xlrd
    except ImportError as exc:
        raise RuntimeError("legacy .xls needs xlrd (uv run --with xlrd ...)") from exc
    wb = xlrd.open_workbook(file_contents=data)
    out = []
    for sh in wb.sheets():
        rows = []
        for r in range(sh.nrows):
            vals = []
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_DATE:
                    vals.append(datetime(*xlrd.xldate_as_tuple(cell.value, wb.datemode)))
                else:
                    vals.append(None if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK) else cell.value)
            rows.append(tuple(vals))
        out.append(rows)
    return out


def parse_workbook(data: bytes) -> list[dict[str, Any]]:
    """Every scheme sheet of one .xlsx (index and non-scheme sheets are skipped)."""
    import openpyxl

    if data[:4] == b"\xd0\xcf\x11\xe0":
        sheets = _xls_sheets(data)
    else:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheets = ([tuple(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets)
    out = []
    for rows in sheets:
        parsed = parse_sheet(rows)
        if parsed:
            out.append(parsed)
    return out


def parse_any(data: bytes) -> list[dict[str, Any]]:
    """An .xlsx/.xls, or a zip of them (each may hold one or many scheme sheets)."""
    if data[:2] == b"PK" and not zipfile.is_zipfile(io.BytesIO(data)):
        return []
    zf = zipfile.ZipFile(io.BytesIO(data)) if zipfile.is_zipfile(io.BytesIO(data)) else None
    if zf is not None and not any(n.startswith("xl/") or n == "[Content_Types].xml" for n in zf.namelist()):
        out: list[dict[str, Any]] = []
        for n in zf.namelist():
            if n.lower().endswith((".xlsx", ".xls")) and not n.startswith("__MACOSX"):
                out.extend(parse_workbook(zf.read(n)))
        return out
    return parse_workbook(data)


# ---- discovery + ingest -------------------------------------------------------------------------------------------

ADVISORKHOJ = "https://www.advisorkhoj.com/mutual-funds-research/mutual-fund-portfolio"
WEIGHT_TOLERANCE = (85.0, 115.0)  # hedged hybrids exceed 100 (futures); outside this the sheet is not a clean portfolio
_FILE_LINK = re.compile(r"\.(xlsx?|zip)(\?|$)", re.I)


def amc_slug(amc_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", re.sub(r"\s*mutual fund$", "", amc_name, flags=re.I).lower()).strip("_")


def list_amcs(fetch) -> list[str]:
    """AMC names offered by Advisorkhoj's portfolio page selector."""
    html_ = fetch(f"{ADVISORKHOJ}/Axis-Mutual-Fund/{date.today().year}").decode("utf-8", "ignore")
    sel = re.search(r'<select id="sel_amc".*?</select>', html_, re.S)
    return [n.strip() for n in re.findall(r"<option[^>]*>([^<]+)</option>", sel.group(0)) if "Mutual Fund" in n] if sel else []


_DATE_IN_URL = (
    (re.compile(r"(\d{2})[-_.](\d{2})[-_.](\d{4})"), lambda m: (m[3], m[2], m[1])),
    (re.compile(r"(\d{2})(\d{2})(20\d{2})"), lambda m: (m[3], m[2], m[1])),
    (re.compile(r"(\d{1,2})[-_ .,%20]*([A-Za-z]{3})[a-z]*[-_ .,%20]*(20\d{2})"), lambda m: (m[3], f"{_MON.index(m[2].lower()) + 1:02d}" if m[2].lower() in _MON else "00", m[1])),
    (re.compile(r"([A-Za-z]{3})[a-z]*[-_ .,%20]*(\d{1,2})[-_ .,%20]*(20\d{2})"), lambda m: (m[3], f"{_MON.index(m[1].lower()) + 1:02d}" if m[1].lower() in _MON else "00", m[2])),
)


def _link_date(url: str) -> tuple[str, str, str] | None:
    for rx, fn in _DATE_IN_URL:
        m = rx.search(url)
        if m:
            y, mo, d = fn(m)
            if mo != "00" and 1 <= int(mo) <= 12:
                return y, mo.zfill(2), d.zfill(2)
    return None


def _page_links(page: str, base: str) -> list[str]:
    from urllib.parse import urljoin

    import html as _html

    found = []
    for href in re.findall(r"[\"'(=]([^\"'<> ()]+\.(?:xlsx?|zip)(?:\?[^\"'<> ()]*)?)", page, re.I):
        url = urljoin(base, _html.unescape(href))
        if url not in found and re.search(r"portfolio|disclos|statutory|monthly|ir-", url, re.I) and not re.search(r"fortnight|nav_|ter_|dividend|riskometer|branch", url, re.I):
            found.append(url)
    return found


def disclosure_urls(fetch, amc_name: str, year: int | None = None) -> tuple[list[str], str | None, bool]:
    """The AMC's newest monthly file link(s), and a reason when none can be fetched.

    Advisorkhoj's AMC page lists the AMC's own files newest first; when it links only to the AMC's public disclosure page,
    that page is fetched and its static file links read: the newest dated one wins, several undated ones are all used.
    A page that blocks automated fetches or builds its list with JavaScript is reported, never worked around.
    """
    import html as _html

    year = year or date.today().year
    slug = re.sub(r"\s+", "-", amc_name)
    pages: list[str] = []
    files: list[str] = []
    for y in (year, year - 1):
        page = fetch(f"{ADVISORKHOJ}/{slug}/{y}").decode("utf-8", "ignore")
        for href in re.findall(r'href="(https?://(?!www\.advisorkhoj)[^"]+)"', page):
            href = _html.unescape(href)
            if _FILE_LINK.search(href):
                files.append(href)
            if re.search(r"portfolio|disclos", href, re.I) and href not in pages:
                pages.append(href)
        if files:
            # Newest first by the date in the link (Advisorkhoj's own order is not always chronological); the caller uses
            # the first that parses to a real consolidated file, since some AMCs list non-portfolio files among them.
            files.sort(key=lambda u: _link_date(u) or ("0000", "00", "00"), reverse=True)
            return files[:12], None, True
    for page_url in pages[:2]:
        try:
            links = _page_links(fetch(page_url).decode("utf-8", "ignore"), page_url)
        except Exception as exc:
            return [], f"disclosure page blocked or unreachable ({str(exc)[:60]})", False
        dated = [(d, u) for u in links if (d := _link_date(u))]
        if dated:
            newest = max(d for d, _ in dated)
            return [u for d, u in dated if d == newest][:80], None, False
        if links:
            return links[:80], None, False
    return [], "no static file links (page needs JavaScript or blocks automated access)", False


def ingest_amc(fetch, amc_name: str, dataset_rows: list[tuple[str, str]], fallback_as_of: str | None = None) -> dict[str, Any]:
    """Download the AMC's latest disclosure, parse every scheme sheet, match to AMFI codes by exact name.

    Returns {"rows", "schemes_meta", "report"}; unmatched, malformed and out-of-tolerance sheets are listed, not guessed.
    """
    from app.backoffice.mf_holdings import normalize_scheme_name

    report: dict[str, Any] = {"amc": amc_name, "source_url": None, "sheets": 0, "matched": [], "unmatched": [], "bad_weight": [], "error": None}
    urls, why, first_only = disclosure_urls(fetch, amc_name)
    if not urls:
        report["error"] = why
        return {"rows": [], "schemes_meta": [], "report": report}
    report["source_url"] = urls[0]
    sheets: list[dict[str, Any]] = []
    src: dict[int, str] = {}
    for url in urls:
        try:
            got = parse_any(fetch(url))
        except Exception as exc:  # wall, bad zip or changed layout: record, never half-ingest
            report["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
            continue
        for sh in got:
            src[id(sh)] = url
        sheets.extend(got)
        if len(got) >= 3 and first_only:  # a real consolidated file has many scheme sheets; fewer means a stray file
            break
    report["sheets"] = len(sheets)
    by_key: dict[str, list[tuple[str, str]]] = {}
    for code, name in dataset_rows:
        by_key.setdefault(normalize_scheme_name(name), []).append((code, name))
    rows: list[dict[str, Any]] = []
    meta: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sh in sheets:
        key = normalize_scheme_name(sh["scheme_name"])
        if key in seen:
            continue
        if not WEIGHT_TOLERANCE[0] <= sh["weight_sum"] <= WEIGHT_TOLERANCE[1]:
            report["bad_weight"].append({"scheme": sh["scheme_name"], "weight_sum": sh["weight_sum"]})
            continue
        codes = by_key.get(key)
        if not codes:
            report["unmatched"].append(sh["scheme_name"])
            continue
        seen.add(key)
        as_of = sh["as_of"] or fallback_as_of or ("-".join(d) if (d := _link_date(report["source_url"] or "")) else None)
        for code, name in codes:
            meta.append({"scheme_code": code, "scheme_name": sh["scheme_name"], "amc": amc_name, "as_of": as_of, "source_url": src.get(id(sh), urls[0])})
            rows.extend({"scheme_code": code, "holding_name": h["name"], "isin": h["isin"] or "", "sector": h["sector"] or "",
                         "weight_pct": h["weight_pct"], "instrument_type": h["instrument_type"]} for h in sh["holdings"])
        report["matched"].append(sh["scheme_name"])
    return {"rows": rows, "schemes_meta": meta, "report": report}
