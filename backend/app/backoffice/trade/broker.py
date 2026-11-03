"""Paper order tickets: risk PASS + explicit yes + fill simulation. No live broker."""

from __future__ import annotations

import re
from typing import Any

from app.backoffice.trade.risk import fingerprint, _f
from app.backoffice.trade.session import money_inr, now_ist, parse_now

YES_WORDS = {"yes", "y", "yeah", "yep"}
BATCH_WORDS = {"all", "everything", "batch", "both", "them"}
DOUBT_WORDS = {"if", "unless", "but", "maybe", "perhaps", "might", "should"}


def plain_parts(order: dict) -> list[str]:
    side = str(order.get("side", "")).upper()
    sym = order.get("symbol", "?")
    typ = str(order.get("type", "market"))
    qty = order.get("qty")
    parts = [f"{side} {qty} {sym}, {typ}, day (NSE paper)"]
    if order.get("stop_loss_stop_price") is not None:
        parts.append(f"stop-loss {order['stop_loss_stop_price']}")
    if order.get("take_profit_limit_price") is not None:
        parts.append(f"take-profit {order['take_profit_limit_price']}")
    plan = order.get("plan") or {}
    ml = _f(plan.get("max_loss"))
    if ml is not None:
        parts.append(f"max loss about {money_inr(ml)} if the stop fills exactly")
    return parts


def plain(order: dict) -> str:
    return " / ".join(plain_parts(order))


def amount_numbers(order: dict) -> list[float]:
    nums = []
    for k in ("qty", "limit_price", "stop_loss_stop_price", "take_profit_limit_price"):
        if order.get(k) is not None:
            v = _f(order[k])
            if v is not None:
                nums.append(v)
    plan = order.get("plan") or {}
    if _f(plan.get("max_loss")) is not None:
        nums.append(float(plan["max_loss"]))
    return nums


def parse_yes(reply: str, order: dict, batch_symbols: tuple | list = ()) -> tuple[bool, str]:
    raw = (reply or "").strip()
    if not raw:
        return False, "the reply is empty"
    if "?" in raw:
        return False, "the reply is a question, not a yes"
    words = re.findall(r"[a-z']+", raw.lower())
    if not words or words[0] not in YES_WORDS:
        return False, 'only a reply that starts with "yes" counts'
    if BATCH_WORDS & set(words):
        return False, "a yes covers one order at a time, not a batch"
    if DOUBT_WORDS & set(words[1:]):
        return False, "the reply has a condition or a doubt in it"
    sym = str(order.get("symbol", "")).upper()
    tokens = set(re.findall(r"[A-Z][A-Z0-9.&-]{0,15}", raw.upper()))
    others = {s.upper() for s in batch_symbols} - {sym}
    named = tokens & others
    if named:
        return False, f"the reply names {', '.join(sorted(named))}, but this order is for {sym}"
    nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", raw)]
    if nums:
        want = amount_numbers(order)
        if not any(abs(n - w) < 0.005 for n in nums for w in want):
            return False, f"the reply amounts do not match this order ({plain(order)})"
    return True, f"explicit yes for {plain(order)}"


def risk_verdict(risk: dict | None, fp: str, today: str) -> tuple[dict | None, str | None]:
    if not risk:
        return None, "risk has not checked these orders"
    if risk.get("date") != today:
        return None, f"risk check is from {risk.get('date')}, not today"
    for r in risk.get("results", []):
        if r.get("fingerprint") == fp:
            return r, None
    return None, "this exact order was not in the last risk check"


def status_of(order: dict, risk: dict | None, state: dict | None, today: str) -> tuple[bool, str, dict | None]:
    fp = fingerprint(order)
    rv, why = risk_verdict(risk, fp, today)
    if rv is None:
        return False, "NOT READY: " + why, None
    if rv.get("verdict") != "PASS":
        return False, "BLOCKED: " + "; ".join(rv.get("reasons", [])), rv
    for rec in reversed((state or {}).get("orders", [])):
        if rec.get("fingerprint") == fp and str(rec.get("date") or "")[:10] == today:
            return False, f"DONE: {rec.get('status')} at {rec.get('at')}", rv
    return True, "READY: risk PASS, waiting for your yes", rv


def ticket_view(orders: list[dict], risk: dict | None, state: dict | None, today: str | None = None) -> dict[str, Any]:
    ist = now_ist()
    today = today or ist.date().isoformat()
    tickets = []
    for i, o in enumerate(orders, 1):
        ready, label, rv = status_of(o, risk, state, today)
        tickets.append({
            "index": i,
            "order": o,
            "fingerprint": fingerprint(o),
            "ready": ready,
            "status": label,
            "plain": plain(o),
            "risk": rv,
        })
    return {
        "created_by": "fh-trade-broker",
        "date": today,
        "paper": True,
        "broker": "paper",
        "market": "NSE",
        "currency": "INR",
        "tickets": tickets,
        "note": "Paper only. No live broker. Nothing places until you type yes for that exact order.",
    }


def approve(
    orders: list[dict],
    index: int,
    reply: str,
    risk: dict | None,
    state: dict | None,
    today: str | None = None,
) -> dict[str, Any]:
    ist = now_ist()
    today = today or ist.date().isoformat()
    if index < 1 or index > len(orders):
        return {"ok": False, "reason": f"order index {index} out of range"}
    order = orders[index - 1]
    ready, label, rv = status_of(order, risk, state, today)
    if not ready:
        return {"ok": False, "reason": label, "risk": rv}
    ok, why = parse_yes(reply, order, [o.get("symbol") for o in orders])
    if not ok:
        return {"ok": False, "reason": why}
    rec = {
        "fingerprint": fingerprint(order),
        "symbol": order.get("symbol"),
        "side": order.get("side"),
        "qty": order.get("qty"),
        "status": "approved",
        "kind": "entry" if str(order.get("side")).lower() == "buy" else "exit",
        "max_loss": (order.get("plan") or {}).get("max_loss"),
        "date": today,
        "at": ist.isoformat(timespec="seconds"),
        "plain": plain(order),
        "why": why,
    }
    return {"ok": True, "record": rec, "order": order}


def apply_fill(portfolio: dict, symbol: str, side: str, qty: float, price: float) -> dict:
    """Mutate a copy of the paper portfolio."""
    out = {
        "cash": float(portfolio.get("cash") or 0),
        "positions": dict(portfolio.get("positions") or {}),
        "currency": "INR",
    }
    # Normalize list positions -> dict
    if isinstance(portfolio.get("positions"), list):
        out["positions"] = {
            str(p.get("symbol") or p.get("ticker")).upper(): float(p.get("qty") or p.get("shares") or 0)
            for p in portfolio["positions"]
            if p.get("symbol") or p.get("ticker")
        }
    sym = symbol.upper()
    q = float(qty)
    if side == "buy":
        out["cash"] = round(out["cash"] - q * price, 2)
        out["positions"][sym] = round(out["positions"].get(sym, 0) + q, 4)
    else:
        out["cash"] = round(out["cash"] + q * price, 2)
        out["positions"][sym] = round(out["positions"].get(sym, 0) - q, 4)
        if abs(out["positions"][sym]) < 1e-9:
            out["positions"].pop(sym, None)
    return out


def fill(
    orders: list[dict],
    index: int,
    state: dict,
    portfolio: dict,
    price: float | None = None,
    today: str | None = None,
) -> dict[str, Any]:
    """Paper-fill an approved order (entry at plan/limit price)."""
    ist = now_ist()
    today = today or ist.date().isoformat()
    order = orders[index - 1]
    fp = fingerprint(order)
    approved = None
    for rec in reversed(state.get("orders", [])):
        if rec.get("fingerprint") == fp and rec.get("status") == "approved" and str(rec.get("date"))[:10] == today:
            approved = rec
            break
    if not approved:
        return {"ok": False, "reason": "order is not approved today"}
    plan = order.get("plan") or {}
    px = float(price if price is not None else order.get("limit_price") or plan.get("entry") or 0)
    if px <= 0:
        return {"ok": False, "reason": "no fill price"}
    qty = float(order["qty"])
    side = str(order["side"]).lower()
    new_port = apply_fill(portfolio, order["symbol"], side, qty, px)
    fill_rec = {
        **approved,
        "status": "filled",
        "fill_price": px,
        "at": ist.isoformat(timespec="seconds"),
    }
    return {"ok": True, "record": fill_rec, "portfolio": new_port, "order": order}
