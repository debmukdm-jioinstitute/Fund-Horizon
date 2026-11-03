"""Daily + ORB chart scanner for NSE cash equities."""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.backoffice.trade.indicators import MIN_DAILY_BARS, find_setups, orb_candidate, orb_hit
from app.backoffice.trade.session import (
    BAR_MIN,
    CLOSE,
    OPEN,
    TradeError,
    now_ist,
    parse_hhmm,
    parse_now,
    session_times,
    slot_start,
    trading_day,
)


def _session_bars(series: dict, day: dt.date, cutoff: dt.datetime) -> list[dict]:
    """5-minute bars of `day` complete at cutoff (naive IST)."""
    s = session_times(day)
    close_t = s[1] if s else CLOSE
    out: dict[dt.datetime, dict] = {}
    hs, ls, vs = series.get("h"), series.get("l"), series.get("v")
    for i, ts in enumerate(series.get("t") or []):
        c = series["c"][i]
        if c is None:
            continue
        # ts may be unix seconds (UTC) or already an IST datetime
        if isinstance(ts, (int, float)):
            et = dt.datetime.fromtimestamp(int(ts), tz=dt.timezone.utc).astimezone(
                __import__("zoneinfo").ZoneInfo("Asia/Kolkata")
            ).replace(tzinfo=None)
        elif isinstance(ts, dt.datetime):
            et = ts.replace(tzinfo=None) if ts.tzinfo is None else ts.astimezone(
                __import__("zoneinfo").ZoneInfo("Asia/Kolkata")
            ).replace(tzinfo=None)
        else:
            continue
        if et.date() != day or et.second or et.minute % BAR_MIN:
            continue
        if et.time() < OPEN or et.time() >= close_t:
            continue
        if et + dt.timedelta(minutes=BAR_MIN) > cutoff:
            continue
        out[et] = {
            "start": et,
            "c": float(c),
            "h": None if not hs or hs[i] is None else float(hs[i]),
            "l": None if not ls or ls[i] is None else float(ls[i]),
            "v": (vs[i] or 0) if vs else 0,
        }
    return [out[k] for k in sorted(out)]


def _usable(bars: list[dict], day: dt.date, cutoff: dt.datetime, n_range: int) -> bool:
    want = int((cutoff - slot_start(day, 0)).total_seconds() // (BAR_MIN * 60))
    s = session_times(day)
    if s:
        want = min(
            want,
            int((dt.datetime.combine(day, s[1]) - slot_start(day, 0)).total_seconds() // (BAR_MIN * 60)),
        )
    if want < n_range or len(bars) != want:
        return False
    return all(b["start"] == slot_start(day, k) for k, b in enumerate(bars))


def scan_daily(
    data: dict[str, dict],
    symbols: list[str],
    now: str | dt.datetime | None = None,
    min_price: float = 50.0,
    min_volume: int = 100_000,
) -> dict[str, Any]:
    """data = {SYM: {c:[...], t:[...], meta:{regularMarketPrice, regularMarketVolume}}}."""
    now_utc = parse_now(now) if isinstance(now, str) or now is None else now
    ist = now_ist(now_utc.replace(tzinfo=dt.timezone.utc) if now_utc.tzinfo is None else now_utc)
    hits: list[dict] = []
    counts = {"requested": len(symbols), "fetched": 0, "illiquid": 0, "short": 0, "scanned": 0}
    for sym in symbols:
        s = data.get(sym)
        if not s:
            continue
        counts["fetched"] += 1
        closes_raw = [float(c) for c in (s.get("c") or []) if c is not None]
        meta = s.get("meta") or {}
        price = meta.get("regularMarketPrice")
        if price is None and closes_raw:
            price = closes_raw[-1]
        vol = meta.get("regularMarketVolume")
        if price is None or price < min_price or (min_volume > 0 and (vol is None or vol < min_volume)):
            counts["illiquid"] += 1
            continue
        if len(closes_raw) < MIN_DAILY_BARS:
            counts["short"] += 1
            continue
        counts["scanned"] += 1
        tags, nums = find_setups(closes_raw)
        if tags:
            hits.append({
                "symbol": sym,
                "setups": tags,
                "price": round(closes_raw[-1], 2),
                "rsi": round(nums["rsi"], 1) if nums["rsi"] is not None else None,
                "volume": int(vol) if vol is not None else None,
                "exchange": "NSE",
            })
    hits.sort(key=lambda h: (-(h["price"] * (h["volume"] or 0)), h["symbol"]))
    counts["hits"] = len(hits)
    return {
        "created_by": "fh-trade-scanner",
        "mode": "daily",
        "as_of": ist.isoformat(timespec="seconds"),
        "market": "NSE",
        "currency": "INR",
        "hits": hits,
        "counts": counts,
        "note": "A scan is a list of charts that match a rule, not a list of stocks to buy.",
    }


def scan_orb(
    data: dict[str, dict],
    symbols: list[str],
    now: str | dt.datetime | None = None,
    at: str | None = None,
    or_minutes: int = 15,
    min_price: float = 50.0,
    min_volume: int = 0,
    max_confirm: int = 200,
) -> dict[str, Any]:
    now_utc = parse_now(now) if isinstance(now, str) or now is None else now
    ist = now_ist(now_utc.replace(tzinfo=dt.timezone.utc) if now_utc.tzinfo is None else now_utc)
    day = ist.date()
    if or_minutes < BAR_MIN or or_minutes % BAR_MIN or or_minutes > 120:
        raise TradeError("or_minutes wants a multiple of 5 from 5 to 120")
    ok, why = trading_day(day)
    if not ok:
        raise TradeError(f"No NSE session on {day.isoformat()} ({why})")
    n_range = or_minutes // BAR_MIN
    s = session_times(day)
    assert s
    close_dt = dt.datetime.combine(day, s[1])
    if at:
        cutoff = dt.datetime.combine(day, parse_hhmm(at, "at"))
    else:
        cutoff = ist.replace(second=0, microsecond=0, tzinfo=None)
    if cutoff.tzinfo is not None:
        cutoff = cutoff.replace(tzinfo=None)
    range_end = slot_start(day, n_range)
    first_close = range_end + dt.timedelta(minutes=BAR_MIN)
    if cutoff < first_close:
        raise TradeError(
            f"It is {cutoff.strftime('%H:%M')} IST: the {or_minutes}-minute opening range "
            f"runs 09:15 to {range_end.strftime('%H:%M')} and the first bar after it closes at "
            f"{first_close.strftime('%H:%M')}."
        )
    if cutoff > close_dt:
        raise TradeError(f"at {cutoff.strftime('%H:%M')} is after the NSE close on {day.isoformat()}")

    candidates: list[tuple[float, str, list[dict]]] = []
    counts = {"requested": len(symbols), "fetched": 0, "illiquid": 0, "unusable": 0, "stage1": 0, "confirmed": 0}
    for sym in symbols:
        series = data.get(sym)
        if not series:
            continue
        counts["fetched"] += 1
        bars = _session_bars(series, day, cutoff)
        meta = series.get("meta") or {}
        price = meta.get("regularMarketPrice") or (bars[-1]["c"] if bars else None)
        vol = meta.get("regularMarketVolume") or sum(b.get("v") or 0 for b in bars)
        if price is None or price < min_price or (min_volume > 0 and vol < min_volume):
            counts["illiquid"] += 1
            continue
        if not _usable(bars, day, cutoff, n_range):
            counts["unusable"] += 1
            continue
        if orb_candidate(bars, n_range):
            counts["stage1"] += 1
            candidates.append((float(price) * float(vol or 0), sym, bars))

    candidates.sort(reverse=True)
    hits: list[dict] = []
    for _, sym, bars in candidates[:max_confirm]:
        hit = orb_hit(bars, n_range)
        if not hit:
            continue
        counts["confirmed"] += 1
        closes_at = hit["start"] + dt.timedelta(minutes=BAR_MIN) if hit.get("start") else None
        hits.append({
            "symbol": sym,
            "setups": ["orb"],
            "price": hit["price"],
            "or_high": hit["or_high"],
            "or_low": hit["or_low"],
            "pct_over": hit["pct_over"],
            "bar_index": hit["bar_index"],
            "bar_start": hit["start"].strftime("%H:%M") if hit.get("start") else None,
            "at": closes_at.strftime("%H:%M") if closes_at else None,
            "exchange": "NSE",
        })
    counts["hits"] = len(hits)
    return {
        "created_by": "fh-trade-scanner",
        "mode": "orb",
        "as_of": ist.isoformat(timespec="seconds"),
        "date": day.isoformat(),
        "or_minutes": or_minutes,
        "cutoff": cutoff.strftime("%H:%M"),
        "market": "NSE",
        "currency": "INR",
        "session": {"open": "09:15", "close": "15:30", "tz": "Asia/Kolkata"},
        "hits": hits,
        "counts": counts,
        "note": "A scan is a list of charts that match a rule, not a list of stocks to buy.",
    }
