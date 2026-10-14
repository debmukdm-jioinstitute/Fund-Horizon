"""Trendlyne-style mutual fund screener: category groups, returns, risk and an FH checklist score.

Built from the shipped AMFI + mfapi.in dataset (Growth option, Direct and Regular). AUM, Morningstar rating,
holdings, day/week change and benchmark alpha/beta are not in that dataset, so they are not shown.
"""
from __future__ import annotations

import io
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from app.data.loader import load_metrics, load_nav

# Trendlyne-style groups -> (canonical category key, label). Keys come from app.data.categories.
CATEGORY_GROUPS: dict[str, list[tuple[str, str]]] = {
    "Equity": [
        ("contra", "Contra"), ("dividend_yield", "Dividend Yield"), ("elss", "ELSS (Tax Savings)"),
        ("flexi_cap", "Flexi Cap"), ("focused", "Focused"), ("large_mid_cap", "Large & Mid Cap"),
        ("large_cap", "Large Cap"), ("mid_cap", "Mid Cap"), ("multi_cap", "Multi Cap"),
        ("sectoral_thematic", "Sectoral/Thematic"), ("small_cap", "Small Cap"), ("value", "Value"),
    ],
    "Hybrid": [
        ("aggressive_hybrid", "Aggressive Hybrid"), ("arbitrage", "Arbitrage"),
        ("balanced_advantage", "Balanced Advantage"), ("balanced_hybrid", "Balanced Hybrid"),
        ("conservative_hybrid", "Conservative Hybrid"), ("equity_savings", "Equity Savings"),
        ("multi_asset", "Multi Asset"),
    ],
    "Debt": [
        ("banking_psu", "Banking & PSU"), ("corporate_bond", "Corporate Bond"), ("credit_risk", "Credit Risk"),
        ("dynamic_bond", "Dynamic Bond"), ("fixed_term", "Fixed Term"), ("floater", "Floater"),
        ("gilt", "Gilt"), ("liquid", "Liquid"), ("medium_long_duration", "Medium to Long Duration"),
        ("money_market", "Money Market"), ("other_debt", "Other Debt"), ("overnight", "Overnight"),
        ("short_duration", "Short Duration"),
    ],
    "Solution Oriented": [("solution_children", "Children's"), ("solution_retirement", "Retirement")],
    "Others": [
        ("etf_other", "ETFs"), ("fof_domestic", "FoF (Domestic)"), ("gold", "Gold"),
        ("index_debt", "Index - Debt"), ("index_equity", "Index - Equity"), ("index_hybrid", "Index - Hybrid"),
        ("international", "International"), ("other", "Other"),
    ],
}

# Dataset fraction columns -> output percent columns.
_PCT = {
    "ret_1m": "ret_1m", "ret_3m": "ret_3m", "ret_6m": "ret_6m", "ret_1y": "ret_1y", "cagr_3y": "cagr_3y",
    "cagr_5y": "cagr_5y", "cagr_7y": "cagr_7y", "cagr_10y": "cagr_10y", "vol_3y": "vol_3y",
    "max_drawdown_3y": "max_dd_3y", "max_drawdown_all": "max_dd_all", "cagr_since_inception": "cagr_si",
    "roll1y_pct_positive": "roll1y_pos",
}
_AVG_COLS = ["ret_3m", "ret_1y", "cagr_3y", "cagr_5y", "cagr_10y"]
NUMERIC_KEYS = (
    ["score", "perf", "ops", "risk", "nav", "ter", "ret_2y", "sharpe_3y", "sortino_3y", "history_years"]
    + list(_PCT.values())
)
SORT_KEYS = set(NUMERIC_KEYS) | {"name"}


def _pillar(values: pd.Series, groups: pd.Series, higher_better: bool = True) -> pd.Series:
    """Percentile rank (0..1) inside each group; ties share the average rank; NaN stays NaN."""
    return values.groupby(groups).rank(pct=True, ascending=higher_better)


def _two_year_cagr(code: str) -> float | None:
    try:
        nav = load_nav(code)
    except FileNotFoundError:
        return None
    if len(nav) < 25 or nav.iloc[-25] <= 0:
        return None
    return float(((nav.iloc[-1] / nav.iloc[-25]) ** 0.5 - 1) * 100)


def _label(points: float, good: str, mid: str, weak: str) -> str:
    return good if points >= 19 else mid if points >= 12 else weak


@lru_cache(maxsize=1)
def _base_frame() -> pd.DataFrame:
    src = load_metrics()
    df = pd.DataFrame({
        "code": src["scheme_code"], "name": src["scheme_name"], "amc": src["amc"], "plan": src["plan"],
        "cat": src["cat"], "nav": src["latest_nav"], "nav_date": src["latest_nav_date"],
        "history_years": src["history_years"], "sharpe_3y": src["sharpe_3y"], "sortino_3y": src["sortino_3y"],
        "isin": src["isin_growth_or_payout"], "quality": src["data_quality"],
    })
    for raw, out in _PCT.items():
        df[out] = src[raw] * 100
    df["ret_2y"] = [_two_year_cagr(c) for c in df["code"]]
    key = df["cat"] + "|" + df["plan"]
    for col in _AVG_COLS + ["ret_2y"]:
        df[f"{col}_cat"] = df.groupby(key)[col].transform("mean")
    return df.reset_index(drop=True)


def _scored(ter: dict[str, float]) -> pd.DataFrame:
    df = _base_frame().copy()
    df["ter"] = df["code"].map(ter)
    key = df["cat"] + "|" + df["plan"]
    perf = pd.concat([_pillar(df[c], key) for c in ("ret_1y", "cagr_3y", "cagr_5y")], axis=1).mean(axis=1)
    risk = pd.concat([
        _pillar(df["sharpe_3y"], key), _pillar(df["sortino_3y"], key),
        _pillar(df["max_dd_3y"], key), _pillar(df["vol_3y"], key, higher_better=False),
    ], axis=1).mean(axis=1)
    cost = _pillar(df["ter"], key, higher_better=False)
    age = (df["history_years"].clip(upper=5) / 5).fillna(0)
    df["perf"] = (perf * 25).round()
    df["risk"] = (risk * 25).round()
    df["ops"] = ((cost.fillna(0.5) * 0.6 + age * 0.4) * 25).round()
    pillars = df[["perf", "risk", "ops"]]
    # Portfolio pillar (holdings) is not in the dataset: scale the three available pillars to 100.
    df["score"] = (pillars.sum(axis=1, min_count=3) * 100 / 75).round()
    df["perf_label"] = [_label(p, "GOOD RETURNS", "AVERAGE RETURNS", "POOR RETURNS") for p in df["perf"].fillna(0)]
    df["risk_label"] = [_label(p, "GOOD RISK REWARD", "FAIR RISK REWARD", "POOR RISK REWARD") for p in df["risk"].fillna(0)]
    df["ops_label"] = [_label(p, "HIGH RANK", "MEDIUM RANK", "WEAK RANK") for p in df["ops"].fillna(0)]
    return df


def screen(
    ter: dict[str, float],
    categories: list[str] | None,
    plans: list[str] | None,
    search: str | None,
    ranges: dict[str, tuple[float | None, float | None]],
    sort: str,
    descending: bool,
) -> pd.DataFrame:
    df = _scored(ter)
    if categories:
        df = df[df["cat"].isin(categories)]
    if plans:
        df = df[df["plan"].isin(plans)]
    if search:
        s = search.strip().lower()
        df = df[df["name"].str.lower().str.contains(s, regex=False) | df["code"].str.contains(s, regex=False)
                | df["amc"].fillna("").str.lower().str.contains(s, regex=False)]
    for key, (lo, hi) in ranges.items():
        if lo is not None:
            df = df[df[key] >= lo]
        if hi is not None:
            df = df[df[key] <= hi]
    col = "name" if sort == "name" else sort
    return df.sort_values(col, ascending=not descending, na_position="last", kind="stable")


def facets(df_all: pd.DataFrame) -> list[dict[str, Any]]:
    counts = df_all["cat"].value_counts().to_dict()
    return [
        {"group": g, "categories": [{"key": k, "label": lbl, "count": int(counts.get(k, 0))} for k, lbl in items]}
        for g, items in CATEGORY_GROUPS.items()
    ]


def all_frame(ter: dict[str, float]) -> pd.DataFrame:
    return _scored(ter)


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    out = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    rows = out.to_dict("records")
    for r in rows:
        for k, v in r.items():
            if isinstance(v, (np.floating, float)) and v is not None:
                r[k] = round(float(v), 4)
    return rows


def to_csv(df: pd.DataFrame) -> str:
    cols = {
        "code": "Scheme Code", "name": "Fund Name", "amc": "AMC", "plan": "Plan", "score": "FH Checklist Score",
        "perf": "Performance /25", "ops": "Operations /25", "risk": "Risk vs Reward /25", "ter": "Net Expense Ratio %",
        "nav": "NAV", "ret_1m": "1M %", "ret_3m": "3M %", "ret_6m": "6M %", "ret_1y": "1Y %", "ret_2y": "2Y CAGR %",
        "cagr_3y": "3Y CAGR %", "cagr_5y": "5Y CAGR %", "cagr_7y": "7Y CAGR %", "cagr_10y": "10Y CAGR %",
        "vol_3y": "Std Dev 3Y %", "sharpe_3y": "Sharpe 3Y", "sortino_3y": "Sortino 3Y",
        "max_dd_3y": "Max Drawdown 3Y %", "max_dd_all": "Max Drawdown All %", "isin": "ISIN",
    }
    buf = io.StringIO()
    df[list(cols)].rename(columns=cols).round(4).to_csv(buf, index=False)
    return buf.getvalue()
