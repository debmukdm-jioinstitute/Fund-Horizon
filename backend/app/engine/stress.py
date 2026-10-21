from __future__ import annotations
"""Historical stress test on month-end NAVs.

Limitation: month-end data understates intra-month falls; the Feb-Mar 2020 drawdown is measured
from the Jan-2020 month-end to the lower of Feb/Mar month-ends. A constant-mix portfolio
(rebalanced monthly to target weights) is assumed. Funds lacking history in a month use the
median monthly return of eligible funds in their category (flagged as substituted).
"""

from functools import lru_cache

import numpy as np
import pandas as pd

from app.config import load_assumptions
from app.data.loader import load_nav


@lru_cache(maxsize=64)
def _category_median_returns(codes: tuple[str, ...], min_funds: int) -> pd.Series:
    rets = pd.concat({c: load_nav(c).pct_change() for c in codes}, axis=1)
    med = rets.median(axis=1)
    med[rets.notna().sum(axis=1) < min_funds] = np.nan
    return med


def category_median_series(df: pd.DataFrame, cat: str, min_funds: int) -> pd.Series:
    codes = tuple(sorted(df.loc[df["cat"] == cat, "scheme_code"].astype(str)))
    return _category_median_returns(codes, min_funds)


def stress_test(funds: list[dict], df: pd.DataFrame, a: dict | None = None) -> dict:
    """funds: picks with scheme_code, cat, weight_pct. df: eligible funds (for category medians)."""
    a = a or load_assumptions()
    st = a["stress"]
    asof = pd.Timestamp(a["data_asof"])
    start = asof - pd.DateOffset(years=st["window_years"])
    cols, substituted = {}, {}
    for f in funds:
        r = load_nav(f["scheme_code"]).pct_change()
        med = category_median_series(df, f["cat"], st["min_funds_for_category_median"])
        idx = med.index.union(r.index)
        idx = idx[(idx >= start) & (idx <= asof + pd.Timedelta(days=31))]
        r, med = r.reindex(idx), med.reindex(idx)
        sub = r.isna() & med.notna()
        cols[f["scheme_code"]] = r.fillna(med)
        substituted[f["scheme_code"]] = float(sub.mean()) if len(sub) else 0.0
    rets = pd.DataFrame(cols).dropna(how="any")
    w = np.array([f["weight_pct"] for f in funds]) / sum(f["weight_pct"] for f in funds)
    port = rets[[f["scheme_code"] for f in funds]].to_numpy() @ w
    value = st["illustration_amount"] * np.cumprod(1.0 + port)
    series = pd.Series(value, index=rets.index)

    peak = series.cummax()
    worst_dd = float((series / peak - 1.0).min())
    roll12 = series / series.shift(12) - 1.0
    crash = None
    p0, p1 = pd.Timestamp(st["crash_peak"]), pd.Timestamp(st["crash_end"])
    if p0 in series.index and p1 in series.index:
        seg = series.loc[p0:p1]
        crash = float(seg.min() / seg.iloc[0] - 1.0)
    any_sub = any(v > 0 for v in substituted.values())
    notes = ["Based on month-end NAVs; intra-month falls are not captured."]
    equity_w = sum(float(f.get("weight_pct") or 0) for f in funds if f.get("sleeve") == "equity")
    if crash is None:
        notes.append("The 2020 crash window is not in the available month-end series for this mix.")
    elif crash > -0.005 and equity_w < 1:
        notes.append(
            "The 2020 crash-window return is near zero because this mix has no equity sleeve "
            "in that window, not because the portfolio is safe."
        )
    if any_sub:
        notes.append(
            "One or more funds lack history in part of the window; those months use the "
            "category-median return (flagged as substituted)."
        )
    return {
        "crash_2020_drawdown": crash,
        "worst_peak_to_trough": worst_dd,
        "worst_rolling_12m": float(roll12.min()) if roll12.notna().any() else None,
        "window_start": str(series.index[0].date()) if len(series) else None,
        "window_end": str(series.index[-1].date()) if len(series) else None,
        "substituted_share": {k: round(v, 4) for k, v in substituted.items()},
        "any_substituted": any_sub,
        "path": [{"date": str(d.date()), "value": round(float(v))} for d, v in series.items()],
        "note": " ".join(notes),
    }
