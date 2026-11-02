"""Raw adapter output -> canonical records. Rounds, classifies asset type, flags bad ISINs. Never fills missing values."""
from __future__ import annotations

import re

from app.backoffice.valuation.canonical import ExtractedStatement, HoldingRec
from app.backoffice.valuation.ingestion import valid_isin

_TYPE_WORDS = [
    ("mutual_fund", r"mutual\s*fund|\bmf\b|\betf\b|scheme|fund units?"),
    ("debt", r"debt|bond|debenture|\bncd\b|g-?sec|gilt|fixed\s*income|fixed\s*deposit|\bfd\b|t-?bill|commercial\s*paper"),
    ("cash", r"\bcash\b|bank|liquid|money\s*market|overnight|receivable"),
    ("equity", r"equity|equities|stock|share|\bipo\b"),
]
_TYPE_RES = [(t, re.compile(p, re.I)) for t, p in _TYPE_WORDS]


def asset_type_for(hint: str, section: str, isin: str | None, default: str | None) -> str:
    for text in (hint, section):
        for t, rx in _TYPE_RES:
            if text and rx.search(text):
                return t
    if isin and isin.startswith("INF"):  # NSDL assigns INF to mutual fund / ETF units
        return "mutual_fund"
    return default or "other"


def finalize(stmt: ExtractedStatement, hints: list[tuple[HoldingRec, str]], default_type: str | None) -> ExtractedStatement:
    section_of = {id(h): s for h, s in hints}
    for h in stmt.holdings:
        hint = next((i.split(":", 1)[1] for i in h.issues if i.startswith("asset_type_hint:")), "")
        h.issues = [i for i in h.issues if not i.startswith("asset_type_hint:")]
        h.asset_type = asset_type_for(hint, section_of.get(id(h), ""), h.isin, default_type)
        h.account_no = h.account_no or stmt.account_no
        for f in ("avg_cost", "invested_amount", "price", "market_value", "unrealised_gain", "realised_gain", "income"):
            v = getattr(h, f)
            if v is not None:
                setattr(h, f, round(v, 4 if f in ("avg_cost", "price") else 2))
        if h.quantity is not None:
            h.quantity = round(h.quantity, 6)
        if h.isin and not valid_isin(h.isin):
            h.issues.append(f"ISIN '{h.isin}' fails format/check-digit validation.")
        if h.issues:
            h.validation_status = "warning"
    for f in stmt.flows:
        f.account_no = f.account_no or stmt.account_no
    stmt.valuation_date = stmt.valuation_date or stmt.statement_date
    return stmt
