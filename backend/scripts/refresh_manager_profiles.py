"""Rebuild data/mf_manager_profiles.json from Groww fund pages.

    python backend/scripts/refresh_manager_profiles.py

Crawls from the source URLs already in the file: every fund page lists each manager's education, experience and
the other funds they run (`funds_managed`), so following those links reaches every manager. Curated fields
(philosophy, career_history, years_experience) are kept; scraped text only fills empty education/bio_summary.
Names the AMFI snapshot spells differently get an alias when a near-identical scraped name exists.
"""
from __future__ import annotations

import difflib
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
PROFILES = ROOT / "data" / "mf_manager_profiles.json"
BASE = "https://groww.in/mutual-funds/"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; fh-data-bot)"}
NEXT_DATA = re.compile(r'__NEXT_DATA__[^>]*>(.*?)</script>', re.S)


def fetch(slug: str) -> dict | None:
    for attempt in range(3):
        try:
            r = requests.get(BASE + slug, headers=HEADERS, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return json.loads(NEXT_DATA.search(r.text).group(1))["props"]["pageProps"]["mfServerSideData"]
        except (requests.RequestException, AttributeError, KeyError, ValueError):
            time.sleep(2 * (attempt + 1))
    return None


def crawl(seeds: list[str]) -> dict[str, dict]:
    """slug -> page data, following funds_managed links to a fixed point."""
    seen: dict[str, dict] = {}
    todo = set(seeds)
    with ThreadPoolExecutor(16) as pool:
        while todo:
            batch = sorted(todo - seen.keys())
            todo = set()
            for slug, page in zip(batch, pool.map(fetch, batch)):
                seen[slug] = page or {}
                for m in (page or {}).get("fund_manager_details") or []:
                    todo.update(f["search_id"] for f in m.get("funds_managed") or [] if f.get("search_id"))
            print(f"crawled {len(seen)} pages, {len(todo - seen.keys())} queued", flush=True)
    return seen


def key(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^(mr|mrs|ms|dr)\.?\s+", "", name.strip(), flags=re.I)).lower()


def initial_of(short: str, full: str) -> bool:
    """'krishnaa n' is 'krishnaa narayan': same first name, last token an initial/prefix of the other's."""
    a, b = short.split(), full.split()
    return len(a) == len(b) > 1 and a[:-1] == b[:-1] and b[-1].startswith(a[-1]) and len(a[-1]) <= 2


def main() -> int:
    from app.backoffice import mf_reference

    old = json.loads(PROFILES.read_text())
    by_key = {key(p["name"]): p for p in old}
    seeds = [s["url"].removeprefix(BASE) for p in old for s in p.get("sources", []) if s["url"].startswith(BASE)]
    pages = crawl(seeds)
    today = time.strftime("%Y-%m-%d")

    for slug, page in pages.items():
        for m in page.get("fund_manager_details") or []:
            name = (m.get("person_name") or "").strip()
            if not name:
                continue
            p = by_key.setdefault(key(name), {
                "name": name, "aliases": [], "firm": None, "current_title": "Fund Manager", "education": None,
                "years_experience": None, "bio_summary": None, "investment_philosophy": None,
                "career_history": [], "sources": [],
            })
            p["firm"] = p["firm"] or page.get("fund_house")
            p["education"] = p["education"] or (m.get("education") or "").strip() or None
            p["bio_summary"] = p["bio_summary"] or (m.get("experience") or "").strip() or None
            if not p["sources"]:
                p["sources"] = [{"label": f"Groww fund page, fund management section (fetched {today})", "url": BASE + slug}]

    # AMFI spells some names differently (Thakar/Thakkar): alias them to a near-identical scraped name.
    conn = mf_reference._conn()
    try:
        amfi = [r[0] for r in conn.execute(f'SELECT full_name FROM "{mf_reference._tname("fund_manager_master")}"') if r[0]]
    finally:
        conn.close()
    known = {k for k, p in by_key.items()} | {key(a) for p in by_key.values() for a in p["aliases"]}
    for n in amfi:
        if key(n) in known:
            continue
        hit = difflib.get_close_matches(key(n), list(by_key), n=1, cutoff=0.92) or [
            k for k in by_key if initial_of(key(n), k)][:1]
        if hit and hit[0].split()[-1][0] == key(n).split()[-1][0]:
            by_key[hit[0]]["aliases"].append(n)

    out = sorted(by_key.values(), key=lambda p: p["name"])
    PROFILES.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    covered = sum(1 for n in amfi if key(n) in {key(p["name"]) for p in out} | {key(a) for p in out for a in p["aliases"]})
    print(f"{len(out)} profiles; {covered}/{len(amfi)} AMFI managers covered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
