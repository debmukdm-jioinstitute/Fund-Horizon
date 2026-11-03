"""Price / time alerts for NSE cash (rings once per day unless rearmed)."""

from __future__ import annotations

from typing import Any

from app.backoffice.trade.session import CLOSE, OPEN, now_ist, parse_clock, parse_hhmm


def evaluate_alerts(
    rules: list[dict],
    prices: dict[str, float],
    *,
    now: str | None = None,
    fired: set[str] | None = None,
) -> dict[str, Any]:
    """rules: [{id, type, symbol?, price?, pct?, time?, before_close?, rearm?}]"""
    ist = now_ist()
    # parse_now path via now_ist already; allow pinning via ISO through session.parse_now if needed
    if now:
        from app.backoffice.trade.session import parse_now

        ist = now_ist(parse_now(now).replace(tzinfo=__import__("datetime").timezone.utc))
    fired = set(fired or [])
    rings = []
    for rule in rules:
        rid = str(rule.get("id") or "")
        if rid in fired and not rule.get("rearm"):
            continue
        typ = str(rule.get("type") or "").lower()
        sym = str(rule.get("symbol") or "").upper()
        px = prices.get(sym)
        hit = False
        detail = ""
        if typ in ("above", "target") and px is not None and rule.get("price") is not None:
            hit = px >= float(rule["price"])
            detail = f"{sym} {px} >= {rule['price']}"
        elif typ in ("below", "stop") and px is not None and rule.get("price") is not None:
            hit = px <= float(rule["price"])
            detail = f"{sym} {px} <= {rule['price']}"
        elif typ == "pct_move" and px is not None and rule.get("ref") is not None:
            ref = float(rule["ref"])
            pct = (px / ref - 1) * 100 if ref else 0
            need = float(rule.get("pct") or 0)
            hit = abs(pct) >= need
            detail = f"{sym} moved {pct:+.2f}% vs ref {ref}"
        elif typ == "time":
            want = parse_hhmm(str(rule.get("time")), "alert time")
            hit = ist.time().hour == want.hour and ist.time().minute == want.minute
            detail = f"clock {want.strftime('%H:%M')} IST"
        elif typ == "before_close":
            mins = int(rule.get("before_close") or 10)
            close_min = CLOSE.hour * 60 + CLOSE.minute
            now_min = ist.hour * 60 + ist.minute
            hit = now_min == close_min - mins
            detail = f"{mins} minutes before NSE close"
        elif typ == "opening_bell":
            hit = ist.time().hour == OPEN.hour and ist.time().minute == OPEN.minute
            detail = "NSE opening bell 09:15 IST"
        if hit:
            rings.append({
                "id": rid,
                "type": typ,
                "symbol": sym or None,
                "detail": detail,
                "at": ist.isoformat(timespec="seconds"),
            })
            fired.add(rid)
    return {
        "created_by": "fh-trade-alerts",
        "market": "NSE",
        "tz": "Asia/Kolkata",
        "rings": rings,
        "fired": sorted(fired),
    }
