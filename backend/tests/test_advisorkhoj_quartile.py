from app.backoffice.providers import advisorkhoj as ak

HTML = """<select id="sel_schemeCategories"><option value="Equity: Flexi Cap">x</option></select>
<table id="tbl_scheme_returns"><thead><tr><th>Scheme Name</th><th>Rank</th></tr></thead><tbody>
<tr><td><a href="/mutual-funds-research/A">A Fund</a></td><td><span>Top Quartile</span></td></tr></tbody></table>"""


class _R:
    status_code, text = 200, HTML


class _C:
    def get(self, url, **kw):
        return _R()


def test_parse_quartile_table():
    ak._quartile_cache.clear()
    out = ak.fetch_quartile_table("Equity: Flexi Cap", "1y", "Regular", client=_C())
    assert out["columns"] == ["Scheme Name", "Rank"]
    assert out["rows"] == [["A Fund", "Top Quartile"]]
    assert out["links"] == ["https://www.advisorkhoj.com/mutual-funds-research/A"]
