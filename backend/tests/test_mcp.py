"""Fund Horizon MCP: auth, protocol, truthful/untrimmed-or-flagged results, write guards."""
import json
import re

from app import mcp_server as m
from tests.test_backoffice_api import _create_staff, _login_staff
from tests.test_backoffice_pms_universe import PAGE, REPORT
from app.backoffice.providers import apmi


def _rpc(client, token, method, params=None, id_=1):
    return client.post("/mcp", json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}},
                       headers={"Authorization": f"Bearer {token}"} if token else {})


def _token(client):
    _login_staff(client, _create_staff("analyst"))
    r = client.post("/api/mcp/tokens", json={"label": "test", "days": 7})
    assert r.status_code == 201, r.text
    client.cookies.clear()  # from here only the Bearer token identifies the caller
    return r.json()["token"], r.json()["id"]


def _call(client, token, name, args=None):
    r = _rpc(client, token, "tools/call", {"name": name, "arguments": args or {}})
    assert r.status_code == 200, r.text
    res = r.json()["result"]
    return res, (None if res["isError"] else json.loads(res["content"][0]["text"]))


def test_catalogue_is_consistent():
    names = [t["name"] for t in m.ALL_TOOLS]
    assert len(names) == len(set(names)) >= 45
    for t in m.TOOLS:
        for p in re.findall(r"{(\w+)}", t["path"]):
            assert p in t["inputSchema"]["properties"], (t["name"], p)
        assert set(t["query"]) <= set(t["inputSchema"]["properties"]), t["name"]
    assert {"valuation_approve", "crm_create_household", "form_fill"} <= m.WRITE_TOOLS
    assert not {n for n in names if "delete" in n or "recommend" in n and n != "recommended_lists"}  # nothing destructive, no editing the lists


def test_shrink_flags_what_was_cut():
    data, cut = m._shrink({"strategies": [{"n": i, "pad": "x" * 200} for i in range(1000)], "total": 1000}, limit=5000)
    assert len(json.dumps(data)) <= 5000 and cut["trimmed_lists"]["strategies"]["total"] == 1000
    assert m._shrink({"a": 1})[1] is None


def test_auth_required_and_token_lifecycle(client):
    assert _rpc(client, None, "ping").status_code == 401
    assert _rpc(client, "fhm_wrong", "ping").status_code == 401
    token, tid = _token(client)
    init = _rpc(client, token, "initialize", {"protocolVersion": "2025-06-18"}).json()["result"]
    assert init["serverInfo"]["name"] == "fund-horizon" and "Never estimate" in init["instructions"]
    assert _rpc(client, token, "tools/list").json()["result"]["tools"]
    assert client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers={"Authorization": f"Bearer {token}"}).status_code == 202
    _login_staff(client, _create_staff("analyst"))  # another user cannot revoke it
    assert client.delete(f"/api/mcp/tokens/{tid}").status_code == 404
    client.cookies.clear()
    # owner revokes
    from app.db import sqlite
    sqlite.delete_auth_session(__import__("hashlib").sha256(token.encode()).hexdigest())
    assert _rpc(client, token, "ping").status_code == 401


def test_tools_return_real_api_data_with_source_and_time(client):
    token, _ = _token(client)
    res, env = _call(client, token, "recommended_lists")
    assert not res["isError"] and env["source"] == "Fund Horizon API" and env["retrieved_at"].endswith("IST")
    assert env["data"]["pms"] and env["data"]["mf"]
    res, env = _call(client, token, "mf_screener", {"limit": 5})
    assert not res["isError"] and "data" in env


def test_pms_strategies_pages_and_never_silently_drops(client):
    from app.backoffice.repository import BackofficeRepository

    rows = apmi.parse_report(REPORT, "Equity", "D")
    full = [{**r, "strategy_name": f"{r['strategy_name']} {i}"} for i in range(30) for r in rows]
    BackofficeRepository().replace_pms_universe("2026-09-30", apmi.parse_providers(PAGE), full)
    token, _ = _token(client)
    _, env = _call(client, token, "pms_strategies", {"limit": 10})
    d = env["data"]
    assert d["as_on"] == "2026-09-30" and d["total"] == len(full) and len(d["strategies"]) == 10
    _, env = _call(client, token, "pms_strategies", {"limit": 10, "offset": 10})
    assert env["data"]["offset"] == 10 and env["data"]["strategies"][0] != d["strategies"][0]


def test_write_guards_and_errors_are_reported_not_hidden(client):
    token, _ = _token(client)
    res, _ = _call(client, token, "valuation_approve", {"batch_id": "x", "confirm": False})
    assert res["isError"] and "immutable" in res["content"][0]["text"].lower()
    res, _ = _call(client, token, "mf_research_detail", {})
    assert res["isError"] and "scheme_code" in res["content"][0]["text"]
    res, _ = _call(client, token, "nope")
    assert res["isError"]
    res, _ = _call(client, token, "mf_research_detail", {"scheme_code": "000000"})
    assert res["isError"] and "failed (" in res["content"][0]["text"]  # the API's own status, not a made-up answer


def test_one_click_connector_is_a_valid_personalised_bundle_and_its_token_works(client):
    import io
    import zipfile

    _login_staff(client, _create_staff("analyst"))
    r = client.post("/api/mcp/connector", json={})
    assert r.status_code == 200 and "Fund-Horizon-for-Claude.mcpb" in r.headers["content-disposition"]
    z = zipfile.ZipFile(io.BytesIO(r.content))
    man = json.loads(z.read("manifest.json"))
    env = man["server"]["mcp_config"]["env"]
    assert man["manifest_version"] and env["FH_URL"].endswith("/mcp") and env["FH_TOKEN"].startswith("fhm_")
    assert "server/index.js" in z.namelist() and b"Authorization" in z.read("server/index.js")
    client.cookies.clear()
    assert _rpc(client, env["FH_TOKEN"], "tools/list").json()["result"]["tools"]  # the baked-in token signs in


def test_gateway_reaches_every_operation_with_guards(client):
    token, _ = _token(client)
    _, env = _call(client, token, "api_catalog", {"search": "holding"})
    paths = {(o["method"], o["path"]) for o in env["data"]["operations"]}
    assert ("DELETE", "/api/crm/holdings/{holding_id}") in paths and ("POST", "/api/crm/holdings") in paths
    assert ("PATCH", "/api/backoffice/valuation/holdings/{holding_id}") in paths  # new edit operations are discoverable
    # credentials and access control are not reachable
    for bad in ("/api/auth/login", "/api/mcp/tokens", "/api/backoffice/staff/provision"):
        res, _ = _call(client, token, "api_call", {"method": "POST", "path": bad, "json": {}, "confirm": True})
        assert res["isError"], bad
    # unknown route -> helpful error, no guess
    res, _ = _call(client, token, "api_call", {"method": "GET", "path": "/api/crm/nothing-here"})
    assert res["isError"] and "api_catalog" in res["content"][0]["text"]
    # destructive calls need confirm, and nothing is sent without it
    res, _ = _call(client, token, "api_call", {"method": "DELETE", "path": "/api/crm/holdings/abc"})
    assert res["isError"] and "confirm=true" in res["content"][0]["text"]
    # with confirm the real API answers (404 for a missing holding) and the attempt is audited
    res, _ = _call(client, token, "api_call", {"method": "DELETE", "path": "/api/crm/holdings/abc", "confirm": True})
    assert res["isError"] and "404" in res["content"][0]["text"]
    _, log = _call(client, token, "mcp_audit_log")
    assert log["data"]["entries"] and log["data"]["entries"][0]["method"] == "DELETE"


def test_crm_holding_full_cycle_through_the_gateway(client):
    token, _ = _token(client)
    _, env = _call(client, token, "crm_create_household", {"name": "Cycle HH"})
    hh = env["data"]["id"]
    _, env = _call(client, token, "crm_create_client", {"household_id": hh, "name": "Cycle Client"})
    contact = env["data"]["id"]
    body = {"contact_id": contact, "folio": "F1", "scheme_code": "108466", "scheme_name": "Test Fund", "units": 10, "cost": 1000}
    res, env = _call(client, token, "api_call", {"method": "POST", "path": "/api/crm/holdings", "json": body})
    assert not res["isError"] and env["data"]["created"] == 1
    body["units"] = 25  # update = same upsert
    _, env = _call(client, token, "api_call", {"method": "POST", "path": "/api/crm/holdings", "json": body})
    assert env["data"]["updated"] == 1
    _, env = _call(client, token, "api_call", {"method": "GET", "path": f"/api/crm/contacts/{contact}/holdings"})
    hold = env["data"]["holdings"][0]
    assert hold["units"] == 25
    res, _ = _call(client, token, "api_call", {"method": "DELETE", "path": f"/api/crm/holdings/{hold['id']}", "confirm": True})
    assert not res["isError"]
    _, env = _call(client, token, "api_call", {"method": "GET", "path": f"/api/crm/contacts/{contact}/holdings"})
    assert env["data"]["holdings"] == []
