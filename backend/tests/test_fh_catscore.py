import numpy as np
import pandas as pd

from app.backoffice import fh_catscore, fh_score

CFG = fh_score.load_config()


def _frame(n=8, **target):
    rows = []
    for i in range(n):  # peers: sharpe 0.1..0.8, down capture 70..105
        rows.append(dict(code=f"P{i}", cat="large_cap", plan="Regular", quality="ok", sharpe_3y=0.1 + 0.1 * i, sortino_3y=0.2 + 0.1 * i,
                         cap_up_3y=100.0, cap_down_3y=70.0 + 5 * i))
    rows.append(dict(code="T", cat="large_cap", plan="Regular", quality="ok", **{"sharpe_3y": 0.45, "sortino_3y": 0.5, "cap_up_3y": 100.0, "cap_down_3y": 90.0, **target}))
    return pd.DataFrame(rows)


def test_category_average_includes_subject_and_percentile_direction():
    st = fh_catscore.category_stats(_frame(), CFG)
    t = st.iloc[-1]
    assert t["fhc_sharpe_3_n"] == 9
    assert abs(t["fhc_sharpe_3_avg"] - np.mean([0.1 + 0.1 * i for i in range(8)] + [0.45])) < 1e-9
    assert t["fhc_sharpe_3_pct"] == (5 - 0.5) / 9  # 5th of 9 ascending: higher is better
    best_dd = st.iloc[0]  # lowest downside capture of the peers: lower is better, so highest percentile
    assert best_dd["fhc_cap_down_3_pct"] > t["fhc_cap_down_3_pct"]
    assert t["fhc_cap_down_3"] == 0.9  # percent -> ratio (100% = 1.0)


def test_invalid_values_are_excluded_not_zeroed_and_reasons_kept():
    df = _frame(cap_down_3y=0.0)  # zero downside capture is undefined for ranking
    st = fh_catscore.category_stats(df, CFG)
    assert np.isnan(st.iloc[-1]["fhc_cap_down_3"]) and np.isnan(st.iloc[-1]["fhc_cap_down_3_pct"])
    df2 = _frame(); df2.loc[0, "quality"] = "nav_shock"
    ok, why = fh_catscore.peer_eligibility(df2)
    assert not ok[0] and why[0] == "data_quality:nav_shock"
    assert fh_catscore.category_stats(df2, CFG).iloc[-1]["fhc_sharpe_3_n"] == 8


def test_below_min_peers_is_unscored_not_poor():
    st = fh_catscore.category_stats(_frame(n=2), CFG)  # 3 peers < min 5
    assert st["fhc_sharpe_3_pct"].isna().all() and st["fhc_sharpe_3_avg"].isna().all()
    assert "peer data is unavailable" in fh_catscore.metric_text("sharpe", 0.4, np.nan, 3, np.nan, True, None, True, fh_catscore.settings(CFG))


def test_mode_b_bonus_only_for_sharpe_sortino_and_capped():
    df = _frame(sharpe_3y=1.2, sortino_3y=1.3)
    cfg = {**CFG, "ratios": {**CFG["ratios"], "mode": "B"}}
    fh_catscore.ratios_filter(df, cfg, "B")
    a = _frame(sharpe_3y=1.2, sortino_3y=1.3)
    fh_catscore.ratios_filter(a, CFG, "A")
    t = len(df) - 1
    assert df["fhc_score_sharpe_3"][t] == min(1.0, a["fhc_score_sharpe_3"][t] + 0.15)
    assert df["fhc_score_capture_3"][t] == a["fhc_score_capture_3"][t]  # no bonus on capture


def test_below_threshold_but_above_category_still_earns_credit():
    df = _frame(sharpe_3y=0.8)  # below 1.0, top of this peer set
    fh_catscore.ratios_filter(df, CFG, "B")
    assert df["fhc_score_sharpe_3"].iloc[-1] > 0.5
    txt = fh_catscore.metric_text("sharpe", 0.8, 0.45, 9, 0.9, True, 1.0, True, fh_catscore.settings(CFG))
    assert txt.startswith("Below the absolute threshold (1), but above the category average")


def test_downside_capture_text_and_informational_beta():
    s = fh_catscore.settings(CFG)
    assert "Lower downside capture than the category average" in fh_catscore.metric_text("cap_down", 0.8, 0.9, 9, .8, False, None, True, s)
    assert "Informational only" in fh_catscore.metric_text("beta", 1.1, 1.0, 9, np.nan, True, None, False, s)
