"""India-oriented headline tagging for Trade desk watchlists."""

from __future__ import annotations

import re
from typing import Any

# Tags tuned for Indian equities / regulators (replaces US SEC 8-K item codes).
TAG_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("results", re.compile(r"\b(q[1-4]|quarterly|results|earnings|profit|revenue|pat)\b", re.I)),
    ("board", re.compile(r"\b(board meet|dividend|buyback|bonus|split|agm|egm)\b", re.I)),
    ("sebi", re.compile(r"\b(sebi|insider|sast|takeover|open offer)\b", re.I)),
    ("rbi", re.compile(r"\b(rbi|repo rate|mpc|monetary policy)\b", re.I)),
    ("fii", re.compile(r"\b(fii|dii|foreign portfolio|fpis?)\b", re.I)),
    ("gst", re.compile(r"\b(gst|tax|budget)\b", re.I)),
    ("deal", re.compile(r"\b(merger|acquisition|stake|block deal|bulk deal|preferential)\b", re.I)),
    ("rating", re.compile(r"\b(upgrade|downgrade|initiate|target price|brokerage)\b", re.I)),
    ("macro", re.compile(r"\b(inflation|cpi|wpi|gdp|crude|rupee|usd\/inr)\b", re.I)),
]


def tag_headline(title: str) -> list[str]:
    return [name for name, rx in TAG_RULES if rx.search(title or "")]


def score_move(pct: float | None, move_pct: float = 2.0) -> bool:
    return pct is not None and abs(pct) >= move_pct


def build_news_board(
    items: list[dict],
    moves: dict[str, dict] | None = None,
    move_pct: float = 2.0,
) -> dict[str, Any]:
    """items: [{title, link?, published?, source?, ticker?}] from RSS or desk feeds."""
    out = []
    for it in items:
        title = str(it.get("title") or "")
        tags = tag_headline(title)
        ticker = (it.get("ticker") or it.get("symbol") or "").upper() or None
        row = {
            "kind": "headline",
            "title": title,
            "link": it.get("link"),
            "published": it.get("published"),
            "source": it.get("source") or "desk",
            "ticker": ticker,
            "tags": tags,
            "important": bool({"sebi", "results", "deal"} & set(tags)),
        }
        out.append(row)
    moving = []
    for sym, m in (moves or {}).items():
        pct = m.get("pct")
        if score_move(pct, move_pct):
            moving.append({
                "ticker": sym.upper(),
                "price": m.get("price"),
                "prev_close": m.get("prev_close"),
                "pct": round(float(pct), 2),
                "flag": "MOVING",
            })
    moving.sort(key=lambda x: -abs(x["pct"]))
    return {
        "created_by": "fh-trade-news",
        "market": "NSE",
        "currency": "INR",
        "items": out,
        "moves": moving,
        "note": "Public headlines and % moves only — not a signal to buy or sell.",
    }
