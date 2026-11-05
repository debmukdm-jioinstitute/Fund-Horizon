from __future__ import annotations
"""Backoffice > Mutual funds > Fund performance reports (one generic table per tab)."""

from fastapi import APIRouter, HTTPException, Query

from app.api.crm_core import Me
from app.backoffice import fund_performance as fp

router = APIRouter(prefix="/api/backoffice/mutual-funds/performance", tags=["fund-performance"])
CAT = Query(..., max_length=80)
PLAN = Query("Regular", max_length=10)


def _go(fn, *a):
    from app.api.backoffice import _fh_frame
    try:
        return {**fn(_fh_frame(), *a), "as_of": str(_fh_frame()["nav_date"].max())}
    except fp.PerfError as e:
        raise HTTPException(422, str(e)) from None


def _codes(raw: str) -> list[str]:
    return [c.strip() for c in raw.split(",") if c.strip()]


@router.get("/meta")
def meta(me: Me):
    from app.api.backoffice import _fh_frame
    return fp.meta(_fh_frame())


@router.get("/trailing")
def trailing(me: Me, category: str = CAT, period: str = Query("gt1y", max_length=5), rank: bool = True, plan: str = PLAN):
    return _go(fp.trailing, category, period, rank, plan)


@router.get("/annual")
def annual(me: Me, category: str = CAT, plan: str = PLAN):
    return _go(fp.annual, category, plan)


@router.get("/compare")
def compare(me: Me, codes: str = Query(..., max_length=80), amount: float = Query(10000, gt=0, le=1e11), start: str = Query(..., max_length=10), end: str = Query(..., max_length=10)):
    return _go(fp.compare, _codes(codes), amount, start, end)


@router.get("/lumpsum")
def lumpsum(me: Me, codes: str = Query(..., max_length=80), amount: float = Query(100000, gt=0, le=1e11), start: str = Query(..., max_length=10), end: str = Query(..., max_length=10)):
    return _go(fp.lumpsum, _codes(codes), amount, start, end)


@router.get("/consistent")
def consistent(me: Me, category: str = CAT, plan: str = PLAN):
    return _go(fp.consistent, category, plan)


@router.get("/monthly")
def monthly(me: Me, category: str = CAT, mode: str = Query("Monthly", max_length=10), years: str = Query(..., max_length=20), plan: str = PLAN):
    try:
        ys = [int(y) for y in years.split(",") if y.strip()]
    except ValueError:
        raise HTTPException(422, "Select one to three valid years.") from None
    return _go(fp.monthly, category, mode, ys, plan)


@router.get("/best")
def best(me: Me, amc: list[str] = Query(...), category: str = CAT, period: str = Query("1y", max_length=5), ftype: str = Query("Open", max_length=5), plan: str = PLAN):
    return _go(fp.best, amc, category, period, ftype, plan)


@router.get("/p2p")
def p2p(me: Me, category: str = CAT, start: list[str] = Query(...), end: list[str] = Query(...), plan: str = PLAN):
    if len(start) != len(end):
        raise HTTPException(422, "Each date range needs a start and an end date.")
    return _go(fp.p2p, category, list(zip(start, end)), plan)


@router.get("/assets")
def assets(me: Me, code: str = Query(..., max_length=10), amount: float = Query(100000, gt=0, le=1e11), start_year: int = Query(..., ge=1990, le=2100)):
    return _go(fp.assets, code, amount, start_year)
