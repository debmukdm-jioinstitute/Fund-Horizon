"""FastAPI router for Fund Horizon Internal Backoffice."""
from __future__ import annotations

import csv
import io
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse

from app.api.auth import (
    get_current_customer,
    require_backoffice_role,
    require_role,
    require_staff,
    verify_csrf,
    _hash_password,
)
from app.backoffice.collectors import refresh_source
from app.backoffice.providers.manual import ManualImportValidator, get_template_csv
from app.backoffice.repository import BackofficeRepository
from app.backoffice.schemas import (
    ImpactAnalyzeRequest,
    ImpactScenarioRequest,
    ImportCommitRequest,
    ImportPreviewRequest,
    ResearchNoteCreateRequest,
    ResearchNoteUpdateRequest,
    StaffMemberCreateRequest,
    WatchlistCreateRequest,
)
from app.backoffice.service import BackofficeService
from app.db import get_repository

router = APIRouter(prefix="/api/backoffice", tags=["backoffice"])

_SERVICE = BackofficeService()
_REPO = BackofficeRepository()


# ---------------------------------------------------------------------------
# Overview & Market Summary
# ---------------------------------------------------------------------------

@router.get("/overview")
def backoffice_overview(staff: Annotated[dict, Depends(require_staff)]):
    """Aggregate market overview and system telemetry for staff dashboard."""
    overview = _SERVICE.get_market_overview()
    return {
        "data": overview,
        "as_of": overview.get("generated_at"),
        "availability": "ready",
        "freshness": "current",
        "method_version": "1.0.0",
    }


# ---------------------------------------------------------------------------
# Sovereign Yields & Spreads Board
# ---------------------------------------------------------------------------

@router.get("/yields")
def backoffice_yields(staff: Annotated[dict, Depends(require_staff)]):
    """Sovereign tenor curves and cross-country spreads (India, US)."""
    return {
        "data": _SERVICE.get_yields_board(),
        "as_of": "2026-10-09",
        "availability": "ready",
        "freshness": "current",
    }


# ---------------------------------------------------------------------------
# Derivatives & PCR Board
# ---------------------------------------------------------------------------

@router.get("/derivatives")
def backoffice_derivatives(
    staff: Annotated[dict, Depends(require_staff)],
    underlying: str = Query("NIFTY"),
    expiry: str | None = Query(None),
):
    """Option chain, Put-Call Ratio (OI & Volume), and Max Pain."""
    board = _SERVICE.get_derivatives_board(underlying=underlying, expiry=expiry)
    return {
        "data": board,
        "as_of": board.get("snapshot_timestamp"),
        "availability": board.get("status", "ready"),
        "freshness": "current" if board.get("status") == "ready" else "manual_only",
    }


# ---------------------------------------------------------------------------
# Institutional Flows (FII / DII)
# ---------------------------------------------------------------------------

@router.get("/flows")
def backoffice_flows(
    staff: Annotated[dict, Depends(require_staff)],
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
):
    """Daily reported and provisional FII/DII gross buy, sell, and net flows."""
    flows = _REPO.list_flows(start_date=start_date, end_date=end_date)
    return {
        "data": flows,
        "count": len(flows),
        "unit": "inr_crore",
        "availability": "ready" if flows else "manual_only",
        "freshness": "current" if flows else "manual_only",
    }


# ---------------------------------------------------------------------------
# PMS Trackers: Strategy Research & Scoped Client Portfolios
# ---------------------------------------------------------------------------

@router.get("/pms/strategies")
def backoffice_pms_strategies(
    staff: Annotated[dict, Depends(require_staff)],
    provider: str | None = Query(None),
):
    """APMI published PMS strategy returns, AUM, benchmarks, and horizons."""
    strategies = _REPO.list_pms_strategies(provider=provider)
    return {
        "data": strategies,
        "count": len(strategies),
        "source": "APMI",
        "availability": "ready" if strategies else "manual_only",
    }


@router.get("/pms/accounts")
def backoffice_pms_accounts(staff: Annotated[dict, Depends(require_staff)]):
    """List PMS accounts within user's scope (RM scoped to assigned households, Admin sees all)."""
    accounts = _REPO.list_pms_accounts()
    if staff.get("role") == "rm":
        # Filter accounts assigned to this RM
        user_id = staff["id"]
        accounts = [a for a in accounts if a.get("customer_id") == user_id or a.get("household_id") == user_id]
    return {"data": accounts, "count": len(accounts)}


@router.get("/pms/accounts/{account_id}/tracker")
def backoffice_pms_account_tracker(
    account_id: str,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Detailed PMS account ledger: holdings, cash flows, valuations, XIRR, and HWM fee estimates."""
    tracker = _SERVICE.repo.get_pms_account_tracker(account_id)
    if not tracker:
        raise HTTPException(404, "PMS account not found")

    # RM access control to prevent IDOR across clients
    if staff.get("role") == "rm":
        user_id = staff["id"]
        if tracker.get("customer_id") != user_id and tracker.get("household_id") != user_id:
            raise HTTPException(403, "Access to this client account is restricted to assigned RM.")

    return {"data": tracker}


# ---------------------------------------------------------------------------
# Mutual Fund Tracker
# ---------------------------------------------------------------------------

@router.get("/mutual-funds/tracker")
def backoffice_mf_tracker(
    staff: Annotated[dict, Depends(require_staff)],
    search: str | None = Query(None),
    amc: str | None = Query(None),
    category: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Search and compare mutual fund schemes with AMFI daily NAV values and metrics."""
    db_repo = get_repository()
    funds = db_repo.list_funds(limit=limit, offset=offset)
    if search:
        s = search.lower()
        funds = [f for f in funds if s in f.get("scheme_name", "").lower() or s in str(f.get("scheme_code", ""))]
    if amc:
        funds = [f for f in funds if f.get("amc") == amc]
    if category:
        funds = [f for f in funds if f.get("category") == category]

    return {"data": funds, "count": len(funds), "limit": limit, "offset": offset}


# ---------------------------------------------------------------------------
# Explainable Impact Engine
# ---------------------------------------------------------------------------

@router.post("/impact/analyze")
def backoffice_impact_analyze(
    body: ImpactAnalyzeRequest,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Empirical OLS elasticity, rolling correlation, and lag analysis between pairs."""
    return _SERVICE.analyze_impact(
        series_x_id=body.series_x_id,
        series_y_id=body.series_y_id,
        horizon_days=body.horizon_days,
        lag_days=body.lag_days,
    )


@router.post("/impact/scenario")
def backoffice_impact_scenario(
    body: ImpactScenarioRequest,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Macroeconomic shock scenario simulation (duration shocks, USD rally, oil inflation)."""
    return _SERVICE.simulate_scenario(
        usd_shock_pct=body.usd_shock_pct,
        us_yield_shock_bps=body.us_yield_shock_bps,
        oil_shock_pct=body.oil_shock_pct,
        modified_duration=body.modified_duration,
    )


@router.get("/briefing")
def backoffice_briefing(staff: Annotated[dict, Depends(require_staff)]):
    """Deterministic daily research briefing generated from observed data (zero LLM)."""
    return _SERVICE.get_research_briefing()


# ---------------------------------------------------------------------------
# Watchlists & Research Notes
# ---------------------------------------------------------------------------

@router.get("/watchlists")
def list_watchlists(staff: Annotated[dict, Depends(require_staff)]):
    return {"data": _REPO.list_watchlists(staff["id"])}


@router.post("/watchlists", status_code=201)
def add_watchlist(
    body: WatchlistCreateRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return _REPO.add_watchlist_item(staff["id"], body.name, body.item_type, body.item_id)


@router.delete("/watchlists/{item_id}")
def delete_watchlist(
    item_id: str,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    ok = _REPO.delete_watchlist_item(item_id, staff["id"])
    if not ok:
        raise HTTPException(404, "Watchlist item not found")
    return {"success": True}


@router.get("/research-notes")
def list_research_notes(
    staff: Annotated[dict, Depends(require_staff)],
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
):
    return {"data": _REPO.list_research_notes(entity_type, entity_id)}


@router.post("/research-notes", status_code=201)
def add_research_note(
    body: ResearchNoteCreateRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return _REPO.add_research_note(
        staff_id=staff["id"],
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        title=body.title,
        content=body.content,
        tags=body.tags,
    )


# ---------------------------------------------------------------------------
# Manual Imports Engine
# ---------------------------------------------------------------------------

@router.get("/imports/template/{import_type}", response_class=PlainTextResponse)
def get_import_template(import_type: str, staff: Annotated[dict, Depends(require_staff)]):
    """Download CSV template for manual import."""
    try:
        csv_str = get_template_csv(import_type)
        return PlainTextResponse(content=csv_str, media_type="text/csv")
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/imports/preview")
def preview_manual_import(
    body: ImportPreviewRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Validate and preview import file rows with detailed error reporting."""
    verify_csrf(request)
    return ManualImportValidator.preview(body.import_type, body.csv_content)


@router.post("/imports/commit")
def commit_manual_import(
    body: ImportCommitRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Validate and atomically commit manual import rows."""
    verify_csrf(request)
    res = _SERVICE.commit_manual_import(body.import_type, body.filename, body.csv_content, staff["id"])
    if not res.get("success"):
        raise HTTPException(422, res.get("error", "Import validation failed"))
    return res


# ---------------------------------------------------------------------------
# System Health & Collector Controls
# ---------------------------------------------------------------------------

@router.get("/data-health")
def backoffice_data_health(staff: Annotated[dict, Depends(require_staff)]):
    """Detailed data health, source statuses, quotas, and recent audit events."""
    sources = _REPO.list_sources()
    audits = _REPO.list_audit_events(limit=25)
    return {
        "sources": sources,
        "recent_audits": audits,
        "as_of": datetime.now(UTC).isoformat(),
    }


@router.post("/sources/{source_id}/refresh")
async def trigger_source_refresh(
    source_id: str,
    request: Request,
    staff: Annotated[dict, Depends(require_backoffice_role("admin", "operations"))],
):
    """Manually trigger background refresh of an automated source."""
    verify_csrf(request)
    res = await refresh_source(source_id)
    _REPO.log_audit(
        staff_id=staff["id"],
        action="source_refresh_triggered",
        target_type="source",
        target_id=source_id,
        details=res,
    )
    return res


# ---------------------------------------------------------------------------
# Staff Provisioning (Admin Only)
# ---------------------------------------------------------------------------

@router.post("/staff/provision", status_code=201)
def provision_staff_member(
    body: StaffMemberCreateRequest,
    request: Request,
    admin: Annotated[dict, Depends(require_role("admin"))],
):
    """Admin endpoint to create or promote staff accounts."""
    verify_csrf(request)
    repo = get_repository()
    email = body.email.strip().lower()
    existing = repo.get_customer_by_email(email)
    pwd_hash = _hash_password(body.password)

    if existing:
        updated = repo.update_customer(
            existing["id"],
            {
                "name": body.name,
                "role": body.role,
                "is_staff": 1,
                "status": "active",
                "password_hash": pwd_hash,
                "must_change_password": 1 if body.temp_password else 0,
            },
        )
        _REPO.log_audit(admin["id"], "staff_promoted", "staff", existing["id"], {"email": email, "role": body.role})
        return {"success": True, "action": "promoted", "staff": updated}
    else:
        created = repo.create_customer(
            name=body.name,
            email=email,
            mobile=body.mobile,
            password_hash=pwd_hash,
            role=body.role,
        )
        repo.update_customer(
            created["id"],
            {
                "is_staff": 1,
                "status": "active",
                "must_change_password": 1 if body.temp_password else 0,
            },
        )
        _REPO.log_audit(admin["id"], "staff_created", "staff", created["id"], {"email": email, "role": body.role})
        return {"success": True, "action": "created", "staff": created}
