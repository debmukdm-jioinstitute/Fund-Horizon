from __future__ import annotations
"""Backoffice > Mutual funds > Fund performance reports (one generic table per tab)."""

import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me
from app.backoffice import fund_performance as fp

router = APIRouter(prefix="/api/backoffice/mutual-funds/performance", tags=["fund-performance"])
CAT = Query(..., max_length=80)
PLAN = Query("Regular", max_length=10)


def _go(fn, *a):
    from app.api.backoffice import _fh_frame
    try:
        return {**fn(_fh_frame(), *a), "as_of": fp.nav_as_of(_fh_frame())}
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


def _ranges(start: list[str], end: list[str]) -> list[tuple[str, str]]:
    if not start or len(start) != len(end):
        raise HTTPException(422, "Each date range needs a start and an end date.")
    return list(zip(start, end))


@router.get("/compare")
def compare(me: Me, codes: str = Query(..., max_length=80), amount: float = Query(10000, gt=0, le=1e11), start: list[str] = Query(...), end: list[str] = Query(...)):
    return _go(fp.compare, _codes(codes), amount, _ranges(start, end))


@router.get("/lumpsum")
def lumpsum(me: Me, codes: str = Query(..., max_length=80), amount: float = Query(100000, gt=0, le=1e11), start: list[str] = Query(...), end: list[str] = Query(...)):
    return _go(fp.lumpsum, _codes(codes), amount, _ranges(start, end))


@router.get("/trailing-mcap")
def trailing_mcap(me: Me, category: str = CAT, plan: str = PLAN):
    return _go(fp.trailing_mcap, category, plan)


@router.get("/lumpsum-multi")
def lumpsum_multi(me: Me, category: str = CAT, years: int = Query(5, ge=1, le=30), amount: float = Query(10000, gt=0, le=1e11), plan: str = PLAN):
    return _go(fp.lumpsum_multi, category, years, amount, plan)


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


class PdfColumn(BaseModel):
    key: str = Field(max_length=40)
    label: str = Field(max_length=80)
    group: str | None = Field(default=None, max_length=80)
    kind: str | None = Field(default=None, max_length=10)


class PdfTable(BaseModel):
    title: str = Field(max_length=120)
    columns: list[PdfColumn] = Field(min_length=1, max_length=40)
    rows: list[dict] = Field(max_length=3000)
    note: str = Field(default="", max_length=1000)
    as_of: str = Field(default="", max_length=20)


@router.post("/pdf")
def pdf(t: PdfTable, me: Me):
    """The table the adviser is looking at, as a PDF. The table comes from the page, so it is only laid out here, never recomputed."""
    from app.report.table_pdf import build_table_pdf
    name = re.sub(r"[^\w.\- ]", "_", t.title)[:80] + ".pdf"
    return Response(build_table_pdf(t.model_dump()), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})
