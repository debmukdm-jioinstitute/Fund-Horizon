from __future__ import annotations

import io
import json

import pytest
from fastapi import HTTPException
from openpyxl import load_workbook

from app.backoffice import market_desk
from tests.test_backoffice_api import _create_staff, _login_staff

HTML = """<!doctype html><html><head><title>tipsheet</title>
<style>@font-face{font-family:Anek;src:url(/fonts/x.woff2)}:root{--paper:#fff;--sans:"Anek Latin",sans-serif}body{color:#111;font-family:var(--sans)}
a{color:blue}</style></head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="mast wrap"><a class="wordmark" href="/" aria-label="tipsheet, home">brand</a></header>
<nav class="sstrip wrap"><a href="/flows/">Flows strip</a></nav>
<main class="wrap"><h2>The Tipsheet indices today</h2>
<a href="/indices/nifty-50/">Nifty 50</a>
<img src="/og/x.png" alt="">
<a href="https://tipsheet.markets/flows/">Flows</a>
<p>Source: tipsheet models, from NSE</p>
</main>
<footer class="foot">© 2026 tipsheet.</footer>
<script>alert(1)</script>
</body></html>"""


def test_rebase_keeps_pages_on_this_origin():
    assert market_desk.rebase("/indices/nifty-50/") == "/backoffice/markets/indices/nifty-50/"
    assert market_desk.rebase("https://tipsheet.markets/flows/") == "/backoffice/markets/flows/"
    assert market_desk.rebase("/og/x.png") == "/api/backoffice/markets/og/x.png"
    assert market_desk.rebase("#main") == "#main"
    assert market_desk.rebase("/backoffice/markets/indices/nifty-50/") == "/backoffice/markets/indices/nifty-50/"


def test_split_document_strips_chrome_scripts_fonts_and_brand():
    css, body = market_desk.split_document(HTML)
    assert "alert" not in body
    assert "wordmark" not in body
    assert 'class="foot"' not in body
    assert "sstrip" not in body
    assert "Skip to content" not in body
    assert "Anek" not in css
    assert "@font-face" not in css
    assert "/backoffice/markets/indices/nifty-50/" in body
    assert "/api/backoffice/markets/og/x.png" in body
    assert "/backoffice/markets/flows/" in body
    assert "tipsheet.markets" not in body
    assert "tipsheet" not in body.lower()
    assert "The indices today" in body
    assert "Source: models, from NSE" in body
    assert ":host" in css
    assert "var(--font-google-sans)" in css


def test_markets_requires_staff(client):
    assert client.get("/api/backoffice/markets").status_code in (401, 403)


def test_markets_json_from_upstream(client, monkeypatch):
    monkeypatch.setattr(
        market_desk,
        "fetch_upstream",
        lambda path, query="": (200, "text/html; charset=utf-8", HTML.encode()),
    )
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/markets")
    assert r.status_code == 200
    data = r.json()
    assert "Nifty 50" in data["html"]
    assert "tipsheet.markets" not in data["html"]
    assert "tipsheet" not in data["html"].lower()
    assert "alert" not in data["html"]
    assert data["css"]


def test_path_traversal_rejected():
    with pytest.raises(HTTPException) as err:
        market_desk.safe_path("../secret")
    assert err.value.status_code == 400


TABLE_HTML = """<!doctype html><html><body>
<h2>Every NSE index: returns, trend and risk</h2>
<table class="data dense">
<thead><tr><th>Index</th><th>Family</th><th>1Y</th></tr></thead>
<tbody>
<tr><td><a href="/indices/nifty-pharma/">Nifty Pharma</a></td><td>Sector</td><td>+22.4%</td></tr>
<tr><td>Nifty Metal</td><td>Sector</td><td>−7.5%</td></tr>
</tbody>
</table>
<table class="data"><tr><td>too small</td></tr></table>
</body></html>"""


def test_extract_tables_reads_index_grid():
    sheets = market_desk.extract_tables(TABLE_HTML)
    assert len(sheets) == 1
    title, rows = sheets[0]
    assert "Every NSE index" in title
    assert rows[0] == ["Index", "Family", "1Y"]
    assert rows[1][0] == "Nifty Pharma"
    assert rows[1][2] == "+22.4%"
    assert rows[2][2] == "−7.5%"


def test_xlsx_is_openxml_and_coerces_percents():
    data = market_desk.build_xlsx(market_desk.extract_tables(TABLE_HTML))
    assert data[:2] == b"PK"
    wb = load_workbook(io.BytesIO(data))
    ws = wb.active
    assert ws["A1"].value == "Index"
    assert ws["A2"].value == "Nifty Pharma"
    assert ws["C2"].value == pytest.approx(0.224)
    assert ws["C2"].number_format == "0.0%"
    assert ws["C3"].value == pytest.approx(-0.075)
    assert ws["A1"].font.name == "Google Sans"


def test_xlsx_requires_staff(client):
    assert client.get("/api/backoffice/markets?format=xlsx").status_code in (401, 403)


def test_xlsx_endpoint_returns_workbook(client, monkeypatch):
    monkeypatch.setattr(
        market_desk,
        "fetch_upstream",
        lambda path, query="": (200, "text/html; charset=utf-8", f"<html><body>{TABLE_HTML}</body></html>".encode()),
    )
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/markets/indices?format=xlsx")
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers["content-type"]
    assert r.headers["content-disposition"].endswith('.xlsx"')
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.active["A2"].value == "Nifty Pharma"


def test_xlsx_without_tables_is_404():
    with pytest.raises(HTTPException) as err:
        market_desk.build_xlsx([])
    assert err.value.status_code == 404


CHART_JSON = {
    "dates": ["2024-01-05", "2024-06-07", "2025-01-03"],
    "series": {"trend_india": [100.0, 110.0, 121.0], "n500": [200.0, 210.0, 220.0]},
}
CHART_HTML = """<!doctype html><html><body>
<figure class="chart" data-chart='{"kind":"line","src":"/data/v1/models/demo.json","series":[{"slot":1,"col":"trend_india","label":"Trend India"},{"slot":6,"col":"n500","label":"Nifty 500 (NSE)","tone":"hist"}],"from":"2024-01-05","transform":{"type":"rebase","base":100},"fmt":"num","digits":0,"name":"Trend"}'>
  <header><h3>Trend</h3></header>
  <div class="plot"><p class="loading">Loading chart…</p></div>
  <figcaption>
    <div class="tools">
      <button type="button" data-act="table">Table</button>
      <button type="button" data-act="csv">Download CSV</button>
      <a class="tool" data-json href="/data/v1/models/demo.json">JSON</a>
    </div>
    <div class="tableview" hidden></div>
  </figcaption>
</figure>
<form class="search" action="/search/" method="get"><input id="search-q" name="q" type="search"></form>
<p class="search-status" data-status></p>
<ol class="search-results" data-results></ol>
</body></html>"""


def _fake_chart_fetch(path, query=""):
    if str(path).startswith("data/"):
        return 200, "application/json", json.dumps(CHART_JSON).encode()
    return 200, "text/html; charset=utf-8", CHART_HTML.encode()


def test_charts_render_svg_and_csv_link(monkeypatch):
    monkeypatch.setattr(market_desk, "fetch_upstream", _fake_chart_fetch)
    from app.backoffice.market_charts import enhance_document, json_to_csv, render_chart, search_catalog

    svg = render_chart(
        {
            "kind": "line",
            "series": [{"slot": 1, "col": "trend_india", "label": "Trend India"}],
            "from": "2024-01-05",
            "transform": {"type": "rebase", "base": 100},
            "name": "Trend",
        },
        CHART_JSON,
    )
    assert "<svg" in svg and "Trend India" in svg
    assert "Loading chart" not in svg

    body = enhance_document(CHART_HTML, path="search", query="q=trend")
    assert "Loading chart" not in body
    assert "<svg" in body
    assert "format=csv" in body
    assert "tableview" in body and "Trend India" in body
    assert 'href="/backoffice/markets/trend/"' in body
    csv_text = json_to_csv(CHART_JSON, ["trend_india"])
    assert csv_text.splitlines()[0] == "Date,trend_india"
    assert "100.0" in csv_text
    hits = search_catalog("trend")
    assert any(h["path"] == "/trend/" for h in hits)


def test_markets_json_fills_charts(client, monkeypatch):
    monkeypatch.setattr(market_desk, "fetch_upstream", _fake_chart_fetch)
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/markets")
    assert r.status_code == 200
    html = r.json()["html"]
    assert "Loading chart" not in html
    assert "<svg" in html
    assert "format=csv" in html
    _, split_body = market_desk.split_document(CHART_HTML)
    assert "/backoffice/markets/search/" in split_body
    assert "/api/backoffice/markets/data/v1/models/demo.json" in split_body


def test_csv_endpoint_returns_series(client, monkeypatch):
    monkeypatch.setattr(market_desk, "fetch_upstream", _fake_chart_fetch)
    sid = _create_staff("analyst")
    _login_staff(client, sid)
    r = client.get("/api/backoffice/markets/data/v1/models/demo.json?format=csv&cols=trend_india")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert r.headers["content-disposition"].endswith('.csv"')
    text = r.content.decode()
    assert text.splitlines()[0] == "Date,trend_india"
    assert "121.0" in text

