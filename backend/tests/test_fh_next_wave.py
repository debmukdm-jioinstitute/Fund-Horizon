from __future__ import annotations

import numpy as np
import pandas as pd

from app.backoffice import fh_next_wave


def _frame(n: int = 10) -> pd.DataFrame:
    rows = []
    for i in range(n):  # fund 0 is best on every input, fund n-1 worst
        g = n - i
        rows.append({"cat": "flexi_cap", "plan": "Regular", "history_years": 8.0, "ret_1y": g, "cagr_3y": g * 2, "cagr_5y": g,
                     "roll_win_pct": g * 10, "cal_win_pct": g * 10, "alpha_3y": g, "sortino_3y": g, "max_dd_3y": -(20 - g),
                     "ter": 2.5 - g * 0.1, "aum_cr": 5000.0, "cal_q_ytd": 2, "cal_q_py1": 2, "cal_q_py2": 2})
    return pd.DataFrame(rows)


def test_best_fund_passes_worst_fails():
    out = fh_next_wave.add(_frame())
    assert out.loc[0, "nw_pass"] and not out.loc[9, "nw_pass"]
    assert out["nw_score"].is_monotonic_decreasing


def test_young_fund_scored_not_zeroed_and_trusted_less():
    df = _frame()
    young = df.loc[[0]].assign(history_years=3.5, cagr_5y=np.nan)  # no 5Y: acceleration is dropped, not zero
    out = fh_next_wave.add(pd.concat([df, young], ignore_index=True))
    old_best, young_best = out.loc[0, "nw_score"], out.loc[10, "nw_score"]
    assert 50 < young_best < old_best and out.loc[10, "nw_conf"] == 0.85


def test_too_new_or_small_group_is_not_scored():
    df = _frame()
    df.loc[0, "history_years"] = 2.0
    assert np.isnan(fh_next_wave.add(df).loc[0, "nw_score"])
    assert fh_next_wave.add(_frame(5))["nw_score"].isna().all()


def test_input_frame_untouched():
    df = _frame()
    cols = list(df.columns)
    fh_next_wave.add(df)
    assert list(df.columns) == cols


def test_breakdown_columns_add_up():
    out = fh_next_wave.add(_frame()).loc[0]
    pts = sum(out[f"nw_pts_{c}"] for c in fh_next_wave.COMPONENTS)
    assert abs(pts / out["nw_wt_avail"] * 100 - out["nw_raw"]) < 0.2  # points earned, re-scaled to the weight present, equal the raw score
    assert out["nw_reason"] == "" and out["nw_wt_avail"] == 100


def test_unscored_fund_says_why():
    df = _frame()
    df.loc[0, "history_years"] = 2.0
    assert fh_next_wave.add(df).loc[0, "nw_reason"] == "Needs 3 years of history"


def test_q2_q3_climber_beats_q1_and_q4_faller():
    s = pd.DataFrame({"cal_q_py2": [3, 1, 4, 2], "cal_q_py1": [2, 1, 4, 2], "cal_q_ytd": [2, 1, 4, 3]})
    level, trend = fh_next_wave.quartile_scores(s)
    assert level[0] > level[1] > level[2] and level[3] > level[1]  # Q2/Q3 beat Q1, Q1 beats Q4
    assert trend[0] > trend[1] == trend[2] == 0.5 > trend[3]  # Q3->Q2 climbs, no move is neutral, Q2->Q3 slips
    only_one = fh_next_wave.quartile_scores(pd.DataFrame({"cal_q_ytd": [2], "cal_q_py1": [None], "cal_q_py2": [None]}))
    assert only_one[0][0] == 1.0 and np.isnan(only_one[1][0])  # level from one period, no trend


def test_aum_band_per_category():
    aum, cat = pd.Series([100.0, 5000.0, 20000.0, 200000.0, None]), pd.Series(["small_cap"] * 3 + ["large_cap", "large_cap"])
    fit = fh_next_wave.aum_fit(aum, cat)
    assert fit[0] < 0.5 and fit[1] == 1.0 and 0.2 <= fit[2] < 0.7 and abs(fit[3] - 0.6) < 1e-9 and np.isnan(fit[4])  # tiny, in band, too big, large cap at twice its top (0.6), unknown dropped


def test_returns_are_a_small_part_and_quartile_the_biggest():
    w = {k: v[0] for k, v in fh_next_wave.COMPONENTS.items()}
    assert sum(w.values()) == 100 and w["momentum"] <= 10 and w["quartile"] == max(w.values())
