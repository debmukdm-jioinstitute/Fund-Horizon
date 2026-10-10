"""HTTP routes. Engine functions are pure; this layer only validates, persists and serialises."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from app.api.serialize import clean
from app.config import load_allocation, load_assumptions, load_questionnaire
from app.config.disclosures import all_disclosures
from app.data.loader import load_nav
from app.db import sqlite
from app.engine.pipeline import build_full_plan
from app.schemas import PlanRequest

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


@router.get("/api/funds/{scheme_code}")
def fund_detail(scheme_code: str, request: Request):
    from app.data.loader import load_metrics

    m = load_metrics()
    rows = m[m["scheme_code"] == scheme_code]
    if rows.empty:
        raise HTTPException(404, "Scheme not found")
    row = rows.iloc[0]
    keep = ["scheme_code", "scheme_name", "amc", "category", "cat", "plan", "option", "data_quality",
            "history_years", "ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "vol_3y", "sharpe_3y", "sortino_3y",
            "max_drawdown_3y", "max_drawdown_all", "roll1y_median", "roll3y_median", "roll5y_median",
            "last_nav_date"]
    nav = load_nav(scheme_code)
    eligible = request.app.state.eligible
    return clean({
        **{k: row[k] for k in keep},
        "eligible_for_shortlist": bool((eligible["scheme_code"] == scheme_code).any()),
        "nav_monthly": [{"date": str(d.date()), "nav": float(v)} for d, v in nav.items()],
    })
