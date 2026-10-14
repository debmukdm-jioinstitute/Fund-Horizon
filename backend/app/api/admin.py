"""Admin panel management API routes for Fund Horizon.

Provides monitoring, plan inspection, CAS session auditing, scheme directory
search, assumptions view, and data synchronization controls.
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_role
from app.api.serialize import clean
from app.config import load_allocation, load_assumptions, load_scoring
from app.data.loader import load_metrics
from app.db import get_repository

logger = logging.getLogger("admin")

admin_router = APIRouter(prefix="/api/admin", tags=["admin"])


def _verify_admin_key(x_admin_key: str | None = None) -> bool:
    """Validate the admin key from the X-Admin-Key header. Fails closed.

    With FH_ADMIN_KEY unset the admin API is disabled (every call is refused). Local development can
    opt in to open access with FH_ADMIN_OPEN=true; never set that in production.
    """
    expected = os.environ.get("FH_ADMIN_KEY", "").strip()
    if not expected:
        return os.environ.get("FH_ADMIN_OPEN", "").strip().lower() in ("1", "true", "yes")
    return hmac.compare_digest((x_admin_key or "").encode(), expected.encode())


@admin_router.get("/health")
def admin_health(x_admin_key: str | None = Header(None, alias="X-Admin-Key")):
    """Overall system health and connectivity audit."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    db_info = repo.get_db_info()

    # ChromaDB check
    rag_info = {"status": "uninitialized"}
    try:
        from app.rag.store import get_collection

        coll = get_collection()
        rag_info = {
            "status": "ready",
            "collection": coll.name,
            "count": coll.count(),
        }
    except Exception as e:
        rag_info = {"status": "error", "error": str(e)}

    return {
        "status": "healthy",
        "database": db_info,
        "rag": rag_info,
        "cors_origins": os.environ.get("FH_CORS_ORIGINS", "http://localhost:3000"),
    }


@admin_router.get("/stats")
def admin_stats(x_admin_key: str | None = Header(None, alias="X-Admin-Key")):
    """Executive KPI summary for admin dashboard."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    df = load_metrics()
    assumptions = load_assumptions()

    total_plans = repo.count_plans()
    total_cas = repo.count_cas_sessions()
    total_schemes = len(df)
    unique_amcs = sorted(df["amc"].dropna().unique().tolist())
    unique_categories = sorted(df["category"].dropna().unique().tolist())

    return {
        "total_plans": total_plans,
        "total_cas_sessions": total_cas,
        "total_schemes": total_schemes,
        "total_amcs": len(unique_amcs),
        "total_categories": len(unique_categories),
        "data_asof": assumptions.get("data_asof", "2026-10-09"),
        "database": repo.get_db_info(),
        "recent_plans": repo.list_plans(limit=5),
        "recent_cas": repo.list_cas_sessions(limit=5),
    }


@admin_router.get("/plans")
def admin_list_plans(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
):
    """List customer plans with pagination and search."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    total = repo.count_plans()
    plans = repo.list_plans(limit=limit, offset=offset, search=search)
    return {"total": total, "limit": limit, "offset": offset, "plans": plans}


@admin_router.get("/plans/{plan_id}")
def admin_get_plan(plan_id: str, x_admin_key: str | None = Header(None, alias="X-Admin-Key")):
    """Get full plan calculation and inputs."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    plan = repo.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    return plan


@admin_router.delete("/plans/{plan_id}")
def admin_delete_plan(plan_id: str, x_admin_key: str | None = Header(None, alias="X-Admin-Key")):
    """Delete a plan record."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    deleted = repo.delete_plan(plan_id)
    if not deleted:
        raise HTTPException(404, "Plan not found")
    return {"success": True, "id": plan_id}


@admin_router.get("/cas-sessions")
def admin_list_cas_sessions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
):
    """List parsed CAS sessions."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    total = repo.count_cas_sessions()
    sessions = repo.list_cas_sessions(limit=limit, offset=offset)
    return {"total": total, "limit": limit, "offset": offset, "sessions": sessions}


@admin_router.get("/cas-sessions/{session_id}")
def admin_get_cas_session(session_id: str, x_admin_key: str | None = Header(None, alias="X-Admin-Key")):
    """Get complete CAS portfolio breakdown."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    repo = get_repository()
    session = repo.get_cas_session(session_id)
    if not session:
        raise HTTPException(404, "CAS session not found")
    return session


@admin_router.get("/schemes")
def admin_list_schemes(
    search: str | None = Query(None),
    amc: str | None = Query(None),
    category: str | None = Query(None),
    plan: str | None = Query(None),
    sort_by: str = Query("scheme_name"),
    order: str = Query("asc"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
):
    """Search and filter the mutual fund directory."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    df = load_metrics().copy()

    # Filters
    if search:
        s = search.strip().lower()
        df = df[
            df["scheme_name"].astype(str).str.lower().str.contains(s, na=False)
            | df["scheme_code"].astype(str).str.contains(s, na=False)
            | df["amc"].astype(str).str.lower().str.contains(s, na=False)
        ]
    if amc:
        df = df[df["amc"] == amc]
    if category:
        df = df[df["category"] == category]
    if plan:
        df = df[df["plan"].astype(str).str.lower() == plan.lower()]

    total = len(df)

    # Sorting
    if sort_by in df.columns:
        ascending = order.lower() == "asc"
        df = df.sort_values(by=sort_by, ascending=ascending, na_position="last")

    sliced = df.iloc[offset : offset + limit]

    records = []
    for _, row in sliced.iterrows():
        records.append({
            "scheme_code": str(row.get("scheme_code", "")),
            "scheme_name": str(row.get("scheme_name", "")),
            "amc": str(row.get("amc", "")),
            "category": str(row.get("category", "")),
            "plan": str(row.get("plan", "Regular")),
            "option": str(row.get("option", "Growth")),
            "latest_nav": float(row["latest_nav"]) if row.get("latest_nav") is not None and str(row["latest_nav"]).lower() != "nan" else None,
            "ret_1y": float(row["ret_1y"]) if row.get("ret_1y") is not None and str(row["ret_1y"]).lower() != "nan" else None,
            "cagr_3y": float(row["cagr_3y"]) if row.get("cagr_3y") is not None and str(row["cagr_3y"]).lower() != "nan" else None,
            "cagr_5y": float(row["cagr_5y"]) if row.get("cagr_5y") is not None and str(row["cagr_5y"]).lower() != "nan" else None,
            "vol_3y": float(row["vol_3y"]) if row.get("vol_3y") is not None and str(row["vol_3y"]).lower() != "nan" else None,
            "sharpe_3y": float(row["sharpe_3y"]) if row.get("sharpe_3y") is not None and str(row["sharpe_3y"]).lower() != "nan" else None,
            "sortino_3y": float(row["sortino_3y"]) if row.get("sortino_3y") is not None and str(row["sortino_3y"]).lower() != "nan" else None,
            "max_drawdown_3y": float(row["max_drawdown_3y"]) if row.get("max_drawdown_3y") is not None and str(row["max_drawdown_3y"]).lower() != "nan" else None,
            "data_quality": str(row.get("data_quality", "ok")),
        })

    all_amcs = sorted(load_metrics()["amc"].dropna().unique().tolist())
    all_categories = sorted(load_metrics()["category"].dropna().unique().tolist())

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "schemes": clean(records),
        "amcs": all_amcs,
        "categories": all_categories,
    }


@admin_router.get("/config")
def admin_get_config(x_admin_key: str | None = Header(None, alias="X-Admin-Key")):
    """Inspect model assumptions, asset allocation tables, and scoring parameters."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    assumptions = load_assumptions()
    allocation = load_allocation()
    scoring = load_scoring()

    ai_config: dict[str, Any] = {}
    try:
        from app.ai.client import get_ai_config

        ai_config = get_ai_config()
    except Exception:
        pass

    return clean({
        "assumptions": assumptions,
        "allocation": allocation,
        "scoring": scoring,
        "ai": ai_config,
    })


class RefreshRequest(BaseModel):
    dry_run: bool = False


class CustomerUpdate(BaseModel):
    role: str | None = None
    assigned_rm_id: str | None = None


@admin_router.get("/customers")
def admin_list_customers(
    customer: Annotated[dict, Depends(require_role("admin"))],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List customer accounts with plan counts. Session-role auth; never exposes password hashes."""
    repo = get_repository()
    customers = repo.list_customers(limit=limit, offset=offset)
    return {
        "customers": customers,
        "total": repo.count_customers(),
        "limit": limit,
        "offset": offset,
    }


@admin_router.patch("/customers/{customer_id}")
def admin_update_customer(
    customer_id: str,
    body: CustomerUpdate,
    customer: Annotated[dict, Depends(require_role("admin"))],
):
    """Update a customer's role or RM assignment. An admin cannot change their own role."""
    repo = get_repository()
    target = repo.get_customer_by_id(customer_id)
    if not target:
        raise HTTPException(404, "Customer not found")
    fields: dict[str, Any] = {}
    if "role" in body.model_fields_set:
        if body.role not in ("customer", "rm", "admin", "compliance"):
            raise HTTPException(422, "role must be one of: customer, rm, admin, compliance")
        if customer_id == customer["id"]:
            raise HTTPException(422, "You cannot change your own role.")
        fields["role"] = body.role
    if "assigned_rm_id" in body.model_fields_set:
        if body.assigned_rm_id is not None:
            rm = repo.get_customer_by_id(body.assigned_rm_id)
            if not rm or rm["role"] != "rm":
                raise HTTPException(422, "assigned_rm_id must reference an existing RM account.")
        fields["assigned_rm_id"] = body.assigned_rm_id
    updated = repo.update_customer(customer_id, fields)
    if not updated:
        raise HTTPException(404, "Customer not found")
    return {"customer": updated}


@admin_router.post("/refresh")
def admin_trigger_refresh(
    req: RefreshRequest,
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
):
    """Trigger data refresh orchestrator."""
    if not _verify_admin_key(x_admin_key):
        raise HTTPException(403, "Invalid administrative key")

    from scripts.refresh_data import refresh_fund_database

    try:
        n_funds, n_metrics = refresh_fund_database(dry_run=req.dry_run)
        return {
            "success": True,
            "dry_run": req.dry_run,
            "funds_processed": n_funds,
            "metrics_processed": n_metrics,
            "message": f"Successfully {'simulated' if req.dry_run else 'synced'} {n_funds} schemes.",
        }
    except Exception as e:
        logger.error(f"Data refresh failed: {e}", exc_info=True)
        raise HTTPException(500, f"Refresh failed: {e}") from e
