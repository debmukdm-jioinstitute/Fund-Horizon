from app.backoffice import fund_quartile as fq


def test_name_key_matches_advisorkhoj_and_amfi_names():
    assert fq.name_key("HSBC Multi Cap Fund Reg Gr") == fq.name_key("HSBC Multi Cap Fund - Direct Plan - Growth")


def test_fund_quartiles(monkeypatch):
    def table(cat, period, plan, client=None):
        return {"columns": ["Scheme", "Current Quarter Quartile Rank"], "rows": [["HSBC Multi Cap Fund Reg Gr", "Top Quartile"]], "links": []}

    def annual(cat, plan, client=None):
        return {"columns": ["Scheme", "2024", "2025", "Details"], "rows": [["HSBC Multi Cap Fund Reg Gr", "Top", "Bottom", ""]], "fetched_at": "t"}

    monkeypatch.setattr(fq.ak, "fetch_quartile_table", table)
    monkeypatch.setattr(fq.ak, "fetch_quartile_annual", annual)
    out = fq.fund_quartiles("HSBC Multi Cap Fund - Regular Plan - Growth", "multi_cap")
    assert out["trailing"] == {"1Y": "Top Quartile", "3Y": "Top Quartile", "5Y": "Top Quartile"}
    assert out["years"] == [["2024", "Top"], ["2025", "Bottom"]]
    assert fq.fund_quartiles("X", "liquid") is None
