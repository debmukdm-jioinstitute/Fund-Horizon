"""Trade desk orchestration for NSE cash equities."""

from __future__ import annotations

from typing import Any

from app.backoffice.trade import alerts as alerts_mod
from app.backoffice.trade import broker as broker_mod
from app.backoffice.trade import budget as budget_mod
from app.backoffice.trade import entry as entry_mod
from app.backoffice.trade import exit_plan as exit_mod
from app.backoffice.trade import news as news_mod
from app.backoffice.trade import risk as risk_mod
from app.backoffice.trade import scanner as scanner_mod
from app.backoffice.trade import store
from app.backoffice.trade import timemachine as tm_mod
from app.backoffice.trade import universe as universe_mod
from app.backoffice.trade import yahoo
from app.backoffice.trade.session import TradeError, now_ist


class TradeService:
    def desk(self, staff_id: str) -> dict[str, Any]:
        st = store.load_desk(staff_id)
        return {
            "config": st["config"],
            "universe": st["universe"],
            "watchlist": st.get("watchlist"),
            "entry": st.get("entry"),
            "plan": st.get("plan"),
            "timemachine": st.get("timemachine"),
            "orders": st.get("orders"),
            "risk": st.get("risk"),
            "portfolio": st.get("portfolio"),
            "broker": {"orders": (st.get("broker") or {}).get("orders", [])[-50:]},
            "alerts": st.get("alerts") or [],
            "news": st.get("news"),
            "session": {
                "tz": "Asia/Kolkata",
                "open": "09:15",
                "close": "15:30",
                "now": now_ist().isoformat(timespec="seconds"),
                "market": "NSE",
                "currency": "INR",
                "paper": True,
            },
            "updated_at": st.get("updated_at"),
            "disclaimer": (
                "Not financial advice. Paper trading only. NSE cash equities, IST session. "
                "Most people who day trade lose money."
            ),
        }

    def update_config(self, staff_id: str, patch: dict) -> dict:
        st = store.load_desk(staff_id)
        cfg = dict(st["config"])
        cfg.update({k: v for k, v in patch.items() if v is not None})
        st["config"] = cfg
        if "budget" in patch and patch["budget"]:
            # Reset paper cash only when empty portfolio
            port = st.get("portfolio") or {}
            if not port.get("positions"):
                st["portfolio"] = {"cash": float(patch["budget"]), "positions": {}, "currency": "INR"}
        store.save_desk(staff_id, st)
        return self.desk(staff_id)

    def get_universe(self, kind: str = "nifty50") -> dict:
        rows = universe_mod.universe(kind)
        return {"kind": kind, "count": len(rows), "symbols": rows, "market": "NSE"}

    def inject_bars(self, staff_id: str, symbol: str, chart: dict, bars_60d: list[dict] | None = None) -> dict:
        st = store.load_desk(staff_id)
        parsed = yahoo.parse_offline_chart(chart, symbol)
        st.setdefault("bars_cache", {})[parsed["symbol"]] = parsed
        if bars_60d is not None:
            st.setdefault("bars_60d", {})[parsed["symbol"]] = bars_60d
        store.save_desk(staff_id, st)
        return {"ok": True, "symbol": parsed["symbol"], "bars": len(parsed.get("c") or [])}

    def _charts(self, staff_id: str, symbols: list[str], live: bool = False) -> dict[str, dict]:
        st = store.load_desk(staff_id)
        cache = st.get("bars_cache") or {}
        out: dict[str, dict] = {}
        for sym in symbols:
            s = sym.upper()
            if s in cache:
                out[s] = cache[s]
            elif live and yahoo.live_enabled():
                try:
                    out[s] = yahoo.fetch_chart(s)
                    cache[s] = out[s]
                except TradeError:
                    continue
        if live and yahoo.live_enabled():
            st["bars_cache"] = cache
            store.save_desk(staff_id, st)
        return out

    def scan_daily(self, staff_id: str, *, symbols: list[str] | None = None, universe: str = "nifty50",
                   now: str | None = None, live: bool = False, min_price: float = 50,
                   min_volume: int = 100_000) -> dict:
        syms = symbols or universe_mod.symbols(universe)
        data = self._charts(staff_id, syms, live=live)
        if not data:
            raise TradeError(
                "no chart data: inject bars via POST /trade/bars or enable FH_TRADE_LIVE=1"
            )
        result = scanner_mod.scan_daily(data, list(data.keys()), now=now, min_price=min_price, min_volume=min_volume)
        st = store.load_desk(staff_id)
        st["watchlist"] = result
        st["universe"] = universe
        store.save_desk(staff_id, st)
        return result

    def scan_orb(self, staff_id: str, *, symbols: list[str] | None = None, universe: str = "nifty50",
                 now: str | None = None, at: str | None = None, or_minutes: int = 15,
                 live: bool = False, min_price: float = 50) -> dict:
        syms = symbols or universe_mod.symbols(universe)
        data = self._charts(staff_id, syms, live=live)
        if not data:
            raise TradeError("no chart data for ORB scan")
        result = scanner_mod.scan_orb(
            data, list(data.keys()), now=now, at=at, or_minutes=or_minutes, min_price=min_price
        )
        st = store.load_desk(staff_id)
        st["watchlist"] = result
        store.save_desk(staff_id, st)
        return result

    def check_entry(self, staff_id: str, symbol: str, *, setup: str = "orb", or_minutes: int = 15,
                    level: float | None = None, now: str | None = None, min_volume_x: float | None = None) -> dict:
        st = store.load_desk(staff_id)
        chart = (st.get("bars_cache") or {}).get(symbol.upper())
        if not chart:
            if yahoo.live_enabled():
                chart = yahoo.fetch_chart(symbol)
                st.setdefault("bars_cache", {})[symbol.upper()] = chart
                store.save_desk(staff_id, st)
            else:
                raise TradeError(f"no bars for {symbol}")
        # Convert chart arrays into bar dicts for today
        bars = []
        for i, c in enumerate(chart.get("c") or []):
            if c is None:
                continue
            bars.append({
                "t": chart["t"][i] if i < len(chart.get("t") or []) else None,
                "o": (chart.get("o") or [c])[i] if i < len(chart.get("o") or []) else c,
                "h": (chart.get("h") or [c])[i] if i < len(chart.get("h") or []) else c,
                "l": (chart.get("l") or [c])[i] if i < len(chart.get("l") or []) else c,
                "c": c,
                "v": (chart.get("v") or [0])[i] if i < len(chart.get("v") or []) else 0,
            })
        res = entry_mod.evaluate(
            symbol, bars, now=now, setup=setup, or_minutes=or_minutes,
            level=level, min_volume_x=min_volume_x, cfg=st["config"],
        )
        doc = entry_mod.entry_doc(res)
        st["entry"] = doc
        store.save_desk(staff_id, st)
        return {**doc, "detail": res}

    def make_plan(self, staff_id: str, body: dict) -> dict:
        st = store.load_desk(staff_id)
        entry_doc = body.get("entry") or st.get("entry") or {}
        if entry_doc.get("status") and entry_doc.get("status") != "triggered" and body.get("entry_price") is None:
            raise TradeError("entry has not triggered; pass entry_price to plan anyway")
        symbol = body.get("symbol") or entry_doc.get("symbol")
        price = body.get("entry_price") or entry_doc.get("price")
        orr = body.get("opening_range") or entry_doc.get("opening_range") or {}
        if not symbol or price is None:
            raise TradeError("need symbol and entry price")
        plan = exit_mod.build_plan(
            symbol=symbol,
            entry=float(price),
            date=body.get("date") or entry_doc.get("date") or now_ist().date().isoformat(),
            setup=body.get("setup") or entry_doc.get("setup") or "orb",
            stop=body.get("stop") or "or-mid",
            target=body.get("target") or "1R",
            or_high=body.get("or_high", orr.get("high")),
            or_low=body.get("or_low", orr.get("low")),
            entry_time=body.get("entry_time") or entry_doc.get("time"),
            entry_bar=body.get("entry_bar", entry_doc.get("bar_index")),
            flat_by=body.get("flat_by") or st["config"].get("flat_by"),
        )
        st["plan"] = plan
        store.save_desk(staff_id, st)
        return plan

    def run_timemachine(self, staff_id: str, *, replays: int = 2000, seed: int = 19,
                        until: str | None = None) -> dict:
        # Default replays 2000 for API snappiness; tests can pass 10000
        st = store.load_desk(staff_id)
        plan = st.get("plan")
        if not plan:
            raise TradeError("no plan — run exit planner first")
        bars = (st.get("bars_60d") or {}).get(plan["symbol"])
        if not bars:
            raise TradeError(
                f"no 60d 5m bars for {plan['symbol']}: inject via POST /trade/bars with bars_60d"
            )
        doc = tm_mod.run_time_machine(plan, bars, replays=replays, seed=seed, until=until)
        st["timemachine"] = doc
        store.save_desk(staff_id, st)
        return doc

    def size_order(self, staff_id: str, *, limit: float | None = None, price: float | None = None) -> dict:
        st = store.load_desk(staff_id)
        plan = st.get("plan")
        if not plan:
            raise TradeError("no plan to size")
        today = now_ist().date().isoformat()
        sizing = budget_mod.size_trade(
            plan, st["config"], limit=limit, price=price,
            cash=(st.get("portfolio") or {}).get("cash"),
            today=plan.get("date") or today,
        )
        order = budget_mod.bracket_order(sizing)
        orders_doc = {
            "created_by": "fh-trade-budget",
            "status": "proposed" if order else "refused",
            "paper": True,
            "sizing": sizing,
            "orders": [order] if order else [],
            "market": "NSE",
            "currency": "INR",
        }
        st["orders"] = orders_doc
        store.save_desk(staff_id, st)
        return orders_doc

    def check_risk(self, staff_id: str, *, now: str | None = None) -> dict:
        st = store.load_desk(staff_id)
        orders = (st.get("orders") or {}).get("orders") or []
        if not orders:
            raise TradeError("no proposed orders")
        prices = {}
        for sym, chart in (st.get("bars_cache") or {}).items():
            meta = chart.get("meta") or {}
            if meta.get("regularMarketPrice") is not None:
                prices[sym] = float(meta["regularMarketPrice"])
            elif chart.get("c"):
                last = next((c for c in reversed(chart["c"]) if c is not None), None)
                if last is not None:
                    prices[sym] = float(last)
        result = risk_mod.check(
            orders, st["config"], portfolio=st.get("portfolio"),
            prices=prices, state=st.get("broker"), now=now,
            today=(st.get("plan") or {}).get("date"),
        )
        st["risk"] = result
        store.save_desk(staff_id, st)
        return result

    def tickets(self, staff_id: str) -> dict:
        st = store.load_desk(staff_id)
        orders = (st.get("orders") or {}).get("orders") or []
        today = (st.get("plan") or {}).get("date") or now_ist().date().isoformat()
        return broker_mod.ticket_view(orders, st.get("risk"), st.get("broker"), today=today)

    def approve(self, staff_id: str, index: int, reply: str) -> dict:
        st = store.load_desk(staff_id)
        orders = (st.get("orders") or {}).get("orders") or []
        today = (st.get("plan") or {}).get("date") or now_ist().date().isoformat()
        res = broker_mod.approve(orders, index, reply, st.get("risk"), st.get("broker"), today=today)
        if res.get("ok"):
            broker = st.get("broker") or {"orders": []}
            broker.setdefault("orders", []).append(res["record"])
            st["broker"] = broker
            store.save_desk(staff_id, st)
        return res

    def fill(self, staff_id: str, index: int, price: float | None = None) -> dict:
        st = store.load_desk(staff_id)
        orders = (st.get("orders") or {}).get("orders") or []
        today = (st.get("plan") or {}).get("date") or now_ist().date().isoformat()
        res = broker_mod.fill(
            orders, index, st.get("broker") or {"orders": []},
            st.get("portfolio") or {}, price=price, today=today,
        )
        if res.get("ok"):
            broker = st.get("broker") or {"orders": []}
            broker.setdefault("orders", []).append(res["record"])
            st["broker"] = broker
            st["portfolio"] = res["portfolio"]
            store.save_desk(staff_id, st)
        return res

    def flatten(self, staff_id: str, symbol: str, price: float) -> dict:
        st = store.load_desk(staff_id)
        port = st.get("portfolio") or {}
        positions = port.get("positions") or {}
        if isinstance(positions, list):
            positions = {
                str(p.get("symbol")).upper(): float(p.get("qty") or 0)
                for p in positions if p.get("symbol")
            }
        qty = float(positions.get(symbol.upper()) or 0)
        if qty <= 0:
            raise TradeError(f"no long position in {symbol}")
        new_port = broker_mod.apply_fill(port, symbol, "sell", qty, price)
        rec = {
            "fingerprint": f"flat-{symbol.upper()}",
            "symbol": symbol.upper(),
            "side": "sell",
            "qty": str(int(qty)),
            "status": "filled",
            "kind": "exit",
            "fill_price": price,
            "date": now_ist().date().isoformat(),
            "at": now_ist().isoformat(timespec="seconds"),
            "plain": f"SELL {int(qty)} {symbol.upper()} flatten",
        }
        broker = st.get("broker") or {"orders": []}
        broker.setdefault("orders", []).append(rec)
        st["broker"] = broker
        st["portfolio"] = new_port
        store.save_desk(staff_id, st)
        return {"ok": True, "record": rec, "portfolio": new_port}

    def set_alerts(self, staff_id: str, rules: list[dict]) -> dict:
        st = store.load_desk(staff_id)
        st["alerts"] = rules
        store.save_desk(staff_id, st)
        return {"ok": True, "count": len(rules)}

    def check_alerts(self, staff_id: str, now: str | None = None) -> dict:
        st = store.load_desk(staff_id)
        prices = {}
        for sym, chart in (st.get("bars_cache") or {}).items():
            meta = chart.get("meta") or {}
            if meta.get("regularMarketPrice") is not None:
                prices[sym] = float(meta["regularMarketPrice"])
        result = alerts_mod.evaluate_alerts(
            st.get("alerts") or [], prices, now=now, fired=set(st.get("alert_fired") or [])
        )
        st["alert_fired"] = result["fired"]
        store.save_desk(staff_id, st)
        return result

    def ingest_news(self, staff_id: str, items: list[dict], moves: dict | None = None) -> dict:
        board = news_mod.build_news_board(items, moves=moves)
        st = store.load_desk(staff_id)
        st["news"] = board
        store.save_desk(staff_id, st)
        return board

    def reset(self, staff_id: str) -> dict:
        store.save_desk(staff_id, store.default_state())
        return self.desk(staff_id)


_SERVICE = TradeService()
