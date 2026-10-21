from __future__ import annotations
"""Yield curve and interest rate spread calculations.

Rules:
- Canonical yield is percent (e.g. 7.15%)
- Spread in basis points: (yield_a_percent - yield_b_percent) * 100
  Example: 7.0% - 4.0% = 300 bps
- Compounding and tenor conventions are tracked explicitly
- No synthetic interpolation without 'interpolated_estimated' tag
"""

from typing import Any


def calculate_spread_bps(yield_a_pct: float, yield_b_pct: float) -> float:
    """Calculate yield spread in basis points: (yield_a - yield_b) * 100."""
    return round((yield_a_pct - yield_b_pct) * 100.0, 2)


def compute_yield_curve_summary(
    tenors: list[dict[str, Any]],
    benchmark_10y_key: str = "10Y",
    benchmark_2y_key: str = "2Y",
) -> dict[str, Any]:
    """Compute slope (10Y - 2Y) and summarize curve tenors."""
    curve: dict[str, float] = {}
    for item in tenors:
        tenor = item.get("tenor")
        val = item.get("yield_pct")
        if tenor and val is not None:
            curve[tenor] = float(val)

    y10 = curve.get(benchmark_10y_key)
    y2 = curve.get(benchmark_2y_key)

    slope_bps = calculate_spread_bps(y10, y2) if y10 is not None and y2 is not None else None

    return {
        "curve": curve,
        "slope_10y_2y_bps": slope_bps,
        "inverted": slope_bps < 0 if slope_bps is not None else False,
        "has_10y": y10 is not None,
        "has_2y": y2 is not None,
    }


def compute_cross_country_spread(
    country_a_10y: float | None,
    country_b_10y: float | None,
    country_a_name: str = "India",
    country_b_name: str = "US",
) -> dict[str, Any]:
    """Calculate cross-country sovereign yield spread in basis points.

    Example: India 10Y (7.0%) - US 10Y (4.0%) = 300 bps.
    """
    if country_a_10y is None or country_b_10y is None:
        return {
            "spread_bps": None,
            "status": "unavailable",
            "message": f"Missing 10Y yield observation for {country_a_name if country_a_10y is None else country_b_name}",
        }

    bps = calculate_spread_bps(country_a_10y, country_b_10y)
    return {
        "spread_bps": bps,
        "status": "current",
        "country_a": country_a_name,
        "country_a_yield_pct": country_a_10y,
        "country_b": country_b_name,
        "country_b_yield_pct": country_b_10y,
        "formula": f"({country_a_name} 10Y - {country_b_name} 10Y) * 100",
    }
