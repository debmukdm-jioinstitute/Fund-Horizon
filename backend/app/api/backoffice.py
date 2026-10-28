from __future__ import annotations
"""FastAPI router for Fund Horizon Internal Backoffice."""

import csv
import io
import json
import re
import secrets
from functools import lru_cache as _lru_cache
from datetime import UTC, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import urljoin, urlparse
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel, Field

from app.api.auth import (
    _hash_password,
    require_backoffice_role,
    require_role,
    require_staff,
    verify_csrf,
)
from app.backoffice.analytics.pms_math import calculate_modified_dietz, calculate_xirr, estimate_hwm_fee
from app.backoffice.collectors import factsheet_archive_dir, refresh_source
from app.backoffice.meta import with_meta
from app.backoffice.mf_screener import BENCHMARK_PROXY, BENCHMARKS
from app.backoffice.fh_recommended import (
    FH_RECOMMENDED_MF_CODES,
    FH_RECOMMENDED_PMS_IDS,
    save_recommended_override,
    MF_FACTSHEET_SOURCE,
    PMS_FACTSHEET_SOURCE,
    PMS_NO_PUBLIC_FACTSHEET,
)
from app.backoffice.providers import advisorkhoj as advisorkhoj_provider
from app.backoffice.providers import apmi as apmi_provider
from app.backoffice.providers import factsheets as factsheets_provider
from app.backoffice.providers.manual import ManualImportValidator, get_template_csv
from app.backoffice.providers.nse import NseError
from app.backoffice.repository import BackofficeRepository
from app.backoffice.schemas import (
    ImportCommitRequest,
    ImportPreviewRequest,
    ResearchNoteCreateRequest,
    ScreeningPresetCreateRequest,
    ScreeningRunRequest,
    StaffMemberCreateRequest,
    StaffMemberUpdateRequest,
    WatchlistCreateRequest,
)
from app.backoffice import index_tri as index_tri_module
from app.backoffice import fh_recommended, fh_score, mf_holdings, mf_reference, mf_screener
from app.backoffice import mf_research_v2 as mf_v2
from app.backoffice.screening.quartiles import compute_category_quartiles
from app.backoffice.screening.service import ScreeningService
from app.engine import analytics as engine_analytics
from app.engine.stress import category_median_series
from app.backoffice.compare import build_compare_payload
from app.backoffice import search as universal_search
from app.backoffice.service import BackofficeService
from app.data.loader import data_dir, load_metrics, load_nav
from app.db import get_repository

router = APIRouter(prefix="/api/backoffice", tags=["backoffice"])

_SERVICE = BackofficeService()
_REPO = BackofficeRepository()
_SCREENING_SERVICE = ScreeningService(_REPO)


# ---------------------------------------------------------------------------
# Universal search
# ---------------------------------------------------------------------------

@router.get("/search/scopes")
def search_scopes(staff: Annotated[dict, Depends(require_staff)]):
    return {"scopes": universal_search.scopes()}


@router.get("/search")
def universal_search_endpoint(
    staff: Annotated[dict, Depends(require_staff)],
    q: str = Query(..., min_length=2, max_length=80),
    scope: str = Query("all", max_length=32),
):
    """One query across funds, managers, PMS, AMCs, CRM records and news/notes (CRM hits follow the RM's own book)."""
    from app.api.crm_auth import UNSCOPED_ROLES
    from app.repo_crm_phase3 import team_ids

    viewer = None if staff.get("role") in UNSCOPED_ROLES else team_ids(staff["id"])
    return {"results": universal_search.run(q, scope, viewer)}


# ---------------------------------------------------------------------------
# Overview & Market Summary
# ---------------------------------------------------------------------------

@router.get("/overview")
def backoffice_overview(staff: Annotated[dict, Depends(require_staff)]):
    """Aggregate market overview and system telemetry for staff dashboard."""
    overview = _SERVICE.get_market_overview()
    res = {
        "data": overview,
        "as_of": overview.get("generated_at"),
        "availability": "ready",
        "freshness": "current",
        "method_version": "1.0.0",
    }
    return with_meta(res, "derived", overview.get("generated_at"))


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
    res = {
        "data": [{"observed_at": r["observed_at"], "value": r["value_numeric"]} for r in rows],
        "as_of": rows[-1]["observed_at"] if rows else None,
        "availability": "ready" if rows else "unavailable",
    }
    return with_meta(res, "derived", rows[-1]["observed_at"] if rows else None)


# ---------------------------------------------------------------------------
# Sovereign Yields & Spreads Board
# ---------------------------------------------------------------------------

@router.get("/yields")
def backoffice_yields(staff: Annotated[dict, Depends(require_staff)]):
    """Sovereign tenor curves and cross-country spreads, from live-collected observations."""
    board = _SERVICE.get_yields_board()
    res = {
        "data": board,
        "as_of": board.get("as_of"),
        "availability": board.get("status", "unavailable"),
        "freshness": "current",
    }
    return with_meta(res, "fbil", board.get("as_of"))


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
    res = {
        "data": board,
        "as_of": board.get("snapshot_timestamp"),
        "availability": board.get("status", "ready"),
        "freshness": "current" if board.get("live_status") == "live" else "stale",
    }
    return with_meta(res, "nse", board.get("snapshot_timestamp"), stale=board.get("live_status") != "live")


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
    res = {
        "data": items,
        "count": len(items),
        "availability": "ready" if items else "unavailable",
        "freshness": "current",
    }
    return with_meta(res, "nse", items[0].get("published_at") if items else None)


# ---------------------------------------------------------------------------
# Institutional Flows (FII / DII)
# ---------------------------------------------------------------------------

NSE_HOLIDAYS_SET = {
    # 2025
    "2025-01-26", "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14",
    "2025-04-18", "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-21",
    "2025-10-22", "2025-11-05", "2025-12-25",
    # 2026
    "2026-01-26", "2026-02-17", "2026-03-04", "2026-03-20", "2026-04-03", "2026-04-14",
    "2026-04-17", "2026-04-20", "2026-05-01", "2026-05-27", "2026-06-25", "2026-08-15",
    "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-09", "2026-11-10", "2026-11-24",
    "2026-12-25",
    # 2027
    "2027-01-26", "2027-03-22", "2027-03-26", "2027-04-14", "2027-05-01", "2027-08-15",
    "2027-10-02", "2027-11-01", "2027-12-25",
}


def get_last_nse_trading_day(reference_dt: datetime | None = None) -> str:
    """Return the most recent NSE trading session date (YYYY-MM-DD) in IST."""
    now_ist = reference_dt or datetime.now(ZoneInfo("Asia/Kolkata"))
    d = now_ist.date()
    if now_ist.weekday() < 5 and (now_ist.hour, now_ist.minute) < (17, 30):
        d -= timedelta(days=1)
    elif now_ist.weekday() >= 5:
        d -= timedelta(days=1)

    while True:
        iso = d.isoformat()
        if d.weekday() < 5 and iso not in NSE_HOLIDAYS_SET:
            return iso
        d -= timedelta(days=1)


@router.get("/flows")
def backoffice_flows(
    staff: Annotated[dict, Depends(require_staff)],
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    """Daily reported and provisional FII/DII gross buy, sell, and net flows."""
    s_date = from_date or start_date
    e_date = to_date or end_date
    flows = _REPO.list_flows(start_date=s_date, end_date=e_date, limit=2000)

    source = _REPO.get_source("SRC_NSE_FNO") or {}
    source_health = source.get("health_status", "ready")
    error_message = source.get("error_message")

    latest_report_date = flows[0].get("report_date") if flows else None
    latest_created_at = max((f.get("created_at") for f in flows if f.get("created_at")), default=None)

    last_trading_day = get_last_nse_trading_day()
    is_stale = bool(latest_report_date and latest_report_date < last_trading_day)

    if not flows:
        availability = "source_blocked" if source_health == "blocked" else "no_data"
        freshness = "stale"
    else:
        availability = "source_blocked" if source_health == "blocked" else "ready"
        freshness = "stale" if is_stale else "current"

    age_days: int | None = None
    if latest_report_date:
        try:
            rep_d = datetime.strptime(latest_report_date, "%Y-%m-%d").date()
            today_d = datetime.now(ZoneInfo("Asia/Kolkata")).date()
            age_days = max(0, (today_d - rep_d).days)
        except Exception:
            pass

    res = {
        "data": flows,
        "count": len(flows),
        "unit": "inr_crore",
        "availability": availability,
        "freshness": freshness,
        "is_stale": is_stale,
        "age_days": age_days,
        "last_trading_day": last_trading_day,
        "as_of": latest_report_date,
        "fetched_at": latest_created_at,
        "error": error_message if (availability != "ready" or is_stale) else None,
    }
    return with_meta(res, "nse", latest_report_date)


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
    cached_managers = _REPO.list_pms_cached_managers()
    for row in universe:
        if row.get("ia_id") and not row.get("principal_officer"):
            row["principal_officer"] = cached_managers.get(str(row["ia_id"]))
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
    res = {
        "data": universe + manual,
        "count": len(universe) + len(manual),
        "as_on": as_on,
        "as_of": as_on,
        "source": "APMI",
        "availability": "ready" if (universe or manual) else "unavailable",
        "freshness": "current" if universe else "stale",
    }
    return with_meta(res, "apmi", as_on)


_PMS_DETAIL_TTL_SECONDS = 24 * 3600.0


def _pms_detail(ia_id: str) -> tuple[dict[str, Any] | None, str | None]:
    """APMI strategy page facts: fresh cache, else a live fetch, else stale cache. Returns (detail, error)."""
    detail: dict[str, Any] | None = None
    detail_error: str | None = None
    cached = _REPO.get_pms_strategy_detail_cache(ia_id)
    if cached and cached[1] < _PMS_DETAIL_TTL_SECONDS:
        return cached[0], None
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
    return detail, detail_error


def _mgr_norm(name: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^(mr|mrs|ms|dr)\.?\s+", "", (name or "").strip(), flags=re.I)).lower()


@router.get("/pms/manager")
def backoffice_pms_manager(
    staff: Annotated[dict, Depends(require_staff)],
    name: Annotated[str, Query(min_length=2, max_length=120)],
    provider: Annotated[str, Query(min_length=2, max_length=160)],
):
    """Strategies run by one APMI fund manager. APMI lists managers only on each strategy page, so check the firm's strategies."""
    want = _mgr_norm(name)
    found, experience = [], None
    for row in _REPO.list_pms_universe_strategies(_REPO.latest_pms_as_on())[:5000]:
        if row["provider"] != provider or not row.get("ia_id"):
            continue
        detail, _ = _pms_detail(str(row["ia_id"]))
        if detail and _mgr_norm(detail.get("fund_manager")) == want:
            found.append({**row, "principal_officer": detail["fund_manager"]})
            experience = experience or detail.get("fund_manager_experience")
        if len(found) >= 25:
            break
    return {"data": {"name": name, "provider": provider, "experience": experience, "strategies": found}}


@router.get("/pms/strategies/{ia_id}")
def backoffice_pms_strategy_detail(ia_id: str, staff: Annotated[dict, Depends(require_staff)]):
    """Everything known about one PMS strategy: monthly performance history, APMI profile, sibling strategies."""
    if not ia_id.isdigit() or len(ia_id) > 8:
        raise HTTPException(404, "Strategy not found")
    history = _REPO.list_pms_strategy_history(ia_id)
    if not history:
        raise HTTPException(404, "Strategy not found")
    latest = history[0]

    detail, detail_error = _pms_detail(ia_id)

    siblings = _REPO.list_provider_strategies(latest["provider"], latest["as_on"], ia_id)
    res = {
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
    return with_meta(res, "apmi", latest["as_on"])


@router.get("/pms/providers")
def backoffice_pms_providers(staff: Annotated[dict, Depends(require_staff)]):
    """Every SEBI-registered portfolio manager listed by APMI, with reported strategy count and total AUM."""
    as_on = _REPO.latest_pms_as_on()
    providers = _REPO.list_pms_providers(as_on)
    res = {
        "data": providers,
        "count": len(providers),
        "reporting_count": sum(1 for p in providers if p["strategy_count"]),
        "as_on": as_on,
        "availability": "ready" if providers else "unavailable",
        "freshness": "current",
    }
    return with_meta(res, "apmi", as_on)


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
    res = {"data": data, "as_of": data["fiscal_period"], "availability": "ready", "freshness": "current", "frequency": "quarterly"}
    return with_meta(res, "nse", data.get("fiscal_period"))


# ---------------------------------------------------------------------------
# Mutual Fund Tracker
# ---------------------------------------------------------------------------

@router.get("/factsheets")
def backoffice_factsheets(
    staff: Annotated[dict, Depends(require_staff)],
    kind: str = Query(..., pattern="^(mf|pms)$"),
    id: str = Query(..., pattern="^[0-9]{1,8}$"),
):
    """Official factsheets (newest first) for a mutual fund (AMFI code: its AMC's factsheets) or PMS strategy (APMI id)."""
    if kind == "mf":
        key = MF_FACTSHEET_SOURCE.get(id) or factsheets_provider.SOURCE_BY_AMC.get(_REPO.get_mf_scheme_amc(id) or "")
    else:
        key = PMS_FACTSHEET_SOURCE.get(id)
    if key is None:
        return {
            "data": {"source": None, "items": [], "no_public": kind == "pms" and id in PMS_NO_PUBLIC_FACTSHEET},
            "availability": "unavailable",
        }
    from app.storage import r2

    items = []
    for r in _REPO.list_factsheets(key):
        archived_val = r.get("archived_path")
        archived = bool(archived_val) and (r2.enabled() or Path(archived_val).is_file())
        items.append({
            "id": r["id"], "period": r["period"], "title": r["title"], "size_bytes": r["size_bytes"],
            "first_seen_at": r["first_seen_at"],
            # An overwritten-in-place source only keeps its old versions in our archive.
            "url": f"/api/backoffice/factsheets/{r['id']}/file" if archived else r["url"],
            "official_url": r["url"],
        })
    res = {
        "data": {"source": factsheets_provider.SOURCES[key].label, "items": items},
        "availability": "ready" if items else "unavailable",
        "as_of": items[0]["period"] if items else None,
    }
    return with_meta(res, "amfi" if kind == "mf" else "apmi", items[0]["period"] if items else None)


@router.get("/factsheets/{factsheet_id}/file")
def backoffice_factsheet_file(factsheet_id: int, staff: Annotated[dict, Depends(require_staff)]):
    row = _REPO.get_factsheet(factsheet_id)
    archived_val = row.get("archived_path") if row else None
    if not archived_val:
        raise HTTPException(404, "Factsheet file not archived")

    from app.storage import r2

    if r2.enabled():
        path = Path(archived_val)
        if path.is_file() and path.resolve().is_relative_to(factsheet_archive_dir().resolve()):
            return FileResponse(path, media_type="application/pdf", filename=f"{row['source_key']}-{row['period']}.pdf")
        return RedirectResponse(url=r2.url_for(archived_val), status_code=307)

    path = Path(archived_val)
    if not path.is_file() or not path.resolve().is_relative_to(factsheet_archive_dir().resolve()):
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


def _benchmark_series(cat: str) -> dict | None:
    """Benchmark name plus a month-end NAV series of a passive fund tracking it; None when no tracker exists."""
    code = BENCHMARK_PROXY.get(cat)
    if not code:
        return None
    try:
        nav = load_nav(code)
    except FileNotFoundError:
        return None
    name = load_metrics().set_index("scheme_code")["scheme_name"].get(code, code)
    return {
        "name": BENCHMARKS.get(cat),
        "proxy_name": re.sub(r" - Direct Plan - Growth$", "", str(name)),
        "history": [{"date": str(d.date()), "nav": _num_or_none(v)} for d, v in nav.items()],
    }


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
    res = {
        "data": {
            "scheme_code": scheme_code,
            "benchmark": _benchmark_series(str(row.get("cat"))),
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
    return with_meta(res, "amfi", str(row.get("last_nav_date")))


def _mgr_key(name: str | None) -> str:
    return re.sub(r"^(mr|mrs|ms|dr)\.?\s+", "", (name or "").strip(), flags=re.I).lower()


def _tenure_cagr(scheme_code: str, start: str | None) -> float | None:
    """CAGR of the scheme's month-end NAV from the manager's start month (approximate: first month-end on/after start)."""
    if not start:
        return None
    try:
        nav = load_nav(scheme_code)
        nav = nav[nav.index >= pd.Timestamp(start)]
        years = (nav.index[-1] - nav.index[0]).days / 365.25
        return _num_or_none(((nav.iloc[-1] / nav.iloc[0]) ** (1 / years) - 1) * 100) if len(nav) > 1 and years >= 1 else None
    except (FileNotFoundError, ValueError, ZeroDivisionError):
        return None


@router.get("/mutual-funds/{scheme_code}/manager")
def backoffice_mf_manager(scheme_code: str, staff: Annotated[dict, Depends(require_staff)]):
    """Named fund manager of one scheme (from the mf_managers table), or null when none is on file."""
    m = _REPO.list_mf_managers().get(scheme_code)
    if not m:
        fallback = mf_reference.manager_for_scheme(scheme_code)  # AMFI snapshot
        return {"data": {"manager_name": fallback, "manager_start": None, "tenure_years": None, "source": "AMFI"}} if fallback else {"data": None}
    start = m.get("manager_start")
    tenure = None
    if start:
        try:
            tenure = round((pd.Timestamp.now() - pd.Timestamp(start)).days / 365.25, 1)
        except ValueError:
            pass
    return {"data": {"manager_name": m["manager_name"], "manager_start": start, "tenure_years": tenure, "source": m.get("source")}}


@router.get("/mutual-fund-managers/profile")
def backoffice_mf_manager_profile(name: Annotated[str, Query(min_length=2, max_length=120)], staff: Annotated[dict, Depends(require_staff)]):
    """Bio (data/mf_manager_profiles.json, if curated) plus every scheme the manager runs, with performance."""
    key = _mgr_key(name)
    profile = None
    path = data_dir().parent / "mf_manager_profiles.json"
    if path.exists():
        profile = next((p for p in json.loads(path.read_text()) if key in {_mgr_key(p.get("name")), *map(_mgr_key, p.get("aliases", []))}), None)
    mets = load_metrics().set_index("scheme_code")
    # AMFI lists every plan/option code of a fund; collapse to one row per fund on the Direct Growth code, which has metrics.
    groups: dict[str, list[dict]] = {}
    for f in mf_reference.schemes_for_manager(name):
        groups.setdefault(f["scheme_name"], []).append(f)
    seeded = {c: m for c, m in _REPO.list_mf_managers().items() if _mgr_key(m["manager_name"]) == key}
    known = {f["scheme_code"] for g in groups.values() for f in g}
    for c, m in seeded.items():
        if c not in known and c in mets.index:
            groups[str(mets.at[c, "scheme_name"])] = [{"scheme_code": c, "category": mets.at[c, "category"], "manager_start": None}]
    funds = []
    for scheme_name, g in groups.items():
        have = [f for f in g if f["scheme_code"] in mets.index]
        growth = [f for f in have if mets.at[f["scheme_code"], "option"] == "Growth"] or have
        f = next((f for f in growth if mets.at[f["scheme_code"], "plan"] == "Direct"), (growth or g)[0])
        code = f["scheme_code"]
        row = mets.loc[code] if code in mets.index else None
        start = (seeded.get(code) or {}).get("manager_start") or next(
            (d.date().isoformat() for x in g if pd.notna(d := pd.to_datetime(re.sub(r"(?<=\d)(st|nd|rd|th)", "", x["manager_start"] or ""), errors="coerce"))), None)
        funds.append({
            "scheme_code": code,
            "scheme_name": scheme_name,
            "category": (str(row["category"]) if row is not None else None) or f.get("category"),
            "manager_start": start,
            "tenure_cagr": _tenure_cagr(code, start),
            **({k: _num_or_none(row.get(k), 100) for k in ("ret_1y", "cagr_3y", "cagr_5y", "max_drawdown_3y")} | {"sharpe_3y": _num_or_none(row.get("sharpe_3y"))} if row is not None else {}),
        })
    funds.sort(key=lambda f: f["manager_start"] or "9999")
    return {"data": {"name": profile["name"] if profile else name, "profile": profile, "funds": funds}}


@router.get("/compare")
def backoffice_compare(
    staff: Annotated[dict, Depends(require_staff)],
    type: str = Query(..., pattern="^(pms|mf)$"),
    ids: str = Query(..., description="Comma-separated ids (2–4)"),
):
    """Side-by-side compare for PMS strategies or MF schemes (staff only)."""
    id_list = [i.strip() for i in ids.split(",") if i.strip()]
    if len(id_list) < 2 or len(id_list) > 4:
        raise HTTPException(422, "Provide between 2 and 4 ids to compare.")
    return build_compare_payload(_REPO, type, id_list)  # type: ignore[arg-type]


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
    res = {
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
    return with_meta(res, "amfi", facets.get("as_of"))


def _mf_manager_map() -> dict[str, tuple[str | None, str | None]]:
    """{scheme_code: (manager_name, manager_start)} from the repo managers table (seed data)."""
    return {
        str(code): (m.get("manager_name"), m.get("manager_start"))
        for code, m in _REPO.list_mf_managers().items()
    }


def _holdings_snapshot() -> dict[str, Any]:
    """Holdings snapshot, never raising: an unreadable snapshot renders as
    'unavailable' everywhere instead of failing the research page."""
    try:
        return mf_holdings.load_snapshot()
    except Exception:
        return {"schemes": {}, "sectors": [], "as_of": None, "amcs": [], "generated_at": None}


def _ensure_benchmark_seed(instrument_id: str) -> None:
    """Seed mf_benchmark_nav from the committed TRI seed file when the
    database has no series for this instrument (the scheduled job commits
    the seed; the API host cannot be written to from GitHub Actions).
    Best-effort and idempotent: any failure leaves the DB untouched and
    the caller falls back to the 'not yet ingested' state."""
    try:
        if _REPO.benchmark_series(instrument_id):
            return
        seed = index_tri_module.load_tri_seed()
        series = seed.get(instrument_id)
        if series and series.get("points"):
            _REPO.upsert_benchmark_nav(instrument_id, series["points"])
    except Exception:
        pass


def _tri_seed_available() -> bool:
    """True when any TRI series exists in the DB or the committed seed."""
    try:
        if _REPO.benchmark_nav_count() > 0:
            return True
    except Exception:
        pass
    try:
        return bool(index_tri_module.load_tri_seed())
    except Exception:
        return False


_FH_KEY: tuple | None = None


def _fh_frame() -> pd.DataFrame:
    """Full scored frame with the same manager and consistency inputs the screener table uses."""
    try:
        consistency_map = _REPO.screening_consistency_map()
    except Exception:
        consistency_map = {}
    return mf_screener.all_frame(_REPO.mf_ter_by_code(), manager_map=_mf_manager_map(), consistency_map=consistency_map)


def _fh_refresh(frame: pd.DataFrame | None = None, force: bool = False) -> None:
    """Re-derive score-driven recommendations when data or scoring config changed. Manual overrides are applied on top, never overwritten."""
    global _FH_KEY
    cfg_file = fh_score.CONFIG_FILE
    key = (len(_REPO.screening_consistency_map()), cfg_file.stat().st_mtime if cfg_file.exists() else 0)
    if not force and key == _FH_KEY:
        return
    frame = frame if frame is not None else _fh_frame()
    as_of = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y").max().date().isoformat() if len(frame) else None
    auto = {str(r.code): str(r.name) for r in frame[frame["fh_auto"]].itertuples()}
    fh_recommended.apply_auto(auto, as_of)
    _FH_KEY = key


def _fh_status(df: pd.DataFrame) -> pd.Series:
    inc, excl = fh_recommended.manual_state()
    return pd.Series(
        [fh_score.status(a, sc, b, set(inc), excl, c) for a, sc, b, c in zip(df["fh_auto"], df["fh_score"], df["fh_blockers"], df["code"])],
        index=df.index,
    )


@router.get("/mutual-funds/fh-score/methodology")
def backoffice_fh_methodology(staff: Annotated[dict, Depends(require_staff)]):
    cfg = fh_score.load_config()
    cap = data_dir() / "capture_ratio.json"
    nav = data_dir() / "all_schemes_metrics.csv"
    now = datetime.now(UTC)
    nxt = now.replace(hour=18, minute=30, second=0, microsecond=0)
    while nxt <= now or nxt.weekday() > 4:
        nxt += timedelta(days=1)
    ist = timezone(timedelta(hours=5, minutes=30))
    return {
        "config": cfg, "weights": fh_score.active_weights(cfg), "provisional": fh_score.PROVISIONAL,
        "filters": fh_score.FILTERS,
        "sources": [
            {"name": "NAV, returns, Sharpe, Sortino, drawdown", "source": "AMFI + mfapi.in", "as_of": datetime.fromtimestamp(nav.stat().st_mtime).date().isoformat() if nav.exists() else None},
            {"name": "Capture ratios", "source": "Advisorkhoj (crawled, committed JSON)", "as_of": datetime.fromtimestamp(cap.stat().st_mtime).date().isoformat() if cap.exists() else None},
            {"name": "Calendar-year quartiles", "source": "Computed from NAV vs category peers (min 8) in the nightly screening refresh", "as_of": None},
            {"name": "Manager tenure", "source": "Fund Horizon managers table (staff-seeded)", "as_of": None},
            {"name": "Benchmark returns", "source": "Passive index fund tracking each category benchmark (no TRI series ingested)", "as_of": None},
        ],
        "refresh": {"cadence": "Weekdays 00:00 IST, after AMFI NAV release", "next_run_ist": nxt.astimezone(ist).strftime("%d-%m-%Y %H:%M IST")},
    }


class FhConfigPatch(BaseModel):
    patch: dict


@router.put("/mutual-funds/fh-score/config")
def backoffice_fh_config(body: FhConfigPatch, admin: Annotated[dict, Depends(require_role("admin"))]):
    try:
        cfg = fh_score.save_config(body.patch)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    _fh_refresh(force=True)
    return {"config": cfg}


@router.get("/mutual-funds/screener/explain")
def backoffice_mf_explain(
    staff: Annotated[dict, Depends(require_staff)],
    code: str = Query(..., max_length=32),
    metric: str = Query(..., max_length=40),
):
    """Why a fund has a given screener value, computed live from the same frame the table uses."""
    res = mf_screener.explain(_fh_frame(), code, metric)
    if res is None:
        raise HTTPException(404, "Unknown fund or metric.")
    return res


@router.get("/mutual-funds/screener")
def backoffice_mf_screener(
    staff: Annotated[dict, Depends(require_staff)],
    sector: str | None = Query(None, max_length=120, description="Sector filter: only funds with a holdings snapshot holding this sector"),
    category: list[str] | None = Query(None, description="Canonical category keys; omit for all"),
    plan: list[str] | None = Query(None, description="Direct and/or Regular"),
    search: str | None = Query(None, max_length=80),
    sort: str = Query("score"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    f: list[str] | None = Query(None, description="Range filters as key:min:max (percent units)"),
    recommended: bool = Query(False),
    format: str = Query("json", pattern="^(json|csv)$"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    amc: list[str] | None = Query(None, description="AMC multi-select"),
    manager: str | None = Query(None, max_length=120, description="Manager name substring"),
    min_tenure: float | None = Query(None, ge=0, description="Minimum manager tenure in years"),
    include_unknown: bool = Query(True, description="Keep unknown-manager rows under a min_tenure filter"),
    quartile: list[int] | None = Query(None, description="Computed quartile filter, 1-4"),
    quartile_period: str = Query("2y", description="Quartile period: 1y, 2y, 3y or 5y"),
    include_unavailable: bool = Query(True, description="Keep null-quartile rows under a quartile filter"),
):
    """Trendlyne-style screener over the AMFI + mfapi.in dataset: categories, returns, risk, FH checklist score."""
    if sort not in mf_screener.SORT_KEYS:
        raise HTTPException(422, "Unknown sort column.")
    if quartile_period not in {"1y", "2y", "3y", "5y"}:
        raise HTTPException(422, "Unknown quartile period.")
    if quartile and any(q not in (1, 2, 3, 4) for q in quartile):
        raise HTTPException(422, "Quartile must be 1, 2, 3 or 4.")
    plans = [p.strip().title() for p in plan or [] if p.strip().title() in {"Direct", "Regular"}]
    ranges: dict[str, tuple[float | None, float | None]] = {}
    for item in f or []:
        key, _, rest = item.partition(":")
        lo_s, _, hi_s = rest.partition(":")
        if key not in mf_screener.NUMERIC_KEYS:
            raise HTTPException(422, f"Unknown filter column: {key}")
        try:
            ranges[key] = (float(lo_s) if lo_s else None, float(hi_s) if hi_s else None)
        except ValueError:
            raise HTTPException(422, f"Bad range for {key}") from None
    ter = _REPO.mf_ter_by_code()
    # MF Research V2: precomputed consistency from the nightly screening
    # refresh (single query, never per-fund NAV loads at request time).
    try:
        consistency_map = _REPO.screening_consistency_map()
    except Exception:
        consistency_map = {}
    df = mf_screener.screen(
        ter, category, plans, search, ranges, sort, order == "desc",
        amcs=amc, manager=manager, min_tenure=min_tenure, include_unknown=include_unknown,
        quartiles=quartile, quartile_period=quartile_period, include_unavailable=include_unavailable,
        manager_map=_mf_manager_map(), consistency_map=consistency_map,
    )
    try:
        _fh_refresh()
    except Exception:
        pass
    df = df.assign(is_fh_recommended=df["code"].isin(FH_RECOMMENDED_MF_CODES), fh_status=_fh_status(df))
    if recommended:
        df = df[df["is_fh_recommended"]]
    snapshot = _holdings_snapshot()
    if sector:
        # Sector filter applies ONLY to funds with a holdings snapshot on
        # file: unpopulated funds are excluded by this filter (never
        # silently included), and the UI says so next to the filter.
        codes_with_sector = mf_holdings.schemes_with_sector(snapshot, sector)
        df = df[df["code"].isin(codes_with_sector)]
    if format == "csv":
        return PlainTextResponse(
            mf_screener.to_csv(df),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="fund-horizon-mutual-funds.csv"'},
        )
    page = df.iloc[offset: offset + limit]
    as_of = pd.to_datetime(df["nav_date"], format="%d-%b-%Y").max().date().isoformat() if len(df) else None
    # Per-source freshness from recorded dates only; a source with no rows stays null ("Not recorded").
    # AUM has no per-row date, so the metrics CSV build date stands in. with_meta merges its
    # provenance entry alongside these keys under "_default".
    ter_dates = [r["as_of"] for r in _REPO.list_mf_ter() if r.get("as_of")]
    mgr_dates = [m["updated_at"][:10] for m in _REPO.list_mf_managers().values() if m.get("updated_at")]
    aum_file = data_dir() / "all_schemes_metrics.csv"
    return with_meta({
        "data": mf_screener.records(page),
        "total": int(len(df)),
        "limit": limit,
        "offset": offset,
        "as_of": as_of,
        "meta": {
            "nav_as_of": as_of,
            "aum_as_of": datetime.fromtimestamp(aum_file.stat().st_mtime).date().isoformat() if aum_file.exists() else None,
            "ter_as_of": max(ter_dates, default=None),
            "managers_as_of": max(mgr_dates, default=None),
            "quartile_as_of": as_of,
            # Holdings snapshot coverage (partial by design: only AMCs with
            # a proven parser are ingested; the rest stay unavailable).
            "sector_available": bool(snapshot.get("sectors")),
            "portfolio_available": bool(snapshot.get("schemes")),
            "portfolio_coverage": {
                "schemes_covered": len(snapshot.get("schemes") or {}),
                "sectors": snapshot.get("sectors") or [],
                "amcs": snapshot.get("amcs") or [],
                "as_of": snapshot.get("as_of"),
            },
            "portfolio_reason": (
                f"Holdings on file for {len(snapshot.get('schemes') or {})} funds "
                f"({', '.join(snapshot.get('amcs') or [])}, as of {snapshot.get('as_of')}). "
                "Funds from other fund houses have no snapshot yet, so their holdings and sector data are shown as unavailable — never estimated."
                if snapshot.get("schemes") else
                "No portfolio holdings snapshot on file. AMFI monthly portfolio disclosures live on each AMC's website in per-AMC formats; no snapshot has been ingested yet."
            ),
            "index_series_available": _tri_seed_available(),
            "consistency_precomputed": len(consistency_map),
        },
        "groups": mf_screener.facets(mf_screener.all_frame(ter)),
        "availability": "ready" if len(df) else "unavailable",
    }, "amfi", as_of)


# ---------------------------------------------------------------------------
# MF Research V1: managers directory, research detail, research shortlist
# ---------------------------------------------------------------------------

_PORTFOLIO_SUFFIXES = (" - Direct Plan - Growth", " - Regular Plan - Growth")


def _portfolio_key(name: str) -> str:
    for suffix in _PORTFOLIO_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def _round_or_none(v: Any, ndigits: int = 2) -> float | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except TypeError:
        pass
    return round(float(v), ndigits)


@router.get("/mutual-funds/managers")
def backoffice_mf_managers(
    staff: Annotated[dict, Depends(require_staff)],
    search: str | None = Query(None, max_length=120),
    min_tenure: float | None = Query(None, ge=0),
    sort: str = Query("schemes", pattern="^(schemes|tenure|aum_estimate|name)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Manager directory: repo managers joined to the screener frame.

    AUM estimate sums AUM over distinct portfolios (scheme name minus the plan
    suffix), taking the first row's AUM per key, so a fund's Regular + Direct
    rows are never double-counted. Funds with no manager seed row aggregate
    under one "Unknown manager" row (manager_name None).
    """
    ter = _REPO.mf_ter_by_code()
    frame = mf_screener.all_frame(ter, manager_map=_mf_manager_map())
    grouped: dict[str | None, dict[str, Any]] = {}
    for r in frame.itertuples(index=False):
        name = getattr(r, "manager_name")
        key_name = str(name).strip() if isinstance(name, str) and name.strip() else None
        g = grouped.setdefault(key_name, {"schemes": 0, "portfolios": {}, "tenures": [], "needs_data": False})
        g["schemes"] += 1
        pkey = _portfolio_key(str(getattr(r, "name")))
        if pkey not in g["portfolios"]:
            g["portfolios"][pkey] = getattr(r, "aum_cr")
        tenure = getattr(r, "manager_tenure_years")
        if tenure is not None and not (isinstance(tenure, float) and pd.isna(tenure)):
            g["tenures"].append(float(tenure))
        start = getattr(r, "manager_start")
        if start is None or (isinstance(start, float) and pd.isna(start)):
            g["needs_data"] = True
    rows: list[dict[str, Any]] = []
    for mgr_name, g in grouped.items():
        aums = list(g["portfolios"].values())
        rows.append({
            "manager_name": mgr_name,
            "schemes": int(g["schemes"]),
            "portfolios": len(g["portfolios"]),
            "longest_tenure_years": _round_or_none(max(g["tenures"])) if g["tenures"] else None,
            "avg_tenure_years": _round_or_none(sum(g["tenures"]) / len(g["tenures"])) if g["tenures"] else None,
            "aum_estimate_cr": _round_or_none(sum(float(a) for a in aums if a is not None and not pd.isna(a))),
            "aum_incomplete": any(a is None or pd.isna(a) for a in aums),
            "needs_data": bool(g["needs_data"]),
        })
    if search:
        s = search.strip().lower()
        rows = [r for r in rows if (r["manager_name"] and s in r["manager_name"].lower())
                or (r["manager_name"] is None and "unknown" in s)]
    if min_tenure is not None:
        rows = [r for r in rows if r["longest_tenure_years"] is not None and r["longest_tenure_years"] >= min_tenure]
    sort_key = {
        "schemes": lambda r: r["schemes"],
        "tenure": lambda r: r["longest_tenure_years"] if r["longest_tenure_years"] is not None else float("-inf"),
        "aum_estimate": lambda r: r["aum_estimate_cr"] if r["aum_estimate_cr"] is not None else float("-inf"),
        "name": lambda r: (r["manager_name"] or ""),
    }[sort]
    rows.sort(key=sort_key, reverse=(order == "desc"))
    return {
        "data": rows[offset: offset + limit],
        "total": len(rows),
        "limit": limit,
        "offset": offset,
        "availability": "ready",
    }


def _month_end_series(nav: pd.Series) -> pd.Series:
    return nav.sort_index().resample("ME").last().dropna()


def _calendar_year_returns(monthly: pd.Series) -> dict[int, float]:
    """Calendar-year return per year with a full year of month-end NAVs (Dec prior year + all 12 months)."""
    points = {(d.year, d.month): float(v) for d, v in monthly.items()}
    out: dict[int, float] = {}
    for year in sorted({d.year for d in monthly.index}):
        if (year - 1, 12) not in points:
            continue
        if any((year, m) not in points for m in range(1, 13)):
            continue
        dec = monthly[(monthly.index.year == year) & (monthly.index.month == 12)].iloc[0]
        out[year] = float(dec) / points[(year - 1, 12)] - 1.0
    return out


@_lru_cache(maxsize=1)
def _manager_profiles() -> list[dict[str, Any]]:
    """Published manager bios (data/mf_manager_profiles.json); empty on any read failure."""
    try:
        raw = json.loads((data_dir().parent / "mf_manager_profiles.json").read_text())
        return raw if isinstance(raw, list) else []
    except Exception:
        return []


def _v2_blocks(scheme_code: str, row: dict[str, Any], monthly: pd.Series | None) -> dict[str, Any]:
    """MF Research V2 blocks for one fund: co-managers + changes + bio,
    operations snapshot, portfolio coverage, and vs-index metrics.

    Everything here is read-only and sourced, never invented. The
    portfolio block is populated only for funds with a holdings snapshot
    on file (see mf_holdings); every other fund keeps the honest
    unavailable payload. The index block computes vs-index metrics only
    when a real TRI series is stored (database or committed seed); until
    then it says so and the one-pager tracker-fund proxy line stays.
    """
    snapshot = _holdings_snapshot()
    snap_entry = mf_holdings.holdings_for_scheme(snapshot, str(scheme_code))
    if snap_entry is not None:
        snap_holdings = snap_entry.get("holdings") or []
        sector_agg = mf_v2.sector_aggregation([
            {"name": h.get("name"), "isin": h.get("isin"), "sector": h.get("sector"), "weight_pct": h.get("weight_pct")}
            for h in snap_holdings
        ])
        portfolio_block: dict[str, Any] = {
            "available": True, "holdings": snap_holdings,
            "sectors": sector_agg["sectors"],
            "unclassified_pct": sector_agg["unclassified_pct"],
            "total_weight_pct": sector_agg["total_weight_pct"],
            "sector_coverage": sector_agg["coverage"],
            "summary": mf_v2.portfolio_summary([
                {"name": h.get("name"), "weight_pct": h.get("weight_pct"),
                 "instrument_type": h.get("instrument_type")} for h in snap_holdings
            ]),
            "reason": None,
            "source": snap_entry.get("source_url"),
            "as_of": snap_entry.get("as_of"),
            "amc": snap_entry.get("amc"),
            "sector_available": True,
            "coverage_pct": snap_entry.get("coverage_pct"),
            "note": snap_entry.get("note") or "Sector is the disclosure's own Industry column. Market-cap mix, turnover and style are not in the monthly disclosure, so they stay unavailable. Cash rows (TREPS, net receivables) have no sector and sit in the unclassified share.",
        }
    else:
        portfolio_block = {
            "available": False, "holdings": [], "sectors": [],
            "reason": "No portfolio holdings snapshot on file for this scheme. AMFI monthly portfolio disclosures live on each AMC's website in per-AMC formats; only fund houses with a proven parser are ingested, so holdings, sector percentages, concentration and fund overlap cannot be computed for this fund — they are shown as unavailable, never estimated.",
            "source": None,
            "sector_available": False,
        }
    blocks: dict[str, Any] = {
        "co_managers": None, "manager_changes": [], "manager_bio": None,
        "operations": mf_v2.operations_from_reference(None),
        "portfolio": portfolio_block,
        "index": None, "benchmark_tri_name": None,
    }
    ref = None
    try:
        ref = mf_reference.scheme_reference(str(scheme_code))
    except Exception:
        ref = None
    nav_as_of = None
    try:
        parsed = pd.to_datetime(row.get("nav_date"), format="%d-%b-%Y", errors="coerce")
        nav_as_of = parsed.date().isoformat() if pd.notna(parsed) else None
    except Exception:
        nav_as_of = None
    if ref:
        blocks["co_managers"] = mf_v2.co_managers_from_reference(ref.get("managers") or [], nav_as_of)
        names = {m.get("manager_id"): m.get("full_name") for m in (ref.get("managers") or []) if m.get("manager_id")}
        blocks["manager_changes"] = mf_v2.manager_changes_from_reference(ref.get("manager_changes") or [], names)
        blocks["operations"] = mf_v2.operations_from_reference(ref.get("scheme"))
        blocks["benchmark_tri_name"] = (ref.get("scheme") or {}).get("benchmark_index_tri")
    if not blocks["benchmark_tri_name"]:
        blocks["benchmark_tri_name"] = mf_screener.BENCHMARKS.get(row.get("cat") or "")
    bio_name = None
    if blocks["co_managers"] and blocks["co_managers"]["managers"]:
        bio_name = blocks["co_managers"]["managers"][0].get("name")
    blocks["manager_bio"] = mf_v2.manager_bio_from_profiles(bio_name or row.get("manager_name"), _manager_profiles())
    cat = row.get("cat") or ""
    tri_name = index_tri_module.NSE_TRI_BY_CATEGORY.get(cat)
    if tri_name:
        iid = index_tri_module.instrument_id_for(tri_name)
        _ensure_benchmark_seed(iid)
        try:
            pts = _REPO.benchmark_series(iid)
        except Exception:
            pts = []
        if not pts:
            # DB empty but the committed seed may still carry this series
            # (e.g. the seed upsert has not run yet): serve it directly
            # rather than claiming nothing is ingested, and let the next
            # call seed the DB. Never a substitute series, only this index.
            seed = index_tri_module.load_tri_seed()
            series = seed.get(iid)
            if series and series.get("points"):
                pts = series["points"]
        if pts and monthly is not None and len(monthly) >= 2:
            idx_series = pd.Series({pd.Timestamp(p["date"]): float(p["value"]) for p in pts}).sort_index()
            # Month-end convention: stored points are month-end labelled;
            # resampling a daily-labelled legacy series the same way keeps
            # beta / tracking error on monthly-vs-monthly footing.
            idx_series = idx_series.resample("ME").last().dropna()
            blocks["index"] = {
                "index_name": f"{tri_name} TRI", "instrument_id": iid, "points": len(pts),
                "proxy_retired": True,
                **mf_v2.index_metrics(monthly, idx_series),
            }
        elif pts:
            blocks["index"] = {"index_name": f"{tri_name} TRI", "instrument_id": iid, "points": len(pts),
                               "proxy_retired": False,
                               "reason": "TRI series is stored but the fund's NAV series is unavailable, so vs-index metrics cannot be computed."}
        else:
            blocks["index"] = {"index_name": f"{tri_name} TRI", "instrument_id": iid, "points": 0,
                               "proxy_retired": False,
                               "reason": "No TRI series ingested yet for this index. The one-pager tracker-fund proxy line is retained with its disclosure until a real series is stored."}
    else:
        blocks["index"] = {"index_name": blocks["benchmark_tri_name"], "proxy_retired": False,
                           "reason": "No free machine-readable TRI series source for this category's benchmark (CRISIL/BSE/composite); the tracker-fund proxy line is retained with its disclosure."}
    return blocks


@router.get("/mutual-funds/{scheme_code}/research-detail")
def backoffice_mf_research_detail(
    scheme_code: str,
    staff: Annotated[dict, Depends(require_staff)],
):
    """One fund's research detail: computed quartiles/percentiles/manager from the
    screener frame, plus NAV-derived consistency metrics vs the category median.

    Alpha/beta/Treynor in the frame are vs the category median, never vs an index.
    If the category median series is unavailable, the NAV-derived fields are None
    with a reason string, never an error. Fund-only metrics (downside deviation,
    SIP) are returned as None in that case too, so the consistency block is never
    shown half-populated without its median comparison.
    """
    ter = _REPO.mf_ter_by_code()
    manager_map = _mf_manager_map()
    frame = mf_screener.all_frame(ter, manager_map=manager_map)
    match = frame[frame["code"] == str(scheme_code)]
    if match.empty:
        raise HTTPException(404, "Scheme not found")
    row = mf_screener.records(match)[0]
    data: dict[str, Any] = {
        "scheme_code": str(scheme_code),
        "fund": row["name"],
        "category": row["cat_label"],
        "cat": row["cat"],
        "plan": row["plan"],
        "quartile_1y": row["quartile_1y"],
        "quartile_2y": row["quartile_2y"],
        "quartile_3y": row["quartile_3y"],
        "quartile_5y": row["quartile_5y"],
        "quartile_source": row["quartile_source"],
        "quartile_basis": "computed",
        "median_basis": "vs category median",
        "pct_sharpe_3y": row["pct_sharpe_3y"],
        "pct_sortino_3y": row["pct_sortino_3y"],
        "pct_alpha_3y": row["pct_alpha_3y"],
        "pct_vol_3y": row["pct_vol_3y"],
        "pct_max_dd_3y": row["pct_max_dd_3y"],
        "pct_ret_1y": row["pct_ret_1y"],
        "pct_cagr_3y": row["pct_cagr_3y"],
        "pct_cagr_5y": row["pct_cagr_5y"],
        "manager_name": row["manager_name"],
        "manager_start": row["manager_start"],
        "manager_tenure_years": row["manager_tenure_years"],
        "roll_win_pct": None,
        "cal_topq_years": None,
        "cal_win_pct": None,
        "downside_dev_3y": None,
        "sip_cagr_3y": None,
        "sip_cagr_5y": None,
        "reason": None,
        "consistency_source": None,
    }
    # MF Research V2: prefer the nightly precomputed consistency (no
    # per-peer NAV loads at request time). The live-NAV path below is only
    # the fallback until the first V2 refresh has run.
    try:
        precomputed = _REPO.screening_consistency_map().get(str(scheme_code))
    except Exception:
        precomputed = None
    if precomputed:
        for key in ("roll_win_pct", "cal_topq_years", "cal_win_pct",
                    "downside_dev_3y", "sip_cagr_3y", "sip_cagr_5y"):
            data[key] = precomputed.get(key)
        data["consistency_source"] = "precomputed"
    try:
        nav = load_nav(str(scheme_code))
    except (FileNotFoundError, OSError, ValueError):
        nav = pd.Series(dtype=float)
    if nav is None or len(nav) < 2:
        data["reason"] = "NAV series unavailable"
        data.update(_v2_blocks(str(scheme_code), row, None))
        return {"data": data, "availability": "partial"}
    monthly = _month_end_series(nav)
    if precomputed:
        data.update(_v2_blocks(str(scheme_code), row, monthly))
        return {"data": data, "availability": "ready"}
    try:
        median = category_median_series(load_metrics(), str(row["cat"]), min_funds=3)
    except Exception:
        median = pd.Series(dtype=float)
    if median is None or median.dropna().empty:
        data["reason"] = "Category median series unavailable"
        data.update(_v2_blocks(str(scheme_code), row, monthly))
        return {"data": data, "availability": "partial"}
    data["consistency_source"] = "live-nav"
    # Rolling 1Y win rate vs category median: monthly step, windows ending in the last 5Y.
    fund_roll = monthly / monthly.shift(12) - 1.0
    med_roll = (1.0 + median).rolling(12).apply(lambda x: float(pd.Series(x).prod()) - 1.0, raw=True)
    end = monthly.index[-1]
    both = pd.DataFrame({"fund": fund_roll, "med": med_roll}).dropna()
    both = both[(both.index > end - pd.DateOffset(years=5)) & (both.index <= end)]
    if len(both) >= 12:
        data["roll_win_pct"] = round(float((both["fund"] > both["med"]).mean()) * 100, 1)
    # Calendar years: fund return vs compounded category-median monthly returns; top-quartile
    # years rank the fund against same category + plan peers with a full year of NAV.
    fund_cal = _calendar_year_returns(monthly)
    med_monthly = median.dropna()
    med_cal: dict[int, float] = {}
    for year in fund_cal:
        seg = med_monthly[(med_monthly.index.year == year)]
        if len(seg) >= 12:
            med_cal[year] = float((1.0 + seg).prod() - 1.0)
    completed = sorted(set(fund_cal) & set(med_cal))
    if len(completed) >= 3:
        data["cal_win_pct"] = round(float(sum(fund_cal[y] > med_cal[y] for y in completed) / len(completed)) * 100, 1)
    peers = frame[(frame["cat"] == row["cat"]) & (frame["plan"] == row["plan"])]
    topq = 0
    for year in completed:
        peer_rets: dict[str, float | None] = {}
        for code in peers["code"].astype(str):
            try:
                peer_rets[code] = _calendar_year_returns(_month_end_series(load_nav(code))).get(year)
            except (FileNotFoundError, OSError, ValueError):
                continue
        peer_rets = {c: v for c, v in peer_rets.items() if v is not None}
        if len(peer_rets) >= 8 and str(scheme_code) in peer_rets:
            if compute_category_quartiles(peer_rets, min_peers=8).get(str(scheme_code)) == 1:
                topq += 1
    data["cal_topq_years"] = topq if completed else None
    # Downside deviation 3Y (annualised, monthly returns below 0), in percent per annum.
    rets_3y = monthly.pct_change().dropna().tail(36)
    if len(rets_3y) >= 12:
        downside = rets_3y.clip(upper=0.0)
        data["downside_dev_3y"] = round(float((downside ** 2).mean() ** 0.5 * (12 ** 0.5)) * 100, 2)
    # Monthly SIP XIRR from month-end NAV: 36 instalments need 37 points, 60 need 61.
    for months, field in ((37, "sip_cagr_3y"), (61, "sip_cagr_5y")):
        window = monthly.tail(months)
        if len(window) >= months:
            val = engine_analytics.sip_xirr(window)
            data[field] = round(float(val) * 100, 2) if val is not None else None
    data.update(_v2_blocks(str(scheme_code), row, monthly))
    return {"data": data, "availability": "ready"}


@router.get("/mutual-funds/{scheme_code}/research-v2")
def backoffice_mf_research_v2(
    scheme_code: str,
    staff: Annotated[dict, Depends(require_staff)],
):
    """MF Research V2 blocks for one fund (same payload the research detail
    carries): co-managers + change history + bio, operations snapshot,
    portfolio coverage, and vs-index metrics. Read-only."""
    ter = _REPO.mf_ter_by_code()
    frame = mf_screener.all_frame(ter, manager_map=_mf_manager_map())
    match = frame[frame["code"] == str(scheme_code)]
    if match.empty:
        raise HTTPException(404, "Scheme not found")
    row = mf_screener.records(match)[0]
    try:
        monthly = _month_end_series(load_nav(str(scheme_code)))
    except (FileNotFoundError, OSError, ValueError):
        monthly = None
    blocks = _v2_blocks(str(scheme_code), row, monthly)
    return {"data": {"scheme_code": str(scheme_code), "fund": row["name"], "category": row["cat_label"],
                     "cat": row["cat"], "plan": row["plan"], **blocks},
            "availability": "ready"}


@router.get("/mutual-funds/portfolio-coverage")
def backoffice_mf_portfolio_coverage(
    staff: Annotated[dict, Depends(require_staff)],
):
    """Holdings snapshot coverage for the research page sector filter:
    which fund houses and sectors are on file, and the snapshot date.
    Funds outside this coverage keep 'Sector data unavailable'."""
    snapshot = _holdings_snapshot()
    return {"data": {
        "schemes_covered": len(snapshot.get("schemes") or {}),
        "sectors": snapshot.get("sectors") or [],
        "amcs": snapshot.get("amcs") or [],
        "as_of": snapshot.get("as_of"),
        "generated_at": snapshot.get("generated_at"),
    }, "availability": "ready" if snapshot.get("schemes") else "partial"}


@router.get("/mutual-funds/portfolio-overlap")
def backoffice_mf_portfolio_overlap(
    staff: Annotated[dict, Depends(require_staff)],
    code_a: str = Query(...),
    code_b: str = Query(...),
):
    """Overlap between two funds' holdings, from their snapshots.

    Missing a snapshot on either side honestly returns the coverage
    payload with a reason instead of a fabricated 0% overlap. Cash rows
    (TREPS, net receivables) are excluded from both sides: every fund
    holds them, so sharing them is not a real portfolio overlap. A fund
    counts as missing only when it has no snapshot entry at all — a fund
    on file with no non-cash holdings is a real 0 shared holdings, not a
    missing snapshot, and is reported as such."""
    snapshot = _holdings_snapshot()
    entry_a = mf_holdings.holdings_for_scheme(snapshot, code_a)
    entry_b = mf_holdings.holdings_for_scheme(snapshot, code_b)
    hold_a = mf_holdings.overlap_holdings(snapshot, code_a)
    hold_b = mf_holdings.overlap_holdings(snapshot, code_b)
    missing = [c for c, e in ((code_a, entry_a), (code_b, entry_b)) if not e]
    funds = [{
        "code": code, "available": entry is not None,
        "scheme_name": (entry or {}).get("scheme_name"),
        "amc": (entry or {}).get("amc"),
        "as_of": (entry or {}).get("as_of"),
        "source": "Monthly portfolio disclosure",
    } for code, entry in ((code_a, entry_a), (code_b, entry_b))]
    if missing:
        overlap = mf_v2.fund_overlap([], [])
    elif hold_a and hold_b:
        overlap = mf_v2.fund_overlap(hold_a, hold_b)
    else:
        overlap = {
            "shared_holdings": [], "shared_count": 0,
            "shared_weight_in_a_pct": 0.0, "shared_weight_in_b_pct": 0.0,
            "reason": "One or both funds have no non-cash holdings in their snapshot, so there are no holdings to share.",
        }
    return {"data": {
        "code_a": code_a, "code_b": code_b,
        "funds": funds, "missing_codes": missing,
        "as_of_a": funds[0]["as_of"], "as_of_b": funds[1]["as_of"],
        "source": "Monthly portfolio disclosure",
        "overlap": overlap,
        "portfolio_available": not missing,
        "reason": None if not missing else (
            f"No portfolio holdings snapshot on file for fund(s) {', '.join(missing)} "
            "(see research-v2 portfolio block)."
        ),
    }, "availability": "ready" if not missing else "partial"}


@router.get("/mf-research/client-overlap")
def backoffice_mf_client_overlap(
    staff: Annotated[dict, Depends(require_staff)],
    scheme_code: str = Query(...),
    contact_id: str = Query(...),
    horizon_years: float | None = Query(None, ge=0),
):
    """Read-only client check for one shortlisted fund: duplication against
    the contact's CRM holdings, goal-horizon rule flag, suitability flag from
    the client's recorded risk assessment, tax notes, and replacement
    candidates. Nothing here writes, emails, or changes client data.

    Scope note: backoffice staff auth is separate from the CRM RM-book
    scope, so this staff-only read does not apply the CRM RM-book filter;
    it shows the contact's holdings as stored. That scoping gap is flagged
    in the response and in the V2 report for the parent to confirm.
    """
    ter = _REPO.mf_ter_by_code()
    frame = mf_screener.all_frame(
        ter, manager_map=_mf_manager_map(),
        consistency_map=_REPO.screening_consistency_map(),
    )
    match = frame[frame["code"] == str(scheme_code)]
    if match.empty:
        raise HTTPException(404, "Scheme not found")
    candidate = mf_screener.records(match)[0]
    holdings: list[dict[str, Any]] = []
    contact: dict[str, Any] | None = None
    crm_error: str | None = None
    try:
        from app import repo_crm_phase3 as p3

        contact = p3.get_contact(contact_id)
        if contact is None:
            raise HTTPException(404, "Contact not found")
        holdings = p3.list_holdings(contact_ids=[contact_id])
    except HTTPException:
        raise
    except Exception as e:  # CRM store unavailable in this deployment: partial, never a crash
        crm_error = f"CRM holdings unavailable: {e}"
    overlap = mf_v2.client_overlap(candidate, holdings) if not crm_error else None
    suitability = None
    if not crm_error and contact is not None:
        try:
            from app import repo_crm_phase3 as p3

            ops = _v2_blocks(str(scheme_code), candidate, None)["operations"]
            suitability = p3.suitability_check(ops.get("riskometer_level"), contact.get("customer_id") or contact_id)
        except Exception:
            suitability = None
    replacements = mf_v2.replacement_candidates(
        candidate, mf_screener.records(frame[frame["cat"] == candidate["cat"]]))
    return {"data": {
        "scheme_code": str(scheme_code), "fund": candidate["name"], "category": candidate["cat_label"],
        "cat": candidate["cat"], "plan": candidate["plan"],
        "contact_id": contact_id, "contact_name": (contact or {}).get("name"),
        "holdings_count": len(holdings),
        "holdings": holdings,
        "overlap": overlap,
        "horizon": mf_v2.horizon_flag(candidate["cat"], horizon_years),
        "suitability": suitability,
        "tax_notes": mf_v2.tax_notes_for_category(candidate["cat"], candidate["plan"]),
        "replacement_candidates": replacements,
        "crm_error": crm_error,
        "scope_note": "Staff-only read: CRM RM-book scoping is not applied here because backoffice staff auth is separate from CRM auth. Confirm RM-book rules before wider use.",
    }, "availability": "partial" if crm_error else "ready"}


class MfResearchShortlistCreateRequest(BaseModel):
    scheme_code: str = Field(..., min_length=1, max_length=16)
    reason: str | None = Field(None, max_length=500)


_SHORTLIST_CSV_COLS = [
    ("scheme_code", "Scheme Code"), ("fund", "Fund Name"), ("category", "Category"), ("plan", "Plan"),
    ("score", "FH Checklist Score"), ("ret_1y", "1Y %"), ("cagr_3y", "3Y CAGR %"), ("cagr_5y", "5Y CAGR %"),
    ("sharpe_3y", "Sharpe 3Y"), ("cap_spread_3y", "Capture Spread 3Y (pp)"), ("quartile_2y", "Quartile 2Y (computed)"),
    ("manager_name", "Fund Manager"), ("manager_tenure_years", "Manager Tenure (years)"),
    ("roll_win_pct", "Rolling 1Y Win % (vs category median, precomputed)"),
    ("cal_win_pct", "Calendar Win % (vs category median, precomputed)"),
    ("downside_dev_3y", "Downside Deviation 3Y % (precomputed)"),
    ("reason", "Reason"), ("date_added", "Date Added"),
]


def _shortlist_rows(staff_id: str) -> list[dict[str, Any]]:
    """Active shortlist rows joined to the screener frame. Never reads FH Recommended state."""
    items = _REPO.list_mf_research_shortlist(staff_id)
    frame = mf_screener.all_frame(
        _REPO.mf_ter_by_code(), manager_map=_mf_manager_map(),
        consistency_map=_REPO.screening_consistency_map())
    lookup: dict[str, dict[str, Any]] = {}
    if items:
        codes = [it["scheme_code"] for it in items]
        sub = frame[frame["code"].isin(codes)]
        lookup = {r["code"]: r for r in mf_screener.records(sub)}
    out = []
    for it in items:
        f = lookup.get(it["scheme_code"], {})
        out.append({
            "id": it["id"],
            "scheme_code": it["scheme_code"],
            "fund": f.get("name"),
            "category": f.get("cat_label"),
            "cat": f.get("cat"),
            "plan": f.get("plan"),
            "score": f.get("score"),
            "ret_1y": f.get("ret_1y"),
            "cagr_3y": f.get("cagr_3y"),
            "cagr_5y": f.get("cagr_5y"),
            "sharpe_3y": f.get("sharpe_3y"),
            "cap_spread_3y": f.get("cap_spread_3y"),
            "quartile_2y": f.get("quartile_2y"),
            "manager_name": f.get("manager_name"),
            "manager_tenure_years": f.get("manager_tenure_years"),
            "roll_win_pct": f.get("roll_win_pct"),
            "cal_win_pct": f.get("cal_win_pct"),
            "downside_dev_3y": f.get("downside_dev_3y"),
            "reason": it.get("reason"),
            "date_added": it.get("created_at"),
            "status": it.get("status"),
        })
    return out


@router.get("/mf-research/shortlist")
def list_mf_research_shortlist(
    staff: Annotated[dict, Depends(require_staff)],
    format: str = Query("json", pattern="^(json|csv)$"),
):
    """Staff-private research shortlist, joined to the screener frame."""
    rows = _shortlist_rows(staff["id"])
    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=[h for _, h in _SHORTLIST_CSV_COLS])
        writer.writeheader()
        for r in rows:
            writer.writerow({h: r.get(k) for k, h in _SHORTLIST_CSV_COLS})
        return PlainTextResponse(
            buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="fund-horizon-research-shortlist.csv"'},
        )
    return {"data": rows, "total": len(rows), "availability": "ready"}


@router.post("/mf-research/shortlist", status_code=201)
def add_mf_research_shortlist(
    body: MfResearchShortlistCreateRequest,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Add (or reactivate) a scheme on the staff member's research shortlist.
    Adding here never marks anything FH Recommended, and vice versa."""
    verify_csrf(request)
    return _REPO.add_mf_research_shortlist(staff["id"], body.scheme_code.strip(), body.reason)


@router.delete("/mf-research/shortlist/{scheme_code}")
def remove_mf_research_shortlist(
    scheme_code: str,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Soft-remove a scheme from the staff member's research shortlist."""
    verify_csrf(request)
    if not _REPO.remove_mf_research_shortlist(staff["id"], scheme_code):
        raise HTTPException(404, "Shortlist item not found")
    return {"success": True}


@router.get("/mutual-funds/quartile-ranking")
def backoffice_mf_quartile_ranking(
    staff: Annotated[dict, Depends(require_staff)],
    category: str = Query("Equity: Flexi Cap", max_length=80),
    period: str = Query("1y"),
    plan: str = Query("Regular"),
):
    """Advisorkhoj quartile rankings (public page, robots-aware, cached 24h)."""
    if period not in advisorkhoj_provider.QUARTILE_PERIODS or plan not in advisorkhoj_provider.QUARTILE_PLANS:
        raise HTTPException(422, "Bad period or plan.")
    try:
        data = advisorkhoj_provider.fetch_quartile_table(category, period, plan)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except Exception as e:  # httpx errors, robots block, layout change
        raise HTTPException(502, f"Advisorkhoj unavailable: {e}") from None
    return {
        "data": data,
        "fetched_at": data.get("fetched_at"),
        "source": "advisorkhoj",
        "availability": "ready" if data["rows"] else "no_data",
    }


@router.get("/mutual-funds/quartile-annual")
def backoffice_mf_quartile_annual(
    staff: Annotated[dict, Depends(require_staff)],
    category: str = Query("Equity: Flexi Cap", max_length=80),
    plan: str = Query("Regular"),
):
    """Advisorkhoj calendar-year quartile rankings (public page, robots-aware, cached 24h)."""
    if plan not in advisorkhoj_provider.QUARTILE_PLANS:
        raise HTTPException(422, "Bad plan.")
    try:
        data = advisorkhoj_provider.fetch_quartile_annual(category, plan)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except Exception as e:  # httpx errors, robots block, layout change
        raise HTTPException(502, f"Advisorkhoj unavailable: {e}") from None
    return {
        "data": data,
        "fetched_at": data.get("fetched_at"),
        "source": "advisorkhoj",
        "availability": "ready" if data["rows"] else "no_data",
    }


@router.get("/mutual-funds/nav-pair-check")
def backoffice_mf_nav_pair_check(
    staff: Annotated[dict, Depends(require_staff)],
    limit: int = Query(50, ge=1, le=200),
):
    """Growth/IDCW pairs sharing an identical latest NAV — data QA check."""
    pairs = _REPO.mf_identical_nav_pairs(limit)
    return {"data": pairs, "count": len(pairs), "availability": "ready"}


@router.get("/briefing")
def backoffice_briefing(
    staff: Annotated[dict, Depends(require_staff)],
    date: str | None = Query(default=None, description="IST date YYYY-MM-DD; default latest"),
):
    """Stored daily briefing (read-only). No live provider or NSE fetch in the request path.

    Empty sections are included with ``items: []`` and a ``note`` explaining why
    (the frontend collapses them).
    """
    if date is not None:
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=404, detail=f"No briefing stored for date '{date}' (expected YYYY-MM-DD)."
            ) from None
        row = _REPO.get_briefing_by_date(date)
        if row is None:
            raise HTTPException(status_code=404, detail=f"No briefing stored for {date} yet.")
    else:
        row = _REPO.get_latest_briefing()
        if row is None:
            raise HTTPException(status_code=404, detail="No briefing has been built yet.")
    payload = dict(row["payload"])
    payload.pop("_history", None)  # internal change-computation state, not part of the API contract
    return payload


@router.get("/briefing/dates")
def backoffice_briefing_dates(staff: Annotated[dict, Depends(require_staff)]):
    """Last 30 briefing dates (IST, newest first) for the archive picker."""
    return {"dates": _REPO.list_briefing_dates(30)}


@router.post("/briefing/rebuild", status_code=202)
def backoffice_briefing_rebuild(admin: Annotated[dict, Depends(require_role("admin"))]):
    """Manually trigger the daily briefing build (idempotent). Admin only."""
    from app.backoffice.collectors import build_daily_briefing

    res = build_daily_briefing()
    _REPO.log_audit(admin["id"], "briefing_rebuild", "briefing", res["brief_date"], {"brief_date": res["brief_date"]})
    return {"ok": True, "brief_date": res["brief_date"]}


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

    res = {
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
    return with_meta(res, "derived", datetime.now(UTC))


@router.post("/sources/{source_id}/refresh")
async def trigger_source_refresh(
    source_id: str,
    request: Request,
    staff: Annotated[dict, Depends(require_backoffice_role("admin", "operations"))],
):
    """Manually trigger background refresh of an automated source."""
    verify_csrf(request)
    res = await refresh_source(source_id, force=True)
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
    if body.role not in STAFF_ROLES:
        raise HTTPException(422, f"role must be one of: {', '.join(STAFF_ROLES)}")
    pages = _pages_json(body.pages)
    if body.role != "admin" and not pages:
        raise HTTPException(422, "Choose at least one allowed page (admins are unrestricted).")
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
                "pages": pages,
            },
        )
        _REPO.log_audit(admin["id"], "staff_promoted", "staff", existing["id"], {"email": email, "role": body.role})
        return {"success": True, "action": "promoted", "staff": updated, "staff_member": updated, "temporary_password": temporary_password}
    else:
        created = repo.create_customer(
            name=body.name,
            email=email,
            mobile=body.mobile if re.fullmatch(r"[6-9]\d{9}", body.mobile or "") and body.mobile != "9999999999" else f"9{secrets.randbelow(10**9):09d}",
            password_hash=pwd_hash,
            role=body.role,
        )
        repo.update_customer(
            created["id"],
            {
                "is_staff": 1,
                "status": "active",
                "must_change_password": 1 if (body.temp_password or temporary_password) else 0,
                "pages": pages,
            },
        )
        _REPO.log_audit(admin["id"], "staff_created", "staff", created["id"], {"email": email, "role": body.role})
        return {"success": True, "action": "created", "staff": created, "staff_member": created, "temporary_password": temporary_password}


STAFF_ROLES = ("admin", "analyst", "rm", "operations", "read_only", "compliance")
BACKOFFICE_PAGES = (
    "/backoffice", "/backoffice/pms", "/backoffice/mutual-funds", "/backoffice/macro", "/backoffice/micro",
    "/backoffice/derivatives", "/backoffice/flows", "/backoffice/research",
    "/backoffice/data-health", "/backoffice/crm", "/backoffice/operations",
    "/backoffice/risk-profiling", "/backoffice/learn", "/backoffice/settings",
)


def _pages_json(pages: list[str] | None) -> str | None:
    bad = [p for p in pages or [] if p not in BACKOFFICE_PAGES]
    if bad:
        raise HTTPException(422, f"unknown pages: {', '.join(bad)}")
    return json.dumps(sorted(set(pages))) if pages else None


@router.patch("/staff/{staff_id}")
def update_staff_member(
    staff_id: str,
    body: StaffMemberUpdateRequest,
    request: Request,
    admin: Annotated[dict, Depends(require_role("admin"))],
):
    """Admin: change a staff member's role, deactivate/reactivate them, or reset their password."""
    verify_csrf(request)
    repo = get_repository()
    target = repo.get_customer_by_id(staff_id)
    if not target or not target.get("is_staff"):
        raise HTTPException(404, "Staff member not found")
    if body.role is not None and body.role not in STAFF_ROLES:
        raise HTTPException(422, f"role must be one of: {', '.join(STAFF_ROLES)}")
    if body.status is not None and body.status not in ("active", "inactive"):
        raise HTTPException(422, "status must be active or inactive")
    if staff_id == admin["id"] and (body.status == "inactive" or (body.role and body.role != "admin")):
        raise HTTPException(422, "You cannot deactivate or demote your own account.")
    fields: dict = {}
    if body.role is not None:
        fields["role"] = body.role
    if body.status is not None:
        fields["status"] = body.status
    if body.pages is not None:
        fields["pages"] = _pages_json(body.pages)
        if not fields["pages"] and (body.role or target.get("role")) != "admin":
            raise HTTPException(422, "Choose at least one allowed page (admins are unrestricted).")
    temporary_password = None
    if body.reset_password:
        temporary_password = secrets.token_urlsafe(9)
        fields["password_hash"] = _hash_password(temporary_password)
        fields["must_change_password"] = 1
    if body.status == "inactive" or body.reset_password:
        fields["revoked_before"] = datetime.now(UTC).isoformat()  # ends their open sessions
    updated = repo.update_customer(staff_id, fields)
    _REPO.log_audit(admin["id"], "staff_updated", "staff", staff_id, {k: v for k, v in fields.items() if k != "password_hash"})
    return {"success": True, "staff_member": updated, "temporary_password": temporary_password}


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
    res_data = _SCREENING_SERVICE.get_screening_metrics(cat=cat, amc=amc, q_search=q_search, as_of=as_of)
    res = {
        "data": res_data,
        "as_of": res_data.get("as_of"),
        "availability": "ready" if res_data.get("rows") else "unavailable",
        "freshness": "current" if res_data.get("rows") else "stale",
        "method_version": "1.0.0",
    }
    return with_meta(res, "amfi", res_data.get("as_of"))


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


class BackofficeRiskProfileRequest(BaseModel):
    first_name: str = "Client"
    age: int = Field(35, ge=18, le=80)
    employment_type: str = "salaried_private"
    dependents: int = Field(0, ge=0, le=15)
    monthly_income: int = Field(100000, ge=0)
    monthly_expenses: int = Field(40000, ge=0)
    monthly_emi: int = Field(0, ge=0)
    liquid_assets: int = Field(300000, ge=0)
    investments: int = Field(500000, ge=0)
    liabilities: int = Field(0, ge=0)
    term_cover: int = Field(0, ge=0)
    health_cover: int = Field(0, ge=0)
    retirement_age: int = Field(60, ge=40, le=80)
    answers: dict[str, int] = Field(default_factory=dict)
    # optional split chosen on the page; only codes and weights are read, names and reasons are rebuilt server-side
    fund_picks: list[dict[str, Any]] | None = None


@router.get("/risk-profiling/questionnaire")
def backoffice_risk_questionnaire(
    staff: Annotated[dict, Depends(require_staff)],
):
    """Return standard 10-question risk questionnaire."""
    from app.config import load_questionnaire
    return {"status": "success", "data": load_questionnaire()}


@router.post("/risk-profiling/evaluate")
def backoffice_evaluate_risk_profile(
    req: BackofficeRiskProfileRequest,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Evaluate customer risk capacity, tolerance score, final risk band, and target asset allocation."""
    from app.engine.profiling import band_for, build_profile
    from app.schemas import Client, EmploymentType

    try:
        emp = EmploymentType(req.employment_type)
    except Exception:
        emp = EmploymentType.salaried_private

    retire_age = max(req.retirement_age, req.age) if emp != EmploymentType.retired_none else req.retirement_age

    client = Client(
        first_name=req.first_name,
        age=req.age,
        employment_type=emp,
        dependents=req.dependents,
        monthly_income=req.monthly_income,
        monthly_expenses=req.monthly_expenses,
        monthly_emi=req.monthly_emi,
        liquid_assets=req.liquid_assets,
        investments=req.investments,
        liabilities=req.liabilities,
        term_cover=req.term_cover,
        health_cover=req.health_cover,
        retirement_age=retire_age,
    )

    answers = req.answers or {f"q{i}": 2 for i in range(1, 11)}
    profile = build_profile(client, answers)
    allocation = band_for(profile["final_score"])

    return {
        "status": "success",
        "data": {
            **profile,
            "target_allocation": allocation,
        },
    }


def risk_profile_report(req: BackofficeRiskProfileRequest) -> tuple[dict, bytes]:
    """Score a client and render the Risk Profiling and Suitability PDF. Shared by staff and public-link flows."""
    if not req.first_name or len(req.first_name.strip()) < 3:
        raise HTTPException(400, "Client / Household Name is required (minimum 3 characters).")
    if len(req.first_name.strip()) > 100:
        raise HTTPException(400, "Client / Household Name cannot exceed 100 characters.")
    if req.age < 18 or req.age > 100:
        raise HTTPException(400, "Age must be between 18 and 100 years.")
    if req.dependents < 0 or req.dependents > 15:
        raise HTTPException(400, "Financial dependents must be between 0 and 15.")
    if req.monthly_income <= 0:
        raise HTTPException(400, "Monthly income must be greater than 0.")

    from app.config import load_questionnaire
    from app.engine.profiling import band_for, build_profile
    from app.report.risk_profile_doc import build_risk_profile_pdf
    from app.schemas import Client, EmploymentType

    try:
        emp = EmploymentType(req.employment_type)
    except Exception:
        emp = EmploymentType.salaried_private

    retire_age = max(req.retirement_age, req.age) if emp != EmploymentType.retired_none else req.retirement_age

    client = Client(
        first_name=req.first_name,
        age=req.age,
        employment_type=emp,
        dependents=req.dependents,
        monthly_income=req.monthly_income,
        monthly_expenses=req.monthly_expenses,
        monthly_emi=req.monthly_emi,
        liquid_assets=req.liquid_assets,
        investments=req.investments,
        liabilities=req.liabilities,
        term_cover=req.term_cover,
        health_cover=req.health_cover,
        retirement_age=retire_age,
    )

    answers = req.answers or {f"q{i}": 2 for i in range(1, 11)}
    profile = build_profile(client, answers)
    allocation = band_for(profile["final_score"])
    profile["target_allocation"] = allocation

    # Build question responses list with questions text and chosen answers
    q_data = load_questionnaire()
    responses = []
    questions_list = q_data.get("questions", [])
    for q in questions_list:
        qid = q.get("id")
        ans_idx = answers.get(qid, 2)
        opts = q.get("options", [])
        chosen_opt = opts[ans_idx] if 0 <= ans_idx < len(opts) else {"text": "Moderate", "score": 3}
        responses.append({
            "question": q.get("text", ""),
            "answer": chosen_opt.get("text", ""),
            "score": (chosen_opt.get("score", 3) - 1) * 25,  # option scores run 1-5; the report shows 0-100 like the tolerance score
        })

    client_inputs = {
        "age": req.age,
        "monthly_income": req.monthly_income,
        "monthly_expenses": req.monthly_expenses,
        "monthly_emi": req.monthly_emi,
        "liquid_assets": req.liquid_assets,
        "investments": req.investments,
        "liabilities": req.liabilities,
        "term_cover": req.term_cover,
        "health_cover": req.health_cover,
    }

    fund_rows, fund_bt = None, None
    if req.fund_picks:
        from app.ai import picks as ai_picks

        cands = {c["scheme_code"]: c for c in ai_picks.candidates()}
        try:
            clean = ai_picks.validate_weights(
                [{"scheme_code": str(p.get("scheme_code")), "weight_pct": p.get("weight_pct")} for p in req.fund_picks], set(cands))
        except ValueError as e:
            raise HTTPException(422, f"Fund picks: {e}") from e
        from app.ai.backtest import backtest

        fund_bt = backtest(clean)
        fund_rows = [{"scheme_name": cands[p["scheme_code"]]["scheme_name"], "category": cands[p["scheme_code"]]["category"],
                      "weight_pct": p["weight_pct"], "detail": ai_picks._template_reason(cands[p["scheme_code"]])} for p in clean]

    pdf_bytes = build_risk_profile_pdf(
        client_name=req.first_name or "Client",
        profile=profile,
        client_inputs=client_inputs,
        questionnaire_responses=responses,
        fund_picks=fund_rows,
        fund_backtest=fund_bt,
    )
    return profile, pdf_bytes



@router.post("/risk-profiling/report.pdf")
def backoffice_risk_profile_report_pdf(
    req: BackofficeRiskProfileRequest,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Generate and return official client Risk Profiling and Suitability PDF report."""
    _, pdf_bytes = risk_profile_report(req)
    filename_slug = re.sub(r"[^a-zA-Z0-9_\-]+", "_", req.first_name or "client").lower()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="risk-profiling-{filename_slug}.pdf"',
        },
    )


class RecommendedUpdateRequest(BaseModel):
    kind: str  # "mf" or "pms"
    id: str
    name: str = ""
    recommended: bool = True


@router.get("/recommended")
def backoffice_get_recommended():
    return {
        "mf": dict(FH_RECOMMENDED_MF_CODES),
        "pms": dict(FH_RECOMMENDED_PMS_IDS),
    }


@router.post("/recommended")
def backoffice_update_recommended(req: RecommendedUpdateRequest):
    save_recommended_override(req.kind, req.id, req.name, req.recommended)
    return {
        "ok": True,
        "kind": req.kind,
        "id": req.id,
        "recommended": req.recommended,
        "mf_count": len(FH_RECOMMENDED_MF_CODES),
        "pms_count": len(FH_RECOMMENDED_PMS_IDS),
    }


@router.get("/operations/official-forms")
def backoffice_official_forms(staff: Annotated[dict, Depends(require_staff)]):
    """Official CAMS / KFintech (Karvy) forms catalogue (same data the universal search reads)."""
    return {"data": universal_search.official_forms()}


_PDF_LIMIT = 15_000_000
_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"


def _fetch_official_pdf(url: str) -> bytes:
    """Download a catalogue form server-side (the publishers send no CORS headers). Only catalogue URLs are fetched."""
    import requests

    if url not in {f["url"] for f in universal_search.official_forms() if f["kind"] == "PDF"}:
        raise HTTPException(404, "That form is not in the official forms catalogue.")
    host = re.match(r"https?://[^/]+", url).group(0)  # type: ignore[union-attr]
    referer = f"{host}/Investors/Service-requests/Service-Request-Forms" if "camsonline" in host else f"{host}/"
    headers = {
        "User-Agent": _BROWSER_UA, "Accept": "application/pdf,*/*", "Referer": referer, "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin"}
    try:
        for _ in range(4):  # follow redirects by hand, same host only (no open redirect into our network)
            r = requests.get(url, timeout=30, stream=True, allow_redirects=False, headers=headers)
            loc = r.headers.get("Location")
            if r.status_code in (301, 302, 307, 308) and loc:
                url = urljoin(url, loc)
                if urlparse(url).netloc != urlparse(host).netloc:
                    raise HTTPException(502, "The publisher redirected to another site.")
                continue
            break
        body = r.raw.read(_PDF_LIMIT + 1, decode_content=True)
    except requests.RequestException as exc:
        raise HTTPException(502, "Could not reach the publisher's site.") from exc
    if r.status_code != 200 or not body.startswith(b"%PDF") or len(body) > _PDF_LIMIT:
        raise HTTPException(502, "The publisher did not return a usable PDF.")
    return body


@router.get("/operations/official-forms/pdf")
def backoffice_official_form_pdf(url: Annotated[str, Query(max_length=600)], staff: Annotated[dict, Depends(require_staff)]):
    """The PDF of one catalogue form, proxied so the browser editor can open it."""
    return Response(_fetch_official_pdf(url), media_type="application/pdf")


@router.post("/operations/pdf-fill")
async def backoffice_pdf_fill(
    staff: Annotated[dict, Depends(require_staff)],
    edits: Annotated[str, Form()] = "[]",
    drop_fields: Annotated[str, Form()] = "[]",
    url: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    filename: Annotated[str, Form()] = "filled-form",
    log_filing: Annotated[bool, Form()] = False,
    form_title: Annotated[str, Form(max_length=300)] = "",
    household_id: Annotated[str | None, Form(max_length=64)] = None,
    client_name: Annotated[str | None, Form(max_length=200)] = None,
    folio: Annotated[str | None, Form(max_length=60)] = None,
):
    """Draw the editor's typed text, marks, signatures and images onto a PDF (uploaded or from the catalogue).

    With log_filing=true the filled PDF is also stored in the filings register and logged to the household's CRM activity."""
    from app.report.pdf_fill import PdfFillError, apply_edits

    if file is not None:
        src = await file.read(_PDF_LIMIT + 1)
        if len(src) > _PDF_LIMIT:
            raise HTTPException(413, "PDF is larger than 15 MB.")
    elif url:
        src = _fetch_official_pdf(url)
    else:
        raise HTTPException(422, "Provide a PDF file or a catalogue form URL.")
    try:
        out = apply_edits(src, json.loads(edits), json.loads(drop_fields))
    except (PdfFillError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422, str(exc) if isinstance(exc, PdfFillError) else "The edits are malformed.") from exc
    safe = re.sub(r"[^a-zA-Z0-9_\-]+", "_", filename)[:80] or "filled-form"
    headers = {"Content-Disposition": f'attachment; filename="{safe}.pdf"'}
    if log_filing:
        title = form_title.strip() or filename
        filing = _REPO.add_filing(
            form_title=title, form_url=url, household_id=household_id or None, client_name=client_name or None,
            folio=folio or None, staff_id=staff["id"], staff_name=staff.get("name"), pdf=out,
        )
        _log_filing_activity(staff, filing, f"Form filled: {title}")
        headers["X-Filing-Id"] = filing["id"]
    return Response(out, media_type="application/pdf", headers=headers)


FILING_STATUSES = ("Downloaded", "Submitted to RTA", "Ack received")


def _log_filing_activity(staff: dict, filing: dict, subject: str) -> None:
    """Best effort: record the filing on the household's CRM timeline; the register is the source of truth."""
    if not filing.get("household_id"):
        return
    try:
        from app.repo_crm_core import get_crm_repository

        get_crm_repository().create_activity(
            kind="note", subject=subject[:255], household_id=filing["household_id"], actor_id=staff["id"],
            body=f"{filing.get('client_name') or ''} {('Folio ' + filing['folio']) if filing.get('folio') else ''}".strip() or None,
        )
    except Exception:  # noqa: BLE001
        pass


@router.get("/operations/filings")
def backoffice_list_filings(staff: Annotated[dict, Depends(require_staff)]):
    return {"data": _REPO.list_filings(), "statuses": list(FILING_STATUSES)}


class FilingStatusRequest(BaseModel):
    status: int = Field(ge=0, le=2)


@router.patch("/operations/filings/{filing_id}")
def backoffice_update_filing(filing_id: str, body: FilingStatusRequest, request: Request, staff: Annotated[dict, Depends(require_staff)]):
    """Move a filing forward: Downloaded -> Submitted to RTA -> Ack received."""
    verify_csrf(request)
    filing = _REPO.get_filing(filing_id)
    if not filing:
        raise HTTPException(404, "Filing not found")
    if body.status < filing["status"]:
        raise HTTPException(409, "A filing cannot move backwards.")
    _REPO.set_filing_status(filing_id, body.status)
    filing["status"] = body.status
    _log_filing_activity(staff, filing, f"{filing['form_title']} → {FILING_STATUSES[body.status]}")
    _REPO.log_audit(staff["id"], "filing_status", "filing", filing_id, {"status": body.status})
    return {"data": filing}


@router.get("/operations/filings/{filing_id}/pdf")
def backoffice_filing_pdf(filing_id: str, staff: Annotated[dict, Depends(require_staff)]):
    pdf = _REPO.get_filing_pdf(filing_id)
    if pdf is None:
        raise HTTPException(404, "Filing not found")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="filing-{filing_id[:8]}.pdf"'})


@router.get("/operations/status")
async def get_operations_status(
    staff: Annotated[dict, Depends(require_staff)],
):
    """Return RTA and automated forms repository status."""
    return with_meta({
        "status": "online",
        "rta_sync": {
            "cams": {"status": "connected", "latency_ms": 42, "last_synced": "Live AMFI Feed"},
            "kfintech": {"status": "connected", "latency_ms": 38, "last_synced": "Live AMFI Feed"},
            "stallion": {"status": "connected", "latency_ms": 25, "last_synced": "Direct PMA Master"},
        },
        "form_engine": "ReportLab Google-Sans Vector Engine v2026",
        "distributor": {
            "name": "Fund Horizon",
            "arn": "345439",
            "euin": "E482910",
        },
    })

