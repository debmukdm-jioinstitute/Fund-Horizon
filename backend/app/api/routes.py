"""HTTP routes. Engine functions are pure; this layer only validates, persists and serialises."""
from __future__ import annotations

import re

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.api.serialize import clean
from app.config import load_allocation, load_assumptions, load_questionnaire
from app.config.disclosures import (
    ANALYTICS_DISCLAIMER,
    COMPARE_DISCLAIMER,
    PORTFOLIO_DISCLAIMER,
    RANKING_DISCLAIMER,
    all_disclosures,
)
from app.data.loader import load_nav
from app.db import sqlite
from app.engine import analytics as an
from app.engine.funds import rank_category_funds
from app.engine.pipeline import build_full_plan
from app.engine.stress import category_median_series
from app.schemas import PlanRequest, PortfolioAnalyzeRequest

router = APIRouter()


@router.get("/healthz")
def healthz(request: Request):
    ready = getattr(request.app.state, "eligible", None) is not None
    if not ready:
        raise HTTPException(503, "Dataset not loaded")
    return {"status": "ok", "eligible_funds": len(request.app.state.eligible)}


@router.get("/api/questionnaire")
def questionnaire():
    return load_questionnaire()


@router.get("/api/meta")
def meta():
    a = load_assumptions()
    return {
        "disclosures": all_disclosures(),
        "data_asof": a["data_asof"],
        "assumptions": {
            "asset_returns": a["asset_returns"],
            "inflation": a["inflation"],
            "retirement": a["retirement"],
            "monte_carlo": {k: a["montecarlo"][k] for k in ("sims", "asset_mean", "asset_vol", "target_success")},
            "step_up_options": a["planning"]["step_up_options"],
        },
        "bands": load_allocation()["bands"],
    }


def _compute(req: PlanRequest, request: Request) -> dict:
    try:
        return clean(build_full_plan(req, request.app.state.eligible))
    except ValueError as e:
        raise HTTPException(422, detail=str(e)) from e


@router.post("/api/plans")
def create_plan(req: PlanRequest, request: Request):
    result = _compute(req, request)
    plan_id = sqlite.save_plan(req.model_dump(mode="json"), result)
    return {"id": plan_id, **result}


@router.get("/api/plans/{plan_id}")
def get_plan(plan_id: str, request: Request, step_up: float | None = Query(default=None, ge=0, le=0.2)):
    """Stored plan. With ?step_up=, recompute from the stored inputs (not persisted)."""
    row = sqlite.get_plan(plan_id)
    if not row:
        raise HTTPException(404, "Plan not found")
    if step_up is None:
        return {"id": plan_id, **row["result"]}
    req = PlanRequest(**{**row["request"], "step_up": step_up})
    return {"id": plan_id, **_compute(req, request)}


@router.get("/api/plans/{plan_id}/report.pdf")
def plan_report(plan_id: str):
    from app.report.pdf import build_pdf

    row = sqlite.get_plan(plan_id)
    if not row:
        raise HTTPException(404, "Plan not found")
    pdf = build_pdf(row["request"]["client"]["first_name"], row["result"])
    return Response(
        pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="fund-horizon-plan-{plan_id[:8]}.pdf"'},
    )


@router.get("/api/funds/compare")
def compare_funds(
    request: Request,
    codes: str = Query(description="Comma-separated scheme codes to compare (2 to 8 codes)"),
):
    """Side-by-side comparison of 2 to 8 funds including return correlation matrix."""
    scheme_codes = [c.strip() for c in codes.split(",") if c.strip()]
    if len(scheme_codes) < 2 or len(scheme_codes) > 8:
        raise HTTPException(400, "Please provide between 2 and 8 scheme codes to compare.")

    fund_summaries = []
    nav_dict = {}
    for code in scheme_codes:
        try:
            d = fund_detail(code, request)
            nav = load_nav(code)
            nav_dict[code] = nav
            fund_summaries.append({
                "scheme_code": code,
                "scheme_name": d["scheme_name"],
                "category": d["category"],
                "amc": d["amc"],
                "cagr_3y": d.get("cagr_3y"),
                "cagr_5y": d.get("cagr_5y"),
                "vol_3y": d.get("vol_3y"),
                "sharpe_3y": d.get("sharpe_3y"),
                "max_drawdown_3y": d.get("max_drawdown_3y"),
            })
        except HTTPException as e:
            raise HTTPException(e.status_code, f"Error for scheme {code}: {e.detail}") from e

    corr = an.return_correlation_matrix(nav_dict)
    return clean({
        "funds": fund_summaries,
        "correlation": corr,
        "disclaimer": COMPARE_DISCLAIMER,
    })


@router.get("/api/funds/{scheme_code}")
def fund_detail(scheme_code: str, request: Request):
    from app.data.loader import load_metrics

    m = load_metrics()
    rows = m[m["scheme_code"] == scheme_code]
    if rows.empty:
        raise HTTPException(404, "Scheme not found")
    row = rows.iloc[0]

    if row.get("plan") == "Direct":
        target_name = re.sub(r" - Direct Plan - ", " - Regular Plan - ", str(row["scheme_name"]), flags=re.IGNORECASE)
        equiv = m[(m["plan"] == "Regular") & (m["scheme_name"].str.lower() == target_name.lower())]
        if not equiv.empty:
            eq = equiv.iloc[0]
            raise HTTPException(
                404,
                f"Direct plans are not offered; see Regular equivalent {eq['scheme_code']} ({eq['scheme_name']})",
            )
        raise HTTPException(404, "Direct plans are not offered; Fund Horizon distributes Regular plans only.")

    eligible = request.app.state.eligible
    is_eligible = bool((eligible["scheme_code"] == scheme_code).any())
    if not is_eligible:
        dq = row.get("data_quality")
        if dq not in ("ok", "split_adjusted"):
            raise HTTPException(404, f"Scheme {scheme_code} is ineligible due to data quality ({dq})")
        if row.get("structure") != "Open Ended":
            raise HTTPException(404, f"Scheme {scheme_code} is ineligible: non open-ended scheme")
        raise HTTPException(404, f"Scheme {scheme_code} is ineligible for distribution")

    keep = ["scheme_code", "scheme_name", "amc", "category", "cat", "plan", "option", "data_quality",
            "history_years", "ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "vol_3y", "sharpe_3y", "sortino_3y",
            "max_drawdown_3y", "max_drawdown_all", "roll1y_median", "roll3y_median", "roll5y_median",
            "last_nav_date"]
    nav = load_nav(scheme_code)
    return clean({
        **{k: row[k] for k in keep},
        "eligible_for_shortlist": True,
        "nav_monthly": [{"date": str(d.date()), "nav": float(v)} for d, v in nav.items()],
    })


@router.get("/api/funds/{scheme_code}/analytics")
def fund_analytics(scheme_code: str, request: Request):
    """Deep analytics for a fund: CAGR, rolling returns, SIP XIRR, drawdown, and capture ratios."""
    # First ensure scheme is valid and eligible
    detail = fund_detail(scheme_code, request)
    nav = load_nav(scheme_code)
    eligible = request.app.state.eligible

    # Build category median series for benchmark capture ratios
    cat_median = category_median_series(eligible, detail["cat"], min_funds=3)
    capture = an.capture_ratios(nav, cat_median)

    # Calculate metrics on NAV series
    cagr_1y = an.trailing_return(nav, years=1)
    cagr_3y = an.trailing_return(nav, years=3)
    cagr_5y = an.trailing_return(nav, years=5)
    roll1y = an.rolling_return_stats(nav, window_years=1)
    roll3y = an.rolling_return_stats(nav, window_years=3)
    roll5y = an.rolling_return_stats(nav, window_years=5)

    # 3-year slice for vol and ratios
    start_3y = nav.index[-1] - pd.DateOffset(years=3) if len(nav) > 1 else nav.index[0]
    nav_3y = nav.loc[nav.index >= start_3y]
    vol_3y = an.annualized_volatility(nav_3y)
    sharpe = an.sharpe_ratio(cagr_3y, vol_3y, rf=0.065)
    sortino = an.sortino_ratio(nav_3y, cagr_3y, rf=0.065)
    dd_dur = an.max_drawdown_duration(nav)
    sip_irr = an.sip_xirr(nav)

    return clean({
        "scheme_code": scheme_code,
        "scheme_name": detail["scheme_name"],
        "category": detail["category"],
        "cat": detail["cat"],
        "amc": detail["amc"],
        "last_nav_date": detail["last_nav_date"],
        "returns": {
            "cagr_1y": cagr_1y,
            "cagr_3y": cagr_3y,
            "cagr_5y": cagr_5y,
            "sip_xirr": sip_irr,
        },
        "rolling_returns": {
            "1y": roll1y,
            "3y": roll3y,
            "5y": roll5y,
        },
        "risk": {
            "annualized_volatility_3y": vol_3y,
            "sharpe_3y": sharpe,
            "sortino_3y": sortino,
            "max_drawdown": an.max_drawdown(nav),
            "drawdown_duration": dd_dur,
        },
        "capture_ratios": capture,
        "disclaimer": ANALYTICS_DISCLAIMER,
    })




@router.get("/api/categories/{cat}/ranking")
def category_ranking(cat: str, request: Request):
    """Rank all clean schemes in a canonical category by past-performance composite score."""
    valid_cats = load_allocation().get("asset_class", {})
    if cat not in valid_cats:
        raise HTTPException(404, f"Category '{cat}' is not recognized.")

    ranked = rank_category_funds(cat, request.app.state.eligible)
    return clean({
        "category": cat,
        "total_schemes": len(ranked),
        "rankings": ranked,
        "disclaimer": RANKING_DISCLAIMER,
    })


@router.post("/api/portfolio/analyze")
def analyze_portfolio(req: PortfolioAnalyzeRequest, request: Request):
    """Analyze a user's portfolio: returns, return-correlation overlap, and alternative weights view."""
    total_w = sum(h.weight_pct for h in req.holdings)
    if total_w <= 0:
        raise HTTPException(400, "Total portfolio weight must be positive.")

    nav_dict = {}
    normalized_holdings = []
    for h in req.holdings:
        code = h.scheme_code
        try:
            d = fund_detail(code, request)
            nav = load_nav(code)
            nav_dict[code] = nav
            normalized_holdings.append({
                "scheme_code": code,
                "scheme_name": d["scheme_name"],
                "weight_pct": float(h.weight_pct / total_w * 100.0),
                "cat": d["cat"],
                "cagr_3y": d.get("cagr_3y"),
            })
        except HTTPException as e:
            raise HTTPException(e.status_code, f"Error in holding {code}: {e.detail}") from e

    # Compute correlation matrix and overlap proxy
    corr = an.return_correlation_matrix(nav_dict, threshold=req.correlation_threshold)

    # PyPortfolioOpt illustrative alternative weights
    alt_weights = an.optimize_portfolio_weights(nav_dict, min_weight=0.02, max_weight=0.50)

    return clean({
        "holdings": normalized_holdings,
        "correlation": corr,
        "alternative_weights": alt_weights,
        "disclaimer": PORTFOLIO_DISCLAIMER,
    })


