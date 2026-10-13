"""AMFI India NAV provider.

Parses official AMFI NAV bulk text file (NAVAll.txt), supporting both:
- 8-column format with ISIN/Plan/Option
- Historical 6-column format
- Explicit header matching and normalization
- Date normalization to YYYY-MM-DD
- Strict validation of positive NAV values and rejecting corrupted rows
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import UTC, datetime
from typing import Any

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.amfi")

AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"


def parse_amfi_date(raw_date: str) -> str:
    """Parse AMFI date formats (e.g. 09-Oct-2026, 09-10-2026, 2026-10-09) to YYYY-MM-DD."""
    raw_date = raw_date.strip()
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw_date, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    raise ValueError(f"Invalid AMFI date format: {raw_date}")


class AmfiProvider(BaseProvider):
    """AMFI bulk NAV file collector."""

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_AMFI",
            name="AMFI India NAV",
            official_url=AMFI_URL,
            supported_frequency="daily",
            requires_api_key=False,
            is_manual_only=False,
            terms_attribution="Association of Mutual Funds in India (AMFI) daily public NAV disclosure",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        try:
            res = self._http_get_with_retry(AMFI_URL)
            if res.status_code != 200:
                return FetchResult(
                    success=False,
                    status="unavailable",
                    error_message=f"AMFI responded with HTTP {res.status_code}",
                )
            return self.parse_content(res.text)
        except Exception as e:
            logger.error(f"Failed to fetch AMFI NAV file: {e}")
            return FetchResult(
                success=False,
                status="unavailable",
                error_message=str(e),
            )

    def parse_content(self, text_content: str) -> FetchResult:
        """Parse raw AMFI NAVAll.txt content into normalized observations."""
        lines = text_content.strip().splitlines()
        if not lines:
            return FetchResult(success=False, status="schema_error", error_message="Empty file")

        observations: list[NormalizedObservation] = []
        schemes_meta: list[dict[str, Any]] = []

        header_indices: dict[str, int] = {}
        header_found = False
        current_category = ""
        current_amc = ""
        sample_source_date = None

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue

            # Detect section headers
            if ";" not in line:
                if "Schemes" in line:
                    current_category = line
                elif line:
                    current_amc = line
                continue

            parts = [p.strip() for p in line.split(";")]

            # Look for header line
            norm_parts = [p.lower().replace(" ", "").replace("_", "") for p in parts]
            if "schemecode" in norm_parts and ("netassetvalue" in norm_parts or "nav" in norm_parts):
                header_found = True
                header_indices = {}
                for idx, col in enumerate(norm_parts):
                    if "schemecode" in col:
                        header_indices["code"] = idx
                    elif "schemename" in col:
                        header_indices["name"] = idx
                    elif "netassetvalue" in col or col == "nav":
                        header_indices["nav"] = idx
                    elif "date" in col:
                        header_indices["date"] = idx
                    elif "growth" in col or "isin" in col:
                        header_indices.setdefault("isin", idx)
                    elif "plan" in col:
                        header_indices["plan"] = idx
                    elif "option" in col:
                        header_indices["option"] = idx
                continue

            if not header_found:
                continue

            # Data row
            try:
                code_idx = header_indices.get("code", 0)
                nav_idx = header_indices.get("nav")
                date_idx = header_indices.get("date")

                if code_idx >= len(parts) or nav_idx is None or nav_idx >= len(parts):
                    continue

                scheme_code = parts[code_idx].strip()
                if not scheme_code.isdigit():
                    continue

                nav_str = parts[nav_idx].strip()
                try:
                    nav_val = float(nav_str)
                except ValueError:
                    # Skip N.A. or invalid NAV rows
                    continue
                if nav_val <= 0:
                    continue

                date_str = parts[date_idx].strip() if date_idx is not None and date_idx < len(parts) else ""
                try:
                    obs_date = parse_amfi_date(date_str) if date_str else datetime.now(UTC).strftime("%Y-%m-%d")
                except ValueError:
                    continue

                if sample_source_date is None:
                    sample_source_date = obs_date

                scheme_name = parts[header_indices["name"]].strip() if "name" in header_indices and header_indices["name"] < len(parts) else ""
                isin = parts[header_indices["isin"]].strip() if "isin" in header_indices and header_indices["isin"] < len(parts) else None

                obs = NormalizedObservation(
                    instrument_id=f"MF:{scheme_code}",
                    observed_at=obs_date,
                    value_numeric=nav_val,
                    frequency="daily",
                    provenance="AMFI",
                    quality_flags="ok",
                )
                observations.append(obs)

                schemes_meta.append({
                    "scheme_code": scheme_code,
                    "scheme_name": scheme_name,
                    "amc": current_amc,
                    "category": current_category,
                    "isin": isin,
                    "latest_nav": nav_val,
                    "latest_nav_date": obs_date,
                })
            except Exception:
                continue

        if not observations:
            return FetchResult(
                success=False,
                status="schema_error",
                error_message="No valid NAV observations parsed from file",
            )

        return FetchResult(
            success=True,
            status="ready",
            observations=observations,
            source_timestamp=sample_source_date,
            metadata={"schemes": schemes_meta, "count": len(observations)},
        )
