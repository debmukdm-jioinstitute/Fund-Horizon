from __future__ import annotations
"""Cboe VIX Historical Volatility Provider.

URL: https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv
Parses daily close observations of the Cboe Volatility Index (VIX).
Note: This historical file represents official daily closes, not a live streaming feed.
"""

import csv
import io
import logging
from datetime import datetime

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.cboe")

CBOE_VIX_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"


def parse_cboe_date(raw_date: str) -> str:
    """Parse MM/DD/YYYY or YYYY-MM-DD date."""
    raw_date = raw_date.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d-%b-%Y"):
        try:
            return datetime.strptime(raw_date, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    raise ValueError(f"Unknown Cboe date format: {raw_date}")


class CboeProvider(BaseProvider):
    """Cboe VIX index collector."""

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_CBOE",
            name="Cboe Volatility Index History",
            official_url=CBOE_VIX_URL,
            supported_frequency="daily",
            requires_api_key=False,
            is_manual_only=False,
            terms_attribution="Cboe Global Markets official published daily closing price histories",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        try:
            res = self._http_get_with_retry(CBOE_VIX_URL)
            if res.status_code != 200:
                return FetchResult(
                    success=False,
                    status="unavailable",
                    error_message=f"Cboe returned HTTP {res.status_code}",
                )
            return self.parse_csv(res.text)
        except Exception as e:
            logger.error(f"Failed to fetch Cboe VIX: {e}")
            return FetchResult(
                success=False,
                status="unavailable",
                error_message=str(e),
            )

    def parse_csv(self, csv_content: str, max_recent_rows: int = 500) -> FetchResult:
        reader = csv.DictReader(io.StringIO(csv_content))
        if not reader.fieldnames:
            return FetchResult(success=False, status="schema_error", error_message="Empty CSV header")

        header_map = {f.strip().upper(): f for f in reader.fieldnames}
        date_col = header_map.get("DATE")
        close_col = header_map.get("CLOSE")

        if not date_col or not close_col:
            return FetchResult(
                success=False,
                status="schema_error",
                error_message=f"Expected DATE and CLOSE columns, found: {reader.fieldnames}",
            )

        observations: list[NormalizedObservation] = []
        for row in reader:
            try:
                raw_close = float(row[close_col].strip())
                if raw_close <= 0:
                    continue
                obs_date = parse_cboe_date(row[date_col])
                observations.append(
                    NormalizedObservation(
                        instrument_id="VOL:US:VIX",
                        observed_at=obs_date,
                        value_numeric=raw_close,
                        frequency="daily",
                        provenance="Cboe",
                        quality_flags="ok",
                    )
                )
            except Exception:
                continue

        if not observations:
            return FetchResult(success=False, status="schema_error", error_message="No valid VIX rows parsed")

        # Keep observations sorted by date descending for quick access
        observations.sort(key=lambda o: o.observed_at, reverse=True)
        trimmed = observations[:max_recent_rows] if max_recent_rows > 0 else observations

        latest_date = trimmed[0].observed_at if trimmed else None
        return FetchResult(
            success=True,
            status="ready",
            observations=trimmed,
            source_timestamp=latest_date,
            metadata={"total_parsed": len(observations), "retained": len(trimmed)},
        )
