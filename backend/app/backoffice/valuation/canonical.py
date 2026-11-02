"""Canonical in-memory structures produced by provider adapters. Missing source data stays ``None``."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

ASSET_TYPES = ("mutual_fund", "equity", "debt", "cash", "other")
FLOW_KINDS = ("deposit", "withdrawal", "transfer_in", "transfer_out", "fee", "income")
EXTERNAL_KINDS = ("deposit", "withdrawal")  # fee/income are inside the portfolio; transfers are paired in reconciliation
TOTAL_KEYS = ("total_value", "total_invested", "cash_balance", "opening_value", "realised_gain",
              "unrealised_gain", "income", "fees")


@dataclass
class HoldingRec:
    security_name: str
    asset_type: str = "other"
    isin: str | None = None
    account_no: str | None = None
    quantity: float | None = None
    avg_cost: float | None = None
    invested_amount: float | None = None
    price: float | None = None
    market_value: float | None = None
    unrealised_gain: float | None = None
    realised_gain: float | None = None
    income: float | None = None
    source_page: str | None = None
    source_row: int | None = None
    validation_status: str = "ok"
    issues: list[str] = field(default_factory=list)


@dataclass
class FlowRec:
    flow_date: str
    kind: str
    amount: float  # positive magnitude
    description: str | None = None
    account_no: str | None = None
    source_page: str | None = None
    source_row: int | None = None


@dataclass
class ExtractedStatement:
    provider: str
    asset_class: str                      # mutual_fund | pms
    filename: str
    adapter_version: str
    statement_date: str | None = None
    valuation_date: str | None = None
    period_start: str | None = None
    account_no: str | None = None
    account_name: str | None = None
    holdings: list[HoldingRec] = field(default_factory=list)
    flows: list[FlowRec] = field(default_factory=list)
    totals: dict[str, float | None] = field(default_factory=dict)   # provider-reported, see TOTAL_KEYS
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    needs_manual_review: bool = False
    flows_complete: bool = False          # only an adapter that SAW inception-to-date history may set this

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ExtractionError(Exception):
    """Unreadable / unsupported / password-protected file. ``code`` is machine-readable."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
