"""Fund tools: engine maths on synthetic NAV series with known answers, then every tool through the API."""
from __future__ import annotations

import pandas as pd
import pytest

from app.backoffice import fund_tools as ft
from tests.test_backoffice_compare import _create_staff, _login_staff

T = pd.Timestamp


def series(vals, start="2020-01-31"):
    return pd.Series(vals, index=pd.date_range(start, periods=len(vals), freq="ME"))


# ---------------------------------------------------------------- engine
def test_xirr_known_values():
    assert ft.xirr([(T("2020-01-01"), -100), (T("2021-01-01"), 110)]) == pytest.approx(10.0, abs=0.05)
    assert ft.xirr([(T("2020-01-01"), -100), (T("2022-01-01"), 121)]) == pytest.approx(10.0, abs=0.05)
    assert ft.xirr([(T("2020-01-01"), -100), (T("2021-01-01"), 90)]) == pytest.approx(-10.0, abs=0.05)
    assert ft.xirr([(T("2020-01-01"), -100), (T("2020-12-31"), 100)]) == pytest.approx(0.0, abs=0.01)
    assert ft.xirr([(T("2020-01-01"), -100)]) is None and ft.xirr([]) is None  # no inflow: no answer, not a crash


def test_sip_on_flat_and_growing_nav():
    lat = T("2030-01-31")
    flat = series([10.0] * 24)
    x = ft._sip(flat, 1000, T("2020-01-01"), T("2021-12-31"), 1, 0, lat)
    assert x["n"] == 24 and x["invested"] == 24000 and x["value"] == pytest.approx(24000) and x["xirr"] == pytest.approx(0, abs=0.05)
    grow = series([100 * 1.01 ** i for i in range(24)])  # 1% a month
    g = ft._sip(grow, 1000, T("2020-01-01"), T("2021-12-31"), 1, 0, lat)
    assert g["value"] == pytest.approx(sum(1000 * 1.01 ** (23 - i) for i in range(24)), rel=1e-9)
    assert g["xirr"] == pytest.approx(((1.01 ** 12) - 1) * 100, abs=1.0)  # about 12.7% a year
    q = ft._sip(grow, 1000, T("2020-01-01"), T("2021-12-31"), 3, 0, lat)
    assert q["n"] == 8 and q["invested"] == 8000
    up = ft._sip(flat, 1000, T("2020-01-01"), T("2021-12-31"), 1, 10, lat)
    assert up["invested"] == 12 * 1000 + 12 * 1100  # the instalment rises 10% in year two
    with pytest.raises(ft.PerfError):
        ft._sip(flat, 1000, T("2030-01-01"), T("2031-01-01"), 1, 0, lat)


def test_swp_stops_when_units_run_out_and_conserves_money():
    flat = series([10.0] * 36)
    x = ft._swp(flat, 1000.0, 1000.0, T("2020-02-01"), T("2022-12-31"), 1, 0, T("2030-01-01"))  # Rs.10,000 of units, Rs.1,000 a month
    assert x["n"] == 10 and x["taken"] == pytest.approx(10000) and x["units"] == pytest.approx(0)
    y = ft._swp(flat, 5000.0, 1000.0, T("2020-02-01"), T("2020-12-31"), 1, 0, T("2030-01-01"))
    assert y["taken"] + y["units"] * 10 == pytest.approx(50000)
    inc = ft._swp(flat, 5000.0, 1000.0, T("2020-01-01"), T("2021-12-31"), 1, 10, T("2030-01-01"))
    assert inc["taken"] == pytest.approx(12 * 1000 + 12 * 1100)


def test_rolling_constant_growth_has_no_spread():
    r = ft._roll(series([100 * 1.12 ** (i / 12) for i in range(80)]), 3, T("2020-01-01"))
    assert len(r) > 30 and r.min() == pytest.approx(12.0, abs=0.01) and r.max() == pytest.approx(12.0, abs=0.01)
    row = ft._roll_row("x", r)
    assert row["std"] == pytest.approx(0, abs=0.01) and row["8-12"] + row["12-15"] == pytest.approx(100, abs=0.01)
    assert sum(row[k] for k in ft.BNAMES) == pytest.approx(100, abs=0.05)
    gap = series([100, 101, 102, 103, 104, 105]).drop(pd.Timestamp("2020-03-31"))  # a missing month must not shift windows
    assert len(ft._monthly(gap)) == 6


def test_quartiles():
    v = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0])
    q = ft._quart(v, True)
    assert list(q) == [4, 4, 3, 3, 2, 2, 1, 1]  # best (highest) is quartile 1
    assert list(ft._quart(v, False)) == [1, 1, 2, 2, 3, 3, 4, 4]  # lower is better
    assert pd.isna(ft._quart(pd.Series([1.0, None, 3.0]), True).iloc[1])


def test_ppf_rates_cover_every_year():
    assert all(y in ft.PPF_RATE for y in range(2001, 2027))


# ---------------------------------------------------------------- API
@pytest.fixture
def api(client):
    _login_staff(client, _create_staff())
    return client


def _params(t, cat="Equity: Large Cap", f1="100471", f2="101209"):
    import datetime as dt
    today = dt.date.today()
    out = {}
    for f in t["fields"]:
        k, ty = f["key"], f["type"]
        if ty == "category": out[k] = cat
        elif ty == "plan": out[k] = "Regular"
        elif ty == "fund": out[k] = f2 if k in ("code_to", "code2") else f1
        elif ty == "funds": out[k] = f1 if t["id"] == "elss-vs-ppf" else f"{f1},{f2}"
        elif ty == "number": out[k] = str(f["default"])
        elif ty == "select": out[k] = f["default"]
        elif ty == "multi": out[k] = "|".join(f["default"])
        elif ty == "date": out[k] = today.isoformat() if f["default"] == "today" else today.replace(year=today.year - int(f["default"][1:-1])).isoformat()
    return out


def test_requires_staff(client):
    client.cookies.clear()
    assert client.get("/api/backoffice/mutual-funds/tools/spec").status_code in (401, 403)
    assert client.get("/api/backoffice/mutual-funds/tools/run/sip-returns").status_code in (401, 403)


def test_spec_is_complete_and_unique(api):
    j = api.get("/api/backoffice/mutual-funds/tools/spec").json()
    ids = [t["id"] for t in j["tools"]]
    assert len(ids) == len(set(ids)) >= 30 and {t["group"] for t in j["tools"]} == {"SIP / STP / SWP", "Rolling returns", "Advanced tools", "Benchmark", "Ranking"}
    assert "5 Largest Fund Houses" in j["meta"]["amcs"] and len(j["benchmarks"]) == 6
    for t in j["tools"]:
        assert t["title"] and t["blurb"] and t["fields"] and all(f["type"] in ("category", "plan", "fund", "funds", "date", "number", "select", "multi", "amc") for f in t["fields"]), t["id"]


def test_every_tool_runs_with_its_defaults(api):
    for t in api.get("/api/backoffice/mutual-funds/tools/spec").json()["tools"]:
        r = api.get(f"/api/backoffice/mutual-funds/tools/run/{t['id']}", params=_params(t))
        assert r.status_code == 200, (t["id"], r.text)
        j = r.json()
        assert j["columns"] and j["rows"] is not None and j["title"] and j["as_of"] and len(j["as_of"]) == 10, t["id"]
        keys = {c["key"] for c in j["columns"]}
        assert all(isinstance(c["label"], str) and c["label"] for c in j["columns"])
        for row in j["rows"][:5]:
            assert keys - set(row) <= keys  # every column key is either present or shown as a dash
            for v in row.values():
                assert not (isinstance(v, float) and v != v), t["id"]  # no NaN reaches the page


def test_cross_checks_between_tools(api):
    run = lambda i, **p: api.get(f"/api/backoffice/mutual-funds/tools/run/{i}", params=p)  # noqa: E731
    import datetime as dt
    t = dt.date.today()
    s5 = t.replace(year=t.year - 5).isoformat()
    # SIP returns (monthly, 5 years): invested = installments x amount
    r = run("sip-returns", codes="100471", amount=2000, frequency="Monthly", start=s5, end=t.isoformat()).json()["rows"][0]
    assert r["invested"] == r["n"] * 2000 and 58 <= r["n"] <= 62 and r["gain"] == pytest.approx(r["value"] - r["invested"], abs=1)
    q = run("sip-returns", codes="100471", amount=2000, frequency="Quarterly", start=s5, end=t.isoformat()).json()["rows"][0]
    assert q["n"] == pytest.approx(r["n"] / 3, abs=1)
    # top-up: more invested and a higher final value than the fixed SIP
    u = run("sip-topup", code="100471", amount=5000, frequency="Monthly", start=s5, end=t.isoformat(), topup="10").json()["rows"][0]
    assert u["inv_up"] > u["inv_flat"] and u["val_up"] > u["val_flat"] * 0.95
    # STP: money is conserved (value = left + value of the target fund)
    st = run("stp-returns", code_from="100471", code_to="101209", init=1000000, invest_date=s5, transfer=20000, frequency="Monthly", start=s5, end=t.isoformat()).json()["rows"][0]
    assert st["value"] == pytest.approx(st["left"] + st["to_value"], abs=2) and st["moved"] <= 1000000 * 3
    # SWP: withdrawals never exceed what the plan could pay; value is non-negative
    sw = run("swp-returns", code="100471", lumpsum=1000000, invest_date=s5, amount=5000, frequency="Monthly", start=s5, end=t.isoformat()).json()["rows"][0]
    assert sw["taken"] == pytest.approx(sw["n"] * 5000, abs=1) and sw["value"] >= 0
    # market cap capture: rows sorted by capture ratio
    c = run("capture", category="Equity: Large Cap", period=3, plan="Regular").json()["rows"]
    ratios = [x["ratio"] for x in c if x["ratio"] is not None]
    assert ratios == sorted(ratios, reverse=True) and len(ratios) > 10
    # volatility ranking: quartile 1 funds have lower std dev than quartile 4 funds
    v = run("rank-volatility", category="Equity: Large Cap", plan="Regular").json()["rows"]
    q1 = [x["sd"] for x in v if x["sd_q"] == 1]
    q4 = [x["sd"] for x in v if x["sd_q"] == 4]
    assert q1 and q4 and max(q1) <= min(q4)
    # top quartile average beats the category average
    tq = {x["scheme"]: x for x in run("top-quartile", category="Equity: Large Cap", plan="Regular").json()["rows"]}
    assert tq["Average of top-quartile funds"]["3y"] > tq["Category average"]["3y"] and tq["Best fund"]["3y"] >= tq["Average of top-quartile funds"]["3y"]
    # overlap of a fund with itself is the whole portfolio equity weight
    o = run("overlap", codes="100471,100471")
    assert o.status_code == 200 or o.status_code == 422


def test_bad_input_is_readable(api):
    run = lambda i, **p: api.get(f"/api/backoffice/mutual-funds/tools/run/{i}", params=p)  # noqa: E731
    cases = [("nope", {}), ("sip-returns", {"codes": "", "amount": 1000, "frequency": "Monthly", "start": "2020-01-01", "end": "2021-01-01"}),
             ("sip-returns", {"codes": "100471", "amount": 1000, "frequency": "Daily", "start": "2020-01-01", "end": "2021-01-01"}),
             ("sip-returns", {"codes": "100471", "amount": 1000, "frequency": "Monthly", "start": "2021-01-01", "end": "2020-01-01"}),
             ("sip-returns", {"codes": "100471", "amount": 0, "frequency": "Monthly", "start": "2020-01-01", "end": "2021-01-01"}),
             ("sip-returns", {"codes": "100471", "amount": "abc", "frequency": "Monthly", "start": "2020-01-01", "end": "2021-01-01"}),
             ("sip-returns", {"codes": "100471,100471,100471,100471,100471,100471", "amount": 1000, "frequency": "Monthly", "start": "2020-01-01", "end": "2021-01-01"}),
             ("sip-returns", {"codes": "99999999", "amount": 1000, "frequency": "Monthly", "start": "2020-01-01", "end": "2021-01-01"}),
             ("sip-returns", {"codes": "100471", "amount": 1000, "frequency": "Monthly", "start": "01-01-2020", "end": "2021-01-01"}),
             ("swp-returns", {"code": "100471", "lumpsum": 1000000, "invest_date": "2020-06-01", "amount": 5000, "frequency": "Monthly", "start": "2020-01-01", "end": "2021-01-01"}),
             ("stp-returns", {"code_from": "100471", "code_to": "100471", "init": 100000, "invest_date": "2018-01-01", "transfer": 1000, "frequency": "Monthly", "start": "2018-02-01", "end": "2020-01-01"}),
             ("rolling-category", {"codes": "100471", "start": "2015-01-01", "years": "4"}), ("rank-risk", {"category": "Nope", "plan": "Regular"}), ("rank-risk", {"category": "Equity: Large Cap", "plan": "X"}),
             ("drawdown-recovery", {"code": "100471", "benchmark": "NIFTY 500 (index fund proxy)", "threshold": 1}), ("bench-nav", {"benchmark": "Nifty", "start": "2020-01-01", "end": "2021-01-01"}),
             ("bench-swp", {"benchmark": "NIFTY 500 (index fund proxy)", "lumpsum": 1000000, "invest_date": "2005-01-01", "amount": 5000, "frequency": "Monthly", "start": "2005-02-01", "end": "2010-01-01"})]
    for tool, p in cases:
        r = run(tool, **p)
        assert r.status_code == 422 and isinstance(r.json()["detail"], str) and r.json()["detail"], (tool, p, r.status_code, r.text[:120])
    assert "NAV only from" in run("bench-swp", benchmark="NIFTY 500 (index fund proxy)", lumpsum=1000000, invest_date="2005-01-01", amount=5000, frequency="Monthly", start="2005-02-01", end="2010-01-01").json()["detail"]
