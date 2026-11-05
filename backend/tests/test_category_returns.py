"""Mutual fund category returns: stats per category, period rules, exports."""
from __future__ import annotations

import io

import numpy as np
import pandas as pd
import pytest

from app.backoffice import category_returns as cr
from tests.test_backoffice_compare import _create_staff, _login_staff


def _frame():
    rows = []
    for i, r in enumerate([10.0, 20.0, 30.0, np.nan]):
        rows.append(dict(code=f"10{i}", name=f"Fund {i} - Regular Plan - Growth", cat="large_cap", plan="Regular", ret_1y=r, cagr_3y=r / 2, week_chg=1.0, ret_1m=1.0, ret_3m=2.0, ret_6m=3.0, cagr_5y=4.0, cagr_10y=5.0, nav_date="31-Oct-2025"))
    rows.append(dict(code="200", name="Direct Large - Direct Plan - Growth", cat="large_cap", plan="Direct", ret_1y=99.0, cagr_3y=9.0, week_chg=1.0, ret_1m=1.0, ret_3m=1.0, ret_6m=1.0, cagr_5y=1.0, cagr_10y=1.0, nav_date="31-Oct-2025"))
    rows.append(dict(code="300", name="HDFC Banking & Financial Services Fund - Regular Plan - Growth", cat="sectoral_thematic", plan="Regular", ret_1y=5.0, cagr_3y=1.0, week_chg=1.0, ret_1m=1.0, ret_3m=1.0, ret_6m=1.0, cagr_5y=1.0, cagr_10y=1.0, nav_date="31-Oct-2025"))
    rows.append(dict(code="301", name="Some Pharma Fund - Regular Plan - Growth", cat="sectoral_thematic", plan="Regular", ret_1y=7.0, cagr_3y=1.0, week_chg=1.0, ret_1m=1.0, ret_3m=1.0, ret_6m=1.0, cagr_5y=1.0, cagr_10y=1.0, nav_date="31-Oct-2025"))
    return pd.DataFrame(rows)


def test_stats_per_category_ignore_missing_and_plan_filter():
    r = cr.build(_frame(), "Equity Schemes", ["1y", "3y"], "Regular")
    lc = next(x for x in r["rows"] if x["category"] == "Equity: Large Cap")
    assert lc["funds"] == 4 and lc["1y"] == {"count": 3, "avg": 20.0, "max": 30.0, "min": 10.0, "median": 20.0}  # the NaN fund is left out, not zero-filled
    assert lc["3y"]["avg"] == 10.0
    both = cr.build(_frame(), "Equity Schemes", ["1y"], "Both")
    assert next(x for x in both["rows"] if x["category"] == "Equity: Large Cap")["1y"]["max"] == 99.0
    assert [p["label"] for p in r["periods"]] == ["1 Yr", "3 Yrs"]  # requested order is kept


def test_sectoral_split_by_name_and_empty_types():
    r = cr.build(_frame(), "Equity Schemes", ["1y"])
    cats = [x["category"] for x in r["rows"]]
    assert "Equity: Sectoral-Banking and Financial Services" in cats and "Equity: Sectoral-Pharma and Healthcare" in cats and "Equity: Sectoral-Technology" not in cats
    assert cr.build(_frame(), "Debt Schemes", ["1y"])["rows"] == []  # no rows rather than an error


def test_period_validation():
    assert cr.parse_periods("1y, 3y ,1y") == ["1y", "3y"]
    for bad in ("", "1y,3y,5y,10y", "2y"):
        with pytest.raises(cr.CategoryReturnsError):
            cr.parse_periods(bad)
    with pytest.raises(cr.CategoryReturnsError):
        cr.build(_frame(), "Nope", ["1y"])


def test_api_json_xlsx_pdf_and_errors(client):
    _login_staff(client, _create_staff())
    base = "/api/backoffice/mutual-funds/category-returns"
    r = client.get(base, params={"fund_type": "Equity Schemes", "period": "1y,3y"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["rows"] and len(j["fund_types"]) == 6 and len(j["all_periods"]) == 9 and [p["key"] for p in j["periods"]] == ["1y", "3y"]
    assert all(x["1y"]["min"] <= x["1y"]["median"] <= x["1y"]["max"] for x in j["rows"] if x["1y"]["count"])
    ytd = client.get(base, params={"fund_type": "Hybrid Schemes", "period": "ytd,1w,10y"})
    assert ytd.status_code == 200 and ytd.json()["rows"]
    x = client.get(base + "/xlsx", params={"period": "1y"})
    assert x.status_code == 200 and x.content[:2] == b"PK"
    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(x.content)).active
    assert ws.cell(2, 1).value == "Category" and ws.max_row > 5
    p = client.get(base + "/pdf", params={"period": "1y"})
    assert p.status_code == 200 and p.content.startswith(b"%PDF")
    for q in ({"period": "1y,3y,5y,10y"}, {"period": ""}, {"period": "zz"}, {"fund_type": "x"}, {"plan": "x"}):
        assert client.get(base, params={"period": "1y", **q}).status_code == 422
    client.cookies.clear()
    assert client.get(base).status_code in (401, 403)
