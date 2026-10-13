"""Config loaders. All thresholds/assumptions live in yaml/json beside this file."""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path

import pandas as pd
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
    data = _load_yaml("assumptions.yaml")
    # The data date is whatever the dataset really contains (latest NAV date), never a typed-in constant.
    from app.data.loader import load_metrics

    latest = pd.to_datetime(load_metrics()["last_nav_date"], errors="coerce").max()
    if pd.notna(latest):
        data["data_asof"] = latest.strftime("%Y-%m-%d")
    return data


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



@lru_cache(maxsize=1)
def load_tax_rules() -> dict:
    """FY-dated Indian income-tax rules (tax_rules.yaml). Owner/CA edits once a year."""
    return _load_yaml("tax_rules.yaml")


@lru_cache(maxsize=1)
def load_tax_catalog() -> dict:
    """Plain-English catalog of savings and investment instruments (tax_catalog.yaml)."""
    return _load_yaml("tax_catalog.yaml")


@lru_cache(maxsize=1)
def load_mf_tax_classes() -> dict:
    """How each canonical fund category is taxed (mf_tax_classes.yaml)."""
    return _load_yaml("mf_tax_classes.yaml")


@lru_cache(maxsize=1)
def load_screening() -> dict:
    """Fund screening thresholds and ratio catalog (screening.yaml)."""
    return _load_yaml("screening.yaml")


@lru_cache(maxsize=1)
def load_sebi_benchmarks() -> dict:
    """SEBI category benchmark definitions (sebi_benchmarks.yaml)."""
    return _load_yaml("sebi_benchmarks.yaml")
