"""Federal Reserve Bank of St. Louis (FRED) API Provider.

Documentation: https://fred.stlouisfed.org/docs/api/fred/
Requires a free registration API key (`FRED_API_KEY`).
If the key is not set, the provider reports status `needs_key` and does not make network calls.

Series:
- DGS10: 10-Year Treasury Constant Maturity Rate
- DGS2: 2-Year Treasury Constant Maturity Rate
- DGS30: 30-Year Treasury Constant Maturity Rate
- DTWEXBGS: Trade Weighted U.S. Dollar Index (Broad Goods and Services) - Broad Dollar Proxy (NEVER DXY)
"""
from __future__ import annotations

import logging
import os

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.fred")

FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations"

FRED_SERIES_MAP = {
    "DGS10": ("YIELD:US:10Y", "percent"),
    "DGS2": ("YIELD:US:2Y", "percent"),
    "DGS30": ("YIELD:US:30Y", "percent"),
    "DTWEXBGS": ("MACRO:US:BROAD_USD", "index_pts"),
    # India (OECD via FRED, monthly): fallback when the daily scraped curve is unavailable.
    "INDIRLTLT01STM": ("YIELD:IN:10Y", "percent"),
    "INDIR3TIB01STM": ("YIELD:IN:3M", "percent"),
}
# Series collected on every FRED refresh (US yields come from the keyless Treasury feed instead).
FRED_REFRESH_SERIES = ("DTWEXBGS", "INDIRLTLT01STM", "INDIR3TIB01STM")
MONTHLY_SERIES = {"INDIRLTLT01STM", "INDIR3TIB01STM"}


class FredProvider(BaseProvider):
    """FRED macroeconomic & treasury yield provider."""

    def __init__(self, api_key: str | None = None) -> None:
        super().__init__()
        self.api_key = api_key or os.environ.get("FRED_API_KEY", "").strip()

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_FRED",
            name="Federal Reserve Economic Data (FRED)",
            official_url="https://fred.stlouisfed.org/docs/api/fred/",
            supported_frequency="daily",
            requires_api_key=True,
            is_manual_only=False,
            terms_attribution="Federal Reserve Bank of St. Louis Economic Data (FRED API)",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        if not self.api_key:
            return FetchResult(
                success=False,
                status="needs_key",
                error_message="FRED_API_KEY is not configured. Register free at https://fred.stlouisfed.org/docs/api/api_key.html",
            )

        series_id = cursor or "DGS10"
        return self.fetch_series(series_id)

    def fetch_all(self) -> FetchResult:
        """Fetch every series in ``FRED_REFRESH_SERIES``; succeeds if at least one series returns data."""
        merged: list[NormalizedObservation] = []
        last_error: FetchResult | None = None
        for series_id in FRED_REFRESH_SERIES:
            res = self.fetch_series(series_id)
            if res.success:
                merged.extend(res.observations)
            else:
                last_error = res
                if res.status == "needs_key":
                    return res
        if not merged:
            return last_error or FetchResult(success=False, status="unavailable", error_message="No FRED data")
        latest = max(o.observed_at for o in merged)
        return FetchResult(success=True, status="ready", observations=merged, source_timestamp=latest)

    def fetch_series(self, series_id: str, limit: int = 100) -> FetchResult:
        if not self.api_key:
            return FetchResult(
                success=False,
                status="needs_key",
                error_message="FRED_API_KEY is not configured",
            )

        if series_id not in FRED_SERIES_MAP:
            return FetchResult(
                success=False,
                status="schema_error",
                error_message=f"Unsupported FRED series: {series_id}",
            )

        inst_id, _ = FRED_SERIES_MAP[series_id]
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": limit,
        }

        try:
            res = self._client.get(FRED_API_BASE, params=params)
            if res.status_code == 400 and "api_key" in res.text:
                return FetchResult(success=False, status="needs_key", error_message="Invalid FRED API key")
            if res.status_code != 200:
                return FetchResult(success=False, status="unavailable", error_message=f"FRED HTTP {res.status_code}")

            data = res.json()
            raw_obs = data.get("observations", [])
            observations: list[NormalizedObservation] = []

            for item in raw_obs:
                val_str = item.get("value", "").strip()
                if val_str in ("", ".", "ND"):
                    continue
                try:
                    val = float(val_str)
                    obs_date = item["date"]
                    observations.append(
                        NormalizedObservation(
                            instrument_id=inst_id,
                            observed_at=obs_date,
                            value_numeric=val,
                            frequency="monthly" if series_id in MONTHLY_SERIES else "daily",
                            provenance="FRED",
                            quality_flags="ok",
                        )
                    )
                except (ValueError, KeyError):
                    continue

            latest_date = observations[0].observed_at if observations else None
            return FetchResult(
                success=True,
                status="ready",
                observations=observations,
                source_timestamp=latest_date,
                metadata={"series_id": series_id, "count": len(observations)},
            )
        except Exception as e:
            logger.error(f"FRED fetch failed for {series_id}: {e}")
            return FetchResult(success=False, status="unavailable", error_message=str(e))
