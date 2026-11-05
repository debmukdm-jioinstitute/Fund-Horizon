from __future__ import annotations
"""Backoffice > Mutual funds > Fund tools: SIP/STP/SWP, rolling returns, advanced tools, benchmark proxies and rankings."""

from fastapi import APIRouter, HTTPException, Request

from app.api.crm_core import Me
from app.backoffice import fund_performance as fp
from app.backoffice import fund_tools as ft

router = APIRouter(prefix="/api/backoffice/mutual-funds/tools", tags=["fund-tools"])


@router.get("/spec")
def spec(me: Me):
    from app.api.backoffice import _fh_frame
    return {"tools": ft.spec(), "meta": fp.meta(_fh_frame()), "benchmarks": list(ft.BENCH)}


@router.get("/run/{tool_id}")
def run(tool_id: str, request: Request, me: Me):
    from app.api.backoffice import _fh_frame
    q = request.query_params
    if len(q) > 30 or any(len(v) > 400 for v in q.values()):
        raise HTTPException(422, "Too many or too long values.")
    frame = _fh_frame()
    try:
        return {**ft.run(frame, tool_id, dict(q)), "as_of": fp.nav_as_of(frame)}
    except fp.PerfError as e:
        raise HTTPException(422, str(e)) from None
