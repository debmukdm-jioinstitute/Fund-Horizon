"""Collect factsheet links from publisher pages that only render in a real browser (Playwright / headless Chromium).

Runs in CI (.github/workflows/factsheets-browser.yml), not on the API server: it writes
data/factsheet_links/browser.json and the server's factsheet collector ingests that file. Links are exactly what the
publisher's own page shows; nothing is guessed.

Usage: python backend/scripts/scrape_factsheets_browser.py [--out PATH]
"""
from __future__ import annotations

import argparse
import calendar
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))
from app.backoffice.providers.factsheets import BROWSER_PAGES, FACTSHEET_LINK_RE, SOURCES, period_from_name, period_from_text  # noqa: E402

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
MONTH_NAMES = {n.lower(): i for i, n in enumerate(calendar.month_name) if n}
ANCHORS = "els => els.map(a => ({h: a.href, t: (a.innerText || '').replace(/\\s+/g, ' ').trim(), ctx: (() => { let e = a; for (let i = 0; i < 6 && e; i++, e = e.parentElement) { if (e.innerText && /Factsheet as at/i.test(e.innerText) && e.innerText.length < 400) return e.innerText.replace(/\\s+/g, ' '); } return ''; })()}))"


def goto(page: Page, url: str) -> list[dict]:
    # Log blocked responses so a publisher firewall shows up in the CI log instead of as a silent empty result.
    page.on("response", lambda r: print(f"  blocked {r.status} {r.url[:110]}") if r.status in (401, 403, 429) else None)
    page.goto(url, wait_until="networkidle", timeout=90_000)
    page.wait_for_timeout(2500)
    return page.eval_on_selector_all("a[href]", ANCHORS)


def entry(period: str | None, title: str, url: str) -> dict | None:
    return {"period": period, "title": title, "url": url} if period else None


def whiteoak(page: Page) -> list[dict]:
    out = []
    for year in range(datetime.now(UTC).year, 2022, -1):
        for a in goto(page, f"https://mf.whiteoakamc.com/resources/downloads/factsheet?year={year}"):
            if not re.search(r"actsheet.*\.pdf", a["h"], re.I):
                continue
            m = re.search(r"Factsheet as at ([A-Za-z]+) \d+, (\d{4})", a["ctx"], re.I)
            period = f"{m.group(2)}-{MONTH_NAMES[m.group(1).lower()]:02d}" if m and m.group(1).lower() in MONTH_NAMES else period_from_name(a["h"].rsplit("/", 1)[-1])
            out.append(entry(period, f"WhiteOak Capital factsheet {period}", a["h"]))
    return out


def helios(page: Page) -> list[dict]:
    return [
        entry(period_from_name(a["t"]), f"Helios factsheet {a['t']}", a["h"])
        for a in goto(page, "https://www.heliosmf.in/downloads/")
        if re.search(r"factsheet", a["h"], re.I) and period_from_name(a["t"])
    ]


def bandhan(page: Page) -> list[dict]:
    # shortcut: the page only links the newest factsheet; older months accumulate as daily runs record them.
    return [
        entry(period_from_name(a["h"].rsplit("/", 1)[-1]), "Bandhan Mutual Fund factsheet", a["h"])
        for a in goto(page, "https://bandhanmutual.com/mutual-funds/equity-funds/bandhan-large-and-mid-cap-fund/regular")
        if a["t"].lower().startswith("factsheet") and a["h"].lower().endswith(".pdf")
    ]


def carnelian(page: Page) -> list[dict]:
    return [
        entry(period_from_name(a["h"].rsplit("/", 1)[-1]), "Carnelian Capital Compounder Strategy factsheet", a["h"])
        for a in goto(page, "https://carneliancapital.co.in/presentation-factsheets")
        if "compounder" in a["h"].lower() and "factsheet" in a["h"].lower() and a["h"].lower().endswith(".pdf")
    ]


def icici_pms(page: Page) -> list[dict]:
    return [
        entry(period_from_name(a["h"].split("?")[0].rsplit("/", 1)[-1].replace("%20", " ")), "ICICI Prudential PMS Value Strategy monthly presentation", a["h"])
        for a in goto(page, "https://www.iciciprualternates.com/investors-corner")
        if "pms_value_strategy_presentation" in a["h"].lower()
    ]


def generic(url: str):
    """Any AMC's own factsheet page: factsheet PDFs from the page's links and from the JSON its scripts load."""
    def scrape(page: Page) -> list[dict]:
        seen: list = []
        page.on("response", lambda r: seen.append(r) if r.status == 200 and ("json" in r.headers.get("content-type", "") or "text" in r.headers.get("content-type", "")) else None)
        page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        page.wait_for_timeout(8000)
        for _ in range(4):  # lazy lists load on scroll
            page.mouse.wheel(0, 3000)
            page.wait_for_timeout(800)
        links = {a["h"]: a["t"] for a in page.eval_on_selector_all("a[href]", ANCHORS)}
        for r in seen:
            try:
                for u in re.findall(r'https?://[^"\'\s<>\\]+?\.pdf[^"\'\s<>\\]*', r.text().replace("\\/", "/"), re.I):
                    links.setdefault(u, "")
            except Exception:  # response body already discarded
                pass
        out = {}
        for h, t in links.items():
            if ".pdf" not in h.lower() or not FACTSHEET_LINK_RE.search(h + " " + t):
                continue
            period = period_from_text(h.split("?")[0].rsplit("/", 1)[-1]) or period_from_text(t)  # filename beats the label
            if period:
                out.setdefault(period, h)
        return [{"period": p, "title": "", "url": u} for p, u in out.items()]
    return scrape


SCRAPERS = {"helios": helios, "bandhan": bandhan, "carnelian_compounder": carnelian, "icici_pms_value": icici_pms}
# WhiteOak's firewall returns 403 to CI/datacenter addresses, so it is opt-in (run from a normal connection with
# FH_SCRAPE_WHITEOAK=1). Its previously collected links stay in browser.json untouched.
if os.environ.get("FH_SCRAPE_WHITEOAK") == "1":
    SCRAPERS["whiteoak"] = whiteoak
for _key, _url in BROWSER_PAGES.items():
    if _key not in SCRAPERS and _key != "whiteoak":
        SCRAPERS[_key] = generic(_url)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(backend_dir.parent / "data" / "factsheet_links" / "browser.json"))
    args = ap.parse_args()
    path = Path(args.out)
    result: dict[str, list[dict]] = json.loads(path.read_text()) if path.exists() else {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-http2"])
        context = browser.new_context(user_agent=UA)
        for key, scrape in SCRAPERS.items():
            page = context.new_page()
            try:
                found = [e for e in scrape(page) if e]
            except Exception as e:  # keep previously collected links when a site changes or blocks us
                print(f"{key}: FAILED {type(e).__name__}: {str(e)[:120]}")
                continue
            finally:
                page.close()
            for e in found:
                e["title"] = e["title"] or f"{SOURCES[key].label} factsheet {e['period']}"
            merged = {e["period"]: e for e in result.get(key, [])}
            merged.update({e["period"]: e for e in found})
            result[key] = sorted(merged.values(), key=lambda e: e["period"], reverse=True)
            print(f"{key}: {len(found)} found, {len(result[key])} kept")
        browser.close()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
