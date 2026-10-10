"""Config loaders. All thresholds/assumptions live in yaml/json beside this file."""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).parent


def _load_yaml(name: str) -> dict:
    with open(CONFIG_DIR / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


def deep_merge(base: dict, overrides: dict | None) -> dict:
    """Return base with overrides merged recursively (neither input mutated)."""
    out = copy.deepcopy(base)
    for k, v in (overrides or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@lru_cache(maxsize=1)
def _assumptions_default() -> dict:
    return _load_yaml("assumptions.yaml")


def load_assumptions(overrides: dict | None = None) -> dict:
    """Assumptions dict, optionally with per-plan overrides merged on top."""
    return deep_merge(_assumptions_default(), overrides)


@lru_cache(maxsize=1)
def load_allocation() -> dict:
    return _load_yaml("allocation.yaml")


@lru_cache(maxsize=1)
def load_scoring() -> dict:
    return _load_yaml("scoring.yaml")


@lru_cache(maxsize=1)
def load_questionnaire() -> dict:
    with open(CONFIG_DIR / "questionnaire.json", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def load_analytics() -> dict:
    return _load_yaml("analytics.yaml")

