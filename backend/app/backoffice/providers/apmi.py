from __future__ import annotations
"""APMI (Association of Portfolio Managers in India) PMS performance collector.

APMI publishes monthly, audited performance for every SEBI-registered portfolio manager's investment approaches at
https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu. The page embeds the full provider list
(select ``pmsProvideName``) and answers a form POST (``action=loadIAReport``) with an HTML table of strategies. One POST
per (strategy type, service type) with *all* provider ids returns the whole industry, so a full refresh is 8 requests.
"""

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


_MISSING_NUM = {"", "-", "--", "na", "n.a.", "n/a", "nil", "*"}


def _num(raw: str) -> float | None:
    cleaned = raw.replace("₹", "").replace(",", "").strip()
    if cleaned.lower() in _MISSING_NUM:
        return None
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


# --- Strategy detail page (IaInsight.htm?IAID=...) ---------------------------------------------------------

INSIGHT_URL = "https://www.apmiindia.org/apmi/IaInsight.htm"
_SCRIPT_STYLE_RE = re.compile(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", re.S)
_MOJIBAKE = (("Ã?Â¢??", "\u2019"), ("â€™", "\u2019"), ("â€œ", "\u201c"), ("â€\x9d", "\u201d"), ("â€“", "\u2013"))


def _clean_text(value: str) -> str:
    for bad, good in _MOJIBAKE:
        value = value.replace(bad, good)
    value = re.sub(r"[\u00c3\u00c2]\??", "", value)  # stray mojibake lead bytes
    return re.sub(r"\s+", " ", value).strip()


def _tokens(page_html: str) -> list[str]:
    stripped = _SCRIPT_STYLE_RE.sub("", page_html)
    parts = (html.unescape(p).replace("\xa0", " ").strip() for p in re.split(r"<[^>]+>", stripped))
    return [t for t in parts if t]


def _after(tokens: list[str], label: str, start: int = 0) -> tuple[str | None, int]:
    """Value token following ``label`` (exact match), plus the label's index."""
    for i in range(start, len(tokens)):
        if tokens[i].rstrip(":").strip().lower() == label.lower():
            return (tokens[i + 1] if i + 1 < len(tokens) else None), i
    return None, -1


def _na(value: str | None) -> str | None:
    value = _clean_text(value or "")
    return None if not value or value.upper() in {"NA", "N/A", "NIL", "-"} else value


def parse_strategy_detail(page_html: str) -> dict[str, Any] | None:
    """Facts shown on an APMI strategy page. Personal contact details of fund managers are deliberately not kept."""
    tokens = _tokens(page_html)
    if "Investment Approach Details" not in tokens:
        return None
    idx = tokens.index("Investment Approach Details")
    title = next((t for t in reversed(tokens[:idx]) if t not in {"Export To PDF", "IA Insight REPORT", "IA Insight Report"}), None)

    def val(label: str) -> str | None:
        v, _ = _after(tokens, label, idx)
        return _na(v)

    aum_match = next((_num(t) for t in tokens[idx:idx + 6] if t.startswith("₹")), None)

    # Purpose runs until the next section header.
    purpose = None
    _, p_i = _after(tokens, "Purpose", idx)
    if p_i >= 0:
        end = next((j for j in range(p_i + 1, len(tokens)) if tokens[j] == "Fund Manager Details"), len(tokens))
        purpose = _na(" ".join(tokens[p_i + 1:end]))

    manager = manager_exp = None
    _, fm_i = _after(tokens, "Fund Manager Details", idx)
    if fm_i >= 0:
        nxt = tokens[fm_i + 1] if fm_i + 1 < len(tokens) else None
        manager = _na(nxt) if nxt and nxt.lower() not in {"work exp.", "email id", "mobile no", "details"} else None
        manager_exp = _na(_after(tokens, "Work Exp.", fm_i)[0])

    turnover_as_on = None
    for t in tokens:
        m = re.match(r"Turnover Details As On (\d{2}/\d{2}/\d{4})", t)
        if m:
            turnover_as_on = datetime.strptime(m.group(1), "%d/%m/%Y").strftime("%Y-%m-%d")
            break

    inception = val("Date Of Inception")
    if inception:
        try:
            inception = datetime.strptime(inception, "%d/%m/%Y").strftime("%Y-%m-%d")
        except ValueError:
            pass

    min_inv = val("Min. Inv. Amount")
    return {
        "strategy_name": _clean_text(title or ""),
        "aum_crore": aum_match,
        "provider": val("PMS Provider Name"),
        "benchmark": val("Benchmark"),
        "strategy_type": val("Strategy Name"),
        "product_name": val("Product Name"),
        "inception_date": inception,
        "age": val("Age"),
        "min_investment_inr": float(min_inv) if min_inv and re.fullmatch(r"[\d.]+", min_inv) else None,
        "fixed_fees": val("Fixed Fees Structure"),
        "variable_fees": val("Variable Fees Structure"),
        "exit_load": val("Exit Load"),
        "purpose": purpose,
        "fund_manager": manager,
        "fund_manager_experience": manager_exp,
        "turnover_as_on": turnover_as_on,
        "turnover_1m": _num(_after(tokens, "1 Month Turnover", idx)[0] or ""),
        "turnover_1y": _num(_after(tokens, "1 Year Turnover", idx)[0] or ""),
    }


def fetch_strategy_detail(ia_id: str) -> dict[str, Any] | None:
    """Fetch and parse one strategy page. Raises ``httpx.HTTPError`` on network problems; None if unparseable."""
    if not re.fullmatch(r"\d{1,8}", ia_id):
        raise ValueError("invalid IA id")
    with httpx.Client(timeout=httpx.Timeout(45.0, connect=15.0), headers={"User-Agent": UA}, follow_redirects=True) as client:
        res = client.get(INSIGHT_URL, params={"IAID": ia_id})
        res.raise_for_status()
        return parse_strategy_detail(res.content.decode("utf-8", errors="replace"))
