from __future__ import annotations
"""FH score engine: five filters (+ optional drawdown), penalties, a consistency adjustment, 0-100 score, 1-5 rating.

Everything is deterministic and vectorised over the screener frame. Scoring is kept apart from presentation: the screener
calls `score_frame`, the explain endpoint calls `explain_row`. All tunables live in DEFAULT_CONFIG (override per key in
data/fh_score_config.json; weights must total 100 for the active filter set).

Rules that are NOT confirmed business definitions are listed in PROVISIONAL and surfaced in the UI.
Missing data never scores as a value and is never redistributed: a missing component earns 0 points, coverage reports it.
"""

import copy
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

CONFIG_FILE = Path(__file__).resolve().parent.parent / "data" / "fh_score_config.json"
PERIODS = (1, 3, 5)

DEFAULT_CONFIG: dict[str, Any] = {
    "drawdown_enabled": False,
    # Filter 1 and 2 stay at 20 each; the other 60 is split across the remaining enabled filters (proposed defaults).
    "weights_off": {"history": 20, "quartile": 20, "ratios": 25, "outperf": 20, "excess": 15},
    "weights_on": {"history": 20, "quartile": 20, "ratios": 20, "outperf": 15, "excess": 15, "drawdown": 10},
    "period_weights": {"1": 0.2, "3": 0.4, "5": 0.4},
    # Filter 1. Owner delegated the choice (2026-10-28): manager tenure >= 3y and fund age >= 5y. Set confirmed false to block auto-recommendation.
    "history": {"confirmed": True, "manager_tenure_years": 3.0, "fund_history_years": 5.0},
    # Filter 2. Preference order is intentional: Q2/Q3 best, Q1 lower, Q4 lowest.
    "quartile": {
        "points": {"1": 0.6, "2": 1.0, "3": 1.0, "4": 0.0},
        "period_weights": {"ytd": 0.25, "py1": 0.375, "py2": 0.375},
        "full_credit_qualifying_periods": 2,
    },
    # Filter 3, scored against category peers (fh_catscore). Component weights: capture > sortino > sharpe.
    # mode "A" = category percentile only; "B" = A plus a bounded bonus for Sharpe/Sortino above the absolute threshold.
    "ratios": {
        "component_weights_off": {"capture": 0.5, "sortino": 0.3, "sharpe": 0.2},
        "component_weights_on": {"capture": 0.4, "sortino": 0.35, "sharpe": 0.25},
        "mode": "B",
    },
    "catscore": {},  # overrides for fh_catscore.DEFAULTS (min_peers, bonus_fraction, thresholds, ...)
    "drawdown": {"band": 0.5, "min_peers": 5},
    "outperf": {"tie_passes": False},
    "excess": {"sigma_span": 1.5, "min_peers": 5},
    "penalties": {"per_failure": {"outperf": 1.5}, "escalation": 1.25},
    "consistency": {"strong": 0.7, "weak": 0.4, "bonus_per_strong_beyond_two": 1.5, "bonus_cap": 5.0,
                    "penalty_per_weak": 2.0, "penalty_cap": 8.0},
    "flags": {"outstanding_score": 90, "poor_score": 40, "concentration_share": 0.7, "inconsistent_spread": 0.6},
    "min_filter_coverage": 0.5,
    "recommend": {"threshold": 80, "min_coverage": 0.8, "plans": ["Regular"], "auto_enabled": False},  # auto_enabled: score alone may add funds to the FH list
    "rating_bands": [80, 65, 50, 35],  # score above each -> 5, 4, 3, 2 stars; else 1
    "rating_min_coverage": 0.6,
    # Provisional Buy/Hold/Sell signal mapping based on star rating.
    "signals": {
        "provisional": True,
        "buy_ratings": [4, 5],
        "hold_ratings": [3],
        "sell_ratings": [1, 2],
        "min_coverage": 0.6,
    },
}

PROVISIONAL = [
    "Filter 1 (fund manager and history): the source's two history criteria and the '20+3' example are undefined. The owner delegated the call, so the working definition is manager tenure >= 3 years and fund history >= 5 years (`history.confirmed` is true). Change both in config if the source meant something else.",
    "Filter weights beyond history 20 and quartile 20 (ratios 25, outperformance 20, excess 15; with drawdown 20/15/15/10) are proposed defaults.",
    "Quartile points (Q2/Q3 1.0, Q1 0.6, Q4 0), period weights and 'two qualifying periods = full credit' are proposed defaults.",
    "Risk ratios (Sharpe, Sortino, capture) are scored by percentile against eligible peers in the same category and plan; mode B adds a bounded bonus for Sharpe or Sortino above 1.0. Down-capture of zero or less is not scored.",
    "Benchmark returns come from the passive index fund that tracks each category's benchmark (no TRI series is ingested); categories without one cannot be compared to a benchmark.",
    "Max drawdown uses the 3-year figure only (the only window present for every fund) against the category + plan average.",
    "Penalties, the consistency adjustment, flag thresholds, rating bands and the 80 / 80% coverage recommendation gate are proposed defaults.",
    "Equal returns count as a failed comparison (strict 'beats').",
    "Provisional Buy/Hold/Sell signal mapping (implementation assumption): 5 or 4 stars -> Buy, 3 stars -> Hold, 2 or 1 star -> Sell. Missing ratings, unsupported categories, or data coverage < 60% show Needs review.",
]

FILTERS = {  # key -> (label, short description)
    "history": "Fund manager and fund history", "quartile": "Quartile consistency", "ratios": "Risk-adjusted ratios",
    "outperf": "Benchmark and category outperformance", "excess": "Magnitude of excess returns", "drawdown": "Maximum drawdown vs category",
}


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def active_weights(cfg: dict) -> dict[str, float]:
    return cfg["weights_on" if cfg["drawdown_enabled"] else "weights_off"]


def validate_config(cfg: dict) -> None:
    if cfg["ratios"].get("mode", "B") not in ("A", "B"):
        raise ValueError("ratios.mode must be A or B")
    for name in ("weights_off", "weights_on"):
        if abs(sum(cfg[name].values()) - 100) > 1e-6:
            raise ValueError(f"{name} must total 100 (got {sum(cfg[name].values())})")
    if cfg["weights_off"]["history"] != cfg["weights_on"]["history"]:
        raise ValueError("history weight must not change when drawdown is toggled")


def load_config() -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            cfg = _merge(cfg, json.loads(CONFIG_FILE.read_text()))
        except (OSError, ValueError):
            pass
    if cfg["ratios"].get("mode") not in ("A", "B"):
        cfg["ratios"]["mode"] = "B"  # the old absolute-threshold mode no longer exists
    validate_config(cfg)
    return cfg


def save_config(patch: dict) -> dict:
    """Persist a partial override; rejects it (nothing written) if the merged weights stop totalling 100."""
    current = _merge(DEFAULT_CONFIG, json.loads(CONFIG_FILE.read_text())) if CONFIG_FILE.exists() else copy.deepcopy(DEFAULT_CONFIG)
    merged = _merge(current, patch)
    validate_config(merged)
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    stored = _merge(json.loads(CONFIG_FILE.read_text()) if CONFIG_FILE.exists() else {}, patch)
    CONFIG_FILE.write_text(json.dumps(stored, indent=2))
    return merged


def _c(s: pd.Series, lo: float = 0.0, hi: float = 1.0) -> pd.Series:
    return s.clip(lo, hi)


def _escalate(n: pd.Series, per: float, exponent: float) -> pd.Series:
    """Penalty points for n failures: per * n**exponent, so each extra failure costs more than the last."""
    return per * n.pow(exponent)


# --- filters: each returns (raw 0..1 with missing = 0 points, coverage 0..1) --------------------------------------------

def _f_history(df: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series]:
    h = cfg["history"]
    a = _c(df["manager_tenure_years"] / h["manager_tenure_years"])
    b = _c(df["history_years"] / h["fund_history_years"])
    df["fhd_hist_mgr"], df["fhd_hist_age"] = a, b
    return (a.fillna(0) + b.fillna(0)) / 2, (a.notna().astype(float) + b.notna().astype(float)) / 2


def _f_quartile(df: pd.DataFrame, cfg: dict, ref: pd.Timestamp) -> tuple[pd.Series, pd.Series]:
    q = cfg["quartile"]
    pw = q["period_weights"]
    total = sum(pw.values())
    qual = pd.Series(0, index=df.index)
    raw = pd.Series(0.0, index=df.index)
    cov = pd.Series(0.0, index=df.index)
    for key, col in (("ytd", "cal_q_ytd"), ("py1", "cal_q_py1"), ("py2", "cal_q_py2")):
        v = pd.to_numeric(df[col], errors="coerce")
        pts = v.map(lambda x: q["points"].get(str(int(x))) if pd.notna(x) else np.nan)
        df[f"fhd_q_{key}"], df[f"fhd_qp_{key}"] = v, pts
        raw += pts.fillna(0) * pw[key] / total
        cov += v.notna() * pw[key] / total
        qual += v.isin((2, 3)).astype(int)
        # A period before the current manager's start is flagged, never silently credited to them.
        year = ref.year - {"ytd": 0, "py1": 1, "py2": 2}[key]
        age = (ref - pd.Timestamp(year=year, month=1, day=1)).days / 365.25
        df[f"fhd_qpre_{key}"] = df["manager_tenure_years"].lt(age) & v.notna()
    df["fhd_q_qual"] = qual
    raw = raw.where(qual < q["full_credit_qualifying_periods"], 1.0)
    return raw.clip(0, 1), cov


def _f_ratios(df: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series]:
    from app.backoffice import fh_catscore

    return fh_catscore.ratios_filter(df, cfg, cfg["ratios"].get("mode", "B"))


def _bench_returns(df: pd.DataFrame, col: str) -> pd.Series:
    from app.backoffice.mf_screener import BENCHMARK_PROXY

    by_code = df.drop_duplicates("code").set_index("code")[col]
    return df["cat"].map(BENCHMARK_PROXY).map(by_code)


_RET = {1: ("ret_1y", "ret_1y_cat"), 3: ("cagr_3y", "cagr_3y_cat"), 5: ("cagr_5y", "cagr_5y_cat")}


def _f_outperf(df: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series, pd.Series]:
    tie = cfg["outperf"]["tie_passes"]
    passes = pd.Series(0, index=df.index)
    avail = pd.Series(0, index=df.index)
    fails = pd.Series(0, index=df.index)
    for y, (col, cat_col) in _RET.items():
        fund = pd.to_numeric(df[col], errors="coerce")
        for name, ref in (("bench", _bench_returns(df, col)), ("cat", pd.to_numeric(df[cat_col], errors="coerce"))):
            ok = (fund >= ref) if tie else (fund > ref)
            have = fund.notna() & ref.notna()
            df[f"fhd_{name}_ret_{y}"], df[f"fhd_{name}_beat_{y}"] = ref, ok.where(have)
            passes += (have & ok).astype(int)
            fails += (have & ~ok).astype(int)
            avail += have.astype(int)
    return passes / 6, avail / 6, fails


def _f_excess(df: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series]:
    e = cfg["excess"]
    pw = {int(k): v for k, v in cfg["period_weights"].items()}
    key = df["cat"] + "|" + df["plan"]
    raw = pd.Series(0.0, index=df.index)
    cov = pd.Series(0.0, index=df.index)
    for y, (col, cat_col) in _RET.items():
        fund = pd.to_numeric(df[col], errors="coerce")
        excess = fund - pd.to_numeric(df[cat_col], errors="coerce")
        sigma = fund.groupby(key).transform("std").where(fund.groupby(key).transform("count") >= e["min_peers"])
        s = _c(0.5 + 0.5 * excess / (e["sigma_span"] * sigma))
        df[f"fhd_exc_{y}"], df[f"fhd_excs_{y}"] = excess, s
        raw += s.fillna(0) * pw[y]
        cov += s.notna() * pw[y]
    return raw.clip(0, 1), cov


def _f_drawdown(df: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series]:
    d = cfg["drawdown"]
    mag = pd.to_numeric(df["max_dd_3y"], errors="coerce").abs()  # drawdowns are stored negative; compare magnitudes
    key = df["cat"] + "|" + df["plan"]
    cat_mag = mag.groupby(key).transform("mean").where(mag.groupby(key).transform("count") >= d["min_peers"])
    s = _c(0.5 + 0.5 * (cat_mag - mag) / (cat_mag * d["band"])).where(cat_mag.gt(0))
    df["fhd_dd_mag"], df["fhd_dd_cat"] = mag, cat_mag
    return s.fillna(0), s.notna().astype(float)


# --- combine ------------------------------------------------------------------------------------------------------------

def score_frame(df: pd.DataFrame, cfg: dict | None = None, ref: pd.Timestamp | None = None) -> pd.DataFrame:
    """Adds fh_* (shown) and fhd_* (detail, for explain) columns. `df` needs the screener frame's columns."""
    cfg = cfg or load_config()
    ref = ref if ref is not None else pd.Timestamp.today().normalize()
    w = active_weights(cfg)
    raws: dict[str, pd.Series] = {}
    covs: dict[str, pd.Series] = {}
    raws["history"], covs["history"] = _f_history(df, cfg)
    raws["quartile"], covs["quartile"] = _f_quartile(df, cfg, ref)
    raws["ratios"], covs["ratios"] = _f_ratios(df, cfg)
    raws["outperf"], covs["outperf"], fail_out = _f_outperf(df, cfg)
    raws["excess"], covs["excess"] = _f_excess(df, cfg)
    if "drawdown" in w:
        raws["drawdown"], covs["drawdown"] = _f_drawdown(df, cfg)

    pts = pd.DataFrame({k: raws[k] * w[k] for k in w})
    for k in w:
        df[f"fh_{k}_raw"], df[f"fh_{k}_pts"], df[f"fh_{k}_cov"] = raws[k], pts[k], covs[k]
    base = pts.sum(axis=1)

    pen = cfg["penalties"]
    pen_parts = {"outperf": _escalate(fail_out, pen["per_failure"]["outperf"], pen["escalation"])}  # ratio weakness is already priced into its percentile
    for k, v in pen_parts.items():
        df[f"fh_pen_{k}"] = -v
    penalties = -sum(pen_parts.values())

    # Consistency adjustment over filters that have data: reward breadth of strength, penalise weak later filters.
    cc = cfg["consistency"]
    scored = [k for k in w if covs[k].gt(0).any()]
    raw_df = pd.DataFrame({k: raws[k].where(covs[k] >= cfg["min_filter_coverage"]) for k in scored})
    strong = raw_df.ge(cc["strong"]).sum(axis=1)
    weak = raw_df.drop(columns=["history"], errors="ignore").lt(cc["weak"]).sum(axis=1)
    bonus = (cc["bonus_per_strong_beyond_two"] * (strong - 2).clip(lower=0)).clip(upper=cc["bonus_cap"])
    malus = (cc["penalty_per_weak"] * weak).clip(upper=cc["penalty_cap"])
    adj = bonus - malus
    df["fh_adj_bonus"], df["fh_adj_malus"] = bonus, -malus
    df["fh_base"], df["fh_penalties"], df["fh_adj"] = base, penalties, adj

    cov_total = sum(covs[k] * w[k] for k in w) / 100
    final = (base + penalties + adj).clip(0, 100)
    df["fh_coverage"] = cov_total
    df["fh_score"] = final.round(1).where(cov_total >= 0.3)

    bands = cfg["rating_bands"]
    rating = pd.Series(np.select([final > b for b in bands], [5, 4, 3, 2], 1), index=df.index, dtype="float")
    df["fh_rating"] = rating.where(df["fh_score"].notna() & (cov_total >= cfg["rating_min_coverage"]))

    # Flags and recommendation blockers
    fl = cfg["flags"]
    top2 = pts.apply(lambda r: r.nlargest(2).sum(), axis=1)
    share = (top2 / base.where(base > 0)).fillna(0)
    spread = raw_df.max(axis=1) - raw_df.min(axis=1)
    insufficient = pd.DataFrame({k: covs[k] < cfg["min_filter_coverage"] for k in w})
    flag_cols = {
        "outstanding": df["fh_score"].ge(fl["outstanding_score"]) & (cov_total >= cfg["recommend"]["min_coverage"]),
        "poor": df["fh_score"].lt(fl["poor_score"]),
        "concentrated": share.ge(fl["concentration_share"]) & base.gt(20) & (len(w) > 2),
        "inconsistent": spread.ge(fl["inconsistent_spread"]),
        "missing_data": cov_total < 0.999,
        "outperf_fail": fail_out > 0,
        "history_unconfirmed": pd.Series(not cfg["history"]["confirmed"], index=df.index),
        "pre_manager": df[["fhd_qpre_ytd", "fhd_qpre_py1", "fhd_qpre_py2"]].any(axis=1),
    }
    flags = pd.DataFrame(flag_cols)
    df["fh_flags"] = [[c for c in flags.columns if r[c]] for _, r in flags.iterrows()] if len(df) else []
    rec = cfg["recommend"]
    blockers: list[list[str]] = []
    for i in range(len(df)):
        b = []
        s = df["fh_score"].iat[i]
        if pd.isna(s) or s < rec["threshold"]:
            b.append("score_below_threshold")
        if cov_total.iat[i] < rec["min_coverage"]:
            b.append("coverage_below_minimum")
        if insufficient.iloc[i].any():
            b.append("filter_insufficient:" + ",".join(insufficient.columns[insufficient.iloc[i]]))
        if not cfg["history"]["confirmed"]:
            b.append("history_criteria_unconfirmed")
        if df["plan"].iat[i] not in rec["plans"]:
            b.append("plan_not_offered")
        if df["quality"].iat[i] != "ok":
            b.append("data_quality")
        blockers.append(b)
    df["fh_blockers"] = blockers
    df["fh_auto"] = [not b for b in blockers]

    min_cov = cfg.get("signals", {}).get("min_coverage", cfg["rating_min_coverage"])
    df["fh_signal"] = [signal_for_rating(r, c, min_cov) for r, c in zip(df["fh_rating"], cov_total)]
    df["fh_signal_reasons"] = [generate_signal_reasons(row, sig, cfg=cfg) for (_, row), sig in zip(df.iterrows(), df["fh_signal"])]
    df["fh_data_status"], df["fh_data_reason"] = _data_status(df, cfg, cov_total)
    df["fh_review_status"] = [_review_status(d, s, g) for d, s, g in zip(df["fh_data_status"], df["fh_rating"], df["fh_flags"])]
    df["fh_scoring_mode"] = cfg["ratios"].get("mode", "B")
    return df.copy()  # defragment the many columns added above


DATA_STATUS_TEXT = {
    "complete": "All inputs present and current.",
    "partial": "Some inputs are missing; the score covers only part of the model.",
    "insufficient_history": "The fund is too young for the 3-year window; metrics that need it do not exist yet.",
    "missing_series": "The fund is old enough but its 3-year metrics are absent: the NAV, benchmark or capture series is missing or failed to compute.",
    "insufficient_peers": "Too few comparable category peers to compute a category-relative figure.",
    "stale_or_bad_data": "NAV data is stale, adjusted unreliably or flagged by quality checks.",
}
MIN_3Y_HISTORY = 3.1  # same cut-off the screening coverage check uses for 3Y metrics


def _data_status(df: pd.DataFrame, cfg: dict, cov_total: pd.Series) -> tuple[list[str], list[str]]:
    """Machine-readable data status (separate from performance). Precedence: quality > history > series > peers > partial."""
    have3 = df["sharpe_3y"].notna() & df["cagr_3y"].notna()
    from app.backoffice import fh_catscore

    peers = fh_catscore.peer_count(df, "sharpe_3y")
    out = []
    for i in range(len(df)):
        if df["quality"].iat[i] not in ("ok", "split_adjusted"):
            s = "stale_or_bad_data"
        elif not have3.iat[i]:
            s = "insufficient_history" if (df["history_years"].iat[i] or 0) < MIN_3Y_HISTORY else "missing_series"
        elif peers.iat[i] < cfg.get("catscore", {}).get("min_peers", 5):
            s = "insufficient_peers"
        elif cov_total.iat[i] < 0.999:
            s = "partial"
        else:
            s = "complete"
        out.append(s)
    return out, [DATA_STATUS_TEXT[s] for s in out]


def _review_status(data_status: str, rating: float, flags: list) -> str:
    """Investment review is triggered by evidence of weak performance only; incomplete data is its own status."""
    if data_status in ("insufficient_history", "missing_series", "insufficient_peers", "stale_or_bad_data"):
        return "data_incomplete"
    weak = (not pd.isna(rating) and rating <= 2) or "poor" in flags
    return "investment_review_required" if weak else "none"


def status(auto: bool, score: float | None, blockers: list[str], includes: set[str], excludes: set[str], code: str) -> str:
    if code in excludes:
        return "manual_exclude"
    if code in includes:
        return "manual_include"
    if auto:
        return "auto"
    if score is not None and not pd.isna(score) and blockers and blockers[0] != "score_below_threshold":
        return "blocked"
    return "none"


# --- explanations -------------------------------------------------------------------------------------------------------

FLAG_TEXT = {
    "outstanding": "Outstanding: score at or above the outstanding threshold with enough data behind it.",
    "poor": "Poor: score below the poor-performance threshold.",
    "concentrated": "Concentrated: two filters supply most of the points, so the score leans on one or two strengths.",
    "inconsistent": "Inconsistent: the highest and lowest filter scores differ widely.",
    "missing_data": "Missing data: some inputs were unavailable. They earned no points; weight was not redistributed.",
    "outperf_fail": "The fund failed at least one of the six benchmark / category comparisons (penalty applied).",
    "history_unconfirmed": "History criteria are provisional placeholders, so automatic recommendation is blocked.",
    "pre_manager": "A quartile period predates the current manager, so that result is not credited to them.",
}
BLOCKER_TEXT = {
    "score_below_threshold": "Score is below the auto-shortlist threshold.",
    "coverage_below_minimum": "Data coverage is below the minimum for automatic inclusion.",
    "history_criteria_unconfirmed": "History criteria are not confirmed yet.",
    "plan_not_offered": "Only Regular plans are offered.",
    "data_quality": "NAV data quality is not clean.",
}


def _n(v: Any) -> float | None:
    return float(v) if v is not None and not pd.isna(v) else None


def _b(v: Any) -> bool | None:
    return None if v is None or pd.isna(v) else bool(v)


def signal_for_rating(rating: float | int | None, coverage: float | None = None, min_coverage: float = 0.6) -> str:
    """Provisional star rating to internal Buy/Hold/Sell signal mapping.

    Mapping assumption:
    - 5 or 4 stars: Buy
    - 3 stars: Hold
    - 2 or 1 star: Sell
    - Missing rating, coverage < min_coverage, or unverified: Needs review
    """
    if rating is None or pd.isna(rating):
        return "Needs review"
    if coverage is not None and not pd.isna(coverage) and coverage < min_coverage:
        return "Needs review"
    try:
        r = int(round(float(rating)))
    except (ValueError, TypeError):
        return "Needs review"
    if r in (4, 5):
        return "Buy"
    if r == 3:
        return "Hold"
    if r in (1, 2):
        return "Sell"
    return "Needs review"


def generate_signal_reasons(row: Any, signal: str | None = None, cfg: dict | None = None) -> list[str]:
    """Generate 2-3 concise, evidence-based bullet reasons for the signal.

    Derived deterministically from the fund's own numbers and its category peers.
    """
    cfg = cfg or load_config()
    min_cov = cfg.get("signals", {}).get("min_coverage", cfg.get("rating_min_coverage", 0.6))
    score = _n(row.get("fh_score")) if hasattr(row, "get") else None
    rating = _n(row.get("fh_rating")) if hasattr(row, "get") else None
    cov = _n(row.get("fh_coverage")) if hasattr(row, "get") else None
    cat_label = str((row.get("cat_label") if hasattr(row, "get") else None) or (row.get("cat") if hasattr(row, "get") else None) or "category")
    reasons: list[str] = []

    if signal is None:
        signal = signal_for_rating(rating, cov, min_cov)

    if signal == "Needs review":
        if cov is not None and cov < min_cov:
            reasons.append(f"Screening data coverage ({cov*100:.0f}%) is below the {min_cov*100:.0f}% minimum threshold for reliable scoring.")
        elif rating is None:
            reasons.append("Insufficient 3-year performance or peer history to establish a star rating.")
        blockers = row.get("fh_blockers") if hasattr(row, "get") else []
        if isinstance(blockers, list) and blockers:
            b_txt = BLOCKER_TEXT.get(blockers[0].split(":")[0], blockers[0])
            reasons.append(f"Screening flag: {b_txt}")
        if not reasons:
            reasons.append("Requires manual staff verification of fund track record and data inputs.")
        return reasons[:3]

    # For Buy / Hold / Sell:
    # 1. Performance vs Category
    out_3y = _n(row.get("out_3y")) if hasattr(row, "get") else None
    cagr_3y = _n(row.get("cagr_3y")) if hasattr(row, "get") else None
    if out_3y is not None:
        if out_3y >= 1.0:
            reasons.append(f"3Y CAGR (+{out_3y:.1f}pp) outperforms {cat_label} category average.")
        elif out_3y <= -1.0:
            reasons.append(f"3Y CAGR ({out_3y:+.1f}pp) trails {cat_label} category average.")
        else:
            reasons.append(f"3Y CAGR ({out_3y:+.1f}pp) performs in line with {cat_label} peers.")
    elif cagr_3y is not None:
        reasons.append(f"3Y CAGR delivered {cagr_3y:.1f}%.")

    # 2. Risk and reward against the category (3Y): the strongest-ranked measure, or the weakest if none stands out
    def pct(m):
        return _n(row.get(f"fhc_{m}_3_pct")) if hasattr(row, "get") else None

    measured = {m: (pct(m), _n(row.get(f"fhc_{m}_3")), _n(row.get(f"fhc_{m}_3_avg"))) for m in ("sortino", "sharpe")}
    measured = {m: v for m, v in measured.items() if None not in v}
    if measured:
        m, (pc, val, avg) = max(measured.items(), key=lambda kv: kv[1][0])
        word = "above" if val > avg else "below"
        reasons.append(f"{m.title()} 3Y of {val:.2f} is {word} the {cat_label} average of {avg:.2f}.")
    else:
        up, dn = _n(row.get("fhc_cap_up_3")) if hasattr(row, "get") else None, _n(row.get("fhc_cap_down_3")) if hasattr(row, "get") else None
        up_avg, dn_avg = (_n(row.get("fhc_cap_up_3_avg")), _n(row.get("fhc_cap_down_3_avg"))) if hasattr(row, "get") else (None, None)
        if None not in (up, dn, up_avg, dn_avg):
            reasons.append(f"Captures {up:.2f}x of rising markets and {dn:.2f}x of falling ones; the category averages {up_avg:.2f}x and {dn_avg:.2f}x.")

    # 3. Manager track record / Quartile consistency / Max Drawdown
    mgr_tenure = _n(row.get("manager_tenure_years")) if hasattr(row, "get") else None
    q_ytd = _n(row.get("cal_q_ytd")) if hasattr(row, "get") else None
    q_py1 = _n(row.get("cal_q_py1")) if hasattr(row, "get") else None
    if mgr_tenure is not None and mgr_tenure >= 3.0:
        reasons.append(f"Lead fund manager tenure of {mgr_tenure:.1f} years provides stability (target >= 3.0y).")
    elif q_py1 is not None and q_ytd is not None and int(q_py1) <= 2 and int(q_ytd) <= 2:
        reasons.append(f"Consistent top-half calendar returns (Q{int(q_py1)} prior year, Q{int(q_ytd)} YTD).")
    elif q_py1 is not None and int(q_py1) == 4:
        reasons.append("Ranked in bottom quartile (Q4) during the previous calendar year.")
    elif mgr_tenure is not None and mgr_tenure < 1.0:
        reasons.append(f"Recent manager change with only {mgr_tenure:.1f} years tenure.")

    if len(reasons) < 2 and score is not None:
        reasons.append(f"Composite FH screening score is {score:.1f}/100 based on verified metrics.")

    return reasons[:3]


def explain_row(r: pd.Series, cfg: dict | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    w = active_weights(cfg)
    comps: dict[str, list[dict]] = {
        "history": [
            {"label": f"Manager tenure (years, target {cfg['history']['manager_tenure_years']:g})", "value": _n(r["manager_tenure_years"]), "score": _n(r["fhd_hist_mgr"])},
            {"label": f"Fund history (years, target {cfg['history']['fund_history_years']:g})", "value": _n(r["history_years"]), "score": _n(r["fhd_hist_age"])},
        ],
        "quartile": [
            {"label": {"ytd": "Year to date", "py1": "Previous calendar year", "py2": "Calendar year before"}[k], "value": _n(r[f"fhd_q_{k}"]),
             "score": _n(r[f"fhd_qp_{k}"]), "note": "Predates current manager" if _b(r[f"fhd_qpre_{k}"]) else None}
            for k in ("ytd", "py1", "py2")
        ],
        "ratios": [],  # filled from the category-relative breakdown below
        "outperf": [
            {"label": f"{y}Y vs {'benchmark' if n == 'bench' else 'category average'}", "value": _n(r[f"fhd_{n}_ret_{y}"]), "pass": _b(r[f"fhd_{n}_beat_{y}"])}
            for y in PERIODS for n in ("bench", "cat")
        ],
        "excess": [{"label": f"{y}Y excess vs category (pp)", "value": _n(r[f"fhd_exc_{y}"]), "score": _n(r[f"fhd_excs_{y}"])} for y in PERIODS],
        "drawdown": [{"label": "3Y max drawdown vs category average (magnitude, %)", "value": _n(r["fhd_dd_mag"]), "score": _n(r["fhd_dd_cat"]), "note": "score column = category average magnitude"}] if "drawdown" in w else [],
    }
    from app.backoffice import fh_catscore

    mode = cfg["ratios"].get("mode", "B")
    comps["ratios"] = fh_catscore.breakdown(r, cfg, mode, w["ratios"], r.get("nav_date"))
    filters = []
    for k, weight in w.items():
        cov = _n(r[f"fh_{k}_cov"])
        filters.append({
            "key": k, "label": FILTERS[k], "weight": weight, "raw": _n(r[f"fh_{k}_raw"]), "points": _n(r[f"fh_{k}_pts"]), "coverage": cov,
            "status": "insufficient" if cov is not None and cov < cfg["min_filter_coverage"] else ("unconfigured" if k == "history" and not cfg["history"]["confirmed"] else "ok"),
            "components": comps[k],
        })
    flags = list(r["fh_flags"])
    sig = r.get("fh_signal") or signal_for_rating(_n(r.get("fh_rating")), _n(r.get("fh_coverage")), cfg["rating_min_coverage"])
    sig_reasons = list(r.get("fh_signal_reasons") or generate_signal_reasons(r, sig, cfg=cfg))
    return {
        "score": _n(r["fh_score"]), "rating": _n(r["fh_rating"]), "coverage": _n(r["fh_coverage"]),
        "signal": sig, "signal_reasons": sig_reasons,
        "base": _n(r["fh_base"]), "penalties": [{"key": "outperf", "points": _n(r["fh_pen_outperf"])}],
        "penalty_total": _n(r["fh_penalties"]),
        "adjustment": {"bonus": _n(r["fh_adj_bonus"]), "malus": _n(r["fh_adj_malus"]), "total": _n(r["fh_adj"])},
        "filters": filters, "drawdown_enabled": cfg["drawdown_enabled"],
        "flags": [{"code": f, "text": FLAG_TEXT[f]} for f in flags],
        "blockers": [{"code": b, "text": BLOCKER_TEXT.get(b.split(":")[0], b)} for b in r["fh_blockers"]],
        "auto_eligible": bool(r["fh_auto"]),
        "scoring_mode": mode, "data_status": r.get("fh_data_status"), "data_status_text": r.get("fh_data_reason"),
        "review_status": r.get("fh_review_status"),
        "provisional": PROVISIONAL + ["Beta and Treynor are shown but not scored: the dataset measures them against the category median, not an index."],
    }
