"""Financial-year summary for the client report: value at 31 Mar, net new investments, XIRR (portfolio / MF / PMS / stock)
and DEBT / EQUITY allocation, per Indian FY (Apr-Mar). Nothing is estimated: a cell is "-" (None) when a holding's
history is not in the uploaded statements."""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from app.backoffice.analytics.pms_math import calculate_xirr

CLASSES = ("MF", "PMS", "STOCK")
_DEBT = re.compile(r"\b(liquid|overnight|money market|bond|gilt|debt|banking\s*(?:&|and)\s*psu|duration|corporate|credit risk|floater|treasury)\b", re.I)
_OTHER = re.compile(r"\b(hybrid|balanced|multi.?asset|arbitrage|equity savings|gold|silver|commodity)\b", re.I)


def fy_of(d: str) -> int:
    """FY start year of an ISO date (FY 2024-25 -> 2024)."""
    return int(d[:4]) - (1 if int(d[5:7]) < 4 else 0)


def _cls(r: dict[str, Any]) -> str:
    ac = str(r.get("asset_class") or "")
    return "PMS" if ac == "PMS" else "STOCK" if ac == "Direct Equity" else "MF"


def _bucket(r: dict[str, Any]) -> str:
    if _cls(r) != "MF":
        return "EQUITY"
    cat = f"{r.get('category') or ''} {r.get('name') or ''}"
    return "OTHER" if _OTHER.search(cat) else "DEBT" if _DEBT.search(cat) else "EQUITY"


def _nav_at(nav, d: str) -> float | None:
    import pandas as pd

    s = nav[nav.index <= pd.Timestamp(d)]
    return float(s.iloc[-1]) if len(s) else None


def _lots(r: dict[str, Any], nav) -> tuple[list[tuple[str, float]], bool] | None:
    """(date, units) lots and whether they are exact. Exact = statement gave units per lot; else rebuilt from flows / NAV."""
    if r.get("lots"):
        return [(str(d), float(u)) for d, u in r["lots"]], True
    fl = [(str(d), float(a)) for d, a in (r.get("flows") or []) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d))]
    if not fl or nav is None or len(nav) == 0:
        return None
    out = []
    for d, a in fl:
        n = _nav_at(nav, d) or float(nav.iloc[0])
        out.append((d, a / n))
    tot, want = sum(u for _, u in out), float(r.get("units") or 0)
    if want > 0 and tot > 0:
        out = [(d, u * want / tot) for d, u in out]  # calibrate to the statement's closing units
    return out, False


def fy_matrix(data: dict[str, Any], nav_loader) -> dict[str, Any] | None:
    rows = [r for r in (data.get("rows") or []) if float(r.get("value") or 0) > 0 or float(r.get("invested") or 0) > 0]
    cl = data.get("client") or {}
    from app.report.client_report import _iso_date  # local: avoid an import cycle

    val_iso = _iso_date(cl.get("date")) or date.today().isoformat()
    pos = []
    for r in rows:
        nav = None
        if _cls(r) == "MF" and r.get("code"):
            try:
                nav = nav_loader(str(r["code"]))
            except Exception:
                nav = None
        fl = [(str(d), float(a)) for d, a in (r.get("flows") or []) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d))]
        lots = _lots(r, nav)
        start = min([d for d, _ in fl] + ([str(r["from_date"])[:10]] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(r.get("from_date") or "")[:10]) else []), default=None)
        pos.append({"cls": _cls(r), "bkt": _bucket(r), "fl": fl, "lots": lots, "nav": nav, "val": float(r.get("value") or 0), "start": start})
    starts = [p["start"] for p in pos if p["start"]]
    if not pos or not starts:
        return None
    inc = min(starts)
    y0, y1 = fy_of(inc), fy_of(val_iso)
    exact = all(p["lots"][1] for p in pos if p["lots"])

    def value_at(p, d: str) -> float | None:
        if d >= val_iso:
            return p["val"]
        if p["start"] and p["start"] > d:
            return 0.0
        if not p["lots"] or p["nav"] is None:
            return None
        n = _nav_at(p["nav"], d)
        return None if n is None else sum(u for ld, u in p["lots"][0] if ld <= d) * n

    def agg(ps: list[dict[str, Any]], d: str, key=lambda p: True) -> float | None:
        vals = [value_at(p, d) for p in ps if key(p)]
        return None if any(v is None for v in vals) else sum(vals)

    def xirr(ps: list[dict[str, Any]], a: str | None, b: str) -> float | None:
        cf = [(d, -x) for p in ps for d, x in p["fl"] if (a is None or d > a) and d <= b]
        op = agg(ps, a) if a else 0.0
        cl_v = agg(ps, b)
        if op is None or cl_v is None:
            return None
        if op > 0:
            cf.append((a, -op))
        res = calculate_xirr(cf, terminal_value=cl_v, terminal_date=b)
        return None if res.get("xirr") is None else round(res["xirr"] * 100, 2)

    def covered(ps: list[dict[str, Any]], d: str) -> bool:
        return all(p["fl"] or (p["start"] and p["start"] > d) for p in ps)  # a row with no dated flows cannot give new-investment/XIRR

    groups = {"PORTFOLIO": pos, **{c: [p for p in pos if p["cls"] == c] for c in CLASSES}}
    years = []
    for y in range(y0, y1 + 1):
        end = val_iso if y == y1 else f"{y + 1}-03-31"
        beg = f"{y}-03-31"
        first = y == y0
        ok = covered(pos, end)
        v = agg(pos, end)
        new = round(sum(x for p in pos for d, x in p["fl"] if (first or d > beg) and d <= end), 2) if ok else None
        x_by = {g: (xirr(ps, None if first else beg, end) if ps and covered(ps, end) and any(p["start"] and p["start"] <= end for p in ps) else None) for g, ps in groups.items()}
        alloc = None
        if v:
            tot = {b: agg(pos, end, lambda p, b=b: p["bkt"] == b) for b in ("DEBT", "EQUITY", "OTHER")}
            if all(t is not None for t in tot.values()):
                alloc = {b: round(t / v * 100, 2) for b, t in tot.items()}
        years.append({"fy": f"FY {y}-{str(y + 1)[2:]}", "end": end, "value": None if v is None else round(v), "new": None if new is None else round(new), "xirr": x_by, "alloc": alloc})
    return {
        "inception": inc, "from": inc, "to": val_iso, "years": years, "exact": exact,
        "since": {"PORTFOLIO": data.get("xirr"), **{g: xirr(ps, None, val_iso) if ps and covered(ps, val_iso) else None for g, ps in groups.items() if g != "PORTFOLIO"}},
        "net_new": None if any(y["new"] is None for y in years) else sum(y["new"] for y in years),
        "classes": [c for c in CLASSES if groups[c]],
    }
