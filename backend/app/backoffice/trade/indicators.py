"""Pure chart maths: RSI, ATR, daily setups, ORB helpers."""

from __future__ import annotations

from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP

MIN_DAILY_BARS = 30
MIN_RISK_PCT = Decimal("0.05")
PAISA = Decimal("0.01")  # INR tick for v1 (₹0.01); real bands are coarser — shortcut: upgrade with NSE tick table


def rsi(closes: list[float], n: int = 14) -> float | None:
    """Wilder RSI on closes."""
    if len(closes) < n + 1:
        return None
    gains = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    losses = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n
    for i in range(n, len(gains)):
        ag = (ag * (n - 1) + gains[i]) / n
        al = (al * (n - 1) + losses[i]) / n
    return 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)


def find_setups(closes: list[float]) -> tuple[list[str], dict]:
    """Daily setup tags from closes (oldest first, >= 30)."""
    c = closes
    last = c[-1]
    hi20 = max(c[-21:-1])
    ma20 = sum(c[-20:]) / 20.0
    ma20_prev = sum(c[-21:-1]) / 20.0
    run = c[-6] / c[-16] - 1
    rng5 = (max(c[-5:]) - min(c[-5:])) / last
    r = rsi(c)
    r_prev = rsi(c[:-1])
    tags: list[str] = []
    if last > hi20:
        tags.append("breakout_20d")
    if run > 0.10 and rng5 < 0.05:
        tags.append("bull_flag")
    if c[-2] < ma20_prev and last > ma20:
        tags.append("reclaim_ma20")
    if r is not None and r < 30:
        tags.append("oversold")
    if r_prev is not None and r_prev < 30 and last > c[-2]:
        tags.append("oversold_bounce")
    return tags, {
        "rsi": r,
        "rsi_prev": r_prev,
        "high20": hi20,
        "ma20": ma20,
        "run_pct": run * 100,
        "range5_pct": rng5 * 100,
    }


def true_range(h: float, l: float, prev_c: float | None) -> float:
    if prev_c is None:
        return h - l
    return max(h - l, abs(h - prev_c), abs(l - prev_c))


def atr(bars: list[dict], n: int = 14) -> tuple[float, int]:
    """Mean of last ≤n true ranges. bars have h/l/c, oldest first."""
    if not bars:
        return 0.0, 0
    trs: list[float] = []
    prev = None
    for b in bars:
        trs.append(true_range(float(b["h"]), float(b["l"]), prev))
        prev = float(b["c"])
    use = trs[-n:] if len(trs) >= n else trs
    return (sum(use) / len(use), len(use)) if use else (0.0, 0)


def D(x) -> Decimal:
    if isinstance(x, float):
        return Decimal(repr(x))
    return Decimal(str(x).strip().lstrip("₹$").replace(",", ""))


def floor_paisa(x) -> Decimal:
    return D(x).quantize(PAISA, rounding=ROUND_FLOOR)


def round_paisa(x) -> Decimal:
    return D(x).quantize(PAISA, rounding=ROUND_HALF_UP)


def orb_candidate(bars: list[dict], n_range: int) -> bool:
    top = max(b["c"] for b in bars[:n_range])
    return any(b["c"] >= top for b in bars[n_range:])


def orb_hit(bars: list[dict], n_range: int) -> dict | None:
    """First completed bar to CLOSE above the opening-range high."""
    rng = bars[:n_range]
    if any(b.get("h") is None or b.get("l") is None for b in rng):
        return None
    oh = max(b["h"] for b in rng)
    ol = min(b["l"] for b in rng)
    for k in range(n_range, len(bars)):
        b = bars[k]
        if b["c"] > oh:
            return {
                "price": round(float(b["c"]), 2),
                "bar_index": k,
                "or_high": round(float(oh), 2),
                "or_low": round(float(ol), 2),
                "pct_over": round((b["c"] / oh - 1) * 100, 2),
                "start": b.get("start"),
            }
    return None
