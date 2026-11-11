import re

import pandas as pd
import pytest
from pydantic import ValidationError

from app.api import portfolio_review as api
from app.report.portfolio_review import build_portfolio_review, window_fall

H = [{"code": "122640", "invested": 940934, "value": 1600734, "name": "Parag Parikh Flexi Cap", "period": "Feb-20 - Jul-26", "inst": "71", "ret": 14.02},
     {"code": "150579", "invested": 999949, "value": 720380, "name": "Edelweiss Gold & Silver", "flag": "†"},
     {"code": "100177", "invested": 209991, "value": 227703, "name": "Quant Small Cap"}]  # last: not in the live frame
FRAME = pd.DataFrame([
    {"code": "122640", "name": "PPFAS Flexi", "cat": "flexi_cap", "cat_label": "Flexi Cap", "nav_date": "04-Nov-2026", "cagr_3y": 11.9, "cap_up_3y": 69.0, "cap_down_3y": 47.0, "cap_ratio_3y": 1.48,
     "max_dd_3y": -11.2, "max_dd_all": -31.3, "history_years": 13.4, "fh_score": 57.5, "fh_signal": "Hold", "fh_signal_reasons": ["in line with peers"], "is_fh_recommended": False},
    {"code": "150579", "name": "Edelweiss G&S", "cat": "gold", "cat_label": "Gold", "nav_date": "04-Nov-2026", "cagr_3y": 33.7, "cap_up_3y": None, "cap_down_3y": None, "cap_ratio_3y": None,
     "max_dd_3y": -38.8, "max_dd_all": -38.8, "history_years": 4.1, "fh_score": 27.6, "fh_signal": "Sell", "fh_signal_reasons": [], "is_fh_recommended": True, "quality": "ok"},
    {"code": "100177", "name": "Quant Small Cap Fund - Regular Plan - Growth", "cat": "small_cap", "cat_label": "Small Cap", "nav_date": "04-Nov-2026", "cagr_3y": 9.0, "cap_up_3y": 90.0, "cap_down_3y": 90.0,
     "cap_ratio_3y": 1.0, "max_dd_3y": -20.0, "max_dd_all": -70.0, "history_years": 20.0, "fh_score": 50.0, "fh_signal": "Hold", "fh_signal_reasons": [], "is_fh_recommended": False, "quality": "nav_shock"}])


@pytest.fixture
def live(monkeypatch):
    nav = pd.Series([100, 90, 80, 95], index=pd.to_datetime(["2019-12-31", "2020-01-31", "2020-03-31", "2020-04-30"]))
    monkeypatch.setattr(api, "_frame", lambda: FRAME)
    monkeypatch.setattr(api, "_nav", lambda c: nav if c == "122640" else None)


def test_window_fall_is_the_funds_own_peak_to_trough_and_none_if_too_young():
    nav = pd.Series([100, 90, 80, 95], index=pd.to_datetime(["2019-12-31", "2020-01-31", "2020-03-31", "2020-04-30"]))
    assert window_fall(nav, "2020-01-01", "2020-04-30") == -11.1  # 90 -> 80
    assert window_fall(nav, "2019-06-01", "2020-04-30") is None  # fund starts after the window
    assert window_fall(None, "2020-01-01", "2020-04-30") is None


def test_pdf_builds_google_sans_only_and_missing_live_data_is_dashed_not_estimated(live):
    rv = api.Review(client={"name": "A B Test", "date": "26 Oct 2026"}, holdings=H)
    live_d = api.live_data([h.code for h in rv.holdings])
    q = live_d["100177"]; assert q["reason"] and "fh_score" not in q and q["name"] == "Quant Small Cap Fund"  # excluded fund shows no metrics
    assert set(live_d) == {"122640", "150579", "100177"} and live_d["122640"]["falls"]["covid"] == -11.1 and live_d["150579"]["recommended"] is True
    d = rv.model_dump(); d["compare"] = {"portfolio_xirr": 1.0, "per_fund": {"122640": {"pct": 1.0, "inr": 1}}, "index_rows": [{"name": "Mirae Large Cap \u2021", "index": "Nifty 50", "period": "p", "ret": 1, "idx": 1, "lead": 0, "inr": 0}]}
    pdf = build_portfolio_review(d, live_d)
    assert pdf.startswith(b"%PDF")
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts


def test_comparison_slides_only_with_instalment_data(live):
    base = api.Review(client={"name": "A B Test", "date": "26 Oct 2026"}, holdings=H)
    cmp_ = {"portfolio_xirr": 10.42, "nifty50_xirr": 5.62, "nifty500_xirr": 8.31, "ahead_inr_500": 449011, "ahead_inr_50": 980886, "funds_ahead_50": 2,
            "per_fund": {"122640": {"pct": 3.0, "inr": 170029}, "150579": {"pct": -23.3, "inr": -233238}}}
    n = lambda rv: len(__import__("pypdf").PdfReader(__import__("io").BytesIO(api._pdf(rv))).pages)  # noqa: E731
    assert n(api.Review(**{**base.model_dump(), "compare": cmp_})) == n(base) + 3


def test_input_validation_rejects_bad_codes_and_negative_amounts():
    with pytest.raises(ValidationError):
        api.Holding(code="abc", invested=1, value=1)
    with pytest.raises(ValidationError):
        api.Holding(code="122640", invested=-1, value=1)
    with pytest.raises(ValidationError):
        api.Holding(code="122640", invested=1, value=1, flag="\u2021")  # glyph missing from Google Sans
    with pytest.raises(ValidationError):
        api.Review(client={"name": "x", "date": "d"}, holdings=[])


def test_parse_mf_transaction_report_scrapes_holdings_instalments_and_computes_compare(monkeypatch):
    idx_dates = pd.to_datetime(["2018-12-31", "2019-01-31", "2020-01-31", "2024-01-31", "2026-11-30"])
    idx_nav = pd.Series([100.0, 102.0, 115.0, 180.0, 240.0], index=idx_dates)
    monkeypatch.setattr(api, "_frame", lambda: FRAME)
    monkeypatch.setattr(api, "_nav", lambda c: idx_nav)
    txn_txt = "\n".join([
        "ProAffluence Associates Private Limited",
        "Report as on: 04-Nov-2026",
        "PPFAS Flexi Cap Fund - Regular Plan - Growth | INF879O01019      Avg NAV: 50.00 | Curt NAV: 80.00 | NAV as on 04-11-2026",
        "      Amt inv: ₹1,00,000.00 | Curt val: ₹1,85,000.00",
        "   ADITYA PARCHURE(PAN:ABCDE1234F)|70414596465",
        "   Opening balance   01-01-2016   ₹0   0   0",
        " 1   SIP   10-01-2019   ₹50,000   40.00   1250.000   1250.000   2855",
        " 2   SIP   10-01-2020   ₹50,000   50.00   1000.000   2250.000   2490",
    ]).encode("utf-8")
    res = api.parse_review_files([("txn_report.txt", txn_txt)])
    assert res["client"] == {"name": "Aditya Parchure", "date": "2026-11-04"}
    assert len(res["holdings"]) == 1
    h = res["holdings"][0]
    assert h["code"] == "122640" and h["invested"] == 100000.0 and h["value"] == 185000.0
    assert h["from"] == "2019-01" and h["to"] == "2020-01" and h["inst"] == "2" and h["ret"] is not None
    cmp_ = res["compare"]
    assert cmp_ is not None and cmp_["portfolio_xirr"] == h["ret"]
    assert "122640" in cmp_["per_fund"] and cmp_["index_rows"]
    assert res["analysis"]["invested"] == 100000.0 and res["analysis"]["value"] == 185000.0
    assert res["analysis"]["signals"]["Hold"] == 1
    rv = api.Review(client={"name": res["client"]["name"], "date": "04 Nov 2026"}, holdings=res["holdings"], compare=cmp_)
    assert api._pdf(rv).startswith(b"%PDF")


def test_parse_mf_summary_and_spreadsheet_and_deduplicate_same_folio(monkeypatch):
    idx_dates = pd.to_datetime(["2018-12-31", "2024-06-30", "2026-10-31"])
    idx_nav = pd.Series([100.0, 180.0, 220.0], index=idx_dates)
    monkeypatch.setattr(api, "_frame", lambda: FRAME)
    monkeypatch.setattr(api, "_nav", lambda c: idx_nav)
    summary_txt = "\n".join([
        "Proaffluence Associates Private Limited",
        "Report as on: 26-Oct-2026",
        "Debabrata Mukherjee (ABCDE1234F)",
        "MF Summary Report - Sub Category wise",
        "PPFAS Flexi | 70414596465 | Debabrata Mukherjee",
        "104.3080",
        "23-10-2026",
        "10-06-2024 763.647 ₹ 84,011 ₹ 1,10,000 ₹ 25,989 30.93 0 12.15 868",
        "Grand total",
        "₹ 84,011 ₹ 1,10,000 ₹ 25,989 30.93 0 12.15",
    ]).encode("utf-8")
    csv_bytes = (
        "Scheme Code,Folio,Invested Amount,Current Value,First Month,Last Month,Instalments\n"
        "122640,70414596465,84011,110000,2024-06,2026-06,25\n"
        "150579,99887766,50000,45000,2026-05,2026-05,1\n"
    ).encode("utf-8")
    res = api.parse_review_files([("summary.txt", summary_txt), ("extra.csv", csv_bytes)])
    assert res["client"] == {"name": "Debabrata Mukherjee", "date": "2026-10-26"}
    by_code = {h["code"]: h for h in res["holdings"]}
    assert set(by_code) == {"122640", "150579"}
    # Folio 70414596465 appeared in both files: enriched with to/inst, never double-counted
    assert by_code["122640"]["invested"] == 84011.0 and by_code["122640"]["value"] == 110000.0
    assert by_code["122640"]["from"] == "2024-06" and by_code["122640"]["to"] == "2026-06" and by_code["122640"]["inst"] == "25"
    # Under-1-year holding flagged with dagger
    assert by_code["150579"]["flag"] == "†"
    assert res["compare"] is not None and set(res["compare"]["per_fund"]) == {"122640", "150579"}

