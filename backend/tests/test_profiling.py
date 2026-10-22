import pytest

from app.engine import profiling as p
from app.schemas import Client


def make(**kw):
    base = dict(first_name="T", age=35, employment_type="salaried_private", dependents=0,
                monthly_income=100000, monthly_expenses=40000, monthly_emi=0, liquid_assets=600000,
                investments=0, liabilities=0, term_cover=0, health_cover=0, retirement_age=60)
    base.update(kw)
    return Client(**base)


ANS_ALL = lambda i: {f"q{n}": i for n in range(1, 11)}


def test_weights_sum_to_one():
    assert abs(sum(p.WEIGHTS.values()) - 1.0) < 1e-12


@pytest.mark.parametrize("age,score", [(18, 100), (30, 100), (31, 85), (40, 85), (41, 65), (50, 65),
                                       (51, 40), (60, 40), (61, 20), (80, 20)])
def test_age_boundaries(age, score):
    assert p.score_age(age) == score


@pytest.mark.parametrize("m,score", [(12, 100), (11.99, 85), (6, 85), (5.99, 55), (3, 55),
                                     (2.99, 30), (1, 30), (0.99, 10), (0, 10)])
def test_emergency_boundaries(m, score):
    assert p.score_emergency_months(m) == score


@pytest.mark.parametrize("r,score", [(0.40, 100), (0.399, 85), (0.30, 85), (0.20, 70), (0.199, 50),
                                     (0.10, 50), (0.0, 30), (0.099, 30), (-0.01, 10)])
def test_savings_rate_boundaries(r, score):
    assert p.score_savings_rate(r) == score


@pytest.mark.parametrize("x,score", [(5, 100), (4.99, 80), (3, 80), (1, 55), (0.99, 35), (0, 35), (-0.1, 10)])
def test_net_worth_boundaries(x, score):
    assert p.score_net_worth_multiple(x) == score


@pytest.mark.parametrize("d,score", [(0.0, 100), (0.0999, 100), (0.10, 80), (0.20, 55), (0.35, 30), (0.50, 10)])
def test_debt_burden_boundaries(d, score):
    assert p.score_debt_burden(d) == score


@pytest.mark.parametrize("n,score", [(0, 100), (1, 80), (2, 60), (3, 40), (4, 25), (9, 25)])
def test_dependents(n, score):
    assert p.score_dependents(n) == score


@pytest.mark.parametrize("term_mult,score", [
    (15.0, 100), (16.0, 100), (14.99, 80), (10.0, 80),
    (9.99, 60), (7.0, 60), (6.99, 40), (5.0, 40),
    (4.99, 20), (0.0, 20)
])
def test_term_adequacy_boundaries(term_mult, score):
    assert p.score_term_adequacy(term_mult) == score


@pytest.mark.parametrize("cover,score", [
    (2_500_000, 100), (3_000_000, 100), (2_499_999, 60), (1_000_000, 60),
    (999_999, 20), (0, 20)
])
def test_health_cover_boundaries(cover, score):
    assert p.score_health_cover(cover) == score


def test_insurance_scoring():
    assert p.score_insurance(15_000_000, 1_000_000, 2_500_000) == 100
    assert p.score_insurance(10_000_000, 1_000_000, 1_000_000) == 70
    assert p.score_insurance(7_000_000, 1_000_000, 0) == 40
    assert p.score_insurance(0, 1_000_000, 0) == 20


def test_exactly_three_months_and_twenty_percent_on_client():
    c = make(monthly_income=100000, monthly_expenses=80000, liquid_assets=240000)  # 3.0 months, 20%
    f = {x["factor"]: x["score"] for x in p.risk_capacity(c)["factors"]}
    assert f["emergency_fund"] == 55 and f["savings_rate"] == 70


def test_tolerance_range_and_validation():
    assert p.risk_tolerance(ANS_ALL(3)) > 0
    lo = {f"q{n}": 0 for n in range(1, 11)}
    lo["q9"] = 0  # score 1
    assert p.risk_tolerance(lo) == 0.0
    with pytest.raises(ValueError):
        p.risk_tolerance({"q1": 0})
    with pytest.raises(ValueError):
        p.risk_tolerance({**lo, "q1": 9})


def test_final_is_min_and_bands():
    c = make()
    cap = p.risk_capacity(c)["score"]
    for idx in (0, 2, 3):
        ans = ANS_ALL(idx)
        tol = p.risk_tolerance(ans)
        res = p.build_profile(c, ans)
        assert res["final_score"] == round(min(cap, tol), 2)


@pytest.mark.parametrize("score,band", [(0, "Conservative"), (19.99, "Conservative"), (20, "Moderately Conservative"),
                                        (40, "Moderate"), (60, "Moderately Aggressive"), (80, "Aggressive"),
                                        (100, "Aggressive")])
def test_band_edges(score, band):
    assert p.band_for(score)["name"] == band


def test_mismatch_triggers_at_20():
    assert p.MISMATCH_GAP == 20.0
    c = make()
    cap = p.risk_capacity(c)["score"]
    res = p.build_profile(c, {**{f"q{n}": 0 for n in range(1, 11)}})
    assert (res["mismatch_note"] is not None) == (abs(cap - 0.0) > 20.0)


def test_emergency_override_caps_band_and_adds_action():
    c = make(liquid_assets=10000, term_cover=10_000_000, health_cover=1_000_000, investments=5_000_000)
    res = p.build_profile(c, {f"q{n}": 4 for n in range(1, 11)} | {"q5": 3, "q9": 1})
    assert "Build emergency fund first" in res["priority_actions"]
    assert res["band"] in ("Conservative", "Moderately Conservative", "Moderate")


def test_emergency_cap_binds_on_high_scores():
    # strong everything but emergency fund < 3 months
    c = make(age=25, employment_type="govt_psu", monthly_income=500000, monthly_expenses=100000,
             liquid_assets=200000, investments=50_000_000, term_cover=100_000_000, health_cover=2_000_000)
    res = p.build_profile(c, {f"q{n}": 4 for n in range(1, 11)} | {"q5": 3, "q9": 1})
    assert res["final_score"] >= 60
    assert res["band"] == "Moderate"
    assert any("capped at Moderate" in n for n in res["notes"])


def test_insurance_actions_follow_actual_gaps():
    uncovered = make(dependents=0, term_cover=0, health_cover=2_500_000)
    actions = p.build_profile(uncovered, ANS_ALL(2))["priority_actions"]
    assert any("Bridge term life insurance cover shortfall" in a for a in actions)
    assert not any("Procure dedicated health insurance cover" in a for a in actions)

    covered = make(dependents=1, term_cover=150_000_000, health_cover=500_000, monthly_income=100000)
    actions = p.build_profile(covered, ANS_ALL(2))["priority_actions"]
    assert not any("Bridge term life insurance cover shortfall" in a for a in actions)
    assert any("Procure dedicated health insurance cover" in a for a in actions)


def test_zero_income_retiree_is_not_max_debt_burden():
    c = make(age=80, employment_type="retired_none", monthly_income=0, monthly_expenses=70000,
             monthly_emi=0, liquid_assets=5_000_000, investments=5_500_000, liabilities=0,
             term_cover=0, health_cover=500_000, retirement_age=80)
    cap = p.risk_capacity(c)
    by = {f["factor"]: f for f in cap["factors"]}
    assert by["savings_rate"]["score"] == 30 and by["savings_rate"]["value"] == 0.0
    assert by["debt_burden"]["score"] == 100 and by["debt_burden"]["value"] == 0.0
    assert by["net_worth"]["score"] == 100  # ~12.5 years of expenses
    assert cap["score"] > 50


def test_zero_income_with_emi_scores_debt_against_assets():
    c = make(monthly_income=0, monthly_expenses=20000, monthly_emi=10000,
             liquid_assets=200000, investments=800000)
    by = {f["factor"]: f for f in p.risk_capacity(c)["factors"]}
    # annual EMI / assets = 120000 / 1000000 = 0.12 → 80
    assert by["debt_burden"]["score"] == 80
    assert by["savings_rate"]["score"] == 10


def test_questionnaire_monotonicity_and_options():
    qs = p.load_questionnaire()["questions"]
    assert len(qs) == 10
    for q in qs:
        scores = [opt["score"] for opt in q["options"]]
        assert len(scores) == 5, f"Question {q['id']} must have 5 options"
        assert scores == [1, 2, 3, 4, 5], f"Question {q['id']} options must be monotonic [1, 2, 3, 4, 5]"
