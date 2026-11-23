from __future__ import annotations

import numpy as np
import pandas as pd

from app.backoffice import fh_next_wave_detail as d
from tests.test_backoffice_compare import _create_staff, _login_staff


def _series(n: int = 96, drift: float = 0.01, seed: int = 1):
    idx = pd.date_range("2018-01-31", periods=n, freq="ME")
    rng = np.random.default_rng(seed)
    r = pd.Series(drift + rng.normal(0, 0.03, n), index=idx)
    nav = (1 + r).cumprod() * 100
    med = pd.Series(0.007 + rng.normal(0, 0.02, n), index=idx)
    return nav, med


def _row(**kw):
    base = {"ret_1y": 12.0, "ret_1y_cat": 9.0, "cagr_3y": 14.0, "cagr_3y_cat": 11.0, "cagr_5y": 12.0, "alpha_3y": 2.0, "beta_3y": 0.95, "sortino_3y": 1.1, "downside_dev_3y": 8.0,
            "max_dd_3y": -15.0, "ter": 1.2, "ter_gap_pp": -0.3, "cal_topq_years": 2.0, "nw_pct_ret_1y": 80.0, "nw_pct_cagr_3y": 85.0,
            "cat": "mid_cap", "aum_cr": 8000.0, "aum_fit": 1.0, "q_level": 0.9, "q_trend": 0.67, "cal_q_py2": 3, "cal_q_py1": 3, "cal_q_ytd": 2}
    base.update(kw)
    return pd.Series(base)


def test_every_input_has_a_history_payload():
    nav, med = _series()
    for inp in d.PEER_INPUTS:
        out = d.history(inp, _row(roll_win_pct=50.0, cal_win_pct=50.0), nav, med)
        assert out["input"] == inp and out["available"], inp
        assert out["tiles"] and out["insights"] and out["basis"]


def test_rolling_and_calendar_totals_equal_the_precomputed_metrics():
    from app.backoffice.mf_research_v2 import compute_consistency

    nav, med = _series()
    ref = compute_consistency(nav, med, None, "x")  # what the nightly job stores and the table shows
    roll = d.history("roll_win_pct", _row(roll_win_pct=ref["roll_win_pct"]), nav, med)
    cal = d.history("cal_win_pct", _row(cal_win_pct=ref["cal_win_pct"]), nav, med)
    assert roll["tiles"][0]["hint"] == f"{ref['roll_win_pct']}%" and cal["tiles"][0]["hint"] == f"{ref['cal_win_pct']}%"
    assert sum(1 for r in roll["table"]["rows"] if r[-1][0] == "Won") == int(roll["tiles"][0]["value"].split(" of ")[0])


def test_too_little_history_says_why_instead_of_guessing():
    nav, med = _series(10)
    out = d.history("roll_win_pct", _row(roll_win_pct=50.0), nav, med)
    assert out["available"] is False and out["reason"]
    assert d.history("roll_win_pct", _row(roll_win_pct=None), *_series())["available"] is False  # no table figure, so no disagreeing drill-down
    assert d.history("accel_3y_5y", _row(cagr_5y=None), *_series())["available"] is False  # needs 5 years


def test_unknown_input_is_none():
    assert d.history("nope", _row(), *_series()) is None


def test_peer_table_ranks_and_marks_this_fund():
    frame = pd.DataFrame({"code": [str(i) for i in range(10)], "name": [f"F{i}" for i in range(10)], "cat": "flexi_cap", "plan": "Regular", "ter": [2.0 - i * 0.1 for i in range(10)],
                          "cat_label": "Flexi Cap", "nw_score": 50.0, "nw_pass": False, "history_years": 5.0})
    out = d.peer_table(frame, "9", "ter")  # lower expense ratio ranks better, so fund 9 (1.1%) is rank 1
    assert out["this_rank"] == 1 and out["rows"][0]["this"] and out["percentile"] == 100.0 and out["peers_with_data"] == 10
    assert d.peer_table(frame, "9", "bogus") is None


def test_detail_endpoint(client):
    _login_staff(client, _create_staff())
    base = client.get("/api/backoffice/mutual-funds/screener?category=flexi_cap&plan=Regular&limit=5").json()["data"][0]["code"]
    for inp in ("roll_win_pct", "ter", "max_dd_3y", "q_level", "q_trend", "aum_fit"):
        h = client.get(f"/api/backoffice/mutual-funds/next-wave/detail?code={base}&input={inp}")
        assert h.status_code == 200 and h.json()["input"] == inp
        p = client.get(f"/api/backoffice/mutual-funds/next-wave/detail?code={base}&input={inp}&kind=peers")
        assert p.status_code == 200 and any(r["this"] for r in p.json()["rows"]) or p.json()["this_rank"] is None
    assert client.get(f"/api/backoffice/mutual-funds/next-wave/detail?code={base}&input=evil").status_code == 422
    assert client.get("/api/backoffice/mutual-funds/next-wave/detail?code=0&input=ter").status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/backoffice/mutual-funds/next-wave/detail?code={base}&input=ter").status_code in (401, 403)


def test_quartile_detail_lists_every_period():
    out = d.history("q_level", _row(quartile_1y=1, ret_1y=12.0, ret_1y_cat=9.0, quartile_5y=3, nw_peers=40), *_series())
    text = " ".join(out["insights"])
    assert "Over 1 year the fund ranks in quartile 1 (12.00% against 9.00%" in text and "Over 5 years the fund ranks in quartile 3." in text and "40 funds" in text
