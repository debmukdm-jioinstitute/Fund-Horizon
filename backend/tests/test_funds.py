import pandas as pd
import pytest

from app.config import load_allocation
from app.engine import allocation as al
from app.engine import funds as fu

BANDS = [b["name"] for b in load_allocation()["bands"]]


def raw_ok(metrics, code):
    row = metrics[metrics["scheme_code"] == code].iloc[0]
    assert row["plan"] == "Regular" and row["option"] == "Growth"
    assert row["data_quality"] in ("ok", "split_adjusted")
    assert row["structure"] == "Open Ended"
    assert row["data_quality"] != "segregated_portfolio"
    assert pd.Timestamp(row["last_nav_date"]) >= pd.Timestamp("2026-10-09") - pd.Timedelta(days=10)
    return row


@pytest.mark.parametrize("band", BANDS)
@pytest.mark.parametrize("years", [2, 4, 6, 12])
def test_selection_rules(metrics, eligible, band, years):
    picks = fu.select_funds(al.goal_allocation(band, years), eligible)
    codes = [p["scheme_code"] for p in picks]
    assert len(codes) == len(set(codes))
    assert len(picks) <= 8
    amcs = pd.Series([p["amc"] for p in picks]).value_counts()
    assert amcs.max() <= 2
    assert abs(sum(p["weight_pct"] for p in picks) - 100) < 1e-6
    for p in picks:
        raw_ok(metrics, p["scheme_code"])
        assert "direct" not in p["scheme_name"].lower().replace("directorate", "")
        assert p["weight_pct"] >= 5 or len(picks) == 1
        assert not p["needs_demat"]
        assert p["explain"], "every pick needs an explanation"


def test_scores_between_0_and_1_and_ranked(eligible):
    pool = fu.candidate_pool(eligible, "large_cap")
    assert pool["score"].between(0, 1).all()
    assert pool["score"].is_monotonic_decreasing
    assert pool["history_years"].min() >= 5


def test_income_categories_use_income_formula_not_sharpe(eligible):
    assert fu.is_income_category("liquid") and not fu.is_income_category("large_cap")
    p = fu.select_funds({"liquid": 100.0}, eligible)[0]
    assert all("Sharpe" not in e for e in p["explain"])


def test_amc_cap_enforced_with_synthetic_pool():
    rows = []
    for cat in ("large_cap", "flexi_cap", "mid_cap"):
        for i in range(6):
            rows.append(dict(scheme_code=f"{cat}{i}", scheme_name=f"{cat}{i}", amc="Same" if i < 2 else f"Other{i}",
                             category=cat, cat=cat, needs_demat=False, history_years=10, cagr_3y=0.2 - i * 0.01,
                             cagr_5y=0.2 - i * 0.01, roll3y_median=0.2 - i * 0.01, sharpe_3y=1.0 - i * 0.1,
                             max_drawdown_3y=-0.1 - i * 0.01, roll1y_median=0.1, vol_3y=0.1, ret_1y=0.1,
                             cagr_10y=0.1, last_nav_date="2026-10-09"))
    df = pd.DataFrame(rows)
    picks = fu.select_funds({"large_cap": 40, "flexi_cap": 30, "mid_cap": 30}, df)
    assert sum(p["amc"] == "Same" for p in picks) <= 2


def test_merge_small_positions():
    sel = load_allocation()["selection"]
    base = dict(scheme_name="x", amc="a", category="c", score=0.5, metrics={}, explain=[], merged_from=[],
                needs_demat=False, last_nav_date="d")
    picks = [dict(base, scheme_code="1", cat="large_cap", sleeve="equity", weight_pct=60.0),
             dict(base, scheme_code="2", cat="small_cap", sleeve="equity", weight_pct=3.0),
             dict(base, scheme_code="3", cat="liquid", sleeve="liquid", weight_pct=2.0),
             dict(base, scheme_code="4", cat="short_duration", sleeve="debt", weight_pct=35.0)]
    out = fu._merge_small(picks, sel)
    assert {p["scheme_code"] for p in out} == {"1", "4"}
    assert sum(p["weight_pct"] for p in out) == 100.0
    assert any(m["cat"] == "small_cap" for p in out for m in p["merged_from"])


def test_missing_metrics_renormalise(eligible):
    pool = eligible[(eligible["cat"] == "gold") & (~eligible["needs_demat"]) & (eligible["history_years"] >= 3)]
    scored = fu.score_pool(pool, "gold")
    assert len(scored) > 0 and scored["score"].notna().all()


def test_no_pool_raises(eligible):
    with pytest.raises(ValueError):
        fu.select_funds({"large_cap": 50, "not_a_category": 50}, eligible)
