from __future__ import annotations
"""Distributor portfolio statements for Paperwork Processing.

* Proaffluence "MF Summary Report" (text PDF): MF only, so only the client header
  (name, PAN, mobile, email) and the Grand total row are read.
* FundsIndia partner portfolio (browser print, so the figures are pictures): read by
  OCR boxes. Each portfolio (category) becomes one section with its funds and Total.

OCR garbles digits and a page break can clip a row, so nothing is trusted blindly:
current value is accepted only when invested + gain reconciles, else it is derived and
flagged, and every portfolio is reconciled against its own Total row.
"""

import io
import re
from typing import Any

from app.report.client_report import _ocr_boxes, ind, render_pages
from app.report.monthly_report import _despace

W = 842.0  # FundsIndia print page width; the x zones below are in these units
_FIX = str.maketrans({"l": "1", "I": "1", "|": "1", "O": "0", "'": ","})
_TOK = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
_MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def _f(tok: str) -> float:
    return float(tok.replace(",", ""))


def _dmy(s: str) -> str:
    """26-Oct-2026 / 27/10/2026 -> 26-10-2026 (site date format is DD-MM-YYYY)."""
    m = re.match(r"(\d{1,2})[-/ ]([A-Za-z]{3})\w*[-/ ](\d{4})", s)
    if m:
        return f"{int(m[1]):02d}-{_MONTHS.get(m[2].lower(), 0):02d}-{m[3]}"
    return s.replace("/", "-")


def _total(invested: float, current: float, **kw: Any) -> dict[str, Any]:
    gain = current - invested
    return {"invested": invested, "current": current, "gain": gain,
            "abs_ret": gain / invested * 100 if invested else None, **kw}


# ---------- Proaffluence ----------

def parse_proaffluence(text: str) -> dict[str, Any] | None:
    g = re.search(r"Grand\s+total", text, re.IGNORECASE)
    if not g:
        return None
    nums = _TOK.findall(text[g.end():g.end() + 300].replace("₹", ""))
    if len(nums) < 6:
        return None
    inv, cur, gain, absret, _div, xirr = (_f(n) for n in nums[:6])
    # The letterhead carries the distributor's own mobile/email; the client's follow the "Name (PAN)" line.
    c = re.search(r"^[ \t]*(.+?)\s*\(([A-Z]{5}\d{4}[A-Z])\)", text, re.MULTILINE)
    rest = text[c.end():] if c else text
    mobile, email = re.search(r"Mobile\s*no\.?:?\s*(\d{10})", rest), re.search(r"Email\s*ID:?\s*(\S+@\S+)", rest)
    on = re.search(r"Report\s+as\s+on:?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})", text)
    return {
        "provider": "Proaffluence",
        "client": {"name": c[1].strip() if c else "", "pan": c[2] if c else "",
                   "mobile": mobile[1] if mobile else "", "email": email[1].lower() if email else ""},
        "as_on": _dmy(on[1]) if on else "",
        "grand_total": {"invested": inv, "current": cur, "gain": gain, "abs_ret": absret, "xirr": xirr},
        "categories": [], "warnings": [],
    }


# ---------- FundsIndia (OCR boxes) ----------

_AMT = re.compile(r"-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|-?\d+(?:\.\d+)?")
_COLHDR = re.compile(r"(?i)^\W*(invested|current|gains|prev\.?\s*day|change|ann\.?\s*ret\.?)\W*$")


def _amts(text: str) -> list[float]:
    """Amounts in one OCR box, without the (percent) groups and bare percentages."""
    s = re.sub(r"-?[\d.,]+\s*%", " ", re.sub(r"\([^)]*\)?", " ", text)).translate(_FIX)
    return [_f(t) for t in _AMT.findall(s)]


def _anchor(text: str) -> float | None:
    """The Invested box of a row: needs 3+ real digits and starts with an amount."""
    a = _amts(text) if len(re.findall(r"\d", text)) >= 3 else []
    return a[0] if a else None


def _fund_row(anchor: tuple[float, float, str], rest: list[tuple[float, float, str]]) -> dict[str, Any] | None:
    inv = _anchor(anchor[2])
    label = " ".join(b[2].strip() for b in sorted((b for b in rest if b[0] < 335), key=lambda b: b[1]))
    nums = sorted((b for b in rest if b[0] >= 335), key=lambda b: (b[0], b[1]))
    cands = _amts(anchor[2])[1:] + [a for b in nums for a in _amts(b[2])]
    # invested + gain == current (to the rupee); the sign of a gain is not trusted, only its size.
    cur = next((c for c in cands if any(g is not c and abs(abs(c - inv) - abs(g)) <= 2 for g in cands)), None)
    check = "ok"
    if cur is None:
        gb = next((a for b in nums if 540 <= b[0] < 600 for a in _amts(b[2])[:1]), None)
        cb = next((a for b in nums if 440 <= b[0] < 520 for a in _amts(b[2])[:1]), None)
        check = "derived"
        if gb is not None and cb is not None and not 0.1 * cb < inv < 10 * cb:
            inv, cur = cb - gb, cb  # Invested box unreadable: rebuild it from current and gain
        elif gb is not None:
            cur = inv + gb
        elif cb is not None:
            cur, check = cb, "unverified"
        else:
            return None
    ann = next((float(m[1]) for b in sorted(nums, key=lambda b: -b[0])
                if (m := re.search(r"(?:^|[\s)）])(-?\d+(?:\.\d+)?)\s*%\s*$", b[2]))), None)
    return {"name": _despace(label), "ann_ret": ann, "check": check, **_total(inv, cur)}


def _page_sections(boxes: list[tuple[float, float, str]], section: dict | None, out: list[dict]) -> dict | None:
    body = [b for b in boxes if 75 < b[1] < 570 and b[0] > 250]
    titles = []
    for pd in (b for b in body if b[2].strip().startswith("Prev") and b[0] > 600):
        cand = [b for b in body if b[0] < 335 and pd[1] - 45 <= b[1] <= pd[1] - 8 and len(re.findall(r"[A-Za-z]", b[2])) >= 3]
        if cand:
            titles.append(min(cand, key=lambda b: pd[1] - b[1]))
    anchors = sorted((b for b in body if 372 <= b[0] <= 430 and _anchor(b[2]) is not None), key=lambda b: b[1])
    rest = [b for b in body if b not in anchors and b not in titles and not _COLHDR.match(b[2])]
    groups: dict[int, list] = {id(a): [] for a in anchors}
    for b in rest:
        if anchors:
            near = min(anchors, key=lambda a: abs(a[1] - b[1]))
            if abs(near[1] - b[1]) <= 45:
                groups[id(near)].append(b)
    for kind, item in sorted([("t", t) for t in titles] + [("r", a) for a in anchors], key=lambda r: r[1][1]):
        if kind == "t":
            name = re.sub(r"\s*\d+\s*D?$|\s+D$", "", item[2].strip())
            name = name if " " in name else _despace(name)
            section = {"name": name, "funds": [], "total": None, "rows_lost": 0}
            out.append(section)
            continue
        row = _fund_row(item, groups[id(item)])
        if section is None:
            continue
        if row is None:
            section["rows_lost"] += 1
        elif row["name"].lower().startswith("total"):
            section["total"] = row
        else:
            section["funds"].append(row)
    return section


def parse_fundsindia(pages: list[list[tuple[float, float, str]]]) -> dict[str, Any] | None:
    """pages: OCR boxes (left x, centre y, text) per page, x already scaled to ``W`` units."""
    sections: list[dict] = []
    cur = None
    for boxes in pages:
        cur = _page_sections(boxes, cur, sections)
    warnings: list[str] = [f"{s['name']}: no rows were readable (cut at a page break); add its funds by hand."
                           for s in sections if not (s["funds"] or s["total"])]
    sections = [s for s in sections if s["funds"] or s["total"]]
    if not sections:
        return None
    cats = []
    for s in sections:
        funds, tot = s["funds"], s["total"]
        read_inv = sum(f["invested"] for f in funds)
        inv = tot["invested"] if tot else read_inv
        val = tot["current"] if tot else sum(f["current"] for f in funds)
        if tot is None:
            warnings.append(f"{s['name']}: no Total row was readable (cut at a page break); totals are the sum of the {len(funds)} funds read.")
        elif abs(tot["invested"] - read_inv) > 1:
            warnings.append(f"{s['name']}: funds read add up to ₹{read_inv:,.0f} invested but the Total row says ₹{tot['invested']:,.0f}; "
                            "a fund row was cut off or unreadable. Add it by hand.")
        if s["rows_lost"]:
            warnings.append(f"{s['name']}: {s['rows_lost']} row(s) could not be read.")
        bad = [f["name"] for f in funds if f["check"] != "ok"]
        if bad:
            warnings.append(f"{s['name']}: check the figures of {', '.join(bad)} (OCR could not confirm them).")
        cats.append({"name": s["name"], "invested": inv, "current": val, "gain": val - inv,
                     "ann_ret": tot["ann_ret"] if tot else None, "has_total": tot is not None, "funds": funds})
    first = pages[0] if pages else []
    on = next((b[2] for b in first if re.match(r"\d{2}/\d{2}/\d{4}", b[2])), "")
    sum_inv, sum_cur = sum(c["invested"] for c in cats), sum(c["current"] for c in cats)
    grand = _total(sum_inv, sum_cur, xirr=None)
    lab = next((b for b in first if re.match(r"Invested\s*Value", b[2].strip())), None)
    if lab:
        head = sorted((b for b in first if lab[1] + 5 <= b[1] <= lab[1] + 22), key=lambda b: b[0])
        vals = [a for b in head for a in _amts(b[2])][:2]
        if len(vals) == 2:
            grand = _total(vals[0], vals[1], xirr=None)
            if abs(vals[0] - sum_inv) > 1:
                warnings.append(f"The statement header shows ₹{vals[0]:,.0f} invested; the portfolios read add up to ₹{sum_inv:,.0f} "
                                f"(₹{vals[0] - sum_inv:,.0f} not read, usually rows cut at page breaks).")
    m = re.match(r"(.+?)\s+Portfolio\b", cats[0]["name"])
    return {
        "provider": "FundsIndia",
        "client": {"name": m[1] if m else "", "pan": "", "mobile": "", "email": ""},
        "as_on": _dmy(on[:10]) if on else "",
        "grand_total": grand, "categories": cats,
        "warnings": ["No email or mobile is printed on a FundsIndia portfolio page; enter them by hand."] + warnings,
    }


# ---------- PMS factsheets (text PDF; any manager that prints a Portfolio Summary) ----------

_NUMBER = r"₹?\s*(-?[\d,]+(?:\.\d+)?)"
_PMS_IN = r"(?:Total\s+)?(?:Contribution|Capital\s+Contributed|Amount\s+Invested|Total\s+Investment|Corpus)"
_PMS_VAL = r"(?:Net\s+)?(?:Portfolio|Closing|Current|Market)\s+Value"
_PCT_ROW = re.compile(r"(?m)^[ \t]*([A-Za-z][^%\n]*?)[ \t]+((?:-?\d+(?:\.\d+)?%[ \t]*){3,})")


def parse_pms(text: str) -> dict[str, Any] | None:
    """Portfolio Summary (contribution, withdrawal, profit, value) + Performance(IRR) rows. None if not a PMS factsheet."""
    t = re.sub(r"[ \t]+", " ", text)
    inv = re.search(rf"(?im)^\s*{_PMS_IN}\s*{_NUMBER}", t)
    val = re.search(rf"(?im)^\s*{_PMS_VAL}\s*(?:\(([\d/.-]+)\))?\s*{_NUMBER}", t)
    if not (inv and val):
        return None
    wd = re.search(rf"(?im)^\s*Withdrawals?\s*{_NUMBER}", t)
    pl = re.search(rf"(?im)^\s*Profit\s*/?\s*Loss\s*{_NUMBER}", t)
    contribution, value = _f(inv[1]), _f(val[2])
    withdrawal = _f(wd[1]) if wd else 0.0
    profit = _f(pl[1]) if pl else value + withdrawal - contribution
    warnings = []
    if pl and abs(value + withdrawal - contribution - profit) > 2:
        warnings.append("Contribution, withdrawal, profit and portfolio value do not reconcile; check the figures.")
    perf = re.search(r"(?i)Performance", t)
    tail = t[perf.end():] if perf else t
    rows = list(_PCT_ROW.finditer(tail))
    cols: list[str] = []
    if rows:
        cols = [re.sub(r"\s+", " ", c).title() if c.lower().startswith("since") else c.lower()
                for c in re.findall(r"(?i)\b\d+\s?[my]\b|since(?:\s+\d{2}/\d{2}/\d{2,4})?|ytd", tail[:rows[0].start()])]
    returns = []
    for r in rows:
        vals = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", r[2])]
        returns.append({"name": r[1].strip(), "values": dict(zip(cols if len(cols) == len(vals) else [f"p{i + 1}" for i in range(len(vals))], vals))})
    acct = re.search(r"(?m)^[ \t]*Account(?: Name)?:?[ \t]*(.+?)(?:[ \t]{2,}|$)", text)
    parts = [p.strip() for p in acct[1].split(" - ")] if acct else []
    number = parts[0] if parts and parts[0].isdigit() else ""
    name = (parts[1] if number and len(parts) > 1 else parts[0] if parts else "").title()
    strategy = re.search(r"(?m)^[ \t]*Strategy:?[ \t]*(.+?)(?:[ \t]{2,}|$)", text)
    inception = re.search(r"Inception\s*Date:?\s*(\d{1,2}/\d{1,2}/\d{2,4})", t)
    on = re.search(r"As\s+of\s*(\d{1,2}/\d{1,2}/\d{2,4})", t)
    first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "PMS")
    since = returns[0]["values"] if returns else {}
    return {
        "provider": first[:60], "kind": "pms",
        "client": {"name": name, "pan": "", "mobile": "", "email": ""},
        "as_on": _dmy(on[1]) if on else (_dmy(val[1]) if val[1] else ""),
        "grand_total": _total(contribution, value, xirr=list(since.values())[-1] if since else None) | {"gain": profit},
        "categories": [], "warnings": warnings,
        "pms": {"strategy": strategy[1].strip() if strategy else "", "account": number, "inception": _dmy(inception[1]) if inception else "",
                "contribution": contribution, "withdrawal": withdrawal, "profit": profit, "value": value, "returns": returns},
    }


def pms_factsheet(st: dict[str, Any]) -> dict[str, Any]:
    """Key PMS metrics as report 'Factsheet highlights' rows (label/value pairs)."""
    p = st["pms"]
    items = [("Strategy", p["strategy"]), ("Inception Date", p["inception"]),
             ("Contribution", f"₹ {ind(p['contribution'], 0)}"), ("Withdrawal", f"₹ {ind(p['withdrawal'], 0)}"),
             ("Profit / Loss", f"₹ {ind(p['profit'], 0)}"), (f"Portfolio Value (as on {st['as_on']})", f"₹ {ind(p['value'], 0)}")]
    items += [(f"{r['name']} returns (IRR)", " | ".join(f"{k} {v}%" for k, v in r["values"].items())) for r in p["returns"]]
    return {"source": f"{st['provider']} - {p['strategy'] or 'PMS'}"[:120], "items": [{"label": k[:80], "value": v[:120]} for k, v in items if v]}


def fundsindia_pages(name: str, data: bytes) -> list[list[tuple[float, float, str]]]:
    """OCR each page (PDF or screenshot) at 3x and scale x to the print width."""
    if name.lower().endswith(".pdf"):
        imgs = render_pages(data)
    else:
        from PIL import Image

        imgs = [Image.open(io.BytesIO(data))]
    return [[(x * W / im.size[0], y * W / im.size[0], t) for x, y, t in boxes]
            for im, boxes in zip(imgs, map(_ocr_boxes, imgs))]


def parse_provider_statement(name: str, data: bytes, text: str) -> dict[str, Any] | None:
    low = text.lower().replace(" ", "")
    if "proaffluence" in low:
        return parse_proaffluence(text)
    if re.search(r"funds[il1]ndia", low):
        return parse_fundsindia(fundsindia_pages(name, data))
    return parse_pms(text)
