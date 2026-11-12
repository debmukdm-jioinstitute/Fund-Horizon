import io
import re
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
