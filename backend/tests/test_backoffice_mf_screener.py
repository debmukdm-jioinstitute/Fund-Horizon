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


def test_screener_aum_stars_and_risk_columns(client):
    _login_staff(client, _create_staff())
    r = client.get("/api/backoffice/mutual-funds/screener?category=flexi_cap&plan=Direct&f=aum_cr:1000:&sort=aum_cr&limit=200")
    assert r.status_code == 200
    rows = r.json()["data"]
    assert rows and all(x["aum_cr"] >= 1000 for x in rows)
    assert all(x["stars"] in (None, 1, 2, 3, 4, 5) for x in rows)
    assert any(x["alpha_3y"] is not None and x["beta_3y"] is not None and x["hi52"] for x in rows)
    assert all(0 <= x["score"] <= 100 for x in rows if x["score"] is not None)


# --- MF Research V1 frame columns (unit-level, no HTTP) ---


def test_research_quartile_small_group_unavailable_and_source():
    from app.backoffice import mf_screener as ms

    df = ms._scored({})
    small = df[(df["cat"] == "fixed_term") & (df["plan"] == "Regular")]
    assert len(small) >= 1 and len(small) < 8
    assert small["quartile_2y"].isna().all()
    assert (small["quartile_source"] == "unavailable").all()
    assert set(df["quartile_2y"].dropna().unique()) <= {1.0, 2.0, 3.0, 4.0}


def test_research_quartile_top_return_is_q1_and_plans_separate():
    from app.backoffice import mf_screener as ms

    df = ms._scored({})
    for plan in ("Direct", "Regular"):
        grp = df[(df["cat"] == "flexi_cap") & (df["plan"] == plan)].dropna(subset=["ret_2y", "quartile_2y"])
        assert len(grp) >= 8
        top = grp.sort_values("ret_2y", ascending=False).iloc[0]
        assert top["quartile_2y"] == 1.0
        assert (grp["quartile_source"] == "computed").all()
    # Same fund family, different plans: each plan's quartile matches a recomputation
    # over its own plan's peer group only (Direct and Regular are never pooled).
    from app.backoffice.screening.quartiles import compute_category_quartiles

    for plan in ("Direct", "Regular"):
        grp = df[(df["cat"] == "banking_psu") & (df["plan"] == plan)]
        rets = {str(c): (float(v) if v == v else None) for c, v in zip(grp["code"], grp["ret_2y"])}
        expected = compute_category_quartiles(rets, min_peers=8)
        for code, q in expected.items():
            actual = grp[grp["code"] == code]["quartile_2y"].iloc[0]
            assert (actual == q) if q is not None else (actual != actual)


def test_research_capture_spread_and_ter_gap_and_calmar():
    import pandas as pd

    from app.backoffice import mf_screener as ms

    ter = {"148535": 1.0, "148534": 0.5}
    df = ms._scored(ter)
    capped = df[df["cap_up_3y"].notna() & df["cap_down_3y"].notna()]
    assert len(capped) > 0
    assert ((capped["cap_up_3y"] - capped["cap_down_3y"] - capped["cap_spread_3y"]).abs() < 1e-9).all()
    grp = df[(df["cat"] == "banking_psu") & (df["plan"] == "Regular")]
    med = grp["ter"].median()
    row = grp[grp["code"] == "148535"].iloc[0]
    assert abs(row["ter_gap_pp"] - (1.0 - med)) < 1e-9
    both = df[df["cagr_3y"].notna() & df["max_dd_3y"].notna() & df["max_dd_3y"].ne(0)]
    assert len(both) > 0
    sample = both.iloc[0]
    assert abs(sample["calmar_3y"] - sample["cagr_3y"] / abs(sample["max_dd_3y"])) < 1e-9
    assert df["calmar_3y"].notna().any()
    assert df[df["max_dd_3y"].eq(0.0)]["calmar_3y"].isna().all() or (df["max_dd_3y"] != 0.0).all()


def test_research_manager_tenure_rules():
    import pandas as pd

    from app.backoffice import mf_screener as ms

    as_of = pd.Timestamp("2026-10-22")
    mm = {
        "148535": ("Test Manager", "2020-01-15"),
        "148534": ("Future Manager", "2027-01-01"),  # start after as-of -> tenure None
    }
    df = ms._scored({}, manager_map=mm)
    row = df[df["code"] == "148535"].iloc[0]
    assert row["manager_name"] == "Test Manager"
    assert abs(row["manager_tenure_years"] - (as_of - pd.Timestamp("2020-01-15")).days / 365.25) < 1e-6
    future = df[df["code"] == "148534"].iloc[0]
    assert future["manager_tenure_years"] is None or pd.isna(future["manager_tenure_years"])
    # No seed row and no AMFI fallback inside the frame: manager stays unknown, never invented.
    assert df["manager_name"].isna().sum() == len(df) - 2


def test_research_percentiles_bounded_and_rounded():
    from app.backoffice import mf_screener as ms

    df = ms._scored({})
    for col in ("pct_sharpe_3y", "pct_sortino_3y", "pct_alpha_3y", "pct_vol_3y",
                "pct_max_dd_3y", "pct_ret_1y", "pct_cagr_3y", "pct_cagr_5y"):
        vals = df[col].dropna()
        assert ((vals >= 0) & (vals <= 100)).all()
        assert ((vals * 10).round() == vals * 10).all()


def test_research_screen_filters_amc_manager_tenure_quartile():
    from app.backoffice import mf_screener as ms

    mm = {"148535": ("Test Manager", "2020-01-15"), "148534": ("Test Manager", "2020-01-15")}
    amc = ms.screen({}, None, None, None, {}, "score", True, amcs=["ITI Mutual Fund"], manager_map=mm)
    assert len(amc) > 0 and set(amc["amc"].unique()) == {"ITI Mutual Fund"}
    mgr = ms.screen({}, None, None, None, {}, "score", True, manager="test manager", manager_map=mm)
    assert set(mgr["code"]) == {"148534", "148535"}
    kept = ms.screen({}, None, None, None, {}, "score", True, min_tenure=5, include_unknown=True, manager_map=mm)
    assert {"148534", "148535"} <= set(kept["code"])
    known_only = ms.screen({}, None, None, None, {}, "score", True, min_tenure=5, include_unknown=False, manager_map=mm)
    assert set(known_only["code"]) == {"148534", "148535"}
    q1 = ms.screen({}, None, None, None, {}, "score", True, quartiles=[1], quartile_period="2y",
                   include_unavailable=False, manager_map=mm)
    assert len(q1) > 0 and set(q1["quartile_2y"].dropna().unique()) == {1.0}
    q1_with_missing = ms.screen({}, None, None, None, {}, "score", True, quartiles=[1], quartile_period="2y",
                                include_unavailable=True, manager_map=mm)
    assert len(q1_with_missing) > len(q1)
    # Old positional callers still work (new kwargs are keyword-only by position in the signature tail).
    legacy = ms.screen({}, ["flexi_cap"], ["Direct"], None, {}, "score", True)
    assert len(legacy) > 0


def test_screener_meta_and_new_query_params(client):
    _login_staff(client, _create_staff())
    r = client.get("/api/backoffice/mutual-funds/screener?category=flexi_cap&limit=5")
    assert r.status_code == 200
    body = r.json()
    meta = body["meta"]
    assert meta["nav_as_of"] == body["as_of"] and meta["quartile_as_of"] == body["as_of"]
    assert meta["aum_as_of"]  # metrics CSV build date, always present when the dataset is
    assert "ter_as_of" in meta and "managers_as_of" in meta  # null only when the table has no dated rows
    # Existing response fields are untouched.
    assert "data" in body and "total" in body and "groups" in body and "availability" in body
    q = client.get("/api/backoffice/mutual-funds/screener?quartile=1&quartile_period=2y&include_unavailable=false&limit=200")
    assert q.status_code == 200
    assert q.json()["data"] and all(x["quartile_2y"] == 1 for x in q.json()["data"])
    assert client.get("/api/backoffice/mutual-funds/screener?quartile_period=9y").status_code == 422
    assert client.get("/api/backoffice/mutual-funds/screener?quartile=5").status_code == 422
    assert client.get("/api/backoffice/mutual-funds/screener?f=quartile_2y:1:2&limit=5").status_code == 200
    assert client.get("/api/backoffice/mutual-funds/screener?f=cap_spread_3y:0:&limit=5").status_code == 200
