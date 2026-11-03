"""Trade desk: India session maths, full pipeline, API auth, and stress checks."""

from __future__ import annotations

import hashlib
import math
import secrets
from datetime import UTC, date, datetime, timedelta

import pytest

from app.backoffice.trade import indicators, scanner, entry, exit_plan, timemachine, budget, risk, broker, news, alerts
from app.backoffice.trade.session import (
    OPEN_MIN,
    SESSION_BARS,
    TradeError,
    trading_day,
    yahoo_symbol,
)
from app.backoffice.trade.service import TradeService
from app.db import sqlite


# ---------------------------------------------------------------------------
# Synthetic NSE bars
# ---------------------------------------------------------------------------

def _make_day_bars(day: str, base: float = 2500.0, drift: float = 0.0, seed: int = 1) -> list[dict]:
    """75 five-minute bars for one NSE cash session (09:15–15:30)."""
    rng = __import__("random").Random(seed)
    bars = []
    px = base
    for slot in range(SESSION_BARS):
        ret = drift + rng.uniform(-0.002, 0.002)
        o = px
        c = px * (1 + ret)
        h = max(o, c) * (1 + rng.uniform(0, 0.0015))
        l = min(o, c) * (1 - rng.uniform(0, 0.0015))
        bars.append({"date": day, "slot": slot, "o": o, "h": h, "l": l, "c": c, "v": 10000 + rng.randint(0, 5000)})
        px = c
    return bars


def _orb_breakout_day(day: str = "2026-10-19", base: float = 2500.0) -> list[dict]:
    """Deterministic ORB: range 09:15–09:30, first close above high at bar index 8 (closes 10:00)."""
    bars = []
    # OR bars 0,1,2: high=2510, low=2490
    levels = [
        (2495, 2505, 2490, 2500),
        (2500, 2510, 2495, 2505),
        (2505, 2508, 2498, 2502),
    ]
    for slot, (o, h, l, c) in enumerate(levels):
        bars.append({"date": day, "slot": slot, "o": o, "h": h, "l": l, "c": c, "v": 20000})
    px = 2502.0
    for slot in range(3, SESSION_BARS):
        if slot == 8:
            o, h, l, c = 2508, 2520, 2506, 2515  # close above OR high 2510
        elif slot < 8:
            o = px
            c = px + 0.5
            h, l = c + 1, o - 1
        else:
            o = px
            c = px + (1.5 if slot < 40 else -0.8)
            h, l = max(o, c) + 2, min(o, c) - 2
        bars.append({"date": day, "slot": slot, "o": o, "h": h, "l": l, "c": c, "v": 15000})
        px = c
    return bars


def _chart_from_day(bars: list[dict], day: str = "2026-10-19") -> dict:
    """Yahoo-ish chart arrays in UTC timestamps for one IST session day."""
    from zoneinfo import ZoneInfo

    IST = ZoneInfo("Asia/Kolkata")
    t, o, h, l, c, v = [], [], [], [], [], []
    d = date.fromisoformat(day)
    for b in bars:
        if b["date"] != day:
            continue
        start = datetime(d.year, d.month, d.day, 9, 15, tzinfo=IST) + timedelta(minutes=5 * b["slot"])
        t.append(int(start.astimezone(UTC).timestamp()))
        o.append(b["o"])
        h.append(b["h"])
        l.append(b["l"])
        c.append(b["c"])
        v.append(b["v"])
    return {
        "symbol": "RELIANCE",
        "t": t,
        "o": o,
        "h": h,
        "l": l,
        "c": c,
        "v": v,
        "meta": {"regularMarketPrice": c[-1] if c else None, "regularMarketVolume": sum(v), "currency": "INR"},
    }


def _pool_60d(end: str = "2026-10-19", n: int = 40, base: float = 2500.0) -> list[dict]:
    """n full sessions before end date (skip weekends/holidays)."""
    d = date.fromisoformat(end) - timedelta(days=1)
    out = []
    seed = 1
    while len([x for x in out if True]) // SESSION_BARS < n and seed < 500:
        ok, _ = trading_day(d)
        if ok:
            out.extend(_make_day_bars(d.isoformat(), base=base * (1 + 0.0005 * seed), seed=seed))
        d -= timedelta(days=1)
        seed += 1
        if sum(1 for b in out if b["slot"] == 0) >= n:
            break
    return out


# ---------------------------------------------------------------------------
# Unit: session / indicators / scanner / entry / exit / TM / budget / risk / broker
# ---------------------------------------------------------------------------

def test_yahoo_symbol_nse():
    assert yahoo_symbol("reliance") == "RELIANCE.NS"
    assert yahoo_symbol("M&M", "BSE") == "M&M.BO"
    with pytest.raises(TradeError):
        yahoo_symbol("!!!")


def test_session_bars_count():
    assert SESSION_BARS == 75
    assert OPEN_MIN == 9 * 60 + 15


def test_rsi_and_setups():
    closes = [100 + i * 0.5 for i in range(40)]
    closes[-1] = max(closes[:-1]) + 1  # breakout
    tags, nums = indicators.find_setups(closes)
    assert "breakout_20d" in tags
    assert nums["rsi"] is not None


def test_orb_hit_and_entry_trigger():
    day = "2026-10-19"
    bars = _orb_breakout_day(day)
    hit = indicators.orb_hit(bars, 3)
    assert hit is not None
    assert hit["price"] == 2515
    assert hit["or_high"] == 2510

    # Entry evaluate with chart-like bars (start datetimes)
    from zoneinfo import ZoneInfo

    IST = ZoneInfo("Asia/Kolkata")
    d = date.fromisoformat(day)
    chart_bars = []
    for b in bars:
        start = datetime(d.year, d.month, d.day, 9, 15, tzinfo=IST).replace(tzinfo=None) + timedelta(minutes=5 * b["slot"])
        chart_bars.append({**b, "start": start})
    res = entry.evaluate("RELIANCE", chart_bars, now="2026-10-19 10:05", setup="orb", or_minutes=15)
    assert res["status"] == "triggered"
    assert res["trigger"]["price"] == 2515


def test_exit_plan_or_mid_1r():
    plan = exit_plan.build_plan(
        symbol="RELIANCE",
        entry=2515,
        date="2026-10-19",
        stop="or-mid",
        target="1R",
        or_high=2510,
        or_low=2490,
        entry_time="10:00 AM",
        entry_bar=8,
    )
    # mid = 2500, risk = 15, target = 2530
    assert plan["stop"] == 2500.0
    assert plan["target"] == 2530.0
    assert plan["reward_risk"] == 1.0
    assert plan["currency"] == "INR"
    assert plan["flat_by"] == "15:20"


def test_timemachine_reproducible():
    plan = {
        "symbol": "RELIANCE",
        "side": "buy",
        "date": "2026-10-19",
        "setup": "orb",
        "entry": 2515,
        "stop": 2500,
        "target": 2530,
        "entry_time": "10:00 AM",
        "entry_bar": 8,
        "stop_rule": "or_mid",
        "opening_range": {"high": 2510, "low": 2490, "minutes": 15},
        "flat_by": "15:20",
    }
    bars = _pool_60d("2026-10-19", n=25)
    a = timemachine.run_time_machine(plan, bars, replays=500, seed=19)
    b = timemachine.run_time_machine(plan, bars, replays=500, seed=19)
    assert a["mc"]["p_target"] == b["mc"]["p_target"]
    assert a["mc"]["p_stop"] == b["mc"]["p_stop"]
    assert a["verdict"]
    assert a["session_bars"] == 75


def test_budget_and_risk_and_yes():
    plan = exit_plan.build_plan(
        symbol="RELIANCE",
        entry=2515,
        date="2026-10-19",
        stop="or-mid",
        target="1R",
        or_high=2510,
        or_low=2490,
        entry_time="10:00 AM",
        entry_bar=8,
    )
    sizing = budget.size_trade(plan, {"budget": 500_000, "max_loss_per_trade_inr": 5_000, "max_order_inr": 400_000})
    assert sizing["qty"] > 0
    order = budget.bracket_order(sizing)
    assert order and order["order_class"] == "bracket"
    assert order["product"] == "MIS"

    verdict = risk.check(
        [order],
        {"budget": 500_000, "max_loss_per_trade_inr": 5_000, "paper": True},
        portfolio={"cash": 500_000, "positions": {}},
        prices={"RELIANCE": 2515},
        now="2026-10-19 10:05",
        today="2026-10-19",
    )
    assert verdict["pass"] == 1
    assert verdict["results"][0]["verdict"] == "PASS"

    ok, why = broker.parse_yes("yes RELIANCE", order)
    assert ok
    bad, _ = broker.parse_yes("sure", order)
    assert not bad
    batch, _ = broker.parse_yes("yes to all", order)
    assert not batch


def test_news_tags_india():
    board = news.build_news_board(
        [{"title": "SEBI clears open offer; Q2 results beat estimates", "ticker": "TCS"}],
        moves={"TCS": {"price": 4000, "prev_close": 3800, "pct": 5.2}},
    )
    assert "sebi" in board["items"][0]["tags"]
    assert "results" in board["items"][0]["tags"]
    assert board["moves"][0]["flag"] == "MOVING"


def test_alerts_stop_rings_once():
    rules = [{"id": "s1", "type": "stop", "symbol": "RELIANCE", "price": 2500}]
    a = alerts.evaluate_alerts(rules, {"RELIANCE": 2490}, now="2026-10-19T10:00:00+05:30")
    assert len(a["rings"]) == 1
    b = alerts.evaluate_alerts(rules, {"RELIANCE": 2480}, now="2026-10-19T10:05:00+05:30", fired=set(a["fired"]))
    assert len(b["rings"]) == 0


# ---------------------------------------------------------------------------
# Stress: many symbols, many sessions, sequential risk
# ---------------------------------------------------------------------------

def test_stress_daily_scan_nifty_universe():
    from app.backoffice.trade import universe

    syms = universe.symbols("nifty50")
    assert len(syms) == 50
    data = {}
    for i, s in enumerate(syms):
        closes = [1000 + i * 10 + math.sin(j / 3) * 20 + j * 0.4 for j in range(45)]
        if i % 7 == 0:
            closes[-1] = max(closes[:-1]) + 5  # force some breakouts
        data[s] = {
            "c": closes,
            "t": list(range(len(closes))),
            "meta": {"regularMarketPrice": closes[-1], "regularMarketVolume": 200_000 + i * 1000},
        }
    result = scanner.scan_daily(data, syms, now="2026-10-19 08:00", min_price=50, min_volume=100_000)
    assert result["counts"]["scanned"] == 50
    assert result["counts"]["hits"] >= 1


def test_stress_risk_blocks_over_daily_loss():
    plan = {"entry": 100, "stop": 90, "target": 120, "setup": "orb", "entry_time": "10:00", "flat_by": "15:20", "max_loss": 5000}
    orders = []
    for sym in ["AAA", "BBB", "CCC", "DDD"]:
        orders.append({
            "symbol": sym,
            "side": "buy",
            "qty": "100",
            "type": "market",
            "time_in_force": "day",
            "order_class": "bracket",
            "take_profit_limit_price": "120.00",
            "stop_loss_stop_price": "90.00",
            "plan": {**plan, "max_loss": 1000},
        })
    cfg = {
        "budget": 1_000_000,
        "max_loss_per_trade_inr": 5_000,
        "max_daily_loss_inr": 2_500,
        "max_trades_per_day": 10,
        "max_orders_per_day": 20,
        "max_order_inr": 500_000,
        "paper": True,
    }
    res = risk.check(
        orders, cfg,
        portfolio={"cash": 1_000_000, "positions": {}},
        prices={s: 100 for s in ["AAA", "BBB", "CCC", "DDD"]},
        now="2026-10-19 10:05",
        today="2026-10-19",
    )
    # First two may pass (1000+1000=2000), third should trip daily loss 2500
    assert res["block"] >= 1
    assert any(r["verdict"] == "BLOCK" for r in res["results"])


def test_stress_timemachine_10000_replays():
    plan = {
        "symbol": "RELIANCE",
        "side": "buy",
        "date": "2026-10-19",
        "setup": "orb",
        "entry": 2515,
        "stop": 2500,
        "target": 2530,
        "entry_time": "10:00 AM",
        "entry_bar": 8,
        "stop_rule": "or_mid",
        "opening_range": {"minutes": 15},
        "flat_by": "15:20",
    }
    bars = _pool_60d("2026-10-19", n=30)
    doc = timemachine.run_time_machine(plan, bars, replays=10_000, seed=19)
    assert doc["mc"]["replays"] == 10_000
    assert abs(doc["mc"]["p_target"] + doc["mc"]["p_stop"] + doc["mc"]["p_neither"] - 1.0) < 1e-6


# ---------------------------------------------------------------------------
# Service + API
# ---------------------------------------------------------------------------

def _create_staff():
    tag = secrets.token_hex(6)
    created = sqlite.create_customer(
        name="Trade Analyst",
        email=f"trade_{tag}@internal.fundhorizon",
        mobile=f"98{secrets.randbelow(90000000) + 10000000}",
        password_hash="pbkdf2_sha256$test",
        role="analyst",
    )
    sqlite.update_customer(created["id"], {"is_staff": 1, "status": "active"})
    return created["id"]


def _login(client, user_id):
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(
        user_id,
        hashlib.sha256(token.encode()).hexdigest(),
        (datetime.now(UTC) + timedelta(days=30)).isoformat(),
    )
    client.cookies.set("fh_session", token)
    return token


def test_service_full_pipeline(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "trade.db"))
    # Re-init sqlite on new path by creating a customer (opens schema)
    sid = "staff-trade-1"
    svc = TradeService()
    day = "2026-10-19"
    day_bars = _orb_breakout_day(day)
    chart = _chart_from_day(day_bars, day)
    pool = _pool_60d(day, n=25)
    # Ensure plan day ORB bars are not required in pool (pool is before plan date)
    svc.inject_bars(sid, "RELIANCE", chart, pool)

    orb = svc.scan_orb(sid, symbols=["RELIANCE"], now=f"{day} 10:05", at="10:05", min_price=1)
    assert orb["counts"]["hits"] >= 1

    ent = svc.check_entry(sid, "RELIANCE", now=f"{day} 10:05")
    assert ent["status"] == "triggered"

    plan = svc.make_plan(sid, {"stop": "or-mid", "target": "1R"})
    assert plan["stop"] < plan["entry"] < plan["target"]

    tm = svc.run_timemachine(sid, replays=500, seed=19)
    assert "verdict" in tm

    sized = svc.size_order(sid)
    assert sized["orders"]

    # Pin clock inside entry window
    rv = svc.check_risk(sid, now=f"{day} 10:05")
    assert rv["pass"] == 1

    tickets = svc.tickets(sid)
    assert tickets["tickets"][0]["ready"] is True
    ap = svc.approve(sid, 1, "yes RELIANCE")
    assert ap["ok"]
    filled = svc.fill(sid, 1)
    assert filled["ok"]
    assert "RELIANCE" in filled["portfolio"]["positions"]


def test_api_requires_staff(client):
    client.cookies.clear()
    assert client.get("/api/backoffice/trade").status_code == 401
    tag = secrets.token_hex(4)
    cust = sqlite.create_customer(
        name="Cust",
        email=f"c_{tag}@example.com",
        mobile=f"97{secrets.randbelow(90000000) + 10000000}",
        password_hash="pbkdf2_sha256$test",
        role="customer",
    )
    _login(client, cust["id"])
    assert client.get("/api/backoffice/trade").status_code == 403


def test_api_pipeline(client):
    sid = _create_staff()
    _login(client, sid)

    r = client.get("/api/backoffice/trade")
    assert r.status_code == 200
    assert r.json()["data"]["session"]["tz"] == "Asia/Kolkata"

    u = client.get("/api/backoffice/trade/universe?kind=nifty50")
    assert u.status_code == 200
    assert u.json()["count"] == 50

    day = "2026-10-19"
    chart = _chart_from_day(_orb_breakout_day(day), day)
    pool = _pool_60d(day, n=25)
    inj = client.post(
        "/api/backoffice/trade/bars",
        json={"symbol": "RELIANCE", "chart": chart, "bars_60d": pool},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert inj.status_code == 200, inj.text

    scan = client.post(
        "/api/backoffice/trade/scan/orb",
        json={"symbols": ["RELIANCE"], "now": f"{day} 10:05", "at": "10:05", "min_price": 1},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert scan.status_code == 200, scan.text
    assert scan.json()["counts"]["hits"] >= 1

    ent = client.post(
        "/api/backoffice/trade/entry",
        json={"symbol": "RELIANCE", "now": f"{day} 10:05"},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert ent.status_code == 200
    assert ent.json()["status"] == "triggered"

    plan = client.post(
        "/api/backoffice/trade/plan",
        json={"stop": "or-mid", "target": "1R"},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert plan.status_code == 200
    assert plan.json()["currency"] == "INR"

    tm = client.post(
        "/api/backoffice/trade/timemachine",
        json={"replays": 300, "seed": 19},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert tm.status_code == 200, tm.text
    assert "verdict" in tm.json()

    sized = client.post(
        "/api/backoffice/trade/size",
        json={},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert sized.status_code == 200
    assert sized.json()["orders"]

    rk = client.post(
        "/api/backoffice/trade/risk?now=2026-10-19%2010:05",
        headers={"sec-fetch-site": "same-origin"},
    )
    assert rk.status_code == 200
    assert rk.json()["pass"] == 1

    tickets = client.get("/api/backoffice/trade/tickets")
    assert tickets.status_code == 200
    assert tickets.json()["tickets"][0]["ready"] is True

    ap = client.post(
        "/api/backoffice/trade/approve",
        json={"index": 1, "reply": "yes RELIANCE"},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert ap.status_code == 200 and ap.json()["ok"]

    fill = client.post(
        "/api/backoffice/trade/fill",
        json={"index": 1},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert fill.status_code == 200 and fill.json()["ok"]

    desk = client.get("/api/backoffice/trade").json()["data"]
    assert "RELIANCE" in desk["portfolio"]["positions"]


def test_backoffice_pages_includes_trade():
    from app.api.backoffice import BACKOFFICE_PAGES
    from app.api.auth import PAGE_API

    assert "/backoffice/trade" in BACKOFFICE_PAGES
    assert PAGE_API["/backoffice/trade"] == ("/api/backoffice/trade",)
