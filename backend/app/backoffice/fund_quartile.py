"""Advisorkhoj quartile ranks for one fund: trailing 1/3/5Y (current quarter) and the last 5 calendar years."""

import re

from app.backoffice.providers import advisorkhoj as ak

# Screener category key -> Advisorkhoj label (only the Equity group is verified; other categories get no quartiles).
EQUITY = {
    "contra": "Equity: Contra", "dividend_yield": "Equity: Dividend Yield", "elss": "Equity: ELSS (Tax Savings)",
    "flexi_cap": "Equity: Flexi Cap", "focused": "Equity: Focused", "large_mid_cap": "Equity: Large & Mid Cap",
    "large_cap": "Equity: Large Cap", "mid_cap": "Equity: Mid Cap", "multi_cap": "Equity: Multi Cap",
    "sectoral_thematic": "Equity: Sectoral/Thematic", "small_cap": "Equity: Small Cap", "value": "Equity: Value",
}
_WORDS = re.compile(r"\b(direct|regular|reg|dir|plan|growth|gr|option|fund|scheme)\b")


def name_key(n: str) -> str:
    """Advisorkhoj ("X Fund Reg Gr") and AMFI ("X Fund - Regular Plan - Growth") names agree once plan words are dropped."""
    return re.sub(r"[^a-z0-9]", "", _WORDS.sub("", n.lower()))


def fund_quartiles(name: str, cat: str, client=None) -> dict | None:
    """None when the category is not covered or the fund is not ranked; raises on Advisorkhoj failure."""
    label = EQUITY.get(cat)
    if not label:
        return None
    key = name_key(name)

    def row(d: dict):
        return next((r for r in d["rows"] if name_key(r[0]) == key), None), d["columns"]

    trailing = {}
    for p in ("1y", "3y", "5y"):
        r, cols = row(ak.fetch_quartile_table(label, p, "Regular", client))
        c = next((i for i, x in enumerate(cols) if re.search("current quarter quartile", x, re.I)), -1)
        if r and c >= 0 and r[c]:
            trailing[p.upper()] = r[c]
    ann = ak.fetch_quartile_annual(label, "Regular", client)
    r, cols = row(ann)
    years = [[c, r[i]] for i, c in enumerate(cols) if r and re.match(r"\d{4}", c) and r[i]][-5:]
    if not trailing and not years:
        return None
    return {"category": label, "trailing": trailing, "years": years, "source": "advisorkhoj", "fetched_at": ann.get("fetched_at")}
