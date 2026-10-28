import json
from pathlib import Path

import pytest

from app.engine.pipeline import build_full_plan
from app.engine.profiling import ACTION_EMERGENCY, ACTION_HEALTH_GAP, ACTION_TERM_GAP

GOLD = Path(__file__).parent / "golden"
NAMES = ["young_aggressive", "mid_career_dependents", "near_retirement", "low_emergency_fund"]
def has(r: dict, prefix: str) -> bool:
    return any(a.startswith(prefix) for a in r["profile"]["priority_actions"])


EQUITY_CATS = {"large_cap", "flexi_cap", "mid_cap", "small_cap"}


def summarise(r: dict) -> dict:
    return {
        "profile": {k: r["profile"][k] for k in ("tolerance", "final_score", "band", "priority_actions")}
        | {"capacity": r["profile"]["capacity"]["score"], "mismatch": r["profile"]["mismatch_note"] is not None},
        "asset_class": {k: round(v, 2) for k, v in r["allocation"]["by_asset_class"].items()},
        "funds": [(f["scheme_code"], round(f["weight_pct"], 2)) for f in r["funds"]],
        "goals": [
            {"name": g["name"], "years": g["years"], "future_cost": g["future_cost"],
             "required_sip": g["required_sip"], "allocated_sip": g["allocated_sip"], "status": g["status"],
             "equity": round(g["asset_mix"]["equity"], 2),
             "success_prob": round(g["monte_carlo"]["success_prob"], 3),
             "sip_for_80": g["monte_carlo"]["sip_for_target_success"]}
            for g in r["planning"]["goals"]
        ],
        "totals": {k: r["planning"]["totals"][k] for k in
                   ("allocated_sip", "unused_surplus", "emergency_reserved")},
        "stress": {k: round(r["stress_test"][k], 4) for k in
                   ("crash_2020_drawdown", "worst_peak_to_trough", "worst_rolling_12m")},
    }


@pytest.fixture(scope="module")
def results(personas, eligible):
    return {n: build_full_plan(personas[n], eligible) for n in NAMES}


@pytest.mark.parametrize("name", NAMES)
def test_matches_golden(name, results):
    expected = json.loads((GOLD / f"{name}.json").read_text())
    assert json.loads(json.dumps(summarise(results[name]))) == expected


def test_young_aggressive(results):
    r = results["young_aggressive"]
    assert r["profile"]["band"] == "Aggressive"
    assert r["allocation"]["by_asset_class"]["equity"] > 75
    assert all(g["status"] == "funded" for g in r["planning"]["goals"])
    t = r["planning"]["totals"]
    assert t["unused_surplus"] == t["monthly_surplus"] - t["allocated_sip"]
    assert t["unused_surplus"] > 30_000
    assert has(r, ACTION_TERM_GAP)
    assert has(r, ACTION_HEALTH_GAP)
    assert r["allocation"]["weighting"] == "allocated_sip"
    sip = sum(g["allocated_sip"] for g in r["planning"]["goals"])
    sip_eq = sum(g["allocated_sip"] * g["asset_mix"]["equity"] for g in r["planning"]["goals"]) / sip
    assert r["allocation"]["by_asset_class"]["equity"] == pytest.approx(sip_eq, abs=0.05)


def test_mid_career_not_aggressive_and_underfunded(results):
    r = results["mid_career_dependents"]
    assert r["profile"]["band"] in ("Moderate", "Moderately Conservative")
    assert r["planning"]["totals"]["shortfall"] > 0
    first = next(g for g in r["planning"]["goals"] if g["name"] == "Child education")
    assert first["status"] == "funded"  # priority 1, shortest horizon among priority-1 goals


def test_near_retirement_two_year_goals_have_no_equity(results):
    r = results["near_retirement"]
    assert all(g["asset_mix"]["equity"] == 0 for g in r["planning"]["goals"])
    assert r["allocation"]["by_asset_class"]["equity"] == 0
    assert not has(r, ACTION_TERM_GAP)
    assert has(r, ACTION_HEALTH_GAP)
    assert r["planning"]["insurance"]["term"]["need"] == 0
    assert r["profile"]["mismatch_note"]


def test_low_emergency_fund_flags(results):
    r = results["low_emergency_fund"]
    assert has(r, ACTION_EMERGENCY)
    assert has(r, ACTION_TERM_GAP)
    assert has(r, ACTION_HEALTH_GAP)
    assert r["profile"]["band"] in ("Conservative", "Moderately Conservative", "Moderate")
    ef = r["planning"]["emergency_fund"]
    assert ef["gap"] > 0
    assert ef["target_months"] == 9
    t = r["planning"]["totals"]
    assert t["emergency_reserved"] == ef["monthly_allocation"]
    assert t["allocated_sip"] <= t["monthly_surplus"]
    assert t["unused_surplus"] == 0
    em = next(g for g in r["planning"]["goals"] if g["type"] == "emergency")
    assert em["unified_emergency"] is True
    assert em["target_today"] == ef["target"]
    assert em["asset_mix"]["equity"] == 0
    assert em["allocated_sip"] == ef["monthly_allocation"]
    # Emergency rupees must not be painted onto equity funds.
    ret = next(g for g in r["planning"]["goals"] if g["type"] == "retirement")
    equity_sip = sum(f["suggested_monthly_sip"] for f in r["funds"] if f["cat"] in EQUITY_CATS)
    expected_eq = ret["allocated_sip"] * ret["asset_mix"]["equity"] / 100.0
    assert equity_sip == pytest.approx(expected_eq, abs=2)
    assert r["allocation"]["by_asset_class"]["equity"] < 40


def test_negative_surplus_omits_shortlist(personas, eligible):
    req = personas["young_aggressive"].model_copy(deep=True)
    req.client.monthly_income = 40_000
    req.client.monthly_expenses = 50_000
    req.client.monthly_emi = 15_000
    r = build_full_plan(req, eligible)
    assert r["planning"]["cashflow"]["monthly_surplus"] < 0
    assert r["planning"]["totals"]["allocated_sip"] == 0
    assert r["planning"]["totals"]["unused_surplus"] == r["planning"]["totals"]["monthly_surplus"]
    assert r["shortlist_omitted"] is True
    assert r["funds"] == []
    assert r["allocation"]["by_asset_class"] == {"equity": 0.0, "debt": 0.0, "gold": 0.0, "liquid": 0.0}
    assert r["stress_test"]["path"] == []
