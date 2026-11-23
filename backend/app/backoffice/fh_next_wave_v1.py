from __future__ import annotations
"""BACKUP of FH Next Wave v1 (returns-led weights, no quartile or AUM part), kept as it was on 23-11-2026. Not imported anywhere.
Restore: copy this file over fh_next_wave.py, or `git checkout next-wave-v1-backup -- backend/app/backoffice/fh_next_wave.py`.

FH Next Wave: a forward-looking screen that sits ON TOP of the FH score and never changes it.

It looks for funds whose leadership is recent, widening and steady, rather than funds that merely earned a long record.
Every score is a peer percentile inside the fund's category + plan. A missing input is dropped and the remaining weights
are re-spread (it never counts as zero), and a short history is pulled toward the middle by a confidence factor instead
of being excluded. It is a screen, not a forecast.
"""
import numpy as np
import pandas as pd

MIN_HISTORY_YEARS = 3.0  # shortcut: 3Y windows (rolling, alpha, 3Y CAGR) need 3 years; no 5-year gate. Lower it when 1-2Y signals prove predictive
MIN_PEERS = 8            # same floor as the quartile engine
CONFIDENCE_YEARS = 5     # confidence = 0.5 + 0.5 * years / 5 (capped at 1): a 3-year fund keeps 80% of its own score
PASS_SCORE = 70.0
MIN_COVERAGE = 0.6       # share of the weights that must be present

# component -> (weight, [(column, higher_is_better)]); each component is the mean percentile of its inputs
COMPONENTS: dict[str, tuple[int, list[tuple[str, bool]]]] = {
    "momentum": (30, [("ret_1y", True), ("cagr_3y", True)]),
    "acceleration": (15, [("accel_3y_5y", True)]),  # 3Y CAGR above 5Y CAGR: the fund is getting better
    "consistency": (25, [("roll_win_pct", True), ("cal_win_pct", True)]),
    "risk": (20, [("alpha_3y", True), ("sortino_3y", True), ("max_dd_3y", True)]),
    "cost": (10, [("ter", False)]),
}


def add(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of the scored frame with nw_score (0-100), nw_conf (0-1), nw_pass and the breakdown the UI shows:
    nw_pct_<input> (peer percentile 0-100), nw_pts_<part> (percentile x weight), nw_wt_avail, nw_raw, nw_peers, nw_reason."""
    key = df["cat"] + "|" + df["plan"]
    num = lambda c: pd.to_numeric(df[c], errors="coerce")  # noqa: E731
    cols = {c: num(c) for _, (_, spec) in COMPONENTS.items() for c, _ in spec if c != "accel_3y_5y"}
    cols["accel_3y_5y"] = cols["cagr_3y"] - num("cagr_5y")
    out = df.copy()
    total = pd.Series(0.0, index=df.index)
    weight = pd.Series(0.0, index=df.index)
    for name, (w, spec) in COMPONENTS.items():
        ranks = [cols[c].groupby(key).rank(pct=True, ascending=hb) for c, hb in spec]
        for (c, _), r in zip(spec, ranks):
            out[f"nw_pct_{c}"] = (r * 100).round(1)
        pct = pd.concat(ranks, axis=1).mean(axis=1)
        out[f"nw_pts_{name}"] = (pct * w).round(1)
        total += pct.fillna(0) * w
        weight += pct.notna() * w
    raw = (total / weight.where(weight > 0)) * 100
    years = num("history_years")
    conf = 0.5 + 0.5 * (years / CONFIDENCE_YEARS).clip(upper=1)
    peers = key.map(key.value_counts())
    ok = (years >= MIN_HISTORY_YEARS) & (peers >= MIN_PEERS) & (weight / 100 >= MIN_COVERAGE)
    out["nw_wt_avail"] = weight
    out["nw_raw"] = raw.round(1)
    out["nw_peers"] = peers
    out["nw_reason"] = np.select(
        [~(years >= MIN_HISTORY_YEARS), ~(peers >= MIN_PEERS), ~(weight / 100 >= MIN_COVERAGE)],
        ["Needs 3 years of history", "Fewer than 8 peers in the category and plan", "Too many inputs missing"], default="")
    out["nw_score"] = (conf * raw + (1 - conf) * 50).where(ok).round(1)
    out["nw_conf"] = conf.where(ok).round(2)
    out["nw_pass"] = (out["nw_score"] >= PASS_SCORE).fillna(False).astype(bool)
    return out.replace({np.inf: np.nan, -np.inf: np.nan})
