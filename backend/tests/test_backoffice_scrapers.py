"""Parser tests for scraped / RSS / TER feeds (no network)."""
from __future__ import annotations

from datetime import UTC, datetime

from app.backoffice.providers import amfi_ter, rss
from app.backoffice.providers.fred import FRED_REFRESH_SERIES, FredProvider
from app.backoffice.providers.india_yields import IndiaYieldsProvider

TE_HTML = """
<table>
<tr data-decimals="4" data-symbol="GIND10YR:IND"><td><a href="/india/government-bond-yield">India 10Y</a></td>
 <td id="p">7.38 </td><td id="triangle"></td><td id="date" class="d-none">Oct/13 </td></tr>
<tr data-decimals="4" data-symbol="GIND2Y:IND"><td>India 2Y</td><td id="p">6.60 </td><td id="date">Oct/13</td></tr>
<tr data-decimals="4" data-symbol="GIND52W:IND"><td>India 52W</td><td id="p">5.9</td><td id="date">Oct/13</td></tr>
<tr data-decimals="4" data-symbol="GIND30Y:IND"><td>India 30Y</td><td id="p">999</td><td id="date">Oct/13</td></tr>
<tr data-decimals="0" data-symbol="SENSEX:IND"><td>SENSEX</td><td id="p" class="market-widget-last"> 72,635 </td></tr>
</table>
"""


def test_india_yields_parse_and_sanity_bounds():
    res = IndiaYieldsProvider().parse_html(TE_HTML, today=datetime(2026, 10, 13, tzinfo=UTC))
    got = {o.instrument_id: (o.value_numeric, o.observed_at) for o in res.observations}
    assert got["YIELD:IN:10Y"] == (7.38, "2026-10-13")
    assert got["YIELD:IN:2Y"] == (6.6, "2026-10-13")
    assert "YIELD:IN:30Y" not in got  # 999 fails the sanity bound
    assert got["INDEX:IN:SENSEX"][0] == 72635.0
    assert all(o.quality_flags == "scraped" for o in res.observations)


def test_india_yields_year_rollover_and_layout_change():
    res = IndiaYieldsProvider().parse_html(TE_HTML.replace("Oct/13", "Dec/31"), today=datetime(2026, 1, 2, tzinfo=UTC))
    assert res.observations[0].observed_at == "2025-12-31"
    assert IndiaYieldsProvider().parse_html("<html>blocked</html>").status == "schema_error"


RSS_XML = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>RBI holds repo &amp; stance</title><link>https://rbi.org.in/a</link>
<description>&lt;p&gt;Policy &lt;b&gt;rate&lt;/b&gt; unchanged&lt;/p&gt;</description><pubDate>Mon, 12 Oct 2026 10:00:00 +0530</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item><title>No link at all</title></item>
</channel></rss>"""

ATOM_XML = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom story</title>
<link href="https://example.com/x"/><updated>2026-10-12T04:30:00Z</updated><summary>S</summary></entry></feed>"""


def test_rss_parse_strips_markup_and_drops_unsafe_links():
    feed = {"id": "t", "name": "T", "category": "markets", "url": "x"}
    items = rss.parse_feed(RSS_XML, feed)
    assert len(items) == 1
    assert items[0]["title"] == "RBI holds repo & stance"
    assert items[0]["summary"] == "Policy rate unchanged"
    assert items[0]["published_at"].startswith("2026-10-12T04:30")


def test_atom_and_malformed_feeds():
    feed = {"id": "t", "name": "T", "category": "markets", "url": "x"}
    assert rss.parse_feed(ATOM_XML, feed)[0]["link"] == "https://example.com/x"
    assert rss.parse_feed("<not xml", feed) == []


def test_ter_base_key_matches_nav_and_ter_names():
    assert amfi_ter.base_key("Parag Parikh Flexi Cap Fund - Direct Plan - Growth") == amfi_ter.base_key("Parag Parikh Flexi Cap Fund")


def test_ter_keeps_latest_day_per_scheme(monkeypatch):
    def rows(date, r_ter):
        return {"Scheme_Name": "X Fund", "TER_Date": f"{date}T00:00:00.000Z", "R_TER": r_ter, "D_TER": "0.5"}

    pages = {1: {"data": [rows("2026-10-01", "2.0")], "meta": {"pageCount": 2}}, 2: {"data": [rows("2026-10-12", "1.9")]}}
    monkeypatch.setattr(amfi_ter, "_get_page", lambda client, month, page: pages.get(page))
    out = amfi_ter.fetch_month("10-2026", workers=1)
    assert out == [{"scheme_name": "X Fund", "base_key": "xfund", "regular_ter_pct": 1.9, "direct_ter_pct": 0.5, "as_of": "2026-10-12"}]


def test_fred_fetch_all_requires_key_and_covers_india():
    assert FredProvider(api_key="").fetch_all().status == "needs_key"
    assert "INDIRLTLT01STM" in FRED_REFRESH_SERIES


def test_news_and_mf_ter_repository_roundtrip(client):
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    repo.upsert_news([{"id": "n1", "source_id": "s", "source_name": "S", "category": "markets", "title": "T", "link": "https://e.com", "summary": "", "published_at": "2026-10-12T00:00:00+00:00"}])
    assert any(n["id"] == "n1" for n in repo.list_news(limit=50))
    repo.replace_mf_schemes([{"scheme_code": "999001", "scheme_name": "Zed Fund - Direct Plan - Growth", "amc": "Zed", "category": "Equity", "plan": "Direct", "latest_nav": 10.0, "latest_nav_date": "2026-10-12"}])
    repo.replace_mf_ter([{"base_key": amfi_ter.base_key("Zed Fund"), "scheme_name": "Zed Fund", "regular_ter_pct": 2.0, "direct_ter_pct": 0.6, "as_of": "2026-10-12"}])
    found = [f for f in repo.search_mf_schemes("Zed Fund", None, None, 10, 0) if f["scheme_code"] == "999001"][0]
    assert found["ter_pct"] == 0.6  # Direct plan picks the direct TER
    assert found["nav_date"] == "2026-10-12" and found["latest_nav_date"] == "2026-10-12"
    assert repo.count_mf_schemes("Zed Fund", None, None) >= 1
    assert "Zed" in repo.mf_scheme_facets()["amcs"]
