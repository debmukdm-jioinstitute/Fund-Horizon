from __future__ import annotations
"""Provider-agnostic client with fallback orchestration across free-tier providers."""

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Any

from app.ai import control

logger = logging.getLogger(__name__)

PROVIDER_URLS = {
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/chat/completions",
}
_TRANSIENT = (408, 425, 429, 500, 502, 503, 504)


def load_ai_config() -> dict[str, Any]:
    """Effective config (yaml defaults + admin overrides), re-read every call so settings changes apply immediately."""
    return control.effective_config()


def _model_id(raw: str) -> str:
    """Strip the litellm-style provider prefix: groq/llama-3.1-8b-instant -> llama-3.1-8b-instant, openrouter/a/b -> a/b."""
    return raw.removeprefix("openrouter/") if raw.startswith("openrouter/") else (raw.split("/", 1)[1] if "/" in raw else raw)


def _post(url: str, payload: dict, api_key: str | None, timeout: int) -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": "fund-horizon/1.0"}  # Groq's Cloudflare rejects urllib's default UA
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - https URL validated in control.validate
        return json.loads(resp.read().decode("utf-8"))


def _err(e: Exception, api_key: str | None) -> tuple[str, bool]:
    """(short message with any key removed, worth retrying)."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            body = e.read().decode("utf-8", "replace")[:160]
        except Exception:
            body = ""
        msg, retry = f"HTTP {e.code} {body}".strip(), e.code in _TRANSIENT
    else:
        msg, retry = f"{type(e).__name__}: {e}"[:200], isinstance(e, (TimeoutError, urllib.error.URLError, ConnectionError))
    return (msg.replace(api_key, "***") if api_key else msg), retry


def _try_provider(p: dict, messages: list, settings: dict, max_tokens: int, timeout: int, ignore_cooldown: bool = False) -> tuple[str | None, dict]:
    """One provider with retries. Returns (text, attempt record). Records health stats."""
    name = p["name"]
    att: dict[str, Any] = {"provider": name, "model": _model_id(p.get("model", "")), "ok": False, "error": None, "ms": 0}
    env_key = p.get("env_key")
    api_key = os.environ.get(env_key) if env_key else None
    if not p.get("enabled", True):
        att["error"] = "disabled"
        return None, att
    if env_key and not api_key:
        att["error"] = f"{env_key} not set"
        return None, att
    if not ignore_cooldown and control.in_cooldown(name):
        att["error"] = "cooling down after repeated failures"
        return None, att
    url = p.get("api_url") or PROVIDER_URLS.get(name)
    if name == "ollama":
        base = os.environ.get(p.get("api_base_env") or "") or p.get("default_base_url")
        url = f"{base.rstrip('/')}/v1/chat/completions" if base else None
    if not url:
        att["error"] = "no endpoint configured"
        return None, att
    payload = {"model": att["model"], "messages": messages, "temperature": settings["temperature"], "max_tokens": max_tokens, **(p.get("extra") or {})}
    t0 = time.monotonic()
    for i in range(int(settings["max_retries"]) + 1):
        try:
            data = _post(url, payload, api_key, timeout)
            choices = data.get("choices") or []
            text = ((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""
            if text:
                att.update(ok=True, ms=round((time.monotonic() - t0) * 1000))
                control.record(name, True, att["ms"], None, settings)
                return text, att
            att["error"], retry = "empty answer (token limit or reasoning used it all)", False
        except Exception as e:  # noqa: BLE001 - any provider failure falls through to the next one
            att["error"], retry = _err(e, api_key)
        if not retry or i == settings["max_retries"]:
            break
        time.sleep(min(0.5 * 2**i, 2.0))
    att["ms"] = round((time.monotonic() - t0) * 1000)
    control.record(name, False, att["ms"], att["error"], settings)
    logger.info("Provider %s failed: %s", name, att["error"])
    return None, att


def call_llm_ex(
    prompt: str,
    system_prompt: str | None = None,
    only: tuple[str, ...] | None = None,
    max_tokens: int | None = None,
    timeout: int | None = None,
    chain: str = "explain",
) -> dict[str, Any]:
    """Run the configured fallback chain. Returns {text, provider, model, attempts[]}; text is None when every provider failed."""
    config = load_ai_config()
    settings = config["settings"]
    timeout = timeout or settings["timeout_seconds"]
    max_tokens = max_tokens or settings["max_tokens"]
    system_prompt = system_prompt or config.get("system_prompt", "")
    messages = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + [{"role": "user", "content": prompt}]

    mock_response = os.environ.get("FH_MOCK_LLM_RESPONSE")  # test override hook
    if mock_response is not None:
        return {"text": mock_response, "provider": "mock", "model": "mock", "attempts": []}

    by_name = {p["name"]: p for p in config["providers"]}
    order = list(only) if only else config["chains"].get(chain, [])
    attempts = []
    for n in order:
        if n not in by_name:
            continue
        text, att = _try_provider(by_name[n], messages, settings, max_tokens, timeout)
        attempts.append(att)
        if text:
            return {"text": text, "provider": n, "model": att["model"], "attempts": attempts}
    return {"text": None, "provider": None, "model": None, "attempts": attempts}


def call_llm(prompt: str, system_prompt: str | None = None, only: tuple[str, ...] | None = None, max_tokens: int | None = None,
             timeout: int | None = None, chain: str = "explain") -> tuple[str | None, str | None]:
    """(response_text, provider_name) from the first provider in the chain that answers, or (None, None).

    `only` overrides the chain with the named providers (tried in that order); `max_tokens`/`timeout` override the settings
    (reasoning models need more of both)."""
    r = call_llm_ex(prompt, system_prompt, only, max_tokens, timeout, chain)
    return r["text"], r["provider"]


def probe_provider(name: str) -> dict[str, Any]:
    """One tiny live call to a single provider, ignoring cooldown (used by the Test button). Never raises."""
    config = load_ai_config()
    p = next((x for x in config["providers"] if x["name"] == name), None)
    if not p:
        return {"provider": name, "ok": False, "error": "unknown provider", "ms": 0}
    if os.environ.get("FH_MOCK_LLM_RESPONSE") is not None:
        return {"provider": name, "ok": True, "error": None, "ms": 0, "model": "mock"}
    text, att = _try_provider({**p, "enabled": True}, [{"role": "user", "content": "Reply with the single word OK."}], config["settings"], 60, min(config["settings"]["timeout_seconds"], 30), ignore_cooldown=True)
    return {**att, "ok": bool(text)}


def call_openai_json(system_prompt: str, user_prompt: str, max_output_tokens: int = 1200) -> dict[str, Any] | None:
    """One OpenAI Responses API call that must return a JSON object. None on any failure (caller falls back)."""
    key = os.environ.get("OPENAI_API_KEY")
    picks = control.effective_config()["picks"]
    if not key or not picks.get("enabled", True):
        return None
    body = {
        "model": picks["model"],
        "input": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        "text": {"format": {"type": "json_object"}},
        "store": False,
        "max_output_tokens": max_output_tokens,  # a cap, not a spend: reasoning tokens count against it
    }
    effort = picks.get("effort", "low")  # low reasoning effort keeps token use down; "" omits it
    if effort:
        body["reasoning"] = {"effort": effort}
    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as r:  # noqa: S310 - fixed https endpoint
            data = json.loads(r.read())
        logger.info("openai usage: %s", data.get("usage"))
        text = "".join(
            c.get("text", "") for item in data.get("output", []) if item.get("type") == "message"
            for c in item.get("content", []) if c.get("type") == "output_text"
        )
        return json.loads(text)
    except Exception:
        logger.warning("OpenAI call failed", exc_info=True)
        return None
