"""Backoffice service orchestrator: caching, business logic, calculations, and reporting."""
from __future__ import annotations

import csv
import io
import threading
import time
from datetime import UTC, datetime
from typing import Any

from app.backoffice.analytics.derivatives_math import calculate_pcr, compute_max_pain
from app.backoffice.analytics.impact_engine import (
    align_paired_series,
    calculate_bps_changes,
    calculate_log_returns,
    compute_bond_price_sensitivity,
    compute_correlation_and_beta,
    generate_deterministic_briefing,
)
from app.backoffice.analytics.pms_math import (
    calculate_cagr,
    calculate_modified_dietz,
    calculate_xirr,
    estimate_hwm_fee,
)
from app.backoffice.analytics.yields_math import (
    calculate_spread_bps,
    compute_cross_country_spread,
    compute_yield_curve_summary,
)
from app.backoffice.providers.manual import ManualImportValidator
from app.backoffice.providers.nse import NSE_DERIVATIVE_UNDERLYINGS, NseError, get_nse_client
from app.backoffice.repository import BackofficeRepository

# In-memory cached market overview for ultra-low latency (<50ms) warm queries
_WARM_CACHE: dict[str, Any] = {}
_WARM_CACHE_EXPIRY: float = 0.0
_CACHE_TTL_SECONDS = 60.0

# Live option-chain polling: refetch when the stored snapshot is older than the TTL, back off after failures.
_OPTION_TTL_SECONDS = 120.0
_OPTION_FAILURE_BACKOFF_SECONDS = 60.0
_OPTION_LOCK = threading.Lock()
_OPTION_FAILURES: dict[str, tuple[float, str]] = {}
_OPTION_EXPIRIES: dict[str, list[str]] = {}

_ISSUER_TTL_SECONDS = 6 * 3600.0
_ISSUER_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


class BackofficeService:
    def __init__(self, repo: BackofficeRepository | None = None) -> None:
        self.repo = repo or BackofficeRepository()

    # Latest observation helpers -------------------------------------------------------------------------

    def _latest(self, instrument_ids: tuple[str, ...]) -> tuple[dict[str, float], str | None]:
        """Latest numeric observation per instrument plus the newest observed_at among them."""
        values: dict[str, float] = {}
        as_of: str | None = None
        for inst in instrument_ids:
            obs = self.repo.get_latest_observation(inst)
            if obs and obs.get("value_numeric") is not None:
                values[inst] = obs["value_numeric"]
                if as_of is None or (obs.get("observed_at") or "") > as_of:
                    as_of = obs.get("observed_at")
        return values, as_of

    def _same_period(self, a: str, b: str, max_gap_days: int = 10) -> bool:
        """True when both series have observations within ``max_gap_days`` of each other."""
        oa, ob = self.repo.get_latest_observation(a), self.repo.get_latest_observation(b)
        if not oa or not ob or not oa.get("observed_at") or not ob.get("observed_at"):
            return False
        try:
            da = datetime.strptime(oa["observed_at"][:10], "%Y-%m-%d")
            db = datetime.strptime(ob["observed_at"][:10], "%Y-%m-%d")
        except ValueError:
            return False
        return abs((da - db).days) <= max_gap_days

    def get_market_overview(self) -> dict[str, Any]:
        """Aggregate shared market overview from live-collected observations (no static fallbacks)."""
        global _WARM_CACHE, _WARM_CACHE_EXPIRY
        now = time.monotonic()
        if _WARM_CACHE and now < _WARM_CACHE_EXPIRY:
            return _WARM_CACHE

        fx_rates, fx_as_of = self._latest(("FX:USDINR", "FX:EURUSD", "FX:GBPUSD", "FX:USDJPY", "FX:EURINR", "FX:GBPINR", "FX:JPYINR"))
        vol_data, vol_as_of = self._latest(("VOL:US:VIX", "VOL:IN:INDIAVIX"))
        _, us_vix_as_of = self._latest(("VOL:US:VIX",))
        _, in_vix_as_of = self._latest(("VOL:IN:INDIAVIX",))
        indices, indices_as_of = self._latest(("INDEX:IN:NIFTY50", "INDEX:IN:NIFTYBANK", "INDEX:IN:SENSEX"))
        yield_data, yield_as_of = self._latest(("YIELD:US:10Y", "YIELD:US:2Y", "YIELD:IN:10Y", "YIELD:IN:2Y"))
        macro_proxy, _ = self._latest(("MACRO:US:BROAD_USD",))

        in_10y, in_2y = yield_data.get("YIELD:IN:10Y"), yield_data.get("YIELD:IN:2Y")
        us_10y, us_2y = yield_data.get("YIELD:US:10Y"), yield_data.get("YIELD:US:2Y")
        if not self._same_period("YIELD:IN:10Y", "YIELD:US:10Y"):
            in_10y = None  # never subtract yields from different periods (e.g. monthly fallback vs daily)
        if not self._same_period("YIELD:IN:2Y", "YIELD:IN:10Y"):
            in_2y = None

        india_us_spread = compute_cross_country_spread(in_10y, us_10y, "India", "US")
        in_slope = calculate_spread_bps(in_10y, in_2y) if in_10y is not None and in_2y is not None else None
        us_slope = calculate_spread_bps(us_10y, us_2y) if us_10y is not None and us_2y is not None else None

        opt_snap = self.repo.get_latest_option_snapshot("NIFTY")
        pcr_oi = opt_snap.get("pcr_oi") if opt_snap else None
        pcr_vol = opt_snap.get("pcr_volume") if opt_snap else None

        flows = self.repo.list_flows()
        latest_date = flows[0].get("report_date") if flows else None
        same_day = [f for f in flows if f.get("report_date") == latest_date]
        fii_net = next((f.get("net") for f in same_day if f.get("category") in ("FII", "FPI")), None)
        dii_net = next((f.get("net") for f in same_day if f.get("category") == "DII"), None)

        sources = self.repo.list_sources()
        sources_ready = sum(1 for s in sources if s.get("health_status") == "ready")

        payload = {
            "fx": {
                "rates": fx_rates,
                "as_of": fx_as_of,
                "status": "ready" if fx_rates else "awaiting_ingestion",
            },
            "volatility": {
                "vix": vol_data.get("VOL:US:VIX"),
                "india_vix": vol_data.get("VOL:IN:INDIAVIX"),
                "vix_as_of": us_vix_as_of,
                "india_vix_as_of": in_vix_as_of,
                "as_of": vol_as_of,
                "status": "ready" if vol_data else "awaiting_ingestion",
            },
            "indices": {**indices, "as_of": indices_as_of},
            "yields": {
                "in_10y": in_10y,
                "in_2y": in_2y,
                "us_10y": us_10y,
                "us_2y": us_2y,
                "india_us_spread_bps": india_us_spread.get("spread_bps"),
                "india_slope_bps": in_slope,
                "us_slope_bps": us_slope,
                "as_of": yield_as_of,
                "status": "ready" if us_10y is not None else "awaiting_ingestion",
            },
            "derivatives": {
                "underlying": "NIFTY",
                "pcr_oi": pcr_oi,
                "pcr_volume": pcr_vol,
                "status": "ready" if opt_snap else "awaiting_ingestion",
                "message": None if opt_snap else "Option chain not yet fetched from NSE",
            },
            "flows": {
                "latest_date": latest_date,
                "fii_net": fii_net,
                "dii_net": dii_net,
                "unit": "inr_crore",
                "status": "ready" if flows else "awaiting_ingestion",
            },
            "sources_health": {
                "total": len(sources),
                "ready": sources_ready,
                "status": "healthy" if sources_ready >= len(sources) // 2 else "degraded",
            },
            # Top-level flat keys for direct frontend compatibility
            "fx_reference_rates": fx_rates,
            "fx_as_of": fx_as_of,
            "volatility_map": vol_data,
            "vol_as_of": vol_as_of,
            "macro_proxy": macro_proxy,
            "yield_spreads": {
                "india_us_10y_bps": india_us_spread.get("spread_bps"),
                "us_10y_2y_bps": us_slope,
                "india_10y_2y_bps": in_slope,
            },
            "sources_summary": {
                "total": len(sources),
                "ready": sources_ready,
                "degraded": sum(1 for s in sources if s.get("health_status") == "degraded"),
                "needs_key": sum(1 for s in sources if s.get("health_status") == "needs_key"),
                "manual_only": sum(1 for s in sources if s.get("health_status") == "manual_only"),
            },
            "recent_notes": [],
            "active_watchlists": [],
            "generated_at": datetime.now(UTC).isoformat(),
        }

        _WARM_CACHE = payload
        _WARM_CACHE_EXPIRY = now + _CACHE_TTL_SECONDS
        return payload

    # Derivatives (live through to NSE) -------------------------------------------------------------------

    def _refresh_option_chain(self, underlying: str, expiry: str | None) -> str | None:
        """Fetch a live NSE chain into storage. Returns an error message on failure, else None."""
        now = time.monotonic()
        with _OPTION_LOCK:
            failed_at, failed_msg = _OPTION_FAILURES.get(underlying, (0.0, ""))
            if failed_msg and now - failed_at < _OPTION_FAILURE_BACKOFF_SECONDS:
                return failed_msg
            try:
                chain = get_nse_client().fetch_option_chain(underlying, expiry)
            except NseError as e:
                _OPTION_FAILURES[underlying] = (now, str(e))
                return str(e)
            _OPTION_FAILURES.pop(underlying, None)
            _OPTION_EXPIRIES[underlying] = chain["expiries"]
            contracts = chain["contracts"]
            pcr_res = calculate_pcr(contracts)
            self.repo.save_option_snapshot(
                {
                    "exchange": "NSE",
                    "underlying_symbol": underlying,
                    "underlying_price": chain["underlying_price"],
                    "snapshot_timestamp": chain["snapshot_timestamp"],
                    "source": "nse_live",
                    "pcr_oi": pcr_res.get("pcr_oi"),
                    "pcr_volume": pcr_res.get("pcr_volume"),
                    "total_call_oi": pcr_res.get("total_call_oi"),
                    "total_put_oi": pcr_res.get("total_put_oi"),
                    "total_call_volume": pcr_res.get("total_call_volume"),
                    "total_put_volume": pcr_res.get("total_put_volume"),
                },
                contracts,
            )
            self.repo.prune_option_snapshots(underlying)
            return None

    def get_derivatives_board(self, underlying: str = "NIFTY", expiry: str | None = None) -> dict[str, Any]:
        live_error: str | None = None
        if underlying in NSE_DERIVATIVE_UNDERLYINGS:
            age = self.repo.option_snapshot_age_seconds(underlying)
            if age is None or age > _OPTION_TTL_SECONDS:
                live_error = self._refresh_option_chain(underlying, None)
        else:
            live_error = (
                f"{underlying} options trade on BSE, whose API blocks automated access; no feed is available."
                if underlying != "NIFTYNXT50"
                else "NIFTY Next 50 is a cash index without listed index options."
            )

        snap = self.repo.get_latest_option_snapshot(underlying)
        if not snap:
            return {
                "underlying": underlying,
                "status": "unavailable",
                "live_status": "unavailable",
                "message": live_error or f"No option chain stored for {underlying}.",
                "expiries": [],
                "contracts": [],
                "pcr": None,
                "max_pain": None,
            }

        contracts = snap.get("contracts", [])
        expiries = sorted({c["expiry_date"] for c in contracts if "expiry_date" in c})
        expiries = sorted(set(expiries) | set(_OPTION_EXPIRIES.get(underlying, [])))
        stored_expiries = sorted({c["expiry_date"] for c in contracts if "expiry_date" in c})
        selected_expiry = expiry if expiry in stored_expiries else (stored_expiries[0] if stored_expiries else None)

        pcr = calculate_pcr(contracts, expiry_filter=selected_expiry)
        max_pain = compute_max_pain(contracts, expiry_filter=selected_expiry)
        filtered_contracts = [c for c in contracts if not selected_expiry or c.get("expiry_date") == selected_expiry]

        return {
            "underlying": underlying,
            "underlying_price": snap.get("underlying_price"),
            "snapshot_timestamp": snap.get("snapshot_timestamp"),
            "status": "ready",
            "live_status": "stale" if live_error else "live",
            "message": live_error,
            "source": snap.get("source"),
            "expiries": expiries,
            "selected_expiry": selected_expiry,
            "pcr": pcr,
            "max_pain": max_pain,
            "contracts": filtered_contracts[:400],  # Bounded table limit
            "total_contracts": len(filtered_contracts),
        }

    # Yields (US Treasury live; India has no free official feed) ------------------------------------------

    US_TENORS = ("1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y")

    def get_yields_board(self) -> dict[str, Any]:
        us_curve: list[dict[str, Any]] = []
        for tenor in self.US_TENORS:
            obs = self.repo.get_latest_observation(f"YIELD:US:{tenor}")
            if obs and obs.get("value_numeric") is not None:
                us_curve.append({"tenor": tenor, "yield_pct": obs["value_numeric"], "observed_at": obs.get("observed_at"), "source": obs.get("provenance")})

        in_curve: list[dict[str, Any]] = []
        for tenor in ("3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "30Y"):
            obs = self.repo.get_latest_observation(f"YIELD:IN:{tenor}")
            if obs and obs.get("value_numeric") is not None:
                in_curve.append({"tenor": tenor, "yield_pct": obs["value_numeric"], "observed_at": obs.get("observed_at"), "source": obs.get("provenance")})

        # Slope/spread math only uses points from the same period as the newest India observation.
        newest_in = max((r["observed_at"] for r in in_curve if r.get("observed_at")), default=None)
        fresh_in = [
            r for r in in_curve
            if newest_in and r.get("observed_at") and (datetime.strptime(newest_in[:10], "%Y-%m-%d") - datetime.strptime(r["observed_at"][:10], "%Y-%m-%d")).days <= 10
        ]
        in_summary = compute_yield_curve_summary(fresh_in)
        us_summary = compute_yield_curve_summary(us_curve)
        in_10y = in_summary["curve"].get("10Y") if self._same_period("YIELD:IN:10Y", "YIELD:US:10Y") else None
        cross_spread = compute_cross_country_spread(in_10y, us_summary["curve"].get("10Y"), "India", "US")
        as_of = max((r["observed_at"] for r in us_curve + in_curve if r.get("observed_at")), default=None)

        return {
            "india_curve": in_curve,
            "india_summary": in_summary,
            "india_status": "ready" if in_curve else "unavailable",
            "india_message": None if in_curve else "India G-Sec yields have not been collected yet (scrape and FRED fallback both empty).",
            "us_curve": us_curve,
            "us_summary": us_summary,
            "india_us_10y_spread": cross_spread,
            "status": "ready" if us_curve else "unavailable",
            "as_of": as_of,
        }

    # Issuer fundamentals (NSE quarterly results) --------------------------------------------------------

    def get_issuer_fundamentals(self, symbol: str) -> dict[str, Any] | None:
        symbol = symbol.upper()
        cached = _ISSUER_CACHE.get(symbol)
        if cached and time.monotonic() - cached[0] < _ISSUER_TTL_SECONDS:
            return cached[1]
        quarters = get_nse_client().fetch_quarterly_results(symbol)
        if not quarters:
            return None
        latest = quarters[0]
        data = {
            "symbol": symbol,
            "reporting_scope": "As filed on NSE",
            "fiscal_period": latest["period_end"],
            "revenue_crore": latest["revenue_crore"],
            "ebitda_crore": latest["ebitda_crore"],
            "ebitda_margin_pct": latest["ebitda_margin_pct"],
            "pat_crore": latest["pat_crore"],
            "filing_id": latest["filing_id"],
            "quarters": quarters,
        }
        _ISSUER_CACHE[symbol] = (time.monotonic(), data)
        return data

    def analyze_impact(
        self,
        series_x_id: str,
        series_y_id: str,
        horizon_days: int = 60,
        lag_days: int = 0,
    ) -> dict[str, Any]:
        """Perform regression and rolling relationship between two series."""
        obs_x = self.repo.get_observations_series(series_x_id, limit=horizon_days * 2)
        obs_y = self.repo.get_observations_series(series_y_id, limit=horizon_days * 2)

        data_x = [(o["observed_at"], o["value_numeric"]) for o in obs_x if o.get("value_numeric") is not None]
        data_y = [(o["observed_at"], o["value_numeric"]) for o in obs_y if o.get("value_numeric") is not None]

        # Use log returns if prices/FX, or bps changes if yields
        ret_x = calculate_bps_changes(data_x) if "YIELD" in series_x_id else calculate_log_returns(data_x)
        ret_y = calculate_bps_changes(data_y) if "YIELD" in series_y_id else calculate_log_returns(data_y)

        # Lag series Y if lag_days > 0
        if lag_days > 0 and len(ret_y) > lag_days:
            ret_y = ret_y[lag_days:]
            ret_x = ret_x[:len(ret_y)]

        alignment = align_paired_series(ret_x, ret_y)
        stats = compute_correlation_and_beta(alignment["paired_x"], alignment["paired_y"])

        return {
            "series_x_id": series_x_id,
            "series_y_id": series_y_id,
            "horizon_days": horizon_days,
            "lag_days": lag_days,
            "alignment": {
                "n": alignment["n"],
                "coverage_pct": alignment["coverage_pct"],
                "status": alignment["status"],
            },
            "statistics": stats,
            "paired_sample": [
                {"date": d, "x": round(x, 6), "y": round(y, 6)}
                for d, x, y in zip(alignment["dates"][-30:], alignment["paired_x"][-30:], alignment["paired_y"][-30:])
            ],
            "method_version": "OLS Empirical Elasticity Engine 1.0 (No Look-Ahead)",
        }

    def simulate_scenario(
        self,
        usd_shock_pct: float,
        us_yield_shock_bps: float,
        oil_shock_pct: float,
        modified_duration: float = 6.5,
    ) -> dict[str, Any]:
        """Simulate macro shocks across fixed income, equities, and FX."""
        # 1. Bond price impact
        bond_impact = compute_bond_price_sensitivity(modified_duration, us_yield_shock_bps)

        # 2. INR sensitivity (empirical: +1% USD broad rally typically induces -0.35% to -0.65% INR pressure)
        inr_impact_pct = round(-0.45 * usd_shock_pct, 4)

        # 3. Oil inflation pass-through
        oil_cpi_bps = round(oil_shock_pct * 1.8, 2)  # ~18 bps per 10% oil rise

        return {
            "shocks": {
                "usd_rally_pct": usd_shock_pct,
                "us_10y_yield_shift_bps": us_yield_shock_bps,
                "crude_oil_shock_pct": oil_shock_pct,
                "assumed_portfolio_duration": modified_duration,
            },
            "impacts": {
                "bond_portfolio_price_change_pct": bond_impact["estimated_price_change_pct"],
                "bond_duration_effect_pct": bond_impact["duration_effect_pct"],
                "inr_fx_shift_pct": inr_impact_pct,
                "india_cpi_inflation_impact_bps": oil_cpi_bps,
            },
            "explanation": (
                f"A +{us_yield_shock_bps} bps yield shock reduces a {modified_duration:.1f}-year duration "
                f"bond portfolio value by {abs(bond_impact['estimated_price_change_pct']):.2f}%. "
                f"A +{usd_shock_pct}% USD dollar index rally transmits approximately {inr_impact_pct}% to USD/INR."
            ),
        }

    def commit_manual_import(self, import_type: str, filename: str, csv_content: str, staff_id: str) -> dict[str, Any]:
        """Validate and atomically commit manual import rows into the repository."""
        preview = ManualImportValidator.preview(import_type, csv_content)
        if not preview["valid"]:
            n_bad = preview.get("error_count", 0)
            message = preview.get("error") or f"{n_bad} row(s) failed validation; fix the file and re-upload."
            return {"success": False, "error": message, "errors": preview.get("errors", [])}

        reader = csv.DictReader(io.StringIO(csv_content))
        rows = list(reader)

        saved_count = 0
        if import_type == "pms_strategies":
            formatted = []
            for r in rows:
                formatted.append({
                    "provider": r["Provider"].strip(),
                    "strategy_name": r["Strategy Name"].strip(),
                    "approach": r.get("Approach", "").strip(),
                    "category": r.get("Category", "").strip(),
                    "report_month": r["Report Month"].strip(),
                    "aum_crore": float(r["AUM (Cr)"]) if r.get("AUM (Cr)") else None,
                    "return_1m": float(r["Return 1M (%)"]) if r.get("Return 1M (%)") else None,
                    "return_3m": float(r["Return 3M (%)"]) if r.get("Return 3M (%)") else None,
                    "return_6m": float(r["Return 6M (%)"]) if r.get("Return 6M (%)") else None,
                    "return_1y": float(r["Return 1Y (%)"]) if r.get("Return 1Y (%)") else None,
                    "cagr_3y": float(r["CAGR 3Y (%)"]) if r.get("CAGR 3Y (%)") else None,
                    "cagr_5y": float(r["CAGR 5Y (%)"]) if r.get("CAGR 5Y (%)") else None,
                    "benchmark_name": r.get("Benchmark Name", "").strip(),
                    "benchmark_return_1y": float(r["Benchmark 1Y (%)"]) if r.get("Benchmark 1Y (%)") else None,
                    "source": "APMI_Manual",
                })
            saved_count = self.repo.upsert_pms_strategies(formatted)

        elif import_type == "fii_dii_flows":
            formatted = []
            for r in rows:
                formatted.append({
                    "report_date": r["Report Date"].strip(),
                    "category": r["Category"].strip().upper(),
                    "segment": r.get("Segment", "equity_cash").strip(),
                    "gross_buy": float(r["Gross Buy"]),
                    "gross_sell": float(r["Gross Sell"]),
                    "net": float(r["Net"]),
                    "unit": r.get("Unit", "inr_crore").strip(),
                    "status": r.get("Status", "final").strip(),
                })
            saved_count = self.repo.upsert_flows(formatted)

        elif import_type == "option_chain":
            if rows:
                snap_ts = rows[0].get("Timestamp") or datetime.now(UTC).isoformat()
                underlying = rows[0].get("Underlying", "NIFTY").strip()
                und_price = float(rows[0]["Underlying Price"]) if rows[0].get("Underlying Price") else None
                contracts = []
                for r in rows:
                    contracts.append({
                        "exchange": r.get("Exchange", "NSE").strip(),
                        "underlying_symbol": underlying,
                        "expiry_date": r["Expiry Date"].strip(),
                        "strike_price": float(r["Strike Price"]),
                        "option_type": r["Option Type"].strip().upper(),
                        "lot_size": int(r.get("Lot Size", 25)),
                        "last_price": float(r["Last Price"]) if r.get("Last Price") else None,
                        "oi": int(r.get("OI", 0)),
                        "oi_change": int(r.get("OI Change", 0)),
                        "volume": int(r.get("Volume", 0)),
                    })
                pcr_res = calculate_pcr(contracts)
                snap_id = self.repo.save_option_snapshot(
                    {
                        "exchange": rows[0].get("Exchange", "NSE"),
                        "underlying_symbol": underlying,
                        "underlying_price": und_price,
                        "snapshot_timestamp": snap_ts,
                        "source": "manual_import",
                        "pcr_oi": pcr_res.get("pcr_oi"),
                        "pcr_volume": pcr_res.get("pcr_volume"),
                        "total_call_oi": pcr_res.get("total_call_oi"),
                        "total_put_oi": pcr_res.get("total_put_oi"),
                        "total_call_volume": pcr_res.get("total_call_volume"),
                        "total_put_volume": pcr_res.get("total_put_volume"),
                    },
                    contracts,
                )
                saved_count = len(contracts)

        self.repo.log_audit(
            staff_id=staff_id,
            action="import_commit",
            target_type=import_type,
            details={"filename": filename, "rows_committed": saved_count},
        )

        return {"success": True, "rows_committed": saved_count, "import_type": import_type}

    def get_research_briefing(self) -> dict[str, Any]:
        overview = self.get_market_overview()
        flows_list = self.repo.list_flows()
        latest_date = flows_list[0].get("report_date") if flows_list else None
        same_day = [f for f in flows_list if f.get("report_date") == latest_date]
        net_of = lambda cat: next((f.get("net") for f in same_day if str(f.get("category", "")).upper() in cat), None)  # noqa: E731
        derivatives = self.get_derivatives_board("NIFTY")
        yields = overview.get("yields", {})

        return generate_deterministic_briefing(
            market_observations={
                "fx": {**overview.get("fx", {}).get("rates", {}), "as_of": overview.get("fx_as_of")},
                "volatility": {**overview.get("volatility_map", {}), "as_of": overview.get("volatility", {}).get("vix_as_of")},
            },
            macro_data={"yields": yields},
            flows_data={"fii_net_crore": net_of(("FII", "FPI")), "dii_net_crore": net_of(("DII",)), "report_date": latest_date or "recent"},
            options_summary={**(derivatives.get("pcr") or {}), "status": derivatives.get("status"), "underlying": "NIFTY"},
        )
