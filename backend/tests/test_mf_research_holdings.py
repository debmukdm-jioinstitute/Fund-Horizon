"""Holdings ingestion + TRI scheduled-run tests (MF Research final pass).

Covers: the Motilal XLSX parser (per-format), snapshot upsert/loading,
sector aggregation and fund overlap wired to a real snapshot shape, the
TRI scheduled-run behaviour (rate limit, idempotent upsert, vs-index
columns populated only where a series exists), and the NSE login-wall
detection. Pure functions and temp files only — no network, no live DB.
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
from pathlib import Path

import pandas as pd
import pytest

from app.backoffice import holdings_ingest, index_tri, mf_holdings
from app.backoffice import mf_research_v2 as mf_v2
from app.backoffice.repository import BackofficeRepository

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _motilal_workbook_bytes() -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Motilal Oswal Asset Management Company Limited"])
    ws.append(["MONTHLY PORTFOLIO STATEMENT AS ON SEPTEMBER 30, 2026"])
    ws.append(["Motilal Oswal Flexi Cap Fund"])
    ws.append(["Sr. No.", "Name of the Instrument", "ISIN", "Industry*", "Quantity",
               "Market/Fair Value (Rs. in Lakhs)", "% to Net Assets"])
    ws.append(["(A)", "Equity & Equity related", None, None, None, None, None])
    ws.append(["(a)", "Listed / awaiting listing on Stock Exchanges", None, None, None, None, None])
    ws.append([1, "HDFC Bank Limited", "INE040A01034", "Banks", 100, 500.0, 8.5])
    ws.append([2, "Reliance Industries Limited", "INE002A01018", "Petroleum Products", 50, 400.0, 7.0])
    ws.append([None, "Sub Total", None, None, None, None, 15.5])
    ws.append(["(B)", "Money Market Instruments", None, None, None, None, None])
    ws.append(["(a)", "TREPS / Reverse Repo", None, None, None, None, None])
    ws.append([1, "Triparty Repo", None, None, None, None, 1.0])
    ws.append([None, "Net Receivables / (Payables)", None, None, None, None, -0.5])
    ws.append([None, "GRAND TOTAL", None, None, None, None, 100.0])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_motilal_workbook_sections_and_cash():
    parsed = holdings_ingest.parse_motilal_workbook(
        _motilal_workbook_bytes(), "https://example.invalid/YO99.xlsx")
    assert parsed["scheme_name"] == "Motilal Oswal Flexi Cap Fund"
    assert parsed["as_of"] == "2026-09-30"
    names = [h["name"] for h in parsed["holdings"]]
    assert names == ["HDFC Bank Limited", "Reliance Industries Limited", "Triparty Repo",
                     "Net Receivables / (Payables)"]
    by_name = {h["name"]: h for h in parsed["holdings"]}
    assert by_name["HDFC Bank Limited"]["sector"] == "Banks"
    assert by_name["HDFC Bank Limited"]["isin"] == "INE040A01034"
    assert by_name["HDFC Bank Limited"]["instrument_type"] == "equity"
    assert by_name["Triparty Repo"]["instrument_type"] == "cash"
    assert by_name["Net Receivables / (Payables)"]["instrument_type"] == "cash"
    assert by_name["Triparty Repo"]["sector"] is None


def test_parse_motilal_workbook_missing_header_raises():
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Motilal Oswal Flexi Cap Fund"])
    ws.append([1, "Something", None, None, None, None, 5.0])
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(ValueError, match="header row"):
        holdings_ingest.parse_motilal_workbook(buf.getvalue(), "https://example.invalid/x.xlsx")


def test_motilal_url_extraction_and_month_folder():
    assert holdings_ingest.month_folder_name(2026, 9) == "Month_End_Portfolio_September_2026"
    assert holdings_ingest.month_end_iso(2026, 9) == "2026-09-30"
    html = '<p>portfolioUrl: /content/dam/motilal-mf/sheets/fund-csvs/Month_End_Portfolio_September_2026/YO60.xlsx</p>'
    url = holdings_ingest.extract_motilal_portfolio_url(html, "Month_End_Portfolio_September_2026")
    assert url is not None and url.endswith("YO60.xlsx")
    assert holdings_ingest.extract_motilal_portfolio_url(html, "Month_End_Portfolio_August_2026") is None
    sitemap = ('<urlset><url><loc>https://www.motilaloswalmf.com/mutual-funds/motilal-oswal-flexi-cap-fund</loc>'
               '</url></urlset>')
    assert holdings_ingest.motilal_fund_pages(sitemap) == [
        "https://www.motilaloswalmf.com/mutual-funds/motilal-oswal-flexi-cap-fund"]


def test_scheme_matching_exact_only():
    dataset_names = [
        "Motilal Oswal Flexi Cap Fund - Regular Plan - Growth",
        "Motilal Oswal Flexi Cap Fund - Direct Plan - Growth",
        "Motilal Oswal Midcap Fund - Regular Plan - Growth",
    ]
    matched = mf_holdings.match_disclosure_scheme("Motilal Oswal Flexi Cap Fund", dataset_names)
    assert len(matched) == 2  # both plans share one portfolio
    # Space-insensitive by design: the same scheme spelled "Flexicap" in a
    # disclosure and "Flexi Cap" in the dataset is one scheme, not a guess.
    assert len(mf_holdings.match_disclosure_scheme("Motilal Oswal Flexicap Fund", dataset_names)) == 2
    # Any other wording difference still fails to match — never fuzzy.
    assert mf_holdings.match_disclosure_scheme("Motilal Oswal Large Cap Fund", dataset_names) == []
    assert mf_holdings.match_disclosure_scheme("Motilal Oswal Flexi Cap Growth Fund", dataset_names) == []
    assert mf_holdings.portfolio_key("Motilal Oswal Flexi Cap Fund - Direct Plan - Growth") == \
        mf_holdings.normalize_scheme_name("Motilal Oswal Flexi Cap Fund")


def test_snapshot_write_load_sector_and_overlap(tmp_path):
    rows = [
        {"scheme_code": "1001", "holding_name": "HDFC Bank Limited", "isin": "INE040A01034",
         "sector": "Banks", "weight_pct": 8.5, "instrument_type": "equity"},
        {"scheme_code": "1001", "holding_name": "Reliance Industries Limited", "isin": "INE002A01018",
         "sector": "Petroleum Products", "weight_pct": 7.0, "instrument_type": "equity"},
        {"scheme_code": "1001", "holding_name": "Triparty Repo", "isin": "",
         "sector": "", "weight_pct": 1.0, "instrument_type": "cash"},
        {"scheme_code": "1002", "holding_name": "HDFC Bank Limited", "isin": "INE040A01034",
         "sector": "Banks", "weight_pct": 6.0, "instrument_type": "equity"},
        {"scheme_code": "1002", "holding_name": "Triparty Repo", "isin": "",
         "sector": "", "weight_pct": 2.0, "instrument_type": "cash"},
    ]
    meta = [
        {"scheme_code": "1001", "scheme_name": "Fund A", "amc": "Motilal Oswal Mutual Fund",
         "as_of": "2026-09-30", "source_url": "https://example.invalid/a.xlsx"},
        {"scheme_code": "1002", "scheme_name": "Fund B", "amc": "Motilal Oswal Mutual Fund",
         "as_of": "2026-09-30", "source_url": "https://example.invalid/b.xlsx"},
    ]
    # Real layout: data_dir/mf_holdings/{manifest.json, *.csv}
    holdings_ingest.write_snapshot(tmp_path / "mf_holdings", "motilal_oswal", rows, meta,
                                   "2026-10-15T00:00:00+00:00")
    mf_holdings.clear_snapshot_cache()
    snapshot = mf_holdings.load_snapshot(data_dir=tmp_path)
    assert set(snapshot["schemes"]) == {"1001", "1002"}
    assert snapshot["sectors"] == ["Banks", "Petroleum Products"]
    assert snapshot["as_of"] == "2026-09-30"
    assert mf_holdings.schemes_with_sector(snapshot, "Banks") == {"1001", "1002"}
    assert mf_holdings.schemes_with_sector(snapshot, "Petroleum Products") == {"1001"}
    assert mf_holdings.schemes_with_sector(snapshot, "Healthcare") == set()
    # Sector aggregation wired to the real snapshot shape
    agg = mf_v2.sector_aggregation(snapshot["schemes"]["1001"]["holdings"])
    assert agg["sectors"][0]["sector"] == "Banks"
    assert agg["unclassified_pct"] == 1.0  # cash row only
    # Overlap excludes cash: Triparty Repo must NOT count as shared
    overlap = mf_v2.fund_overlap(
        mf_holdings.overlap_holdings(snapshot, "1001"),
        mf_holdings.overlap_holdings(snapshot, "1002"))
    assert overlap["shared_count"] == 1
    assert overlap["shared_holdings"][0]["name"] == "HDFC Bank Limited"
    assert overlap["shared_weight_in_a_pct"] == 8.5
    # Missing side: honest reason, never 0%
    assert mf_v2.fund_overlap(mf_holdings.overlap_holdings(snapshot, "9999"),
                              mf_holdings.overlap_holdings(snapshot, "1001"))["shared_weight_in_a_pct"] is None


def test_tri_month_end_resampling():
    daily = [
        {"date": "01-Sep-2026", "value": 100.0},
        {"date": "15-Sep-2026", "value": 101.0},
        {"date": "30-Sep-2026", "value": 102.5},
        {"date": "01-Oct-2026", "value": 103.0},
        {"date": "not-a-date", "value": 999.0},
        {"date": "20-Oct-2026", "value": 104.0},
    ]
    out = index_tri.to_month_end_points(daily)
    assert out == [{"date": "2026-09-30", "value": 102.5}, {"date": "2026-10-31", "value": 104.0}]
    assert index_tri.parse_tri_date("01-Jan-2020") is not None
    assert index_tri.parse_tri_date("2020-01-01") is not None
    assert index_tri.parse_tri_date("garbage") is None


def test_tri_login_redirect_raises(monkeypatch):
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        if "Backpage.aspx" in request.url.path:
            return httpx.Response(302, headers={"Location": "https://niftyindices.com/Sitefinity/Login"}, request=request)
        if "Login" in request.url.path:
            return httpx.Response(200, text="<html>login</html>", request=request)
        return httpx.Response(200, text="<html>home</html>", request=request)

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def fake_client(*args, **kwargs):
        kwargs.pop("timeout", None)
        return real_client(transport=transport, follow_redirects=True)

    monkeypatch.setattr(index_tri.httpx, "Client", fake_client)
    with pytest.raises(index_tri.TriLoginRequiredError, match="login"):
        index_tri.fetch_tri("NIFTY 500", "01-Sep-2026", "27-Oct-2026")


def test_refresh_tri_rate_limit_and_month_end(monkeypatch):
    refresh_tri = _load_script("refresh_tri")
    calls: list[str] = []
    sleeps: list[float] = []

    def fake_fetch(name, start, end):
        calls.append(name)
        return [
            {"date": "01-Jan-2023", "value": 100.0},
            {"date": "31-Jan-2023", "value": 101.0},
            {"date": "28-Feb-2023", "value": 102.0},
        ]

    monkeypatch.setattr("time.sleep", lambda s: sleeps.append(s))
    result = refresh_tri.run_refresh(
        fetcher=fake_fetch, years=5, index_names=["NIFTY 500", "NIFTY 100"],
        sleep_seconds=2.0, today=__import__("datetime").date(2026, 10, 28))
    assert calls == ["NIFTY 500", "NIFTY 100"]
    assert sleeps == [2.0]  # one sleep between the two indices, none before the first
    iid = index_tri.instrument_id_for("NIFTY 500")
    assert result["indices"][iid]["points"] == [
        {"date": "2023-01-31", "value": 101.0}, {"date": "2023-02-28", "value": 102.0}]
    assert result["failed"] == []


def test_refresh_tri_idempotent_db_upsert_and_index_metrics(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "tri.db"))
    repo = BackofficeRepository()
    points = [{"date": f"2023-{m:02d}-28", "value": 100.0 + m} for m in range(1, 13)]
    iid = index_tri.instrument_id_for("NIFTY 500")
    assert repo.upsert_benchmark_nav(iid, points) == 12
    assert repo.upsert_benchmark_nav(iid, points) == 12  # replace, not duplicate
    assert len(repo.benchmark_series(iid)) == 12
    # Vs-index columns populate only where a series exists
    fund = pd.Series({pd.Timestamp(f"2024-{m:02d}-28"): 100.0 + m for m in range(1, 13)})
    idx = pd.Series({pd.Timestamp(f"2024-{m:02d}-28"): 200.0 + m for m in range(1, 13)})
    metrics = mf_v2.index_metrics(fund, idx)
    assert metrics["reason"] == "Fewer than 12 common monthly points in the 3Y window"
    fund3y = pd.Series({pd.Timestamp("2021-10-31") + pd.DateOffset(months=i): 100.0 + i for i in range(37)})
    idx3y = pd.Series({pd.Timestamp("2021-10-31") + pd.DateOffset(months=i): 200.0 + i for i in range(37)})
    metrics = mf_v2.index_metrics(fund3y, idx3y)
    assert metrics["beta_3y"] is not None and metrics["reason"] is None
    assert mf_v2.index_metrics(fund3y, pd.Series(dtype=float))["beta_3y"] is None


def test_tri_seed_loader(tmp_path):
    seed = {"generated_at": "2026-10-28T00:00:00+00:00",
            "indices": {index_tri.instrument_id_for("NIFTY 500"): {
                "index_name": "NIFTY 500",
                "points": [{"date": "2026-09-30", "value": 1234.5}]}}}
    (tmp_path / "mf_benchmark_tri.json").write_text(json.dumps(seed))
    index_tri.clear_tri_seed_cache()
    loaded = index_tri.load_tri_seed(data_dir=tmp_path)
    assert loaded[index_tri.instrument_id_for("NIFTY 500")]["points"][0]["value"] == 1234.5
    assert index_tri.load_tri_seed(data_dir=tmp_path / "missing") == {}


def test_snapshot_default_path_is_repo_data_dir():
    """Regression: holdings_dir() must resolve to data/mf_holdings, not
    inside the dataset directory (the loader's data_dir() points at
    data/fundhorizon_mf_rag_dataset)."""
    repo = Path(__file__).resolve().parents[2]
    assert mf_holdings.holdings_dir() == repo / "data" / "mf_holdings"
    manifest = json.loads((repo / "data" / "mf_holdings" / "manifest.json").read_text())
    snap = mf_holdings.load_snapshot()
    assert len(snap["schemes"]) == len(manifest["schemes"]) > 0
    assert snap["as_of"] == manifest["as_of"]
    assert "Motilal Oswal Mutual Fund" in snap["amcs"]


def test_portfolio_summary_cash_by_instrument_type():
    rows = [
        {"name": "HDFC Bank Limited", "weight_pct": 90.0, "instrument_type": "equity"},
        {"name": "TREPS / Reverse Repo", "weight_pct": 7.0, "instrument_type": "cash"},
        {"name": "Net Receivables / (Payables)", "weight_pct": 3.0, "instrument_type": "cash"},
    ]
    summary = mf_v2.portfolio_summary(rows)
    assert summary["cash_pct"] == 10.0
    assert summary["total_weight_pct"] == 100.0


def test_api_portfolio_coverage_sector_filter_detail_and_overlap(client):
    from tests.test_backoffice_compare import _create_staff, _login_staff

    _login_staff(client, _create_staff())
    cov = client.get("/api/backoffice/mutual-funds/portfolio-coverage")
    assert cov.status_code == 200
    cov_data = cov.json()["data"]
    assert cov_data["schemes_covered"] > 0
    assert cov_data["as_of"] == "2026-09-30"
    assert "Motilal Oswal Mutual Fund" in cov_data["amcs"]
    assert "Banks" in cov_data["sectors"]

    # Sector filter: every returned fund must hold the sector in its snapshot
    # (paged through, since the screener caps limit at 200).
    snap = mf_holdings.load_snapshot()
    banks = mf_holdings.schemes_with_sector(snap, "Banks")
    seen: set[str] = set()
    offset = 0
    total = None
    while True:
        r = client.get(f"/api/backoffice/mutual-funds/screener?sector=Banks&limit=200&offset={offset}")
        assert r.status_code == 200
        body = r.json()
        total = body["total"]
        rows = body["data"]
        assert all(x["code"] in banks for x in rows)
        seen.update(x["code"] for x in rows)
        if len(rows) < 200:
            break
        offset += 200
    assert seen and total == len(seen) and seen <= banks
    assert r.json()["meta"]["sector_available"] is True

    # Populated fund: portfolio block available with real sectors + summary.
    d = client.get("/api/backoffice/mutual-funds/129046/research-detail")
    assert d.status_code == 200
    portfolio = d.json()["data"]["portfolio"]
    assert portfolio["available"] is True
    assert portfolio["as_of"] == "2026-09-30"
    assert portfolio["sectors"] and portfolio["total_weight_pct"] == 100.0
    assert portfolio["summary"]["cash_pct"] is not None
    # Vs-index stays null with the honest reason: no TRI series is stored.
    index_block = d.json()["data"]["index"]
    assert index_block["proxy_retired"] is False
    assert "not ingested" in (index_block.get("reason") or "").lower() or "no tri series" in (index_block.get("reason") or "").lower()

    # Unpopulated fund keeps the honest unavailable payload.
    repo = Path(__file__).resolve().parents[2]
    import csv as _csv

    with open(repo / "data" / "fundhorizon_mf_rag_dataset" / "all_schemes_metrics.csv") as fh:
        covered = mf_holdings.load_snapshot()["schemes"]
        non_motilal = next(x["scheme_code"] for x in _csv.DictReader(fh) if x["scheme_code"] not in covered)
    d2 = client.get(f"/api/backoffice/mutual-funds/{non_motilal}/research-detail")
    assert d2.status_code == 200
    assert d2.json()["data"]["portfolio"]["available"] is False

    # Overlap on two populated funds, and the honest reason on a missing side.
    ov = client.get("/api/backoffice/mutual-funds/portfolio-overlap?code_a=129046&code_b=122387")
    assert ov.status_code == 200
    assert ov.json()["data"]["portfolio_available"] is True
    assert ov.json()["data"]["overlap"]["shared_count"] > 0
    ov2 = client.get(f"/api/backoffice/mutual-funds/portfolio-overlap?code_a=129046&code_b={non_motilal}")
    assert ov2.status_code == 200
    assert ov2.json()["data"]["portfolio_available"] is False
    assert ov2.json()["data"]["overlap"]["shared_weight_in_a_pct"] is None
