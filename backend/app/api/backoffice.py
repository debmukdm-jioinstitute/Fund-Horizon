"""FastAPI router for Fund Horizon Internal Backoffice."""
from __future__ import annotations

import csv
import io
import secrets
from datetime import UTC, datetime
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
from app.backoffice.analytics.pms_math import calculate_modified_dietz, calculate_xirr, estimate_hwm_fee
from app.backoffice.collectors import refresh_source
from app.backoffice.providers import apmi as apmi_provider
from app.backoffice.providers.nse import NseError
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
    """Sovereign tenor curves and cross-country spreads, from live-collected observations."""
    board = _SERVICE.get_yields_board()
    return {
        "data": board,
        "as_of": board.get("as_of"),
        "availability": board.get("status", "unavailable"),
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
        "freshness": "current" if board.get("live_status") == "live" else "stale",
    }


# ---------------------------------------------------------------------------
# Live News (open RSS feeds)
# ---------------------------------------------------------------------------

@router.get("/news")
def backoffice_news(
    staff: Annotated[dict, Depends(require_staff)],
    limit: int = Query(40, ge=1, le=200),
    category: str | None = Query(None),
    source: str | None = Query(None),
):
    """Latest headlines collected from open RSS feeds (RBI, SEBI, PIB and major Indian business outlets)."""
    items = _REPO.list_news(limit=limit, category=category, source_id=source)
    return {
        "data": items,
        "count": len(items),
        "availability": "ready" if items else "unavailable",
        "freshness": "current",
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
        "availability": "ready" if flows else "unavailable",
        "freshness": "current" if flows else "stale",
    }


# ---------------------------------------------------------------------------
# PMS Trackers: Strategy Research & Scoped Client Portfolios
# ---------------------------------------------------------------------------

@router.get("/pms/strategies")
def backoffice_pms_strategies(
    staff: Annotated[dict, Depends(require_staff)],
    provider: str | None = Query(None),
):
    """All APMI-reported PMS strategies (latest month) plus any manually imported strategy rows."""
    as_on = _REPO.latest_pms_as_on()
    universe = _REPO.list_pms_universe_strategies(as_on)
    if provider:
        universe = [s for s in universe if s["provider"] == provider]
    manual = [
        {
            "provider": m["provider"],
            "strategy_name": m["strategy_name"],
            "strategy_type": m.get("approach") or m.get("category") or "Other",
            "service_type": "Manual import",
            "as_on": m.get("report_month"),
            "aum_crore": m.get("aum_crore"),
            "return_1m": m.get("return_1m"), "return_3m": m.get("return_3m"), "return_6m": m.get("return_6m"),
            "return_1y": m.get("return_1y"), "return_3y": m.get("cagr_3y"), "return_5y": m.get("cagr_5y"),
            "source": m.get("source") or "manual",
        }
        for m in _REPO.list_pms_strategies(provider=provider)
        if m.get("source") != "APMI"
    ]
    return {
        "data": universe + manual,
        "count": len(universe) + len(manual),
        "as_on": as_on,
        "source": "APMI",
        "availability": "ready" if (universe or manual) else "unavailable",
        "freshness": "current" if universe else "stale",
    }


_PMS_DETAIL_TTL_SECONDS = 24 * 3600.0


@router.get("/pms/strategies/{ia_id}")
def backoffice_pms_strategy_detail(ia_id: str, staff: Annotated[dict, Depends(require_staff)]):
    """Everything known about one PMS strategy: monthly performance history, APMI profile, sibling strategies."""
    if not ia_id.isdigit() or len(ia_id) > 8:
        raise HTTPException(404, "Strategy not found")
    history = _REPO.list_pms_strategy_history(ia_id)
    if not history:
        raise HTTPException(404, "Strategy not found")
    latest = history[0]

    detail: dict[str, Any] | None = None
    detail_error: str | None = None
    cached = _REPO.get_pms_strategy_detail_cache(ia_id)
    if cached and cached[1] < _PMS_DETAIL_TTL_SECONDS:
        detail = cached[0]
    else:
        try:
            fresh = apmi_provider.fetch_strategy_detail(ia_id)
            if fresh:
                _REPO.put_pms_strategy_detail_cache(ia_id, fresh)
                detail = fresh
            else:
                detail_error = "APMI strategy page could not be parsed."
        except Exception as e:  # network/HTTP failure must not break the page
            detail_error = f"APMI strategy page unavailable: {e.__class__.__name__}"
        if detail is None and cached:
            detail = cached[0]  # serve stale facts rather than nothing

    siblings = _REPO.list_provider_strategies(latest["provider"], latest["as_on"], ia_id)
    return {
        "data": {
            "ia_id": ia_id,
            "latest": latest,
            "history": history,
            "detail": detail,
            "detail_error": detail_error,
            "siblings": siblings,
            "source_url": f"https://www.apmiindia.org/apmi/IaInsight.htm?IAID={ia_id}",
        },
        "as_of": latest["as_on"],
        "availability": "ready",
        "freshness": "current" if detail_error is None else "stale",
    }


@router.get("/pms/providers")
def backoffice_pms_providers(staff: Annotated[dict, Depends(require_staff)]):
    """Every SEBI-registered portfolio manager listed by APMI, with reported strategy count and total AUM."""
    as_on = _REPO.latest_pms_as_on()
    providers = _REPO.list_pms_providers(as_on)
    return {
        "data": providers,
        "count": len(providers),
        "reporting_count": sum(1 for p in providers if p["strategy_count"]),
        "as_on": as_on,
        "availability": "ready" if providers else "unavailable",
        "freshness": "current",
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

    return {"data": _enrich_pms_tracker(tracker), "availability": "ready", "freshness": "current"}


def _enrich_pms_tracker(tracker: dict[str, Any]) -> dict[str, Any]:
    """Attach valuation, XIRR, Modified Dietz and HWM fee estimates to a raw account ledger."""
    valuations = tracker.get("valuations") or []  # newest first
    cashflows = tracker.get("cashflows") or []  # oldest first
    latest = valuations[0] if valuations else None
    current_paise = int(latest["total_value_paise"]) if latest else sum(
        int(p.get("market_value_paise") or 0) for p in tracker.get("positions") or []
    )

    # Investor view: contributions are outflows (negative), withdrawals are inflows (positive).
    flows = [(c["flow_date"], c["amount_paise"] / 100.0) for c in cashflows if c.get("flow_date")]
    xirr: dict[str, Any] = {"xirr_pct": None, "status": "insufficient_data"}
    dietz: dict[str, Any] = {"return_pct": None}
    if latest and flows:
        try:
            res = calculate_xirr(flows, terminal_value=current_paise / 100.0, terminal_date=latest["valuation_date"])
            xirr = {
                "xirr_pct": round(res["xirr"] * 100.0, 4) if res.get("xirr") is not None else None,
                "status": res.get("status", "unknown"),
            }
            first_date = min(f[0] for f in flows)
            # Dietz works on capital additions as positive values.
            res_d = calculate_modified_dietz(0.0, current_paise / 100.0, [(d, -a) for d, a in flows], first_date, latest["valuation_date"])
            dietz = {"return_pct": res_d.get("return_pct")}
        except (ValueError, KeyError, TypeError):
            xirr = {"xirr_pct": None, "status": "calculation_error"}

    fee = estimate_hwm_fee(
        current_paise,
        int(tracker.get("high_water_mark") or 0),
        tracker.get("fee_performance_pct"),
        tracker.get("hurdle_pct") or 0.0,
    )
    positions = [
        {
            **p,
            "symbol": p.get("symbol_or_isin"),
            "asset_name": p.get("security_name"),
            "asset_class": p.get("security_type"),
        }
        for p in tracker.get("positions") or []
    ]
    return {
        **tracker,
        "positions": positions,
        "current_valuation_paise": current_paise,
        "xirr": xirr,
        "modified_dietz": dietz,
        "hwm_fee": {"hwm_exceeded": fee.get("hwm_exceeded", False), "estimated_fee_paise": fee.get("estimated_fee_paise", 0)},
        "holdings_coverage": {"total_coverage_pct": latest.get("holdings_coverage_pct", 100.0) if latest else 100.0},
    }


# ---------------------------------------------------------------------------
# Micro / Issuer Fundamentals
# ---------------------------------------------------------------------------

@router.get("/micro/issuers/{symbol}")
def backoffice_micro_issuer(symbol: str, staff: Annotated[dict, Depends(require_staff)]):
    """Latest quarterly results for a listed issuer, fetched live from NSE (cached six hours)."""
    try:
        data = _SERVICE.get_issuer_fundamentals(symbol)
    except NseError as e:
        return {"data": None, "symbol": symbol.upper(), "availability": e.status, "freshness": "stale", "message": str(e)}
    if data is None:
        return {
            "data": None,
            "symbol": symbol.upper(),
            "availability": "unavailable",
            "freshness": "current",
            "message": f"NSE has no quarterly results for {symbol.upper()}.",
        }
    return {"data": data, "as_of": data["fiscal_period"], "availability": "ready", "freshness": "current", "frequency": "quarterly"}


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
    funds = _REPO.search_mf_schemes(search, amc, category, limit, offset)
    return {
        "data": funds,
        "count": len(funds),
        "limit": limit,
        "offset": offset,
        "availability": "ready" if funds else "unavailable",
    }


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
    def _count(status: str) -> int:
        return sum(1 for src in sources if src.get("health_status") == status)

    return {
        "sources": sources,
        "summary": {
            "total": len(sources),
            "ready": _count("ready"),
            "degraded": _count("degraded"),
            "needs_key": _count("needs_key"),
            "manual_only": _count("manual_only"),
        },
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

@router.get("/staff")
def list_staff_members(admin: Annotated[dict, Depends(require_role("admin"))]):
    """Admin-only list of staff accounts."""
    return {"data": _REPO.list_staff()}


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
    temporary_password = None
    password = body.password
    if not password:
        temporary_password = secrets.token_urlsafe(9)
        password = temporary_password
    pwd_hash = _hash_password(password)

    if existing:
        updated = repo.update_customer(
            existing["id"],
            {
                "name": body.name,
                "role": body.role,
                "is_staff": 1,
                "status": "active",
                "password_hash": pwd_hash,
                "must_change_password": 1 if (body.temp_password or temporary_password) else 0,
            },
        )
        _REPO.log_audit(admin["id"], "staff_promoted", "staff", existing["id"], {"email": email, "role": body.role})
        return {"success": True, "action": "promoted", "staff": updated, "staff_member": updated, "temporary_password": temporary_password}
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
                "must_change_password": 1 if (body.temp_password or temporary_password) else 0,
            },
        )
        _REPO.log_audit(admin["id"], "staff_created", "staff", created["id"], {"email": email, "role": body.role})
        return {"success": True, "action": "created", "staff": created, "staff_member": created, "temporary_password": temporary_password}
