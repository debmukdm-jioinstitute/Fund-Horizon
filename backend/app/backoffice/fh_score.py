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
    # Filter 3. Component weights: capture > sortino > sharpe. Lower capture/sortino/sharpe weights apply with drawdown on.
    "ratios": {
        "component_weights_off": {"capture": 0.5, "sortino": 0.3, "sharpe": 0.2},
        "component_weights_on": {"capture": 0.4, "sortino": 0.35, "sharpe": 0.25},
        "capture_threshold": 1.0, "capture_full": 1.5,
        "sortino_threshold": 1.5, "sortino_full": 3.0,
        "sharpe_threshold": 1.0, "sharpe_full": 2.0,
    },
    "drawdown": {"band": 0.5, "min_peers": 5},
    "outperf": {"tie_passes": False},
    "excess": {"sigma_span": 1.5, "min_peers": 5},
    "penalties": {"per_failure": {"sortino": 2.0, "sharpe": 1.5, "capture": 0.0, "outperf": 1.5}, "escalation": 1.25},
    "consistency": {"strong": 0.7, "weak": 0.4, "bonus_per_strong_beyond_two": 1.5, "bonus_cap": 5.0,
                    "penalty_per_weak": 2.0, "penalty_cap": 8.0},
    "flags": {"outstanding_score": 90, "poor_score": 40, "concentration_share": 0.7, "inconsistent_spread": 0.6},
    "min_filter_coverage": 0.5,
    "recommend": {"threshold": 80, "min_coverage": 0.8, "plans": ["Regular"]},
    "rating_bands": [80, 65, 50, 35],  # score above each -> 5, 4, 3, 2 stars; else 1
    "rating_min_coverage": 0.6,
}

PROVISIONAL = [
    "Filter 1 (fund manager and history): the source's two history criteria and the '20+3' example are undefined. The owner delegated the call, so the working definition is manager tenure >= 3 years and fund history >= 5 years (`history.confirmed` is true). Change both in config if the source meant something else.",
    "Filter weights beyond history 20 and quartile 20 (ratios 25, outperformance 20, excess 15; with drawdown 20/15/15/10) are proposed defaults.",
    "Quartile points (Q2/Q3 1.0, Q1 0.6, Q4 0), period weights and 'two qualifying periods = full credit' are proposed defaults.",
    "Capture ratio = Advisorkhoj up-capture % divided by down-capture %; unavailable when down-capture is zero, negative or missing. Bounded: 1.0 scores 0.5, 1.5 or more scores full.",
    "Benchmark returns come from the passive index fund that tracks each category's benchmark (no TRI series is ingested); categories without one cannot be compared to a benchmark.",
    "Max drawdown uses the 3-year figure only (the only window present for every fund) against the category + plan average.",
    "Penalties, the consistency adjustment, flag thresholds, rating bands and the 80 / 80% coverage recommendation gate are proposed defaults.",
    "Equal returns count as a failed comparison (strict 'beats').",
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


def _ratio_components(df: pd.DataFrame, cfg: dict) -> dict[str, tuple[pd.Series, pd.Series, pd.Series]]:
    """Per component: (weighted score 0..1, availability weight, failure count) over the 1/3/5Y periods."""
    r = cfg["ratios"]
    pw = {int(k): v for k, v in cfg["period_weights"].items()}
    out = {k: [pd.Series(0.0, index=df.index), pd.Series(0.0, index=df.index), pd.Series(0, index=df.index)] for k in ("capture", "sortino", "sharpe")}
    for y in PERIODS:
        up, down = pd.to_numeric(df[f"cap_up_{y}y"], errors="coerce"), pd.to_numeric(df[f"cap_down_{y}y"], errors="coerce")
        ratio = (up / down).where(up.notna() & down.gt(0))  # zero / negative / missing downside capture -> undefined
        df[f"fhd_cap_{y}"] = ratio
        vals = {"capture": ratio, "sortino": pd.to_numeric(df[f"sortino_{y}y"], errors="coerce"), "sharpe": pd.to_numeric(df[f"sharpe_{y}y"], errors="coerce")}
        for name, v in vals.items():
            thr = r[f"{name}_threshold"]
            full = r[f"{name}_full"]
            ok = v > thr  # strictly greater
            score = (0.5 + 0.5 * _c((v - thr) / (full - thr))).where(ok, 0.0) if name == "capture" else _c(v / full)
            score = score.where(v.notna())
            df[f"fhd_{name}_{y}"], df[f"fhd_{name}_ok_{y}"] = v, ok.where(v.notna())
            out[name][0] += score.fillna(0) * pw[y]
            out[name][1] += v.notna() * pw[y]
            out[name][2] += (v.notna() & ~ok).astype(int)
    return {k: tuple(v) for k, v in out.items()}


def _f_ratios(df: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series, dict[str, pd.Series]]:
    comp = _ratio_components(df, cfg)
    cw = cfg["ratios"]["component_weights_on" if cfg["drawdown_enabled"] else "component_weights_off"]
    raw = sum(comp[k][0] * w for k, w in cw.items())
    cov = sum(comp[k][1] * w for k, w in cw.items())
    return raw.clip(0, 1), cov, {k: comp[k][2] for k in comp}


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
    fails_ratio: dict[str, pd.Series] = {}
    raws: dict[str, pd.Series] = {}
    covs: dict[str, pd.Series] = {}
    raws["history"], covs["history"] = _f_history(df, cfg)
    raws["quartile"], covs["quartile"] = _f_quartile(df, cfg, ref)
    raws["ratios"], covs["ratios"], fails_ratio = _f_ratios(df, cfg)
    raws["outperf"], covs["outperf"], fail_out = _f_outperf(df, cfg)
    raws["excess"], covs["excess"] = _f_excess(df, cfg)
    if "drawdown" in w:
        raws["drawdown"], covs["drawdown"] = _f_drawdown(df, cfg)

    pts = pd.DataFrame({k: raws[k] * w[k] for k in w})
    for k in w:
        df[f"fh_{k}_raw"], df[f"fh_{k}_pts"], df[f"fh_{k}_cov"] = raws[k], pts[k], covs[k]
    base = pts.sum(axis=1)

    pen = cfg["penalties"]
    pen_parts = {
        "sortino": _escalate(fails_ratio["sortino"], pen["per_failure"]["sortino"], pen["escalation"]),
        "sharpe": _escalate(fails_ratio["sharpe"], pen["per_failure"]["sharpe"], pen["escalation"]),
        "capture": _escalate(fails_ratio["capture"], pen["per_failure"]["capture"], pen["escalation"]),
        "outperf": _escalate(fail_out, pen["per_failure"]["outperf"], pen["escalation"]),
    }
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
        "sortino_fail": fails_ratio["sortino"] > 0, "sharpe_fail": fails_ratio["sharpe"] > 0,
        "capture_fail": fails_ratio["capture"] > 0, "outperf_fail": fail_out > 0,
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
    return df.copy()  # defragment the many columns added above


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
    "sortino_fail": "Sortino did not exceed the threshold in at least one period (penalty applied).",
    "sharpe_fail": "Sharpe did not exceed the threshold in at least one period (penalty applied).",
    "capture_fail": "Capture ratio did not exceed the threshold in at least one period.",
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


def explain_row(r: pd.Series, cfg: dict | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    w = active_weights(cfg)
    ratios = cfg["ratios"]
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
        "ratios": [
            {"label": f"{n.title()} {y}Y", "value": _n(r[f"fhd_{n}_{y}"]), "score": None, "pass": _b(r[f"fhd_{n}_ok_{y}"]),
             "threshold": ratios[f"{n}_threshold"]}
            for n in ("capture", "sortino", "sharpe") for y in PERIODS
        ],
        "outperf": [
            {"label": f"{y}Y vs {'benchmark' if n == 'bench' else 'category average'}", "value": _n(r[f"fhd_{n}_ret_{y}"]), "pass": _b(r[f"fhd_{n}_beat_{y}"])}
            for y in PERIODS for n in ("bench", "cat")
        ],
        "excess": [{"label": f"{y}Y excess vs category (pp)", "value": _n(r[f"fhd_exc_{y}"]), "score": _n(r[f"fhd_excs_{y}"])} for y in PERIODS],
        "drawdown": [{"label": "3Y max drawdown vs category average (magnitude, %)", "value": _n(r["fhd_dd_mag"]), "score": _n(r["fhd_dd_cat"]), "note": "score column = category average magnitude"}] if "drawdown" in w else [],
    }
    filters = []
    for k, weight in w.items():
        cov = _n(r[f"fh_{k}_cov"])
        filters.append({
            "key": k, "label": FILTERS[k], "weight": weight, "raw": _n(r[f"fh_{k}_raw"]), "points": _n(r[f"fh_{k}_pts"]), "coverage": cov,
            "status": "insufficient" if cov is not None and cov < cfg["min_filter_coverage"] else ("unconfigured" if k == "history" and not cfg["history"]["confirmed"] else "ok"),
            "components": comps[k],
        })
    flags = list(r["fh_flags"])
    return {
        "score": _n(r["fh_score"]), "rating": _n(r["fh_rating"]), "coverage": _n(r["fh_coverage"]),
        "base": _n(r["fh_base"]), "penalties": [{"key": k, "points": _n(r[f"fh_pen_{k}"])} for k in ("sortino", "sharpe", "capture", "outperf")],
        "penalty_total": _n(r["fh_penalties"]),
        "adjustment": {"bonus": _n(r["fh_adj_bonus"]), "malus": _n(r["fh_adj_malus"]), "total": _n(r["fh_adj"])},
        "filters": filters, "drawdown_enabled": cfg["drawdown_enabled"],
        "flags": [{"code": f, "text": FLAG_TEXT[f]} for f in flags],
        "blockers": [{"code": b, "text": BLOCKER_TEXT.get(b.split(":")[0], b)} for b in r["fh_blockers"]],
        "auto_eligible": bool(r["fh_auto"]),
        "provisional": PROVISIONAL,
    }
