"""Fund performance reports: every tab, cross-checks between tabs, validation, auth."""
from __future__ import annotations

import math

import pytest

from tests.test_backoffice_compare import _create_staff, _login_staff

B = "/api/backoffice/mutual-funds/performance"
CAT = "Equity: Large Cap"
F1, F2 = "100471", "101209"  # Franklin India Large Cap, Taurus Large Cap (both long-history, Regular, large cap)


@pytest.fixture
def api(client):
    _login_staff(client, _create_staff())

    def get(path, **params):
        return client.get(B + path, params=params)
    return get


def test_requires_staff(client):
    client.cookies.clear()
    assert client.get(B + "/meta").status_code in (401, 403)
    assert client.get(B + "/trailing", params={"category": CAT}).status_code in (401, 403)


def test_meta(api):
    m = api("/meta").json()
    assert CAT in m["categories"] and m["amcs"][:3] == ["5 Largest Fund Houses", "10 Largest Fund Houses", "15 Largest Fund Houses"] and len(m["amcs"]) > 20


def test_trailing_rank_one_is_the_best_and_columns_follow_options(api):
    gt = api("/trailing", category=CAT).json()
    rows = gt["rows"]
    assert rows and [c["label"] for c in gt["columns"] if c["group"] == "1 Year"] == ["Rtn (%)", "Rank"]
    first = [r["1y"] for r in rows if r["1y"] is not None]
    assert first == sorted(first, reverse=True) and rows[0]["1y_rank"].startswith("1/")
    assert max(first) == first[0]
    norank = api("/trailing", category=CAT, rank="false").json()
    assert all(c["label"] != "Rank" for c in norank["columns"])
    lt = api("/trailing", category=CAT, period="lt1y").json()
    assert [c["group"] for c in lt["columns"] if c["label"] == "Rtn (%)"] == ["1 Month", "3 Months", "6 Months", "YTD", "Launch"]
    for r in rows:  # launch dates are shown DD-MM-YYYY
        assert r["launch"] == "-" or (len(r["launch"]) == 10 and r["launch"][2] == "-" and r["launch"][5] == "-")


def test_monthly_compounds_to_annual_and_quarterly_to_monthly(api):
    mon = {r["code"]: r for r in api("/monthly", category=CAT, mode="Monthly", years="2025").json()["rows"]}
    ann = {r["code"]: r for r in api("/annual", category=CAT).json()["rows"]}
    qtr = {r["code"]: r for r in api("/monthly", category=CAT, mode="Quarterly", years="2025").json()["rows"]}
    checked = 0
    for code, r in mon.items():
        ms = [r[m] for m in ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")]
        if None in ms or code not in ann or ann[code]["2025"] is None:
            continue
        assert math.prod(1 + m / 100 for m in ms) * 100 - 100 == pytest.approx(ann[code]["2025"], abs=0.15)  # rounding of 12 monthly figures
        q = qtr[code]
        assert math.prod(1 + q[k] / 100 for k in ("Q1", "Q2", "Q3", "Q4")) * 100 - 100 == pytest.approx(ann[code]["2025"], abs=0.1)
        checked += 1
    assert checked >= 10


def test_lumpsum_equals_point_to_point_and_compare(api):
    ls = api("/lumpsum", codes=F1, amount=100000, start="2020-01-01", end="2024-12-31").json()["rows"][0]
    p = next(r for r in api("/p2p", category=CAT, start="2020-01-01", end="2024-12-31").json()["rows"] if r["code"] == F1)
    c = api("/compare", codes=F1, amount=100000, start="2020-01-01", end="2024-12-31").json()["rows"][0]
    assert ls["value"] / 100000 * 100 - 100 == pytest.approx(p["abs0"], abs=0.02) == pytest.approx(c["abs"], abs=0.02)
    assert c["value"] == pytest.approx(ls["value"], abs=0.02)
    years = (pd_days("2020-01-01", "2024-12-31")) / 365.25
    assert ls["ret"] == pytest.approx(((ls["value"] / 100000) ** (1 / years) - 1) * 100, abs=0.02) and p["xirr0"] == pytest.approx(ls["ret"], abs=0.02)
    assert c["std"] > 0 and c["beta"] is not None and -1 < c["beta"] < 3
    short = api("/lumpsum", codes=F1, amount=100000, start="2026-06-01", end="2026-09-30").json()["rows"][0]
    assert short["ret"] == pytest.approx(short["value"] / 1000 - 100, abs=0.02)  # under a year: absolute, not annualised
    assert api("/p2p", category=CAT, start="2024-01-01", end="2024-12-31").json()["rows"][0]["xirr0"] is not None


def pd_days(a: str, b: str) -> int:
    import datetime as dt
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def test_p2p_multiple_ranges_and_fund_launched_after_start(api):
    j = api("/p2p", category=CAT, start=["2024-01-01", "2020-01-01"], end=["2024-12-31", "2024-12-31"]).json()
    assert [c["group"] for c in j["columns"] if c["label"] == "XIRR (%)"] == ["01-01-2024 to 31-12-2024", "01-01-2020 to 31-12-2024"]
    young = [r for r in j["rows"] if r["launch"][-4:] in ("2022", "2023", "2024")]
    assert young and all(r["abs1"] is None for r in young if r["launch"][-4:] in ("2022", "2023", "2024"))  # no history at the start of the wider range


def test_consistent_ratings_follow_the_rule(api):
    j = api("/consistent", category=CAT).json()
    rows = j["rows"]
    assert rows and {r["rating"] for r in rows} <= {"Top Performer", "Above Average Performer"}
    tr = api("/trailing", category=CAT).json()["rows"]
    import statistics
    for k in ("1y", "3y", "5y"):
        med = statistics.median([r[k] for r in tr if r[k] is not None])
        for r in rows:
            if r["rating"] == "Top Performer" and r[k] is not None:
                assert r[k] > med - 0.01  # a top performer beats the category median in every period with data
    tops = [r for r in rows if r["rating"] == "Top Performer"]
    assert [r["rating"] for r in rows][: len(tops)] == ["Top Performer"] * len(tops)  # top performers first


def test_best_one_row_per_amc_and_largest_fund_houses(api):
    j = api("/best", amc="5 Largest Fund Houses", category=CAT, period="1y").json()
    assert 1 <= len(j["rows"]) <= 5 and len({r["amc"] for r in j["rows"]}) == len(j["rows"])
    vals = [r["1y"] for r in j["rows"]]
    assert vals == sorted(vals, reverse=True)
    one = api("/best", amc="SBI Mutual Fund", category=CAT, period="3y").json()["rows"]
    assert len(one) == 1 and one[0]["amc"] == "SBI Mutual Fund"
    assert api("/best", amc="SBI Mutual Fund", category=CAT, period="ytd").status_code == 200


def test_assets_proxies(api):
    j = api("/assets", code=F1, amount=100000, start_year=2012).json()
    assert len(j["rows"]) >= 6 and j["rows"][0]["value"] > 0 and j["rows"][0]["cagr"] is not None
    assert api("/assets", code=F1, amount=100000, start_year=2200).status_code == 422


@pytest.mark.parametrize("path,params", [
    ("/trailing", {"category": "Nope"}), ("/trailing", {"category": CAT, "period": "zz"}), ("/annual", {"category": CAT, "plan": "x"}),
    ("/compare", {"codes": f"{F1},{F1},{F2},{F1},{F2},{F1}", "start": "2020-01-01", "end": "2021-01-01"}), ("/compare", {"codes": "99999999", "start": "2020-01-01", "end": "2021-01-01"}),
    ("/compare", {"codes": F1, "start": "2021-01-01", "end": "2020-01-01"}), ("/compare", {"codes": F1, "start": "bad", "end": "2020-01-01"}), ("/lumpsum", {"codes": "", "start": "2020-01-01", "end": "2021-01-01"}),
    ("/monthly", {"category": CAT, "mode": "Weekly", "years": "2025"}), ("/monthly", {"category": CAT, "years": "2025,2024,2023,2022"}), ("/monthly", {"category": CAT, "years": "abc"}),
    ("/p2p", {"category": CAT, "start": "2024-01-01", "end": "2023-01-01"}), ("/best", {"amc": "SBI Mutual Fund", "category": CAT, "period": "9y"}), ("/consistent", {"category": "x"}),
])
def test_bad_input_is_a_readable_422(api, path, params):
    r = api(path, **params)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str) and r.json()["detail"]


def test_direct_plan_and_empty_category_do_not_crash(api):
    assert api("/trailing", category=CAT, plan="Direct").status_code == 200
    assert api("/annual", category="Equity: Contra", plan="Direct").status_code == 200
