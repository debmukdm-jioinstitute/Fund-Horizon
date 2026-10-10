import json
from pathlib import Path

import pytest

from app.engine.pipeline import build_full_plan

GOLD = Path(__file__).parent / "golden"
NAMES = ["young_aggressive", "mid_career_dependents", "near_retirement", "low_emergency_fund"]


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
    assert "Insurance first" in r["profile"]["priority_actions"]
    assert r["profile"]["mismatch_note"]


def test_low_emergency_fund_flags(results):
    r = results["low_emergency_fund"]
    assert "Build emergency fund first" in r["profile"]["priority_actions"]
    assert "Insurance first" in r["profile"]["priority_actions"]
    assert r["profile"]["band"] in ("Conservative", "Moderately Conservative", "Moderate")
    assert r["planning"]["emergency_fund"]["gap"] > 0
    assert r["planning"]["emergency_fund"]["target_months"] == 9
