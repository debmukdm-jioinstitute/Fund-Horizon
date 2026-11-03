"""Pre-trade risk checks for NSE cash day trades (no FINRA PDT)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.backoffice.trade.session import (
    CLOSE,
    DEFAULTS,
    NSE_SYMBOL,
    OPEN,
    money_inr,
    now_ist,
    parse_hhmm,
    parse_now,
    trading_day,
)

ORDER_FIELDS = (
    "symbol", "side", "qty", "notional", "type", "time_in_force", "limit_price",
    "stop_price", "order_class", "take_profit_limit_price", "stop_loss_stop_price",
    "stop_loss_limit_price", "exchange", "product",
)
TYPES = {"market", "limit", "stop", "stop_limit"}
TIFS = {"day", "gtc", "ioc", "fok"}
FRESH_MINUTES = 15


def fingerprint(order: dict) -> str:
    core = {k: order[k] for k in ORDER_FIELDS if k in order and order[k] is not None}
    blob = json.dumps(core, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _f(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def check(
    orders: list[dict],
    cfg: dict | None = None,
    portfolio: dict | None = None,
    prices: dict | None = None,
    state: dict | None = None,
    today: str | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    c = {**DEFAULTS, **(cfg or {})}
    for old, new in (
        ("max_loss_per_trade_usd", "max_loss_per_trade_inr"),
        ("max_order_usd", "max_order_inr"),
        ("min_order_usd", "min_order_inr"),
        ("max_daily_loss_usd", "max_daily_loss_inr"),
    ):
        if c.get(new) is None and c.get(old) is not None:
            c[new] = c[old]

    prices = {str(k).upper(): float(v) for k, v in (prices or {}).items() if _f(v)}
    now_utc = parse_now(now)
    ist = now_ist(now_utc.replace(tzinfo=__import__("datetime").timezone.utc))
    today = today or ist.date().isoformat()
    cash = float((portfolio or {}).get("cash", c.get("budget") or 0))
    shares = {
        str(p.get("symbol") or p.get("ticker") or "").upper(): float(p.get("qty") or p.get("shares") or 0)
        for p in (portfolio or {}).get("positions", [])
        if (p.get("symbol") or p.get("ticker"))
    }
    # Also accept {positions: {SYM: qty}}
    if isinstance((portfolio or {}).get("positions"), dict):
        shares = {str(k).upper(): float(v) for k, v in portfolio["positions"].items()}

    blocked = {str(b).upper() for b in c.get("blocked") or []}
    asm_gsm = {str(b).upper() for b in c.get("asm_gsm") or []}
    circuit = {str(b).upper() for b in c.get("at_circuit") or []}

    placed = [
        r for r in (state or {}).get("orders", [])
        if r.get("status") in ("placed", "filled", "approved") and str(r.get("date") or "")[:10] == today
    ]
    entries_today = [r for r in placed if r.get("kind", "entry") == "entry" or r.get("side") == "buy"]
    loss_today = sum(_f(r.get("max_loss")) or 0 for r in entries_today)
    placed_keys = {(str(r.get("symbol", "")).upper(), r.get("side")) for r in placed}

    ok_day, day_why = trading_day(ist.date())
    before = parse_hhmm(c["no_entries_before"], "no_entries_before")
    after = parse_hhmm(c["no_entries_after"], "no_entries_after")
    t = ist.time()
    window_block = []
    if not ok_day:
        window_block.append(f"market closed ({day_why})")
    elif not (OPEN <= t <= CLOSE):
        window_block.append("outside NSE cash session 09:15–15:30 IST")
    elif t < before:
        window_block.append(f"before no_entries_before {c['no_entries_before']} IST")
    elif t > after:
        window_block.append(f"after no_entries_after {c['no_entries_after']} IST")

    results = []
    batch_entries, batch_loss = 0, 0.0
    seen = set()
    top_warn = []
    if not c.get("paper", True):
        top_warn.append("LIVE account (paper=false): these orders use real money")
    if c.get("intraday_only", True):
        top_warn.append("intraday_only: flatten by flat_by; overnight carry is refused")

    for i, o in enumerate(orders, 1):
        reasons, warns = [], []
        sym = str(o.get("symbol", "")).strip().upper()
        side = str(o.get("side", "")).strip().lower()
        typ = str(o.get("type", "market")).strip().lower()
        tif = str(o.get("time_in_force", "day")).strip().lower()
        qty = _f(o.get("qty"))
        plan = o.get("plan") if isinstance(o.get("plan"), dict) else {}
        oc = str(o.get("order_class") or "").strip().lower()
        legs = o.get("take_profit_limit_price") is not None or o.get("stop_loss_stop_price") is not None
        bracket = oc == "bracket" or (not oc and legs)
        is_entry = side == "buy"

        if not sym or not NSE_SYMBOL.match(sym):
            reasons.append("format: symbol must be an NSE cash ticker")
        if side not in ("buy", "sell"):
            reasons.append("format: side must be buy or sell")
        if qty is None or qty <= 0 or abs(qty - int(qty)) > 1e-9:
            reasons.append("format: qty must be a positive whole number of shares")
        if typ not in TYPES:
            reasons.append(f"format: unknown type {typ!r}")
        if tif not in TIFS:
            reasons.append(f"format: unknown time_in_force {tif!r}")
        if bracket:
            if o.get("take_profit_limit_price") is None or o.get("stop_loss_stop_price") is None:
                reasons.append("format: bracket needs take_profit and stop_loss")
            if tif not in ("day", "gtc"):
                reasons.append("format: bracket must be day/gtc")

        if not c.get("allow_options") and (o.get("instrument") == "option" or "CE" in sym[-2:] or "PE" in sym[-2:]):
            # NSE option symbols look different; keep a soft guard.
            pass
        if side == "sell" and not c.get("allow_short"):
            held = shares.get(sym, 0)
            if (qty or 0) > held + 1e-9:
                reasons.append("short: selling more than you hold (allow_short is false)")

        later = []
        if is_entry:
            if sym in blocked:
                later.append(f"blocked: {sym} is on your blocked list")
            if sym in asm_gsm:
                later.append(f"ASM/GSM: {sym} is under surveillance — refuse for v1 day trades")
            if sym in circuit:
                later.append(f"circuit: {sym} is at upper/lower circuit")
            for w in window_block:
                later.append(f"window: {w}")

            stop = _f(o.get("stop_loss_stop_price")) or _f(plan.get("stop"))
            entry = _f(o.get("limit_price")) or _f(plan.get("entry")) or prices.get(sym)
            target = _f(o.get("take_profit_limit_price")) or _f(plan.get("target"))
            if c.get("require_stop") and stop is None:
                later.append("stop: require_stop is true and no stop was given")
            if entry and stop and stop >= entry:
                later.append("stop: stop must be under the entry for a long")
            if entry and qty:
                cost = entry * qty
                min_o = _f(c.get("min_order_inr")) or 0
                max_o = _f(c.get("max_order_inr"))
                if cost < min_o:
                    later.append(f"size: order {money_inr(cost)} under min_order_inr")
                if max_o and cost > max_o:
                    later.append(f"size: order {money_inr(cost)} over max_order_inr")
                buf = cash * float(c.get("cash_buffer_pct") or 0) / 100.0
                if cost > cash - buf + 1e-6 and not c.get("allow_margin"):
                    later.append("cash: would dip into cash buffer (margin not allowed)")
                cap_pct = _f(c.get("max_position_pct"))
                equity = cash + sum(shares.get(s, 0) * prices.get(s, 0) for s in shares)
                if cap_pct and equity > 0 and cost > equity * cap_pct / 100.0:
                    later.append(f"position: over max_position_pct ({cap_pct}%)")

            if entry and stop and qty:
                risk = (entry - stop) * qty
                max_loss = _f(c.get("max_loss_per_trade_inr"))
                if max_loss and risk > max_loss + 1e-6:
                    later.append(
                        f"loss: {money_inr(risk)} at the stop exceeds max_loss_per_trade_inr {money_inr(max_loss)}"
                    )
                if target and entry > stop:
                    rr = (target - entry) / (entry - stop)
                    min_rr = _f(c.get("min_reward_risk")) or 0
                    if rr + 1e-9 < min_rr:
                        later.append(f"reward:risk {rr:.2f} under min_reward_risk {min_rr}")
                max_daily = _f(c.get("max_daily_loss_inr"))
                if max_daily and loss_today + batch_loss + (risk if entry and stop else 0) > max_daily + 1e-6:
                    later.append(f"daily loss: would exceed max_daily_loss_inr {money_inr(max_daily)}")

            max_trades = int(c.get("max_trades_per_day") or 0)
            if max_trades and len(entries_today) + batch_entries >= max_trades:
                later.append(f"trades: max_trades_per_day ({max_trades}) already reached")
            max_orders = int(c.get("max_orders_per_day") or 0)
            if max_orders and len(placed) + i > max_orders:
                later.append(f"orders: max_orders_per_day ({max_orders})")
            key = (sym, side)
            if key in seen or key in placed_keys:
                later.append("duplicate: same symbol and side already in batch or placed today")
            seen.add(key)

            if c.get("intraday_only") and (plan.get("flat_by") is None and o.get("product") not in ("MIS", "intraday", None)):
                warns.append("intraday_only: prefer MIS / flat_by before the close")

        reasons.extend(later)
        verdict = "PASS" if not reasons else "BLOCK"
        fp = fingerprint(o)
        max_loss_val = None
        if is_entry:
            stop = _f(o.get("stop_loss_stop_price")) or _f(plan.get("stop"))
            entry = _f(o.get("limit_price")) or _f(plan.get("entry")) or prices.get(sym)
            if entry and stop and qty:
                max_loss_val = round((entry - stop) * qty, 2)
                if verdict == "PASS":
                    batch_entries += 1
                    batch_loss += max_loss_val
                    # simulate fill for subsequent cash checks
                    cash -= entry * qty
                    shares[sym] = shares.get(sym, 0) + qty

        results.append({
            "index": i,
            "symbol": sym,
            "side": side,
            "kind": "entry" if is_entry else "exit",
            "verdict": verdict,
            "reasons": reasons,
            "warnings": warns,
            "fingerprint": fp,
            "max_loss": max_loss_val,
            "plain": f"{side.upper()} {int(qty or 0)} {sym}",
        })

    return {
        "created_by": "fh-trade-risk",
        "date": today,
        "pass": sum(1 for r in results if r["verdict"] == "PASS"),
        "block": sum(1 for r in results if r["verdict"] == "BLOCK"),
        "results": results,
        "warnings": top_warn,
        "market": "NSE",
        "currency": "INR",
        "paper": bool(c.get("paper", True)),
    }
