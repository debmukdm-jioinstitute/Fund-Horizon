"""Time Machine: Monte Carlo + history replay for an NSE day-trade plan."""

from __future__ import annotations

import math
import random
import statistics
from typing import Any

from app.backoffice.trade.session import (
    CLOSE_MIN,
    OPEN_MIN,
    SESSION_BARS,
    TradeError,
    clock12,
    parse_clock,
)

MIN_SESSIONS = 20
SAMPLE_PATHS = 160
BAND_PATHS = 2000
BAND_Q = (0.05, 0.25, 0.5, 0.75, 0.95)
HIST_BINS = 24
COIN_FLIP = 0.05
STRONG = 0.15
MANY_NEITHER = 0.40


def split_sessions(bars: list[dict]) -> dict[str, dict[int, dict]]:
    days: dict[str, dict[int, dict]] = {}
    for b in bars:
        days.setdefault(b["date"], {})[b["slot"]] = b
    return days


def full_sessions(days: dict[str, dict[int, dict]], before: str) -> tuple[list[tuple[str, list[dict]]], list[dict]]:
    full, short = [], []
    for d in sorted(days):
        if d >= before:
            continue
        s = days[d]
        if len(s) == SESSION_BARS:
            full.append((d, [s[i] for i in range(SESSION_BARS)]))
        else:
            short.append({"date": d, "bars": len(s)})
    return full, short


def build_pool(sessions: list[tuple[str, list[dict]]]) -> list[list[tuple]]:
    pool: list[list[tuple]] = [[] for _ in range(SESSION_BARS)]
    for _, D in sessions:
        for i in range(1, SESSION_BARS):
            pc = D[i - 1]["c"]
            pool[i].append((D[i]["o"] / pc, D[i]["h"] / pc, D[i]["l"] / pc, D[i]["c"] / pc))
    return pool


def pct(a: list[float], q: float) -> float:
    return a[min(len(a) - 1, int(q * len(a)))]


def simulate(
    pool: list[list[tuple]],
    entry: float,
    stop: float,
    target: float,
    k: int,
    last: int,
    replays: int = 10_000,
    seed: int = 19,
    window: int = 2,
    side: str = "buy",
) -> dict[str, Any]:
    long = side == "buy"
    risk = (entry - stop) if long else (stop - entry)
    r_target = round(((target - entry) if long else (entry - target)) / risk, 4)

    def slot(rng: random.Random, i: int) -> int:
        return i if window == 0 else min(SESSION_BARS - 1, max(1, i + rng.randint(-window, window)))

    rng = random.Random(seed)
    choice = rng.choice
    outcomes, closes, paths = [], [], []
    for n in range(replays):
        p = entry
        outcome = None
        keep = n < SAMPLE_PATHS
        path = [entry]
        for i in range(k + 1, last + 1):
            _o, h, l, c = choice(pool[slot(rng, i)])
            hi, lo, cl = p * h, p * l, p * c
            if outcome is None:
                if long:
                    if lo <= stop:
                        outcome = "stop"
                    elif hi >= target:
                        outcome = "target"
                else:
                    if hi >= stop:
                        outcome = "stop"
                    elif lo <= target:
                        outcome = "target"
            p = cl
            if keep:
                path.append(round(p, 2))
        outcomes.append(outcome or "close")
        closes.append(p)
        if keep:
            paths.append(path)

    cnt = {x: outcomes.count(x) for x in ("target", "stop", "close")}
    green = sum(
        1
        for o, p in zip(outcomes, closes)
        if o == "target" or (o == "close" and (p > entry if long else p < entry))
    )
    Rs = [
        r_target
        if o == "target"
        else -1.0
        if o == "stop"
        else ((p - entry) if long else (entry - p)) / risk
        for o, p in zip(outcomes, closes)
    ]
    srt = sorted(closes)

    rng = random.Random(seed)
    choice = rng.choice
    allp = []
    for _ in range(BAND_PATHS):
        p = entry
        path = [entry]
        for i in range(k + 1, last + 1):
            _o, _h, _l, c = choice(pool[slot(rng, i)])
            p = p * c
            path.append(p)
        allp.append(path)
    bands = []
    for j in range(last - k + 1):
        col = sorted(pp[j] for pp in allp)
        bands.append([round(pct(col, q), 2) for q in BAND_Q])
    lo_, hi_ = pct(srt, 0.01), pct(srt, 0.99)
    W = (hi_ - lo_) / HIST_BINS
    bins = [0] * HIST_BINS
    for c in srt:
        b = int((c - lo_) / W) if W > 0 else 0
        if 0 <= b < HIST_BINS:
            bins[b] += 1
    return {
        "replays": replays,
        "seed": seed,
        "window": window,
        "bars_left": last - k,
        "p_target": round(cnt["target"] / replays, 4),
        "p_stop": round(cnt["stop"] / replays, 4),
        "p_neither": round(cnt["close"] / replays, 4),
        "p_green": round(green / replays, 4),
        "median_close": round(pct(srt, 0.5), 2),
        "p5_close": round(pct(srt, 0.05), 2),
        "p95_close": round(pct(srt, 0.95), 2),
        "avg_R": round(statistics.mean(Rs), 3),
        "r_at_target": r_target,
        "band_paths": BAND_PATHS,
        "bands": bands,
        "sample_paths": paths,
        "hist": {"lo": round(lo_, 2), "hi": round(hi_, 2), "bins": bins},
    }


def cents_away(x: float, long: bool) -> float:
    c = round(x * 100, 4)
    return (math.floor(c) if long else math.ceil(c)) / 100.0


def opening_range(D: list[dict], n: int) -> tuple[float, float]:
    rows = [D[i] for i in range(n)]
    return max(b["h"] for b in rows), min(b["l"] for b in rows)


def rule_stop(rule: dict, oh: float, ol: float, entry: float, long: bool) -> float:
    r = rule["stop_rule"]
    if r == "or_mid":
        return cents_away((oh + ol) / 2, long)
    if r in ("or_low", "or_high"):
        return cents_away(ol if long else oh, long)
    frac = rule["stop_pct"] / 100.0
    return cents_away(entry * (1 - frac) if long else entry * (1 + frac), long)


def history_replay(sessions: list[tuple[str, list[dict]]], rule: dict, last: int, side: str = "buy") -> dict:
    long = side == "buy"
    n = rule["or_minutes"] // 5
    trades = []
    for d, D in sessions:
        oh, ol = opening_range(D, n)
        kk = next((i for i in range(n, last + 1) if (D[i]["c"] > oh if long else D[i]["c"] < ol)), None)
        if kk is None:
            continue
        e = round(D[kk]["c"], 2)
        s = rule_stop(rule, oh, ol, e, long)
        risk = (e - s) if long else (s - e)
        if risk <= 0:
            continue
        t = round(e + rule["target_r"] * risk, 2) if long else round(e - rule["target_r"] * risk, 2)
        oc = None
        for b in D[kk + 1 : last + 1]:
            if (b["l"] <= s) if long else (b["h"] >= s):
                oc = "stop"
                break
            if (b["h"] >= t) if long else (b["l"] <= t):
                oc = "target"
                break
        cl = D[last]["c"]
        R = (
            ((t - e) if long else (e - t)) / risk
            if oc == "target"
            else -1.0
            if oc == "stop"
            else ((cl - e) if long else (e - cl)) / risk
        )
        trades.append({
            "date": d,
            "time": clock12(OPEN_MIN + 5 * (kk + 1)),
            "entry": e,
            "stop": s,
            "target": t,
            "outcome": oc or "close",
            "R": round(R, 2),
        })
    return {
        "sessions": len(sessions),
        "triggered": len(trades),
        "target": sum(1 for x in trades if x["outcome"] == "target"),
        "stop": sum(1 for x in trades if x["outcome"] == "stop"),
        "close": sum(1 for x in trades if x["outcome"] == "close"),
        "green": sum(1 for x in trades if x["R"] > 0),
        "avg_R": round(statistics.mean(x["R"] for x in trades), 3) if trades else None,
        "rule": rule,
        "trades": trades,
    }


def lean(mc: dict) -> tuple[float, float, float] | None:
    pt, ps = mc["p_target"], mc["p_stop"]
    if pt + ps <= 0:
        return None
    r = mc.get("r_at_target") or 1.0
    share, even = pt / (pt + ps), 1.0 / (1.0 + r)
    return share - even, share, even


def verdict(mc: dict) -> str:
    pt, ps = mc["p_target"], mc["p_stop"]
    lv = lean(mc)
    until = mc.get("until") or "15:20"
    if lv is None:
        return f"No replay reached the target or the stop by {until}: the price at flat-by decides every one."
    d, share, even = lv
    r = mc.get("r_at_target") or 1.0
    one_r = abs(r - 1.0) < 0.005
    if abs(d) < COIN_FLIP:
        head = "Close to a coin flip" if one_r else "Close to break-even"
    elif abs(d) < STRONG:
        head = "Leans toward the target" if d > 0 else "Leans toward the stop"
    else:
        head = "Strongly toward the target" if d > 0 else "Strongly toward the stop"
    odds = f"target first {100 * pt:.1f} % vs stop first {100 * ps:.1f} %"
    if one_r:
        return f"{head}: {odds}."
    return (
        f"{head}: at {round(r, 2)}R the target has to come first in {100 * even:.0f} % of the "
        f"replays that hit one side; it did in {100 * share:.0f} % ({odds})."
    )


def verdict_notes(mc: dict) -> list[str]:
    notes = []
    pn = mc.get("p_neither", 0)
    if pn > MANY_NEITHER and lean(mc) is not None:
        notes.append(
            f"{100 * pn:.0f}% of replays hit neither side by flat-by — the close price decides those."
        )
    lv = lean(mc)
    if lv is not None and mc.get("avg_R") is not None:
        d, _, _ = lv
        if (d > 0 and mc["avg_R"] < 0) or (d < 0 and mc["avg_R"] > 0):
            notes.append(f"Average R is {mc['avg_R']:+.2f}, which runs against the lean.")
    notes.append(
        "Simulation from the stock's own recent bars is not a prediction: "
        "earnings, news, and halts can do what the last 60 days never did."
    )
    return notes


def normalize_plan(raw: dict) -> dict:
    sym = str(raw.get("symbol") or "").strip().upper()
    if not sym:
        raise TradeError("plan needs a symbol")
    side = str(raw.get("side") or "buy").lower()
    if side != "buy":
        raise TradeError("v1 Time Machine runs long plans only")
    try:
        date = __import__("datetime").date.fromisoformat(str(raw.get("date") or "")).isoformat()
    except ValueError as e:
        raise TradeError("plan needs a date like 2026-10-19") from e
    entry, stop, target = float(raw["entry"]), float(raw["stop"]), float(raw["target"])
    if not stop < entry < target:
        raise TradeError("a buy needs stop < entry < target")
    k = None
    if raw.get("entry_time"):
        close_min = parse_clock(raw["entry_time"], "entry_time")
        if (close_min - OPEN_MIN) % 5:
            raise TradeError("entry_time must land on the 5-minute grid")
        k = (close_min - OPEN_MIN) // 5 - 1
    if raw.get("entry_bar") is not None:
        kb = int(raw["entry_bar"])
        if k is not None and kb != k:
            raise TradeError("entry_bar disagrees with entry_time")
        k = kb
    if k is None:
        raise TradeError("plan needs entry_time or entry_bar")
    if not 0 <= k <= SESSION_BARS - 2:
        raise TradeError("entry must leave bars to replay before the close")
    orng = raw.get("opening_range") or {}
    or_min = int(orng.get("minutes", 15) if isinstance(orng, dict) else 15)
    risk = entry - stop
    return {
        "symbol": sym,
        "side": side,
        "date": date,
        "setup": str(raw.get("setup") or "orb"),
        "entry": entry,
        "entry_time": clock12(OPEN_MIN + 5 * (k + 1)),
        "entry_bar": k,
        "stop": stop,
        "target": target,
        "risk_per_share": round(risk, 2),
        "target_r": round((target - entry) / risk, 2),
        "opening_range": dict(orng, minutes=or_min) if isinstance(orng, dict) else {"minutes": or_min},
        "stop_rule": str(raw.get("stop_rule") or "or_mid"),
        "interval": "5m",
        "flat_by": raw.get("flat_by") or "15:20",
        "market": "NSE",
        "currency": "INR",
    }


def run_time_machine(
    plan: dict,
    bars_60d: list[dict],
    *,
    replays: int = 10_000,
    seed: int = 19,
    window: int = 2,
    until: str | None = None,
) -> dict[str, Any]:
    """bars_60d: [{date, slot, o,h,l,c}, ...] across many sessions."""
    p = normalize_plan(plan)
    days = split_sessions(bars_60d)
    sessions, short = full_sessions(days, p["date"])
    if len(sessions) < MIN_SESSIONS:
        raise TradeError(
            f"need at least {MIN_SESSIONS} full NSE sessions before {p['date']} "
            f"(got {len(sessions)}; short/half days: {len(short)})"
        )
    until_txt = until or p.get("flat_by") or "15:20"
    until_min = parse_clock(until_txt, "until")
    if until_min > CLOSE_MIN:
        until_min = CLOSE_MIN
    last = (until_min - OPEN_MIN) // 5 - 1
    if last <= p["entry_bar"]:
        raise TradeError("until must be after the entry bar")
    pool = build_pool(sessions)
    for i in range(p["entry_bar"] + 1, last + 1):
        if not pool[i]:
            raise TradeError(f"empty ratio pool at bar slot {i}")
    mc = simulate(
        pool,
        p["entry"],
        p["stop"],
        p["target"],
        p["entry_bar"],
        last,
        replays=replays,
        seed=seed,
        window=window,
        side=p["side"],
    )
    mc["until"] = f"{until_min // 60:02d}:{until_min % 60:02d}"
    rule = {
        "setup": "orb",
        "or_minutes": p["opening_range"]["minutes"],
        "stop_rule": p["stop_rule"] if p["stop_rule"] in ("or_mid", "or_low") else "pct",
        "target_r": p["target_r"],
        "stop_pct": round(100.0 * p["risk_per_share"] / p["entry"], 4),
    }
    hist = history_replay(sessions, rule, last, side=p["side"]) if p["setup"] == "orb" else None
    return {
        "created_by": "fh-trade-timemachine",
        "plan": p,
        "mc": mc,
        "history": hist,
        "verdict": verdict(mc),
        "verdict_notes": verdict_notes(mc),
        "sessions_used": len(sessions),
        "short_sessions": len(short),
        "market": "NSE",
        "currency": "INR",
        "session_bars": SESSION_BARS,
    }
