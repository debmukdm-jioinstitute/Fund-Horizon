from __future__ import annotations
"""Trendlyne-style mutual fund screener: category groups, returns, risk, AUM, FH star rating and checklist score.

Built from the shipped AMFI + mfapi.in dataset (Growth option, Direct and Regular), rebuilt daily by
data/fundhorizon_mf_rag_dataset/build_dataset.py. Alpha, beta and Treynor are measured against the median of the
scheme's AMFI category and plan (no index data). The star rating is FH's own (risk-adjusted rank), not Morningstar's.
"""

import io
import json
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

from app.data.loader import data_dir, load_metrics, load_nav

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

# SEBI tier-1 benchmark per category. The dataset has no index series, so these are labels only.
_N500, _AGG, _MOD, _CON = "NIFTY 500 TRI", "CRISIL Hybrid 35+65 Aggressive", "CRISIL Hybrid 50+50 Moderate", "CRISIL Hybrid 85+15 Conservative"
BENCHMARKS: dict[str, str] = {
    "contra": _N500, "dividend_yield": _N500, "elss": _N500, "flexi_cap": _N500, "focused": _N500, "value": _N500,
    "large_mid_cap": "NIFTY LargeMidcap 250 TRI", "large_cap": "NIFTY 100 TRI", "mid_cap": "NIFTY Midcap 150 TRI",
    "multi_cap": "NIFTY 500 Multicap 50:25:25 TRI", "small_cap": "NIFTY Smallcap 250 TRI",
    "sectoral_thematic": "Sector/theme index (varies by fund)",
    "aggressive_hybrid": _AGG, "arbitrage": "NIFTY 50 Arbitrage", "balanced_advantage": "NIFTY 50 Hybrid Composite Debt 50:50",
    "balanced_hybrid": _MOD, "conservative_hybrid": _CON, "equity_savings": "NIFTY Equity Savings",
    "multi_asset": "Composite: Equity + Debt + Gold (varies by fund)",
    "banking_psu": "CRISIL Banking & PSU Debt", "corporate_bond": "CRISIL Corporate Debt", "credit_risk": "CRISIL Credit Risk Debt",
    "dynamic_bond": "CRISIL Dynamic Bond", "fixed_term": "CRISIL Composite Bond", "floater": "CRISIL Short Term Bond",
    "gilt": "CRISIL Dynamic Gilt", "liquid": "CRISIL Liquid Debt", "medium_long_duration": "CRISIL Medium to Long Duration Debt",
    "money_market": "CRISIL Money Market", "other_debt": "CRISIL Composite Bond", "overnight": "CRISIL Overnight",
    "short_duration": "CRISIL Short Duration Debt",
    "solution_children": _AGG, "solution_retirement": _AGG,
    "gold": "Domestic price of physical gold", "international": "Global index (varies by fund)",
}
# Passive index fund (Direct, Growth) that tracks each benchmark, used only to draw a benchmark line: the dataset has no raw index series.
# shortcut: fund NAV is net of ~0.2% TER and TRI index itself is not available, so this lags the true TRI slightly; upgrade by ingesting NSE TRI history.
_N500_FUND, _N100_FUND = "147625", "147666"
BENCHMARK_PROXY: dict[str, str] = {
    **{c: _N500_FUND for c in ("contra", "dividend_yield", "elss", "flexi_cap", "focused", "value")},
    "large_cap": _N100_FUND, "mid_cap": "147622", "small_cap": "147623",
    "large_mid_cap": "152156", "multi_cap": "152751",
}
_LABELS = {k: lbl for items in CATEGORY_GROUPS.values() for k, lbl in items}
_YEARS = (1, 3, 5, 10)
# Dataset fraction columns -> output percent columns.
_PCT = {
    "ret_1m": "ret_1m", "ret_3m": "ret_3m", "ret_6m": "ret_6m", "ret_1y": "ret_1y", "cagr_2y": "ret_2y",
    "cagr_3y": "cagr_3y", "cagr_5y": "cagr_5y", "cagr_7y": "cagr_7y", "cagr_10y": "cagr_10y",
    "max_drawdown_3y": "max_dd_3y", "max_drawdown_all": "max_dd_all", "cagr_since_inception": "cagr_si",
    "roll1y_pct_positive": "roll1y_pos", "day_chg": "day_chg", "week_chg": "week_chg",
    **{f"{m}_{y}y": f"{m}_{y}y" for y in _YEARS for m in ("vol", "alpha", "treynor")},
}
# Unit-free ratios copied as is.
_RAW = ["sharpe_{}y", "sortino_{}y", "beta_{}y"]
# AdvisorKhoj market capture ratios (equity categories only), written by scripts/build_capture_ratio.py: up %, down %, up/down.
_CAPTURE = ("cap_up", "cap_down", "cap_ratio")
_AVG_COLS = ["ret_1m", "ret_3m", "ret_1y", "ret_2y", "cagr_3y", "cagr_5y", "cagr_10y"]
_QUARTILE_RET = {"1y": "ret_1y", "2y": "ret_2y", "3y": "cagr_3y", "5y": "cagr_5y"}
# MF Research V2 columns: precomputed consistency (from the nightly
# screening refresh via consistency_map) and vs-index metrics (from
# index_map, populated only when a real TRI series is ingested; until then
# every value is null and the UI says so — never a proxy figure).
_V2_NUMERIC_KEYS = [
    "roll_win_pct", "cal_topq_years", "cal_win_pct", "downside_dev_3y",
    "sip_cagr_3y", "sip_cagr_5y",
    "idx_alpha_3y", "idx_beta_3y", "idx_tracking_error_3y", "idx_information_ratio_3y",
]
_NEW_NUMERIC_KEYS = (
    [f"quartile_{p}" for p in _QUARTILE_RET]
    + [f"cap_spread_{y}y" for y in _YEARS]
    + ["ter_gap_pp", "calmar_3y", "manager_tenure_years"]
    + [f"pct_{m}" for m in ("sharpe_3y", "sortino_3y", "alpha_3y", "vol_3y", "max_dd_3y", "ret_1y", "cagr_3y", "cagr_5y")]
    + _V2_NUMERIC_KEYS
)
FH_NUMERIC_KEYS = ["fh_score", "fh_rating", "fh_coverage", "fh_base", "fh_penalties", "fh_adj"]
NUMERIC_KEYS = (
    ["out_1y", "out_3y", "out_5y", "score", "perf", "port", "ops", "risk", "stars", "aum_cr", "nav", "ter", "history_years", "hi52", "lo52"]
    + list(_PCT.values())
    + [t.format(y) for y in _YEARS for t in _RAW]
    + [f"{k}_{y}y" for y in _YEARS for k in _CAPTURE]
    + _NEW_NUMERIC_KEYS
    + FH_NUMERIC_KEYS
)
SORT_KEYS = set(NUMERIC_KEYS) | {"name"}


def _pillar(values: pd.Series, groups: pd.Series, higher_better: bool = True) -> pd.Series:
    """Percentile rank (0..1) inside each group; ties share the average rank; NaN stays NaN."""
    return values.groupby(groups).rank(pct=True, ascending=higher_better)


# Scoring rules live here once: scoring and the explain endpoint both read them, so an edit shows up in both.
PILLAR_MAX = 25
LABEL_TOP, LABEL_MID = 19, 12
# pillar -> [(column, higher_is_better, plain name)]; each pillar is the mean peer percentile of its inputs.
PILLAR_INPUTS: dict[str, list[tuple[str, bool, str]]] = {
    "perf": [("ret_1y", True, "1-year return"), ("cagr_3y", True, "3-year CAGR"), ("cagr_5y", True, "5-year CAGR")],
    "risk": [("sharpe_3y", True, "3-year Sharpe"), ("sortino_3y", True, "3-year Sortino"),
             ("max_dd_3y", True, "3-year max drawdown"), ("vol_3y", False, "3-year volatility")],
    "port": [("aum_cr", True, "Fund size (AUM)"), ("alpha_3y", True, "3-year alpha")],
}
COST_WEIGHT, AGE_WEIGHT, AGE_CAP_YEARS = 0.6, 0.4, 5
STAR_WEIGHTS = {"sharpe_3y": 0.2, "sharpe_5y": 0.3, "sharpe_10y": 0.5}
STAR_CUTS = (0.9, 0.675, 0.325, 0.1)  # percentile above each cut -> 5, 4, 3, 2 stars; else 1
LOWER_BETTER = ("vol_", "cap_down_", "ter", "ter_gap_pp")
NO_RANK = ("beta_", "nav", "hi52", "lo52", "day_chg", "week_chg", "cat_label")
PILLAR_TITLES = {"perf": "Performance", "port": "Portfolio", "ops": "Operations", "risk": "Risk vs Reward"}


def _bucket(p: pd.Series) -> pd.Series:
    return pd.Series(np.select([p > c for c in STAR_CUTS], [5, 4, 3, 2], 1), index=p.index, dtype="float")


def _pillar_mean(df: pd.DataFrame, key: pd.Series, name: str) -> pd.Series:
    return pd.concat([_pillar(df[c], key, hb) for c, hb, _ in PILLAR_INPUTS[name]], axis=1).mean(axis=1)


def _stars(df: pd.DataFrame, key: pd.Series) -> tuple[pd.Series, pd.Series]:
    """1-5 stars from the percentile of a Morningstar-style weighted Sharpe (3Y 20%, 5Y 30%, 10Y 50%) in category and plan.

    Funds under 3 years (no 3Y Sharpe) get a provisional rating from the percentile of their 1Y Sharpe instead,
    returned as the second series so the UI can flag it. Stale / flat-NAV funds stay unrated.
    """
    w = STAR_WEIGHTS
    have = pd.concat([df[c].notna() * x for c, x in w.items()], axis=1).sum(axis=1)
    raw = sum(df[c].fillna(0) * x for c, x in w.items()) / have.where(have > 0)
    raw = raw.where(df["sharpe_3y"].notna())
    size = raw.groupby(key).transform("count")
    stars = _bucket(_pillar(raw, key)).where(raw.notna() & (size >= 3))  # shortcut: 3-fund peer groups are thin; upgrade if a parent group is added

    live = df["quality"].eq("ok")
    s1 = df["sharpe_1y"].where(live & df["history_years"].ge(1))
    prov = _bucket(_pillar(s1, key)).where(s1.notna() & (s1.groupby(key).transform("count") >= 5) & stars.isna())
    return stars.fillna(prov), prov.notna()


def _label(points: float, good: str, mid: str, weak: str) -> str:
    return good if points >= LABEL_TOP else mid if points >= LABEL_MID else weak


@lru_cache(maxsize=1)
def _capture_data() -> dict[str, dict[str, list[float | None]]]:
    path = data_dir() / "capture_ratio.json"
    return json.loads(path.read_text())["data"] if path.exists() else {}


@lru_cache(maxsize=1)
def _base_frame() -> pd.DataFrame:
    src = load_metrics()
    df = pd.DataFrame({
        "code": src["scheme_code"], "name": src["scheme_name"], "amc": src["amc"], "plan": src["plan"],
        "cat": src["cat"], "nav": src["latest_nav"], "nav_date": src["latest_nav_date"],
        "history_years": src["history_years"], "isin": src["isin_growth_or_payout"], "quality": src["data_quality"],
        "aum_cr": src["aum_cr"], "hi52": src["hi52"], "lo52": src["lo52"],
        "hi52_date": src["hi52_date"], "lo52_date": src["lo52_date"],
    })
    for raw, out in _PCT.items():
        df[out] = src[raw] * 100
    for y in _YEARS:
        for t in _RAW:
            df[t.format(y)] = src[t.format(y)]
    cap = _capture_data()
    for y in _YEARS:
        for i, k in enumerate(_CAPTURE):
            df[f"{k}_{y}y"] = [(cap.get(c, {}).get(f"{y}y") or [None] * 3)[i] for c in df["code"]]
    key = df["cat"] + "|" + df["plan"]
    for col in _AVG_COLS + ["ret_2y"]:
        df[f"{col}_cat"] = df.groupby(key)[col].transform("mean")
    return df.reset_index(drop=True)


@lru_cache(maxsize=2)
def _calendar_quartiles(nav_asof: str) -> dict[str, dict[str, int | None]]:
    """Computed quartiles for YTD, previous and prior calendar year, per category + plan peer group (min 8 peers).

    Built from the shipped month-end NAV files (about 10s once per NAV date) so the FH score does not wait for the
    nightly screening refresh. The nightly value, when present, takes precedence.
    """
    from app.backoffice.mf_research_v2 import calendar_year_returns
    from app.backoffice.screening.quartiles import compute_category_quartiles

    base = _base_frame()
    out: dict[str, dict[str, int | None]] = {}
    for _k, grp in base.groupby(base["cat"] + "|" + base["plan"]):
        rets: dict[str, dict[str, float]] = {"ytd": {}, "py1": {}, "py2": {}}
        for code in grp["code"]:
            try:
                nav = load_nav(str(code))
            except OSError:
                continue
            if nav.empty:
                continue
            ry = int(nav.index[-1].year)
            cal = calendar_year_returns(nav)
            for k, y in (("py1", ry - 1), ("py2", ry - 2)):
                if y in cal:
                    rets[k][str(code)] = cal[y]
            dec = nav[(nav.index.year == ry - 1) & (nav.index.month == 12)]
            if len(dec) and nav.index[-1].year > dec.index[-1].year:
                rets["ytd"][str(code)] = float(nav.iloc[-1] / dec.iloc[-1] - 1.0)
        for k, r in rets.items():
            for code, q in compute_category_quartiles(r, min_peers=8).items():
                out.setdefault(code, {})[k] = q
    return out


def _manager_series(manager_map: dict[str, Any] | None, df: pd.DataFrame, field: str, pos: int) -> pd.Series:
    """Manager name/start per scheme code. manager_map values are (name, start) tuples or dict rows."""
    if not manager_map:
        return pd.Series([None] * len(df), index=df.index, dtype=object)
    out = []
    for code in df["code"]:
        row = manager_map.get(str(code))
        if row is None:
            out.append(None)
        elif isinstance(row, dict):
            out.append(row.get("manager_name" if field == "name" else "manager_start"))
        else:
            out.append(row[pos])
    return pd.Series(out, index=df.index, dtype=object)


def _scored(
    ter: dict[str, float],
    manager_map: dict[str, Any] | None = None,
    consistency_map: dict[str, dict[str, Any]] | None = None,
    index_map: dict[str, dict[str, Any]] | None = None,
) -> pd.DataFrame:
    df = _base_frame().copy()
    df["ter"] = df["code"].map(ter)
    df["cat_label"] = df["cat"].map(_LABELS).fillna(df["cat"])
    df["benchmark"] = df["cat"].map(BENCHMARKS).fillna("Scheme's tracked index")
    # Excess return vs the category-plan average (no index series in the dataset), in percentage points.
    for y, (r, c) in {1: ("ret_1y", "ret_1y_cat"), 3: ("cagr_3y", "cagr_3y_cat"), 5: ("cagr_5y", "cagr_5y_cat")}.items():
        df[f"out_{y}y"] = df[r] - df[c]
    key = df["cat"] + "|" + df["plan"]
    # No holdings data, so the portfolio pillar is fund size (AUM) and 3Y alpha rank instead of stock-level quality.
    cost = _pillar(df["ter"], key, higher_better=False)
    age = (df["history_years"].clip(upper=AGE_CAP_YEARS) / AGE_CAP_YEARS).fillna(0)
    for name in PILLAR_INPUTS:
        df[name] = (_pillar_mean(df, key, name) * PILLAR_MAX).round()
    df["ops"] = ((cost.fillna(0.5) * COST_WEIGHT + age * AGE_WEIGHT) * PILLAR_MAX).round()
    pillars = df[["perf", "port", "ops", "risk"]]
    seen = pillars.notna().sum(axis=1)
    # A fund missing one pillar (e.g. too young for alpha) is scored on the rest, scaled to 100.
    df["score"] = (pillars.sum(axis=1) * 4 / seen).where(seen >= 3).round()
    df["stars"], df["stars_provisional"] = _stars(df, key)
    df["port_label"] = [_label(p, "HIGH RANK", "MEDIUM RANK", "WEAK RANK") for p in df["port"].fillna(0)]
    df["perf_label"] = [_label(p, "GOOD RETURNS", "AVERAGE RETURNS", "POOR RETURNS") for p in df["perf"].fillna(0)]
    df["risk_label"] = [_label(p, "GOOD RISK REWARD", "FAIR RISK REWARD", "POOR RISK REWARD") for p in df["risk"].fillna(0)]
    df["ops_label"] = [_label(p, "HIGH RANK", "MEDIUM RANK", "WEAK RANK") for p in df["ops"].fillna(0)]
    # --- MF Research V1 columns (computed on this cached frame, never per request per row). ---
    # Computed quartiles: category + plan peer group, min 8 peers, ties averaged.
    # Imported lazily: app.backoffice.screening.__init__ pulls the screening service/jobs
    # chain, so mf_screener keeps its import-time dependencies to the data loader only.
    from app.backoffice.screening.quartiles import compute_category_quartiles

    for period, ret_col in _QUARTILE_RET.items():
        mapping: dict[str, int | None] = {}
        for _keyval, grp in df.groupby(key):
            rets = {str(c): (float(v) if pd.notna(v) else None) for c, v in zip(grp["code"], grp[ret_col])}
            mapping.update(compute_category_quartiles(rets, min_peers=8))
        df[f"quartile_{period}"] = df["code"].map(mapping)
    df["quartile_source"] = np.where(df["quartile_2y"].notna(), "computed", "unavailable")
    # Capture spread (percentage points) from the single Advisorkhoj capture source already in the frame.
    for y in _YEARS:
        df[f"cap_spread_{y}y"] = df[f"cap_up_{y}y"] - df[f"cap_down_{y}y"]
    # TER gap vs the category + plan median TER, in percentage points.
    df["ter_gap_pp"] = df["ter"] - df.groupby(key)["ter"].transform("median")
    # Peer percentiles 0-100 (1 decimal) via the existing _pillar rank; lower-is-better where noted.
    _pct_defs = [
        ("pct_sharpe_3y", "sharpe_3y", True), ("pct_sortino_3y", "sortino_3y", True),
        ("pct_alpha_3y", "alpha_3y", True), ("pct_vol_3y", "vol_3y", False),
        ("pct_max_dd_3y", "max_dd_3y", True), ("pct_ret_1y", "ret_1y", True),
        ("pct_cagr_3y", "cagr_3y", True), ("pct_cagr_5y", "cagr_5y", True),
    ]
    for out_col, src_col, higher_better in _pct_defs:
        df[out_col] = (_pillar(df[src_col], key, higher_better=higher_better) * 100).round(1)
    # Calmar 3Y: 3Y CAGR / |3Y max drawdown|; both frame columns are in percent, so the ratio is unit-free.
    df["calmar_3y"] = (df["cagr_3y"] / df["max_dd_3y"].abs()).where(
        df["cagr_3y"].notna() & df["max_dd_3y"].notna() & df["max_dd_3y"].ne(0))
    # Manager fields from the repo managers table passed in by the caller. No AMFI fallback here:
    # mf_reference pulls the API auth chain into this data module, so the fallback lives at the
    # API/compare layer instead (see api/backoffice.py and compare.py); without a seed row the
    # fund is "Unknown" (manager_name None, tenure None), never an invented name.
    df["manager_name"] = _manager_series(manager_map, df, "name", 0)
    df["manager_start"] = _manager_series(manager_map, df, "start", 1)
    nav_as_of = pd.to_datetime(df["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    _cleaned_start = df["manager_start"].where(
        df["manager_start"].isna(),
        df["manager_start"].astype(str).str.replace(r"(?<=\d)(st|nd|rd|th)", "", regex=True),
    )
    starts = pd.to_datetime(_cleaned_start, errors="coerce")
    tenure_days = (nav_as_of - starts).dt.days
    df["manager_tenure_years"] = (tenure_days / 365.25).where(starts.notna() & tenure_days.ge(0))
    # --- MF Research V2 columns (precomputed maps passed in by the caller,
    # same pattern as manager_map; absent map entries stay null). ---
    for col in ("roll_win_pct", "cal_topq_years", "cal_win_pct", "downside_dev_3y", "sip_cagr_3y", "sip_cagr_5y"):
        if consistency_map:
            df[col] = [ (consistency_map.get(str(c)) or {}).get(col) for c in df["code"] ]
        else:
            df[col] = None
    _idx_cols = {
        "idx_alpha_3y": "alpha_3y_pct", "idx_beta_3y": "beta_3y",
        "idx_tracking_error_3y": "tracking_error_3y_pct", "idx_information_ratio_3y": "information_ratio_3y",
    }
    for col, src in _idx_cols.items():
        if index_map:
            df[col] = [(index_map.get(str(c)) or {}).get(src) for c in df["code"]]
        else:
            df[col] = None
    # FH score engine (app.backoffice.fh_score): calendar-year quartiles come from the nightly screening refresh.
    from app.backoffice import fh_score

    computed = _calendar_quartiles(str(nav_as_of))
    for key in ("ytd", "py1", "py2"):
        df[f"cal_q_{key}"] = [
            (((consistency_map or {}).get(str(c)) or {}).get("cal_quartiles") or {}).get(key) or computed.get(str(c), {}).get(key)
            for c in df["code"]
        ]
    return fh_score.score_frame(df, ref=nav_as_of if pd.notna(nav_as_of) else None)


def screen(
    ter: dict[str, float],
    categories: list[str] | None,
    plans: list[str] | None,
    search: str | None,
    ranges: dict[str, tuple[float | None, float | None]],
    sort: str,
    descending: bool,
    amcs: list[str] | None = None,
    manager: str | None = None,
    min_tenure: float | None = None,
    include_unknown: bool = True,
    quartiles: list[int] | None = None,
    quartile_period: str = "2y",
    include_unavailable: bool = True,
    manager_map: dict[str, Any] | None = None,
    consistency_map: dict[str, dict[str, Any]] | None = None,
    index_map: dict[str, dict[str, Any]] | None = None,
    frame: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """`frame` is an already scored frame (the API caches one); it is only read, never modified."""
    df = frame if frame is not None else _scored(ter, manager_map=manager_map, consistency_map=consistency_map, index_map=index_map)
    if categories:
        df = df[df["cat"].isin(categories)]
    if plans:
        df = df[df["plan"].isin(plans)]
    if amcs:
        df = df[df["amc"].isin(amcs)]
    if search:
        s = search.strip().lower()
        df = df[df["name"].str.lower().str.contains(s, regex=False) | df["code"].str.contains(s, regex=False)
                | df["amc"].fillna("").str.lower().str.contains(s, regex=False)]
    if manager:
        m = manager.strip().lower()
        df = df[df["manager_name"].fillna("").str.lower().str.contains(m, regex=False)]
    if min_tenure is not None:
        known = df["manager_tenure_years"] >= min_tenure
        df = df[known | (df["manager_tenure_years"].isna() & include_unknown)]
    if quartiles:
        if quartile_period not in _QUARTILE_RET:
            raise ValueError(f"Unknown quartile period: {quartile_period}")
        qcol = f"quartile_{quartile_period}"
        df = df[df[qcol].isin(quartiles) | (df[qcol].isna() & include_unavailable)]
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


def all_frame(
    ter: dict[str, float],
    manager_map: dict[str, Any] | None = None,
    consistency_map: dict[str, dict[str, Any]] | None = None,
    index_map: dict[str, dict[str, Any]] | None = None,
) -> pd.DataFrame:
    return _scored(ter, manager_map=manager_map, consistency_map=consistency_map, index_map=index_map)


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    out = df.drop(columns=[c for c in df.columns if c.startswith("fhd_")]).replace({np.nan: None, np.inf: None, -np.inf: None})
    rows = out.to_dict("records")
    for r in rows:
        for k, v in r.items():
            if isinstance(v, (np.floating, float)) and v is not None:
                r[k] = round(float(v), 4)
            if k.startswith("quartile_") and r[k] is not None and k != "quartile_source":
                r[k] = int(r[k])
    return rows


def to_csv(df: pd.DataFrame) -> str:
    cols = {
        "code": "Scheme Code", "name": "Fund Name", "amc": "AMC", "plan": "Plan", "cat_label": "Category", "benchmark": "Benchmark",
        "out_1y": "1Y vs Category Avg (pp)", "out_3y": "3Y vs Category Avg (pp)", "out_5y": "5Y vs Category Avg (pp)", "score": "FH Checklist Score",
        "perf": "Performance /25", "port": "Portfolio /25", "ops": "Operations /25", "risk": "Risk vs Reward /25",
        "stars": "FH Star Rating", "aum_cr": "AUM Cr", "ter": "Net Expense Ratio %",
        "nav": "NAV", "day_chg": "Day %", "week_chg": "Week %", "hi52": "52W High", "hi52_date": "52W High Date",
        "lo52": "52W Low", "lo52_date": "52W Low Date", "ret_1m": "1M %", "ret_3m": "3M %", "ret_6m": "6M %", "ret_1y": "1Y %", "ret_2y": "2Y CAGR %",
        "cagr_3y": "3Y CAGR %", "cagr_5y": "5Y CAGR %", "cagr_7y": "7Y CAGR %", "cagr_10y": "10Y CAGR %",
        **{f"{k}_{y}y": f"{lbl} {y}Y" for y in _YEARS for k, lbl in (
            ("alpha", "Alpha %"), ("beta", "Beta"), ("sharpe", "Sharpe"), ("sortino", "Sortino"),
            ("treynor", "Treynor %"), ("vol", "Std Dev %"))},
        **{f"{k}_{y}y": f"{lbl} {y}Y" for y in _YEARS for k, lbl in (
            ("cap_up", "Up Capture %"), ("cap_down", "Down Capture %"), ("cap_ratio", "Capture Ratio"))},
        **{f"cap_spread_{y}y": f"Capture Spread {y}Y (pp)" for y in _YEARS},
        **{f"quartile_{p}": f"Quartile {p.upper()} (computed)" for p in _QUARTILE_RET},
        "quartile_source": "Quartile Source",
        "ter_gap_pp": "TER vs Category+Plan Median (pp)",
        "calmar_3y": "Calmar 3Y",
        "manager_name": "Fund Manager", "manager_start": "Manager Since",
        "manager_tenure_years": "Manager Tenure (years)",
        "roll_win_pct": "Rolling 1Y Win % (vs category median, precomputed)",
        "cal_topq_years": "Calendar Top-Quartile Years (precomputed)",
        "cal_win_pct": "Calendar Win % (vs category median, precomputed)",
        "downside_dev_3y": "Downside Deviation 3Y % (precomputed)",
        "sip_cagr_3y": "SIP CAGR 3Y % (precomputed)",
        "sip_cagr_5y": "SIP CAGR 5Y % (precomputed)",
        "idx_alpha_3y": "Alpha 3Y % (vs index TRI, null until a TRI series is ingested)",
        "idx_beta_3y": "Beta 3Y (vs index TRI, null until a TRI series is ingested)",
        "idx_tracking_error_3y": "Tracking Error 3Y % (vs index TRI, null until a TRI series is ingested)",
        "idx_information_ratio_3y": "Information Ratio 3Y (vs index TRI, null until a TRI series is ingested)",
        **{f"pct_{m}": f"{lbl} Percentile (vs category + plan peers)" for m, lbl in (
            ("sharpe_3y", "Sharpe 3Y"), ("sortino_3y", "Sortino 3Y"), ("alpha_3y", "Alpha 3Y"),
            ("vol_3y", "Volatility 3Y"), ("max_dd_3y", "Max Drawdown 3Y"),
            ("ret_1y", "Return 1Y"), ("cagr_3y", "CAGR 3Y"), ("cagr_5y", "CAGR 5Y"))},
        "max_dd_3y": "Max Drawdown 3Y %", "max_dd_all": "Max Drawdown All %", "isin": "ISIN",
    }
    buf = io.StringIO()
    df[list(cols)].rename(columns=cols).round(4).to_csv(buf, index=False)
    return buf.getvalue()


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float, np.integer, np.floating)) and np.isfinite(v) else None


def _part(grp: pd.DataFrame, code: str, col: str, hb: bool | None, label: str, weight: float | None = None) -> dict[str, Any]:
    """One input's standing inside the peer group (category + plan), computed from the live frame."""
    vals = pd.to_numeric(grp[col], errors="coerce")
    mine = _num(vals[grp["code"] == code].iloc[0])
    peers = vals.dropna()
    out: dict[str, Any] = {"key": col, "label": label, "value": mine, "weight": weight, "peers_with_data": int(len(peers)),
                           "median": _num(peers.median()) if len(peers) else None}
    if hb is not None and mine is not None and len(peers):
        better = int((peers > mine).sum() if hb else (peers < mine).sum())
        out.update(rank=better + 1, percentile=round(float(_pillar(vals, pd.Series(0, index=vals.index), hb)[grp["code"] == code].iloc[0]) * 100, 1),
                   best=_num(peers.max() if hb else peers.min()), higher_better=hb)
    return out


def explain(df: pd.DataFrame, code: str, metric: str) -> dict[str, Any] | None:
    """Live, per-fund breakdown of one screener value: its inputs, peer ranks and the rule that produced it."""
    me = df[df["code"] == code]
    if me.empty or metric not in df.columns:
        return None
    r = me.iloc[0]
    grp = df[(df["cat"] == r["cat"]) & (df["plan"] == r["plan"])]
    out: dict[str, Any] = {
        "metric": metric, "code": code, "name": r["name"], "plan": r["plan"], "category": r["cat_label"], "peers": int(len(grp)),
        "nav_date": r["nav_date"], "value": _num(r[metric]) if metric != "cat_label" else r[metric],
        "bands": {"top": LABEL_TOP, "mid": LABEL_MID, "max": PILLAR_MAX},
    }
    if metric in ("fh_score", "fh_rating"):
        from app.backoffice import fh_score

        out["fh"] = fh_score.explain_row(r)
        out["parts"] = []
        out["rule"] = "FH score: weighted filters, penalties and a consistency adjustment, bounded 0-100. See breakdown."
    elif metric in PILLAR_INPUTS or metric == "ops":
        if metric == "ops":
            parts = [_part(grp, code, "ter", False, "Expense ratio (lower ranks better)", COST_WEIGHT),
                     _part(grp, code, "history_years", None, f"Track record (capped at {AGE_CAP_YEARS} years)", AGE_WEIGHT)]
            out["rule"] = f"{COST_WEIGHT:.0%} cost rank + {AGE_WEIGHT:.0%} age, scaled to {PILLAR_MAX}. Unknown cost counts as average."
        else:
            parts = [_part(grp, code, c, hb, lbl) for c, hb, lbl in PILLAR_INPUTS[metric]]
            out["rule"] = f"Average peer percentile of {len(parts)} measures, scaled to {PILLAR_MAX}."
        out.update(parts=parts, points=_num(r[metric]), label=r[f"{metric}_label"])
    elif metric == "score":
        out["parts"] = [{"key": k, "label": PILLAR_TITLES[k], "value": _num(r[k]), "max": PILLAR_MAX, "label_text": r[f"{k}_label"]} for k in PILLAR_TITLES]
        out["rule"] = "Sum of the four pillars scaled to 100; a missing pillar is scaled up. Needs at least 3 pillars."
    elif metric == "stars":
        out["parts"] = [_part(grp, code, c, True, c.replace("_", " ").title(), w) for c, w in STAR_WEIGHTS.items()]
        out.update(rule=f"Weighted Sharpe ranked in the peer group; percentile cut-offs {STAR_CUTS} give 5/4/3/2 stars, else 1. Needs 3+ peers.",
                   provisional=bool(r["stars_provisional"]))
    else:
        hb = None if metric.startswith(NO_RANK) else not metric.startswith(LOWER_BETTER)
        out["parts"] = [_part(grp, code, metric, hb, metric)] if metric != "cat_label" else []
        cat_avg = r.get(f"{metric}_cat")
        out["category_avg"] = _num(cat_avg)
    return out
