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
    {"code": "122640", "name": "PPFAS Flexi", "plan": "Regular", "cat": "flexi_cap", "cat_label": "Flexi Cap", "nav_date": "04-Nov-2026", "cagr_3y": 11.9, "cap_up_3y": 69.0, "cap_down_3y": 47.0, "cap_ratio_3y": 1.48,
     "max_dd_3y": -11.2, "max_dd_all": -31.3, "history_years": 13.4, "fh_score": 57.5, "fh_signal": "Hold", "fh_signal_reasons": ["in line with peers"], "is_fh_recommended": False},
    {"code": "150579", "name": "Edelweiss Gold and Silver ETF Fund of Fund - Regular Plan - Growth", "plan": "Regular", "cat": "gold", "cat_label": "Gold", "nav_date": "04-Nov-2026", "cagr_3y": 33.7, "cap_up_3y": None, "cap_down_3y": None, "cap_ratio_3y": None,
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


def test_branding_flag_removes_logo(live):
    rv = api.Review(client={"name": "A", "date": "01 Jan 2026"}, holdings=H)
    live_d, d = api.live_data([h.code for h in rv.holdings]), rv.model_dump()
    assert d["branding"] is True
    assert len(build_portfolio_review({**d, "branding": False}, live_d)) < len(build_portfolio_review(d, live_d))


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


def test_four_nifty_indices_matrix_benchmark_mapping_and_pagination(monkeypatch):
    import io
    from pypdf import PdfReader

    idx_dates = pd.to_datetime(["2020-01-31", "2024-01-31", "2026-10-31"])
    nav_by_code = {
        "120716": pd.Series([100.0, 140.0, 160.0], index=idx_dates),  # Nifty 50
        "147625": pd.Series([100.0, 150.0, 175.0], index=idx_dates),  # Nifty 500 TRI
        "147622": pd.Series([100.0, 160.0, 185.0], index=idx_dates),  # Nifty Midcap 150 TRI
        "147623": pd.Series([100.0, 170.0, 195.0], index=idx_dates),  # Nifty Smallcap 250 TRI
    }
    monkeypatch.setattr(api, "_frame", lambda: FRAME)
    monkeypatch.setattr(api, "_nav", lambda c: nav_by_code.get(c, nav_by_code["147625"]))

    holdings = [
        {"code": str(1000 + i), "name": f"Small Cap Alpha {i}", "typ": "Small Cap", "invested": 100000.0,
         "value": 135000.0 + i * 1000, "from": "2024-01", "to": "2026-10", "inst": "34", "ret": 18.5}
        for i in range(9)
    ]
    cmp_, analysis = api.build_analysis(holdings, "2026-10-26")
    assert cmp_ is not None
    assert cmp_["primary_bench_key"] == "small250" and cmp_["primary_bench_label"] == "Nifty Smallcap 250 TRI"
    assert "Official benchmark of Small Cap Alpha 0" in cmp_["benchmark_note"]
    assert len(cmp_["matrix_rows"]) == 9
    assert set(cmp_["index_totals"]) == {"n50", "n500", "mid150", "small250"}
    assert all(set(r["cells"]) == {"n50", "n500", "mid150", "small250"} for r in cmp_["matrix_rows"])

    rv = api.Review(client={"name": "Shravani Sudesh Dalvi", "date": "26 Oct 2026"}, holdings=holdings, compare=cmp_)
    pdf_bytes = api._pdf(rv)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    txt = "\n".join(p.extract_text() or "" for p in reader.pages)
    assert "Nifty indices" in txt and "SIPs worth today" in txt and "Fund Horizon" in txt
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf_bytes)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts


def test_transaction_wise_valuation_report_reconciles_100_percent(monkeypatch):
    import io
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from app.backoffice.valuation.providers import ADAPTERS
    from app.report import client_report as cr_mod

    idx_dates = pd.to_datetime(["2024-01-31", "2024-06-30", "2026-08-31", "2026-11-30"])
    idx_nav = pd.Series([100.0, 110.0, 140.0, 150.0], index=idx_dates)
    monkeypatch.setattr(api, "_frame", lambda: FRAME)
    monkeypatch.setattr(api, "_nav", lambda c: idx_nav)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    lines = [
        "Portfolio Valuation Report - Transaction Wise",
        "Nithya Karthik",
        "11 Nov 2026",
        "Fund Horizon",
        "ARN: 345439  |  Phone: 9920406408",
        "AMFI Registered Mutual Fund Distributor",
        "INVESTED AMOUNT ₹22,79,584.21 CURRENT VALUE ₹23,09,320.23 UNREALISED GAIN / (LOSS) ₹29,736.02 ABSOLUTE RETURN 1.30% ANNUALISED RETURN (XIRR) 8.62%",
        "S. No Folio Number Invested Amount (₹) Purchase NAV Date Dividend Reinvested (₹) Purchase NAV (₹) Balance Units Transaction Days Current NAV (₹) Current Value (₹) Absolute Return (%) Annualised Return (%)",
        "PPFAS Flexi Cap Fund-Reg(G) Unrealised Gain / (Loss): ₹44,076.88  |  Absolute Return: 15.77%  |  Annualised Return (XIRR): 6.19%",
        "1 910184329106 2,79,584.21 03-06-2024 0.00 87.11 3209.583 889 100.84 3,23,661.09 15.77% 6.19%",
        "Sub Total 2,79,584.21 3,209.58 3,23,661.09 15.77% 6.19%",
        "Edelweiss Gold & Silver ETF FoF-Reg(G) Unrealised Gain / (Loss): ₹-14,340.86  |  Absolute Return: -0.72%  |  Annualised Return (XIRR): -",
        "2 9764695/12 10,00,000.00 07-08-2026 0.00 19.10 52356.144 94 18.96 9,92,829.57 -0.72% -",
        "3 9764695/12 10,00,000.00 14-08-2026 0.00 19.10 104712.289 87 18.96 9,92,829.57 -0.72% -",
        "Sub Total 20,00,000.00 1,04,712.29 19,85,659.14 -0.72% -",
    ]
    y = 550
    for ln in lines:
        c.drawString(30, y, ln)
        y -= 16
    c.save()
    pdf_data = buf.getvalue()

    # 1. Portfolio Review extraction: 100% rupee & instalment accuracy
    res = api.parse_review_files([("tx_wise.pdf", pdf_data)])
    assert res["client"] == {"name": "Nithya Karthik", "date": "2026-11-11"}
    assert not res["warnings"]
    assert len(res["holdings"]) == 2
    assert res["analysis"]["invested"] == 2279584.21 and res["analysis"]["value"] == 2309320.23
    assert res["compare"]["portfolio_xirr"] == 8.62
    by_code = {h["code"]: h for h in res["holdings"]}
    assert by_code["122640"]["invested"] == 279584.21 and by_code["122640"]["value"] == 323661.09 and by_code["122640"]["ret"] == 6.19
    assert by_code["150579"]["invested"] == 2000000.00 and by_code["150579"]["value"] == 1985659.14 and by_code["150579"]["inst"] == "2"

    # 2. Valuation adapter extraction: 100% reconciliation
    st = ADAPTERS["fundsindia"].extract("tx_wise.pdf", pdf_data)
    assert not st.errors and st.flows_complete and len(st.holdings) == 2 and len(st.flows) == 3
    assert st.totals["total_invested"] == 2279584.21 and st.totals["total_value"] == 2309320.23

    # 3. Client Report extraction: 100% reconciliation
    cr = cr_mod.parse_files([("tx_wise.pdf", pdf_data)])
    assert cr["client"]["name"] == "Nithya Karthik" and cr["xirr"] == 8.62 and len(cr["rows"]) == 2
    assert round(sum(r["invested"] for r in cr["rows"]), 2) == 2279584.21
    assert round(sum(r["value"] for r in cr["rows"]), 2) == 2309320.23


def test_parallel_benchmark_dates_and_implied_date_derivation(monkeypatch):
    # Month-end NAV series: Dec 31 = 100, Jan 31 = 120, Jun 30 = 150, Oct 31 = 180
    idx_dates = pd.to_datetime(["2025-12-31", "2026-01-31", "2026-06-30", "2026-10-31"])
    idx_nav = pd.Series([100.0, 120.0, 150.0, 180.0], index=idx_dates)
    # Fund NAV series: Dec 31 = 50, Mar 31 = 60, Jun 30 = 75, Oct 31 = 90
    fund_nav = pd.Series([50.0, 60.0, 75.0, 90.0], index=pd.to_datetime(["2025-12-31", "2026-03-31", "2026-06-30", "2026-10-31"]))

    monkeypatch.setattr(api, "_frame", lambda: FRAME)
    monkeypatch.setattr(api, "_nav", lambda c: fund_nav if c == "122640" else idx_nav)

    # 1) Jan 1 investment must use start-of-January NAV (~100.65, near Dec 31 = 100), never Jan 31's month-end NAV (120)
    jan1_nav = api._nav_on(idx_nav, pd.Timestamp("2026-01-01").date())
    assert 100.0 <= jan1_nav < 101.0

    # 2) Two funds with different start dates (Jan-26 vs Jun-26) get distinct benchmark returns in the 4-index matrix
    holdings = [
        {"code": "122640", "name": "Fund Jan Start", "typ": "Flexi Cap", "invested": 100000.0, "value": 180000.0, "from": "2026-01", "to": "2026-01", "inst": "1", "ret": 80.0},
        {"code": "150579", "name": "Fund Jun Start", "typ": "Small Cap", "invested": 100000.0, "value": 125000.0, "from": "2026-06", "to": "2026-06", "inst": "1", "ret": 25.0},
    ]
    cmp_, _ = api.build_analysis(holdings, "2026-10-31")
    rows = {r["code"]: r for r in cmp_["matrix_rows"]}
    # Jan 1 -> Oct 31 index return (~78.8%) must be much higher than Jun 1 -> Oct 31 index return (~28.2%)
    assert rows["122640"]["cells"]["n50"]["idx"] > 70.0
    assert rows["150579"]["cells"]["n50"]["idx"] < 35.0
    assert rows["122640"]["period"] == "Jan-26 (one-time)" and rows["150579"]["period"] == "Jun-26 (one-time)"

    # 3) Folio-wise <1y holding (where XIRR == Abs Return, e.g. invested at NAV 60 on Mar 31 -> now NAV 90 on Oct 31, +50%)
    # derives its own start month (2026-03) from the scheme's NAV history instead of a generic 180-day fallback
    fw_holding = [{"code": "122640", "name": "PPFAS Flexi", "typ": "Flexi Cap", "invested": 100000.0, "value": 150000.0, "from": "", "to": "", "inst": "", "ret": 50.0}]
    cmp_fw, _ = api.build_analysis(fw_holding, "2026-10-31")
    assert fw_holding[0]["from"] == "2026-03" and cmp_fw["matrix_rows"][0]["period"] == "Since Mar-26"




