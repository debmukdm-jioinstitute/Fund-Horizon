from __future__ import annotations
"""FH Next Wave: a forward-looking screen that sits ON TOP of the FH score and never changes it.

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
    """Return a copy of the scored frame with nw_score (0-100), nw_conf (0-1) and nw_pass added."""
    key = df["cat"] + "|" + df["plan"]
    num = lambda c: pd.to_numeric(df[c], errors="coerce")  # noqa: E731
    cols = {c: num(c) for _, (_, spec) in COMPONENTS.items() for c, _ in spec if c != "accel_3y_5y"}
    cols["accel_3y_5y"] = cols["cagr_3y"] - num("cagr_5y")
    total = pd.Series(0.0, index=df.index)
    weight = pd.Series(0.0, index=df.index)
    for w, spec in COMPONENTS.values():
        pct = pd.concat([cols[c].groupby(key).rank(pct=True, ascending=hb) for c, hb in spec], axis=1).mean(axis=1)
        total += pct.fillna(0) * w
        weight += pct.notna() * w
    raw = (total / weight.where(weight > 0)) * 100
    conf = 0.5 + 0.5 * (num("history_years") / CONFIDENCE_YEARS).clip(upper=1)
    score = conf * raw + (1 - conf) * 50
    ok = (num("history_years") >= MIN_HISTORY_YEARS) & (key.map(key.value_counts()) >= MIN_PEERS) & (weight / 100 >= MIN_COVERAGE)
    out = df.copy()
    out["nw_score"] = score.where(ok).round(1)
    out["nw_conf"] = conf.where(ok).round(2)
    out["nw_pass"] = (out["nw_score"] >= PASS_SCORE).fillna(False).astype(bool)
    return out.replace({np.inf: np.nan, -np.inf: np.nan})
