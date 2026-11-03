"""NSE cash-equity session clock (Asia/Kolkata). No DST."""

from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
UTC = dt.timezone.utc

OPEN = dt.time(9, 15)
CLOSE = dt.time(15, 30)
BAR_MIN = 5
SESSION_BARS = 75  # (15:30 - 09:15) / 5
OPEN_MIN = 9 * 60 + 15
CLOSE_MIN = 15 * 60 + 30

# Flat-by leaves room before the cash close; entry window avoids the open auction.
DEFAULTS = {
    "no_entries_before": "09:30",
    "no_entries_after": "15:00",
    "flat_by": "15:20",
    "min_reward_risk": 1.0,
    "budget": 500_000,  # INR
    "cash_buffer_pct": 10,
    "max_position_pct": 75,
    "max_order_inr": 400_000,
    "min_order_inr": 500,
    "max_loss_per_trade_inr": 5_000,
    "max_daily_loss_inr": 15_000,
    "max_trades_per_day": 3,
    "max_orders_per_day": 10,
    "require_stop": True,
    "paper": True,
    "blocked": [],
    "allow_options": False,
    "allow_margin": False,
    "allow_short": False,
    "intraday_only": True,
}

# NSE cash-market holidays (subset used by flows board + Trade desk).
NSE_HOLIDAYS = {
    "2025-01-26", "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14",
    "2025-04-18", "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-21",
    "2025-10-22", "2025-11-05", "2025-12-25",
    "2026-01-26", "2026-02-17", "2026-03-04", "2026-03-20", "2026-04-03", "2026-04-14",
    "2026-04-17", "2026-04-20", "2026-05-01", "2026-05-27", "2026-06-25", "2026-08-15",
    "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-09", "2026-11-10", "2026-11-24",
    "2026-12-25",
    "2027-01-26", "2027-03-22", "2027-03-26", "2027-04-14", "2027-05-01", "2027-08-15",
    "2027-10-02", "2027-11-01", "2027-12-25",
}

HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
# NSE cash symbols: RELIANCE, M&M, BAJAJ-AUTO, 3MINDIA
NSE_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.&-]{0,20}$")


class TradeError(ValueError):
    """User-facing refusal from the Trade desk."""


def now_ist(now_utc: dt.datetime | None = None) -> dt.datetime:
    if now_utc is None:
        return dt.datetime.now(IST)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=UTC)
    return now_utc.astimezone(IST)


def to_utc_naive(local_ist: dt.datetime) -> dt.datetime:
    """Naive UTC from an IST-local naive or aware datetime."""
    if local_ist.tzinfo is None:
        local_ist = local_ist.replace(tzinfo=IST)
    return local_ist.astimezone(UTC).replace(tzinfo=None)


def parse_now(text: str | None) -> dt.datetime:
    """ISO / 'YYYY-MM-DD HH:MM' -> naive UTC. Bare local times are IST."""
    if not text:
        return dt.datetime.now(UTC).replace(microsecond=0, tzinfo=None)
    t = text.strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(t)
    except ValueError as e:
        raise TradeError('--now wants IST like "2026-10-19 10:15" or ...Z (UTC)') from e
    if parsed.tzinfo is None:
        return to_utc_naive(parsed)
    return (parsed - parsed.utcoffset()).replace(tzinfo=None)  # type: ignore[operator]


def parse_hhmm(text: str, what: str = "time") -> dt.time:
    m = HHMM.match((text or "").strip())
    if not m:
        raise TradeError(f"{what} wants HH:MM, got {text!r}")
    return dt.time(int(m.group(1)), int(m.group(2)))


def trading_day(d: dt.date) -> tuple[bool, str]:
    if d.weekday() >= 5:
        return False, "weekend"
    if d.isoformat() in NSE_HOLIDAYS:
        return False, f"NSE holiday ({d.isoformat()})"
    return True, ""


def session_times(d: dt.date) -> tuple[dt.time, dt.time] | None:
    ok, _ = trading_day(d)
    if not ok:
        return None
    return OPEN, CLOSE


def slot_start(day: dt.date, k: int) -> dt.datetime:
    return dt.datetime.combine(day, OPEN) + dt.timedelta(minutes=BAR_MIN * k)


def clock12(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def clock24(minutes: int) -> str:
    return "%02d:%02d" % divmod(minutes, 60)


def parse_clock(text: str, what: str = "time") -> int:
    """'10:15 AM', '10:15am', '15:20' -> minutes after midnight."""
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*(?:([AaPp])\.?\s*[Mm]\.?)?\s*$", str(text or ""))
    if not m:
        raise TradeError(f"{what} wants a clock like 10:15 AM or 15:20, got {text!r}")
    h, mi, ap = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
    if mi > 59 or h > 23 or (ap and not 1 <= h <= 12):
        raise TradeError(f"{what} {text!r} is not a clock time")
    if ap == "p" and h != 12:
        h += 12
    elif ap == "a" and h == 12:
        h = 0
    elif not ap and 1 <= h <= 8:
        h += 12
    return h * 60 + mi


def yahoo_symbol(sym: str, exchange: str = "NS") -> str:
    """Bare NSE ticker -> Yahoo chart symbol (RELIANCE -> RELIANCE.NS)."""
    s = sym.strip().upper().replace(".NS", "").replace(".BO", "")
    if not NSE_SYMBOL.match(s):
        raise TradeError(f"not an NSE cash symbol: {sym!r}")
    suffix = "BO" if exchange.upper() in ("BSE", "BO") else "NS"
    return f"{s}.{suffix}"


def bare_symbol(sym: str) -> str:
    return sym.strip().upper().replace(".NS", "").replace(".BO", "")


def money_inr(x: float) -> str:
    return "₹{:,.2f}".format(float(x)).replace(".00", "")
