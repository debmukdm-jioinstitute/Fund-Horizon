from __future__ import annotations

import pytest
from fastapi import HTTPException

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
