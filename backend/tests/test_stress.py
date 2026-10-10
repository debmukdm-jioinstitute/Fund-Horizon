from app.engine import allocation as al
from app.engine import funds as fu
from app.engine.stress import stress_test


def test_equity_portfolio_stress(eligible):
    picks = fu.select_funds(al.goal_allocation("Aggressive", 15), eligible)
    s = stress_test(picks, eligible)
    assert s["crash_2020_drawdown"] is not None and s["crash_2020_drawdown"] < -0.10
    assert s["worst_peak_to_trough"] <= s["crash_2020_drawdown"] + 1e-12
    assert s["worst_rolling_12m"] < 0
    assert s["path"][0]["value"] > 0 and len(s["path"]) > 100
    assert abs(s["path"][0]["value"] - 1_000_000) < 200_000


def test_debt_portfolio_is_milder_than_equity(eligible):
    eq = stress_test(fu.select_funds(al.goal_allocation("Aggressive", 15), eligible), eligible)
    de = stress_test(fu.select_funds(al.goal_allocation("Conservative", 2), eligible), eligible)
    assert de["worst_peak_to_trough"] > eq["worst_peak_to_trough"]


def test_short_history_funds_flagged_as_substituted(eligible):
    picks = fu.select_funds(al.goal_allocation("Moderate", 15), eligible)
    s = stress_test(picks, eligible)
    assert set(s["substituted_share"]) == {p["scheme_code"] for p in picks}
    assert all(0 <= v <= 1 for v in s["substituted_share"].values())
    assert s["any_substituted"] == any(v > 0 for v in s["substituted_share"].values())
