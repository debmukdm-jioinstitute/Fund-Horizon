"""Category normaliser: maps old/new SEBI category labels (+ scheme name) to canonical keys."""
from __future__ import annotations

import re

# Ordered (key, regex on lower-cased category). First match wins.
_CATEGORY_RULES: list[tuple[str, str]] = [
    ("index_debt", r"index funds - debt"),
    ("index_hybrid", r"index funds - hybrid"),
    ("index_equity", r"index funds"),
    ("international", r"overseas"),
    ("fof_domestic", r"fund of funds|fof domestic"),
    ("etf_other", r"exchange traded|other\s+etfs|\betf\b"),
    ("solution_retirement", r"retirement fund"),
    ("solution_children", r"children"),
    ("overnight", r"overnight"),
    ("liquid", r"liquid"),
    ("money_market", r"money market"),
    ("short_duration", r"ultra short|short duration|short term|low duration"),
    ("corporate_bond", r"corporate bond"),
    ("banking_psu", r"banking and psu"),
    ("gilt", r"gilt|constant maturity"),
    ("credit_risk", r"credit risk"),
    ("dynamic_bond", r"dynamic bond|dynamic term"),
    ("medium_long_duration", r"medium|long term|long duration"),
    ("floater", r"floating"),
    ("fixed_term", r"fixed term"),
    ("other_debt", r"^income$|other debt"),
    ("arbitrage", r"arbitrage"),
    ("balanced_advantage", r"balanced advantage|dynamic asset allocation"),
    ("equity_savings", r"equity savings"),
    ("multi_asset", r"multi asset"),
    ("aggressive_hybrid", r"aggressive hybrid"),
    ("conservative_hybrid", r"conservative hybrid"),
    ("balanced_hybrid", r"balanced hybrid"),
    ("elss", r"elss"),
    ("large_mid_cap", r"large & mid"),
    ("large_cap", r"large cap"),
    ("mid_cap", r"mid cap"),
    ("small_cap", r"small cap"),
    ("flexi_cap", r"flexi cap"),
    ("multi_cap", r"multi cap"),
    ("focused", r"focused"),
    ("value", r"value fund"),
    ("contra", r"contra"),
    ("dividend_yield", r"dividend yield"),
    ("sectoral_thematic", r"sectoral|thematic"),
]
_COMPILED = [(k, re.compile(p)) for k, p in _CATEGORY_RULES]
_GOLD_NAME = re.compile(r"\bgold\b", re.IGNORECASE)
_ETF_NAME = re.compile(r"\betf\b|exchange traded", re.IGNORECASE)
_FOF_NAME = re.compile(r"fund of fund|\bfof\b", re.IGNORECASE)
_INDEX_DEBT_NAME = re.compile(r"gilt|bond|g-sec|sdl|debt|liquid|maturity", re.IGNORECASE)


def normalise_category(category: str, scheme_name: str = "") -> str:
    """Canonical key for a raw category label and scheme name.

    Gold funds are identified by scheme name (they sit under FoF/ETF categories in AMFI data).
    """
    if _GOLD_NAME.search(scheme_name or ""):
        return "gold"
    c = (category or "").lower()
    for key, rx in _COMPILED:
        if rx.search(c):
            if key == "index_equity" and _INDEX_DEBT_NAME.search(scheme_name or ""):
                return "index_debt"
            return key
    return "other"


def needs_demat(category: str, scheme_name: str = "") -> bool:
    """True for exchange-traded gold units (need a demat account); FoFs do not."""
    name = scheme_name or ""
    if _FOF_NAME.search(name):
        return False
    return bool(_ETF_NAME.search(name) or "etf" in (category or "").lower())
