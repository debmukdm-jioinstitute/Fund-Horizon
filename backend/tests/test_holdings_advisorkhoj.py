from app.backoffice.holdings_advisorkhoj import clean_company, company_key, fetch_batch, parse_table

PAGE = """<table><tr><th>Company Name</th><th>Axis Flexi Cap FundHoldings (%)</th><th>HDFC Flexi Cap FundHoldings (%)</th></tr>
<tr><td>APAR INDUSTRIES LIMITED EQ</td><td>4.19</td><td>0.27</td></tr>
<tr><td>WAKEFIT INNOVATIONS PRIVATE LIMITED EQ</td><td>0.05</td><td>-</td></tr>
<tr><td>VISHAL MEGA MART PRIVATE LIMITED EQ NEW FV RS.10/-</td><td>-</td><td>0.54</td></tr>
<tr><td>Portfolio Overlap Total</td><td>41.38</td><td>41.12</td></tr></table>"""


def test_parse_table_union_rows_and_per_fund_holdings():
    names, rows = parse_table(PAGE)
    assert names == ["Axis Flexi Cap Fund", "HDFC Flexi Cap Fund"] and len(rows) == 3  # overlap total row dropped
    got = fetch_batch(lambda _u: PAGE.encode(), "Equity: Flexi Cap", names)
    assert [h["name"] for h in got["Axis Flexi Cap Fund"]] == ["Apar Industries Limited", "Wakefit Innovations Private Limited"]
    assert got["HDFC Flexi Cap Fund"][1] == {"name": "Vishal Mega Mart Private Limited", "weight_pct": 0.54}
    assert parse_table("<p>no table</p>") == ([], [])


def test_company_key_matches_disclosure_spelling():
    assert company_key(clean_company("ADANI ENTERPRISES LIMITED EQ NEW FV RE.1/-")) == company_key("Adani Enterprises Ltd.")
