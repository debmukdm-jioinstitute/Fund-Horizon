import io

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.engine import cas


def make_pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in lines:
        c.drawString(40, y, line)
        y -= 16
        if y < 60:
            c.showPage()
            y = 800
    c.save()
    return buf.getvalue()


LINES = [
    "Investor Name: Rahul Sharma",
    "Statement Period: 01-Apr-2025 to 30-Sep-2026",
    "Demat Account No: 12345678",
    "HDFC Mutual Fund",
    "Folio No: 1234567/89",
    "ZZ SAMPLE FLEXI CAP FUND - GROWTH",
    "INFZZZ000001 1,234.567 150.25 120,000.00 22.5% 185,500.00",
    "Sample Asset Management",
    "Folio Number: 998877",
    "ZZ SAMPLE LIQUID FUND",
    "INFZZZ000002 500.000 350.10 170,000.00 175,050.00",
    "ZZ SAMPLE THREE TOKEN FUND",
    "INFZZZ000003 10.000 20.50 205.00",
    "ZZ SAMPLE TWO TOKEN FUND",
    "INFZZZ000004 100.000 12.50",
    "ZZ WINDOW FUND",
    "INFZZZ000005",
    "Units: 40.000 NAV: 25.50 Market Value: 1,020.00",
    "INFZZZ000001 1,234.567 150.25 120,000.00 22.5% 185,500.00",  # duplicate ISIN is ignored
]


@pytest.fixture(scope="module")
def parsed():
    return cas.extract_cas_via_text_fallback(make_pdf(LINES), "")


def test_fallback_header_fields(parsed):
    assert parsed["investor_info"]["name"].startswith("Rahul Sharma")
    assert parsed["statement_period"]["from"] == "01-Apr-2025" and parsed["statement_period"]["to"] == "30-Sep-2026"
    assert parsed["file_type"] == "CAMS" and parsed["cas_type"] == "DETAILED"


def test_fallback_schemes_all_token_layouts(parsed):
    schemes = {s["isin"]: s for f in parsed["folios"] for s in f["schemes"]}
    assert set(schemes) == {f"INFZZZ00000{i}" for i in range(1, 6)}   # duplicate dropped
    s1 = schemes["INFZZZ000001"]
    assert s1["close"] == pytest.approx(1234.567) and s1["valuation"]["nav"] == pytest.approx(150.25)
    assert s1["invested_value"] == 120_000 and s1["return_pct"] == pytest.approx(0.225)
    assert s1["valuation"]["value"] == 185_500
    s2 = schemes["INFZZZ000002"]
    assert s2["invested_value"] == 170_000 and s2["valuation"]["value"] == 175_050
    s3 = schemes["INFZZZ000003"]
    assert s3["close"] == 10 and s3["valuation"]["value"] == 205
    s4 = schemes["INFZZZ000004"]
    assert s4["valuation"]["value"] == pytest.approx(1250.0)       # units x nav when value is absent
    s5 = schemes["INFZZZ000005"]
    assert s5["close"] == 40 and s5["valuation"]["value"] == 1020 and s5["valuation"]["nav"] == pytest.approx(25.5)


def test_fallback_scheme_name_comes_from_previous_line_and_is_title_cased(parsed):
    names = {s["isin"]: s["scheme"] for f in parsed["folios"] for s in f["schemes"]}
    assert names["INFZZZ000001"] == "Zz Sample Flexi Cap Fund - Growth"
    assert names["INFZZZ000002"] == "Zz Sample Liquid Fund"


def test_fallback_folio_and_amc(parsed):
    f = parsed["folios"][0]
    assert f["folio"] == "998877" and "Asset Management" in f["amc"]


def test_fallback_empty_pdf_has_no_folios():
    out = cas.extract_cas_via_text_fallback(make_pdf(["Nothing to see here", "No holdings"]), "")
    assert out["folios"] == []


def test_format_scheme_name():
    assert cas.format_scheme_name("") == ""
    assert cas.format_scheme_name("HDFC LARGE CAP FUND - IDCW") == "HDFC Large Cap Fund - IDCW"
    assert cas.format_scheme_name("SBI NIFTY-50 ETF") == "SBI Nifty-50 ETF"
    assert cas.format_scheme_name("Already Mixed Case") == "Already Mixed Case"


@pytest.mark.parametrize("name,expected", [
    ("Axis Bluechip Fund", "Large Cap Fund"), ("Kotak Large & Mid Cap", "Large & Mid Cap Fund"),
    ("SBI Midcap Fund", "Mid Cap Fund"), ("Nippon Small Cap", "Small Cap Fund"),
    ("Parag Parikh Flexicap", "Flexi Cap Fund"), ("Axis Focused 25", "Focused Fund"),
    ("Mirae ELSS Tax Saver", "ELSS"), ("Edelweiss Arbitrage", "Arbitrage Fund"),
    ("HDFC Balanced Advantage", "Balanced Advantage Fund"), ("ICICI Multi-Asset", "Multi Asset Allocation"),
    ("Franklin Liquid Fund", "Liquid Fund"), ("Axis Overnight", "Overnight Fund"),
    ("UTI Money Market", "Money Market Fund"), ("Baroda Corporate Bond", "Corporate Bond Fund"),
    ("Kotak Banking and PSU", "Banking and PSU Fund"), ("SBI Magnum Gilt", "Gilt Fund"),
    ("Nippon Gold Savings", "Gold ETF / Fund"), ("ABC Silver ETF", "Silver ETF / Fund"),
    ("Aggressive Hybrid Plan", "Aggressive Hybrid Fund"), ("Conservative Hybrid Plan", "Conservative Hybrid Fund"),
])
def test_infer_scheme_category(name, expected):
    assert cas.infer_scheme_category(name) == expected


def test_infer_scheme_category_defaults():
    assert cas.infer_scheme_category("Mystery Fund", "EQUITY") == "Equity Fund"
    assert cas.infer_scheme_category("Mystery Fund", "DEBT") == "Debt Fund"
    assert cas.infer_scheme_category("Mystery Fund", "HYBRID") == "Hybrid Fund"
    assert cas.infer_scheme_category("Mystery Fund") == "Other"


def test_parse_cas_pdf_bytes_wrong_password_and_garbage():
    with pytest.raises(Exception) as e:
        cas.parse_cas_pdf_bytes(b"not a pdf at all", "x")
    assert e.type.__name__.startswith("CAS")
