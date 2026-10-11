"""Provider-agnostic LiteLLM client with fallback orchestration across free-tier providers."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

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

    import litellm

    litellm.suppress_debug_info = True

    for p in providers:
        name = p.get("name", "unknown")
        model = p.get("model")
        env_key = p.get("env_key")
        api_base_env = p.get("api_base_env")
        default_base = p.get("default_base_url")

        # Check API key or custom base URL
        api_key = os.environ.get(env_key) if env_key else None
        api_base = os.environ.get(api_base_env) if api_base_env else default_base

        if env_key and not api_key:
            # Skip if key is not configured
            continue

        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "timeout": timeout,
            }
            if api_key:
                kwargs["api_key"] = api_key
            if api_base and name == "ollama":
                kwargs["api_base"] = api_base

            resp = litellm.completion(**kwargs)
            if resp and resp.choices and resp.choices[0].message:
                content = resp.choices[0].message.content
                if content:
                    return content.strip(), name
        except Exception:
            # Fall through to next provider
            continue

    return None, None
