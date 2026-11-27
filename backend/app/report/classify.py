"""One place that decides whether a parsed row is a Mutual Fund, a PMS strategy or Direct Equity.

Order of evidence: (1) what the parser already knew (PMS / Direct Equity), (2) the instrument identifiers (an INF ISIN or an AMFI
code is a mutual fund, an INE ISIN is a listed share), (3) PMS wording, (4) the APMI registry of SEBI-registered portfolio
managers and their strategies (the same data as the PMS pages), (5) otherwise Mutual Fund. A mutual-fund wording ("Fund",
"Growth", "Reg", "IDCW", "ELSS"...) or an AMFI scheme match always beats a provider-name match, so "Motilal Oswal ELSS Tax
Saver Fund-Reg(G)" stays a mutual fund although Motilal Oswal also runs a PMS."""
from __future__ import annotations

import re
import time
from typing import Any, Callable

_GENERIC = {"asset", "assets", "management", "managers", "manager", "pms", "portfolio", "portfolios", "services", "pvt", "private", "ltd", "limited",
            "investment", "investments", "advisors", "advisers", "advisory", "wealth", "capital", "securities", "financial", "and", "the", "co", "india", "amc",
            "fund", "funds", "strategy", "service", "of", "llp", "company", "partners", "global"}
_PMS_WORDS = re.compile(r"\bpms\b|portfolio\s+management|\bpms\s+strategy\b", re.I)
_MF_WORDS = re.compile(r"\b(fund|scheme|growth|idcw|dividend|elss|reg|regular|direct|etf|fof|plan|nfo)\b|\((g|idcw|d)\)", re.I)
_ttl: list[Any] = [0.0, ()]


def _words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower())


def _registry() -> tuple[tuple[str, tuple[str, ...]], ...]:
    """(provider display name, distinctive tokens) for every APMI portfolio manager, plus ("", strategy words) for strategies. Cached 6 h."""
    if time.time() - _ttl[0] < 21600 and _ttl[1]:
        return _ttl[1]
    out: list[tuple[str, tuple[str, ...]]] = []
    try:
        from app.db import get_repository

        repo = get_repository()
        for p in repo.list_pms_providers():
            w = tuple(x for x in _words(p["name"]) if x not in _GENERIC and len(x) > 2)
            if w:
                out.append((p["name"], w))
        for s in repo.list_pms_universe_strategies():
            w = tuple(x for x in _words(s.get("strategy_name") or "") if x not in _GENERIC and len(x) > 2)
            if len(w) >= 2:  # a one-word strategy name is too generic to trust on its own
                out.append((str(s.get("provider") or ""), w))
    except Exception:
        pass
    _ttl[:] = [time.time(), tuple(out)]
    return _ttl[1]


def pms_provider(text: str) -> str | None:
    """Provider name when every distinctive token of a registered provider / strategy appears in the text, else None."""
    have = set(_words(text))
    best: tuple[int, str] | None = None
    for prov, w in _registry():
        if w and all(x in have for x in w) and (best is None or len(w) > best[0]):
            best = (len(w), prov)
    return best[1] if best else None


def classify_row(r: dict[str, Any], scheme_match: Callable[[dict[str, Any]], bool] | None = None) -> tuple[str, str | None]:
    """(asset_class, pms_provider). scheme_match(row) -> True when the row matches an AMFI scheme."""
    ac = str(r.get("asset_class") or "")
    if ac in ("PMS", "Direct Equity"):
        return ac, r.get("provider")
    isin = str(r.get("isin") or "").upper()
    if isin.startswith("INF") or r.get("code"):
        return "Mutual Fund", None
    if isin.startswith("INE"):
        return "Direct Equity", None
    text = " ".join(str(r.get(k) or "") for k in ("name", "category", "provider", "folio"))
    if _PMS_WORDS.search(text):
        return "PMS", pms_provider(text) or r.get("provider")
    if _MF_WORDS.search(str(r.get("name") or "")):
        return "Mutual Fund", None
    prov = pms_provider(text)
    return ("PMS", prov) if prov and not (scheme_match and scheme_match(r)) else ("Mutual Fund", None)
