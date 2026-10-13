"""MFapi provider and divergence validator.

Documentation: https://www.mfapi.in/docs/
Fetches scheme NAV history and detects divergence against official AMFI latest observations.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.mfapi")

BASE_URL = "https://api.mfapi.in/mf"


def parse_mfapi_date(raw_date: str) -> str:
    """Parse DD-MM-YYYY format to YYYY-MM-DD."""
    return datetime.strptime(raw_date.strip(), "%d-%m-%Y").strftime("%Y-%m-%d")


class MfapiProvider(BaseProvider):
    """MFapi historical NAV collector and divergence checker."""

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_MFAPI",
            name="MFapi Scheme History",
            official_url=BASE_URL,
            supported_frequency="daily",
            requires_api_key=False,
            is_manual_only=False,
            terms_attribution="MFapi open community API (AMFI derived)",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        scheme_code = cursor or "119551"  # Default test scheme if no cursor
        return self.fetch_scheme(scheme_code)

    def fetch_scheme(self, scheme_code: str, latest_only: bool = False) -> FetchResult:
        """Fetch scheme details and NAV history."""
        url = f"{BASE_URL}/{scheme_code}/latest" if latest_only else f"{BASE_URL}/{scheme_code}"
        try:
            res = self._http_get_with_retry(url)
            if res.status_code != 200:
                return FetchResult(
                    success=False,
                    status="unavailable",
                    error_message=f"MFapi returned HTTP {res.status_code} for scheme {scheme_code}",
                )
            data = res.json()
            return self.parse_json(scheme_code, data)
        except Exception as e:
            logger.error(f"Failed to fetch scheme {scheme_code} from MFapi: {e}")
            return FetchResult(
                success=False,
                status="unavailable",
                error_message=str(e),
            )

    def parse_json(self, scheme_code: str, data: dict[str, Any]) -> FetchResult:
        meta = data.get("meta", {})
        nav_data = data.get("data", [])
        if not nav_data:
            return FetchResult(
                success=False,
                status="schema_error",
                error_message="No NAV data in response",
            )

        observations: list[NormalizedObservation] = []
        for item in nav_data:
            try:
                raw_nav = float(item["nav"])
                if raw_nav <= 0:
                    continue
                obs_date = parse_mfapi_date(item["date"])
                observations.append(
                    NormalizedObservation(
                        instrument_id=f"MF:{scheme_code}",
                        observed_at=obs_date,
                        value_numeric=raw_nav,
                        frequency="daily",
                        provenance="MFapi",
                        quality_flags="ok",
                    )
                )
            except Exception:
                continue

        source_ts = observations[0].observed_at if observations else None
        return FetchResult(
            success=True,
            status="ready",
            observations=observations,
            source_timestamp=source_ts,
            metadata={"meta": meta, "count": len(observations)},
        )

    @staticmethod
    def check_divergence(
        amfi_nav: float, amfi_date: str, mfapi_nav: float, mfapi_date: str, tolerance_pct: float = 0.05
    ) -> dict[str, Any]:
        """Compare AMFI official NAV with MFapi observation for overlapping date."""
        if amfi_date != mfapi_date:
            return {
                "divergent": False,
                "reason": f"Dates do not match: AMFI={amfi_date}, MFapi={mfapi_date}",
                "diff_pct": None,
            }
        diff_pct = abs(amfi_nav - mfapi_nav) / amfi_nav * 100.0
        divergent = diff_pct > tolerance_pct
        return {
            "divergent": divergent,
            "amfi_nav": amfi_nav,
            "mfapi_nav": mfapi_nav,
            "diff_pct": round(diff_pct, 4),
            "date": amfi_date,
            "flag": "outlier" if divergent else "ok",
        }
