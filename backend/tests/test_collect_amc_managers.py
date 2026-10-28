import pandas as pd
import pytest

from scripts.collect_amc_managers import (
    clean_manager_name,
    match_scheme,
    parse_amc_date,
    run_collection,
)

SAMPLE_UNIVERSE = pd.DataFrame({
    "code": [101, 102, 201, 202, 301, 302],
    "amc": [
        "HDFC Mutual Fund", "HDFC Mutual Fund",
        "HDFC Mutual Fund", "HDFC Mutual Fund",
        "SBI Mutual Fund", "SBI Mutual Fund",
    ],
    "name": [
        "HDFC Top 100 Fund - Regular Plan - Growth",
        "HDFC Top 100 Fund - Direct Plan - Growth",
        "HDFC Small Cap Fund - Regular Plan - Growth",
        "HDFC Small Cap Fund - Direct Plan - Growth",
        "SBI Bluechip Fund - Regular Plan - Growth",
        "SBI Bluechip Fund - Direct Plan - Growth",
    ],
    "plan": ["Regular", "Direct", "Regular", "Direct", "Regular", "Direct"],
})


def test_parse_amc_date_formats():
    assert parse_amc_date("March 26, 2014") == "2014-03-26"
    assert parse_amc_date("26/03/2014") == "2014-03-26"
    assert parse_amc_date("26-03-2014") == "2014-03-26"
    assert parse_amc_date("Nov 2023") in ("2023-11-01", "2023-11-30")
    assert parse_amc_date("Sep-20") in ("2020-09-01", "2020-09-30")
    assert parse_amc_date("invalid-date") is None
    assert parse_amc_date(None) is None


def test_clean_manager_name():
    assert clean_manager_name("Mr. Chirag Mehta") == "Chirag Mehta"
    assert clean_manager_name("• Ms. Mansi Sajeja") == "Mansi Sajeja"
    assert clean_manager_name("Dr. Nirav Sharma (Equity)") == "Nirav Sharma"
    assert clean_manager_name("  Anil   Bamboli  ") == "Anil Bamboli"


def test_match_scheme_maps_regular_and_direct():
    matches = match_scheme(
        "HDFC Mutual Fund",
        "HDFC Top 100 Fund",
        None,
        SAMPLE_UNIVERSE,
    )
    codes = {r["code"] for r in matches}
    assert codes == {101, 102}


def test_match_scheme_with_plan_filter():
    matches = match_scheme(
        "HDFC Mutual Fund",
        "HDFC Top 100 Fund",
        "Direct",
        SAMPLE_UNIVERSE,
    )
    codes = {r["code"] for r in matches}
    assert codes == {102}


def test_match_scheme_refuses_ambiguous():
    ambiguous_df = pd.DataFrame({
        "code": [901, 902],
        "amc": ["HDFC Mutual Fund", "HDFC Mutual Fund"],
        "name": [
            "HDFC Flexi Cap Fund - Series A - Regular Plan - Growth",
            "HDFC Flexi Cap Fund - Series B - Regular Plan - Growth",
        ],
        "plan": ["Regular", "Regular"],
    })
    matches = match_scheme(
        "HDFC Mutual Fund",
        "HDFC Flexi Cap Fund",
        None,
        ambiguous_df,
    )
    assert matches == []


def test_collector_mock_fetcher_no_network(tmp_path, monkeypatch):
    import scripts.collect_amc_managers as cam

    def fake_collector(fetcher):
        return [{
            "scheme_name": "HDFC Top 100 Fund",
            "plan": None,
            "manager_name": "Gopal Agrawal",
            "manager_start": "2020-01-01",
            "url": "http://mock-factsheet.pdf",
        }]

    monkeypatch.setattr(cam, "AMC_COLLECTORS", {"mock_amc": fake_collector})
    monkeypatch.setattr(cam, "AMC_NAMES", {"mock_amc": "HDFC Mutual Fund"})
    monkeypatch.setattr(cam, "OUT_DIR", tmp_path)

    from app.backoffice import mf_screener
    monkeypatch.setattr(mf_screener, "_base_frame", lambda: SAMPLE_UNIVERSE)

    ret = cam.run_collection(
        selected_amc="mock_amc",
        fetcher=lambda url: b"mock-bytes",
    )
    assert ret == 0
    csv_path = tmp_path / "mock_amc.csv"
    assert csv_path.exists()
    content = csv_path.read_text(encoding="utf-8")
    assert "101,Gopal Agrawal,2020-01-01" in content
    assert "102,Gopal Agrawal,2020-01-01" in content
