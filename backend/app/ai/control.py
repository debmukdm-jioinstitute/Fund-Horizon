from __future__ import annotations
"""AI control centre: runtime-editable model order, fallbacks and settings, plus live provider health.

Defaults come from config/ai.yaml. An admin's saved overrides live in the main SQLite DB (so they survive redeploys) and are
re-read on every call, so a change applies to the very next request in every worker. API keys are NEVER stored here: a provider
names the environment variable that holds its key (`env_key`) and the UI only learns whether that variable is set.
Health stats are per process and in memory (a restart clears them).
"""

import json
import os
import re
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

from app.db import sqlite as _sqlite

CHAINS = {"explain": "Plan, fund, CAS and tax explanations", "ask_ai": "Ask AI second opinion on a holding"}
DEFAULT_CHAINS = {"explain": None, "ask_ai": ["groq-large", "deepseek"]}  # None = every provider in yaml order
SETTINGS_LIMITS = {  # key -> (min, max, default)
    "timeout_seconds": (3, 180, 15), "max_retries": (0, 5, 2), "temperature": (0.0, 2.0, 0.1), "max_tokens": (50, 32000, 800),
    "failure_threshold": (1, 20, 3), "cooldown_seconds": (5, 3600, 60),
}
EFFORTS = ("", "minimal", "low", "medium", "high")
_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{1,31}$")
_ENV = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
_YAML = Path(__file__).resolve().parent.parent / "config" / "ai.yaml"
_DDL = ("CREATE TABLE IF NOT EXISTS fh_ai_config (id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT NOT NULL, version INTEGER NOT NULL, "
        "updated_at TEXT NOT NULL, updated_by TEXT)")
_READY: set[str] = set()
_yaml_cache: tuple[float, dict] | None = None
_STATS: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()


def _conn():
    conn = _sqlite.get_default_connection()
    key = str(_sqlite.get_default_db_path())
    if key not in _READY:
        with conn:
            conn.execute(_DDL)
        _READY.add(key)
    return conn


def _yaml_defaults() -> dict:
    global _yaml_cache
    m = _YAML.stat().st_mtime if _YAML.exists() else 0
    if _yaml_cache is None or _yaml_cache[0] != m:
        _yaml_cache = (m, (yaml.safe_load(_YAML.read_text(encoding="utf-8")) or {}) if _YAML.exists() else {})
    return _yaml_cache[1]


def saved() -> dict:
    row = _conn().execute("SELECT config, version, updated_at, updated_by FROM fh_ai_config WHERE id=1").fetchone()
    if not row:
        return {"overrides": {}, "version": 0, "updated_at": None, "updated_by": None}
    return {"overrides": json.loads(row["config"]), "version": row["version"], "updated_at": row["updated_at"], "updated_by": row["updated_by"]}


def effective_config() -> dict:
    """yaml defaults + saved overrides, in the same shape the client has always read, plus `chains` and `picks`."""
    base = _yaml_defaults()
    ov = saved()["overrides"]
    providers = []
    for p in base.get("providers", []):
        o = (ov.get("providers") or {}).get(p["name"], {})
        extra = dict(p.get("extra") or {})
        if "reasoning_effort" in o:
            extra.pop("reasoning_effort", None)
            if o["reasoning_effort"]:
                extra["reasoning_effort"] = o["reasoning_effort"]
        providers.append({**p, "model": o.get("model") or p.get("model"), "enabled": o.get("enabled", True), "extra": extra or None, "custom": False})
    for c in ov.get("custom_providers", []):
        providers.append({**c, "enabled": c.get("enabled", True), "extra": ({"reasoning_effort": c["reasoning_effort"]} if c.get("reasoning_effort") else None), "custom": True})
    names = [p["name"] for p in providers]
    chains = {}
    for k, default in DEFAULT_CHAINS.items():
        chosen = (ov.get("chains") or {}).get(k) or default or names
        chains[k] = [n for n in chosen if n in names]
    settings = {k: (ov.get("settings") or {}).get(k, base.get("settings", {}).get(k, d)) for k, (_, _, d) in SETTINGS_LIMITS.items()}
    picks = {"enabled": True, "model": os.environ.get("FH_OPENAI_MODEL", "gpt-6-luna"), "effort": os.environ.get("FH_OPENAI_EFFORT", "low"), **(ov.get("picks") or {})}
    return {"providers": providers, "settings": settings, "chains": chains, "picks": picks, "guardrails": base.get("guardrails", {}),
            "system_prompt": ov.get("system_prompt") or base.get("system_prompt", "")}


# --- validation and save ------------------------------------------------------------------------------------------------

def _num(v: Any, key: str) -> float:
    lo, hi, _ = SETTINGS_LIMITS[key]
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a number") from None
    if not lo <= x <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}")
    return int(x) if isinstance(SETTINGS_LIMITS[key][2], int) else x


def _safe_url(url: str) -> str:
    u = urlparse(url)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if not u.hostname or not ((u.scheme == "https") or (u.scheme == "http" and local)):
        raise ValueError("api_url must be https (http only for localhost)")
    return url


def validate(doc: dict) -> dict:
    """Return a clean overrides document or raise ValueError. Unknown keys are dropped."""
    base_names = {p["name"] for p in _yaml_defaults().get("providers", [])}
    out: dict[str, Any] = {}
    out["providers"] = {}
    for name, o in (doc.get("providers") or {}).items():
        if name not in base_names:
            raise ValueError(f"unknown provider {name}")
        item: dict[str, Any] = {}
        if "enabled" in o:
            item["enabled"] = bool(o["enabled"])
        if o.get("model"):
            item["model"] = str(o["model"]).strip()[:120]
        if "reasoning_effort" in o:
            if o["reasoning_effort"] not in EFFORTS:
                raise ValueError("reasoning_effort must be one of " + ", ".join(repr(e) for e in EFFORTS))
            item["reasoning_effort"] = o["reasoning_effort"]
        out["providers"][name] = item
    customs, seen = [], set(base_names)
    for c in doc.get("custom_providers") or []:
        name = str(c.get("name", "")).strip().lower()
        if not _NAME.match(name) or name in seen:
            raise ValueError(f"custom provider name '{name}' is invalid or already used")
        seen.add(name)
        env = str(c.get("env_key", "")).strip()
        if env and not _ENV.match(env):
            raise ValueError("env_key must be an environment variable name like MY_PROVIDER_API_KEY")
        if not c.get("model"):
            raise ValueError(f"custom provider {name} needs a model")
        customs.append({"name": name, "model": str(c["model"]).strip()[:120], "env_key": env or None, "api_url": _safe_url(str(c.get("api_url", ""))),
                        "enabled": bool(c.get("enabled", True)), "reasoning_effort": c.get("reasoning_effort", "") if c.get("reasoning_effort", "") in EFFORTS else ""})
    out["custom_providers"] = customs
    all_names = seen
    out["chains"] = {}
    for k in CHAINS:
        chain = (doc.get("chains") or {}).get(k)
        if chain is None:
            continue
        if not isinstance(chain, list) or not chain or len(set(chain)) != len(chain) or any(n not in all_names for n in chain):
            raise ValueError(f"chain '{k}' needs at least one distinct, known provider")
        out["chains"][k] = chain
    out["settings"] = {k: _num(v, k) for k, v in (doc.get("settings") or {}).items() if k in SETTINGS_LIMITS}
    if "system_prompt" in doc:
        sp = str(doc["system_prompt"] or "").strip()
        if len(sp) > 6000:
            raise ValueError("system_prompt is limited to 6000 characters")
        out["system_prompt"] = sp
    p = doc.get("picks") or {}
    if p:
        if p.get("effort", "low") not in EFFORTS:
            raise ValueError("picks.effort invalid")
        out["picks"] = {"enabled": bool(p.get("enabled", True)), "model": str(p.get("model", "")).strip()[:80] or None, "effort": p.get("effort", "low")}
        if not out["picks"]["model"]:
            del out["picks"]["model"]
    return out


def save(doc: dict, actor: str) -> dict:
    clean = validate(doc)
    conn = _conn()
    with conn:
        v = (conn.execute("SELECT version FROM fh_ai_config WHERE id=1").fetchone() or {"version": 0})["version"] + 1
        conn.execute("INSERT INTO fh_ai_config(id,config,version,updated_at,updated_by) VALUES(1,?,?,?,?) "
                     "ON CONFLICT(id) DO UPDATE SET config=excluded.config, version=excluded.version, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
                     (json.dumps(clean), v, datetime.now(UTC).isoformat(), actor))
    return view()


def reset(actor: str) -> dict:
    conn = _conn()
    with conn:
        conn.execute("DELETE FROM fh_ai_config WHERE id=1")
    return view()


# --- live health --------------------------------------------------------------------------------------------------------

def _stat(name: str) -> dict:
    return _STATS.setdefault(name, {"calls": 0, "ok": 0, "fail": 0, "consecutive_failures": 0, "cooldown_until": 0.0, "last_ok_at": None,
                                    "last_error": None, "last_error_at": None, "last_latency_ms": None})


def in_cooldown(name: str) -> bool:
    with _LOCK:
        return _stat(name)["cooldown_until"] > time.time()


def record(name: str, ok: bool, ms: int, error: str | None, settings: dict) -> None:
    with _LOCK:
        s = _stat(name)
        s["calls"] += 1
        s["last_latency_ms"] = ms
        now = datetime.now(UTC).isoformat()
        if ok:
            s.update(ok=s["ok"] + 1, consecutive_failures=0, cooldown_until=0.0, last_ok_at=now)
        else:
            s.update(fail=s["fail"] + 1, consecutive_failures=s["consecutive_failures"] + 1, last_error=(error or "")[:200], last_error_at=now)
            if s["consecutive_failures"] >= settings["failure_threshold"]:
                s["cooldown_until"] = time.time() + settings["cooldown_seconds"]  # stop hammering a dead provider


def status() -> dict:
    cfg = effective_config()
    now = time.time()
    with _LOCK:
        stats = {p["name"]: {**_stat(p["name"]), "cooldown_remaining_s": max(0, round(_stat(p["name"])["cooldown_until"] - now))} for p in cfg["providers"]}
    s = saved()
    return {"version": s["version"], "updated_at": s["updated_at"], "updated_by": s["updated_by"], "stats": stats,
            "keys": {p["name"]: bool(not p.get("env_key") or os.environ.get(p["env_key"])) for p in cfg["providers"]},
            "server_time": datetime.now(UTC).isoformat()}


def view() -> dict:
    """Everything the settings screen needs in one payload (no secrets)."""
    cfg = effective_config()
    st = status()
    return {**st, "providers": [{k: p.get(k) for k in ("name", "model", "enabled", "custom", "env_key", "api_url")} | {
                "reasoning_effort": (p.get("extra") or {}).get("reasoning_effort", ""),
                "key_present": st["keys"][p["name"]], "base_model": next((b["model"] for b in _yaml_defaults().get("providers", []) if b["name"] == p["name"]), p.get("model"))}
                for p in cfg["providers"]],
            "chains": cfg["chains"], "chain_labels": CHAINS, "settings": cfg["settings"], "limits": {k: list(v[:2]) for k, v in SETTINGS_LIMITS.items()},
            "picks": cfg["picks"], "system_prompt": cfg["system_prompt"], "guardrails": cfg["guardrails"], "efforts": list(EFFORTS),
            "mock_active": os.environ.get("FH_MOCK_LLM_RESPONSE") is not None}
