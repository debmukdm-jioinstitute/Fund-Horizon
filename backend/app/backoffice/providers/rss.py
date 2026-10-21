from __future__ import annotations
"""Open RSS/Atom feed collector for Indian markets, regulators and macro news (stdlib XML only, no API keys)."""

import hashlib
import html
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree as ET

import httpx

logger = logging.getLogger("backoffice.providers.rss")

FEEDS: list[dict[str, str]] = [
    {"id": "rbi_press", "name": "RBI Press Releases", "category": "regulator", "url": "https://www.rbi.org.in/pressreleases_rss.xml"},
    {"id": "rbi_notif", "name": "RBI Notifications", "category": "regulator", "url": "https://www.rbi.org.in/notifications_rss.xml"},
    {"id": "sebi", "name": "SEBI", "category": "regulator", "url": "https://www.sebi.gov.in/sebirss.xml"},
    {"id": "et_markets", "name": "Economic Times Markets", "category": "markets", "url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
    {"id": "mint_markets", "name": "Mint Markets", "category": "markets", "url": "https://www.livemint.com/rss/markets"},
    {"id": "bs_markets", "name": "Business Standard Markets", "category": "markets", "url": "https://www.business-standard.com/rss/markets-106.rss"},
    {"id": "bl_markets", "name": "BusinessLine Markets", "category": "markets", "url": "https://www.thehindubusinessline.com/markets/feeder/default.rss"},
    {"id": "mc_latest", "name": "Moneycontrol", "category": "markets", "url": "https://www.moneycontrol.com/rss/latestnews.xml"},
    {"id": "gn_india_mkts", "name": "Google News: India markets", "category": "markets", "url": "https://news.google.com/rss/search?q=RBI+OR+sensex+OR+nifty+OR+%22rupee%22&hl=en-IN&gl=IN&ceid=IN:en"},
]

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
MAX_SUMMARY = 300


def clean_text(raw: str | None, limit: int = MAX_SUMMARY) -> str:
    """Strip markup/entities so feed text can be rendered as plain text."""
    text = html.unescape(_TAG_RE.sub(" ", raw or ""))
    text = _WS_RE.sub(" ", text).strip()
    return text[:limit]


def safe_link(url: str | None) -> str | None:
    url = (url or "").strip()
    return url if url.lower().startswith(("http://", "https://")) else None


def _parse_date(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        return parsedate_to_datetime(raw).astimezone(UTC).isoformat()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC).isoformat()
    except ValueError:
        return None


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def parse_feed(xml_text: str, feed: dict[str, str]) -> list[dict[str, Any]]:
    """Parse RSS 2.0 or Atom into normalized items. Malformed XML yields an empty list."""
    try:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ET.ParseError:
        return []
    items: list[dict[str, Any]] = []
    for node in root.iter():
        if _local(node.tag) not in ("item", "entry"):
            continue
        fields: dict[str, str] = {}
        link = None
        for child in node:
            name = _local(child.tag)
            if name == "link":
                link = child.attrib.get("href") or (child.text or "")
            elif name in ("title", "description", "summary", "content", "pubDate", "published", "updated", "date"):
                fields.setdefault(name, child.text or "")
        link = safe_link(link)
        title = clean_text(fields.get("title"), 300)
        if not link or not title:
            continue
        published = _parse_date(fields.get("pubDate") or fields.get("published") or fields.get("updated") or fields.get("date"))
        summary = clean_text(fields.get("description") or fields.get("summary") or fields.get("content"))
        items.append(
            {
                "id": hashlib.sha1(link.encode()).hexdigest()[:20],
                "source_id": feed["id"],
                "source_name": feed["name"],
                "category": feed["category"],
                "title": title,
                "link": link,
                "summary": summary if summary != title else "",
                "published_at": published,
            }
        )
    return items


def fetch_feed(feed: dict[str, str], client: httpx.Client) -> tuple[list[dict[str, Any]], str | None]:
    try:
        res = client.get(feed["url"], headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    except httpx.HTTPError as e:
        return [], str(e)
    if res.status_code != 200:
        return [], f"HTTP {res.status_code}"
    items = parse_feed(res.text, feed)
    return items, None if items else "no items parsed"


def fetch_all(feeds: list[dict[str, str]] | None = None) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Fetch every feed concurrently. Returns (items, {feed_id: error})."""
    feeds = feeds or FEEDS
    errors: dict[str, str] = {}
    items: list[dict[str, Any]] = []
    with httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=True) as client:
        with ThreadPoolExecutor(max_workers=5) as pool:
            for feed, (rows, err) in zip(feeds, pool.map(lambda f: fetch_feed(f, client), feeds)):
                items.extend(rows)
                if err:
                    errors[feed["id"]] = err
    return items, errors
