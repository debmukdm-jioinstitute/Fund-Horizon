import numpy as np
import pandas as pd
import pytest

from app.backoffice import fh_recommended, fh_score

CFG_OK = fh_score.load_config()
CFG_OK["history"]["confirmed"] = True
PROXY = "147666"  # BENCHMARK_PROXY["large_cap"]


def _row(code, **kw):
    base = dict(
        code=code, cat="large_cap", plan="Regular", quality="ok", manager_tenure_years=8.0, history_years=10.0,
        cal_q_ytd=2, cal_q_py1=3, cal_q_py2=1,
        ret_1y=20.0, cagr_3y=20.0, cagr_5y=20.0, ret_1y_cat=10.0, cagr_3y_cat=10.0, cagr_5y_cat=10.0, max_dd_3y=-10.0,
        **{f"cap_up_{y}y": 130.0 for y in (1, 3, 5)}, **{f"cap_down_{y}y": 80.0 for y in (1, 3, 5)},
        **{f"sortino_{y}y": 3.5 for y in (1, 3, 5)}, **{f"sharpe_{y}y": 2.5 for y in (1, 3, 5)},
    )
    base.update(kw)
    return base


def _frame(target: dict, cfg=None, peers=8):
    rows = [_row("T", **target), _row(PROXY, ret_1y=5.0, cagr_3y=5.0, cagr_5y=5.0)]
    rows += [_row(f"P{i}", ret_1y=9.0 + i * 0.2, cagr_3y=9.0 + i * 0.2, cagr_5y=9.0 + i * 0.2, max_dd_3y=-20.0) for i in range(peers)]
    df = pd.DataFrame(rows)
    df = fh_score.score_frame(df, cfg or CFG_OK, ref=pd.Timestamp("2026-10-28"))
    return df[df["code"] == "T"].iloc[0]


def test_strong_fund_recommended_at_boundary_and_blocked_when_unconfirmed():
    r = _frame({})
    assert r["fh_score"] >= 80 and r["fh_auto"] and r["fh_blockers"] == []
    cfg = {**CFG_OK, "history": {**CFG_OK["history"], "confirmed": False}}
    r2 = _frame({}, cfg)
    assert not r2["fh_auto"] and "history_criteria_unconfirmed" in r2["fh_blockers"]
    cfg3 = {**CFG_OK, "recommend": {**CFG_OK["recommend"], "threshold": r["fh_score"] + 0.01}}
    assert "score_below_threshold" in _frame({}, cfg3)["fh_blockers"]


def test_quartile_preference_q2q3_over_q1_over_q4():
    s = {q: _frame(dict(cal_q_ytd=q, cal_q_py1=q, cal_q_py2=q))["fh_quartile_raw"] for q in (1, 2, 3, 4)}
    assert s[2] == s[3] == 1.0 and s[2] > s[1] > s[4] == 0.0


def test_two_qualifying_periods_give_full_credit():
    assert _frame(dict(cal_q_ytd=4, cal_q_py1=2, cal_q_py2=3))["fh_quartile_raw"] == 1.0


def test_ratios_are_scored_against_category_peers_not_fixed_thresholds():
    strong = _frame({f"sharpe_{y}y": 5.0 for y in (1, 3, 5)})  # peers sit at 2.5
    weak = _frame({f"sharpe_{y}y": 0.1 for y in (1, 3, 5)})
    assert strong["fh_ratios_raw"] > weak["fh_ratios_raw"]
    assert strong["fhc_sharpe_3_pct"] > weak["fhc_sharpe_3_pct"]
    assert "sortino_fail" not in strong["fh_flags"] and "fh_pen_sortino" not in strong.index  # no separate ratio penalty


def test_capture_undefined_for_zero_or_negative_downside():
    for bad in (0.0, -5.0, np.nan):
        r = _frame({"cap_down_3y": bad})
        assert np.isnan(r["fhc_cap_down_3_pct"])  # unavailable is not scored as poor
        assert r["fh_ratios_cov"] < 1


def test_missing_history_is_not_zero_filled_or_redistributed():
    full = _frame({})
    miss = _frame({"cagr_5y": np.nan, "sortino_5y": np.nan, "sharpe_5y": np.nan})
    assert miss["fh_coverage"] < full["fh_coverage"] and "missing_data" in miss["fh_flags"]
    assert miss["fh_score"] < full["fh_score"]


def test_drawdown_sign_and_toggle_weights():
    on = {**CFG_OK, "drawdown_enabled": True}
    small, big = _frame({"max_dd_3y": -5.0}, on), _frame({"max_dd_3y": -40.0}, on)
    assert small["fh_drawdown_raw"] > big["fh_drawdown_raw"]
    assert _frame({"max_dd_3y": 5.0}, on)["fh_drawdown_raw"] == small["fh_drawdown_raw"]  # sign notation ignored
    assert sum(fh_score.active_weights(on).values()) == sum(fh_score.active_weights(CFG_OK).values()) == 100
    assert "fh_drawdown_pts" not in _frame({}, CFG_OK).index


def test_concentration_flag_when_two_filters_carry_score():
    r = _frame(dict(manager_tenure_years=0.1, history_years=0.1, cal_q_ytd=4, cal_q_py1=4, cal_q_py2=4,
                    **{f"sortino_{y}y": 0.0 for y in (1, 3, 5)}, **{f"sharpe_{y}y": 0.0 for y in (1, 3, 5)},
                    **{f"cap_down_{y}y": 0.0 for y in (1, 3, 5)}))
    assert "concentrated" in r["fh_flags"] and "inconsistent" in r["fh_flags"]


def test_config_weights_must_total_100():
    bad = fh_score.load_config()
    bad["weights_off"]["ratios"] = 30
    with pytest.raises(ValueError):
        fh_score.validate_config(bad)


def test_manual_overrides_survive_auto_refresh(tmp_path, monkeypatch):
    monkeypatch.setattr(fh_recommended, "OVERRIDES_FILE", tmp_path / "o.json")
    monkeypatch.setattr(fh_recommended, "AUTO_FILE", tmp_path / "a.json")
    fh_recommended.save_recommended_override("mf", "A1", "Auto Fund", False)  # staff excludes an auto pick
    fh_recommended.save_recommended_override("mf", "M1", "Manual Fund", True)
    fh_recommended.apply_auto({"A1": "Auto Fund", "A2": "Auto Two"}, "2026-10-28")
    live = fh_recommended.FH_RECOMMENDED_MF_CODES
    assert "A1" not in live and "M1" in live and "A2" in live
    fh_recommended.apply_auto({"A2": "Auto Two"}, "2026-10-29")  # refresh again
    assert "A1" not in live and "M1" in live
    inc, excl = fh_recommended.manual_state()
    assert "M1" in inc and "A1" in excl
    monkeypatch.undo()
    fh_recommended._rebuild()  # restore live module state for other tests


def test_explain_is_json_safe_for_every_fund():
    import json
    import warnings

    from app.backoffice import mf_screener
    warnings.filterwarnings("ignore")
    df = mf_screener._scored({}, None)
    for _, row in df.sample(300, random_state=1).iterrows():
        json.dumps(fh_score.explain_row(row), allow_nan=False)  # a NaN here was a 500 on the score view
