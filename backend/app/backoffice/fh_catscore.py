from __future__ import annotations
"""Category-relative risk-metric scoring (the "ratios" filter) and the peer-universe rules behind it.

Mode "A": each valid metric earns points by its favourable percentile among comparable category peers.
Mode "B": mode A plus a bounded absolute-quality bonus on Sharpe and Sortino only (threshold is a business rule, not a truth).
Mode "legacy" (default until the side-by-side report is signed off): the original absolute-threshold scoring in fh_score.

Peer universe = same canonical category + same plan (Direct vs Regular), open-ended, clean NAV data, one row per ISIN
(Growth only in this dataset, so IDCW options never double-count). The category average is the equal-weight arithmetic mean of
fund-level values over that universe and INCLUDES the subject fund (one documented policy). Every exclusion keeps its reason.
All metrics come from one builder (data/fundhorizon_mf_rag_dataset/build_dataset.py): same window, monthly NAV, rf 6.5%.
"""

import numpy as np
import pandas as pd

VERSION = "catscore-1"
PERIODS = (1, 3, 5)
METHODOLOGY = ("Sharpe/Sortino: trailing-window CAGR less 6.5% risk-free over annualised volatility / downside deviation. "
               "Capture: Advisorkhoj up/down capture (%, 100% = 1.0). Beta/Treynor: vs the category+plan median daily return "
               "(NOT a market index). Same builder and assumptions for every fund, so values are comparable.")
CLEAN = ("ok", "split_adjusted")
# metric -> (frame column template, higher_is_better, scored)
METRICS: dict[str, tuple[str, bool, bool]] = {
    "sharpe": ("sharpe_{}y", True, True), "sortino": ("sortino_{}y", True, True),
    "cap_up": ("cap_up_{}y", True, True), "cap_down": ("cap_down_{}y", False, True),
    "treynor": ("treynor_{}y", True, False), "beta": ("beta_{}y", True, False),  # informational: no preference assumed
}
DEFAULTS = {
    "min_peers": 5, "bonus_fraction": 0.15, "bonus_metrics": ["sharpe", "sortino"],
    "thresholds": {"sharpe": 1.0, "sortino": 1.0}, "capture_max_pct": 300.0, "min_beta_for_treynor": 0.3,
}


def settings(cfg: dict) -> dict:
    return {**DEFAULTS, **cfg.get("catscore", {})}


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(np.nan, index=df.index)


def peer_eligibility(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """(eligible, exclusion reason). Reasons are kept so the UI can say why a scheme is not a peer."""
    reason = pd.Series("", index=df.index, dtype=object)
    reason = reason.mask(~df["quality"].isin(CLEAN), "data_quality:" + df["quality"].astype(str))
    if "structure" in df:
        reason = reason.mask(reason.eq("") & df["structure"].ne("Open Ended"), "not_open_ended")
    reason = reason.mask(reason.eq("") & df.duplicated(["isin", "plan"], keep="first") & df["isin"].notna(), "duplicate_scheme") if "isin" in df else reason
    return reason.eq(""), reason


def _clean_values(df: pd.DataFrame, metric: str, y: int, s: dict, eligible: pd.Series) -> tuple[pd.Series, pd.Series]:
    """(normalised value for every fund, value usable as a peer observation). Invalid -> NaN, never zero."""
    v = _num(df, METRICS[metric][0].format(y))
    if metric in ("cap_up", "cap_down"):
        v = (v / 100.0).where(v.le(s["capture_max_pct"]))  # 100% -> 1.0; absurd captures are invalid
    if metric == "cap_down":
        v = v.where(v.gt(0))  # zero / negative downside capture: undefined for ranking, flagged instead of rewarded
    if metric == "treynor":
        v = v.where(_num(df, f"beta_{y}y").abs().ge(s["min_beta_for_treynor"]))
    return v, v.where(eligible)


def category_stats(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Per fund, metric and period: value, category average, eligible-peer count, favourable percentile (mid-rank, 0..1)."""
    s = settings(cfg)
    eligible, _ = peer_eligibility(df)
    key = df["cat"] + "|" + df["plan"]
    out: dict[str, pd.Series] = {}
    for m, (_, higher, _scored) in METRICS.items():
        for y in PERIODS:
            val, peer = _clean_values(df, m, y, s, eligible)
            g = peer.groupby(key)
            n = g.transform("count")
            ok = n.ge(s["min_peers"])
            # rank so the best value gets the highest rank; ties average; percentile = (rank - 0.5) / n.
            rank = g.rank(method="average", ascending=higher)
            out[f"fhc_{m}_{y}"] = val
            out[f"fhc_{m}_{y}_avg"] = g.transform("mean").where(ok)
            out[f"fhc_{m}_{y}_n"] = n
            out[f"fhc_{m}_{y}_pct"] = ((rank - 0.5) / n).where(ok & peer.notna())
    return pd.DataFrame(out, index=df.index)


def ratios_filter(df: pd.DataFrame, cfg: dict, mode: str) -> tuple[pd.Series, pd.Series, dict[str, pd.Series]]:
    """Drop-in for fh_score._f_ratios: (raw 0..1, coverage 0..1, failures). Missing = 0 points, never redistributed."""
    s = settings(cfg)
    st = category_stats(df, cfg)
    for c in st.columns:
        df[c] = st[c]
    pw = {int(k): v for k, v in cfg["period_weights"].items()}
    cw = cfg["ratios"]["component_weights_on" if cfg["drawdown_enabled"] else "component_weights_off"]
    zero = pd.Series(0.0, index=df.index)
    comp: dict[str, list[pd.Series]] = {k: [zero.copy(), zero.copy()] for k in cw}
    for y in PERIODS:
        for name in cw:
            if name == "capture":
                parts = pd.concat([df[f"fhc_cap_up_{y}_pct"], df[f"fhc_cap_down_{y}_pct"]], axis=1)
                sc = parts.mean(axis=1).where(parts.notna().all(axis=1))  # up and down are read together
            else:
                sc = df[f"fhc_{name}_{y}_pct"]
                if mode == "B" and name in s["bonus_metrics"]:
                    above = df[f"fhc_{name}_{y}"].gt(s["thresholds"][name])
                    sc = (sc + s["bonus_fraction"] * above).clip(upper=1.0).where(sc.notna())
            df[f"fhc_score_{name}_{y}"] = sc
            comp[name][0] += sc.fillna(0) * pw[y]
            comp[name][1] += sc.notna() * pw[y]
    raw = sum(comp[k][0] * w for k, w in cw.items())
    cov = sum(comp[k][1] * w for k, w in cw.items())
    # Ratio-failure penalties are switched off here: percentile points already penalise weak ratios, so keeping them double-counts.
    return raw.clip(0, 1), cov, {k: pd.Series(0, index=df.index) for k in ("capture", "sortino", "sharpe")}


def _fmt(v: float | None) -> str:
    return "n/a" if v is None or pd.isna(v) else f"{v:.2f}"


def metric_text(name: str, value, avg, n, pct, higher: bool, thr: float | None, scored: bool, s: dict) -> str:
    """Plain-English line generated from the actual numbers."""
    if value is None or pd.isna(value):
        return "Not scored: the fund's own value is unavailable (history too short or calculation undefined)."
    if avg is None or pd.isna(avg):
        return f"Not scored because comparable peer data is unavailable ({int(n or 0)} eligible peers, minimum {s['min_peers']})."
    if not scored:
        return f"Informational only; category average {_fmt(avg)} over {int(n)} peers. No preferred direction is assumed."
    better = value > avg if higher else value < avg
    word = ("above" if value > avg else "below") if value != avg else "equal to"
    if name == "cap_down":
        base = f"{'Lower' if better else 'Higher'} downside capture than the category average ({_fmt(value)} vs {_fmt(avg)})."
    elif better:
        base = f"Above the category average on a higher-is-better measure ({_fmt(value)} vs {_fmt(avg)})."
    else:
        base = f"{word.capitalize()} the category average ({_fmt(value)} vs {_fmt(avg)}) on a higher-is-better measure." if value != avg else f"In line with the category average ({_fmt(avg)})."
    if thr is not None:
        gap = "Above the absolute threshold" if value > thr else "Below the absolute threshold"
        conn = "and" if (value > thr) == better else "but"
        base = f"{gap} ({thr:g}), {conn} {base[0].lower()}{base[1:]}"
    return base + f" Percentile among {int(n)} peers: {pct * 100:.0f}."


def breakdown(r: pd.Series, cfg: dict, mode: str, weight: float, as_of: str | None) -> list[dict]:
    """Score breakdown rows for the ratios filter (one per metric and period) generated from the frame row."""
    s = settings(cfg)
    pw = {int(k): v for k, v in cfg["period_weights"].items()}
    cw = cfg["ratios"]["component_weights_on" if cfg["drawdown_enabled"] else "component_weights_off"]
    rows: list[dict] = []
    for m, (_, higher, scored) in METRICS.items():
        comp = {"cap_up": "capture", "cap_down": "capture"}.get(m, m)
        for y in PERIODS:
            share = (cw.get(comp, 0) * (0.5 if comp == "capture" else 1.0)) if scored else 0.0
            max_pts = round(weight * pw[y] * share, 3)
            value, avg, n, pct = (r[f"fhc_{m}_{y}{x}"] for x in ("", "_avg", "_n", "_pct"))
            thr = s["thresholds"].get(m) if mode == "B" and m in s["bonus_metrics"] else None
            pts = None
            pair_ok = comp != "capture" or not r[[f"fhc_cap_up_{y}_pct", f"fhc_cap_down_{y}_pct"]].isna().any()
            if scored and not pd.isna(pct) and pair_ok:  # capture earns points only when up and down are both scored
                sc = pct
                if thr is not None and value > thr:
                    sc = min(1.0, sc + s["bonus_fraction"])
                pts = round(sc * max_pts, 3)
            rows.append({
                "metric": m, "period": f"{y}Y", "value": None if pd.isna(value) else float(value),
                "category_average": None if pd.isna(avg) else float(avg), "peer_count": int(n) if not pd.isna(n) else 0,
                "direction": "higher_is_better" if higher else "lower_is_better", "scored": scored,
                "percentile": None if pd.isna(pct) else round(float(pct), 3), "absolute_threshold": thr,
                "points": pts, "max_points": max_pts, "coverage": 0.0 if pts is None and scored else 1.0,
                "as_of": as_of, "text": metric_text(m, value, avg, n, pct, higher, thr, scored, s),
            })
    return rows
