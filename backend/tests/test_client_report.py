import io
import re
from datetime import date
from pathlib import Path

import pandas as pd

from app.api import portfolio_review as pr_api
from app.report.client_report import build_client_report, enrich_and_compute_matrices, ind, parse_files, summarize

ROWS = ("Bandhan Nifty 50 Index Fund-  2696308/03   3,52,103.35   3,52,103.35   0.00   0.00   16,250.46   49.07   7,97,440.90   1.94%   126.48%   14.31%\n"
        "  Reg(G)\n")

FRAME = pd.DataFrame([
    {"code": "122640", "name": "PPFAS Flexi Cap Fund - Regular Plan - Growth", "plan": "Regular", "cat": "flexi_cap", "cat_label": "Flexi Cap",
     "nav_date": "04-Nov-2026", "cagr_3y": 18.2, "cap_up_3y": 105.0, "cap_down_3y": 68.0, "cap_ratio_3y": 1.54,
     "max_dd_3y": -11.2, "max_dd_all": -31.3, "history_years": 13.4, "fh_score": 82.5, "fh_signal": "Buy",
     "fh_signal_reasons": ["Strong risk-adjusted return"], "is_fh_recommended": True, "quality": "ok"},
    {"code": "108466", "name": "Bandhan Nifty 50 Index Fund - Regular Plan - Growth", "plan": "Regular", "cat": "large_cap", "cat_label": "Large Cap",
     "nav_date": "04-Nov-2026", "cagr_3y": 14.3, "cap_up_3y": 99.0, "cap_down_3y": 100.0, "cap_ratio_3y": 0.99,
     "max_dd_3y": -13.5, "max_dd_all": -38.1, "history_years": 15.0, "fh_score": 68.0, "fh_signal": "Hold",
     "fh_signal_reasons": ["Tracks Nifty 50"], "is_fh_recommended": False, "quality": "ok"},
])


def _mock_fh(monkeypatch):
    idx_dates = pd.to_datetime(["2018-12-31", "2019-01-31", "2020-01-31", "2024-06-30", "2026-10-31", "2026-11-30"])
    idx_nav = pd.Series([100.0, 102.0, 115.0, 180.0, 230.0, 240.0], index=idx_dates)
    pr_api._LOOKUPS_CACHE = None
    monkeypatch.setattr(pr_api, "_frame", lambda: FRAME)
    monkeypatch.setattr(pr_api, "_nav", lambda c: idx_nav)


def test_ind_grouping():
    assert ind(32364866.08) == "3,23,64,866.08" and ind(-2.14) == "-2.14" and ind(999.5, 0) == "1,000"


def test_statement_text_parses_and_pdf_builds_with_matrices_and_google_sans(monkeypatch):
    _mock_fh(monkeypatch)
    text = "Portfolio Valuation Report - Folio Wise   Fund Horizon\nA B Test   ARN: 345439  |  Phone: 9920406408\n23 Oct 2026\n1   " + ROWS + \
        "Grand Total   3,52,103.35   3,52,103.35   0.00   0.00   7,97,440.90   100.00%   126.48%   14.31%\n"
    monkeypatch.setattr("app.report.client_report.extract_text", lambda n, b: text)
    d = parse_files([("s.pdf", b"")])
    r = d["rows"][0]
    assert (r["name"], r["folio"], r["value"], d["xirr"], d["client"]["name"]) == ("Bandhan Nifty 50 Index Fund- Reg(G)", "2696308/03", 797440.9, 14.31, "A B Test")
    assert r["period"] and d["client"]["timeframe"]
    assert d["matrices"]["asset_allocation"] and d["matrices"]["category_allocation"]
    assert d["matrices"]["compare"] and d["matrices"]["risk_matrix"]
    assert summarize(d)["gain"] == 797440.9 - 352103.35
    pdf = build_client_report(d)
    assert pdf.startswith(b"%PDF")
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts


def test_universal_client_report_parses_mf_txn_spreadsheet_pms_and_direct_equity(monkeypatch):
    from pypdf import PdfReader

    _mock_fh(monkeypatch)
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

    csv_bytes = (
        "Scheme Code,Folio,Invested Amount,Current Value,First Month,Last Month,Instalments\n"
        "108466,2696308/03,200000,310000,2022-01,2026-10,58\n"
    ).encode("utf-8")

    pms_txt = "\n".join([
        "Stallion Asset Private Limited",
        "As of 31/10/2026",
        "Account: 100381 - ADITYA PARCHURE",
        "Strategy: Stallion Core Fund",
        "Inception Date: 15/04/2021",
        "Contribution 25,00,000",
        "Withdrawals 0",
        "Profit/Loss 12,50,000",
        "Portfolio Value(31/10/2026) 37,50,000",
        "Performance",
        "1M 3M 1Y Since Inception",
        "Portfolio 2.1% 6.4% 24.5% 21.8%",
    ]).encode("utf-8")

    d = parse_files([("txn.txt", txn_txt), ("extra.csv", csv_bytes), ("stallion_pms.txt", pms_txt)])
    assert d["client"]["name"] == "Aditya Parchure"
    assert d["client"]["date"] == "04 Nov 2026"
    assert d["client"]["inception"] == "10 Jan 2019"
    assert "10 Jan 2019 to 04 Nov 2026" in d["client"]["timeframe"]
    assert d["xirr"] is not None and d["xirr"] > 10.0
    assert len(d["rows"]) == 3
    classes = {r["asset_class"] for r in d["rows"]}
    assert classes == {"Mutual Fund", "PMS"}
    assert len(d["matrices"]["asset_allocation"]) == 2
    assert d["matrices"]["compare"] is not None
    assert len(d["matrices"]["compare"]["matrix_rows"]) == 2
    assert len(d["factsheets"]) == 1

    pdf = build_client_report(d)
    txt = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)
    for expected in (
        "Portfolio Valuation Report - Consolidated & Folio Wise",
        "Aditya Parchure",
        "1. Consolidated Portfolio Valuation",
        "2. Asset Allocation & Category Matrix",
        "3. Benchmark & 4-Index Nifty Comparison Matrix",
        "4. Fund Horizon Quality, Risk, Capture Ratios & Drawdown Matrix",
        "5. Stress Test Matrix & Portfolio Observations",
        "Stallion Core Fund",
    ):
        assert expected in txt
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts


def test_edit_and_recompute_matrices(monkeypatch):
    _mock_fh(monkeypatch)
    d = {
        "client": {"name": "Rohan Sharma", "date": "12 Nov 2026", "arn": "345439", "phone": "9876543210"},
        "xirr": None,
        "rows": [{
            "name": "PPFAS Flexi Cap Fund", "folio": "12345/01", "invested": 100000.0, "investments": 100000.0,
            "div_reinv": 0.0, "div_payout": 0.0, "units": 1000.0, "nav": 165.0, "value": 165000.0,
            "ann_ret": 0.0, "weight": 100.0, "abs_ret": 65.0, "from_date": "2023-05-10",
        }],
        "factsheets": [],
    }
    summarize(d)
    enrich_and_compute_matrices(d)
    assert d["xirr"] is not None and d["xirr"] > 14.0
    assert d["rows"][0]["ann_ret"] > 14.0
    assert "May-23" in d["rows"][0]["period"]


def test_sample_pdf_if_present(monkeypatch):
    _mock_fh(monkeypatch)
    f = Path("/Users/debabrata/Downloads/portfolio-valuation_1078116_FOLIO_WISE_20261023.pdf")
    if f.exists():
        assert len(parse_files([(f.name, f.read_bytes())])["rows"]) == 22


def test_stress_many_files_rows_flows_and_attachments(monkeypatch):
    """20 mixed statements, 150 holdings with 5 years of monthly flows: parses, attaches every copy, stays Google Sans only."""
    import time

    from pypdf import PdfReader
    from reportlab.pdfgen import canvas

    _mock_fh(monkeypatch)
    files = []
    for i in range(18):
        csv = "Scheme Code,Folio,Invested Amount,Current Value,First Month,Last Month,Instalments\n" + "".join(
            f"{c},{i}{n}/0{n},{100000 + n * 1000},{150000 + n * 1700},2021-0{1 + n % 9},2026-10,{40 + n}\n" for n, c in enumerate(("108466", "122640") * 4))
        files.append((f"stmt{i}.csv", csv.encode()))
    buf = io.BytesIO(); c = canvas.Canvas(buf); c.drawString(72, 700, "Portfolio Valuation Report"); c.showPage(); c.showPage(); c.save()
    files += [("scan.pdf", buf.getvalue()), ("odd.png", b"not-an-image")]  # unreadable image must not break the build
    t0 = time.time()
    d = parse_files(files)
    assert len(d["rows"]) >= 100 and len(d["source_files"]) >= 18
    d["rows"] = d["rows"][:150]
    for r in d["rows"]:  # 5 years of monthly SIPs per holding
        r["flows"] = [[f"{2021 + m // 12}-{m % 12 + 1:02d}-10", 5000.0] for m in range(60)]
    summarize(d); enrich_and_compute_matrices(d)
    assert len(d["matrices"]["monthly_trend"]) <= 18 and d["matrices"]["charts"]
    pdf = build_client_report(d)
    pages = PdfReader(io.BytesIO(pdf)).pages
    txt = "\n".join(p.extract_text() or "" for p in pages)
    assert "Annexure S1" in txt and "Category-Wise Flows" in txt and len(pages) > 20
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts
    d["attach_statements"] = False
    assert "Annexure S1" not in "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(build_client_report(d))).pages)
    assert time.time() - t0 < 120


def _nav_series(start="2018-01-31", end="2026-11-30"):
    idx = pd.date_range(start, end, freq="ME")
    return pd.Series([100 + 1.5 * i for i in range(len(idx))], index=idx), idx


def test_fy_summary_from_transaction_wise_statement_is_exact(monkeypatch):
    """Lots come from the running 'Balance Units'; FY value = units x month-end NAV at 31 Mar; XIRR checked against closed form."""
    _mock_fh(monkeypatch)
    nav, idx = _nav_series("2024-01-31")
    monkeypatch.setattr(pr_api, "_nav", lambda c: nav)
    text = "\n".join([
        "Portfolio Valuation Report - Transaction Wise", "Nithya Karthik", "11 Nov 2026", "Fund Horizon",
        "ARN: 345439  |  Phone: 9920406408", "AMFI Registered Mutual Fund Distributor",
        "INVESTED AMOUNT ₹1,50,000.00 CURRENT VALUE ₹2,68,600.00 UNREALISED GAIN / (LOSS) ₹1 ABSOLUTE RETURN 1.30% ANNUALISED RETURN (XIRR) 8.62%",
        "PPFAS Flexi Cap Fund-Reg(G) Unrealised Gain / (Loss): ₹1  |  Absolute Return: 15.77%  |  Annualised Return (XIRR): 6.19%",
        "1 F1 1,00,000.00 10-06-2024 0.00 100.00 1000.000 889 170.00 1,70,000.00 15.77% 6.19%",
        "2 F1 50,000.00 10-04-2025 0.00 125.00 1400.000 500 170.00 2,38,000.00 15.77% 6.19%",
        "3 F1 25,000.00 10-05-2026 0.00 138.89 1580.000 100 170.00 2,68,600.00 15.77% 6.19%",
        "Sub Total 1,75,000.00 1,580.00 2,68,600.00 53.49% 8.62%",
    ])
    monkeypatch.setattr("app.report.client_report.extract_text", lambda n, b: text)
    d = parse_files([("tx.pdf", b"")])
    fy = d["matrices"]["fy"]
    assert [y["fy"] for y in fy["years"]] == ["FY 2024-25", "FY 2025-26", "FY 2026-27"]
    assert [y["value"] for y in fy["years"]] == [121000, 194600, 268600]  # 1000 x 121, 1400 x 139, closing = statement value
    assert [y["new"] for y in fy["years"]] == [100000, 50000, 25000] and fy["net_new"] == 175000
    exp = ((121000 / 100000) ** (365 / (date(2025, 3, 31) - date(2024, 6, 10)).days) - 1) * 100
    assert abs(fy["years"][0]["xirr"]["MF"] - exp) < 0.02 and fy["years"][0]["xirr"]["PMS"] is None
    assert fy["years"][2]["alloc"] == {"DEBT": 0.0, "EQUITY": 100.0, "OTHER": 0.0} and fy["exact"] is True
    from pypdf import PdfReader
    txt = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(build_client_report(d))).pages)
    for s in ("Group Head Name", "Family Member Name", "SUMMARY :", "Value As on 31/03", "Net Investment:", "XIRR :", "Asset Allocation Movement :", "FY 2025-26", "194600", "10-06-2024"):
        assert s in txt, s


def test_fy_summary_never_estimates_holdings_without_history():
    from app.report.fy_matrix import fy_matrix

    nav, _ = _nav_series()
    mf = {"asset_class": "Mutual Fund", "category": "Liquid Fund", "code": "1", "value": 120.0, "invested": 100.0, "units": 1.0,
          "flows": [["2023-06-10", 100.0], ["2024-05-10", -20.0]]}
    pms = {"asset_class": "PMS", "category": "PMS Strategy", "value": 500.0, "invested": 400.0, "from_date": "2022-04-05", "flows": []}
    fy = fy_matrix({"client": {"date": "11 Nov 2026"}, "xirr": 9.0, "rows": [mf, pms]}, lambda c: nav)
    assert fy["inception"] == "2022-04-05" and fy["years"][0]["fy"] == "FY 2022-23"
    assert all(y["xirr"]["PMS"] is None and y["xirr"]["STOCK"] is None for y in fy["years"])
    assert all(y["new"] is None and y["xirr"]["PORTFOLIO"] is None for y in fy["years"][:-1])  # PMS has no dated flows
    assert fy["years"][0]["value"] is None and fy["years"][-1]["value"] == 620  # last FY = statement values, earlier FYs not guessed
    assert fy["years"][-1]["alloc"] is not None and fy["years"][1]["alloc"] is None
    assert fy["years"][2]["xirr"]["MF"] is not None  # MF-only column still computed; redemption counted as a negative new investment
    assert fy["years"][2]["xirr"]["MF"] == fy["years"][2]["xirr"]["MF"]


def test_fy_summary_stress_many_years_rows_and_pdf_layout(monkeypatch):
    from pypdf import PdfReader

    _mock_fh(monkeypatch)
    nav, _ = _nav_series("2010-01-31")
    monkeypatch.setattr(pr_api, "_nav", lambda c: nav)
    rows = []
    for i in range(150):
        fl = [[f"{2012 + m // 12}-{m % 12 + 1:02d}-10", 5000.0 + i] for m in range(0, 170, 3)]
        units = [[d, a / 100] for d, a in fl]
        rows.append({"name": f"Fund {i} Flexi Cap", "folio": str(i), "asset_class": "Mutual Fund", "category": "Debt" if i % 5 == 0 else "Flexi Cap", "code": "122640",
                     "invested": sum(a for _, a in fl), "investments": 0, "div_reinv": 0, "div_payout": 0, "units": sum(u for _, u in units), "nav": 170.0, "value": sum(u for _, u in units) * 200,
                     "weight": 0, "abs_ret": 0, "ann_ret": 0, "flows": fl, "lots": units})
    d = {"client": {"name": "Stress Client", "date": "11 Nov 2026", "arn": "345439", "phone": "9"}, "xirr": 12.3, "rows": rows, "factsheets": []}
    enrich_and_compute_matrices(d)
    fy = d["matrices"]["fy"]
    assert len(fy["years"]) == 16 and all(y["value"] is not None and y["alloc"] for y in fy["years"])
    assert all(abs(sum(y["alloc"].values()) - 100) < 0.05 for y in fy["years"])
    assert fy["years"][-1]["value"] == round(sum(r["value"] for r in rows))
    pdf = build_client_report(d)
    pages = PdfReader(io.BytesIO(pdf)).pages
    assert "FY 2011-12" in "\n".join(p.extract_text() or "" for p in pages)
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts


DASH = """Group Head Name : Shivanand Narsing Gulvady
Family Member Name : All
Category : All
Inception Date : 01-04-2018
From Period : 01-04-2018
To Period : 31-10-2026
SUMMARY :
Financial Year Value As on 31/03 New Investments XIRR
Since Inception 14.13
FY 2017-18 42855418 - -
FY 2018-19 30808399 -13562648 3.94
FY 2019-20 78088669 58415267 -24.22
Net Investment: 44852619
XIRR :
FINANCIAL YEAR Portfolio MF PMS STOCK
Since Inception 14.13 13.24 15.03 17.77
FY 2018-19 3.94 5.65 0.00 -100.00
FY 2019-20 -24.22 -23.82 0.00 -27.72
Asset Allocation Movement :
FINANCIAL YEAR DEBT EQUITY
FY 2018-19 36.33% 63.67%
FY 2019-20 54.87% 45.13%
"""


def test_provider_dashboard_is_parsed_exactly_flat_or_lined():
    from app.backoffice.valuation.layouts import dashboard

    a, b = dashboard([DASH]), dashboard([DASH.replace("\n", " ")])
    assert a["table"] == b["table"] and a["header"]["group_head"] == "Shivanand Narsing Gulvady"
    t = a["table"]
    assert t["2017-18"] == {"value": 42855418, "new": None, "xirr": None}
    assert t["2018-19"]["new"] == -13562648 and t["2019-20"]["by_class"] == {"portfolio": -24.22, "mf": -23.82, "pms": 0.0, "stock": -27.72}
    assert t["2019-20"]["alloc"] == {"debt": 54.87, "equity": 45.13} and a["since"] == {"portfolio": 14.13, "mf": 13.24, "pms": 15.03, "stock": 17.77}
    assert a["net_investment"] == 44852619


def test_dashboard_upload_fills_pms_and_stock_history_and_never_overrides_computed(monkeypatch):
    from pypdf import PdfReader

    _mock_fh(monkeypatch)
    nav, _ = _nav_series("2018-01-31")
    monkeypatch.setattr(pr_api, "_nav", lambda c: nav)
    only = parse_files([("fy.txt", DASH.encode())])
    assert only["rows"] == [] and only["dashboard"]["table"] and only["matrices"]["fy"]["years"][0]["fy"] == "FY 2017-18"
    assert only["client"]["name"] == "Shivanand Narsing Gulvady" and only["file_results"][0]["kind"] == "fy_dashboard"

    mf = {"name": "PPFAS Flexi Cap", "folio": "1", "asset_class": "Mutual Fund", "category": "Flexi Cap", "code": "122640", "invested": 100000, "investments": 0, "div_reinv": 0, "div_payout": 0,
          "units": 1000.0, "nav": 200.0, "value": 200000.0, "weight": 0, "abs_ret": 0, "ann_ret": 0, "flows": [["2018-06-10", 100000.0]], "lots": [["2018-06-10", 1000.0]]}
    d = {"client": {"name": "S", "date": "31 Oct 2026", "arn": "1", "phone": "9"}, "xirr": 14.13, "rows": [mf], "factsheets": [], "dashboard": only["dashboard"]}
    enrich_and_compute_matrices(d)
    fy = d["matrices"]["fy"]
    y = {x["fy"]: x for x in fy["years"]}
    assert "FY 2017-18" in y and y["FY 2017-18"]["value"] == 42855418 and "value" in y["FY 2017-18"]["rep"]  # provider-only year kept
    assert y["FY 2019-20"]["xirr"]["PMS"] is None and y["FY 2019-20"]["xirr"]["STOCK"] == -27.72 and "xirr.STOCK" in y["FY 2019-20"]["rep"]  # PMS 0.00 = not held
    assert y["FY 2018-19"]["xirr"]["MF"] is not None and "xirr.MF" not in y["FY 2018-19"]["rep"]  # computed MF wins over the provider's
    assert y["FY 2019-20"]["alloc"] == {"DEBT": 54.87, "EQUITY": 45.13, "OTHER": 0.0} or y["FY 2019-20"]["alloc"]["DEBT"] == 0.0
    assert fy["since"]["PMS"] == 15.03 and fy["since"]["STOCK"] == 17.77 and "PMS" in fy["since_rep"] and fy["reported"]
    txt = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(build_client_report(d))).pages)
    assert "†" in txt and "provider FY dashboard" in txt and "42855418" in txt


def test_pms_and_stock_rows_with_dated_history_are_computed_not_reported():
    from app.report.fy_matrix import fy_matrix

    nav, _ = _nav_series()
    pms = {"asset_class": "PMS", "category": "PMS Strategy", "value": 1500.0, "invested": 1000.0, "from_date": "2023-04-10",
           "flows": [["2023-04-10", 1000.0], ["2030-01-01", 500.0]], "fy_values": {"2024-03-31": 1100.0, "2025-03-31": 1300.0}}
    stock = {"asset_class": "Direct Equity", "category": "Direct Equity", "value": 700.0, "invested": 500.0, "flows": [["2024-05-01", 500.0]], "fy_values": {"2025-03-31": 600.0}}
    fy = fy_matrix({"client": {"date": "11 Nov 2026"}, "xirr": 11.0, "rows": [pms, stock]}, lambda c: nav)
    y = {x["fy"]: x for x in fy["years"]}
    assert [x["fy"] for x in fy["years"]][0] == "FY 2023-24" and y["FY 2023-24"]["value"] == 1100 and y["FY 2024-25"]["value"] == 1900
    assert abs(y["FY 2023-24"]["xirr"]["PMS"] - ((1100 / 1000) ** (365 / (date(2024, 3, 31) - date(2023, 4, 10)).days) - 1) * 100) < 0.02
    assert y["FY 2025-26"]["value"] is None and y["FY 2025-26"]["new"] == 0  # no 31 Mar 2026 value supplied: never guessed; the 2030 flow is ignored
    assert y["FY 2026-27"]["value"] == 2200 and y["FY 2024-25"]["xirr"]["STOCK"] is not None and not any(x["rep"] for x in fy["years"])


def test_statement_store_survives_restart_prunes_old_and_keeps_no_password(monkeypatch, tmp_path):
    import io
    import time

    from pypdf import PdfReader, PdfWriter

    from app.report import client_report as cr

    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    w = PdfWriter(); w.add_blank_page(100, 100); w.encrypt("hunter2"); buf = io.BytesIO(); w.write(buf)
    fid = cr.store_statement_blob("pw.pdf", buf.getvalue(), "hunter2")
    name, data, pw = cr.load_statement_blob(fid)  # a fresh call = what a restarted worker sees
    assert name == "pw.pdf" and pw == "" and not PdfReader(io.BytesIO(data)).is_encrypted and b"hunter2" not in data
    old = cr.store_statement_blob("old.csv", b"old")
    later = time.time() + 7 * 3600
    monkeypatch.setattr(cr.time, "time", lambda: later)
    assert cr.load_statement_blob(old) is None and cr.load_statement_blob("zz") is None
    cr.store_statement_blob("new.csv", b"new")  # storing prunes the expired rows
    import sqlite3
    assert sqlite3.connect(tmp_path / "t.db").execute("SELECT COUNT(*) FROM client_report_files").fetchone()[0] == 1



def test_dashboard_xlsx_and_30_year_stress_pdf(monkeypatch):
    from pypdf import PdfReader

    _mock_fh(monkeypatch)
    nav, _ = _nav_series("1996-01-31")
    monkeypatch.setattr(pr_api, "_nav", lambda c: nav)
    yrs = range(1996, 2026)  # 30 FYs
    summ = "\n".join(f"FY {y}-{(y + 1) % 100:02d} {1000000 + 37 * i} {50000 - i} {10 + i % 7}.{i % 100:02d}" for i, y in enumerate(yrs))
    xirr = "\n".join(f"FY {y}-{(y + 1) % 100:02d} {10 + i % 7}.00 {9 + i % 5}.50 {'0.00' if i < 8 else '12.25'} {'-' if i % 9 == 0 else '-3.10'}" for i, y in enumerate(yrs))
    alloc = "\n".join(f"FY {y}-{(y + 1) % 100:02d} {i % 40}.00% {100 - i % 40}.00%" for i, y in enumerate(yrs))
    dash = f"Group Head Name : Big Family\nFamily Member Name : All\nCategory : All\nSUMMARY :\nSince Inception 12.00\n{summ}\nNet Investment: 5\nXIRR :\nSince Inception 12.00 11.00 15.00 17.00\n{xirr}\nAsset Allocation Movement :\n{alloc}\n"
    d0 = parse_files([("fy.csv", dash.encode())])
    assert len(d0["dashboard"]["table"]) == 30 and d0["dashboard"]["table"]["2025-26"]["by_class"]["pms"] == 12.25
    mf = {"name": "PPFAS Flexi Cap", "folio": "1", "asset_class": "Mutual Fund", "category": "Flexi Cap", "code": "122640", "invested": 100000, "investments": 0, "div_reinv": 0, "div_payout": 0,
          "units": 1000.0, "nav": 200.0, "value": 200000.0, "weight": 0, "abs_ret": 0, "ann_ret": 0, "flows": [["2020-06-10", 100000.0]], "lots": [["2020-06-10", 1000.0]]}
    d = {"client": {"name": "Big Family", "date": "31 Oct 2026", "arn": "1", "phone": "9"}, "xirr": 12.0, "rows": [mf], "factsheets": [], "dashboard": d0["dashboard"]}
    enrich_and_compute_matrices(d)
    assert len(d["matrices"]["fy"]["years"]) == 31
    pdf = build_client_report(d)
    txt = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "FY 1996-97" in txt and "FY 2025-26" in txt and "FY 2026-27" in txt and "†" in txt
    fonts = {m.decode() for m in re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9_-]+)", pdf)}
    assert fonts and all(f.startswith("GoogleSans") for f in fonts), fonts


def test_api_report_model_round_trips_history_fields():
    from app.api.client_report import Report

    row = {"name": "X", "invested": 1, "value": 2, "lots": [["2020-01-01", 5.0]], "fy_values": {"2024-03-31": 3.0}}
    r = Report(client={"name": "A", "date": "1 Jan 2026"}, rows=[row], dashboard={"table": {"2024-25": {"value": 1}}}).model_dump()
    assert r["rows"][0]["lots"] == [["2020-01-01", 5.0]] and r["rows"][0]["fy_values"] == {"2024-03-31": 3.0} and r["dashboard"]["table"]


def test_sections_filter_drops_unticked_sections(monkeypatch):
    _mock_fh(monkeypatch)
    text = "Portfolio Valuation Report - Folio Wise   Fund Horizon\nA B Test   ARN: 345439  |  Phone: 9920406408\n23 Oct 2026\n1   " + ROWS + \
        "Grand Total   3,52,103.35   3,52,103.35   0.00   0.00   7,97,440.90   100.00%   126.48%   14.31%\n"
    monkeypatch.setattr("app.report.client_report.extract_text", lambda n, b: text)
    d = parse_files([("s.pdf", b"")])
    pages = lambda pdf: len(re.findall(rb"/Type\s*/Page\b", pdf))  # noqa: E731
    full, none, one = build_client_report(dict(d)), build_client_report({**d, "sections": []}), build_client_report({**d, "sections": ["holdings"]})
    assert all(p.startswith(b"%PDF") for p in (full, none, one))
    assert len(full) > len(one) > len(none) and pages(full) >= pages(one) >= pages(none) >= 1
    keys = ["kpi", "holdings", "alloc", "charts", "fy", "heatmap", "cashflow", "benchmark", "risk", "stress", "factsheets", "notes", "annex"]
    for k in keys:  # every section alone builds; two at once too (stress: rapid tick/untick)
        assert build_client_report({**d, "sections": [k]}).startswith(b"%PDF")
    assert build_client_report({**d, "sections": keys[::2]}).startswith(b"%PDF") and build_client_report({**d, "sections": ["bogus"]}).startswith(b"%PDF")


def test_no_forced_page_breaks_and_repeat_builds_are_fast(monkeypatch):
    import inspect
    import time

    import app.report.client_report as cr

    assert "PageBreak()" not in inspect.getsource(cr.build_client_report)  # content flows; no forced breaks
    _mock_fh(monkeypatch)
    text = "Portfolio Valuation Report - Folio Wise   Fund Horizon\nA B Test   ARN: 345439  |  Phone: 9920406408\n23 Oct 2026\n1   " + ROWS + \
        "Grand Total   3,52,103.35   3,52,103.35   0.00   0.00   7,97,440.90   100.00%   126.48%   14.31%\n"
    monkeypatch.setattr("app.report.client_report.extract_text", lambda n, b: text)
    d = parse_files([("s.pdf", b"")])
    build_client_report(dict(d))
    t = time.perf_counter()
    for _ in range(20):
        build_client_report(dict(d))
    assert (time.perf_counter() - t) / 20 < 0.5  # warm rebuild: well under half a second
