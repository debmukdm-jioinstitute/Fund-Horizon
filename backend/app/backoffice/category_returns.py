from __future__ import annotations
"""Mutual fund category returns (reverse-engineered from the advisor tool 'Mutual Fund Category Returns').

For one fund type and up to three periods: per category, the average, maximum, minimum and median return across its schemes.
Returns under 1 year are absolute, 1 year and over are CAGR. Built on the scored screener frame; YTD comes from the monthly NAV files.
Difference: category names are Fund Horizon's own (AMFI-style); Sectoral/Thematic is split by keywords in the scheme name.
"""

import re
from typing import Any

import numpy as np
import pandas as pd

PERIODS = {"ytd": ("YTD", None), "1w": ("1 Wk", "week_chg"), "1m": ("1 Mon", "ret_1m"), "3m": ("3 Mon", "ret_3m"), "6m": ("6 Mon", "ret_6m"),
           "1y": ("1 Yr", "ret_1y"), "3y": ("3 Yrs", "cagr_3y"), "5y": ("5 Yrs", "cagr_5y"), "10y": ("10 Yrs", "cagr_10y")}
MAX_PERIODS = len(PERIODS)  # "select all" is allowed
FUND_TYPES: dict[str, tuple[str, ...]] = {
    "Equity Schemes": ("contra", "dividend_yield", "elss", "flexi_cap", "focused", "large_mid_cap", "large_cap", "mid_cap", "multi_cap", "sectoral_thematic", "small_cap", "value"),
    "Hybrid Schemes": ("aggressive_hybrid", "arbitrage", "balanced_advantage", "balanced_hybrid", "conservative_hybrid", "equity_savings", "multi_asset"),
    "Debt Schemes": ("banking_psu", "corporate_bond", "credit_risk", "dynamic_bond", "fixed_term", "floater", "gilt", "liquid", "medium_long_duration", "money_market", "other_debt", "overnight", "short_duration"),
    "Index Fund": ("index_equity", "index_debt", "index_hybrid"),
    "Fund Of Funds": ("fof_domestic", "gold", "international"),
    "ETFs": ("etf_other",),
}
# Name keywords -> sub-category of Sectoral/Thematic (first match wins).
_SECTOR = [("Sectoral-Banking and Financial Services", r"bank|financ|bfsi"), ("Sectoral-FMCG", r"fmcg"), ("Sectoral-Pharma and Healthcare", r"pharma|health"),
           ("Sectoral-Technology", r"tech|\bit\b|digital"), ("Sectoral-Infrastructure", r"infra"), ("Thematic-Consumption", r"consum"), ("Thematic-Energy", r"energy|power"),
           ("Thematic-ESG", r"\besg\b"), ("Thematic-MNC", r"\bmnc\b"), ("Thematic-International", r"international|global|world|overseas|\bus\b|nasdaq|asia|china"),
           ("Thematic-Manufacturing", r"manufactur|make in india"), ("Thematic-PSU", r"\bpsu\b|\bpse\b"), ("Thematic-Momentum", r"momentum"), ("Thematic-Quantitative", r"quant"),
           ("Thematic-Business-Cycle", r"business cycle"), ("Thematic-Innovation", r"innovation|opportunit"), ("Thematic-Transportation", r"transport|logistic")]


class CategoryReturnsError(ValueError):
    """Bad input; the message is safe to show."""


def _label(r: pd.Series, groups: dict[str, str]) -> str:
    if r["cat"] == "sectoral_thematic":
        n = str(r["name"]).lower()
        return "Equity: " + next((lbl for lbl, rx in _SECTOR if re.search(rx, n)), "Thematic-Others")
    return groups[r["cat"]]


def _ytd(codes: list[str]) -> dict[str, float]:
    from app.data.loader import load_nav
    out: dict[str, float] = {}
    for c in codes:
        try:
            s = load_nav(c)
        except (OSError, ValueError, KeyError):
            continue
        prior = s[s.index.year < s.index[-1].year]
        if len(prior) and s.index[-1].year == prior.index[-1].year + 1 and prior.iloc[-1] > 0:
            out[c] = (s.iloc[-1] / prior.iloc[-1] - 1) * 100
    return out


def nav_as_of(frame: pd.DataFrame) -> str:
    """Latest NAV date in the frame as DD-MM-YYYY. nav_date is text like 04-Nov-2026, so it must be parsed: a text max picks 31-Oct-2025."""
    d = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    return "-" if pd.isna(d) else d.strftime("%d-%m-%Y")


def parse_periods(raw: str) -> list[str]:
    ps = [p.strip().lower() for p in raw.split(",") if p.strip()]
    if not ps:
        raise CategoryReturnsError("Please select period")
    bad = [p for p in ps if p not in PERIODS]
    if bad:
        raise CategoryReturnsError(f"Unknown period: {bad[0]}")
    return list(dict.fromkeys(ps))


def build(frame: pd.DataFrame, fund_type: str, periods: list[str], plan: str = "Regular") -> dict[str, Any]:
    from app.backoffice.mf_screener import CATEGORY_GROUPS
    if fund_type not in FUND_TYPES:
        raise CategoryReturnsError("Unknown fund type.")
    if plan not in ("Regular", "Direct", "Both"):
        raise CategoryReturnsError("Plan must be Regular, Direct or Both.")
    groups = {k: f"{g}: {lbl}" for g, items in CATEGORY_GROUPS.items() for k, lbl in items}
    df = frame[frame["cat"].isin(FUND_TYPES[fund_type])]
    if plan != "Both":
        df = df[df["plan"] == plan]
    df = df.assign(_cat=[_label(r, groups) for _, r in df.iterrows()])
    cols: dict[str, pd.Series] = {}
    for p in periods:
        col = PERIODS[p][1]
        cols[p] = df["code"].map(_ytd(df["code"].tolist())) if col is None else pd.to_numeric(df[col], errors="coerce")
    rows = []
    for cat, g in df.groupby("_cat"):
        row: dict[str, Any] = {"category": cat, "funds": int(len(g))}
        for p in periods:
            v = cols[p].loc[g.index].dropna()
            row[p] = {"count": int(len(v)), "avg": None, "max": None, "min": None, "median": None} if v.empty else {
                "count": int(len(v)), "avg": round(float(v.mean()), 2), "max": round(float(v.max()), 2), "min": round(float(v.min()), 2), "median": round(float(np.median(v)), 2)}
        rows.append(row)
    rows.sort(key=lambda r: r["category"])
    return {"fund_type": fund_type, "plan": plan, "periods": [{"key": p, "label": PERIODS[p][0]} for p in periods], "rows": rows,
            "nav_as_of": nav_as_of(frame), "note": "Returns under 1 year are absolute; 1 year and over are annualised (CAGR). Past performance may not be sustained."}


def flat_rows(r: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    head = ["Category", "Funds"] + [f"{p['label']} {s}" for p in r["periods"] for s in ("Avg Rtn (%)", "Max Rtn (%)", "Min Rtn (%)", "Median Rtn (%)")]
    body = [[x["category"], x["funds"]] + [x[p["key"]][k] for p in r["periods"] for k in ("avg", "max", "min", "median")] for x in r["rows"]]
    return head, body
