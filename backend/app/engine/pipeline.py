"""End-to-end plan builder used by the API and tests. Pure given the dataset DataFrame."""
from __future__ import annotations

import pandas as pd

from app.config import load_allocation, load_assumptions
from app.config.disclosures import all_disclosures
from app.engine.allocation import to_asset_classes, weighted_allocation
from app.engine.funds import select_funds
from app.engine.insurance_suggest import suggest_cover_plans
from app.engine.planning import build_plan
from app.engine.profiling import build_profile
from app.engine.stress import stress_test
from app.schemas import PlanRequest

_EMPTY_ASSET = {"equity": 0.0, "debt": 0.0, "gold": 0.0, "liquid": 0.0}


def _empty_stress() -> dict:
    return {
        "crash_2020_drawdown": None,
        "worst_peak_to_trough": 0.0,
        "worst_rolling_12m": None,
        "window_start": None,
        "window_end": None,
        "substituted_share": {},
        "any_substituted": False,
        "path": [],
        "note": "No fund shortlist is built when there is no allocated SIP.",
    }


def _category_to_fund(funds: list[dict]) -> dict[str, dict]:
    mapping: dict[str, dict] = {}
    for f in funds:
        mapping[f["cat"]] = f
        for m in f.get("merged_from") or []:
            mapping[m["cat"]] = f
    return mapping


def _fallback_fund(funds: list[dict], cat: str) -> dict | None:
    """If a goal category was merged away, land rupees on the same sleeve, never on equity
    when the source category is defensive."""
    sleeve_of = load_allocation()["selection"]["sleeve_of"]
    sleeve = sleeve_of.get(cat)
    if sleeve:
        same = [f for f in funds if f.get("sleeve") == sleeve]
        if same:
            return max(same, key=lambda f: (f["weight_pct"], f["scheme_code"]))
        if sleeve != "equity":
            defensive = [f for f in funds if f.get("sleeve") != "equity"]
            if defensive:
                return max(defensive, key=lambda f: (f["weight_pct"], f["scheme_code"]))
    return max(funds, key=lambda f: (f["weight_pct"], f["scheme_code"])) if funds else None


def assign_goal_sips(funds: list[dict], goals: list[dict]) -> None:
    """Paint each fund's suggested SIP from per-goal sleeves, not the blended mix.

    Emergency and other 0% equity SIPs therefore stay in liquid / short-duration (or the
    defensive fund they were merged into) and never buy the equity shortlist.
    """
    mapping = _category_to_fund(funds)
    raw = {f["scheme_code"]: 0.0 for f in funds}
    for g in goals:
        sip = float(g.get("allocated_sip") or 0)
        if sip <= 0:
            continue
        alloc = g["allocation"]
        total_pct = sum(alloc.values()) or 1.0
        for cat, pct in alloc.items():
            fund = mapping.get(cat) or _fallback_fund(funds, cat)
            if fund is None:
                continue
            raw[fund["scheme_code"]] += sip * pct / total_pct
    target = int(sum(g.get("allocated_sip") or 0 for g in goals))
    rounded = {code: int(round(v)) for code, v in raw.items()}
    drift = target - sum(rounded.values())
    if drift and funds:
        order = sorted(funds, key=lambda f: (raw[f["scheme_code"]] - rounded[f["scheme_code"]], raw[f["scheme_code"]]), reverse=True)
        rounded[order[0]["scheme_code"]] += drift
    for f in funds:
        f["suggested_monthly_sip"] = max(rounded.get(f["scheme_code"], 0), 0)


def build_full_plan(req: PlanRequest, eligible: pd.DataFrame) -> dict:
    """profile -> goal plan -> portfolio allocation -> fund shortlist -> stress test."""
    a = load_assumptions(req.assumption_overrides)
    profile = build_profile(req.client, req.answers, a)
    planning = build_plan(req.client, req.goals, profile["band"], a, req.step_up)

    items = [
        (g["allocation"], float(g["allocated_sip"]))
        for g in planning["goals"] if g["allocated_sip"] > 0
    ]
    total_sip = planning["totals"]["allocated_sip"]
    shortlist_omitted = total_sip <= 0 or not items
    if shortlist_omitted:
        portfolio: dict[str, float] = {}
        funds: list[dict] = []
        stress = _empty_stress()
    else:
        portfolio = weighted_allocation(items)
        funds = select_funds(portfolio, eligible, a)
        assign_goal_sips(funds, planning["goals"])
        stress = stress_test(funds, eligible, a)

    return {
        "profile": profile,
        "allocation": {
            "band": profile["band"],
            "weighting": "allocated_sip",
            "by_category": {k: round(v, 4) for k, v in portfolio.items()},
            "by_asset_class": {k: round(v, 4) for k, v in (to_asset_classes(portfolio) if portfolio else _EMPTY_ASSET).items()},
            "per_goal": [
                {"name": g["name"], "years": g["years"], "allocated_sip": g["allocated_sip"],
                 "by_category": g["allocation"], "by_asset_class": g["asset_mix"]}
                for g in planning["goals"]
            ],
        },
        "funds": funds,
        "shortlist_omitted": shortlist_omitted,
        "insurance_suggestions": suggest_cover_plans(req.client, planning["insurance"]),
        "stress_test": stress,
        "planning": planning,
        "disclosures": all_disclosures(),
        "data_asof": a["data_asof"],
        "assumptions": {
            "asset_returns": a["asset_returns"],
            "inflation": a["inflation"],
            "retirement": a["retirement"],
            "emergency_months": a["emergency"]["months"],
            "insurance_personal_share": a["insurance"]["personal_share"],
            "monte_carlo": {k: a["montecarlo"][k] for k in ("sims", "asset_mean", "asset_vol", "target_success")},
            "rebalancing": a["rebalancing"],
        },
    }
