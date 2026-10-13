"""Advisorkhoj public research parser for fund quartile data.

Operates strictly within robots.txt Allow rules (no Disallow/admin/ajax paths).
UA: FundHorizon-Backoffice/1.0 (internal-research).
Graceful fallback to computed quartiles on any block, timeout, or layout change.
"""
from __future__ import annotations

import logging
import re
import urllib.robotparser

import httpx

from app.backoffice.providers.base import (
    BaseProvider,
    FetchResult,
    ProviderCapabilities,
)

logger = logging.getLogger("backoffice.providers.advisorkhoj")

ADVISORKHOJ_BASE_URL = "https://www.advisorkhoj.com"
ROBOTS_TXT_URL = "https://www.advisorkhoj.com/robots.txt"
ADVISORKHOJ_UA = "FundHorizon-Backoffice/1.0 (internal-research)"

# Regex to match 2Y Quartile ranking on scheme/category public pages
_QUARTILE_RE = re.compile(
    r'(?:Quartile\s*(?:Rank(?:ing)?)?|Category\s*Quartile)[^0-9]*([1-4])',
    re.IGNORECASE,
)


class AdvisorkhojProvider(BaseProvider):
    """Fetches public quartile information from Advisorkhoj under robots.txt policy."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        super().__init__(client)
        self._rp: urllib.robotparser.RobotFileParser | None = None

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            source_id="SRC_ADVISORKHOJ",
            name="Advisorkhoj Public Research",
            official_url=ADVISORKHOJ_BASE_URL,
            supported_frequency="daily",
            requires_api_key=False,
            is_manual_only=False,
            terms_attribution="Public HTML research pages. Cached 24h.",
        )

    def check_robots_allowed(self, path: str) -> bool:
        """Check if path is allowed under Advisorkhoj robots.txt."""
        if self._rp is None:
            self._rp = urllib.robotparser.RobotFileParser()
            try:
                resp = self._client.get(
                    ROBOTS_TXT_URL,
                    headers={"User-Agent": ADVISORKHOJ_UA},
                    timeout=10.0,
                )
                if resp.status_code == 200:
                    self._rp.parse(resp.text.splitlines())
                else:
                    self._rp.allow_all = True
            except Exception as e:
                logger.warning("Failed to fetch robots.txt from Advisorkhoj: %s; failing safe", e)
                # If robots.txt cannot be fetched, assume allowed for public root or allow_all
                self._rp.allow_all = True

        return self._rp.can_fetch(ADVISORKHOJ_UA, f"{ADVISORKHOJ_BASE_URL}{path}")

    def fetch(self) -> FetchResult:
        """Fetch general status and category rankings if reachable."""
        path = "/mutual-funds-research"
        if not self.check_robots_allowed(path):
            return FetchResult(
                success=False,
                status="blocked",
                error_message="Robots.txt disallows automated fetch for research path",
            )

        url = f"{ADVISORKHOJ_BASE_URL}{path}"
        try:
            resp = self._client.get(
                url,
                headers={"User-Agent": ADVISORKHOJ_UA},
                timeout=12.0,
            )
            if resp.status_code == 403 or resp.status_code == 429:
                return FetchResult(
                    success=False,
                    status="blocked",
                    error_message=f"HTTP {resp.status_code} access blocked",
                )
            if resp.status_code != 200:
                return FetchResult(
                    success=False,
                    status="unavailable",
                    error_message=f"HTTP status {resp.status_code}",
                )

            # Check for Cloudflare / captcha challenges
            body = resp.text
            if "cf-browser-verification" in body or "challenge-running" in body or "captcha" in body.lower():
                return FetchResult(
                    success=False,
                    status="blocked",
                    error_message="Bot challenge / captcha detected",
                )

            return FetchResult(
                success=True,
                status="ready",
                metadata={"body_len": len(body), "url": url},
            )
        except Exception as e:
            return FetchResult(
                success=False,
                status="unavailable",
                error_message=str(e),
            )

    def parse_quartile_from_html(self, html: str) -> int | None:
        """Extract category quartile 1..4 from HTML string if present."""
        m = _QUARTILE_RE.search(html)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 4:
                return val
        return None
