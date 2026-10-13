"""US Treasury daily par yield curve provider (no API key).

URL: https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all
Official constant-maturity par yields for every published tenor, one row per business day.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import UTC, datetime

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.treasury")

TREASURY_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv"
)

# CSV column -> canonical tenor label used in instrument ids (YIELD:US:<tenor>)
TENOR_COLUMNS = {
    "1 Mo": "1M",
    "2 Mo": "2M",
    "3 Mo": "3M",
    "4 Mo": "4M",
    "6 Mo": "6M",
    "1 Yr": "1Y",
    "2 Yr": "2Y",
    "3 Yr": "3Y",
    "5 Yr": "5Y",
    "7 Yr": "7Y",
    "10 Yr": "10Y",
    "20 Yr": "20Y",
    "30 Yr": "30Y",
}


class TreasuryProvider(BaseProvider):
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_TREASURY",
            name="US Treasury Daily Par Yield Curve",
            official_url="https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
            supported_frequency="daily",
            requires_api_key=False,
            terms_attribution="U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        year = datetime.now(UTC).year
        try:
            res = self._http_get_with_retry(TREASURY_URL.format(year=year))
            if res.status_code != 200:
                return FetchResult(success=False, status="unavailable", error_message=f"Treasury returned HTTP {res.status_code}")
            return self.parse_csv(res.text)
        except Exception as e:  # network errors must not crash the collector
            logger.error("Failed to fetch Treasury yields: %s", e)
            return FetchResult(success=False, status="unavailable", error_message=str(e))

    def parse_csv(self, csv_content: str) -> FetchResult:
        reader = csv.DictReader(io.StringIO(csv_content))
        if not reader.fieldnames or "Date" not in reader.fieldnames:
            return FetchResult(success=False, status="schema_error", error_message="Treasury CSV missing Date column")

        observations: list[NormalizedObservation] = []
        for row in reader:
            try:
                obs_date = datetime.strptime(row["Date"].strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
            except (ValueError, AttributeError):
                continue
            for column, tenor in TENOR_COLUMNS.items():
                raw = (row.get(column) or "").strip()
                if not raw:
                    continue
                try:
                    value = float(raw)
                except ValueError:
                    continue
                observations.append(
                    NormalizedObservation(
                        instrument_id=f"YIELD:US:{tenor}",
                        observed_at=obs_date,
                        value_numeric=value,
                        frequency="daily",
                        provenance="US Treasury",
                    )
                )

        if not observations:
            return FetchResult(success=False, status="schema_error", error_message="No Treasury yield rows parsed")
        latest = max(o.observed_at for o in observations)
        return FetchResult(success=True, status="ready", observations=observations, source_timestamp=latest)
