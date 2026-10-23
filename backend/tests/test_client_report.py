from pathlib import Path

from app.report.client_report import build_client_report, ind, parse_files, summarize

ROWS = ("Bandhan Nifty 50 Index Fund-  2696308/03   3,52,103.35   3,52,103.35   0.00   0.00   16,250.46   49.07   7,97,440.90   1.94%   126.48%   14.31%\n"
        "  Reg(G)\n")


def test_ind_grouping():
    assert ind(32364866.08) == "3,23,64,866.08" and ind(-2.14) == "-2.14" and ind(999.5, 0) == "1,000"


def test_statement_text_parses_and_pdf_builds(monkeypatch):
    text = "Portfolio Valuation Report - Folio Wise   Fund Horizon\nA B Test   ARN: 345439  |  Phone: 9920406408\n23 Oct 2026\n1   " + ROWS + \
        "Grand Total   3,52,103.35   3,52,103.35   0.00   0.00   7,97,440.90   100.00%   126.48%   14.31%\n"
    monkeypatch.setattr("app.report.client_report.extract_text", lambda n, b: text)
    d = parse_files([("s.pdf", b"")])
    r = d["rows"][0]
    assert (r["name"], r["folio"], r["value"], d["xirr"], d["client"]["name"]) == ("Bandhan Nifty 50 Index Fund- Reg(G)", "2696308/03", 797440.9, 14.31, "A B Test")
    assert summarize(d)["gain"] == 797440.9 - 352103.35
    assert build_client_report(d).startswith(b"%PDF")


def test_sample_pdf_if_present():
    f = Path("/Users/debabrata/Downloads/portfolio-valuation_1078116_FOLIO_WISE_20261023.pdf")
    if f.exists():
        assert len(parse_files([(f.name, f.read_bytes())])["rows"]) == 22
