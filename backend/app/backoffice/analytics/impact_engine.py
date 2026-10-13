"""Reproducible, Explainable Impact Engine and Deterministic Research Briefing.

Key invariants:
- Zero paid LLM calls: pure deterministic math and structured factual templates.
- Log returns for asset prices: ln(P_t / P_{t-1}).
- Basis point changes for yields and spreads: (Y_t - Y_{t-1}) * 100.
- Strict date alignment: require >=80% paired observations, actual sample size n reported.
- Zero forward-filling of lower-frequency data into higher-frequency samples.
- Bond price duration sensitivity: ΔP/P ≈ -modified_duration * Δyield_decimal
  (+25 bps shock => +0.0025, NOT 0.25).
"""
from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any


def calculate_log_returns(dated_prices: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Compute log returns: ln(P_t / P_{t-1}) for sorted chronological prices."""
    sorted_prices = sorted(dated_prices, key=lambda x: x[0])
    returns: list[tuple[str, float]] = []
    for i in range(1, len(sorted_prices)):
        prev_p = sorted_prices[i - 1][1]
        curr_p = sorted_prices[i][1]
        if prev_p > 0 and curr_p > 0:
            ret = math.log(curr_p / prev_p)
            returns.append((sorted_prices[i][0], ret))
    return returns


def calculate_bps_changes(dated_yields: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Compute yield changes in basis points: (Y_t - Y_{t-1}) * 100."""
    sorted_yields = sorted(dated_yields, key=lambda x: x[0])
    changes: list[tuple[str, float]] = []
    for i in range(1, len(sorted_yields)):
        prev_y = sorted_yields[i - 1][1]
        curr_y = sorted_yields[i][1]
        bps_diff = (curr_y - prev_y) * 100.0
        changes.append((sorted_yields[i][0], bps_diff))
    return changes


def align_paired_series(
    series_x: list[tuple[str, float]],
    series_y: list[tuple[str, float]],
    min_coverage_pct: float = 80.0,
) -> dict[str, Any]:
    """Align two dated series by exact calendar date."""
    dict_x = dict(series_x)
    dict_y = dict(series_y)
    common_dates = sorted(set(dict_x.keys()).intersection(set(dict_y.keys())))

    total_possible = max(len(dict_x), len(dict_y))
    if total_possible == 0:
        return {"paired_x": [], "paired_y": [], "dates": [], "n": 0, "coverage_pct": 0.0, "status": "insufficient_data"}

    coverage = (len(common_dates) / total_possible) * 100.0
    status = "ready" if coverage >= min_coverage_pct else "low_coverage"

    paired_x = [dict_x[d] for d in common_dates]
    paired_y = [dict_y[d] for d in common_dates]

    return {
        "paired_x": paired_x,
        "paired_y": paired_y,
        "dates": common_dates,
        "n": len(common_dates),
        "coverage_pct": round(coverage, 2),
        "status": status,
    }


def compute_correlation_and_beta(
    x_vals: list[float],
    y_vals: list[float],
) -> dict[str, Any]:
    """Compute Pearson correlation and OLS beta (y on x)."""
    n = len(x_vals)
    if n < 5:
        return {
            "correlation": None,
            "beta": None,
            "r_squared": None,
            "n": n,
            "status": "sample_too_small",
            "message": f"Sample size n={n} is too small for meaningful regression (min 5).",
        }

    mean_x = sum(x_vals) / n
    mean_y = sum(y_vals) / n

    cov_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(x_vals, y_vals)) / (n - 1)
    var_x = sum((x - mean_x) ** 2 for x in x_vals) / (n - 1)
    var_y = sum((y - mean_y) ** 2 for y in y_vals) / (n - 1)

    if var_x < 1e-12 or var_y < 1e-12:
        return {
            "correlation": None,
            "beta": None,
            "r_squared": None,
            "n": n,
            "status": "zero_variance",
            "message": "Zero or near-zero variance in one of the series.",
        }

    std_x = math.sqrt(var_x)
    std_y = math.sqrt(var_y)
    corr = cov_xy / (std_x * std_y)
    beta = cov_xy / var_x
    r2 = corr ** 2

    return {
        "correlation": round(corr, 4),
        "beta": round(beta, 4),
        "r_squared": round(r2, 4),
        "n": n,
        "std_x": round(std_x, 4),
        "std_y": round(std_y, 4),
        "status": "computed",
    }


def compute_bond_price_sensitivity(
    modified_duration: float,
    yield_change_bps: float,
    convexity: float | None = None,
) -> dict[str, Any]:
    """Calculate bond price percentage impact from yield shift:

    ΔP/P ≈ -modified_duration * Δyield_decimal + 0.5 * convexity * (Δyield_decimal ** 2)
    Example: 25 bps shift => Δyield_decimal = 0.0025 (NOT 0.25).
    """
    if modified_duration < 0:
        raise ValueError("Modified duration must be non-negative")

    delta_yield_decimal = yield_change_bps / 10000.0  # 1 bp = 0.0001
    duration_effect = -modified_duration * delta_yield_decimal
    convexity_effect = 0.0
    if convexity is not None and convexity > 0:
        convexity_effect = 0.5 * convexity * (delta_yield_decimal ** 2)

    total_delta_p_pct = (duration_effect + convexity_effect) * 100.0

    return {
        "yield_change_bps": yield_change_bps,
        "delta_yield_decimal": delta_yield_decimal,
        "modified_duration": modified_duration,
        "duration_effect_pct": round(duration_effect * 100.0, 4),
        "convexity_effect_pct": round(convexity_effect * 100.0, 4) if convexity else None,
        "estimated_price_change_pct": round(total_delta_p_pct, 4),
        "formula": "ΔP/P ≈ -D_mod * (Δbps / 10000)",
    }


def generate_deterministic_briefing(
    market_observations: dict[str, Any],
    macro_data: dict[str, Any],
    flows_data: dict[str, Any],
    options_summary: dict[str, Any],
) -> dict[str, Any]:
    """Generate a deterministic, evidence-based research briefing without paid AI calls."""
    bullet_points: list[str] = []

    # FX summary
    fx = market_observations.get("fx", {})
    usdinr = fx.get("FX:USDINR")
    eurusd = fx.get("FX:EURUSD")
    if usdinr:
        bullet_points.append(f"USD/INR ECB reference rate is observed at {usdinr:.4f} (as-of {fx.get('as_of', 'latest')}).")
    if eurusd:
        bullet_points.append(f"EUR/USD reference rate is observed at {eurusd:.4f}.")

    # Yields & Spreads
    yields = macro_data.get("yields", {})
    spread_10y = yields.get("india_us_spread_bps")
    if spread_10y is not None:
        bullet_points.append(
            f"India-US 10Y sovereign yield spread is {spread_10y:+.1f} bps "
            f"(India 10Y: {yields.get('in_10y', 'N/A')}%, US 10Y: {yields.get('us_10y', 'N/A')}%)."
        )

    # Volatility
    vol = market_observations.get("volatility", {})
    vix = vol.get("VOL:US:VIX")
    if vix:
        bullet_points.append(f"Cboe VIX closed at {vix:.2f} (as-of {vol.get('as_of', 'latest')}).")

    india_vix = vol.get("VOL:IN:INDIAVIX")
    if india_vix:
        bullet_points.append(f"India VIX is at {india_vix:.2f}.")

    us_10y = yields.get("us_10y")
    if us_10y is not None and spread_10y is None:
        us_slope = yields.get("us_slope_bps")
        slope_txt = f", 10Y-2Y slope {us_slope:+.1f} bps" if us_slope is not None else ""
        bullet_points.append(f"US 10Y Treasury par yield is {us_10y:.2f}%{slope_txt}.")

    # Derivatives / PCR
    pcr = options_summary.get("pcr_oi")
    if pcr is not None:
        bullet_points.append(
            f"{options_summary.get('underlying', 'NIFTY')} Put-Call Ratio (OI) stands at {pcr:.2f} "
            f"(Total Call OI: {options_summary.get('total_call_oi', 0):,}, Total Put OI: {options_summary.get('total_put_oi', 0):,})."
        )
    elif options_summary.get("status") in ("manual_only", "unavailable"):
        bullet_points.append("NIFTY option chain is currently unavailable from NSE; PCR will appear once a snapshot is fetched.")

    # Flows
    fii_net = flows_data.get("fii_net_crore")
    dii_net = flows_data.get("dii_net_crore")
    flow_date = flows_data.get("report_date", "recent")
    if fii_net is not None and dii_net is not None:
        bullet_points.append(
            f"Institutional flows for {flow_date}: FII Net {fii_net:+,.1f} Cr, DII Net {dii_net:+,.1f} Cr."
        )

    return {
        "title": f"Fund Horizon Backoffice Daily Research Briefing — {datetime.now(UTC).strftime('%d %B %Y')}",
        "as_of": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "method_version": "Deterministic Template Engine 1.0 (Zero LLM)",
        "bullets": bullet_points if bullet_points else ["Live feeds are still completing their first collection cycle."],
        "disclaimer": "All figures are fetched live from public primary sources (NSE, US Treasury, ECB, Cboe) or verified manual imports. Descriptive data only; not a trading signal.",
    }
