"""Entry timer: first completed bar close above ORB high or a level."""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.backoffice.trade.session import (
    BAR_MIN,
    CLOSE,
    DEFAULTS,
    OPEN,
    TradeError,
    clock12,
    now_ist,
    parse_hhmm,
    parse_now,
    session_times,
    trading_day,
)


def _r2(x: float | None) -> float | None:
    return None if x is None else round(float(x), 2)


def evaluate(
    symbol: str,
    bars: list[dict],
    now: str | dt.datetime | None = None,
    setup: str = "orb",
    or_minutes: int = 15,
    level: float | None = None,
    min_volume_x: float | None = None,
    cfg: dict | None = None,
) -> dict[str, Any]:
    """bars: list of {t|start, o,h,l,c,v} for ONE session, oldest first.
    t may be unix UTC seconds or an IST datetime / ISO string.
    """
    cfg = {**DEFAULTS, **(cfg or {})}
    if setup not in ("orb", "level"):
        raise TradeError("setup is orb or level")
    if setup == "level" and level is None:
        raise TradeError("level setup needs a price level")
    if or_minutes <= 0 or or_minutes % BAR_MIN:
        raise TradeError("or_minutes must be a multiple of 5")

    now_utc = parse_now(now) if isinstance(now, str) or now is None else now
    ist = now_ist(now_utc.replace(tzinfo=dt.timezone.utc) if getattr(now_utc, "tzinfo", None) is None else now_utc)
    day = ist.date()
    n_or = or_minutes // BAR_MIN
    res: dict[str, Any] = {
        "symbol": symbol.upper(),
        "setup": setup,
        "side": "buy",
        "date": day.isoformat(),
        "interval": "5m",
        "or_minutes": or_minutes,
        "status": "waiting",
        "phase": "",
        "reason": "",
        "opening_range": None,
        "level": None,
        "trigger": None,
        "market": "NSE",
        "currency": "INR",
        "tz": "Asia/Kolkata",
    }
    ok, why = trading_day(day)
    if not ok:
        res.update(status="no-data", phase="closed", reason=f"NSE is closed today ({why})")
        return res
    sess = session_times(day)
    assert sess
    open_dt = dt.datetime.combine(day, sess[0])
    close_dt = dt.datetime.combine(day, sess[1])
    before = dt.datetime.combine(day, parse_hhmm(cfg["no_entries_before"], "no_entries_before"))
    cutoff = dt.datetime.combine(day, parse_hhmm(cfg["no_entries_after"], "no_entries_after"))
    or_end = open_dt + dt.timedelta(minutes=or_minutes)
    local = ist.replace(tzinfo=None)

    # Normalise bars onto slots
    by_slot: dict[int, dict] = {}
    for b in bars:
        start = b.get("start")
        if start is None and "t" in b:
            t = b["t"]
            if isinstance(t, (int, float)):
                start = dt.datetime.fromtimestamp(int(t), tz=dt.timezone.utc).astimezone(
                    __import__("zoneinfo").ZoneInfo("Asia/Kolkata")
                ).replace(tzinfo=None)
            elif isinstance(t, str):
                start = dt.datetime.fromisoformat(t.replace("Z", "+00:00"))
                if start.tzinfo:
                    start = start.astimezone(__import__("zoneinfo").ZoneInfo("Asia/Kolkata")).replace(tzinfo=None)
            elif isinstance(t, dt.datetime):
                start = t.replace(tzinfo=None) if t.tzinfo is None else t.astimezone(
                    __import__("zoneinfo").ZoneInfo("Asia/Kolkata")
                ).replace(tzinfo=None)
        if start is None:
            continue
        if start.date() != day or not (open_dt <= start < close_dt):
            continue
        if start.second or start.minute % BAR_MIN:
            continue
        slot = int((start - open_dt).total_seconds()) // (BAR_MIN * 60)
        end = start + dt.timedelta(minutes=BAR_MIN)
        if end > local:
            continue  # still forming
        by_slot[slot] = {
            "slot": slot,
            "start": start,
            "end": end,
            "o": float(b.get("o", b["c"])),
            "h": float(b["h"]),
            "l": float(b["l"]),
            "c": float(b["c"]),
            "v": int(b.get("v") or 0),
        }
    closed = [by_slot[k] for k in sorted(by_slot)]
    res["bars_closed"] = len(closed)

    if local < open_dt:
        res.update(phase="pre-open", reason="NSE opens at 09:15 IST")
        return res

    or_bars = [b for b in closed if b["slot"] < n_or]
    avg_vol = (sum(b["v"] for b in or_bars) / float(len(or_bars))) if or_bars else None
    if or_bars:
        res["opening_range"] = {
            "high": _r2(max(b["h"] for b in or_bars)),
            "low": _r2(min(b["l"] for b in or_bars)),
            "minutes": or_minutes,
            "bars": len(or_bars),
            "of": n_or,
            "complete": local >= or_end,
            "avg_volume": int(round(avg_vol)) if avg_vol is not None else None,
        }

    if setup == "orb":
        if local < or_end:
            res.update(
                phase="forming",
                reason=f"{len(or_bars)} of {n_or} range bars closed; range sets at {or_end.strftime('%H:%M')} IST",
            )
            return res
        if not or_bars:
            res.update(status="no-data", phase="open", reason="no bars for the opening range")
            return res
        lvl = max(b["h"] for b in or_bars)
    else:
        lvl = float(level)  # type: ignore[arg-type]
    res["level"] = _r2(lvl)

    first_slot = n_or if setup == "orb" else 0
    trig = None
    for b in closed:
        if b["slot"] < first_slot or b["end"] < before or b["end"] > cutoff:
            continue
        if b["c"] > lvl:
            vx = (b["v"] / avg_vol) if avg_vol else None
            if min_volume_x and (vx is None or vx < min_volume_x):
                continue
            trig = b
            break

    last = closed[-1] if closed else None
    if trig:
        vx = (trig["v"] / avg_vol) if avg_vol else None
        res.update(
            status="triggered",
            phase="open" if local < close_dt else "after-close",
            reason="the bar closed above the range high" if setup == "orb" else "the bar closed above the level",
        )
        res["trigger"] = {
            "time": clock12(trig["end"].hour * 60 + trig["end"].minute),
            "close_time": trig["end"].strftime("%H:%M"),
            "bar_start": trig["start"].strftime("%H:%M"),
            "bar_index": trig["slot"],
            "price": _r2(trig["c"]),
            "volume": trig["v"],
            "volume_x": _r2(vx),
            "pct_over": _r2(100.0 * (trig["c"] / lvl - 1)),
        }
        return res

    if not closed:
        res.update(status="no-data", phase="open", reason=f"no bars for {day.isoformat()} yet")
        return res
    if local >= cutoff:
        res.update(
            status="expired",
            phase="after-cutoff",
            reason=f"no close above {_r2(lvl)} by {cutoff.strftime('%H:%M')} IST",
        )
        return res
    res["phase"] = "open"
    gap = lvl - last["c"]
    res["reason"] = (
        f"last close {_r2(last['c'])} ({last['start'].strftime('%H:%M')} bar), "
        f"{_r2(abs(gap))} {'under' if gap >= 0 else 'over'} the level {_r2(lvl)}"
    )
    return res


def entry_doc(res: dict) -> dict:
    t = res.get("trigger") or {}
    orr = res.get("opening_range")
    return {
        "created_by": "fh-trade-entry",
        "symbol": res["symbol"],
        "setup": res["setup"],
        "side": "buy",
        "date": res["date"],
        "status": res["status"],
        "time": t.get("time"),
        "bar_start": t.get("bar_start"),
        "bar_index": t.get("bar_index"),
        "price": t.get("price"),
        "level": res.get("level"),
        "interval": "5m",
        "opening_range": orr,
        "market": "NSE",
        "currency": "INR",
        "reason": res.get("reason"),
    }
