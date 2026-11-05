from __future__ import annotations
"""Backoffice > Mutual funds > Category returns: JSON, Excel and PDF."""

import io

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.api.crm_core import Me
from app.backoffice import category_returns as cr

router = APIRouter(prefix="/api/backoffice/mutual-funds/category-returns", tags=["category-returns"])


def _data(fund_type: str, period: str, plan: str) -> dict:
    from app.api.backoffice import _fh_frame
    try:
        return cr.build(_fh_frame(), fund_type, cr.parse_periods(period), plan)
    except cr.CategoryReturnsError as e:
        raise HTTPException(422, str(e)) from None


@router.get("")
def category_returns(me: Me, fund_type: str = Query("Equity Schemes", max_length=40), period: str = Query("1y", max_length=40), plan: str = Query("Regular", max_length=10)):
    return {**_data(fund_type, period, plan), "fund_types": list(cr.FUND_TYPES), "all_periods": [{"key": k, "label": v[0]} for k, v in cr.PERIODS.items()]}


@router.get("/xlsx")
def xlsx(me: Me, fund_type: str = Query("Equity Schemes", max_length=40), period: str = Query("1y", max_length=40), plan: str = Query("Regular", max_length=10)):
    from openpyxl import Workbook
    r = _data(fund_type, period, plan)
    head, body = cr.flat_rows(r)
    wb = Workbook(); ws = wb.active; ws.title = "Category returns"[:31]
    ws.append([f"Mutual Fund Category Returns - {r['fund_type']} ({r['plan']} plans), NAV as on {r['nav_as_of']}"]); ws.append(head)
    for row in body:
        ws.append(row)
    ws.append([r["note"]])
    buf = io.BytesIO(); wb.save(buf)
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="Mutual Fund Category Returns.xlsx"'})


@router.get("/pdf")
def pdf(me: Me, fund_type: str = Query("Equity Schemes", max_length=40), period: str = Query("1y", max_length=40), plan: str = Query("Regular", max_length=10)):
    from app.report.category_returns import build_pdf
    return Response(build_pdf(_data(fund_type, period, plan)), media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="Mutual Fund Category Returns.pdf"'})
