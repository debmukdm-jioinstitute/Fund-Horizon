"""Exit planner: stop and target before entry (INR)."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from app.backoffice.trade.indicators import MIN_RISK_PCT, atr, floor_paisa, round_paisa, D
from app.backoffice.trade.session import DEFAULTS, TradeError, money_inr


def parse_stop(text: str) -> tuple[str, Decimal | None]:
    t = str(text).strip().lower()
    if t in ("or-mid", "or_mid", "mid", "or-midpoint"):
        return "or_mid", None
    if t in ("or-low", "or_low", "low"):
        return "or_low", None
    m = re.match(r"^(price|pct|atr):\s*₹?\$?([0-9][0-9,]*\.?[0-9]*)$", t)
    if not m:
        raise TradeError("stop is or-mid, or-low, price:X, pct:X or atr:K")
    kind, val = m.group(1), D(m.group(2))
    if val <= 0:
        raise TradeError(f"stop {kind} needs a number above 0")
    if kind == "pct" and val >= 100:
        raise TradeError("stop pct:X needs X under 100")
    return kind, val


def parse_target(text: str) -> tuple[str, Decimal]:
    t = str(text).strip()
    m = re.match(r"^([0-9]*\.?[0-9]+)\s*[Rr]$", t)
    if m:
        r = D(m.group(1))
        if r <= 0:
            raise TradeError("target needs an R multiple above 0")
        return "r", r
    m = re.match(r"^price:\s*₹?\$?([0-9][0-9,]*\.?[0-9]*)$", t.lower())
    if m:
        return "price", D(m.group(1))
    raise TradeError("target is 2R, 1R, 1.5R ... or price:X")


def compute(
    entry: float | str | Decimal,
    stop_rule: str = "or_mid",
    stop_param: Decimal | None = None,
    target_rule: str = "r",
    target_param: Decimal | None = None,
    or_high: float | None = None,
    or_low: float | None = None,
    atr_value: float | None = None,
    atr_bars: int | None = None,
) -> dict[str, Any]:
    if target_param is None and target_rule == "r":
        target_param = Decimal("1")
    e = round_paisa(entry)
    if e <= 0:
        raise TradeError("entry must be above ₹0")
    detail = ""
    if stop_rule in ("or_mid", "or_low"):
        if or_high is None or or_low is None:
            raise TradeError(f"{stop_rule} stop needs opening range high and low")
        oh, ol = round_paisa(or_high), round_paisa(or_low)
        if oh <= ol:
            raise TradeError(f"opening-range high {money_inr(oh)} must be above low {money_inr(ol)}")
        if stop_rule == "or_mid":
            raw = (oh + ol) / 2
            label = "opening-range midpoint"
            detail = f"({money_inr(oh)} + {money_inr(ol)}) / 2"
        else:
            raw, label = ol, "opening-range low"
    elif stop_rule == "price":
        raw, label = stop_param, "your price"  # type: ignore[assignment]
    elif stop_rule == "pct":
        raw = e * (1 - stop_param / 100)  # type: ignore[operator]
        label = f"{stop_param}% under the entry"
    elif stop_rule == "atr":
        if atr_value is None:
            raise TradeError("atr stop needs session bars")
        a = D(round(atr_value, 6))
        raw = e - stop_param * a  # type: ignore[operator]
        label = f"{stop_param} x ATR({atr_bars}) under the entry"
    else:
        raise TradeError(f"unknown stop rule {stop_rule!r}")

    stop = floor_paisa(raw)
    if stop >= e:
        raise TradeError(f"stop {money_inr(stop)} is at or above entry {money_inr(e)}")
    if stop <= 0:
        raise TradeError(f"stop works out to {money_inr(stop)}")
    risk = e - stop
    floor_risk = e * MIN_RISK_PCT / 100
    if risk < floor_risk:
        raise TradeError(
            f"stop is {money_inr(risk)} under entry, less than 0.05% of price "
            f"({money_inr(floor_risk)} on {money_inr(e)}): too tight"
        )
    if target_rule == "r":
        target = round_paisa(e + target_param * risk)  # type: ignore[operator]
        t_label = f"{target_param}R"
    else:
        target = round_paisa(target_param)  # type: ignore[arg-type]
        t_label = None
    if target <= e:
        raise TradeError(f"target {money_inr(target)} is at or below entry {money_inr(e)}")
    rr = ((target - e) / risk).quantize(Decimal("0.01"))
    if t_label is None:
        t_label = f"your price ({rr}R)"
    return {
        "entry": float(e),
        "stop": float(stop),
        "stop_label": label,
        "stop_detail": detail,
        "target": float(target),
        "target_r": float(target_param if target_rule == "r" else rr),
        "target_label": t_label,
        "risk_per_share": float(risk),
        "reward_risk": float(rr),
        "currency": "INR",
    }


def build_plan(
    *,
    symbol: str,
    entry: float,
    date: str,
    setup: str = "orb",
    stop: str = "or-mid",
    target: str = "1R",
    or_high: float | None = None,
    or_low: float | None = None,
    entry_time: str | None = None,
    entry_bar: int | None = None,
    bars: list[dict] | None = None,
    flat_by: str | None = None,
    side: str = "buy",
) -> dict[str, Any]:
    if side != "buy":
        raise TradeError("v1 plans long (buy) day trades only")
    stop_rule, stop_param = parse_stop(stop)
    target_rule, target_param = parse_target(target)
    atr_value = atr_bars = None
    if stop_rule == "atr":
        if not bars:
            raise TradeError("atr stop needs bars")
        atr_value, atr_bars = atr(bars)
    nums = compute(
        entry,
        stop_rule,
        stop_param,
        target_rule,
        target_param,
        or_high=or_high,
        or_low=or_low,
        atr_value=atr_value,
        atr_bars=atr_bars,
    )
    return {
        "created_by": "fh-trade-exit",
        "symbol": symbol.upper(),
        "side": "buy",
        "date": date,
        "setup": setup,
        "interval": "5m",
        "entry": nums["entry"],
        "entry_time": entry_time,
        "entry_bar": entry_bar,
        "stop": nums["stop"],
        "stop_rule": stop_rule,
        "stop_label": nums["stop_label"],
        "target": nums["target"],
        "target_r": nums["target_r"],
        "target_label": nums["target_label"],
        "risk_per_share": nums["risk_per_share"],
        "reward_risk": nums["reward_risk"],
        "flat_by": flat_by or DEFAULTS["flat_by"],
        "opening_range": (
            {"high": or_high, "low": or_low, "minutes": 15}
            if or_high is not None and or_low is not None
            else None
        ),
        "market": "NSE",
        "currency": "INR",
        "note": "A stop is a plan, not a guarantee: a gap or circuit can fill past it.",
    }
