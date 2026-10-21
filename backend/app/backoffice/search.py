from __future__ import annotations
"""Universal backoffice search: one query across every searchable data set.

Adding a searchable data set = writing one function decorated with ``@provider(scope, label)`` below and listing its
table(s) in ``TABLE_COVERAGE``. ``tests/test_universal_search.py`` fails when a ``CREATE TABLE`` / ``__tablename__``
appears in the code that is in neither ``TABLE_COVERAGE`` nor an explicit exemption, so new data cannot silently
stay out of search.
"""

import json
import re
from functools import lru_cache
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

from app.data.loader import data_dir, load_metrics
from app.db import sqlite

Hit = dict[str, Any]
Provider = Callable[[str, int, list[str] | None], list[Hit]]

# scope key -> (label, provider). Insertion order is the display order of the scope chips.
PROVIDERS: dict[str, tuple[str, Provider]] = {}


def provider(scope: str, label: str) -> Callable[[Provider], Provider]:
    def deco(fn: Provider) -> Provider:
        PROVIDERS[scope] = (label, fn)
        return fn

    return deco


def _hit(scope: str, type_: str, id_: str, title: str, subtitle: str, href: str, external: bool = False, amc: str | None = None, pms: str | None = None) -> Hit:
    """``amc`` / ``pms`` let the UI show the fund house or PMS firm logo next to the result."""
    return {"scope": scope, "type": type_, "id": str(id_), "title": title, "subtitle": subtitle, "href": href, "external": external, "amc": amc, "pms": pms}


def _like(q: str) -> str:
    return "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _rows(sql: str, params: tuple) -> list[Any]:
    try:
        return sqlite.get_default_connection().execute(sql, params).fetchall()
    except Exception:  # noqa: BLE001 - a table that does not exist yet on this volume just yields no hits
        return []


def _funds(q: str):
    df = load_metrics()
    s = q.strip().lower()
    m = (
        df["scheme_name"].str.lower().str.contains(s, regex=False)
        | df["scheme_code"].astype(str).str.contains(s, regex=False)
        | df["amc"].fillna("").str.lower().str.contains(s, regex=False)
        | df["isin_growth_or_payout"].fillna("").str.lower().str.contains(s, regex=False)
    )
    hit = df[m & (df["option"] == "Growth")].copy()
    name = hit["scheme_name"].str.lower()
    hit["_rank"] = (~(name.str.startswith(s) | name.str.contains(" " + s, regex=False))).astype(int)  # word-start matches first
    return hit.sort_values("_rank", kind="stable")


@provider("mutual_funds", "Mutual funds")
def mutual_funds(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    out = []
    for _, r in _funds(q).head(limit).iterrows():
        out.append(_hit(
            "mutual_funds", "fund", r["scheme_code"], r["scheme_name"],
            f"{r.get('amc') or ''} · {r.get('plan') or ''} · {r.get('category') or ''}".strip(" ·"),
            f"/backoffice/mutual-funds?q={quote(str(r['scheme_code']))}", amc=r.get("amc"),
        ))
    return out


@provider("fund_managers", "Fund managers")
def fund_managers(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    rows = _rows(
        "SELECT manager_name, COUNT(*) n, MIN(scheme_code) code FROM mf_managers "
        "WHERE LOWER(manager_name) LIKE ? ESCAPE '\\' GROUP BY manager_name ORDER BY n DESC LIMIT ?",
        (_like(q), limit),
    )
    return [_hit("fund_managers", "manager", r[0], r[0], f"Manages {r[1]} fund{'s' if r[1] != 1 else ''}", f"/backoffice/mutual-funds?q={quote(str(r[2]))}") for r in rows]


@provider("pms", "PMS funds")
def pms(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    rows = _rows(
        "SELECT ia_id, strategy_name, provider, strategy_type FROM pms_apmi_strategies "
        "WHERE LOWER(strategy_name) LIKE ? ESCAPE '\\' OR LOWER(provider) LIKE ? ESCAPE '\\' "
        "GROUP BY COALESCE(ia_id, strategy_name) ORDER BY strategy_name LIMIT ?",  # table holds one row per period
        (_like(q), _like(q), limit),
    )
    return [_hit("pms", "pms", r[0] or r[1], r[1], " · ".join(x for x in (r[2], r[3]) if x), f"/backoffice/pms?q={quote(str(r[1]))}", pms=r[2]) for r in rows]


@provider("amcs", "AMCs")
def amcs(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    df = load_metrics()
    s = q.strip().lower()
    counts = df[df["amc"].fillna("").str.lower().str.contains(s, regex=False)]["amc"].value_counts().head(limit)
    return [_hit("amcs", "amc", name, name, f"{n} schemes", f"/backoffice/mutual-funds?q={quote(str(name))}", amc=str(name)) for name, n in counts.items()]


@provider("crm", "CRM records")
def crm(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    from app import repo_crm_extras as extras  # late import: keeps the CRM layer optional for this module

    label = {"household": "Household", "contact": "Contact", "lead": "Lead", "opportunity": "Opportunity", "case": "Grievance"}
    return [
        _hit("crm", r["type"], r["id"], r["title"], f"{label.get(r['type'], r['type'])} · {r['subtitle']}".strip(" ·"), r["href"])
        for r in extras.search(q, viewer, per_type=max(2, limit // 2))
    ][:limit * 2]


@provider("news", "News & notes")
def news(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    out = [
        _hit("news", "news", r[0], r[1], f"{r[2] or 'News'} · {(r[3] or '')[:10]}".strip(" ·"), r[4] or "/backoffice/research?tab=briefing", external=bool(r[4]))
        for r in _rows(
            "SELECT id, title, source_name, published_at, link FROM news_items WHERE LOWER(title) LIKE ? ESCAPE '\\' "
            "ORDER BY published_at DESC LIMIT ?", (_like(q), limit))
    ]
    out += [
        _hit("news", "note", r[0], r[1], "Research note", "/backoffice/research?tab=notes")
        for r in _rows(
            "SELECT id, title FROM research_notes WHERE LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(content) LIKE ? ESCAPE '\\' "
            "ORDER BY updated_at DESC LIMIT ?", (_like(q), _like(q), limit))
    ]
    return out[:limit]


@lru_cache(maxsize=1)
def official_forms() -> list[dict[str, str]]:
    """Official CAMS / KFintech (Karvy) forms from data/official_forms.json (rebuilt by scripts/build_official_forms.py)."""
    return json.loads((data_dir().parent / "official_forms.json").read_text())


@provider("forms", "Official forms")
def forms(q: str, limit: int, viewer: list[str] | None) -> list[Hit]:
    words = q.lower().split()
    out = []
    for f in official_forms():
        hay = f"{f['title']} {f['source']} {f.get('amc', '')} {f['category']} {f['keywords']} {'karvy' if f['source'] == 'KFintech' else ''}".lower()
        if all(w in hay for w in words):
            out.append(_hit("forms", f["kind"].lower(), f["url"], f["title"], f"{f.get('amc') or f['source']} · {f['category']} · {f['kind']}", f["url"], external=True))
    return out[:limit]


def scopes() -> list[dict[str, str]]:
    return [{"key": k, "label": label} for k, (label, _) in PROVIDERS.items()]


def run(q: str, scope: str, viewer: list[str] | None) -> list[Hit]:
    q = q.strip()
    if len(q) < 2:
        return []
    keys = list(PROVIDERS) if scope == "all" else [scope] if scope in PROVIDERS else []
    limit = 6 if scope == "all" else 20
    out: list[Hit] = []
    for k in keys:
        try:
            out += PROVIDERS[k][1](q, limit, viewer)
        except Exception:  # noqa: BLE001 - one broken data set must not blank the whole search
            continue
    seen: set[tuple[str, str, str]] = set()
    return [h for h in out if (k := (h["scope"], h["type"], h["id"])) not in seen and not seen.add(k)]


# ---------------------------------------------------------------------------
# Coverage map: every table defined in the code is either searched (scope) or exempt (reason).
# ---------------------------------------------------------------------------
_SERIES = "numeric time series, reached through its parent record"
_SYSTEM = "system / operational log, not business data"
_CRM_CHILD = "child record, reached from the household / contact record page"
TABLE_COVERAGE: dict[str, str] = {
    # searched
    "mf_schemes": "mutual_funds", "mf_screening_metrics": "mutual_funds", "mf_quartile_external": "mutual_funds",
    "mf_managers": "fund_managers",
    "pms_apmi_strategies": "pms", "pms_providers": "pms", "pms_strategy_details": "pms", "pms_accounts": "pms",
    "households": "crm", "household_members": "crm", "customers": "crm", "contacts": "crm", "leads": "crm",
    "opportunities": "crm", "cases": "crm",
    "news_items": "news", "research_notes": "news",
    # exempt
    **{t: _SERIES for t in (
        "observations", "flows", "option_contracts", "option_snapshots", "nav_monthly", "mf_benchmark_nav", "mf_ter",
        "metrics", "funds", "fund_holdings", "pms_strategy_observations", "portfolio_valuations", "portfolio_cashflows",
        "issuer_fundamentals", "instrument_registry")},
    **{t: _SYSTEM for t in (
        "audit_events", "audit_log", "collector_runs", "source_registry", "sessions", "cas_sessions", "import_jobs",
        "screening_runs", "screening_presets", "plans", "briefings", "factsheets", "crm_list_views", "watchlists",
        "learn_prefs", "learn_progress", "quiz_attempts", "badges", "card_reviews", "xp_events", "rm_teams", "campaigns",
        "campaign_members", "commissions", "disclosure_logs", "consents")},
    **{t: _CRM_CHILD for t in (
        "activities", "kyc_records", "fixed_deposits", "insurance_policies", "portfolio_positions", "holdings",
        "sip_schedules", "suitability_records", "mandates")},
}

