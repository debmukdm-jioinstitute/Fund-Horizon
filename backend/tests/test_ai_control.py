import json
import time
import urllib.error

import pytest

from app.ai import client, control
from tests.test_backoffice_compare import _create_staff, _login_staff


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "ai.db"))
    monkeypatch.delenv("FH_MOCK_LLM_RESPONSE", raising=False)
    for k in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"):
        monkeypatch.setenv(k, "k-" + k)
    control._READY.clear()
    control._STATS.clear()


def _fake(monkeypatch, behaviour):
    calls = []

    def post(url, payload, key, timeout):
        calls.append((url, payload["model"]))
        r = behaviour(url, payload)
        if isinstance(r, Exception):
            raise r
        return {"choices": [{"message": {"content": r}}]}
    monkeypatch.setattr(client, "_post", post)
    monkeypatch.setattr(client.time, "sleep", lambda s: None)
    return calls


def test_defaults_and_primary_then_fallback_order(monkeypatch):
    calls = _fake(monkeypatch, lambda u, p: "answer" if "generativelanguage" in u else urllib.error.HTTPError(u, 401, "no", {}, None))
    assert client.call_llm("hi") == ("answer", "gemini")  # groq fails (401, no retry), gemini answers
    assert [c[0].split("/")[2] for c in calls] == ["api.groq.com", "generativelanguage.googleapis.com"]


def test_saved_order_applies_to_next_call_and_disabled_is_skipped(monkeypatch):
    calls = _fake(monkeypatch, lambda u, p: "ok")
    control.save({"chains": {"explain": ["gemini", "groq"]}, "providers": {"gemini": {"enabled": False}}}, "admin@x")
    assert client.call_llm("hi")[1] == "groq"  # gemini is first but disabled, so the fallback answers
    control.save({"chains": {"explain": ["gemini", "groq"]}, "providers": {"gemini": {"enabled": True, "model": "gemini-custom"}}}, "admin@x")
    assert client.call_llm("hi") == ("ok", "gemini") and calls[-1][1] == "gemini-custom"


def test_retries_transient_errors_but_not_auth_errors(monkeypatch):
    n = {"c": 0}

    def b(u, p):
        n["c"] += 1
        return urllib.error.HTTPError(u, 429, "slow down", {}, None) if n["c"] < 3 else "finally"
    _fake(monkeypatch, b)
    control.save({"chains": {"explain": ["groq"]}, "settings": {"max_retries": 2}}, "a")
    assert client.call_llm("hi") == ("finally", "groq") and n["c"] == 3


def test_circuit_breaker_skips_dead_provider_until_cooldown_ends(monkeypatch):
    calls = _fake(monkeypatch, lambda u, p: urllib.error.HTTPError(u, 500, "x", {}, None) if "groq.com" in u else "ok")
    control.save({"chains": {"explain": ["groq", "gemini"]}, "settings": {"max_retries": 0, "failure_threshold": 2, "cooldown_seconds": 60}}, "a")
    for _ in range(3):
        assert client.call_llm("hi")[1] == "gemini"
    assert sum("groq.com" in c[0] for c in calls) == 2  # third call never touched groq
    assert control.status()["stats"]["groq"]["cooldown_remaining_s"] > 0
    control._STATS["groq"]["cooldown_until"] = time.time() - 1
    client.call_llm("hi")
    assert sum("groq.com" in c[0] for c in calls) == 3


def test_missing_key_is_reported_not_silent(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY")
    _fake(monkeypatch, lambda u, p: "ok")
    r = client.call_llm_ex("hi", chain="explain")
    assert r["provider"] == "gemini" and r["attempts"][0]["error"] == "GROQ_API_KEY not set"


def test_validation_rejects_bad_input_and_never_stores_secrets():
    for bad in ({"chains": {"explain": ["nope"]}}, {"chains": {"explain": ["groq", "groq"]}}, {"settings": {"timeout_seconds": 0}},
                {"custom_providers": [{"name": "x1", "model": "m", "api_url": "http://evil.example.com/v1"}]},
                {"custom_providers": [{"name": "groq", "model": "m", "api_url": "https://a.b/v1"}]},
                {"custom_providers": [{"name": "ok1", "model": "m", "api_url": "https://a.b/v1", "env_key": "sk-live-123"}]}):
        with pytest.raises(ValueError):
            control.validate(bad)
    ok = control.validate({"custom_providers": [{"name": "mine", "model": "m1", "api_url": "https://api.example.com/v1/chat/completions", "env_key": "MINE_API_KEY"}],
                           "chains": {"explain": ["mine", "groq"]}})
    assert ok["custom_providers"][0]["env_key"] == "MINE_API_KEY"
    assert "api_key" not in json.dumps(control.view()).lower().replace("env_key", "").replace("key_present", "").replace("_api_key", "")


def test_explain_cache_ignores_failures_and_respects_settings_version(monkeypatch):
    from app.ai import explain
    explain._EXPLANATION_CACHE.clear()
    plan = {"profile": {"band": "Moderate", "monthly_surplus": 50000}, "total_monthly_sip": 30000, "goals": []}
    monkeypatch.setenv("FH_MOCK_LLM_RESPONSE", "")
    assert explain.explain_plan(plan)["ai_generated"] is False
    assert len(explain._EXPLANATION_CACHE) == 0  # a template shown during an outage is not remembered
    monkeypatch.setenv("FH_MOCK_LLM_RESPONSE", "A simple moderate plan with 30000 monthly.")
    assert explain.explain_plan(plan)["ai_generated"] is True
    k1 = explain._cache_key("plan", plan)
    control.save({"settings": {"temperature": 0.5}}, "a")
    assert explain._cache_key("plan", plan) != k1


def test_api_roundtrip_admin_only_and_probe(client, monkeypatch):
    _fake(monkeypatch, lambda u, p: "OK")
    client.cookies.clear()
    assert client.get("/api/backoffice/ai/config").status_code in (401, 403)
    _login_staff(client, _create_staff(role="admin"))
    r = client.get("/api/backoffice/ai/config")
    assert r.status_code == 200
    v = r.json()
    assert v["chains"]["ask_ai"][0] == "groq-large" and all("key_present" in p for p in v["providers"])
    put = client.put("/api/backoffice/ai/config", json={"chains": {"explain": ["deepseek", "groq"]}})
    assert put.status_code == 200 and put.json()["chains"]["explain"][0] == "deepseek" and put.json()["version"] == v["version"] + 1
    assert client.put("/api/backoffice/ai/config", json={"chains": {"explain": ["zzz"]}}).status_code == 422
    assert client.post("/api/backoffice/ai/test/groq").json()["ok"] is True
    assert client.get("/api/backoffice/ai/status").json()["version"] == put.json()["version"]
    assert client.delete("/api/backoffice/ai/config").json()["chains"]["explain"][0] == "groq"
