from __future__ import annotations
"""European Central Bank (ECB) Reference Exchange Rates Provider.

Parses daily eurofxref XML feed: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
Computes normalized currency reference pairs with EUR as common base:
- EUR/USD = USD_per_EUR
- USD/INR = INR_per_EUR / USD_per_EUR
- GBP/USD = USD_per_EUR / GBP_per_EUR
- USD/JPY = JPY_per_EUR / USD_per_EUR
Reference rates are official reference benchmarks, not executable live bid/ask quotes.
"""

import logging
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.ecb")

ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
ECB_HIST_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"


def compute_cross_rates(raw_rates_per_eur: dict[str, float]) -> dict[str, float]:
    """Compute the 4 canonical FX reference rates using verified ECB conversion formulas."""
    usd = raw_rates_per_eur.get("USD")
    inr = raw_rates_per_eur.get("INR")
    gbp = raw_rates_per_eur.get("GBP")
    jpy = raw_rates_per_eur.get("JPY")

    results: dict[str, float] = {}

    # EUR/USD: USD per EUR
    if usd and usd > 0:
        results["FX:EURUSD"] = usd

    # USD/INR: INR per EUR / USD per EUR
    if inr and usd and usd > 0:
        results["FX:USDINR"] = inr / usd

    # GBP/USD: USD per EUR / GBP per EUR
    if gbp and usd and gbp > 0:
        results["FX:GBPUSD"] = usd / gbp

    # USD/JPY: JPY per EUR / USD per EUR
    if jpy and usd and usd > 0:
        results["FX:USDJPY"] = jpy / usd

    # INR crosses derived from the same ECB euro reference quotes (JPY quoted per 100 yen, the INR market convention).
    if inr:
        results["FX:EURINR"] = inr
        if gbp and gbp > 0:
            results["FX:GBPINR"] = inr / gbp
        if jpy and jpy > 0:
            results["FX:JPYINR"] = inr / jpy * 100

    return results


class EcbProvider(BaseProvider):
    """ECB reference rates collector."""

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_ECB",
            name="ECB Reference FX",
            official_url=ECB_URL,
            supported_frequency="daily",
            requires_api_key=False,
            is_manual_only=False,
            terms_attribution="European Central Bank daily official reference exchange rates",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        """Fetch the last ~90 business days so the impact engine has history, not just today's fixing."""
        try:
            res = self._http_get_with_retry(ECB_HIST_URL)
            if res.status_code == 200:
                hist = self.parse_history_xml(res.text)
                if hist.success:
                    return hist
            res = self._http_get_with_retry(ECB_URL)
            if res.status_code != 200:
                return FetchResult(
                    success=False,
                    status="unavailable",
                    error_message=f"ECB returned HTTP {res.status_code}",
                )
            return self.parse_xml(res.text)
        except Exception as e:
            logger.error(f"Failed to fetch ECB XML: {e}")
            return FetchResult(
                success=False,
                status="unavailable",
                error_message=str(e),
            )

    def parse_history_xml(self, xml_content: str) -> FetchResult:
        """Parse an ECB multi-day feed: one dated Cube per day, each holding that day's currency rates."""
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            return FetchResult(success=False, status="schema_error", error_message=f"XML parse error: {e}")

        observations: list[NormalizedObservation] = []
        latest = ""
        for day in root.iter():
            if day.tag.split("}")[-1] != "Cube" or "time" not in day.attrib:
                continue
            raw: dict[str, float] = {}
            for child in day:
                try:
                    rate = float(child.attrib["rate"])
                    if rate > 0:
                        raw[child.attrib["currency"].upper()] = rate
                except (KeyError, ValueError):
                    continue
            for inst_id, val in compute_cross_rates(raw).items():
                observations.append(
                    NormalizedObservation(
                        instrument_id=inst_id,
                        observed_at=day.attrib["time"],
                        value_numeric=round(val, 6),
                        frequency="daily",
                        provenance="ECB",
                    )
                )
            latest = max(latest, day.attrib["time"])
        if not observations:
            return FetchResult(success=False, status="schema_error", error_message="No dated rates in ECB history")
        return FetchResult(success=True, status="ready", observations=observations, source_timestamp=latest)

    def parse_xml(self, xml_content: str) -> FetchResult:
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            return FetchResult(success=False, status="schema_error", error_message=f"XML parse error: {e}")

        # The XML uses namespaces; find Cube elements
        raw_rates: dict[str, float] = {}
        observed_date = ""

        for cube in root.iter():
            tag = cube.tag.split("}")[-1] if "}" in cube.tag else cube.tag
            if tag == "Cube":
                if "time" in cube.attrib:
                    observed_date = cube.attrib["time"]
                elif "currency" in cube.attrib and "rate" in cube.attrib:
                    try:
                        curr = cube.attrib["currency"].upper()
                        rate = float(cube.attrib["rate"])
                        if rate > 0:
                            raw_rates[curr] = rate
                    except ValueError:
                        continue

        if not observed_date:
            observed_date = datetime.now(UTC).strftime("%Y-%m-%d")

        if not raw_rates:
            return FetchResult(
                success=False,
                status="schema_error",
                error_message="No exchange rates found in ECB payload",
            )

        cross_rates = compute_cross_rates(raw_rates)
        observations: list[NormalizedObservation] = []

        for inst_id, val in cross_rates.items():
            observations.append(
                NormalizedObservation(
                    instrument_id=inst_id,
                    observed_at=observed_date,
                    value_numeric=round(val, 6),
                    frequency="daily",
                    provenance="ECB",
                    quality_flags="ok",
                )
            )

        return FetchResult(
            success=True,
            status="ready",
            observations=observations,
            source_timestamp=observed_date,
            metadata={"raw_rates_count": len(raw_rates), "cross_rates": cross_rates},
        )
