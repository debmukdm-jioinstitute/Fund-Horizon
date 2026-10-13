"""India G-Sec yield curve scraped from the public Trading Economics India bond page.

There is no free official daily feed (FBIL requires a login), so this reads the server-rendered yield table on
https://tradingeconomics.com/india/government-bond-yield. Scraped data is third-party and may change layout or be
blocked; failures are reported as source health, and the FRED/OECD monthly series acts as the fallback.
"""
from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    NormalizedObservation,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.india_yields")

TE_INDIA_URL = "https://tradingeconomics.com/india/government-bond-yield"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# TE symbol -> canonical tenor label (YIELD:IN:<tenor>)
SYMBOL_TENORS = {
    "GIND3M": "3M",
    "GIND6M": "6M",
    "GIND1Y": "1Y",
    "GIND2Y": "2Y",
    "GIND3Y": "3Y",
    "GIND5Y": "5Y",
    "GIND7Y": "7Y",
    "GIND10YR": "10Y",
    "GIND30Y": "30Y",
}

_ROW_RE = re.compile(r'<tr[^>]*data-symbol="(?P<sym>[A-Z0-9]+):IND"[^>]*>(?P<body>.*?)</tr>', re.S)
_PRICE_RE = re.compile(r'<td[^>]*id="p"[^>]*>\s*(?P<v>[\d.,]+)\s*</td>', re.S)
_DATE_RE = re.compile(r'<td[^>]*id="date"[^>]*>\s*(?P<d>[A-Za-z]{3}/\d{1,2})\s*</td>', re.S)


def _resolve_date(label: str, today: datetime) -> str | None:
    """Turn TE's year-less ``Oct/13`` label into an ISO date, rolling back a year if it would be in the future."""
    try:
        parsed = datetime.strptime(f"{label} {today.year}", "%b/%d %Y")
    except ValueError:
        return None
    if parsed.date() > today.date():
        parsed = parsed.replace(year=today.year - 1)
    return parsed.strftime("%Y-%m-%d")


# Index levels listed in the same table (no date column: stamped with the fetch date).
SYMBOL_INDEXES = {"SENSEX": "INDEX:IN:SENSEX"}


class IndiaYieldsProvider(BaseProvider):
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_IN_YIELDS",
            name="India G-Sec Yields (scraped)",
            official_url=TE_INDIA_URL,
            supported_frequency="daily",
            terms_attribution="Trading Economics public India bond yield page (scraped; indicative OTC interbank quotes)",
        )

    def fetch(self, cursor: str | None = None) -> FetchResult:
        try:
            res = self._client.get(TE_INDIA_URL, headers={"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"})
        except Exception as e:  # network failure
            return FetchResult(success=False, status="unavailable", error_message=str(e))
        if res.status_code in (403, 429):
            return FetchResult(success=False, status="blocked", error_message=f"Source returned HTTP {res.status_code}")
        if res.status_code != 200:
            return FetchResult(success=False, status="unavailable", error_message=f"Source returned HTTP {res.status_code}")
        return self.parse_html(res.text)

    def parse_html(self, html: str, today: datetime | None = None) -> FetchResult:
        today = today or datetime.now(UTC)
        observations: list[NormalizedObservation] = []
        for m in _ROW_RE.finditer(html):
            index_id = SYMBOL_INDEXES.get(m.group("sym"))
            if index_id:
                price = _PRICE_RE.search(m.group("body"))
                try:
                    level = float(price.group("v").replace(",", "")) if price else 0.0
                except ValueError:
                    level = 0.0
                if level > 1000:  # sanity bound for an equity index level
                    observations.append(
                        NormalizedObservation(
                            instrument_id=index_id,
                            observed_at=today.strftime("%Y-%m-%d"),
                            value_numeric=level,
                            frequency="intraday",
                            provenance="TradingEconomics",
                            quality_flags="scraped",
                        )
                    )
                continue
            tenor = SYMBOL_TENORS.get(m.group("sym"))
            if not tenor:
                continue
            price = _PRICE_RE.search(m.group("body"))
            date = _DATE_RE.search(m.group("body"))
            if not price or not date:
                continue
            observed = _resolve_date(date.group("d"), today)
            try:
                value = float(price.group("v").replace(",", ""))
            except ValueError:
                continue
            if observed is None or not 0 < value < 30:  # sanity bound for a sovereign yield in percent
                continue
            observations.append(
                NormalizedObservation(
                    instrument_id=f"YIELD:IN:{tenor}",
                    observed_at=observed,
                    value_numeric=value,
                    frequency="daily",
                    provenance="TradingEconomics",
                    quality_flags="scraped",
                )
            )
        if not observations:
            return FetchResult(
                success=False,
                status="schema_error",
                error_message="India yield table not found; page layout may have changed",
            )
        latest = max(o.observed_at for o in observations)
        return FetchResult(success=True, status="ready", observations=observations, source_timestamp=latest)
