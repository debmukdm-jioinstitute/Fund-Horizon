from __future__ import annotations
"""Provider-agnostic client with fallback orchestration across free-tier providers."""

import json
import logging
import os
import urllib.request
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_CONFIG: dict[str, Any] | None = None


def load_ai_config() -> dict[str, Any]:
    global _CONFIG
    if _CONFIG is None:
        cfg_path = Path(__file__).resolve().parent.parent / "config" / "ai.yaml"
        if cfg_path.exists():
            _CONFIG = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        else:
            _CONFIG = {}
    return _CONFIG


PROVIDER_URLS = {
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
}


def call_llm(
    prompt: str,
    system_prompt: str | None = None,
) -> tuple[str | None, str | None]:
    """Attempt completion across configured providers in priority order.

    Returns (response_text, provider_name_used) or (None, None) if all fail.
    """
    config = load_ai_config()
    providers = config.get("providers", [])
    settings = config.get("settings", {})
    timeout = settings.get("timeout_seconds", 15)
    temperature = settings.get("temperature", 0.1)
    max_tokens = settings.get("max_tokens", 800)

    if not system_prompt:
        system_prompt = config.get("system_prompt", "")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    # Test override hook
    mock_response = os.environ.get("FH_MOCK_LLM_RESPONSE")
    if mock_response is not None:
        return mock_response, "mock"

    for p in providers:
        name = p.get("name", "unknown")
        raw_model = p.get("model", "")
        # strip provider prefix if present (e.g. groq/llama-3.1-8b-instant -> llama-3.1-8b-instant)
        model = raw_model.split("/", 1)[1] if "/" in raw_model and not raw_model.startswith("openrouter/") else raw_model
        if raw_model.startswith("openrouter/"):
            model = raw_model.removeprefix("openrouter/")

        env_key = p.get("env_key")
        api_base_env = p.get("api_base_env")
        default_base = p.get("default_base_url")

        api_key = os.environ.get(env_key) if env_key else None
        api_base = os.environ.get(api_base_env) if api_base_env else default_base

        if env_key and not api_key:
            continue

        url = PROVIDER_URLS.get(name)
        if name == "ollama" and api_base:
            url = f"{api_base.rstrip("/")}/v1/chat/completions"

        if not url:
            continue

        try:
            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            data = json.dumps(payload).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                choices = res_data.get("choices", [])
                if choices and choices[0].get("message", {}).get("content"):
                    return choices[0]["message"]["content"].strip(), name
        except Exception:
            logger.debug("Provider %s failed, falling back", name, exc_info=True)
            continue

    return None, None
