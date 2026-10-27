from app.report.monthly_report import parse_monthly_files
from app.report.statements import parse_fundsindia, parse_proaffluence

PRO = """
   Proaffluence Associates Private Limited
   Email ID: firm@example.com
   Mobile no.: 9999999999
   Report as on: 26-Oct-2026
Jane Q Sample (ABCDE1234F)
Mobile no.: 9811111111
Email ID: Jane.Sample@example.com   MF Summary Report - Sub Category wise
   Equity - Large Cap Fund
   ₹ 84,011   ₹ 79,654   ₹ -4,357   -5.19   0   -4.53
 Grand total
   ₹ 6,36,011   ₹ 10,60,832   ₹ 4,24,821   66.79   0   14.26
"""


def test_proaffluence_reads_client_not_distributor_and_grand_total():
    s = parse_proaffluence(PRO)
    assert s["client"] == {"name": "Jane Q Sample", "pan": "ABCDE1234F", "mobile": "9811111111", "email": "jane.sample@example.com"}
    assert s["as_on"] == "26-10-2026"
    assert s["grand_total"]["invested"] == 636011 and s["grand_total"]["current"] == 1060832 and s["grand_total"]["xirr"] == 14.26


def _row(y, name, inv, cur, gain, ann, extra=()):
    return [(265, y, name), (390, y + 8, inv), (466, y + 8, cur), (560, y, gain), (692, y + 8, ann), *extra]


def test_fundsindia_sections_total_and_ocr_repair():
    hdr = lambda y: [(400, y + 30, "Invested"), (480, y + 30, "Current"), (628, y + 20, "Prev. Day"), (678, y + 30, "Ann. Ret.")]
    page = [(258, 100, "Jane Sample Portfolio - 3 to 5 years   3"), *hdr(100)]
    page += _row(170, "Alpha Fund", "1,00,000", "1,10,000", "10,000", "10.5%")
    # Invested box read backwards by OCR: rebuilt from current - gain.
    page += _row(220, "Beta Fund", "①000'05", "1,50,000", "50,000", "-2%")
    page += _row(270, "Total", "1,50,000", "2,60,000", "1,10,000", "6.1%")
    s = parse_fundsindia([page])
    cat = s["categories"][0]
    assert s["client"]["name"] == "Jane Sample" and cat["name"] == "Jane Sample Portfolio - 3 to 5 years"
    assert [(f["invested"], f["current"], f["ann_ret"]) for f in cat["funds"]] == [(100000, 110000, 10.5), (100000, 150000, -2.0)]
    assert cat["funds"][1]["check"] == "derived"
    assert (cat["invested"], cat["current"], cat["ann_ret"]) == (150000, 260000, 6.1)
    assert any("add up to" in w for w in s["warnings"])  # 2,00,000 read vs 1,50,000 total


def test_provider_statement_feeds_buckets_and_contact(monkeypatch):
    monkeypatch.setattr("app.report.monthly_report.extract_text", lambda n, d: PRO)
    out = parse_monthly_files([("pro.pdf", b"")])
    assert out["contact"]["email"] == "jane.sample@example.com" and out["client"]["name"] == "Jane Q Sample"
    assert out["buckets"] == [{"name": "Proaffluence mutual funds", "invested": 636011.0, "current": 1060832.0, "xirr": 14.26}]
    assert out["total_xirr"] == 14.26 and out["file_results"][0]["kind"] == "statement"
