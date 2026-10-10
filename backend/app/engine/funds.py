"""Fund scoring and shortlist selection. Pure given a metrics DataFrame.

Score = weighted mean of within-category percentile ranks (weights in config/scoring.yaml).
Weights of missing metrics are dropped and the rest renormalised; <2 usable metrics => unscored.
# EXTENSION: add AUM / TER metrics to scoring.yaml and `_metric_series` once the data has them.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.config import load_allocation, load_assumptions, load_scoring


def _metric_series(df: pd.DataFrame, key: str) -> pd.Series:
    """Higher-is-better series for a scoring metric key."""
    if key == "cagr_5y_or_3y":
        return df["cagr_5y"].fillna(df["cagr_3y"])
    if key == "neg_abs_max_drawdown_3y":
        return -df["max_drawdown_3y"].abs()
    if key == "neg_vol_3y":
        return -df["vol_3y"]
    if key == "roll3y_pct_positive":
        return df["roll3y_pct_positive"] if "roll3y_pct_positive" in df else pd.Series(np.nan, index=df.index)
    if key == "roll1y_pct_positive":
        return df["roll1y_pct_positive"] if "roll1y_pct_positive" in df else pd.Series(np.nan, index=df.index)
    if key == "neg_roll3y_dispersion":
        if "roll3y_max" in df and "roll3y_min" in df:
            return -(df["roll3y_max"] - df["roll3y_min"])
        return pd.Series(np.nan, index=df.index)
    if key == "neg_roll1y_dispersion":
        if "roll1y_max" in df and "roll1y_min" in df:
            return -(df["roll1y_max"] - df["roll1y_min"])
        return pd.Series(np.nan, index=df.index)
    if key == "sortino_3y":
        return df["sortino_3y"] if "sortino_3y" in df else pd.Series(np.nan, index=df.index)
    if key == "neg_downside_capture":
        return -df["downside_capture"] if "downside_capture" in df else pd.Series(np.nan, index=df.index)
    return df[key]


def is_income_category(cat: str) -> bool:
    return cat in load_scoring()["income_categories"]


def min_history(cat: str, a: dict | None = None) -> float:
    a = a or load_assumptions()
    asset = load_allocation()["asset_class"].get(cat)
    return a["min_history_years"]["equity" if asset == "equity" else "other"]


def score_pool(pool: pd.DataFrame, cat: str, custom_weights: dict | None = None) -> pd.DataFrame:
    """Pool with `score` (0-1) plus `_top_*` columns (rank as 'top N%'); unscored rows dropped."""
    sc = load_scoring()
    if custom_weights is not None:
        weights = custom_weights
    else:
        weights = sc["income"] if is_income_category(cat) else sc["growth"]
    out = pool.copy()
    num = pd.Series(0.0, index=out.index)
    den = pd.Series(0.0, index=out.index)
    used = pd.Series(0, index=out.index)
    for key, w in weights.items():
        s = _metric_series(out, key)
        pct = s.rank(pct=True, method="average")
        n_valid = int(s.notna().sum())
        out[f"_top_{key}"] = np.ceil(100.0 * s.rank(ascending=False, method="min") / max(n_valid, 1))
        has = pct.notna()
        num = num + pct.fillna(0.0) * w
        den = den + has * w
        used = used + has.astype(int)
    out["score"] = np.where((used >= 2) & (den > 0), num / den.where(den > 0, 1), np.nan)
    out = out[out["score"].notna()]
    return out.sort_values(["score", "scheme_code"], ascending=[False, True])


def candidate_pool(
    df: pd.DataFrame, cat: str, a: dict | None = None, custom_weights: dict | None = None
) -> pd.DataFrame:
    """Eligible funds of a canonical category passing history, demat and data quality rules, scored."""
    dq_cond = (
        df["data_quality"].isin(["ok", "split_adjusted"])
        if "data_quality" in df.columns
        else pd.Series(True, index=df.index)
    )
    pool = df[
        (df["cat"] == cat)
        & (~df["needs_demat"])
        & dq_cond
        & (df["history_years"] >= min_history(cat, a))
    ]
    if not len(pool):
        return pool.assign(score=pd.Series(dtype=float))
    return score_pool(pool, cat, custom_weights)



def _pct(v: float, digits: int = 1) -> str:
    return f"{v * 100:.{digits}f}%"


def explain_fund(row: pd.Series, cat: str) -> list[str]:
    """Template-generated reasons from the numbers (no LLM)."""
    out: list[str] = []
    if is_income_category(cat):
        if pd.notna(row.get("cagr_3y")):
            out.append(f"3Y CAGR {_pct(row['cagr_3y'])} (top {int(row['_top_cagr_3y'])}% in category)")
        if pd.notna(row.get("roll1y_median")):
            out.append(
                f"Median rolling 1Y return {_pct(row['roll1y_median'])} "
                f"(top {int(row['_top_roll1y_median'])}%)"
            )
        if pd.notna(row.get("vol_3y")):
            out.append(f"3Y volatility {_pct(row['vol_3y'])} (top {int(row['_top_neg_vol_3y'])}% lowest)")
        return out
    label, col = ("5Y", "cagr_5y") if pd.notna(row.get("cagr_5y")) else ("3Y", "cagr_3y")
    out.append(f"{label} CAGR {_pct(row[col])} (top {int(row['_top_cagr_5y_or_3y'])}% in category)")
    if pd.notna(row.get("roll3y_median")):
        out.append(f"Median rolling 3Y return {_pct(row['roll3y_median'])} (top {int(row['_top_roll3y_median'])}%)")
    if pd.notna(row.get("sharpe_3y")):
        out.append(f"3Y Sharpe {row['sharpe_3y']:.2f} (top {int(row['_top_sharpe_3y'])}%)")
    if pd.notna(row.get("max_drawdown_3y")):
        out.append(
            f"3Y max drawdown {_pct(row['max_drawdown_3y'])} "
            f"(top {int(row['_top_neg_abs_max_drawdown_3y'])}% shallowest)"
        )
    return out


def _num(v) -> float | None:
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)


_METRIC_COLS = ["ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "vol_3y", "sharpe_3y",
                "max_drawdown_3y", "history_years", "roll3y_median"]


def _pick_to_dict(row: pd.Series, cat: str, weight: float, sleeve: str) -> dict:
    return {
        "scheme_code": str(row["scheme_code"]),
        "scheme_name": row["scheme_name"],
        "amc": row["amc"],
        "category": row["category"],
        "cat": cat,
        "sleeve": sleeve,
        "weight_pct": float(weight),
        "score": round(float(row["score"]), 4),
        "metrics": {k: _num(row.get(k)) for k in _METRIC_COLS},
        "explain": explain_fund(row, cat),
        "merged_from": [],
        "needs_demat": bool(row.get("needs_demat", False)),
        "last_nav_date": str(row.get("last_nav_date")),
    }


def select_funds(category_weights: dict[str, float], df: pd.DataFrame, a: dict | None = None) -> list[dict]:
    """Pick the top fund per category, honouring AMC cap, min weight and max fund count.

    Categories are processed by weight (desc) so heavier sleeves get first pick of AMCs.
    Small positions are merged into the largest same-sleeve fund (fallback sleeve per config).
    """
    sel = load_allocation()["selection"]
    picks: list[dict] = []
    amc_count: dict[str, int] = {}
    chosen: set[str] = set()
    for cat, w in sorted(category_weights.items(), key=lambda kv: (-kv[1], kv[0])):
        if w <= 0:
            continue
        pool = candidate_pool(df, cat, a)
        if not len(pool):
            raise ValueError(f"No eligible funds for category '{cat}'")
        for _, row in pool.iterrows():
            code = str(row["scheme_code"])
            if amc_count.get(row["amc"], 0) < sel["max_per_amc"] and code not in chosen:
                amc_count[row["amc"]] = amc_count.get(row["amc"], 0) + 1
                chosen.add(code)
                picks.append(_pick_to_dict(row, cat, w, sel["sleeve_of"][cat]))
                break
        else:
            raise ValueError(f"No eligible funds for category '{cat}' within AMC limits")
    return _merge_small(picks, sel)


def _merge_small(picks: list[dict], sel: dict) -> list[dict]:
    """Merge funds below min weight, then the smallest while count exceeds max_funds."""
    picks = [dict(p, merged_from=list(p["merged_from"])) for p in picks]
    while True:
        small = [p for p in picks if p["weight_pct"] < sel["min_weight_pct"]]
        if not small and len(picks) <= sel["max_funds"]:
            break
        victim = min(small or picks, key=lambda p: (p["weight_pct"], p["scheme_code"]))
        rest = [p for p in picks if p is not victim]
        if not rest:
            break
        target = None
        for pref in sel.get("merge_prefer", {}).get(victim["cat"], []):
            target = next((p for p in rest if p["cat"] == pref), None)
            if target:
                break
        same = [p for p in rest if p["sleeve"] == victim["sleeve"]]
        if target:
            same = [target]
        elif not same:
            fb = sel["merge_fallback"][victim["sleeve"]]
            same = [p for p in rest if p["sleeve"] == fb] or rest
        target = max(same, key=lambda p: (p["weight_pct"], p["scheme_code"]))
        target["weight_pct"] = target["weight_pct"] + victim["weight_pct"]
        target["merged_from"].append({"cat": victim["cat"], "weight_pct": victim["weight_pct"]})
        picks = rest
    return sorted(picks, key=lambda p: (-p["weight_pct"], p["scheme_code"]))


def rank_category_funds(cat: str, df: pd.DataFrame | None = None) -> list[dict]:
    """Rank all clean schemes in a category using composite score with consistency and risk."""
    from app.data.loader import eligible_funds

    base = eligible_funds() if df is None else df
    sc = load_scoring()
    ranking_weights = sc.get("category_ranking", {})
    weights = ranking_weights.get("income" if is_income_category(cat) else "growth")
    pool = candidate_pool(base, cat, custom_weights=weights)
    out: list[dict] = []
    for rank, (_, row) in enumerate(pool.iterrows(), start=1):
        d = _pick_to_dict(row, cat, 0.0, "")
        d["rank"] = rank
        out.append(d)
    return out

