from __future__ import annotations
"""FH Next Wave: a forward-looking screen that sits ON TOP of the FH score and never changes it.

It looks for the next multi-bagger: funds sitting in quartile 2 or 3 that are climbing, with improving, steady performance and a
fund size that still lets the manager add value. Past return size is deliberately a small part, because high returns alone would
just rank last year's winners first (v1 weights are kept in fh_next_wave_v1.py).

Most parts are peer percentiles inside the fund's category + plan. Three inputs are already 0-1 scores and are used as they are:
quartile level, quartile trend and size fit. A missing input is dropped and the remaining weights are re-spread (it never counts as
zero), and a short history is pulled toward the middle by a confidence factor instead of being excluded. A screen, not a forecast.
"""
import numpy as np
import pandas as pd

MIN_HISTORY_YEARS = 3.0  # shortcut: 3Y windows (rolling, alpha, 3Y CAGR) need 3 years; no 5-year gate. Lower it when 1-2Y signals prove predictive
MIN_PEERS = 8            # same floor as the quartile engine
CONFIDENCE_YEARS = 5     # confidence = 0.5 + 0.5 * years / 5 (capped at 1): a 3-year fund keeps 80% of its own score
PASS_SCORE = 70.0
MIN_COVERAGE = 0.6       # share of the weights that must be present

# Calendar-year quartile 1 = top quarter of the category + plan. Q2 and Q3 earn the most: they are the funds that can climb a quartile.
QUARTILE_POINTS = {1: 0.75, 2: 1.0, 3: 0.9, 4: 0.2}
QUARTILE_PERIOD_WEIGHTS = {"cal_q_ytd": 0.25, "cal_q_py1": 0.375, "cal_q_py2": 0.375}  # as in the FH score
# Fund size sweet spot in Rs crore, (low, high): inside it a fund scores 1. Small caps lose their edge when big (thin stocks), and any
# fund is a risk when tiny (closure, concentrated redemptions, high costs). Large caps can run much bigger. Others use the default.
AUM_BANDS = {"small_cap": (500, 10000), "mid_cap": (1000, 25000), "large_cap": (1000, 50000), "large_mid_cap": (1000, 30000),
             "sectoral_thematic": (300, 8000), "focused": (500, 20000), "elss": (500, 20000)}
AUM_DEFAULT = (500, 30000)
AUM_FLOOR = 0.2

# component -> (weight, [(column, higher_is_better or None when the column is already a 0-1 score)]); each component is the mean of its inputs
COMPONENTS: dict[str, tuple[int, list[tuple[str, bool | None]]]] = {
    "quartile": (35, [("q_level", None), ("q_trend", None)]),  # where the fund ranks now, and whether it is climbing
    "momentum": (10, [("ret_1y", True), ("cagr_3y", True)]),
    "acceleration": (15, [("accel_3y_5y", True)]),  # 3Y CAGR above 5Y CAGR: the fund is getting better
    "consistency": (15, [("roll_win_pct", True), ("cal_win_pct", True)]),
    "risk": (10, [("alpha_3y", True), ("sortino_3y", True), ("max_dd_3y", True)]),
    "size": (10, [("aum_fit", None)]),
    "cost": (5, [("ter", False)]),
}


def quartile_scores(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """(level, trend), both 0-1. Level: quartile points averaged over the periods present, weighted. Trend: how many quartiles the fund
    moved up between its oldest and latest period (Q4 to Q1 = 1, no move = 0.5, Q1 to Q4 = 0). Trend needs two periods."""
    q = pd.DataFrame({c: pd.to_numeric(df.get(c), errors="coerce") for c in QUARTILE_PERIOD_WEIGHTS}, index=df.index)
    w = pd.Series(QUARTILE_PERIOD_WEIGHTS)
    pts = q.apply(lambda s: s.map(QUARTILE_POINTS))
    level = (pts * w).sum(axis=1, min_count=1) / (pts.notna() * w).sum(axis=1).replace(0, np.nan)
    oldest, latest = q["cal_q_py2"].fillna(q["cal_q_py1"]), q["cal_q_ytd"].fillna(q["cal_q_py1"])
    trend = (0.5 + (oldest - latest) / 6).where(oldest.notna() & latest.notna() & (q.notna().sum(axis=1) >= 2))
    return level, trend


def aum_fit(aum: pd.Series, cat: pd.Series) -> pd.Series:
    """0.2-1 size score: 1 inside the category's sweet spot, fading linearly below it and by 0.4 per doubling above it."""
    lo = cat.map(lambda c: AUM_BANDS.get(c, AUM_DEFAULT)[0]).astype(float)
    hi = cat.map(lambda c: AUM_BANDS.get(c, AUM_DEFAULT)[1]).astype(float)
    a = pd.to_numeric(aum, errors="coerce")
    below = AUM_FLOOR + (1 - AUM_FLOOR) * (a / lo)
    above = 1 - 0.4 * np.log2(a / hi)  # twice the top of the band = 0.6, four times = 0.2
    return pd.Series(np.where(a < lo, below, np.where(a > hi, above, 1.0)), index=aum.index).clip(AUM_FLOOR, 1).where(a.notna() & (a > 0))


def add(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of the scored frame with nw_score (0-100), nw_conf (0-1), nw_pass and the breakdown the UI shows:
    nw_pct_<input> (peer percentile 0-100, or the 0-100 score for direct inputs), nw_pts_<part> (percentile x weight), nw_wt_avail, nw_raw, nw_peers, nw_reason."""
    key = df["cat"] + "|" + df["plan"]
    num = lambda c: pd.to_numeric(df[c], errors="coerce")  # noqa: E731
    out = df.copy()
    out["q_level"], out["q_trend"] = quartile_scores(df)
    out["aum_fit"] = aum_fit(df["aum_cr"], df["cat"])
    cols = {c: out[c] if c in ("q_level", "q_trend", "aum_fit") else num(c) for _, (_, spec) in COMPONENTS.items() for c, _ in spec if c != "accel_3y_5y"}
    cols["accel_3y_5y"] = cols["cagr_3y"] - num("cagr_5y")
    total = pd.Series(0.0, index=df.index)
    weight = pd.Series(0.0, index=df.index)
    for name, (w, spec) in COMPONENTS.items():
        ranks = [cols[c] if hb is None else cols[c].groupby(key).rank(pct=True, ascending=hb) for c, hb in spec]
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
