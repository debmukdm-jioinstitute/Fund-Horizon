from app.report.monthly_report import (
    build_monthly_report,
    parse_monthly_buckets,
    parse_monthly_files,
    summarize_monthly,
)

# Fixture text in the layout of the one-page monthly bucket report: same bucket
# names and amounts as the September example, with a generic client name and no
# contact details, so no real client's details live in the test suite.
MONTHLY_TEXT = """PORTFOLIO XIRR
A B Test
Value As On- 1-09-2026
Inception Date - 30 Apr 2020
Investments Invested amount Current value Gain/losses (%) Weightage (%)XIRR
Mutual funds
Debt Portfolio 41,12,800 60,61,476 19,48,676 9% 6.34%
Equity Portfolio 37,97,957 57,88,916 19,90,959 8% 12.99%
31st March 2023 1,34,99,325 1,70,98,796 35,99,471 24% 7.14%
1st April 2023 39,99,800 51,22,277 11,22,477 7% 7.52%
STP Portfolio 69,55,097 81,17,874 11,62,777 11% 7.92%
offline 1,19,43,751 2,88,44,397 1,69,00,646 41% 13.37%
Total 4,43,08,730 7,10,33,736 2,67,25,006 100.00% 7.49%
COMPLETE PORTFOLIO
Mutual funds 4,43,08,730 7,10,33,736 2,67,25,006 100% 7.49%
PMS 0 0 0 0 0
Total 4,43,08,730 7,10,33,736 2,67,25,006 100% 7.49%
"""

VALUATION_TEXT = """Portfolio Valuation Report - Folio Wise   Fund Horizon
A B Test   ARN: 345439  |  Phone: 1111111111
23 Oct 2026
1   Bandhan Nifty 50 Index Fund-  2696308/03   3,52,103.35   3,52,103.35   0.00   0.00   16,250.46   49.07   7,97,440.90   1.94%   126.48%   14.31%
  Reg(G)
Grand Total   3,52,103.35   3,52,103.35   0.00   0.00   7,97,440.90   100.00%   126.48%   14.31%
"""


def _report():
    d = parse_monthly_buckets(MONTHLY_TEXT)
    assert d is not None
    return {
        "client": d["client"], "month": "september 2026", "inception": d["inception"],
        "total_xirr": d["total_xirr"], "buckets": d["buckets"], "pms": d["pms"], "factsheets": [],
    }


def test_monthly_bucket_text_parses_to_six_rows_and_exact_totals():
    d = parse_monthly_buckets(MONTHLY_TEXT)
    assert d is not None
    assert [b["name"] for b in d["buckets"]] == [
        "Debt Portfolio", "Equity Portfolio", "31st March 2023",
        "1st April 2023", "STP Portfolio", "offline",
    ]
    assert d["totals"] == {"invested": 44308730.0, "current": 71033736.0, "gain": 26725006.0}
    assert d["total_xirr"] == 7.49
    assert d["pms"] == {"invested": 0.0, "current": 0.0, "xirr": 0.0}
    assert d["inception"] == "30 Apr 2020"
    assert d["client"]["name"] == "A B Test" and d["client"]["date"] == "1-09-2026"


def test_total_xirr_is_never_an_average_of_bucket_xirrs():
    r = _report()
    t = summarize_monthly(r)
    weighted = sum(b["current"] * b["xirr"] for b in r["buckets"]) / t["current"]
    assert abs(weighted - 10.19) < 0.02
    assert r["total_xirr"] == 7.49
    assert t["gain"] == 26725006.0


def test_gain_and_weight_recompute_when_a_value_is_edited():
    r = _report()
    r["buckets"][0]["current"] = 7061476.0  # Debt current +10,00,000
    t = summarize_monthly(r)
    assert r["buckets"][0]["gain"] == 7061476.0 - 4112800.0
    assert abs(sum(b["weight"] for b in r["buckets"]) - 100.0) < 0.01
    assert t["current"] == 71033736.0 + 1000000.0
    assert t["complete"]["current"] == t["current"]  # PMS is zero here


def test_pms_zero_report_builds_and_pdf_starts_with_magic():
    pdf = build_monthly_report(_report())
    assert pdf.startswith(b"%PDF")
    r = _report()
    r["pms"] = {"invested": 5000000.0, "current": 6200000.0, "xirr": 8.5}
    pdf = build_monthly_report(r)
    assert pdf.startswith(b"%PDF")
    t = summarize_monthly(r)
    assert t["complete"]["current"] == 71033736.0 + 6200000.0


def test_parse_monthly_files_keeps_valuation_as_cross_check_only(monkeypatch):
    def fake_extract(name, _data):
        return MONTHLY_TEXT if name == "m.pdf" else VALUATION_TEXT

    monkeypatch.setattr("app.report.monthly_report.extract_text", fake_extract)
    d = parse_monthly_files([("m.pdf", b""), ("v.pdf", b"")])
    assert len(d["buckets"]) == 6
    assert d["warnings"] == []
    assert d["valuation"] is not None
    assert d["valuation"]["invested"] == 352103.35
    assert d["valuation"]["value"] == 797440.90
    assert d["valuation"]["rows"] == 1


def test_non_monthly_text_returns_none():
    assert parse_monthly_buckets("hello world\nno tables here\n") is None
