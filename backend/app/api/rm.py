from __future__ import annotations
"""Relationship-manager routes: view assigned customers and their plans."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_role
from app.db import get_repository

rm_router = APIRouter(prefix="/api/rm", tags=["rm"])


@rm_router.get("/customers")
def rm_list_customers(
    customer: Annotated[dict, Depends(require_role("rm", "admin"))],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Customers assigned to the signed-in RM. Admins see everyone."""
    repo = get_repository()
    scope = None if customer["role"] == "admin" else customer["id"]
    customers = repo.list_customers(limit=limit, offset=offset, assigned_rm_id=scope)
    total = repo.count_customers(assigned_rm_id=scope)
    return {"customers": customers, "total": total, "limit": limit, "offset": offset}


@rm_router.get("/customers/{customer_id}/plans")
def rm_customer_plans(
    customer_id: str,
    customer: Annotated[dict, Depends(require_role("rm", "admin"))],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Plans of one customer. RMs may only view customers assigned to them."""
    repo = get_repository()
    target: dict[str, Any] | None = repo.get_customer_by_id(customer_id)
    if not target:
        raise HTTPException(404, "Customer not found")
    if customer["role"] != "admin" and target.get("assigned_rm_id") != customer["id"]:
        raise HTTPException(403, "You do not have permission to view this customer's plans.")
    plans = repo.list_customer_plans(customer_id, limit=limit, offset=offset)
    total = repo.count_customer_plans(customer_id)
    return {"plans": plans, "total": total, "limit": limit, "offset": offset}
