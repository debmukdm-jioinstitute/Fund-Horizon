"""MF screener: filters, sorting, score bounds, CSV export, auth."""
from __future__ import annotations

from tests.test_backoffice_compare import _create_staff, _login_staff


def test_screener_requires_staff(client):
    client.cookies.clear()
    assert client.get("/api/backoffice/mutual-funds/screener").status_code in (401, 403)


def test_screener_filters_sorts_and_scores(client):
    _login_staff(client, _create_staff())
    r = client.get("/api/backoffice/mutual-funds/screener?category=flexi_cap&category=multi_cap&plan=Direct&limit=200")
    assert r.status_code == 200
    body = r.json()
    rows = body["data"]
    assert rows and body["total"] == len(rows)
    assert {x["plan"] for x in rows} == {"Direct"}
    assert {x["cat"] for x in rows} <= {"flexi_cap", "multi_cap"}
    scores = [x["score"] for x in rows if x["score"] is not None]
    assert scores == sorted(scores, reverse=True) and all(0 <= s <= 100 for s in scores)
    assert any(g["group"] == "Equity" for g in body["groups"])


def test_screener_range_filter_and_validation(client):
    _login_staff(client, _create_staff())
    r = client.get("/api/backoffice/mutual-funds/screener?category=large_cap&f=cagr_3y:10:&sort=cagr_3y")
    assert r.status_code == 200 and all(x["cagr_3y"] >= 10 for x in r.json()["data"])
    assert client.get("/api/backoffice/mutual-funds/screener?sort=bogus").status_code == 422
    assert client.get("/api/backoffice/mutual-funds/screener?f=evil:1:2").status_code == 422


def test_screener_csv(client):
    _login_staff(client, _create_staff())
    r = client.get("/api/backoffice/mutual-funds/screener?category=large_cap&format=csv")
    assert r.status_code == 200 and r.text.startswith("Scheme Code,Fund Name")


def test_screener_recommended_flag(client):
    _login_staff(client, _create_staff())
    r = client.get("/api/backoffice/mutual-funds/screener?recommended=true&limit=200")
    assert r.status_code == 200
    rows = r.json()["data"]
    assert rows and all(x["is_fh_recommended"] for x in rows)
