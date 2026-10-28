"""Equity holdings for funds whose AMC file cannot be fetched, from Advisorkhoj's public "common stocks across schemes" page.

GET /mutual-funds-research/common-stocks-across-mf-schemes?category=..&schemes=a,b,.. (2 to 5 schemes of one category, no
login) returns every stock held by any of the selected schemes with each scheme's weight ("-" when it does not hold it).
So one call yields full equity holdings for up to five funds. The tool covers listed equity only (no debt, cash or
derivatives), so a fund's weights add to its equity share of NAV, not 100: that sum is kept as ``coverage_pct`` and shown.
Sector is NOT on that page; it is copied from other funds' own disclosures of the same company (see ``sector_lookup``).
"""

from __future__ import annotations

import html
import re
from typing import Any, Callable
from urllib.parse import urlencode

BASE = "https://www.advisorkhoj.com/mutual-funds-research"
BATCH = 5


def scheme_names(post: Callable[[str, dict], bytes], category: str) -> list[str]:
    import json

    raw = post(f"{BASE}/getAllSchemesCommonNamesbyCategoryPortfolio", {"category": category})
    return [n for n in json.loads(raw.decode("utf-8", "ignore")) if "," not in n]


def clean_company(raw: str) -> str:
    """'ADANI ENTERPRISES LIMITED EQ NEW FV RE.1/-' -> 'Adani Enterprises Limited'."""
    name = re.sub(r"\s+EQ\b.*$", "", raw.strip())
    return re.sub(r"\s+", " ", name).title()


def company_key(name: str) -> str:
    low = re.sub(r"\b(limited|ltd|private|pvt|the)\b", " ", name.lower().replace("&", " and "))
    return "".join(ch for ch in low if ch.isalnum())


def sector_lookup(snapshot: dict[str, Any]) -> dict[str, str]:
    """company key -> sector, from holdings that carry the disclosure's own Industry column; ambiguous companies are dropped."""
    seen: dict[str, set[str]] = {}
    for sc in (snapshot.get("schemes") or {}).values():
        for h in sc.get("holdings") or []:
            if h.get("sector") and h.get("instrument_type") == "equity":
                seen.setdefault(company_key(h["name"]), set()).add(h["sector"])
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def parse_table(page: str) -> tuple[list[str], list[tuple[str, list[float | None]]]]:
    """(scheme names in column order, [(company, [weight or None per scheme])]) from the result page."""
    m = re.search(r"<table.*?</table>", page, re.S)
    if not m:
        return [], []
    rows = [[html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            for tr in re.findall(r"<tr.*?</tr>", m.group(0), re.S)]
    rows = [r for r in rows if len(r) >= 3]
    if not rows or rows[0][0] != "Company Name":
        return [], []
    names = [re.sub(r"Holdings \(%\)$", "", c).strip() for c in rows[0][1:]]
    out = []
    for r in rows[1:]:
        if r[0].startswith("Portfolio Overlap Total"):
            continue
        out.append((r[0], [float(c) if re.fullmatch(r"\d+(\.\d+)?", c) else None for c in r[1:]]))
    return names, out


def fetch_batch(get: Callable[[str], bytes], category: str, schemes: list[str]) -> dict[str, list[dict[str, Any]]]:
    """{scheme name: [{"name", "weight_pct"}]} for 2 to 5 schemes of one category (empty when the page has no table)."""
    url = f"{BASE}/common-stocks-across-mf-schemes?" + urlencode({"category": category, "schemes": ",".join(schemes)})
    names, rows = parse_table(get(url).decode("utf-8", "ignore"))
    out: dict[str, list[dict[str, Any]]] = {n: [] for n in names}
    for raw, weights in rows:
        for n, w in zip(names, weights):
            if w:
                out[n].append({"name": clean_company(raw), "weight_pct": round(w, 2)})
    return out
