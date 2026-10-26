from __future__ import annotations
"""Advisorkhoj public research parser for fund quartile data.

Operates strictly within robots.txt Allow rules (no Disallow/admin/ajax paths).
UA: FundHorizon-Backoffice/1.0 (internal-research).
Graceful fallback to computed quartiles on any block, timeout, or layout change.
"""

import logging
import re
import time
import urllib.robotparser

import httpx
from bs4 import BeautifulSoup

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


QUARTILE_PATH = "/mutual-funds-research/quartile-ranking"
ANNUAL_PATH = "/mutual-funds-research/quartile-ranking-annual-returns"  # calendar-year quartiles; no period param
QUARTILE_PERIODS = ("1y", "2y", "3y", "4y", "5y", "10y")
QUARTILE_PLANS = ("Direct", "Regular")
_QUARTILE_TTL = 24 * 3600
_quartile_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}


def fetch_quartile_table(category: str, period: str, plan: str, client: httpx.Client | None = None, path: str = QUARTILE_PATH) -> dict:
    """Quartile-ranking table for one category/period/plan, parsed from the public page (server-rendered, 24h cache).

    Returns ``{"categories": [...], "columns": [...], "rows": [[...]], "links": [...], "fetched_at": "<ISO UTC time>"}``;
    ``rows`` is empty when Advisorkhoj has no data for the combination (it currently publishes nothing for Direct plans).
    ``fetched_at`` is the time of the fresh fetch; a cache hit returns the original ``fetched_at``, not the time of
    the cache-hit call. Raises ``RuntimeError`` when robots.txt disallows the path or the page is blocked / unreachable.
    """
    from datetime import UTC, datetime

    key = (category, period, plan)
    hit = _quartile_cache.get(key)
    if hit and time.time() - hit[0] < _QUARTILE_TTL:
        if "fetched_at" not in hit[1]:
            # Entries cached before fetched_at existed: derive it from the
            # cache timestamp so a hit still reports the original fetch time.
            hit[1]["fetched_at"] = datetime.fromtimestamp(hit[0], tz=UTC).isoformat()
        return hit[1]
    prov = AdvisorkhojProvider(client)
    if not prov.check_robots_allowed(path):
        raise RuntimeError("Advisorkhoj robots.txt disallows this path")
    resp = prov._client.get(
        ADVISORKHOJ_BASE_URL + path,
        params={"category": category, "scheme_plan_type": plan} | ({"period": period} if path == QUARTILE_PATH else {}),
        headers={"User-Agent": ADVISORKHOJ_UA},
        timeout=20.0,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Advisorkhoj HTTP {resp.status_code}")
    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table", id="tbl_scheme_returns")
    if table is None:
        raise RuntimeError("Advisorkhoj layout changed: quartile table not found")
    cats = [o["value"] for o in soup.select("#sel_schemeCategories option, #sel_category option") if o.get("value")]
    if cats and category not in cats:
        raise ValueError("Unknown category")
    columns = [th.get_text(" ", strip=True) for th in table.select("thead th")]
    rows, links = [], []
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if len(tds) != len(columns):
            continue
        rows.append([td.get_text(" ", strip=True) for td in tds])
        a = tds[0].find("a")
        links.append(ADVISORKHOJ_BASE_URL + a["href"] if a and a.get("href", "").startswith("/") else None)
    out = {
        "categories": cats,
        "columns": columns,
        "rows": rows,
        "links": links,
        "fetched_at": datetime.now(UTC).isoformat(),
    }
    _quartile_cache[key] = (time.time(), out)
    return out


def fetch_quartile_annual(category: str, plan: str, client: httpx.Client | None = None) -> dict:
    """Calendar-year quartile table (2016..YTD) for one category/plan; same shape and cache as ``fetch_quartile_table``."""
    return fetch_quartile_table(category, "annual", plan, client, path=ANNUAL_PATH)
