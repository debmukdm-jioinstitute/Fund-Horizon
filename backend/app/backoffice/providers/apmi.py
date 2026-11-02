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

from bs4 import BeautifulSoup
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

_KNOWN_HEADERS = {
    "investment approach details",
    "pms provider name",
    "benchmark",
    "strategy name",
    "product name",
    "date of inception",
    "age",
    "min. inv. amount",
    "min. inv amount",
    "fixed fees structure",
    "variable fees structure",
    "exit load",
    "purpose",
    "fund manager details",
    "work exp.",
    "email id",
    "mobile no",
    "details",
    "1 month turnover",
    "1 year turnover",
    "turnover details",
}

PMS_CURATED_FEES: dict[str, dict[str, str]] = {
    # 9 Monitored Flagship PMS Strategies
    "1193": {  # Carnelian Capital Compounder Strategy
        "fixed_fees": "2.50% p.a.",
        "variable_fees": "15% profit sharing above 8% hurdle (High Water Mark)",
        "exit_load": "1% if redeemed within 1st year, Nil thereafter",
    },
    "781": {  # ICICI Prudential PMS Value Strategy
        "fixed_fees": "2.25% p.a.",
        "variable_fees": "15% profit sharing above 10% hurdle (High Water Mark)",
        "exit_load": "1% if redeemed within 1st year, Nil thereafter",
    },
    "2512": {  # Abakkus Emerging Opportunities Approach
        "fixed_fees": "Up to 2.50% p.a.",
        "variable_fees": "15% - 20% profit sharing above 10% hurdle (High Water Mark)",
        "exit_load": "Year 1: 3% · Year 2: 2% · Year 3: 1% · Nil thereafter",
    },
    "731": {  # 360 ONE Multicap PMS
        "fixed_fees": "2.50% p.a.",
        "variable_fees": "Nil (Fixed fee plan; variable options per client agreement)",
        "exit_load": "Year 1: 3% · Year 2: 2% · Year 3: 1% · Nil thereafter",
    },
    "606": {  # Buoyant Opportunities PMS
        "fixed_fees": "2.00% p.a.",
        "variable_fees": "17.5% profit sharing above 10% hurdle",
        "exit_load": "0% (Nil)",
    },
    "174": {  # Stallion Asset Core Fund
        "fixed_fees": "Plan A: 2.50% p.a. · Plan B: 1.50% p.a.",
        "variable_fees": "Plan B: 15% profit sharing above 10% hurdle",
        "exit_load": "2% within 12 months, Nil thereafter",
    },
    "325": {  # Sundaram S.E.L.F
        "fixed_fees": "2.50% p.a.",
        "variable_fees": "1.50% fixed + 20% profit sharing above 10% hurdle",
        "exit_load": "1% within 1st year, Nil thereafter",
    },
    "324": {  # Sundaram SISOP
        "fixed_fees": "2.50% p.a.",
        "variable_fees": "1.50% fixed + 20% profit sharing above 10% hurdle",
        "exit_load": "1% within 1st year, Nil thereafter",
    },
    "327": {  # Sundaram Rising Star
        "fixed_fees": "2.50% p.a.",
        "variable_fees": "1.50% fixed + 20% profit sharing above 10% hurdle",
        "exit_load": "1% within 1st year, Nil thereafter",
    },
    # Additional Top Universe PMS Strategies
    "141": {  # Enam India Equity Portfolio
        "fixed_fees": "Up to 2.50% p.a.",
        "variable_fees": "Nil (Standard Fixed Plan)",
        "exit_load": "Nil",
    },
    "136": {  # Enam India Core Equity Portfolio
        "fixed_fees": "Up to 2.50% p.a.",
        "variable_fees": "Nil (Standard Fixed Plan)",
        "exit_load": "Nil",
    },
    "709": {  # Q India Value Equity Strategy - Constrained V
        "fixed_fees": "Up to 2.50% p.a.",
        "variable_fees": "15% profit sharing above hurdle (BSE 200 + 1%)",
        "exit_load": "Nil",
    },
    "1194": {  # Carnelian Shift Strategy
        "fixed_fees": "2.50% p.a.",
        "variable_fees": "15% profit sharing above 8% hurdle (High Water Mark)",
        "exit_load": "1% within 1st year, Nil thereafter",
    },
    "2510": {  # Abakkus All Cap Approach
        "fixed_fees": "Up to 2.50% p.a.",
        "variable_fees": "15% - 20% profit sharing above 10% hurdle (High Water Mark)",
        "exit_load": "Year 1: 3% · Year 2: 2% · Year 3: 1% · Nil thereafter",
    },
    "713": {  # ICICI Prudential PMS Contra Strategy
        "fixed_fees": "2.25% p.a.",
        "variable_fees": "15% profit sharing above 10% hurdle (High Water Mark)",
        "exit_load": "1% within 1st year, Nil thereafter",
    },
    "722": {  # ICICI Prudential PMS PIPE Strategy
        "fixed_fees": "2.25% p.a.",
        "variable_fees": "15% profit sharing above 10% hurdle (High Water Mark)",
        "exit_load": "1% within 1st year, Nil thereafter",
    },
    "110": {  # ValueQuest Alpha
        "fixed_fees": "2.00% - 2.50% p.a.",
        "variable_fees": "15% profit sharing above 10% hurdle",
        "exit_load": "Year 1: 2% · Year 2: 1% · Nil thereafter",
    },
    "340": {  # Unifi Capital BLENDED- RANGOLI
        "fixed_fees": "2.00% - 2.50% p.a.",
        "variable_fees": "15% - 20% profit sharing above 10% hurdle",
        "exit_load": "Year 1: 2% · Year 2: 1% · Nil thereafter",
    },
    "481": {  # Alchemy Select Stock
        "fixed_fees": "2.00% - 2.50% p.a.",
        "variable_fees": "15% profit sharing above 10% hurdle",
        "exit_load": "Year 1: 3% · Year 2: 2% · Year 3: 1% · Nil thereafter",
    },
}


def _clean_text(value: str, preserve_lines: bool = False) -> str:
    for bad, good in _MOJIBAKE:
        value = value.replace(bad, good)
    value = re.sub(r"[\u00c3\u00c2]\??", "", value)  # stray mojibake lead bytes
    if preserve_lines:
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.splitlines()]
        return "\n".join(l for l in lines if l).strip()
    return re.sub(r"\s+", " ", value).strip()


def _tokens(page_html: str) -> list[str]:
    stripped = _SCRIPT_STYLE_RE.sub("", page_html)
    parts = (html.unescape(p).replace("\xa0", " ").strip() for p in re.split(r"<[^>]+>", stripped))
    return [t for t in parts if t]


def _after(tokens: list[str], label: str, start: int = 0) -> tuple[str | None, int]:
    """Value token following ``label`` (exact match), plus the label's index. Never consumes a known header."""
    lbl_lower = label.lower()
    for i in range(start, len(tokens)):
        if tokens[i].rstrip(":").strip().lower() == lbl_lower:
            if i + 1 < len(tokens):
                nxt = tokens[i + 1].rstrip(":").strip().lower()
                if nxt not in _KNOWN_HEADERS and not nxt.startswith("turnover details as on"):
                    return tokens[i + 1], i
            return None, i
    return None, -1


def _is_corrupt_fee_value(val: Any) -> bool:
    if not isinstance(val, str):
        return False
    v = val.rstrip(":").strip().lower()
    return v in _KNOWN_HEADERS or any(v.startswith(h) for h in ("turnover details as on",))


def _na(value: str | None, preserve_lines: bool = False) -> str | None:
    value = _clean_text(value or "", preserve_lines=preserve_lines)
    if not value or value.upper() in {"NA", "N/A", "NIL", "-"}:
        return None
    if _is_corrupt_fee_value(value):
        return None
    return value


def enrich_strategy_fees(detail: dict[str, Any], ia_id: str | None = None) -> bool:
    """Sanitize shifted/corrupt fee labels and enrich missing fee disclosures from curated records.

    Returns True if detail was modified.
    """
    if not isinstance(detail, dict):
        return False

    modified = False

    # 1. Clean up corrupt shifted headers
    for k in ("fixed_fees", "variable_fees", "exit_load"):
        if _is_corrupt_fee_value(detail.get(k)):
            detail[k] = None
            modified = True

    # 2. Curated lookup by ia_id
    curated = PMS_CURATED_FEES.get(str(ia_id)) if ia_id else None

    # Fallback to name pattern match if no ia_id match
    if not curated and detail.get("strategy_name"):
        name_lower = detail["strategy_name"].strip().lower()
        if "carnelian" in name_lower and "compounder" in name_lower:
            curated = PMS_CURATED_FEES.get("1193")
        elif "icici" in name_lower and "value" in name_lower:
            curated = PMS_CURATED_FEES.get("781")
        elif "abakkus" in name_lower and "emerging" in name_lower:
            curated = PMS_CURATED_FEES.get("2512")
        elif "360 one" in name_lower and "multicap" in name_lower:
            curated = PMS_CURATED_FEES.get("731")
        elif "buoyant" in name_lower:
            curated = PMS_CURATED_FEES.get("606")
        elif "stallion" in name_lower and "core" in name_lower:
            curated = PMS_CURATED_FEES.get("174")

    if curated:
        for k in ("fixed_fees", "variable_fees", "exit_load"):
            if not detail.get(k) and curated.get(k):
                detail[k] = curated[k]
                modified = True

    return modified


def parse_strategy_detail(page_html: str) -> dict[str, Any] | None:
    """Facts shown on an APMI strategy page. Personal contact details of fund managers are deliberately not kept."""
    tokens = _tokens(page_html)
    if "Investment Approach Details" not in tokens:
        return None
    idx = tokens.index("Investment Approach Details")
    title = next((t for t in reversed(tokens[:idx]) if t not in {"Export To PDF", "IA Insight REPORT", "IA Insight Report"}), None)

    # DOM-aware extraction for table/form cells
    soup = BeautifulSoup(page_html, "html.parser")
    dom_fields: dict[str, str] = {}
    for elem in soup.find_all(["label", "td", "th"]):
        raw_lbl = elem.get_text(strip=True).rstrip(":").strip().lower()
        if not raw_lbl or raw_lbl in dom_fields:
            continue
        val_text = None
        if elem.name in ("td", "th"):
            nxt = elem.find_next_sibling("td")
            if nxt:
                val_text = nxt.get_text(separator="\n", strip=True)
        else:
            p = elem.parent.find("p") if elem.parent else None
            if p:
                val_text = p.get_text(separator="\n", strip=True)
            else:
                nxt = elem.find_next_sibling()
                if nxt and nxt.name in ("p", "div", "span"):
                    val_text = nxt.get_text(separator="\n", strip=True)
        if val_text is not None:
            dom_fields[raw_lbl] = val_text

    def val(label: str, preserve_lines: bool = False) -> str | None:
        lbl_lower = label.lower()
        if lbl_lower in dom_fields:
            return _na(dom_fields[lbl_lower], preserve_lines=preserve_lines)
        v, _ = _after(tokens, label, idx)
        return _na(v, preserve_lines=preserve_lines)

    aum_match = next((_num(t) for t in tokens[idx:idx + 6] if t.startswith("₹")), None)

    # Purpose runs until the next section header.
    purpose = val("Purpose")
    if not purpose:
        _, p_i = _after(tokens, "Purpose", idx)
        if p_i >= 0:
            end = next((j for j in range(p_i + 1, len(tokens)) if tokens[j] in {"Fund Manager Details", "Turnover Details"}), len(tokens))
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

    min_inv = val("Min. Inv. Amount") or val("Min. Inv Amount")
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
        "fixed_fees": val("Fixed Fees Structure", preserve_lines=True),
        "variable_fees": val("Variable Fees Structure", preserve_lines=True),
        "exit_load": val("Exit Load", preserve_lines=True),
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
        detail = parse_strategy_detail(res.content.decode("utf-8", errors="replace"))
        if detail:
            enrich_strategy_fees(detail, ia_id)
        return detail
