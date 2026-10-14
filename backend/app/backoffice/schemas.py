"""Pydantic schemas and typed request/response models for Fund Horizon Backoffice."""
from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class MarketResponseEnvelope(BaseModel, Generic[T]):
    """Standardized response envelope for shared market and backoffice data."""
    data: T
    source_ids: list[str] = Field(default_factory=list)
    as_of: str | None = None
    published_at: str | None = None
    fetched_at: str | None = None
    frequency: str = "daily"  # intraday, daily, monthly, quarterly
    availability: str = "ready"  # ready, unavailable, blocked, needs_key, manual_only, schema_error
    freshness: str = "current"  # current, stale, market_closed
    quality_flags: str = "ok"  # ok, outlier, estimated, interpolated
    coverage: str | None = None
    method_version: str = "1.0.0"


class ImpactAnalyzeRequest(BaseModel):
    series_x_id: str = "FX:USDINR"
    series_y_id: str = "VOL:US:VIX"
    horizon_days: int = 60  # 20, 60, 120
    lag_days: int = 0


class ImpactScenarioRequest(BaseModel):
    usd_shock_pct: float = 1.0  # e.g. +1%
    us_yield_shock_bps: float = 25.0  # e.g. +25 bps
    oil_shock_pct: float = 10.0  # e.g. +10%
    modified_duration: float = 6.5  # portfolio or benchmark duration


class WatchlistCreateRequest(BaseModel):
    name: str = "Core Watchlist"
    item_type: str  # scheme, pms, instrument, issuer
    item_id: str


class ResearchNoteCreateRequest(BaseModel):
    entity_type: str  # pms, mf, macro, instrument, strategy
    entity_id: str
    title: str
    content: str
    tags: str | None = None


class ResearchNoteUpdateRequest(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: str | None = None


class ImportPreviewRequest(BaseModel):
    import_type: str
    filename: str
    csv_content: str


class ImportCommitRequest(BaseModel):
    import_type: str
    filename: str
    csv_content: str


class StaffMemberCreateRequest(BaseModel):
    email: str
    name: str
    mobile: str = "9999999999"
    role: str = "analyst"  # admin, analyst, rm, operations, read_only, compliance
    password: str | None = None  # omitted -> server generates a temporary password
    temp_password: bool = False


class ScreeningRunRequest(BaseModel):
    preset_id: str | None = None
    filters: dict[str, Any] = Field(default_factory=dict)


class ScreeningPresetCreateRequest(BaseModel):
    name: str
    filters: dict[str, Any] = Field(default_factory=dict)
