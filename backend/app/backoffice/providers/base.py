"""Base provider contract, HTTP client pooling, and normalized data shapes."""
from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger("backoffice.providers")

DEFAULT_TIMEOUT = 15.0
MAX_RESPONSE_BYTES = 25 * 1024 * 1024  # 25 MB max body size


@dataclass
class ProviderCapabilities:
    source_id: str
    name: str
    official_url: str
    supported_frequency: str  # intraday, daily, monthly, quarterly
    requires_api_key: bool = False
    is_manual_only: bool = False
    terms_attribution: str = ""


@dataclass
class NormalizedObservation:
    instrument_id: str
    observed_at: str  # YYYY-MM-DD or ISO timestamp
    value_numeric: float | None = None
    value_text: str | None = None
    frequency: str = "daily"
    vintage: str = "initial"
    provenance: str = "automated"
    quality_flags: str = "ok"
    reference_period: str | None = None
    published_at: str | None = None
    raw_hash: str | None = None


@dataclass
class FetchResult:
    success: bool
    status: str  # ready, needs_key, manual_only, schema_error, unavailable, blocked
    observations: list[NormalizedObservation] = field(default_factory=list)
    source_timestamp: str | None = None
    fetched_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class BaseProvider(ABC):
    """Abstract base class for all backoffice data providers."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(DEFAULT_TIMEOUT, connect=10.0),
            headers={"User-Agent": "FundHorizon-Backoffice/1.0 (internal-research)"},
            follow_redirects=True,
        )

    @abstractmethod
    def capabilities(self) -> ProviderCapabilities:
        ...

    @abstractmethod
    def fetch(self, cursor: str | None = None) -> FetchResult:
        ...

    def _http_get_with_retry(self, url: str, headers: dict[str, str] | None = None, max_retries: int = 2) -> httpx.Response:
        """GET with bounded retries for transient HTTP errors."""
        last_exc: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                res = self._client.get(url, headers=headers)
                if res.status_code in (429, 502, 503, 504) and attempt < max_retries:
                    retry_after = res.headers.get("Retry-After")
                    sleep_s = float(retry_after) if retry_after and retry_after.isdigit() else 1.0 * (attempt + 1)
                    time.sleep(min(sleep_s, 5.0))
                    continue
                return res
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                last_exc = e
                if attempt < max_retries:
                    time.sleep(1.0 * (attempt + 1))
                    continue
                raise
        if last_exc:
            raise last_exc
        raise RuntimeError(f"Failed to fetch {url}")
