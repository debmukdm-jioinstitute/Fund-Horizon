from app.backoffice.holdings_amc import _page_links, parse_sheet, parse_sheet_all
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


def test_parse_sheet_all_splits_uti_stacked_sheet_and_reads_name_column():
    # UTI publishes ONE sheet whose schemes follow one another, each starting with a "SCHEME: <name>" marker,
    # and whose header puts ISIN far right of the weight (empty columns between them). The old parser treated the
    # whole sheet as one scheme (name "SCHEME CODE002STARTS", weights summing to ~10x a portfolio) and read holding
    # names from the column before ISIN, which is empty for UTI — so its funds were all left out as bad_weight.
    hdr = ("NAME OF THE INSTRUMENT ", "RATING/INDUSTRY", "QUANTITY", "MARKET-VALUE", "% TO NAV", None, None, "ISIN")
    rows = [
        ("SCHEME CODE002STARTS",),
        ("UTI MUTUAL FUND",),
        ("SCHEME: UTI - Liquid Fund",),
        ("PROVISIONAL AND UNAUDITED PORTFOLIO DISCLOSURE AS OF 30/09/2026 (Market value in Lacs)",),
        (),
        hdr,
        ("MONEY MARKET INSTRUMENTS",),
        ("7.10% GOI 2029", "SOV", 100, 1000.0, 60.0, None, None, "IN0020250000"),
        ("TREPS", None, None, None, 5.0, None, None, None),
        ("EQ - ICICI BANK LTD", "Banks", 100, 1000.0, 35.0, None, None, "INE090A01021"),
        ("SCHEME CODE002ENDS",),
        ("SCHEME: UTI - Overnight Fund",),
        ("PROVISIONAL AND UNAUDITED PORTFOLIO DISCLOSURE AS OF 30/09/2026 (Market value in Lacs)",),
        (),
        hdr,
        ("EQUITY AND EQUITY RELATED",),
        ("EQ - HDFC BANK LIMITED", "Banks", 100, 1000.0, 99.0, None, None, "INE040A01034"),
        ("NET CURRENT ASSETS", None, None, None, 1.0, None, None, None),
        ("SCHEME: UTI Gold ETF Fund of Fund",),
        ("PROVISIONAL AND UNAUDITED PORTFOLIO DISCLOSURE AS OF 30/09/2026 (Market value in Lacs)",),
        (),
        hdr,
        ("MONEY MARKET INSTRUMENTS",),
        ("MF UNITS UTI MF- GOLD EXCHANGE TRADED FUND ETF", "-", 100, 1000.0, 100.35, None, None, "INF789F1AUX7"),
        ("NET CURRENT ASSETS", -526.5, "*"),
    ]
    out = parse_sheet_all(rows)
    assert [s["scheme_name"] for s in out] == ["UTI - Liquid Fund", "UTI - Overnight Fund", "UTI Gold ETF Fund of Fund"]
    assert [s["as_of"] for s in out] == ["2026-09-30"] * 3
    assert [s["weight_sum"] for s in out] == [100.0, 100.0, 100.35]
    assert [h["name"] for h in out[0]["holdings"]] == ["7.10% GOI 2029", "TREPS", "EQ - ICICI BANK LTD"]
    assert out[0]["holdings"][2]["sector"] == "Banks" and out[0]["holdings"][1]["instrument_type"] == "cash"


def test_parse_sheet_skips_interest_rate_swap_rows():
    # Tata's floating-rate sheets list IRS rows with IRSSWAP identifiers and notional weights; counting them
    # pushed those funds to 121–161% and dropped them as bad_weight, although the real holdings sum to ~100%.
    rows = [
        ("Portfolio of Tata Floating Interest Rates Fund as on September 30, 2026",),
        ("Name of the Instrument", "ISIN", "Industry", "% to Net Assets"),
        ("SGS ANDHRA PRADESH 7.70% (06/12/2029)", "IN1020230620", "SOV", 90.0),
        ("IRS - SW202404280000027", "IRSSWAP07877", "IRS", 26.23),
        ("TREPS", None, None, 10.0),
    ]
    s = parse_sheet(rows)
    assert [h["name"] for h in s["holdings"]] == ["SGS ANDHRA PRADESH 7.70% (06/12/2029)", "TREPS"]
    assert s["weight_sum"] == 100.0


def test_page_links_ignores_information_ratio_workbooks():
    # HSBC's disclosure page links ir-*.xlsx (fund performance, no holdings) alongside portfolio files; the old
    # filter treated "ir-" as a portfolio signal and discovery picked the performance file, yielding zero sheets.
    page = ('<a href="https://example.com/assets/ir-hsbc-mf-27102026.xlsx">IR</a> '
            '<a href="https://example.com/assets/monthly-portfolio-30092026.xlsx">Portfolio</a>')
    assert _page_links(page, "https://example.com/") == ["https://example.com/assets/monthly-portfolio-30092026.xlsx"]


def test_sector_canon_merges_spellings_and_truncations_only():
    c = _sector_canon({"Aerospace & Defense", "Aerospace and Defense", "Agricultural, Commercial and Constr",
                       "Agricultural, Commercial and Construction Vehicles", "Banks", "Bank"})
    assert c["Aerospace & Defense"] == c["Aerospace and Defense"] == "Aerospace and Defense"
    assert c["Agricultural, Commercial and Constr"] == "Agricultural, Commercial and Construction Vehicles"
    assert c["Banks"] == "Banks" and c["Bank"] == "Bank"
