"""End-to-end plan builder used by the API and tests. Pure given the dataset DataFrame."""
from __future__ import annotations

import pandas as pd

from app.config import load_assumptions
from app.config.disclosures import all_disclosures
from app.engine.allocation import goal_allocation, to_asset_classes, weighted_allocation
from app.engine.funds import select_funds
from app.engine.planning import build_plan
from app.engine.profiling import build_profile
from app.engine.stress import stress_test
from app.schemas import PlanRequest


def build_full_plan(req: PlanRequest, eligible: pd.DataFrame) -> dict:
    """profile -> goal plan -> portfolio allocation -> fund shortlist -> stress test."""
    a = load_assumptions(req.assumption_overrides)
    profile = build_profile(req.client, req.answers, a)
    planning = build_plan(req.client, req.goals, profile["band"], a, req.step_up)

    items = [(g["allocation"], float(g["future_cost"] or g["target_today"] or 1)) for g in planning["goals"]]
    portfolio = weighted_allocation(items)
    funds = select_funds(portfolio, eligible, a)
    total_sip = planning["totals"]["allocated_sip"]
    total_w = sum(f["weight_pct"] for f in funds)
    for f in funds:
        f["suggested_monthly_sip"] = int(round(total_sip * f["weight_pct"] / total_w))
    stress = stress_test(funds, eligible, a)

    return {
        "profile": profile,
        "allocation": {
            "band": profile["band"],
            "by_category": {k: round(v, 4) for k, v in portfolio.items()},
            "by_asset_class": {k: round(v, 4) for k, v in to_asset_classes(portfolio).items()},
            "per_goal": [
                {"name": g["name"], "years": g["years"], "by_category": g["allocation"],
                 "by_asset_class": g["asset_mix"]}
                for g in planning["goals"]
            ],
        },
        "funds": funds,
        "stress_test": stress,
        "planning": planning,
        "disclosures": all_disclosures(),
        "data_asof": a["data_asof"],
    }
