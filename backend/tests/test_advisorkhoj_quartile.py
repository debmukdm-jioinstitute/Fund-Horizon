import time
from datetime import datetime

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


class _CountingC:
    """Like _C, but counts HTTP calls so a cache hit is provable (no new fetch)."""

    def __init__(self):
        self.calls = 0

    def get(self, url, **kw):
        self.calls += 1
        return _R()


def test_fetched_at_preserved_on_cache_hit_and_refreshed_after_expiry():
    ak._quartile_cache.clear()
    client = _CountingC()
    first = ak.fetch_quartile_table("Equity: Flexi Cap", "1y", "Regular", client=client)
    assert first["fetched_at"]  # set on the fresh fetch
    parsed = datetime.fromisoformat(first["fetched_at"])
    assert parsed.tzinfo is not None  # UTC timestamp, not a plain local time
    calls_after_first = client.calls
    assert calls_after_first > 0

    # Second fetch inside the 24h window: no new HTTP call, same fetched_at.
    second = ak.fetch_quartile_table("Equity: Flexi Cap", "1y", "Regular", client=client)
    assert client.calls == calls_after_first
    assert second["fetched_at"] == first["fetched_at"]
    assert second["rows"] == first["rows"]

    # Expire the cached entry, then fetch again: a new fetch with a new fetched_at.
    key = ("Equity: Flexi Cap", "1y", "Regular")
    cached_data = ak._quartile_cache[key][1]
    ak._quartile_cache[key] = (time.time() - ak._QUARTILE_TTL - 1, cached_data)
    third = ak.fetch_quartile_table("Equity: Flexi Cap", "1y", "Regular", client=client)
    assert client.calls > calls_after_first
    assert third["fetched_at"]
    assert third["fetched_at"] != first["fetched_at"]
    assert datetime.fromisoformat(third["fetched_at"]) >= parsed


def test_annual_uses_annual_path_without_period():
    ak._quartile_cache.clear()
    seen = {}

    class _Spy(_C):
        def get(self, url, **kw):
            seen.update(url=url, params=kw["params"])
            return _R()

    out = ak.fetch_quartile_annual("Equity: Flexi Cap", "Regular", client=_Spy())
    assert seen["url"].endswith("/quartile-ranking-annual-returns")
    assert "period" not in seen["params"]
    assert out["rows"] == [["A Fund", "Top Quartile"]]
