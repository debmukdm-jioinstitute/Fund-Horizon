"""FastAPI router for Fund Horizon Internal Backoffice."""
from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse

from app.api.auth import (
    _hash_password,
    require_backoffice_role,
    require_role,
    require_staff,
    verify_csrf,
)
from app.backoffice.analytics.pms_math import calculate_modified_dietz, calculate_xirr, estimate_hwm_fee
from app.backoffice.collectors import factsheet_archive_dir, refresh_source
from app.backoffice.fh_recommended import FH_RECOMMENDED_MF_CODES, MF_FACTSHEET_SOURCE, PMS_FACTSHEET_SOURCE, PMS_NO_PUBLIC_FACTSHEET
from app.backoffice.providers import factsheets as factsheets_provider
from app.backoffice.providers import apmi as apmi_provider
from app.backoffice.providers.manual import ManualImportValidator, get_template_csv
from app.backoffice.providers.nse import NseError
from app.backoffice.repository import BackofficeRepository
from app.backoffice.schemas import (
    ImpactAnalyzeRequest,
    ImpactScenarioRequest,
    ImportCommitRequest,
    ImportPreviewRequest,
    ResearchNoteCreateRequest,
    ScreeningPresetCreateRequest,
    ScreeningRunRequest,
    StaffMemberCreateRequest,
    WatchlistCreateRequest,
)
from app.backoffice.screening.service import ScreeningService
from app.backoffice.service import BackofficeService
from app.data.loader import load_metrics, load_nav
from app.db import get_repository

router = APIRouter(prefix="/api/backoffice", tags=["backoffice"])

_SERVICE = BackofficeService()
_REPO = BackofficeRepository()
_SCREENING_SERVICE = ScreeningService(_REPO)


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


@router.get("/series/{instrument_id}")
def backoffice_series(
    instrument_id: str,
    staff: Annotated[dict, Depends(require_staff)],
    limit: int = Query(2000, ge=1, le=5000),
):
    """Stored observation history for one overview indicator (FX, yields, VIX), oldest first."""
    if not re.fullmatch(r"(FX|VOL|YIELD):[A-Z]{2,6}(:[A-Z0-9]{2,8})?", instrument_id):
        raise HTTPException(404, "Unknown series")
    rows = _REPO.get_observations_series(instrument_id, limit=limit)
    return {
        "data": [{"observed_at": r["observed_at"], "value": r["value_numeric"]} for r in rows],
        "as_of": rows[-1]["observed_at"] if rows else None,
        "availability": "ready" if rows else "unavailable",
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
    cached_benchmarks = _REPO.list_pms_cached_benchmarks()
    for row in universe:
        if not row.get("benchmark") and not row.get("benchmark_name"):
            ia = row.get("ia_id")
            if ia and cached_benchmarks.get(str(ia)):
                row["benchmark"] = cached_benchmarks[str(ia)]
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
            "benchmark": m.get("benchmark_name") or None,
            "benchmark_name": m.get("benchmark_name") or None,
            "source": m.get("source") or "manual",
        }
        for m in _REPO.list_pms_strategies(provider=provider)
        if m.get("source") != "APMI"
    ]
    return {
        "data": universe + manual,
        "count": len(universe) + len(manual),
        "as_on": as_on,
        "as_of": as_on,
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

@router.get("/factsheets")
def backoffice_factsheets(
    staff: Annotated[dict, Depends(require_staff)],
    kind: str = Query(..., pattern="^(mf|pms)$"),
    id: str = Query(..., pattern="^[0-9]{1,8}$"),
):
    """Official factsheets (newest first) for a curated mutual fund (AMFI code) or PMS strategy (APMI id)."""
    key = (MF_FACTSHEET_SOURCE if kind == "mf" else PMS_FACTSHEET_SOURCE).get(id)
    if key is None:
        return {
            "data": {"source": None, "items": [], "no_public": kind == "pms" and id in PMS_NO_PUBLIC_FACTSHEET},
            "availability": "unavailable",
        }
    items = []
    for r in _REPO.list_factsheets(key):
        archived = bool(r["archived_path"]) and Path(r["archived_path"]).is_file()
        items.append({
            "id": r["id"], "period": r["period"], "title": r["title"], "size_bytes": r["size_bytes"],
            "first_seen_at": r["first_seen_at"],
            # An overwritten-in-place source only keeps its old versions in our archive.
            "url": f"/api/backoffice/factsheets/{r['id']}/file" if archived else r["url"],
            "official_url": r["url"],
        })
    return {
        "data": {"source": factsheets_provider.SOURCES[key].label, "items": items},
        "availability": "ready" if items else "unavailable",
        "as_of": items[0]["period"] if items else None,
    }


@router.get("/factsheets/{factsheet_id}/file")
def backoffice_factsheet_file(factsheet_id: int, staff: Annotated[dict, Depends(require_staff)]):
    row = _REPO.get_factsheet(factsheet_id)
    path = Path(row["archived_path"]) if row and row["archived_path"] else None
    if path is None or not path.is_file() or not path.resolve().is_relative_to(factsheet_archive_dir().resolve()):
        raise HTTPException(404, "Factsheet file not archived")
    return FileResponse(path, media_type="application/pdf", filename=f"{row['source_key']}-{row['period']}.pdf")


_PCT_METRICS = (
    "ret_1m", "ret_3m", "ret_6m", "ret_1y", "cagr_3y", "cagr_5y", "cagr_7y", "cagr_10y",
    "cagr_since_inception", "vol_3y", "max_drawdown_3y", "max_drawdown_all",
)


def _num_or_none(v: Any, scale: float = 1.0) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else round(f * scale, 4)  # NaN -> None


@router.get("/mutual-funds/{scheme_code}/performance")
def backoffice_mf_performance(scheme_code: str, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    """Trailing returns, risk stats and month-end NAV history for one scheme, from the AMFI + mfapi.in dataset."""
    if not scheme_code.isdigit() or len(scheme_code) > 8:
        raise HTTPException(404, "Scheme not found")
    df = load_metrics()
    match = df[df["scheme_code"] == scheme_code]
    if match.empty:
        # Only Growth-option schemes are in the performance dataset (no IDCW/payout/closed-ended).
        return {"data": None, "availability": "unavailable", "as_of": None}
    row = match.iloc[0]
    try:
        nav = load_nav(scheme_code)
    except FileNotFoundError:
        nav = pd.Series(dtype=float)
    last_nav_date = pd.Timestamp(row["last_nav_date"])
    if len(nav) and nav.index[-1] > last_nav_date:
        # The in-progress month is stored under its month-end label; show the real date of that NAV instead.
        nav = nav.rename(index={nav.index[-1]: last_nav_date})
    history = pd.DataFrame({
        "nav": nav,
        "r1m": nav.pct_change(1) * 100,
        "r1y": nav.pct_change(12) * 100,
        "r3y": ((nav / nav.shift(36)) ** (1 / 3) - 1) * 100,
        "r5y": ((nav / nav.shift(60)) ** (1 / 5) - 1) * 100,
    }).sort_index(ascending=False)
    return {
        "data": {
            "scheme_code": scheme_code,
            # The public /funds/{code} page only exists for schemes eligible for shortlists (Regular, Growth, clean data).
            "public_page": scheme_code in set(request.app.state.eligible["scheme_code"]),
            "metrics": {
                **{k: _num_or_none(row.get(k), 100) for k in _PCT_METRICS},
                "sharpe_3y": _num_or_none(row.get("sharpe_3y")),
                "sortino_3y": _num_or_none(row.get("sortino_3y")),
                "history_years": _num_or_none(row.get("history_years")),
                "data_quality": str(row.get("data_quality")),
            },
            "history": [
                {"date": str(d.date()), **{k: _num_or_none(v) for k, v in r.items()}}
                for d, r in history.iterrows()
            ],
        },
        "availability": "ready",
        "as_of": str(row.get("last_nav_date")),
    }


@router.get("/mutual-funds/tracker")
def backoffice_mf_tracker(
    staff: Annotated[dict, Depends(require_staff)],
    search: str | None = Query(None),
    amc: str | None = Query(None),
    category: str | None = Query(None),
    plan: str | None = Query(None),
    recommended: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Search and compare mutual fund schemes with AMFI daily NAV values and metrics."""
    plan_norm = plan.strip().title() if plan else None
    if plan_norm and plan_norm not in {"Direct", "Regular"}:
        plan_norm = None
    codes = FH_RECOMMENDED_MF_CODES.keys() if recommended else None
    funds = _REPO.search_mf_schemes(search, amc, category, limit, offset, plan=plan_norm, codes=codes)
    total = _REPO.count_mf_schemes(search, amc, category, plan=plan_norm, codes=codes)
    facets = _REPO.mf_scheme_facets()
    for f in funds:
        f["is_fh_recommended"] = f.get("scheme_code") in FH_RECOMMENDED_MF_CODES
        # Alias both names so older and newer clients can read the NAV date.
        nav_date = f.get("nav_date") or f.get("latest_nav_date")
        f["nav_date"] = nav_date
        f["latest_nav_date"] = nav_date
        option = f.get("option") or f.get("scheme_option")
        f["option"] = option
        if not f.get("isin") or str(f.get("isin")).strip() in {"-", "--"}:
            f["isin"] = None
        if not f.get("isin_reinvest") or str(f.get("isin_reinvest")).strip() in {"-", "--"}:
            f["isin_reinvest"] = None
    return {
        "data": funds,
        "count": len(funds),
        "total": total,
        "limit": limit,
        "offset": offset,
        "as_of": facets.get("as_of"),
        "recommended_count": len(FH_RECOMMENDED_MF_CODES),
        "facets": {
            "amcs": facets.get("amcs") or [],
            "categories": facets.get("categories") or [],
            "plan_counts": facets.get("plan_counts") or {},
        },
        "availability": "ready" if total else "unavailable",
    }


@router.get("/mutual-funds/nav-pair-check")
def backoffice_mf_nav_pair_check(
    staff: Annotated[dict, Depends(require_staff)],
    limit: int = Query(50, ge=1, le=200),
):
    """Growth/IDCW pairs sharing an identical latest NAV — data QA check."""
    pairs = _REPO.mf_identical_nav_pairs(limit)
    return {"data": pairs, "count": len(pairs), "availability": "ready"}


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
            "pending": _count("pending"),
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


# ---------------------------------------------------------------------------
# Fund Screening Funnel & Presets
# ---------------------------------------------------------------------------

@router.get("/screening/metrics")
def backoffice_screening_metrics(
    staff: Annotated[dict, Depends(require_staff)],
    cat: str | None = Query(None),
    amc: str | None = Query(None),
    q_search: str | None = Query(None),
    as_of: str | None = Query(None),
):
    """Retrieve precomputed screening metrics and facets for S0 universe."""
    res = _SCREENING_SERVICE.get_screening_metrics(cat=cat, amc=amc, q_search=q_search, as_of=as_of)
    return {
        "data": res,
        "as_of": res.get("as_of"),
        "availability": "ready" if res.get("rows") else "unavailable",
        "freshness": "current" if res.get("rows") else "stale",
        "method_version": "1.0.0",
    }


@router.post("/screening/run")
def backoffice_screening_run(
    body: ScreeningRunRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Execute sequential 5-stage screening funnel on precalculated metrics."""
    verify_csrf(request)
    return _SCREENING_SERVICE.run_screening(
        staff_id=staff["id"],
        preset_id=body.preset_id,
        filters=body.filters,
    )


@router.get("/screening/runs/{run_id}")
def backoffice_screening_run_details(
    run_id: str,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Retrieve counts and filter metadata of a saved screening run."""
    run = _SCREENING_SERVICE.get_screening_run(run_id, staff_id=staff["id"])
    if not run:
        raise HTTPException(404, "Screening run not found")
    return {"data": run}


@router.get("/screening/funds/{scheme_code}")
def backoffice_screening_fund_details(
    scheme_code: str,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Fetch scheme screening row, manager history, PMS cross-links, and research notes."""
    fund = _SCREENING_SERVICE.get_screening_fund(scheme_code)
    if not fund:
        raise HTTPException(404, f"Scheme {scheme_code} not found in screening universe")
    return {"data": fund}


@router.get("/screening/presets")
def backoffice_list_presets(staff: Annotated[dict, Depends(require_staff)]):
    """List saved screening filter presets for current staff member."""
    presets = _SCREENING_SERVICE.list_presets(staff["id"])
    return {"data": presets}


@router.post("/screening/presets")
def backoffice_create_preset(
    body: ScreeningPresetCreateRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Save a new screening preset."""
    verify_csrf(request)
    created = _SCREENING_SERVICE.save_preset(staff["id"], body.name, body.filters)
    return {"data": created}


@router.delete("/screening/presets/{preset_id}")
def backoffice_delete_preset(
    preset_id: str,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Delete a screening preset owned by current staff member."""
    verify_csrf(request)
    success = _SCREENING_SERVICE.delete_preset(staff["id"], preset_id)
    if not success:
        raise HTTPException(404, "Preset not found")
    return {"success": True}


@router.get("/screening/export/{run_id}.csv")
def backoffice_export_screening_csv(
    run_id: str,
    staff: Annotated[dict, Depends(require_staff)],
    include_retain: bool = Query(False),
):
    """Export action (and optional retain) list to formula-sanitized CSV."""
    csv_text = _SCREENING_SERVICE.export_csv(staff["id"], run_id, include_retain=include_retain)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="screening_action_{run_id}.csv"'},
    )
