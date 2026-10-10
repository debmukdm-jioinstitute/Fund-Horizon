import math

import pytest

from app.config import load_assumptions
from app.engine import finmath as fm
from app.engine import planning as pl
from app.schemas import Client, Goal

A = load_assumptions()


def client(**kw):
    base = dict(first_name="T", age=35, employment_type="salaried_private", dependents=0,
                monthly_income=100000, monthly_expenses=50000, monthly_emi=10000, liquid_assets=100000,
                investments=0, liabilities=0, term_cover=0, health_cover=0, retirement_age=60)
    base.update(kw)
    return Client(**base)


def goal(**kw):
    base = dict(name="G", type="home", target_amount_today=2_500_000, years_to_goal=8, priority=2)
    base.update(kw)
    return Goal(**base)


def test_cashflow():
    cf = pl.cashflow(client(investments=500000, liabilities=100000))
    assert cf["monthly_surplus"] == 40000 and cf["savings_rate"] == 0.4
    assert cf["net_worth"]["total"] == 500000


def test_cashflow_zero_income():
    assert pl.cashflow(client(monthly_income=0))["savings_rate"] is None


def test_emergency_fund_math():
    ef = pl.emergency_fund(client(), A)
    assert ef["target_months"] == 6 and ef["target"] == 360000 and ef["gap"] == 260000
    assert ef["monthly_allocation"] == 20000 and ef["months_to_close"] == 13


def test_emergency_fund_variable_income_and_no_gap_or_surplus():
    assert pl.emergency_fund(client(employment_type="freelance_variable"), A)["target_months"] == 9
    assert pl.emergency_fund(client(liquid_assets=10_000_000), A)["months_to_close"] == 0
    assert pl.emergency_fund(client(monthly_expenses=95000), A)["months_to_close"] is None


def test_term_need_formula():
    ins = pl.insurance_plan(client(investments=1_000_000, liabilities=200_000), A)["term"]
    pv = fm.level_annuity_pv(1_200_000 * 0.7, 0.02, 25)
    assert ins["human_life_value"] == round(pv)
    assert ins["need"] == round(pv - (1_000_000 + 100_000 - 200_000))
    assert ins["reference"] == {"15x_income": 18_000_000, "20x_income": 24_000_000}


def test_term_need_floor_and_cap():
    rich = pl.insurance_plan(client(investments=500_000_000), A)["term"]
    assert rich["need"] == 0 and rich["gap"] == 0
    capped = pl.insurance_plan(client(investments=0, liabilities=900_000_000), A)["term"]
    assert capped["need"] == 25 * 1_200_000


def test_term_gap_and_health_targets():
    p = pl.insurance_plan(client(term_cover=5_000_000, health_cover=300_000), A)
    assert p["term"]["gap"] == p["term"]["need"] - 5_000_000
    assert p["health"]["target"] == 1_000_000 and p["health"]["gap"] == 700_000
    assert pl.insurance_plan(client(age=41), A)["health"]["target"] == 1_500_000
    assert pl.insurance_plan(client(dependents=3), A)["health"]["target"] == 1_500_000


def test_goal_base_future_cost_and_sip_roundtrip():
    g = pl.goal_base(goal(), client(), "Moderate", A, 0.0)
    assert g["future_cost"] == round(2_500_000 * 1.06**8)
    r = fm.monthly_rate(g["expected_return"])
    assert fm.sip_fv(g["required_sip"], r, 96, due=True) == pytest.approx(g["future_cost"], rel=1e-3)
    assert g["required_sip"] == math.ceil(g["required_sip"])


def test_education_uses_higher_inflation():
    g = pl.goal_base(goal(type="child_education"), client(), "Moderate", A, 0.0)
    assert g["future_cost"] == round(2_500_000 * 1.09**8)


def test_existing_investment_reduces_sip():
    a = pl.goal_base(goal(), client(), "Moderate", A, 0.0)["required_sip"]
    b = pl.goal_base(goal(existing_investment_earmarked=500000), client(), "Moderate", A, 0.0)["required_sip"]
    assert b < a
    done = pl.goal_base(goal(existing_investment_earmarked=50_000_000), client(), "Moderate", A, 0.0)
    assert done["required_sip"] == 0


def test_step_up_reduces_first_year_sip():
    a = pl.goal_base(goal(years_to_goal=15), client(), "Moderate", A, 0.0)["required_sip"]
    b = pl.goal_base(goal(years_to_goal=15), client(), "Moderate", A, 0.10)["required_sip"]
    assert b < a


def test_retirement_goal_uses_corpus_formula():
    c = client(monthly_expenses=60000)
    g = pl.goal_base(goal(type="retirement", target_amount_today=0, years_to_goal=25), c, "Moderate", A, 0.0)
    annual = 0.7 * 12 * 60000
    assert g["base_annual_or_target"] == annual
    expect = fm.retirement_corpus(annual, 0.06, 25, 0.065, 85 - 60)
    assert g["future_cost"] == round(expect)
    g2 = pl.goal_base(goal(type="retirement", target_amount_today=900_000, years_to_goal=25), c, "Moderate", A, 0.0)
    assert g2["base_annual_or_target"] == 900_000


def test_priority_funding_order_and_shortfall():
    base = [
        {"name": "low", "priority": 3, "years": 5, "required_sip": 30000},
        {"name": "high", "priority": 1, "years": 10, "required_sip": 30000},
        {"name": "mid", "priority": 2, "years": 3, "required_sip": 30000},
    ]
    out = pl.fund_goals(
        [dict(b, expected_return=0.09, future_cost=1_000_000, existing_earmarked=0, step_up=0.0,
              inflation=0.06, target_today=800_000, base_annual_or_target=800_000) for b in base],
        50000, A)
    by = {g["name"]: g for g in out}
    assert by["high"]["status"] == "funded" and by["high"]["allocated_sip"] == 30000
    assert by["mid"]["status"] == "partially_funded" and by["mid"]["allocated_sip"] == 20000
    assert by["mid"]["shortfall"] == 10000
    assert by["low"]["status"] == "unfunded" and by["low"]["levers"]["extend_horizon"] is None
    assert sum(g["allocated_sip"] for g in out) == 50000


def test_levers_recalculated_numbers():
    g = pl.goal_base(goal(years_to_goal=10, target_amount_today=5_000_000), client(), "Moderate", A, 0.0)
    out = pl.fund_goals([g], int(g["required_sip"] * 0.8), A)[0]
    lv = out["levers"]
    assert out["status"] == "partially_funded"
    assert lv["extend_horizon"]["required_sip"] <= out["allocated_sip"]
    assert 0 < lv["lower_target"]["fraction"] < 1
    assert [s["step_up"] for s in lv["step_up"]] == [0.05, 0.10]
    assert lv["step_up"][1]["first_year_sip"] < lv["step_up"][0]["first_year_sip"] < g["required_sip"]


def test_build_plan_totals_and_rebalancing():
    plan = pl.build_plan(client(), [goal(), goal(name="H2", years_to_goal=12)], "Moderate")
    assert plan["totals"]["allocated_sip"] <= plan["totals"]["monthly_surplus"]
    assert plan["totals"]["shortfall"] == plan["totals"]["required_sip"] - plan["totals"]["allocated_sip"]
    assert all("monte_carlo" in g for g in plan["goals"])
    assert any("5 percentage points" in r for r in plan["rebalancing"])
