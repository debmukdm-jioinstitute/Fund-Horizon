from app.backoffice.holdings_amc import parse_sheet
from app.backoffice.mf_holdings import _sector_canon


def test_parse_sheet_leading_code_column_fractions_and_derivative_rows():
    rows = [
        ("AXISBCF", "Axis Business Cycles Fund"),
        ("Monthly Portfolio Statement as on September 30, 2026",),
        ("Name of the Instrument", "ISIN", "Industry", "Quantity", "Market Value", "% to Net Assets"),  # header lacks the code column
        ("Equity & Equity related",),
        ("LARS02", "Larsen & Toubro Limited", "INE018A01030", "Construction", 10, 5.0, 0.60),
        ("IBCL05", "ICICI Bank Limited", "INE090A01021", "Banks", 10, 5.0, 0.38),
        (None, "Triparty Repo", None, None, None, 1.0, 0.02),
        (None, "Sub Total", None, None, None, 1.0, 1.0),
        (None, "Nifty Future 27-10-2026", None, None, 1, 5000.0, 0.0),  # hedge table row without ISIN: ignored
    ]
    s = parse_sheet(rows)
    assert s["scheme_name"] == "Axis Business Cycles Fund" and s["as_of"] == "2026-09-30"
    assert [h["name"] for h in s["holdings"]] == ["Larsen & Toubro Limited", "ICICI Bank Limited", "Triparty Repo"]
    assert s["weight_sum"] == 100.0 and s["holdings"][0]["weight_pct"] == 60.0  # fractions scaled to percent
    assert s["holdings"][0]["sector"] == "Construction" and s["holdings"][2]["instrument_type"] == "cash"


def test_parse_sheet_name_after_isin_and_non_scheme_sheet():
    rows = [
        ("RLMF002", "Nippon India Vision Fund (An Open Ended Equity Scheme)", "Index"),
        ("Monthly Portfolio Statement as on September 30,2026",),
        ("ISIN", "Name of the Instrument", "Industry / Rating", "Quantity", "Market Value", "% to NAV"),
        ("IBCL05", "INE090A01021", "ICICI Bank Limited", "Banks", 1, 2.0, 99.0),
        (None, "INE001A07XXX", "Some NCD", "CRISIL AAA", 1, 2.0, 1.0),
    ]
    s = parse_sheet(rows)
    assert s["scheme_name"] == "Nippon India Vision Fund"
    assert s["holdings"][0]["name"] == "ICICI Bank Limited" and s["holdings"][1]["sector"] is None  # rating is not a sector
    assert parse_sheet([("Index",), ("Fund", "Link")]) is None


def test_sector_canon_merges_spellings_and_truncations_only():
    c = _sector_canon({"Aerospace & Defense", "Aerospace and Defense", "Agricultural, Commercial and Constr",
                       "Agricultural, Commercial and Construction Vehicles", "Banks", "Bank"})
    assert c["Aerospace & Defense"] == c["Aerospace and Defense"] == "Aerospace and Defense"
    assert c["Agricultural, Commercial and Constr"] == "Agricultural, Commercial and Construction Vehicles"
    assert c["Banks"] == "Banks" and c["Bank"] == "Bank"
