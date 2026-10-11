import pandas as pd
import pytest

from app.config import load_allocation, load_scoring
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


def test_plan_uses_category_ranking_weights(eligible):
    sc = load_scoring()
    expected = sc["category_ranking"]["growth"]
    assert fu._weights_for("large_cap") == expected
    assert "roll3y_pct_positive" in expected
    assert expected["cagr_5y_or_3y"] < 0.35


def test_gold_recent_cagr_is_capped_in_score():
    rally = dict(
        scheme_code="G1",
        scheme_name="Axis Gold Fund - Regular Plan - Growth",
        amc="AMC1",
        category="gold",
        cat="gold",
        needs_demat=False,
        history_years=8,
        cagr_3y=0.36,
        cagr_5y=0.36,
        roll3y_median=0.34,
        roll3y_pct_positive=0.55,
        roll3y_max=0.50,
        roll3y_min=0.05,
        sharpe_3y=1.0,
        max_drawdown_3y=-0.20,
        roll1y_median=0.1,
        vol_3y=0.12,
        ret_1y=0.1,
        cagr_10y=0.1,
        last_nav_date="2026-10-09",
    )
    steady = dict(
        rally,
        scheme_code="G2",
        scheme_name="Quiet Gold Fund - Regular Plan - Growth",
        amc="AMC2",
        cagr_3y=0.10,
        cagr_5y=0.10,
        roll3y_median=0.11,
        roll3y_pct_positive=0.95,
        roll3y_max=0.13,
        roll3y_min=0.09,
        max_drawdown_3y=-0.08,
    )
    df = pd.DataFrame([rally, steady])
    capped = fu._metric_series(df, "cagr_5y_or_3y", "gold")
    assert float(capped.iloc[0]) == pytest.approx(0.12)
    assert float(capped.iloc[1]) == pytest.approx(0.10)
    uncapped = df["cagr_5y"].fillna(df["cagr_3y"])
    assert float(uncapped.iloc[0]) == pytest.approx(0.36)
    # After the cap, a metal-rally 36% no longer outranks a 10% peer on that input alone.
    assert float(capped.iloc[0]) < float(uncapped.iloc[0])


def test_fee_stacked_fof_dropped_when_alternative_exists():
    rows = []
    for code, name, amc in (
        ("ETF1", "UTI Gold ETF Fund of Fund - Regular Plan - Growth", "UTI"),
        ("PLAIN", "SBI GOLD FUND - Regular Plan - Growth", "SBI"),
    ):
        rows.append(
            dict(
                scheme_code=code,
                scheme_name=name,
                amc=amc,
                category="gold",
                cat="gold",
                needs_demat=False,
                history_years=8,
                data_quality="ok",
                cagr_3y=0.20,
                cagr_5y=0.18,
                roll3y_median=0.18,
                roll3y_pct_positive=0.9,
                roll3y_max=0.22,
                roll3y_min=0.10,
                sharpe_3y=1.0,
                max_drawdown_3y=-0.15,
                roll1y_median=0.1,
                vol_3y=0.12,
                ret_1y=0.1,
                cagr_10y=0.1,
                last_nav_date="2026-10-09",
            )
        )
    df = pd.DataFrame(rows)
    pool = fu.candidate_pool(df, "gold")
    assert "ETF1" not in set(pool["scheme_code"])
    assert "PLAIN" in set(pool["scheme_code"])
    assert fu.is_fee_stacked_fof("UTI Gold ETF Fund of Fund - Regular Plan - Growth")
    assert not fu.is_fee_stacked_fof("SBI GOLD FUND - Regular Plan - Growth")


def test_gold_explain_is_honest_about_cap_and_fof(eligible):
    gold = fu.select_funds({"gold": 100.0}, eligible)[0]
    blob = " ".join(gold["explain"])
    assert "capped" in blob.lower() or "consistency" in blob.lower()
    assert "forecast" in blob.lower() or "fund-of-fund" in blob.lower() or "fund of fund" in blob.lower()
    assert not fu.is_fee_stacked_fof(gold["scheme_name"])


def test_select_and_rank_share_weights(eligible):
    pick = fu.select_funds({"large_cap": 100.0}, eligible)[0]
    ranked = fu.rank_category_funds("large_cap", eligible)
    assert ranked[0]["scheme_code"] == pick["scheme_code"]
    assert "roll3y_pct_positive" in fu._weights_for("large_cap")


def test_picks_carry_ranked_alternatives(eligible):
    picks = fu.select_funds({"large_cap": 30, "flexi_cap": 25, "corporate_bond": 25, "liquid": 20}, eligible)
    assert picks, "expected some picks"
    for p in picks:
        alts = p["alternatives"]
        assert len(alts) <= 3
        codes = {a["scheme_code"] for a in alts}
        assert p["scheme_code"] not in codes
        assert len(codes) == len(alts)
        scores = [p["score"]] + [a["score"] for a in alts]
        assert scores == sorted(scores, reverse=True), "alternatives follow the pick in rank order"
        for a in alts:
            assert a["cat"] == p["cat"]
            assert a["explain"], "alternatives carry explanations for the comparison table"
            assert set(a["metrics"]) >= {"cagr_3y", "cagr_5y", "vol_3y", "sharpe_3y", "max_drawdown_3y"}
