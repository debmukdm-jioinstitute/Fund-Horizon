"""Full financial planning: cash flow, emergency fund, insurance, goals, priority funding.

All pure functions of (client, goals, band, assumptions). No I/O.
"""
from __future__ import annotations

# TODO(owner-compliance-review): rebalancing text below is user-facing copy.
import math

from app.config import load_assumptions
from app.engine import finmath as fm
from app.engine import tax as tx
from app.engine.allocation import goal_allocation, to_asset_classes
from app.engine.insurance import health_target, term_need
from app.engine.montecarlo import simulate, sip_for_success
from app.schemas import Client, EmploymentType, Goal, GoalType

DEFAULT_MIN_YEARS_IN_RETIREMENT = 20


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
        dependents=client.dependents,
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


def cap_earmarks(amounts: list[int], cap: int) -> list[int]:
    """Scale earmarks so their sum does not exceed declared investments."""
    total = sum(amounts)
    if total <= cap:
        return list(amounts)
    if cap <= 0 or total <= 0:
        return [0] * len(amounts)
    raw = [cap * a / total for a in amounts]
    out = [int(x) for x in raw]
    leftover = cap - sum(out)
    order = sorted(range(len(out)), key=lambda i: (raw[i] - out[i], -i), reverse=True)
    for i in order:
        if leftover <= 0:
            break
        out[i] += 1
        leftover -= 1
    return out


def _expected_return(mix_pct: dict[str, float], a: dict) -> float:
    return sum(mix_pct[k] / 100.0 * a["asset_returns"][k] for k in mix_pct)


def _years_in_retirement(client: Client, a: dict) -> int:
    """Years the retirement corpus must last. Floored so a late retirement age is not a 5-year plan."""
    life = int(a["retirement"]["life_expectancy"])
    floor = int(a["retirement"].get("min_years_in_retirement", DEFAULT_MIN_YEARS_IN_RETIREMENT))
    return max(life - client.retirement_age, floor)


def _future_cost(goal: Goal, client: Client, a: dict) -> tuple[float, float, int | None]:
    """(future cost or retirement corpus, annual spending today used for retirement else target,
    years in retirement or None)."""
    infl = a["inflation"][goal.type.value]
    if goal.type == GoalType.retirement:
        annual = goal.target_amount_today or (
            a["retirement"]["spend_ratio_if_unspecified"] * 12 * client.monthly_expenses
        )
        years_in_ret = _years_in_retirement(client, a)
        corpus = fm.retirement_corpus(
            annual, infl, goal.years_to_goal, a["retirement"]["post_retirement_return"], years_in_ret
        )
        return corpus, float(annual), years_in_ret
    return fm.inflate(goal.target_amount_today, infl, goal.years_to_goal), float(goal.target_amount_today), None


def _req_sip(future: float, ret: float, years: int, existing: float, step_up: float, grow_at: float) -> float:
    r = fm.monthly_rate(ret)
    return fm.required_sip(future, r, years * 12, True, step_up, fm.fv_lumpsum(existing, grow_at, years))


def _earmark_growth(goal_return: float, a: dict) -> float:
    """Grow earmarks at the more conservative of the goal mix and the debt planning rate."""
    return min(goal_return, float(a["asset_returns"]["debt"]))


def goal_base(goal: Goal, client: Client, band: str, a: dict, step_up: float,
              earmarked: int | None = None, emergency: dict | None = None) -> dict:
    """Unfunded goal maths: allocation, future cost, expected return, required SIP.

    Earmarks grow at a conservative rate (never faster than the debt planning return).
    An emergency-type goal is unified with the emergency-fund calculator when `emergency`
    is provided: target is at least the EF target and current liquid assets are credited.
    """
    alloc = goal_allocation(band, goal.years_to_goal)
    mix = to_asset_classes(alloc)
    ret = _expected_return(mix, a)
    grow_at = _earmark_growth(ret, a)
    existing = goal.existing_investment_earmarked if earmarked is None else earmarked
    requested = goal.existing_investment_earmarked
    years_in_ret = None
    unified = False
    if goal.type == GoalType.emergency and emergency is not None:
        target_today = max(goal.target_amount_today, emergency["target"])
        existing = max(existing, emergency["current"])
        future, base_amount = float(target_today), float(target_today)
        infl = a["inflation"][goal.type.value]
        unified = True
    else:
        future, base_amount, years_in_ret = _future_cost(goal, client, a)
        target_today = goal.target_amount_today
        infl = a["inflation"][goal.type.value]
    req = math.ceil(_req_sip(future, ret, goal.years_to_goal, existing, step_up, grow_at))
    out = {
        "name": goal.name, "type": goal.type.value, "priority": goal.priority,
        "years": goal.years_to_goal,
        "target_today": target_today, "base_annual_or_target": base_amount,
        "inflation": infl,
        "future_cost": int(round(future)),
        "existing_earmarked_requested": requested,
        "existing_earmarked": int(existing),
        "earmark_capped": int(existing) < requested,
        "earmark_growth": grow_at,
        "existing_grown": int(round(fm.fv_lumpsum(existing, grow_at, goal.years_to_goal))),
        "allocation": alloc, "asset_mix": mix, "expected_return": ret,
        "required_sip": req, "step_up": step_up,
        "unified_emergency": unified,
    }
    if years_in_ret is not None:
        out["years_in_retirement"] = years_in_ret
    return out


def _levers(g: dict, budget: int, a: dict) -> dict:
    """Ways to close a SIP shortfall, recalculated: longer horizon, step-up, lower target."""
    ret, fut, years = g["expected_return"], g["future_cost"], g["years"]
    grow_at = g.get("earmark_growth", ret)
    out: dict = {"extend_horizon": None, "step_up": [], "lower_target": None}
    infl = g["inflation"]
    if budget > 0:
        for n in range(1, a["planning"]["extend_horizon_max_years"] + 1):
            fut_n = fut * (1 + infl) ** n   # target keeps inflating while we wait
            if _req_sip(fut_n, ret, years + n, g["existing_earmarked"], g["step_up"], grow_at) <= budget:
                out["extend_horizon"] = {
                    "extra_years": n,
                    "required_sip": math.ceil(
                        _req_sip(fut_n, ret, years + n, g["existing_earmarked"], g["step_up"], grow_at)
                    ),
                }
                break
        factor = fm.sip_fv_factor(fm.monthly_rate(ret), years * 12, True, g["step_up"])
        achievable = budget * factor + fm.fv_lumpsum(g["existing_earmarked"], grow_at, years)
        ratio = min(achievable / fut, 1.0) if fut else 1.0
        out["lower_target"] = {"target_today": int(g["base_annual_or_target"] * ratio), "fraction": round(ratio, 4)}
    for s in a["planning"]["step_up_options"]:
        if s > g["step_up"]:
            need = math.ceil(_req_sip(fut, ret, years, g["existing_earmarked"], s, grow_at))
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


def _split_fund(base: list[dict], reserved: int, other_budget: int, a: dict) -> list[dict]:
    """Fund emergency-type goals from the reserved EF share; all other goals from leftover surplus."""
    em_idx = [i for i, g in enumerate(base) if g["type"] == GoalType.emergency.value]
    other_idx = [i for i, g in enumerate(base) if g["type"] != GoalType.emergency.value]
    funded: list[dict | None] = [None] * len(base)
    if em_idx:
        for i, g in zip(em_idx, fund_goals([base[i] for i in em_idx], reserved, a)):
            funded[i] = g
    if other_idx:
        for i, g in zip(other_idx, fund_goals([base[i] for i in other_idx], other_budget, a)):
            funded[i] = g
    return [g for g in funded if g is not None]


def build_plan(client: Client, goals: list[Goal], band: str, assumptions: dict | None = None,
               step_up: float = 0.0, post_tax_marginal: float | None = None, extra_surplus: int = 0) -> dict:
    """Assemble the complete planning section (without fund selection).

    When the emergency-fund gap is positive, `surplus_share_for_gap` is reserved before
    other goals are funded. Emergency-type goals are unified with that calculator and
    funded from the reserved share. Earmarks are capped at declared investments.

    post_tax_marginal: when set, each goal is sized on after-tax asset returns for its own horizon
    (engine/tax.py::apply_post_tax). extra_surplus: monthly rupees added to the non-emergency budget
    (tax saved and reinvested).
    """
    a = assumptions or load_assumptions()
    goal_a = [
        tx.apply_post_tax(a, g.years_to_goal, post_tax_marginal) if post_tax_marginal is not None else a
        for g in goals
    ]
    cf = cashflow(client)
    ef = emergency_fund(client, a)
    reserved = ef["monthly_allocation"] if ef["gap"] > 0 else 0
    other_budget = max(int(cf["monthly_surplus"]) - reserved, 0) + max(int(extra_surplus), 0)
    earmarks = cap_earmarks([g.existing_investment_earmarked for g in goals], client.investments)
    base = [
        goal_base(g, client, band, ga, step_up, earmarked=e, emergency=ef)
        for g, e, ga in zip(goals, earmarks, goal_a)
    ]
    funded = _split_fund(base, reserved, other_budget, a)
    with_mc = [add_monte_carlo(g, ga) for g, ga in zip(funded, goal_a)]
    total_req = sum(g["required_sip"] for g in with_mc)
    allocated = sum(g["allocated_sip"] for g in with_mc)
    surplus = int(cf["monthly_surplus"])
    em_alloc = sum(g["allocated_sip"] for g in with_mc if g["type"] == GoalType.emergency.value)
    leftover_reserved = max(int(reserved) - em_alloc, 0)
    return {
        "cashflow": cf,
        "emergency_fund": ef,
        "insurance": insurance_plan(client, a),
        "goals": with_mc,
        "totals": {
            "required_sip": total_req,
            "allocated_sip": allocated,
            "monthly_surplus": surplus,
            "shortfall": sum(g["shortfall"] for g in with_mc),
            "emergency_reserved": int(reserved),
            "unused_surplus": surplus + max(int(extra_surplus), 0) - allocated - leftover_reserved,
            "tax_reinvested": max(int(extra_surplus), 0),
        },
        "rebalancing": rebalancing_rules(a),
        "step_up": step_up,
    }
