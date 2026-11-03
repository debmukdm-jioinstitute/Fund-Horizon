"""Position sizing in INR for one day-trade bracket."""

from __future__ import annotations

import math
from typing import Any

from app.backoffice.trade.session import DEFAULTS, TradeError, money_inr

EPS = 1e-9
SETUP_WORDS = {"orb": "opening-range breakout", "flag": "flag", "bounce": "oversold bounce"}


def _f(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def round_cent(x: float) -> float:
    return math.floor(float(x) * 100 + 0.5 + EPS) / 100.0


def shares_for(inr: float, per_share: float) -> int:
    u, p = int(round(float(inr) * 100)), int(round(float(per_share) * 100))
    if p <= 0 or u <= 0:
        return 0
    return u // p


def _price(x: float) -> str:
    return f"{round_cent(x):.2f}"


def size_trade(
    plan: dict,
    cfg: dict | None = None,
    budget: float | None = None,
    limit: float | None = None,
    price: float | None = None,
    cash: float | None = None,
    today: str | None = None,
) -> dict[str, Any]:
    c = {**DEFAULTS, **(cfg or {})}
    # Accept legacy *_usd keys as INR for ported configs.
    for old, new in (
        ("max_loss_per_trade_usd", "max_loss_per_trade_inr"),
        ("max_order_usd", "max_order_inr"),
        ("min_order_usd", "min_order_inr"),
        ("max_daily_loss_usd", "max_daily_loss_inr"),
    ):
        if c.get(new) is None and c.get(old) is not None:
            c[new] = c[old]

    sym = str(plan.get("symbol") or "").strip().upper()
    if not sym:
        raise TradeError("plan has no symbol")
    if str(plan.get("side") or "buy").lower() != "buy":
        raise TradeError("sizes long (buy) day trades only")
    if today and plan.get("date") and str(plan["date"]) != today:
        raise TradeError(f"plan is for {plan['date']} and today is {today} IST")

    entry_plan, stop, target = _f(plan.get("entry")), _f(plan.get("stop")), _f(plan.get("target"))
    for name, v in (("entry", entry_plan), ("stop", stop), ("target", target)):
        if v is None or v <= 0:
            raise TradeError(f"plan needs a positive {name}")

    blocked = {str(b).upper() for b in (c.get("blocked") or [])}
    if sym in blocked:
        raise TradeError(f"{sym} is on your blocked list")

    budget = float(budget if budget is not None else (c.get("budget") or 0))
    if budget <= 0:
        raise TradeError("no budget: set budget in Trade config (INR)")
    buf_pct = float(c.get("cash_buffer_pct") or 0)
    if not 0 <= buf_pct < 100:
        raise TradeError("cash_buffer_pct must be between 0 and 100")

    if limit is not None:
        ref, ref_from = round_cent(limit), "limit"
    elif price is not None and round_cent(price) > round_cent(entry_plan):
        ref, ref_from = round_cent(price), "price"
    else:
        ref, ref_from = round_cent(entry_plan), "plan"
    stop, target = round_cent(stop), round_cent(target)
    if stop >= ref:
        raise TradeError(f"stop {_price(stop)} is not below entry {_price(ref)}")
    if target <= ref:
        raise TradeError(f"target {_price(target)} is not above entry {_price(ref)}")

    risk_c = int(round((ref - stop) * 100))
    reward_c = int(round((target - ref) * 100))
    risk = risk_c / 100.0

    cash_buffer = round(budget * buf_pct / 100.0, 2)
    available = budget - cash_buffer
    if cash is not None and cash - cash_buffer < available - 0.005:
        available = cash - cash_buffer
    available = max(round(available, 2), 0.0)

    # Optional friction buffer for STT+stamp+brokerage+GST on an equity delivery/intraday round trip.
    # shortcut: flat 0.1% haircut; upgrade with live broker fee schedule
    friction_pct = float(c.get("friction_pct") or 0.1)
    available = round(available * (1 - friction_pct / 100.0), 2)

    limits = []
    max_loss = _f(c.get("max_loss_per_trade_inr"))
    if max_loss:
        limits.append({
            "name": "max loss",
            "inr": max_loss,
            "shares": shares_for(max_loss, risk),
            "how": f"{money_inr(max_loss)} max loss / {_price(risk)} risk a share",
        })
    cap_pct = _f(c.get("max_position_pct"))
    if cap_pct:
        cap = round(budget * cap_pct / 100.0, 2)
        limits.append({
            "name": "position cap",
            "inr": cap,
            "shares": shares_for(cap, ref),
            "how": f"{cap_pct}% of {money_inr(budget)}",
        })
    max_order = _f(c.get("max_order_inr"))
    if max_order:
        limits.append({
            "name": "max order",
            "inr": max_order,
            "shares": shares_for(max_order, ref),
            "how": f"{money_inr(max_order)} / {_price(ref)}",
        })
    limits.append({
        "name": "cash",
        "inr": available,
        "shares": shares_for(available, ref),
        "how": f"cash after buffer and ~{friction_pct}% friction",
    })

    qty = max(0, min(l["shares"] for l in limits))
    bound = [l["name"] for l in limits if l["shares"] == qty][0]
    for l in limits:
        l["binds"] = l["name"] == bound
    cost = round(qty * ref, 2)
    loss = round(qty * risk_c / 100.0, 2)
    refusal = None
    if qty == 0:
        refusal = (
            f"one share risks {money_inr(risk)}, more than your {money_inr(max_loss or 0)} max loss"
            if bound == "max loss"
            else f"one share of {sym} costs {money_inr(ref)}, more than your {bound} limit"
        )
    elif _f(c.get("min_reward_risk")) and reward_c < _f(c["min_reward_risk"]) * risk_c - EPS:
        refusal = (
            f"reward:risk {reward_c / float(risk_c):.2f} is under your minimum {c['min_reward_risk']}"
        )
    elif cost < float(c.get("min_order_inr") or 0) - 0.005:
        refusal = f"{qty} share(s) of {sym} is {money_inr(cost)}, under minimum order"

    return {
        "symbol": sym,
        "side": "buy",
        "setup": plan.get("setup", ""),
        "date": plan.get("date"),
        "entry_time": plan.get("entry_time", ""),
        "entry_plan": round_cent(entry_plan),
        "entry": ref,
        "entry_from": ref_from,
        "stop": stop,
        "target": target,
        "risk_per_share": risk,
        "reward_risk": round(reward_c / float(risk_c), 2),
        "budget": budget,
        "cash_buffer_pct": buf_pct,
        "cash_buffer": cash_buffer,
        "cash_available": available,
        "friction_pct": friction_pct,
        "max_loss_per_trade_inr": max_loss,
        "limits": limits,
        "qty": qty,
        "bound_by": bound,
        "cost": cost,
        "max_loss": loss,
        "flat_by": plan.get("flat_by") or c.get("flat_by"),
        "order_type": "limit" if limit is not None else "market",
        "refusal": refusal,
        "currency": "INR",
        "market": "NSE",
    }


def bracket_order(s: dict) -> dict | None:
    if s.get("refusal") or s["qty"] <= 0:
        return None
    o = {
        "symbol": s["symbol"],
        "side": "buy",
        "qty": str(int(s["qty"])),
        "type": s["order_type"],
        "time_in_force": "day",
        "order_class": "bracket",
        "take_profit_limit_price": _price(s["target"]),
        "stop_loss_stop_price": _price(s["stop"]),
        "exchange": "NSE",
        "product": "MIS",  # intraday square-off product label (paper)
        "currency": "INR",
    }
    if s["order_type"] == "limit":
        o["limit_price"] = _price(s["entry"])
    setup = SETUP_WORDS.get(s["setup"], s["setup"] or "day trade")
    o["why"] = (
        f"{setup} on {s['symbol']}: {s['qty']} shares, bound by {s['bound_by']} "
        f"({s['qty']} x {_price(s['risk_per_share'])} = {money_inr(s['max_loss'])} at the stop)"
    )
    o["plan"] = {
        "entry": s["entry"],
        "stop": s["stop"],
        "target": s["target"],
        "risk_per_share": s["risk_per_share"],
        "max_loss": s["max_loss"],
        "setup": s["setup"],
        "entry_time": s["entry_time"],
        "flat_by": s["flat_by"],
    }
    return o
