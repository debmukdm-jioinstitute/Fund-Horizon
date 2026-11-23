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
                     "ter": 2.5 - g * 0.1})
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
