from __future__ import annotations
"""HTTP routes. Engine functions are pure; this layer only validates, persists and serialises."""

import os
import re
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from app.api.auth import get_optional_customer
from app.api.serialize import clean, plan_payload
from app.config import load_allocation, load_assumptions, load_questionnaire
from app.config.disclosures import (
    ANALYTICS_DISCLAIMER,
    COMPARE_DISCLAIMER,
    PORTFOLIO_DISCLAIMER,
    RANKING_DISCLAIMER,
    TAX_RULES_NOTE,
    all_disclosures,
)
from app.data.loader import load_nav
from app.db import sqlite
from app.engine import analytics as an
from app.engine import cas
from app.engine.funds import rank_category_funds
from app.engine.pipeline import build_full_plan
from app.engine.stress import category_median_series
from app.engine.tax import tax_tag_for_category
from app.schemas import (
    ExplainCasRequest,
    ExplainFundRequest,
    ExplainPlanRequest,
    ExplainTaxRequest,
    PlanRequest,
    PortfolioAnalyzeRequest,
    RagAskRequest,
    TaxCalcRequest,
)

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


def _overrides_allowed() -> bool:
    return os.environ.get("FH_ALLOW_ASSUMPTION_OVERRIDES", "true").lower() in ("true", "1", "yes")


def _compute(req: PlanRequest, request: Request) -> dict:
    if req.assumption_overrides and not _overrides_allowed():
        req = req.model_copy(update={"assumption_overrides": None})
    try:
        return clean(build_full_plan(req, request.app.state.eligible))
    except ValueError as e:
        raise HTTPException(422, detail=str(e)) from e


@router.post("/api/plans")
def create_plan(req: PlanRequest, request: Request):
    if req.assumption_overrides and not _overrides_allowed():
        raise HTTPException(422, detail="assumption_overrides are not accepted")
    result = _compute(req, request)
    # Attach the plan to the signed-in customer when one exists; anonymous
    # plan-link flow keeps working with customer_id=None.
    current = get_optional_customer(request)
    saved = sqlite.save_plan(
        req.model_dump(mode="json"), result, customer_id=current["id"] if current else None
    )
    return plan_payload(saved["id"], result, created_at=saved["created_at"], expires_at=saved["expires_at"])


@router.get("/api/plans/{plan_id}")
def get_plan(
    plan_id: str,
    request: Request,
    step_up: float | None = Query(default=None, ge=0, le=0.2),
    regime: str | None = Query(default=None, pattern="^(auto|old|new)$"),
    tax_view: str | None = Query(default=None, pattern="^(pre|post)$"),
    apply: str | None = Query(default=None, max_length=300, description="Comma-separated nudge ids to switch on"),
    reinvest: bool | None = None,
):
    """Stored plan. With any of step_up, regime, tax_view, apply or reinvest, recompute from the
    stored inputs (not persisted)."""
    row = sqlite.get_plan(plan_id)
    if not row:
        raise HTTPException(404, "Plan not found")
    if all(v is None for v in (step_up, regime, tax_view, apply, reinvest)):
        return plan_payload(plan_id, row["result"], created_at=row["created_at"], expires_at=row["expires_at"])
    switches = dict(row["request"].get("tax_switches") or {})
    if regime is not None:
        switches["regime"] = regime
    if tax_view is not None:
        switches["tax_view"] = tax_view
    if apply is not None:
        switches["apply"] = [a.strip() for a in apply.split(",") if a.strip()]
    if reinvest is not None:
        switches["reinvest"] = reinvest
    body = {**row["request"], "tax_switches": switches}
    if step_up is not None:
        body["step_up"] = step_up
    req = PlanRequest(**body)
    return plan_payload(plan_id, _compute(req, request), created_at=row["created_at"], expires_at=row["expires_at"])


@router.delete("/api/plans/{plan_id}")
def delete_plan(plan_id: str):
    row = sqlite.get_plan(plan_id)
    if not row:
        raise HTTPException(404, "Plan not found")
    sqlite.delete_plan(plan_id)
    return Response(status_code=204)


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
        "tax_tag": tax_tag_for_category(str(row["cat"]), bool(row.get("needs_demat", False))),
        "nav_monthly": [{"date": str(d.date()), "nav": float(v)} for d, v in nav.items()],
    })


@router.get("/api/funds/{scheme_code}/reference")
def fund_reference(scheme_code: str):
    """Full AMFI/SEBI reference detail for a scheme: scheme master fields, AMC, fund managers,
    benchmarks, SEBI category definition, manager changes and field provenance (public, no auth)."""
    from app.backoffice.mf_reference import scheme_reference

    out = scheme_reference(scheme_code)
    if out is None:
        raise HTTPException(404, "Scheme not found in reference snapshot")
    return clean(out)


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
    sharpe = an.sharpe_monthly(nav_3y, rf=0.065)
    sortino = an.sortino_monthly(nav_3y, rf=0.065)
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


@router.post("/api/cas/upload")
async def upload_cas(
    file: Annotated[UploadFile, File(description="CAMS or KFintech CAS PDF")],
    password: Annotated[str, Form(description="PDF password (typically PAN or email)")],
    consent: Annotated[bool, Form(description="Explicit consent to parse statement in memory")],
    target_band: Annotated[str | None, Form(description="Optional target risk band to compare allocation against")] = None,
):
    """Parse a CAS statement PDF in memory, computing holdings, XIRR, and allocation."""
    if not consent:
        raise HTTPException(400, "Consent to process CAS statement in memory is required.")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Uploaded file must be a PDF document.")

    pdf_bytes = await file.read()
    try:
        parsed_cas = cas.parse_cas_pdf_bytes(pdf_bytes, password=password)
    except cas.CASValidationError as e:
        raise HTTPException(400, str(e)) from e
    except cas.CASPasswordError as e:
        raise HTTPException(400, str(e)) from e
    except cas.CASParsingError as e:
        raise HTTPException(422, str(e)) from e
    finally:
        del pdf_bytes
        del password

    from app.data.loader import load_metrics

    metrics_df = load_metrics()
    analysis = cas.analyze_cas_data(parsed_cas, metrics_df=metrics_df, target_band=target_band)
    return clean(analysis)


@router.get("/api/rag/ask")
def rag_ask_get(
    query: str = Query(..., min_length=2, description="Search query or question about mutual funds"),
    category: str | None = Query(None, description="Optional category filter"),
    plan: str | None = Query(None, description="Optional plan filter (Regular or Direct)"),
    amc: str | None = Query(None, description="Optional AMC filter"),
    top_k: int = Query(4, ge=1, le=20),
):
    """Retrieve schemes and synthesize a verifiable descriptive answer."""
    from app.rag import answer_query

    filters = {}
    if category:
        filters["category"] = category
    if plan:
        filters["plan"] = plan
    if amc:
        filters["amc"] = amc
    return answer_query(query, filters=filters or None, top_k=top_k)


@router.post("/api/rag/ask")
def rag_ask_post(req: RagAskRequest):
    """POST variant of mutual fund question-answering with structured payload."""
    from app.rag import answer_query

    filters = {}
    if req.category:
        filters["category"] = req.category
    if req.plan:
        filters["plan"] = req.plan
    if req.amc:
        filters["amc"] = req.amc
    return answer_query(req.query, filters=filters or None, top_k=req.top_k)


@router.post("/api/rag/ingest")
def rag_ingest(limit: int = Query(0, description="Limit files ingested; 0 for all")):
    """Ingest markdown documents from knowledge base into ChromaDB."""
    from pathlib import Path

    from app.rag import ingest_documents
    from app.rag.store import get_chroma_dir

    docs_dir = Path(__file__).resolve().parent.parent.parent.parent / "data" / "fundhorizon_mf_rag_dataset" / "schemes_md"
    if not docs_dir.exists():
        docs_dir = Path("data/fundhorizon_mf_rag_dataset/schemes_md")
    if not docs_dir.exists():
        # The scheme markdown files are not shipped with deployments; say so instead of crashing with a 500.
        raise HTTPException(503, "Knowledge base documents are not installed on this server")
    count = ingest_documents(docs_dir, limit=limit if limit > 0 else None)
    return {"ingested": count, "chroma_dir": get_chroma_dir()}


@router.post("/api/ai/explain/plan")
def ai_explain_plan(req: ExplainPlanRequest):
    """Explain a financial plan using AI guardrails with deterministic fallback."""
    from app.ai.explain import explain_plan

    plan_data = req.plan_data
    if not plan_data and req.plan_id:
        row = sqlite.get_plan(req.plan_id)
        if not row:
            raise HTTPException(404, "Plan not found")
        plan_data = row["result"]

    if not plan_data:
        raise HTTPException(400, "Either plan_id or plan_data must be provided")

    return explain_plan(plan_data)


@router.post("/api/ai/explain/fund")
def ai_explain_fund(req: ExplainFundRequest):
    """Explain a mutual fund scheme's metrics using AI guardrails with deterministic fallback."""
    from app.ai.explain import explain_fund
    from app.data.loader import load_metrics

    df = load_metrics()
    sub = df[df["scheme_code"].astype(str) == str(req.scheme_code)]
    if sub.empty:
        raise HTTPException(404, "Scheme not found")

    fund_dict = sub.iloc[0].to_dict()
    return explain_fund(fund_dict)


@router.post("/api/ai/explain/cas")
def ai_explain_cas(req: ExplainCasRequest):
    """Explain CAS portfolio analysis using AI guardrails with deterministic fallback."""
    from app.ai.explain import explain_cas

    if not req.cas_data:
        raise HTTPException(400, "cas_data is required")

    return explain_cas(req.cas_data)


@router.get("/api/insurance/document/{slug}")
def get_insurance_document(
    slug: str,
    action: str = Query("download", description="'download' for PDF brochure or 'web' to redirect to insurer portal"),
):
    """Access or download official insurance plan specifications and brochure document."""
    from fastapi.responses import RedirectResponse, Response

    from app.data.insurance_plans import HEALTH_PLANS, TERM_PLANS
    from app.report.insurance_doc import build_insurance_plan_pdf

    all_plans = TERM_PLANS + HEALTH_PLANS
    matched = next((p for p in all_plans if p.get("slug") == slug), None)
    if not matched:
        raise HTTPException(404, f"Insurance plan '{slug}' not found")

    if action == "web" and matched.get("document_url"):
        return RedirectResponse(url=matched["document_url"])

    pdf_bytes = build_insurance_plan_pdf(matched)
    filename = matched.get("document_name", f"{slug}.pdf")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/tax/rules")
def tax_rules():
    """The tax rules the planner uses, with their sources and review status."""
    from app.config import load_tax_rules

    r = load_tax_rules()
    keep = ("fy", "ay", "as_of", "verified", "cess", "sources", "new_regime", "old_regime", "limits",
            "capital_gains", "tds", "small_savings", "section_labels")
    return {**{k: r[k] for k in keep}, "disclosure": TAX_RULES_NOTE}


@router.get("/api/tax/catalog")
def tax_catalog(q: str | None = Query(default=None, max_length=60), kind: str | None = Query(default=None, max_length=30)):
    """Instruments catalog: what each is, who it suits, lock-in and tax treatment."""
    from app.config import load_tax_catalog

    cat = load_tax_catalog()
    items = cat["instruments"]
    if kind:
        items = [i for i in items if i["kind"] == kind]
    if q:
        needle = q.lower()
        items = [i for i in items if needle in (i["name"] + " " + i["summary"] + " " + i["who_for"]).lower()]
    return {"as_of": cat["as_of"], "fy": cat["fy"], "kinds": cat["kinds"], "instruments": items,
            "disclosure": TAX_RULES_NOTE}


@router.get("/api/tax/catalog/{instrument_id}")
def tax_catalog_item(instrument_id: str):
    from app.config import load_tax_catalog

    cat = load_tax_catalog()
    for i in cat["instruments"]:
        if i["id"] == instrument_id:
            return {"as_of": cat["as_of"], "fy": cat["fy"], "instrument": i, "disclosure": TAX_RULES_NOTE}
    raise HTTPException(404, "Instrument not found")


@router.post("/api/tax/calc")
def tax_calc(req: TaxCalcRequest):
    """Stateless calculator: both regimes, marginal rate, nudges and after-tax returns. Nothing is saved."""
    from app.engine import tax as tx
    from app.engine.tax_plan import build_tax_section

    sw = req.switches.model_dump()
    goals = [{"name": f"Goal {n}", "type": g.type.value, "years": g.years} for n, g in enumerate(req.goals, 1)]
    section = build_tax_section(req.age, req.employment_type.value, req.tax.model_dump(), goals, sw)
    section.pop("_post_tax_marginal", None)
    section.pop("_reinvest_monthly", None)
    marg = section.get("marginal_rate") or 0.0
    a = load_assumptions()
    section["after_tax_returns"] = [
        {"years": y, **{k: round(v, 4) for k, v in tx.post_tax_returns(a["asset_returns"], y, marg).items()}}
        for y in (1, 3, 5, 10, 15)
    ]
    section["pre_tax_returns"] = a["asset_returns"]
    return {**clean(section), "disclosure": TAX_RULES_NOTE}


@router.post("/api/ai/explain/tax")
def ai_explain_tax(req: ExplainTaxRequest):
    """Explain the tax section or one nudge, with guardrails and a deterministic fallback."""
    from app.ai.explain import explain_tax

    tax_data = req.tax_data
    if not tax_data and req.plan_id:
        row = sqlite.get_plan(req.plan_id)
        if not row:
            raise HTTPException(404, "Plan not found")
        tax_data = (row["result"] or {}).get("tax")
    if not tax_data or not tax_data.get("enabled", True):
        raise HTTPException(400, "No tax details to explain. Add tax details to the plan first.")
    return explain_tax(tax_data, req.nudge_id)
