"""Customer portal v1 routes. Thin HTTP layer over app.engine.portal pure functions."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.api.serialize import clean, plan_payload
from app.db import sqlite
from app.engine import portal as portal_engine

router = APIRouter()


def _row_or_404(plan_id: str) -> dict:
    row = sqlite.get_plan(plan_id)
    if not row:
        raise HTTPException(404, "Plan not found")
    return row


@router.get("/api/plans/{plan_id}/dashboard")
def portal_dashboard(plan_id: str):
    row = _row_or_404(plan_id)
    return clean(portal_engine.build_dashboard(plan_id, row))


@router.get("/api/plans/{plan_id}/health")
def portal_health(plan_id: str):
    row = _row_or_404(plan_id)
    return clean(portal_engine.build_health(plan_id, row))


@router.get("/api/plans/{plan_id}/analytics")
def portal_analytics(plan_id: str):
    row = _row_or_404(plan_id)
    return clean(portal_engine.build_analytics(plan_id, row))


@router.patch("/api/plans/{plan_id}")
def patch_plan(plan_id: str, request: Request, body: dict):
    """Merge a partial body over the stored inputs, recompute and persist.

    The plan keeps its id and created_at; the result is replaced in place.
    """
    row = _row_or_404(plan_id)
    try:
        new_request, result = portal_engine.recompute_plan(row, body, request.app.state.eligible)
    except ValueError as e:
        raise HTTPException(422, detail=str(e)) from e
    sqlite.update_plan(plan_id, new_request, clean(result))
    saved = sqlite.get_plan(plan_id)
    return plan_payload(plan_id, saved["result"], created_at=saved["created_at"], expires_at=saved["expires_at"])
