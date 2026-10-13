"""Official factsheet discovery for FH Recommended funds and PMS strategies.

Every record points at the publisher's own PDF. A candidate only counts when the server answers 200 with a PDF
content-type, so a guessed URL can never produce a fake entry. Three discovery styles:

* ``templates``: dated URL patterns tried for each recent month.
* ``listing``: the publisher's static listing page is scraped for PDF links.
* ``fixed``: one URL that is overwritten every release; each new version (by Last-Modified) is archived to disk so
  history accumulates from the first pull.
"""
from __future__ import annotations

import calendar
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin

import httpx

logger = logging.getLogger(__name__)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
MONTHS.update({name.lower(): i for i, name in enumerate(calendar.month_abbr) if name})
_PERIOD_RE = re.compile(r"(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)[\W_]*(20\d\d)", re.I)


@dataclass(frozen=True)
class Source:
    key: str
    label: str
    kind: str  # "mf" | "pms"
    templates: tuple[str, ...] = ()
    listing_url: str | None = None
    listing_pattern: str | None = None  # regex with one group: the PDF href
    fixed_url: str | None = None
    links_file: bool = False  # links come from the CI browser scraper (data/factsheet_links/browser.json)
    doc_label: str = "factsheet"
    notes: str = ""


@dataclass
class Found:
    period: str  # YYYY-MM, or YYYY-MM-DD for fixed-URL versions
    title: str
    url: str
    size_bytes: int | None = None
    sha256: str | None = None
    archived_path: str | None = None


SOURCES: dict[str, Source] = {s.key: s for s in (
    Source("dsp", "DSP Mutual Fund", "mf", templates=("https://www.dspim.com/downloads/dsp-factsheet-{lmonth}-{y}.pdf",)),
    Source("invesco", "Invesco Mutual Fund", "mf", templates=(
        "https://www.invescomutualfund.com/docs/default-source/factsheet/invesco-mf-factsheet-{lmonth}-{y}.pdf",
        "https://www.invescomutualfund.com/docs/default-source/factsheet/invesco-factsheet-{lmonth}-{y}.pdf")),
    Source("kotak", "Kotak Mutual Fund", "mf", templates=("https://www.kotakmf.com/factsheet/{month}_{y}/Kotak%20MF%20Factsheet%20{month}%20{y}.pdf",)),
    Source("hsbc", "HSBC Mutual Fund", "mf", templates=("https://www.assetmanagement.hsbc.co.in/-/media/Files/attachments/india/mutual-funds/factsheet/the-asset-{lmonth}-{y}.pdf",)),
    Source("hdfc", "HDFC Mutual Fund", "mf", templates=(
        "https://files.hdfcfund.com/s3fs-public/{ny}-{nm}/HDFC%20MF%20Factsheet%20-%20{month}%20{y}.pdf",
        "https://files.hdfcfund.com/s3fs-public/{y}-{mm}/HDFC%20MF%20Factsheet%20-%20{month}%20{y}.pdf")),
    Source("nippon", "Nippon India Mutual Fund", "mf",
           listing_url="https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures",
           listing_pattern=r"""["'(]([^"'()\s]*/InvestorServices/FactSheets/[^"'()\s]+\.pdf)"""),
    Source("edelweiss", "Edelweiss Mutual Fund", "mf",
           listing_url="https://www.edelweissmf.com/downloads/factsheets",
           listing_pattern=r"""["'(]([^"'()\s]*/Files/MF/Downloads/FACTSHEETS/FACTSHEETS/Edelweiss_Factsheet_[^"'()\s]+\.pdf)"""),
    Source("icici_mf", "ICICI Prudential Mutual Fund", "mf",
           fixed_url="https://www.icicipruamc.com/blob/knowledgecentre/factsheet-complete/Complete.pdf",
           notes="Fixed URL overwritten monthly; each new version is archived."),
    Source("mirae", "Mirae Asset Mutual Fund", "mf", templates=(
        "https://www.miraeassetmf.co.in/docs/default-source/fachsheet/active-factsheet---{lmonth}-{y}.pdf",)),
    Source("whiteoak", "WhiteOak Capital Mutual Fund", "mf", links_file=True),
    Source("helios", "Helios Mutual Fund", "mf", links_file=True),
    Source("bandhan", "Bandhan Mutual Fund", "mf", links_file=True),
    Source("carnelian_compounder", "Carnelian Capital Compounder Strategy", "pms", links_file=True),
    Source("icici_pms_value", "ICICI Prudential PMS Value Strategy", "pms", links_file=True, doc_label="monthly presentation"),
    Source("buoyant", "Buoyant Capital", "pms", doc_label="monthly update",
           listing_url="https://www.buoyantcap.com/insights/",
           listing_pattern=r"""(https://www\.buoyantcap\.com/wp-content/uploads/\d{4}/\d{2}/[^"'\s<>]*(?:[Ff]actsheet|Quick-Insights)[^"'\s<>]*\.pdf)"""),
    Source("stallion", "Stallion Asset", "pms", templates=(
        "https://www.stallionasset.com/regulatory/Stallion_Asset_Factsheet_{ab}_{y}.pdf",
        "https://www.stallionasset.com/regulatory/Stallion_Asset_Factsheet__{ab}_{y}.pdf",
        "https://www.stallionasset.com/regulatory/Stallion_Asset_Factsheet_{month}_{y}.pdf")),
    Source("abakkus_pms", "Abakkus Asset Manager (Emerging Opportunities)", "pms",
           fixed_url="https://abakkus-website.s3.ap-south-1.amazonaws.com/files/factsheets/AEO_Factsheet.pdf",
           notes="Fixed URL overwritten on release; each new version is archived."),
)}


def recent_months(count: int, now: datetime | None = None) -> list[tuple[int, int]]:
    now = now or datetime.now(UTC)
    y, m, out = now.year, now.month, []
    for _ in range(count):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _fmt(url: str, y: int, m: int) -> str:
    ny, nm = (y + (m == 12), m % 12 + 1)
    return url.format(
        month=calendar.month_name[m], lmonth=calendar.month_name[m].lower(), ab=calendar.month_abbr[m],
        y=y, mm=f"{m:02d}", ny=ny, nm=f"{nm:02d}",
    )


def _is_pdf(r: httpx.Response) -> bool:
    return r.status_code == 200 and "pdf" in r.headers.get("content-type", "").lower()


def _probe(client: httpx.Client, url: str) -> httpx.Response | None:
    """GET headers only (stream, no body); some hosts reject HEAD."""
    try:
        with client.stream("GET", url) as r:
            return r if _is_pdf(r) else None
    except httpx.HTTPError:
        return None


def discover_templates(client: httpx.Client, src: Source, months: list[tuple[int, int]]) -> list[Found]:
    found: list[Found] = []
    for y, m in months:
        for tpl in src.templates:
            url = _fmt(tpl, y, m)
            r = _probe(client, url)
            if r is not None:
                size = r.headers.get("content-length")
                found.append(Found(f"{y}-{m:02d}", f"{src.label} {src.doc_label} {calendar.month_name[m]} {y}", url, int(size) if size and size.isdigit() else None))
                break
    return found


_NUMERIC_PERIOD_RE = re.compile(r"(?<!\d)(20\d\d)[-_](0[1-9]|1[0-2])(?!\d)")


def period_from_name(name: str) -> str | None:
    m = _PERIOD_RE.search(name)
    if not m:
        n = _NUMERIC_PERIOD_RE.search(name)
        return f"{n.group(1)}-{n.group(2)}" if n else None
    mon = MONTHS.get(m.group(1).lower()[:3] if m.group(1).lower() != "sept" else "sep")
    return f"{m.group(2)}-{mon:02d}" if mon else None


def discover_listing(client: httpx.Client, src: Source) -> list[Found]:
    try:
        page = client.get(src.listing_url)
        page.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("factsheet listing %s failed: %s", src.key, e)
        return []
    best: dict[str, Found] = {}
    for href in dict.fromkeys(re.findall(src.listing_pattern, page.text.replace("\\/", "/"))):
        url = urljoin(src.listing_url, href.replace("\\/", "/")).replace(" ", "%20")
        period = period_from_name(href.rsplit("/", 1)[-1])
        if period and period not in best:
            y, m = period.split("-")
            best[period] = Found(period, f"{src.label} {src.doc_label} {calendar.month_name[int(m)]} {y}", url)
    return list(best.values())


def discover_links_file(src: Source, data: dict) -> list[Found]:
    """Links the CI browser scraper recorded from the publisher's own page."""
    out = []
    for e in data.get(src.key, []):
        if isinstance(e, dict) and re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", str(e.get("period", ""))) and str(e.get("url", "")).startswith("https://"):
            out.append(Found(e["period"], e.get("title") or f"{src.label} {src.doc_label} {e['period']}", e["url"]))
    return out


def discover_fixed(client: httpx.Client, src: Source, archive_dir: Path, already: set[str]) -> list[Found]:
    """Archive the current version of an overwritten-in-place factsheet when its Last-Modified is new."""
    try:
        head = client.head(src.fixed_url)
        modified = parsedate_to_datetime(head.headers["last-modified"]).astimezone(UTC).strftime("%Y-%m-%d")
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as e:
        logger.warning("factsheet fixed %s failed: %s", src.key, e)
        return []
    if not _is_pdf(head) or modified in already:
        return []
    try:
        body = client.get(src.fixed_url)
    except httpx.HTTPError:
        return []
    if not _is_pdf(body):
        return []
    archive_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(body.content).hexdigest()
    path = archive_dir / f"{src.key}-{modified}-{digest[:10]}.pdf"
    path.write_bytes(body.content)
    return [Found(modified, f"{src.label} factsheet (published {modified})", src.fixed_url, len(body.content), digest, str(path))]


def new_client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=httpx.Timeout(40.0, connect=15.0))
