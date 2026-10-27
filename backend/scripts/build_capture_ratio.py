"""Crawl AdvisorKhoj's Market Capture Ratio tool and write data/fundhorizon_mf_rag_dataset/capture_ratio.json (keyed by AMFI scheme code).

Run on a dev machine (`make capture`, ~25 min; pass category keys to refresh only those); commit the JSON. AdvisorKhoj has no API: the page is server-rendered from
GET /mutual-funds-research/market-capture-ratio?category=..&schemes=a,b,..&period=N and covers equity and hybrid categories only.
Funds are joined to our AMFI codes by normalised fund name + plan (unmatched funds are listed, not guessed).
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.backoffice import mf_screener  # noqa: E402

BASE = "https://www.advisorkhoj.com/mutual-funds-research"
OUT = Path(__file__).resolve().parents[2] / "data" / "fundhorizon_mf_rag_dataset" / "capture_ratio.json"
PERIODS = (1, 3, 5, 10)
BATCH = 8  # the page's own form allows 5; larger batches still work, 8 keeps URLs short
# Our category key -> AdvisorKhoj category names (equity and hybrid; it has no debt categories).
_EQ = lambda *n: [f"Equity: {x}" for x in n]
AK_CATS: dict[str, list[str]] = {
    "contra": _EQ("Contra"), "dividend_yield": _EQ("Dividend Yield"), "elss": _EQ("ELSS"), "flexi_cap": _EQ("Flexi Cap"),
    "focused": _EQ("Focused"), "large_mid_cap": _EQ("Large and Mid Cap"), "large_cap": _EQ("Large Cap"),
    "mid_cap": _EQ("Mid Cap"), "multi_cap": _EQ("Multi Cap"), "small_cap": _EQ("Small Cap"), "value": _EQ("Value"),
    "sectoral_thematic": _EQ(
        "Sectoral-Banking and Financial Services", "Sectoral-FMCG", "Sectoral-Infrastructure",
        "Sectoral-Pharma and Healthcare", "Sectoral-Technology", "Thematic-Consumption", "Thematic-Energy", "Thematic-ESG",
        "Thematic-International", "Thematic-Manufacturing", "Thematic-MNC", "Thematic-Others", "Thematic-PSU",
        "Thematic-Quantitative", "Thematic-Transportation",
    ),
    "aggressive_hybrid": ["Hybrid: Aggressive"], "arbitrage": ["Hybrid: Arbitrage"],
    "conservative_hybrid": ["Hybrid: Conservative"], "balanced_advantage": ["Hybrid: Dynamic Asset Allocation"],
    "equity_savings": ["Hybrid: Equity Savings"], "multi_asset": ["Hybrid: Multi Asset Allocation"],
}
_NOISE = {"fund", "plan", "option", "growth", "gr", "regular", "reg", "direct", "dir", "the", "and", "of", "a"}
_S = requests.Session()
_S.headers["User-Agent"] = "Mozilla/5.0"


def norm_key(text: str) -> tuple[str, str]:
    """(name with filler words removed and spaces collapsed, plan) from an AK slug or one of our scheme names."""
    words = re.findall(r"[a-z0-9]+", re.sub(r"\(.*?\)", "", text).lower().replace("&", " and "))
    plan = "Direct" if {"direct", "dir"} & set(words) else "Regular"
    return "".join(w for w in words if w not in _NOISE), plan


def suggest(query: str, category: str) -> list[str]:
    r = _S.post(f"{BASE}/autoSuggestAllMfSchemesShortNames", data={"query": query, "category": category}, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch(category: str, schemes: list[str], period: int) -> list[tuple[str, list[float | None]]]:
    r = _S.get(f"{BASE}/market-capture-ratio", params={"category": category, "schemes": ",".join(schemes), "period": period}, timeout=60)
    r.raise_for_status()
    table = re.search(r'id="final_result".*?<tbody>(.*?)</tbody>', r.text, re.S)
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", table.group(1) if table else "", re.S):
        slug = re.search(r"mutual-funds-research/([^'\"?]+)['\"]", tr)
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if not slug or len(cells) < 8:
            continue
        rows.append((slug.group(1), [_num(c) for c in cells[5:8]]))  # up %, down %, capture ratio
    return rows


def _num(s: str) -> float | None:
    try:
        return float(s)
    except ValueError:
        return None


def main() -> None:
    df = mf_screener._base_frame()
    ours = {norm_key(n): c for n, c in zip(df["name"], df["code"])}
    # Optional category keys on the command line refresh only those, merging into the existing file.
    only = set(sys.argv[1:])
    out: dict[str, dict[str, list[float | None]]] = json.loads(OUT.read_text())["data"] if only and OUT.exists() else {}
    seen_slugs: set[str] = set()
    for key, ak_cats in AK_CATS.items():
        if only and key not in only:
            continue
        names = df.loc[df["cat"] == key, "name"]
        queries = {" ".join(re.findall(r"[A-Za-z0-9]+", n)[:k]) for n in names for k in (1, 2, 3)}
        for ak in ak_cats:
            category = ak
            shorts: list[str] = []
            for q in sorted(queries) + list("abcdefghijklmnopqrstuvwxyz"):
                shorts += [s for s in suggest(q, category) if s not in shorts and "," not in s]
                time.sleep(0.15)
            print(f"{category}: {len(shorts)} schemes", flush=True)
            for i in range(0, len(shorts), BATCH):
                for p in PERIODS:
                    for slug, vals in fetch(category, shorts[i:i + BATCH], p):
                        seen_slugs.add(slug)
                        code = ours.get(norm_key(slug))
                        if code and any(v is not None for v in vals):
                            out.setdefault(code, {})[f"{p}y"] = vals
                    time.sleep(0.3)
    miss = sorted(s for s in seen_slugs if norm_key(s) not in ours)
    print(f"matched {len(out)} funds; {len(miss)} AdvisorKhoj slugs unmatched, e.g. {miss[:8]}")
    OUT.write_text(json.dumps({"as_of": date.today().isoformat(), "source": "advisorkhoj.com", "data": out}, separators=(",", ":")))


if __name__ == "__main__":
    main()
