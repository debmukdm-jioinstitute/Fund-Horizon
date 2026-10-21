from __future__ import annotations
"""Customer portal v1 view builders.

Pure functions over a stored plan row
(``{"request", "result", "created_at", "expires_at"}``). Stored allocation
values are 0-100 percents; every pct/allocation value returned here is a 0-1
fraction. Internal score maths converts back to the percent scale first.
"""

from datetime import date
from typing import Any

from app.config import load_allocation
from app.engine.finmath import indian_format
from app.schemas import PlanRequest

_DISCLAIMER = "This is an illustration, not a recommendation."
_DECLARED_LABEL = "As declared in your plan inputs — not live market values."

_BUCKETS = ("equity", "debt", "gold", "liquid")

_BAND_EQUITY = {b["name"]: float(b["equity"]) for b in load_allocation()["bands"]}

_STATUS_LABELS = {
    "funded": "Fully funded",
    "partially_funded": "Partially funded",
    "unfunded": "Not funded",
}


def _pct_to_frac(v: Any) -> float:
    """Defensive percent -> fraction: values above 1 are divided by 100."""
    f = float(v or 0)
    return f / 100 if f > 1 else f


def _int(v: Any) -> int:
    try:
        return int(round(float(v or 0)))
    except (TypeError, ValueError):
        return 0


def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _inr(v: Any) -> str:
    return indian_format(float(v or 0))


def _today() -> str:
    return date.today().isoformat()


def _client_name(stored_request: dict) -> str:
    first = (stored_request.get("client") or {}).get("first_name") or "Anonymous"
    return str(first).strip() or "Anonymous"


def _allocation_fractions(result: dict) -> dict[str, float]:
    by_asset = (result.get("allocation") or {}).get("by_asset_class") or {}
    return {b: _pct_to_frac(by_asset.get(b)) for b in _BUCKETS}


def _target_date(as_of: str, years: Any) -> str:
    year, month, _ = as_of.split("-")
    return f"{int(year) + _int(years):04d}-{month}"


def _goal_progress(goal: dict) -> int:
    req = float(goal.get("required_sip") or 0)
    alloc = float(goal.get("allocated_sip") or 0)
    if req <= 0:
        return 100
    return round(min(alloc / req, 1) * 100)


def _goal_view(goal: dict, as_of: str) -> dict:
    mc = goal.get("monte_carlo") or {}
    status = goal.get("status") or ""
    return {
        "name": goal.get("name") or "",
        "type": goal.get("type") or "",
        "target_date": _target_date(as_of, goal.get("years")),
        "target_amount": _int(goal.get("future_cost")),
        "monthly_sip": _int(goal.get("allocated_sip")),
        "required_sip": _int(goal.get("required_sip")),
        "status": status,
        "status_label": _STATUS_LABELS.get(status, ""),
        "success_prob": _opt_float(mc.get("success_prob")),
        "progress_pct": _goal_progress(goal),
    }


def _gaps(planning: dict) -> tuple[int, int, int]:
    ef = planning.get("emergency_fund") or {}
    ins = planning.get("insurance") or {}
    return (
        _int(ef.get("gap")),
        _int((ins.get("term") or {}).get("gap")),
        _int((ins.get("health") or {}).get("gap")),
    )


def _next_step(planning: dict, goals: list[dict]) -> dict:
    ef = planning.get("emergency_fund") or {}
    ins = planning.get("insurance") or {}
    term = ins.get("term") or {}
    health = ins.get("health") or {}
    em_gap, term_gap, health_gap = _gaps(planning)
    if em_gap > 0:
        return {
            "kind": "emergency",
            "title": "Build your emergency fund",
            "detail": (
                f"Your {_int(ef.get('target_months')) or 6}-month safety target is "
                f"{_inr(ef.get('target'))}; {_inr(ef.get('current'))} is already set "
                f"aside — {_inr(em_gap)} more to go."
            ),
            "disclaimer": _DISCLAIMER,
        }
    if term_gap > 0:
        return {
            "kind": "term",
            "title": "Close the term cover gap",
            "detail": (
                f"Your family's income protection is short by {_inr(term_gap)}. "
                f"The plan estimates a need of {_inr(term.get('need'))}."
            ),
            "disclaimer": _DISCLAIMER,
        }
    if health_gap > 0:
        return {
            "kind": "health",
            "title": "Raise your health cover",
            "detail": (
                f"Health cover is short by {_inr(health_gap)} against a target of "
                f"{_inr(health.get('target'))}."
            ),
            "disclaimer": _DISCLAIMER,
        }
    if goals:
        goal = min(goals, key=lambda g: (g["progress_pct"], -g["required_sip"]))
        gap = goal["required_sip"] - goal["monthly_sip"]
        return {
            "kind": "goal",
            "title": f"Bring '{goal['name']}' closer to its target",
            "detail": (
                f"It needs {_inr(goal['required_sip'])}/month but "
                f"{_inr(goal['monthly_sip'])}/month is allocated — "
                f"a {_inr(gap)}/month gap."
            ),
            "disclaimer": _DISCLAIMER,
        }
    return {
        "kind": "goal",
        "title": "Review your plan",
        "detail": "Your plan is ready — walk through each section when you have time.",
        "disclaimer": _DISCLAIMER,
    }


def _alerts(planning: dict, goals: list[dict]) -> list[dict]:
    totals = planning.get("totals") or {}
    em_gap, term_gap, health_gap = _gaps(planning)
    alerts: list[dict] = []
    if em_gap > 0:
        alerts.append({"kind": "emergency", "text": f"Emergency fund is short by {_inr(em_gap)}."})
    if term_gap > 0:
        alerts.append({"kind": "insurance", "text": f"Term cover gap of {_inr(term_gap)}."})
    if health_gap > 0:
        alerts.append({"kind": "insurance", "text": f"Health cover gap of {_inr(health_gap)}."})
    for g in goals:
        if g["status"] != "funded":
            alerts.append({
                "kind": "goal",
                "text": f"'{g['name']}' is {g['status_label'].lower()} — needs {_inr(g['required_sip'])}/month.",
            })
    unused = _int(totals.get("unused_surplus"))
    if unused > 0:
        alerts.append({
            "kind": "surplus",
            "text": f"{_inr(unused)} of monthly surplus is not allocated to any goal.",
        })
    return alerts


def build_dashboard(plan_id: str, row: dict) -> dict:
    """Portal dashboard view for one stored plan."""
    stored_request = row.get("request") or {}
    result = row.get("result") or {}
    client = stored_request.get("client") or {}
    planning = result.get("planning") or {}
    totals = planning.get("totals") or {}
    profile = result.get("profile") or {}
    funds = result.get("funds") or []

    as_of = _today()
    invested = _int(client.get("investments"))
    liquid = _int(client.get("liquid_assets"))
    goals = [_goal_view(g, as_of) for g in planning.get("goals") or []]
    score = profile.get("final_score", profile.get("score"))

    return {
        "plan_id": plan_id,
        "client_name": _client_name(stored_request),
        "as_of": as_of,
        "declared_invested": invested,
        "declared_liquid": liquid,
        "declared_portfolio_value": invested + liquid,
        "declared_label": _DECLARED_LABEL,
        "monthly_sip_commitment": _int(totals.get("allocated_sip")),
        "active_fund_count": sum(1 for f in funds if _int(f.get("suggested_monthly_sip")) > 0),
        "risk_band": profile.get("band") or "",
        "risk_score": int(round(float(score))) if score is not None else None,
        "allocation": _allocation_fractions(result),
        "goals": goals,
        "goal_inputs": stored_request.get("goals") or [],
        "next_step": _next_step(planning, goals),
        "alerts": _alerts(planning, goals),
    }


def _diversification(result: dict) -> tuple[int, dict]:
    by_cat = (result.get("allocation") or {}).get("by_category") or {}
    pcts = {cat: float(v or 0) for cat, v in by_cat.items()}
    funds = result.get("funds") or []
    top_cat = max(pcts, key=lambda c: pcts[c], default="")
    top_pct = pcts.get(top_cat, 0.0)
    score = 100
    if top_pct > 40:
        score -= 15
    if len(funds) < 5:
        score -= 10
    if sum(1 for p in pcts.values() if p > 0) < 4:
        score -= 10
    ctx = {
        "top_cat": top_cat,
        "top_pct": top_pct,
        "n_funds": len(funds),
        "n_cats": sum(1 for p in pcts.values() if p > 0),
    }
    return max(score, 0), ctx


def _health_context(result: dict, planning: dict, goals: list[dict]) -> dict:
    totals = planning.get("totals") or {}
    ef = planning.get("emergency_fund") or {}
    by_asset = (result.get("allocation") or {}).get("by_asset_class") or {}
    profile = result.get("profile") or {}
    band = profile.get("band") or ""
    div_score, div = _diversification(result)
    monthly_sip = _int(totals.get("allocated_sip"))
    return {
        "req": _int(totals.get("required_sip")),
        "alloc": _int(totals.get("allocated_sip")),
        "surplus": _int(totals.get("monthly_surplus")),
        "monthly_sip": monthly_sip,
        "em_gap": _int(ef.get("gap")),
        "em_target": _int(ef.get("target")),
        "em_current": _int(ef.get("current")),
        "band": band,
        "midpoint": _BAND_EQUITY.get(band),
        "equity_pct": _pct_to_frac(by_asset.get("equity")) * 100,
        "div_score": div_score,
        "top_cat": div["top_cat"],
        "top_pct": div["top_pct"],
        "top_sip": int(round(_pct_to_frac(div["top_pct"]) * monthly_sip)),
        "n_funds": div["n_funds"],
    }


def _improvement(key: str, ctx: dict) -> dict:
    builders = {
        "goal_readiness": (
            "Fund goals closer to their target",
            f"Goals need {_inr(ctx['req'])}/month in total and {_inr(ctx['alloc'])}/month "
            f"is allocated — a {_inr(ctx['req'] - ctx['alloc'])}/month gap.",
        ),
        "risk_alignment": (
            "Bring equity in line with your risk band",
            f"Equity is {ctx['equity_pct']:.0f}% of the mix; the {ctx['band']} band "
            f"centres on {ctx['midpoint']:.0f}%.",
        ),
        "diversification": (
            "Spread the SIP across more categories",
            f"{ctx['top_cat']} takes {_inr(ctx['top_sip'])}/month "
            f"({ctx['top_pct']:.0f}%) of the mix across {ctx['n_funds']} funds.",
        ),
        "sip_adequacy": (
            "Close the monthly SIP gap",
            f"Monthly surplus is {_inr(ctx['surplus'])}; the plan needs "
            f"{_inr(ctx['req'])}/month and {_inr(ctx['alloc'])}/month is allocated.",
        ),
        "emergency_readiness": (
            "Top up the emergency fund",
            f"Target {_inr(ctx['em_target'])} with {_inr(ctx['em_current'])} set aside "
            f"— {_inr(ctx['em_gap'])} to go.",
        ),
    }
    title, detail = builders[key]
    return {"title": title, "detail": detail, "disclaimer": _DISCLAIMER}


def build_health(plan_id: str, row: dict) -> dict:
    """Financial-health scores (0-100) plus the three weakest areas to work on."""
    result = row.get("result") or {}
    planning = result.get("planning") or {}
    totals = planning.get("totals") or {}
    goals = [_goal_view(g, _today()) for g in planning.get("goals") or []]

    progress = [g["progress_pct"] for g in goals]
    goal_readiness = round(sum(progress) / len(progress)) if progress else 0

    req = _int(totals.get("required_sip"))
    alloc = _int(totals.get("allocated_sip"))
    sip_adequacy = round(min(alloc / req, 1) * 100) if req > 0 else 100

    ef = planning.get("emergency_fund") or {}
    em_gap = float(ef.get("gap") or 0)
    em_target = float(ef.get("target") or 0)
    if em_gap <= 0:
        emergency_readiness = 100
    elif em_target > 0:
        emergency_readiness = round(max(0.0, 100 - em_gap / em_target * 100))
    else:
        emergency_readiness = 100

    div_score, _ = _diversification(result)

    ctx = _health_context(result, planning, goals)
    midpoint = ctx["midpoint"]
    if midpoint is None:
        risk_alignment = 100
    else:
        risk_alignment = max(0, round(100 - 2 * abs(ctx["equity_pct"] - midpoint)))

    scores = {
        "goal_readiness": int(goal_readiness),
        "risk_alignment": int(risk_alignment),
        "diversification": int(div_score),
        "sip_adequacy": int(sip_adequacy),
        "emergency_readiness": int(emergency_readiness),
    }
    weakest = sorted(scores.items(), key=lambda kv: (kv[1], kv[0]))[:3]
    return {
        "plan_id": plan_id,
        "scores": {**scores, "overall": round(sum(scores.values()) / len(scores))},
        "improvements": [_improvement(key, ctx) for key, _ in weakest],
    }


def build_analytics(plan_id: str, row: dict) -> dict:
    """Allocation, category and AMC mix for one stored plan."""
    result = row.get("result") or {}
    planning = result.get("planning") or {}
    totals = planning.get("totals") or {}
    monthly_sip = _int(totals.get("allocated_sip"))
    funds = result.get("funds") or []

    by_cat = (result.get("allocation") or {}).get("by_category") or {}
    category_mix = []
    for cat, pct in sorted(by_cat.items(), key=lambda kv: float(kv[1] or 0), reverse=True):
        frac = _pct_to_frac(pct)
        if frac <= 0:
            continue
        category_mix.append({
            "category": cat,
            "pct": frac,
            "sip": int(round(frac * monthly_sip)),
        })

    amc_sip: dict[str, float] = {}
    for f in funds:
        amc = f.get("amc") or "Unknown"
        amc_sip[amc] = amc_sip.get(amc, 0.0) + float(f.get("suggested_monthly_sip") or 0)
    total_fund_sip = sum(amc_sip.values())
    amc_mix = [
        {"amc": amc, "pct": sip / total_fund_sip if total_fund_sip > 0 else 0.0}
        for amc, sip in sorted(amc_sip.items(), key=lambda kv: kv[1], reverse=True)
        if sip > 0
    ]

    return {
        "plan_id": plan_id,
        "allocation": _allocation_fractions(result),
        "category_mix": category_mix,
        "amc_mix": amc_mix,
        "fund_count": len(funds),
        "risk_band": (result.get("profile") or {}).get("band") or "",
        "top_category_pct": category_mix[0]["pct"] if category_mix else 0.0,
    }


def recompute_plan(row: dict, body: dict, eligible: Any) -> tuple[dict, dict]:
    """Merge a partial patch over the stored inputs, revalidate and rebuild.

    Only ``client``, ``goals`` and ``answers`` may be patched. Returns the new
    request dict and the rebuilt result. Raises ValueError (pydantic
    ValidationError included) when the merged inputs are invalid.
    """
    stored = dict(row.get("request") or {})
    body = body or {}
    patch = {k: body[k] for k in ("client", "goals", "answers") if k in body}
    req = PlanRequest(**{**stored, **patch})
    result = build_full_plan(req, eligible)
    return req.model_dump(mode="json"), result
