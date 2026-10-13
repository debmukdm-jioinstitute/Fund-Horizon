"""APMI (Association of Portfolio Managers in India) PMS performance collector.

APMI publishes monthly, audited performance for every SEBI-registered portfolio manager's investment approaches at
https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu. The page embeds the full provider list
(select ``pmsProvideName``) and answers a form POST (``action=loadIAReport``) with an HTML table of strategies. One POST
per (strategy type, service type) with *all* provider ids returns the whole industry, so a full refresh is 8 requests.
"""
from __future__ import annotations

import html
import logging
import re
import urllib.parse
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

logger = logging.getLogger("backoffice.providers.apmi")

BASE = "https://www.apmiindia.org/apmi/welcomeiaperformance.htm"
PAGE_URL = f"{BASE}?action=PMSmenu"
REPORT_URL = f"{BASE}?action=loadIAReport"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

STRATEGY_TYPES = ("Equity", "Debt", "Hybrid", "Multi Asset")
SERVICE_TYPES = {"D": "Discretionary", "N": "Non-Discretionary"}

# Column order of the report table after provider name, IA name and AUM.
RETURN_COLUMNS = ("1m", "3m", "6m", "9m", "1y", "2y", "3y", "4y", "5y", "since_inception")

_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_IAID_RE = re.compile(r"IAID=(\d+)")
_SELECT_RE = re.compile(r'<select[^>]*id="pmsProvideName".*?</select>', re.S)
_OPTION_RE = re.compile(r'<option[^>]*value="(\d+)"[^>]*>(.*?)</option>', re.S)


@dataclass
class ApmiSnapshot:
    as_on: str  # YYYY-MM-DD month end
    providers: list[dict[str, Any]]
    strategies: list[dict[str, Any]]


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG_RE.sub("", _COMMENT_RE.sub("", fragment)))).strip()


def _num(raw: str) -> float | None:
    cleaned = raw.replace("₹", "").replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None  # "NA", "--", blank


def parse_providers(page_html: str) -> list[dict[str, Any]]:
    """Every provider in APMI's dropdown: ``[{apmi_id, name}]``."""
    m = _SELECT_RE.search(page_html)
    if not m:
        return []
    return [{"apmi_id": pid, "name": _text(name)} for pid, name in _OPTION_RE.findall(m.group(0)) if _text(name)]


def parse_report(report_html: str, strategy_type: str, service_code: str) -> list[dict[str, Any]]:
    """Parse one ``loadIAReport`` response into strategy rows. Rows that do not look like data rows are skipped."""
    out: list[dict[str, Any]] = []
    for row in _ROW_RE.findall(report_html):
        cells = _TD_RE.findall(row)
        # The 9-month column is only emitted for some report dates; 12 cells means it is absent.
        columns = RETURN_COLUMNS if len(cells) >= 3 + len(RETURN_COLUMNS) else tuple(c for c in RETURN_COLUMNS if c != "9m")
        if len(cells) < 3 + len(columns):
            continue
        provider, strategy = _text(cells[0]), _text(cells[1])
        aum = _num(_text(cells[2]))
        if not provider or not strategy:
            continue
        ia = _IAID_RE.search(cells[1])
        rec: dict[str, Any] = {
            "provider": provider,
            "strategy_name": strategy,
            "ia_id": ia.group(1) if ia else None,
            "strategy_type": strategy_type,
            "service_type": SERVICE_TYPES.get(service_code, service_code),
            "aum_crore": aum,
        }
        for key in RETURN_COLUMNS:
            rec[f"return_{key}"] = None
        for key, cell in zip(columns, cells[3:3 + len(columns)]):
            rec[f"return_{key}"] = _num(_text(cell))
        out.append(rec)
    return out


def month_end(year: int, month: int) -> str:
    nxt = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
    return (nxt - timedelta(days=1)).strftime("%Y-%m-%d")


def candidate_months(now: datetime | None = None, count: int = 4) -> list[str]:
    """Most recent completed month-ends first (APMI publishes with a lag, so older ones are fallbacks)."""
    now = now or datetime.now(UTC)
    y, m = now.year, now.month
    out = []
    for _ in range(count):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(month_end(y, m))
    return out


def _post_report(client: httpx.Client, as_on: str, strategy_type: str, service: str, provider_ids: list[str]) -> str:
    data = urllib.parse.urlencode(
        [("asOnDate", as_on), ("servicetype", service), ("strategyname", strategy_type), ("benchmark", "")]
        + [("pmsProvideName", pid) for pid in provider_ids]
    )
    res = client.post(
        REPORT_URL,
        content=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": PAGE_URL,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    res.raise_for_status()
    return res.text


def fetch_snapshot(months: list[str] | None = None) -> ApmiSnapshot | None:
    """Fetch the full industry snapshot for the newest month that has data. None if APMI is unreachable/empty."""
    with httpx.Client(
        timeout=httpx.Timeout(90.0, connect=15.0), headers={"User-Agent": UA}, follow_redirects=True
    ) as client:
        page = client.get(PAGE_URL)
        page.raise_for_status()
        providers = parse_providers(page.text)
        if not providers:
            return None
        ids = [p["apmi_id"] for p in providers]
        for as_on in months or candidate_months():
            strategies: list[dict[str, Any]] = []
            for stype in STRATEGY_TYPES:
                for service in SERVICE_TYPES:
                    try:
                        strategies += parse_report(_post_report(client, as_on, stype, service, ids), stype, service)
                    except httpx.HTTPError as e:
                        logger.warning("APMI %s/%s/%s failed: %s", as_on, stype, service, e)
            if strategies:
                return ApmiSnapshot(as_on=as_on, providers=providers, strategies=strategies)
    return None
