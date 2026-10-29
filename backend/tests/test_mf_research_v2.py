"""MF Research V2 pure helpers: portfolio, index, consistency, managers, ops."""

from __future__ import annotations

import pandas as pd
import pytest

from app.backoffice.mf_research_v2 import (
    calendar_year_returns,
    co_managers_from_reference,
    compute_consistency,
    fund_overlap,
    index_metrics,
    manager_changes_from_reference,
    operations_from_reference,
    parse_ssd_date,
    portfolio_summary,
    riskometer_level,
    sector_aggregation,
)
from app.backoffice.screening.funnel import apply_funnel
from app.backoffice.screening.quartiles import compute_category_quartiles


def _monthly_nav(monthly_return: float, months: int = 73, start: str = "2019-12-31") -> pd.Series:
    idx = pd.date_range(start, periods=months, freq="ME")
    vals = [100.0]
    for _ in range(months - 1):
        vals.append(vals[-1] * (1.0 + monthly_return))
    return pd.Series(vals, index=idx)


def test_parse_ssd_date_and_riskometer():
    assert parse_ssd_date("Managing Since March 26, 2014") == "2014-03-26"
    assert parse_ssd_date("Managing Since September 01, 2026") == "2026-09-01"
    assert parse_ssd_date("no date here") is None
    assert parse_ssd_date(None) is None
    assert riskometer_level("Moderate Risk") == 3
    assert riskometer_level("Very High") == 6
    assert riskometer_level("Low to Moderate Risk") == 2
    assert riskometer_level("Unknown wording") is None


def test_sector_aggregation_and_summary():
    holdings = [
        {"name": "AAA", "isin": "IN1", "sector": "Banking", "weight_pct": 8.0},
        {"name": "BBB", "isin": "IN2", "sector": "Banking", "weight_pct": 4.0},
        {"name": "CCC", "isin": "IN3", "sector": "IT", "weight_pct": 5.0},
        {"name": "DDD", "isin": "IN4", "sector": "", "weight_pct": 3.0},
    ]
    agg = sector_aggregation(holdings)
    assert agg["sectors"][0] == {"sector": "Banking", "weight_pct": 12.0}
    assert agg["unclassified_pct"] == 3.0
    assert agg["coverage"] == "partial"
    summ = portfolio_summary(holdings)
    assert summ["holdings_count"] == 4
    assert summ["top_holding_pct"] == 8.0
    assert summ["top10_concentration_pct"] == 20.0
    assert sector_aggregation([])["coverage"] == "none"


def test_fund_overlap_shared_and_missing():
    a = [{"name": "AAA", "isin": "IN1", "weight_pct": 8.0}, {"name": "BBB", "isin": "IN2", "weight_pct": 2.0}]
    b = [{"name": "AAA", "isin": "IN1", "weight_pct": 5.0}, {"name": "ZZZ", "isin": "IN9", "weight_pct": 7.0}]
    out = fund_overlap(a, b)
    assert out["shared_count"] == 1
    assert out["shared_weight_in_a_pct"] == 8.0
    assert out["shared_weight_in_b_pct"] == 5.0
    assert out["shared_holdings"][0]["name"] == "AAA"
    missing = fund_overlap(a, [])
    assert missing["shared_weight_in_a_pct"] is None
    assert missing["reason"]


def _varying_nav(months: int = 49) -> pd.Series:
    pattern = [0.02, -0.01, 0.015, 0.005]
    idx = pd.date_range("2021-12-31", periods=months, freq="ME")
    vals = [100.0]
    for i in range(months - 1):
        vals.append(vals[-1] * (1.0 + pattern[i % len(pattern)]))
    return pd.Series(vals, index=idx)


def test_index_metrics_identical_series_and_short_series():
    fund = _varying_nav()
    index = _varying_nav()
    m = index_metrics(fund, index)
    assert m["beta_3y"] == pytest.approx(1.0, abs=0.05)
    assert m["alpha_3y_pct"] == pytest.approx(0.0, abs=0.5)
    assert m["tracking_error_3y_pct"] == pytest.approx(0.0, abs=0.5)
    assert m["reason"] is None
    short = index_metrics(_monthly_nav(0.01, months=6), _monthly_nav(0.01, months=6))
    assert short["beta_3y"] is None and short["reason"]
    assert index_metrics(pd.Series(dtype=float), index)["beta_3y"] is None


def test_compute_consistency_vs_median():
    fund = _monthly_nav(0.01, months=73)  # Dec 2019 .. Dec 2025, full calendar years 2020-2025
    med_idx = fund.index
    med = pd.Series([0.008] * len(med_idx), index=med_idx)
    fund_cal = calendar_year_returns(fund)
    peer_cal: dict[int, dict[str, float]] = {}
    for year, ret in fund_cal.items():
        peer_cal[year] = {"FUND1": ret, **{f"P{i}": ret - 0.02 for i in range(9)}}
    out = compute_consistency(fund, med, peer_cal, "FUND1", quartile_fn=compute_category_quartiles)
    assert out["roll_win_pct"] == 100.0  # 1%/mo always beats 0.8%/mo median
    assert out["cal_win_pct"] == 100.0
    assert out["cal_topq_years"] == len(fund_cal)
    assert out["downside_dev_3y"] == 0.0  # no negative monthly returns
    assert out["sip_cagr_3y"] is not None and 11.0 < out["sip_cagr_3y"] < 14.0
    assert out["sip_cagr_5y"] is not None
    empty = compute_consistency(fund, None, None, "FUND1", quartile_fn=compute_category_quartiles)
    assert empty["roll_win_pct"] is None and empty["cal_topq_years"] is None
    assert empty["sip_cagr_3y"] is not None  # fund-only metrics do not need the median


def test_co_managers_and_changes():
    rows = [
        {"manager_id": "M1", "full_name": "Anil Bamboli", "designation": "Fund Manager",
         "role_as_stated": "Fund manager of the scheme", "start_date_as_stated": "Managing Since March 26, 2014",
         "start_date_managing": "", "end_date": ""},
        {"manager_id": "M2", "full_name": "Gopal Agrawal", "designation": "Fund Manager",
         "role_as_stated": "Fund Manager for Overseas Investments", "start_date_as_stated": "Managing Since September 01, 2026",
         "start_date_managing": "", "end_date": ""},
    ]
    out = co_managers_from_reference(rows, "2026-10-22")
    assert out["is_co_managed"] is True
    assert out["shared_record_note"]
    assert [m["name"] for m in out["managers"]] == ["Anil Bamboli", "Gopal Agrawal"]
    assert out["managers"][0]["start_date"] == "2014-03-26"
    assert out["managers"][0]["tenure_years"] is not None and out["managers"][0]["tenure_years"] > 12
    single = co_managers_from_reference(rows[:1], "2026-10-22")
    assert single["is_co_managed"] is False and single["shared_record_note"] is None
    changes = manager_changes_from_reference(
        [{"old_manager_id": "M9", "new_manager_id": "M1", "effective_date": "2024-04-20",
          "amc_notice_addendum_url": "https://example.invalid/notice.pdf", "source_url": ""}],
        {"M9": "Apurva Sharma", "M1": "Pratik Singh"},
    )
    assert changes[0]["old_manager"] == "Apurva Sharma"
    assert changes[0]["new_manager"] == "Pratik Singh"


def test_operations_snapshot_and_history_flags():
    scheme = {
        "as_of_date": "2026-10-15", "source_url": "https://example.invalid",
        "launch_allotment_date": "2014-03-26", "exit_load": "NIL",
        "minimum_investment_inr": "100", "ssd_minimum_application_text": "Rs.100",
        "riskometer_level": "Moderate Risk", "benchmark_index_tri": "Nifty Banking & PSU Debt Index A-II",
        "current_ter_regular_pct": "0.72", "current_ter_direct_pct": "0.35", "ter_date": "2026-10-14",
        "current_aum_inr_crore": "", "aum_date": "", "scheme_status": "", "merged_into_scheme_code": "",
    }
    ops = operations_from_reference(scheme)
    assert ops["available"] is True
    assert ops["exit_load"] == "NIL" and ops["riskometer_level"] == 3
    assert ops["history_unavailable"]["aum_history"]
    assert ops["history_unavailable"]["ter_history"]
    assert operations_from_reference(None)["available"] is False


def _funnel_row(**over):
    row = {
        "scheme_code": "1", "scheme_name": "Fund", "cat": "flexi_cap", "amc": "HDFC",
        "manager_name": "Anil Bamboli", "manager_tenure_years": 10.0, "tenure_ratio": 1.5,
        "sharpe": 1.5, "sortino": 1.5, "up_capture": 1.2, "down_capture": 0.8,
        "capture_spread": 0.4, "ter_gap_pp": -0.2, "expense_ratio": 0.8,
        "quartile_2y": 4, "quartile_3y": 1, "quartile_source": "computed",
    }
    row.update(over)
    return row


def test_funnel_v2_manager_search_and_quartile_period():
    rows = [_funnel_row(), _funnel_row(scheme_code="2", manager_name="Other Person", quartile_3y=4)]
    res = apply_funnel(rows, filters={"quartile_period": "3y", "manager_search": "bamboli"},
                       cat_median_ters={"flexi_cap": 1.0})
    assert [r["scheme_code"] for r in res["retain"]] == ["1"]
    assert res["action"] == []
    # Without the manager search, the 3Y quartile (not the 2Y one) decides:
    # fund 1 retains on Q1-3y despite Q4-2y; fund 2 drops on Q4-3y.
    res2 = apply_funnel(rows, filters={"quartile_period": "3y"}, cat_median_ters={"flexi_cap": 1.0})
    assert [r["scheme_code"] for r in res2["retain"]] == ["1"]
    assert all(d["scheme_code"] == "2" for d in res2["dropped"])


def test_funnel_v2_capture_spread_bound():
    rows = [_funnel_row(), _funnel_row(scheme_code="2", up_capture=1.05, down_capture=1.0, capture_spread=0.05,
                                       quartile_3y=2)]
    res = apply_funnel(rows, filters={"bounds": {"capture_spread": {"min": 0.3}}, "quartile_period": "3y"},
                       cat_median_ters={"flexi_cap": 1.0})
    codes = [r["scheme_code"] for r in res["action"] + res["retain"]]
    assert codes == ["1"]


def test_preset_normalisation_research_to_funnel():
    from app.backoffice.screening.service import normalise_research_filters

    out = normalise_research_filters({
        "category": ["flexi_cap", "large_cap"], "plan": ["Direct"], "amc": ["HDFC"],
        "search": "flexi", "ranges": {"cap_up_3y": {"min": "100"}, "cap_spread_3y": {"min": "10"},
                                 "sharpe_3y": {"min": "1"}, "ret_1y": {"min": "5"}, "ter": {"max": "2"}},
        "quartile": [1, 2], "quartile_period": "3y", "manager": "Anil", "min_tenure": "5",
    })
    assert out["bounds"]["up_capture"] == {"min": 1.0}
    assert out["bounds"]["capture_spread"] == {"min": 0.1}
    assert out["bounds"]["sharpe"] == {"min": 1.0}
    assert "ret_1y" not in out["bounds"] and "ter" not in out["bounds"]
    assert out["quartiles_action"] == [1, 2]
    assert out["manager_search"] == "Anil"
    assert out["min_tenure_years"] == 5.0
    assert out["quartile_period"] == "3y"
    # Funnel-native filters pass through untouched.
    native = {"bounds": {"sharpe": {"min": 1.0}}, "min_tenure_years": 3}
    assert normalise_research_filters(native) == native


def test_screener_consistency_columns_from_map():
    from app.backoffice import mf_screener as ms

    frame = ms.all_frame({}, consistency_map={"148535": {
        "roll_win_pct": 61.5, "cal_topq_years": 3, "cal_win_pct": 80.0,
        "downside_dev_3y": 9.25, "sip_cagr_3y": 12.1, "sip_cagr_5y": 13.4}})
    sub = frame[frame["code"] == "148535"]
    assert not sub.empty
    r = ms.records(sub)[0]
    assert r["roll_win_pct"] == 61.5 and r["cal_topq_years"] == 3
    assert r["sip_cagr_5y"] == 13.4
    assert r["idx_alpha_3y"] is None  # no TRI series ingested: null, never a proxy figure
    csv_text = ms.to_csv(sub)
    assert "Rolling 1Y Win %" in csv_text and "vs index TRI" in csv_text
