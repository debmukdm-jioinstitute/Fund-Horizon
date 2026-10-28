"""MF Research V1 API: managers directory, research detail, shortlist scoping, compare join.

Separate file from the screener/quartile unit tests because these need a TestClient,
staff sessions and a seeded managers table, not just the data frame.
"""
from __future__ import annotations

from app.backoffice.repository import BackofficeRepository
from tests.test_backoffice_compare import _create_staff, _login_staff

ITI_PAIR = ("148535", "148534")  # Regular + Direct rows of one ITI Banking & PSU portfolio


def _seed_iti_manager():
    BackofficeRepository().upsert_mf_managers([
        {"scheme_code": code, "manager_name": "Test Manager", "manager_start": "2020-01-15"}
        for code in ITI_PAIR
    ])


def test_managers_requires_staff(client):
    client.cookies.clear()
    assert client.get("/api/backoffice/mutual-funds/managers").status_code in (401, 403)


def test_managers_directory_dedup_and_filters(client):
    _login_staff(client, _create_staff())
    _seed_iti_manager()
    r = client.get("/api/backoffice/mutual-funds/managers?limit=200")
    assert r.status_code == 200
    rows = r.json()["data"]
    by_name = {row["manager_name"]: row for row in rows}
    assert "Test Manager" in by_name and None in by_name
    mgr = by_name["Test Manager"]
    # Regular + Direct rows of one fund: 2 schemes, 1 portfolio, AUM counted once.
    assert mgr["schemes"] == 2 and mgr["portfolios"] == 1
    assert mgr["aum_incomplete"] is False
    assert 6.7 < mgr["longest_tenure_years"] < 6.8
    assert mgr["avg_tenure_years"] == mgr["longest_tenure_years"]
    assert mgr["needs_data"] is False
    unknown = by_name[None]
    assert unknown["needs_data"] is True
    total_funds = client.get("/api/backoffice/mutual-funds/screener?limit=1").json()["total"]
    assert unknown["schemes"] == total_funds - 2
    # AUM estimate equals the first row's AUM for the portfolio (Regular row first in frame order).
    from app.backoffice import mf_screener as ms

    frame = ms.all_frame({}, manager_map={"148535": ("Test Manager", "2020-01-15"),
                                          "148534": ("Test Manager", "2020-01-15")})
    first_aum = float(frame[frame["code"] == "148535"]["aum_cr"].iloc[0])
    assert abs(mgr["aum_estimate_cr"] - round(first_aum, 2)) < 0.01
    # Search, min_tenure, sort and pagination.
    s = client.get("/api/backoffice/mutual-funds/managers?search=Test%20Manager").json()
    assert [row["manager_name"] for row in s["data"]] == ["Test Manager"]
    assert client.get("/api/backoffice/mutual-funds/managers?search=Unknown").json()["data"]
    assert client.get("/api/backoffice/mutual-funds/managers?min_tenure=50").json()["data"] == []
    assert client.get("/api/backoffice/mutual-funds/managers?min_tenure=5").json()["total"] >= 1
    page = client.get("/api/backoffice/mutual-funds/managers?sort=name&order=asc&limit=1&offset=0").json()
    assert len(page["data"]) == 1 and page["total"] == len(rows)


def test_research_detail_consistency_block(client):
    _login_staff(client, _create_staff())
    from app.backoffice import mf_screener as ms
    from app.data.loader import load_nav

    frame = ms.all_frame({})
    picked = None
    for _, row in frame[(frame["cat"] == "banking_psu") & (frame["plan"] == "Direct")].sort_values(
            "history_years", ascending=False).iterrows():
        try:
            if len(load_nav(str(row["code"]))) >= 84:
                picked = str(row["code"])
                break
        except (FileNotFoundError, OSError, ValueError):
            continue
    assert picked, "no banking_psu Direct fund with 7+ years of monthly NAV in the fixture data"
    BackofficeRepository().upsert_mf_managers(
        [{"scheme_code": picked, "manager_name": "Detail Manager", "manager_start": "2019-06-01"}])
    r = client.get(f"/api/backoffice/mutual-funds/{picked}/research-detail")
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["scheme_code"] == picked and d["manager_name"] == "Detail Manager"
    assert d["manager_tenure_years"] is not None and d["manager_tenure_years"] > 5
    assert d["quartile_basis"] == "computed" and d["median_basis"] == "vs category median"
    assert d["quartile_source"] in ("computed", "unavailable")
    assert d["quartile_2y"] in (None, 1, 2, 3, 4)
    assert d["reason"] is None
    # A 7+ year fund has enough windows for every NAV-derived field.
    assert d["roll_win_pct"] is not None and 0 <= d["roll_win_pct"] <= 100
    assert d["cal_win_pct"] is not None and 0 <= d["cal_win_pct"] <= 100
    assert d["cal_topq_years"] is not None and d["cal_topq_years"] >= 0
    assert d["downside_dev_3y"] is not None and d["downside_dev_3y"] >= 0
    assert d["sip_cagr_3y"] is not None and d["sip_cagr_5y"] is not None
    for col in ("pct_sharpe_3y", "pct_sortino_3y", "pct_alpha_3y", "pct_vol_3y",
                "pct_max_dd_3y", "pct_ret_1y", "pct_cagr_3y", "pct_cagr_5y"):
        assert d[col] is None or 0 <= d[col] <= 100
    assert client.get("/api/backoffice/mutual-funds/999999999/research-detail").status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/backoffice/mutual-funds/{picked}/research-detail").status_code in (401, 403)


def test_shortlist_scoping_reactivation_csv_and_no_recommended_touch(client):
    staff_a = _create_staff()
    staff_b = _create_staff()
    _login_staff(client, staff_a)
    code = ITI_PAIR[0]

    def screener_flag():
        rows = client.get(f"/api/backoffice/mutual-funds/screener?search={code}&limit=50").json()["data"]
        return next(x["is_fh_recommended"] for x in rows if x["code"] == code)

    before = screener_flag()
    r = client.post("/api/backoffice/mf-research/shortlist", json={"scheme_code": code, "reason": "Why it fits"})
    assert r.status_code == 201, r.text
    rows = client.get("/api/backoffice/mf-research/shortlist").json()["data"]
    assert len(rows) == 1
    row = rows[0]
    assert row["scheme_code"] == code and row["reason"] == "Why it fits"
    assert row["fund"] and row["category"] and row["plan"] == "Regular"
    assert row["quartile_2y"] in (None, 1, 2, 3, 4) and row["date_added"]
    assert screener_flag() == before  # shortlist add never touches FH Recommended
    # Staff B cannot see staff A's row.
    _login_staff(client, staff_b)
    assert client.get("/api/backoffice/mf-research/shortlist").json()["data"] == []
    # Staff A: remove, re-add reactivates the same single row with the new reason.
    _login_staff(client, staff_a)
    assert client.delete(f"/api/backoffice/mf-research/shortlist/{code}").status_code == 200
    assert client.get("/api/backoffice/mf-research/shortlist").json()["data"] == []
    assert client.delete(f"/api/backoffice/mf-research/shortlist/{code}").status_code == 404
    assert client.post("/api/backoffice/mf-research/shortlist",
                       json={"scheme_code": code, "reason": "Second look"}).status_code == 201
    rows = client.get("/api/backoffice/mf-research/shortlist").json()["data"]
    assert len(rows) == 1 and rows[0]["reason"] == "Second look"
    csv_r = client.get("/api/backoffice/mf-research/shortlist?format=csv")
    assert csv_r.status_code == 200 and "Reason" in csv_r.text and "Date Added" in csv_r.text
    assert code in csv_r.text and "Second look" in csv_r.text
    client.cookies.clear()
    assert client.get("/api/backoffice/mf-research/shortlist").status_code in (401, 403)
    assert client.post("/api/backoffice/mf-research/shortlist",
                       json={"scheme_code": code}).status_code in (401, 403)


def test_compare_joins_screener_frame(client):
    from app.backoffice import compare as compare_mod
    from app.backoffice import mf_screener as ms
    from app.data.loader import eligible_funds

    compare_mod._CACHE.clear()
    compare_mod._MF_SCREENER_FRAME.clear()
    _login_staff(client, _create_staff())
    codes = eligible_funds()["scheme_code"].head(2).tolist()
    BackofficeRepository().upsert_mf_managers(
        [{"scheme_code": codes[0], "manager_name": "Compare Manager", "manager_start": "2021-03-01"}])
    r = client.get(f"/api/backoffice/compare?type=mf&ids={','.join(codes)}")
    assert r.status_code == 200, r.text
    items = {it["id"]: it for it in r.json()["items"]}
    frame = ms.all_frame({}, manager_map={codes[0]: ("Compare Manager", "2021-03-01")})
    frame_rows = {row["code"]: row for row in ms.records(frame[frame["code"].isin(codes)])}
    first = items[codes[0]]["metrics"]
    assert first["manager"] == "Compare Manager"
    assert first["quartile"] == frame_rows[codes[0]]["quartile_2y"]
    assert first["aum"] == frame_rows[codes[0]]["aum_cr"]
    assert first["manager_tenure"] == frame_rows[codes[0]]["manager_tenure_years"]


# ---------------------------------------------------------------------------
# MF Research V2 API tests
# ---------------------------------------------------------------------------

def _snapshot_codes_with_exit_load():
    """{code: exit_load} from the bundled static reference CSV (no DB load)."""
    import csv
    import gzip
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "data" / "India_MF_Static_Reference_Consolidated.csv.gz"
    if not path.exists():
        return {}
    out = {}
    with gzip.open(path, "rt", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            if row["record_type"] == "scheme_master" and row.get("exit_load"):
                out[row["amfi_scheme_code"]] = row["exit_load"]
    return out


def test_v2_research_blocks_and_screener_columns(client):
    _login_staff(client, _create_staff())
    from app.backoffice import mf_screener as ms

    frame = ms.all_frame({})
    snap = _snapshot_codes_with_exit_load()
    picked = next((c for c in frame["code"].astype(str) if c in snap), None)
    assert picked, "no screener fund found in the reference snapshot"
    r = client.get(f"/api/backoffice/mutual-funds/{picked}/research-v2")
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    # Operations come from the snapshot row, exactly as published.
    assert d["operations"]["available"] is True
    assert d["operations"]["exit_load"] == snap[picked]
    assert d["operations"]["history_unavailable"]["aum_history"]
    # Portfolio: available exactly for funds with a holdings snapshot on
    # file, honestly unavailable (never a fabricated sector split) otherwise.
    # A committed snapshot now ships in the repo, so the meta flags are True.
    from app.backoffice import mf_holdings

    snapshot = mf_holdings.load_snapshot()
    assert d["portfolio"]["available"] is (picked in snapshot["schemes"])
    if picked in snapshot["schemes"]:
        assert d["portfolio"]["sector_available"] is True
        assert d["portfolio"]["holdings"]
        # Debt-only funds carry ratings, not industries, so sectors exist only when some holding has one.
        assert bool(d["portfolio"]["sectors"]) == any(h.get("sector") for h in d["portfolio"]["holdings"])
    else:
        assert d["portfolio"]["sector_available"] is False
        assert d["portfolio"]["holdings"] == []
    # Index: no TRI series stored in a fresh test DB, so the proxy stays.
    assert d["index"]["proxy_retired"] is False
    assert d["index"]["reason"]
    # Screener rows carry the V2 columns (null until the V2 refresh runs)
    # and the screener CSV headers match the on-screen columns.
    s = client.get("/api/backoffice/mutual-funds/screener?limit=1").json()
    row = s["data"][0]
    for col in ("roll_win_pct", "cal_topq_years", "cal_win_pct", "downside_dev_3y",
                "sip_cagr_3y", "sip_cagr_5y", "idx_alpha_3y", "idx_beta_3y"):
        assert col in row
    assert s["meta"]["sector_available"] is True
    assert s["meta"]["portfolio_available"] is True
    csv_r = client.get("/api/backoffice/mutual-funds/screener?format=csv&limit=1")
    assert csv_r.status_code == 200
    assert "Rolling 1Y Win %" in csv_r.text and "vs index TRI" in csv_r.text
    # Research detail carries the same V2 blocks + a consistency source flag.
    detail = client.get(f"/api/backoffice/mutual-funds/{picked}/research-detail").json()["data"]
    assert detail["consistency_source"] in ("precomputed", "live-nav")
    assert detail["portfolio"]["available"] is (picked in snapshot["schemes"])
    assert detail["operations"]["available"] is True
    client.cookies.clear()
    assert client.get(f"/api/backoffice/mutual-funds/{picked}/research-v2").status_code in (401, 403)


def test_v2_portfolio_overlap_honest_unavailable(client):
    _login_staff(client, _create_staff())
    from app.backoffice import mf_holdings
    from app.data.loader import load_metrics

    covered = mf_holdings.load_snapshot()["schemes"]
    a, b = [c for c in load_metrics()["scheme_code"].astype(str) if c not in covered][:2]  # two funds with no snapshot
    r = client.get(f"/api/backoffice/mutual-funds/portfolio-overlap?code_a={a}&code_b={b}")
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["portfolio_available"] is False
    assert d["overlap"]["shared_weight_in_a_pct"] is None
    assert d["overlap"]["reason"]
    client.cookies.clear()
    assert client.get("/api/backoffice/mutual-funds/portfolio-overlap?code_a=1&code_b=2").status_code in (401, 403)


def test_v2_client_overlap_unknown_contact_and_no_writes(client):
    _login_staff(client, _create_staff())
    code = ITI_PAIR[0]
    r = client.get(f"/api/backoffice/mf-research/client-overlap?scheme_code={code}&contact_id=does-not-exist")
    # Either the CRM store answers 404 for an unknown contact, or it is
    # unavailable in this deployment and the endpoint reports partial —
    # in neither case may it invent holdings or write anything.
    if r.status_code == 200:
        d = r.json()["data"]
        assert d["scope_note"] and d["tax_notes"]
        assert d["replacement_candidates"] == [] or all(
            x["score"] is not None for x in d["replacement_candidates"])
        r2 = client.get(f"/api/backoffice/mf-research/client-overlap?scheme_code={code}&contact_id=does-not-exist")
        assert r2.json() == r.json()
    else:
        assert r.status_code == 404
    assert client.get("/api/backoffice/mutual-funds/screener?search=148535&limit=1").status_code == 200
    client.cookies.clear()
    assert client.get(
        f"/api/backoffice/mf-research/client-overlap?scheme_code={code}&contact_id=x").status_code in (401, 403)


def test_shortlist_add_without_reason_reads_back(client):
    """V1 live-check fix: the new in-page reason dialog posts with an empty reason,
    so the API must accept reason null and the entry must read back."""
    _login_staff(client, _create_staff())
    code = ITI_PAIR[0]
    r = client.post("/api/backoffice/mf-research/shortlist", json={"scheme_code": code, "reason": None})
    assert r.status_code == 201, r.text
    rows = client.get("/api/backoffice/mf-research/shortlist").json()["data"]
    assert len(rows) == 1 and rows[0]["scheme_code"] == code and rows[0]["reason"] is None
    assert client.delete(f"/api/backoffice/mf-research/shortlist/{code}").status_code == 200
    assert client.get("/api/backoffice/mf-research/shortlist").json()["data"] == []


def test_research_csv_matches_json_rows_and_header(client):
    """V1 live-check fix 4: the CSV export must carry the same filters as the JSON
    view (including min_tenure, which the CSV link used to drop) and its header
    and rows must match the on-screen filtered set, including computed quartile
    and capture-spread columns."""
    import csv
    import io

    _login_staff(client, _create_staff())
    params = {
        "category": ["flexi_cap"],
        "quartile": [1],
        "quartile_period": "2y",
        "min_tenure": 3,
        "limit": 200,
    }
    j = client.get("/api/backoffice/mutual-funds/screener", params=params)
    assert j.status_code == 200, j.text
    total = j.json()["total"]
    json_codes = [str(r["code"]) for r in j.json()["data"]]
    csv_params = dict(params)
    csv_params["format"] = "csv"
    c = client.get("/api/backoffice/mutual-funds/screener", params=csv_params)
    assert c.status_code == 200, c.text
    assert "text/csv" in c.headers.get("content-type", "")
    reader = csv.DictReader(io.StringIO(c.text))
    assert reader.fieldnames is not None
    for col in ("Scheme Code", "Fund Name", "Quartile 2Y (computed)", "Quartile Source",
                "Capture Spread 3Y (pp)", "TER vs Category+Plan Median (pp)",
                "Fund Manager", "Manager Tenure (years)", "AUM Cr"):
        assert col in reader.fieldnames, reader.fieldnames
    rows = list(reader)
    assert len(rows) == total
    csv_codes = [r["Scheme Code"] for r in rows]
    if total <= 200:
        assert sorted(csv_codes) == sorted(json_codes)
    else:
        assert set(json_codes) <= set(csv_codes)


def test_research_filters_cap_spread_and_ter_gap_accepted(client):
    """V1 live-check fix 5: cap_spread_3y / ter_gap_pp must never 422 with
    'Unknown filter column' on current code (that error proves a pre-V1 backend)."""
    _login_staff(client, _create_staff())
    r = client.get(
        "/api/backoffice/mutual-funds/screener"
        "?category=flexi_cap&f=cap_spread_3y:10:&f=ter_gap_pp:0.5:&limit=5"
    )
    assert r.status_code == 200, r.text
