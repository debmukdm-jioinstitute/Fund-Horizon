"""Full financial planning: cash flow, emergency fund, insurance, goals, priority funding.

All pure functions of (client, goals, band, assumptions). No I/O.
"""
from __future__ import annotations

import math

from app.config import load_assumptions
from app.engine import finmath as fm
from app.engine.allocation import goal_allocation, to_asset_classes
from app.engine.insurance import health_target, term_need
from app.engine.montecarlo import simulate, sip_for_success
from app.schemas import Client, EmploymentType, Goal, GoalType


def cashflow(client: Client) -> dict:
    """Monthly surplus, savings rate and net-worth statement."""
    outgo = client.monthly_expenses + client.monthly_emi
    surplus = client.monthly_income - outgo
    return {
        "monthly_income": client.monthly_income,
        "monthly_outgo": outgo,
        "monthly_surplus": surplus,
        "savings_rate": (surplus / client.monthly_income) if client.monthly_income else None,
        "net_worth": {
            "liquid_assets": client.liquid_assets,
            "investments": client.investments,
            "liabilities": client.liabilities,
            "total": client.liquid_assets + client.investments - client.liabilities,
        },
    }


def emergency_fund(client: Client, a: dict) -> dict:
    """Target = months x (expenses + EMI); months 6 (9 for variable income). Gap closes at a
    share of the monthly surplus."""
    e = a["emergency"]
    months = e["months_variable_income"] if client.employment_type == EmploymentType.freelance_variable else e["months"]
    outgo = client.monthly_expenses + client.monthly_emi
    target = months * outgo
    gap = max(target - client.liquid_assets, 0)
    surplus = client.monthly_income - outgo
    budget = e["surplus_share_for_gap"] * max(surplus, 0)
    return {
        "target_months": months,
        "target": int(target),
        "current": client.liquid_assets,
        "current_months": round(client.liquid_assets / outgo, 2) if outgo else None,
        "gap": int(gap),
        "monthly_allocation": int(budget),
        "months_to_close": math.ceil(gap / budget) if gap > 0 and budget > 0 else (0 if gap == 0 else None),
    }


def insurance_plan(client: Client, a: dict) -> dict:
    ins = a["insurance"]
    t = term_need(
        client.age, client.retirement_age, client.monthly_income,
        client.investments, client.liquid_assets, client.liabilities, ins,
    )
    h_target = health_target(client.age, client.dependents, ins)
    return {
        "term": {**t, "cover": client.term_cover, "gap": max(t["need"] - client.term_cover, 0)},
        "health": {
            "target": h_target,
            "cover": client.health_cover,
            "gap": max(h_target - client.health_cover, 0),
        },
    }


def _expected_return(mix_pct: dict[str, float], a: dict) -> float:
    return sum(mix_pct[k] / 100.0 * a["asset_returns"][k] for k in mix_pct)


def _future_cost(goal: Goal, client: Client, a: dict) -> tuple[float, float]:
    """(future cost or retirement corpus, annual spending today used for retirement else target)."""
    infl = a["inflation"][goal.type.value]
    if goal.type == GoalType.retirement:
        annual = goal.target_amount_today or (
            a["retirement"]["spend_ratio_if_unspecified"] * 12 * client.monthly_expenses
        )
        years_in_ret = max(a["retirement"]["life_expectancy"] - client.retirement_age, 1)
        corpus = fm.retirement_corpus(
            annual, infl, goal.years_to_goal, a["retirement"]["post_retirement_return"], years_in_ret
        )
        return corpus, float(annual)
    return fm.inflate(goal.target_amount_today, infl, goal.years_to_goal), float(goal.target_amount_today)


def _req_sip(future: float, ret: float, years: int, existing: float, step_up: float) -> float:
    r = fm.monthly_rate(ret)
    return fm.required_sip(future, r, years * 12, True, step_up, fm.fv_lumpsum(existing, ret, years))


def goal_base(goal: Goal, client: Client, band: str, a: dict, step_up: float) -> dict:
    """Unfunded goal maths: allocation, future cost, expected return, required SIP."""
    alloc = goal_allocation(band, goal.years_to_goal)
    mix = to_asset_classes(alloc)
    ret = _expected_return(mix, a)
    future, base_amount = _future_cost(goal, client, a)
    req = math.ceil(_req_sip(future, ret, goal.years_to_goal, goal.existing_investment_earmarked, step_up))
    return {
        "name": goal.name, "type": goal.type.value, "priority": goal.priority,
        "years": goal.years_to_goal,
        "target_today": goal.target_amount_today, "base_annual_or_target": base_amount,
        "inflation": a["inflation"][goal.type.value],
        "future_cost": int(round(future)),
        "existing_earmarked": goal.existing_investment_earmarked,
        "existing_grown": int(round(fm.fv_lumpsum(goal.existing_investment_earmarked, ret, goal.years_to_goal))),
        "allocation": alloc, "asset_mix": mix, "expected_return": ret,
        "required_sip": req, "step_up": step_up,
    }


def _levers(g: dict, budget: int, a: dict) -> dict:
    """Ways to close a SIP shortfall, recalculated: longer horizon, step-up, lower target."""
    ret, fut, years = g["expected_return"], g["future_cost"], g["years"]
    out: dict = {"extend_horizon": None, "step_up": [], "lower_target": None}
    infl = g["inflation"]
    if budget > 0:
        for n in range(1, a["planning"]["extend_horizon_max_years"] + 1):
            fut_n = fut * (1 + infl) ** n   # target keeps inflating while we wait
            if _req_sip(fut_n, ret, years + n, g["existing_earmarked"], g["step_up"]) <= budget:
                out["extend_horizon"] = {
                    "extra_years": n,
                    "required_sip": math.ceil(_req_sip(fut_n, ret, years + n, g["existing_earmarked"], g["step_up"])),
                }
                break
        factor = fm.sip_fv_factor(fm.monthly_rate(ret), years * 12, True, g["step_up"])
        achievable = budget * factor + fm.fv_lumpsum(g["existing_earmarked"], ret, years)
        ratio = min(achievable / fut, 1.0) if fut else 1.0
        out["lower_target"] = {"target_today": int(g["base_annual_or_target"] * ratio), "fraction": round(ratio, 4)}
    for s in a["planning"]["step_up_options"]:
        if s > g["step_up"]:
            need = math.ceil(_req_sip(fut, ret, years, g["existing_earmarked"], s))
            out["step_up"].append({"step_up": s, "first_year_sip": need, "fits_budget": need <= budget})
    return out


def fund_goals(goals: list[dict], surplus: int, a: dict) -> list[dict]:
    """Fund by priority (1 first, then shorter horizon). Adds allocated_sip, shortfall, status,
    levers (when underfunded)."""
    remaining = max(surplus, 0)
    order = sorted(range(len(goals)), key=lambda i: (goals[i]["priority"], goals[i]["years"], i))
    out = [dict(g) for g in goals]
    for i in order:
        g = out[i]
        alloc = min(g["required_sip"], remaining)
        remaining -= alloc
        g["allocated_sip"] = int(alloc)
        g["shortfall"] = int(g["required_sip"] - alloc)
        g["status"] = (
            "funded" if g["shortfall"] == 0
            else "partially_funded" if alloc > 0 else "unfunded"
        )
        g["levers"] = _levers(g, int(alloc), a) if g["shortfall"] > 0 else None
    return out


def add_monte_carlo(g: dict, a: dict) -> dict:
    """Attach success probability at the funded SIP, P10/P50/P90, fan and SIP for target success."""
    mc = a["montecarlo"]
    sim = simulate(
        g["asset_mix"], g["years"], g["existing_earmarked"], g["allocated_sip"], g["step_up"],
        g["future_cost"], mc,
    )
    needed = sip_for_success(g["asset_mix"], g["years"], g["existing_earmarked"], g["step_up"], g["future_cost"], mc)
    return {**g, "monte_carlo": {**sim, "sip_for_target_success": needed, "target_success": mc["target_success"]}}


def rebalancing_rules(a: dict) -> list[str]:
    band = a["rebalancing"]["drift_band_pp"]
    return [  # TODO(owner-compliance-review): user-facing copy
        "Review the portfolio once a year.",
        f"Rebalance if any asset class drifts more than {band} percentage points from its target.",
        "Prefer directing new SIPs to the under-weight asset class before selling anything.",
    ]


def build_plan(client: Client, goals: list[Goal], band: str, assumptions: dict | None = None,
               step_up: float = 0.0) -> dict:
    """Assemble the complete planning section (without fund selection)."""
    a = assumptions or load_assumptions()
    cf = cashflow(client)
    # Emergency-fund top-up is not deducted from goal funding; it is shown as a separate action.
    base = [goal_base(g, client, band, a, step_up) for g in goals]
    funded = fund_goals(base, cf["monthly_surplus"], a)
    with_mc = [add_monte_carlo(g, a) for g in funded]
    total_req = sum(g["required_sip"] for g in with_mc)
    return {
        "cashflow": cf,
        "emergency_fund": emergency_fund(client, a),
        "insurance": insurance_plan(client, a),
        "goals": with_mc,
        "totals": {
            "required_sip": total_req,
            "allocated_sip": sum(g["allocated_sip"] for g in with_mc),
            "monthly_surplus": cf["monthly_surplus"],
            "shortfall": sum(g["shortfall"] for g in with_mc),
        },
        "rebalancing": rebalancing_rules(a),
        "step_up": step_up,
    }
