# ruff: noqa: F401, F811  (pytest fixtures are imported from test_crm_core)
from __future__ import annotations

import re
from pathlib import Path

from app.backoffice.search import PROVIDERS, TABLE_COVERAGE

from .test_crm_core import _login, _make_customer, client

APP = Path(__file__).resolve().parents[1] / "app"


def _tables_in_code() -> set[str]:
    found: set[str] = set()
    for f in APP.rglob("*.py"):
        t = f.read_text(encoding="utf-8", errors="ignore")
        found |= set(re.findall(r"CREATE TABLE IF NOT EXISTS ([a-z_0-9]+)", t))
        found |= set(re.findall(r'__tablename__ = "([a-z_0-9]+)"', t))
    return found


def test_every_table_is_searched_or_explicitly_exempt():
    """New data must be wired into universal search (or exempted with a reason) the moment its table exists."""
    missing = sorted(_tables_in_code() - set(TABLE_COVERAGE))
    assert not missing, f"add these tables to TABLE_COVERAGE in app/backoffice/search.py: {missing}"
    assert {v for v in TABLE_COVERAGE.values() if v in PROVIDERS}, "searched scopes must exist as providers"
    assert all(v in PROVIDERS or len(v) > 15 for v in TABLE_COVERAGE.values()), "scope typo or missing exemption reason"


def test_search_endpoint_returns_funds_crm_and_scopes(client):
    _login(client, _make_customer("admin"))
    lead = client.post("/api/crm/leads", json={"name": "Quokka Searchable", "notes": "token FH-777777"}).json()
    scopes = {s["key"] for s in client.get("/api/backoffice/search/scopes").json()["scopes"]}
    assert {"mutual_funds", "fund_managers", "pms", "amcs", "crm", "news"} <= scopes
    crm = client.get("/api/backoffice/search", params={"q": "quokka", "scope": "crm"}).json()["results"]
    assert any(r["id"] == lead["id"] and r["scope"] == "crm" for r in crm)
    funds = client.get("/api/backoffice/search", params={"q": "hdfc", "scope": "mutual_funds"}).json()["results"]
    assert funds and all(r["href"].startswith("/backoffice/mutual-funds?q=") for r in funds)
    amcs = client.get("/api/backoffice/search", params={"q": "hdfc", "scope": "amcs"}).json()["results"]
    assert amcs
    assert client.get("/api/backoffice/search", params={"q": "x"}).status_code == 422
