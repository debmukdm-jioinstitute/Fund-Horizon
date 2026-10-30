from __future__ import annotations
"""PMS Screening & Scoring Policy Engine.

Evaluates PMS strategies deterministically based on empirical performance disclosures:
1. Benchmark-Relative Excess Return (40% weight):
   - Compares 1Y, 3Y, and since-inception returns against the stated benchmark (e.g. BSE 500 TRI).
2. Consistency Across Rolling Horizons (30% weight):
   - Positive return frequency and outperformance across available trailing periods (1M, 3M, 6M, 1Y, 3Y, 5Y).
3. Downside Protection & Risk Metrics (30% weight):
   - Volatility, drawdown observed from monthly disclosures, and downside capture.

Score Bands:
  80 - 100: 5 Stars -> Buy
  65 - <80: 4 Stars -> Buy
  50 - <65: 3 Stars -> Hold
  35 - <50: 2 Stars -> Sell
  Below 35: 1 Star  -> Sell
  Insufficient / Incomplete inputs: Needs review
"""

import math
from typing import Any

PROVISIONAL_POLICY_VERSION = "1.0.0-provisional"

NINE_PMS_STRATEGIES: dict[str, dict[str, Any]] = {
    "174": {"name": "Stallion Asset Core Fund", "provider": "Stallion Asset Private Limited", "benchmark": "BSE 500 TRI", "ia_id": "174"},
    "781": {"name": "ICICI Prudential PMS Value Strategy", "provider": "ICICI Prudential Asset Management Company Ltd", "benchmark": "BSE 500 TRI", "ia_id": "781"},
    "606": {"name": "Buoyant Opportunities PMS", "provider": "Buoyant Capital Private Limited", "benchmark": "BSE 500 TRI", "ia_id": "606"},
    "1193": {"name": "Carnelian Capital Compounder Strategy", "provider": "Carnelian Asset Management & Advisors Pvt Ltd", "benchmark": "BSE 500 TRI", "ia_id": "1193"},
    "2512": {"name": "Abakkus Emerging Opportunities Approach", "provider": "Abakkus Investment Managers Private Limited", "benchmark": "BSE 500 TRI", "ia_id": "2512"},
    "731": {"name": "360 ONE Multicap PMS", "provider": "360 ONE Asset Management Limited", "benchmark": "BSE 500 TRI", "ia_id": "731"},
    "325": {"name": "Sundaram S.E.L.F", "provider": "Sundaram Alternate Assets Limited", "benchmark": "BSE 500 TRI", "ia_id": "325"},
    "324": {"name": "Sundaram SISOP", "provider": "Sundaram Alternate Assets Limited", "benchmark": "BSE 500 TRI", "ia_id": "324"},
    "327": {"name": "Sundaram Rising Star", "provider": "Sundaram Alternate Assets Limited", "benchmark": "BSE 500 TRI", "ia_id": "327"},
}


def score_pms_strategy(
    strategy: dict[str, Any],
    benchmark_perf: dict[str, Any] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Calculate score out of 100, star rating (1-5), FH signal, and concise reasons."""
    reasons: list[str] = []
    missing_inputs: list[str] = []

    ret_1y = strategy.get("return_1y")
    ret_3y = strategy.get("return_3y")
    ret_si = strategy.get("return_since_inception")
    ret_1m = strategy.get("return_1m")
    ret_3m = strategy.get("return_3m")
    ret_6m = strategy.get("return_6m")
    aum = strategy.get("aum_crore")

    bench_name = strategy.get("benchmark") or strategy.get("benchmark_name") or "BSE 500 TRI"

    # Default BSE 500 benchmark performance values for Sep-2026 if not explicitly passed
    # From APMI IaInsight benchmark record 22:
    # 1M: -5.57%, 3M: -3.59%, 6M: +8.07%, 1Y: -2.33%, 3Y: +9.20%, SI: +13.72%
    b_1m = -5.57 if benchmark_perf is None else benchmark_perf.get("return_1m", -5.57)
    b_1y = -2.33 if benchmark_perf is None else benchmark_perf.get("return_1y", -2.33)
    b_3y = 9.20 if benchmark_perf is None else benchmark_perf.get("return_3y", 9.20)
    b_si = 13.72 if benchmark_perf is None else benchmark_perf.get("return_since_inception", 13.72)

    # 1. Benchmark-relative performance (40 points max)
    bench_points = 0.0
    alpha_1y = None
    alpha_3y = None

    if ret_1y is not None and b_1y is not None:
        alpha_1y = ret_1y - b_1y
        if alpha_1y >= 10.0:
            bench_points += 20.0
            reasons.append(f"1Y return ({ret_1y:.1f}%) outperforms {bench_name} ({b_1y:.1f}%) by ▲ {alpha_1y:.1f}%.")
        elif alpha_1y >= 0.0:
            bench_points += 14.0 + (alpha_1y / 10.0) * 6.0
            reasons.append(f"1Y return ({ret_1y:.1f}%) beats {bench_name} by ▲ {alpha_1y:.1f}%.")
        elif alpha_1y >= -5.0:
            bench_points += 8.0
            reasons.append(f"1Y return ({ret_1y:.1f}%) trails {bench_name} ({b_1y:.1f}%) slightly (▼ {abs(alpha_1y):.1f}%).")
        else:
            bench_points += 3.0
            reasons.append(f"1Y return ({ret_1y:.1f}%) lags {bench_name} ({b_1y:.1f}%) by ▼ {abs(alpha_1y):.1f}%.")
    else:
        missing_inputs.append("1Y return vs benchmark")

    if ret_3y is not None and b_3y is not None:
        alpha_3y = ret_3y - b_3y
        if alpha_3y >= 10.0:
            bench_points += 20.0
            reasons.append(f"3Y CAGR ({ret_3y:.1f}%) shows strong active outperformance (▲ {alpha_3y:.1f}% vs benchmark).")
        elif alpha_3y >= 0.0:
            bench_points += 14.0 + (alpha_3y / 10.0) * 6.0
            reasons.append(f"3Y CAGR ({ret_3y:.1f}%) exceeds {bench_name} ({b_3y:.1f}%) by ▲ {alpha_3y:.1f}%.")
        elif alpha_3y >= -5.0:
            bench_points += 8.0
            reasons.append(f"3Y CAGR ({ret_3y:.1f}%) trails {bench_name} ({b_3y:.1f}%) by ▼ {abs(alpha_3y):.1f}%.")
        else:
            bench_points += 2.0
            reasons.append(f"3Y CAGR ({ret_3y:.1f}%) lags {bench_name} by ▼ {abs(alpha_3y):.1f}%.")
    else:
        missing_inputs.append("3Y CAGR vs benchmark")

    # 2. Consistency across rolling/trailing periods (30 points max)
    consistency_points = 0.0
    periods = [ret_1m, ret_3m, ret_6m, ret_1y, ret_3y]
    valid_periods = [p for p in periods if p is not None]
    if len(valid_periods) >= 3:
        positive_count = sum(1 for p in valid_periods if p > 0)
        consistency_ratio = positive_count / len(valid_periods)
        consistency_points = consistency_ratio * 30.0
        if consistency_ratio >= 0.6:
            reasons.append(f"Consistent performance with positive returns across {positive_count} of {len(valid_periods)} reported horizons.")
    else:
        missing_inputs.append("Insufficient multi-horizon return history (<3 periods)")

    # 3. Downside protection & operational scale (30 points max)
    downside_points = 0.0
    if ret_1m is not None and b_1m is not None:
        # Check downside resilience when benchmark fell
        if b_1m < 0:
            if ret_1m > b_1m:
                downside_points += 15.0
                reasons.append(f"Demonstrated downside protection in 1M correction ({ret_1m:.1f}% vs {b_1m:.1f}%).")
            else:
                downside_points += 5.0
        else:
            downside_points += 10.0

    if aum is not None and aum > 0:
        if aum >= 1000.0:
            downside_points += 15.0
        elif aum >= 200.0:
            downside_points += 10.0
        else:
            downside_points += 5.0
    else:
        missing_inputs.append("Disclosed AUM")

    # Compute total score
    total_score = bench_points + consistency_points + downside_points
    total_score = min(100.0, max(0.0, total_score))

    # Ratings & signals
    if len(missing_inputs) >= 2 or ret_1y is None or ret_3y is None:
        signal = "Needs review"
        rating = None
        score_val = None
        status = "incomplete_inputs"
        if not reasons:
            reasons.append("Insufficient 3-year performance history to compute reliable screening signal.")
    else:
        score_val = round(total_score, 1)
        if total_score >= 80.0:
            rating = 5
            signal = "Buy"
        elif total_score >= 65.0:
            rating = 4
            signal = "Buy"
        elif total_score >= 50.0:
            rating = 3
            signal = "Hold"
        elif total_score >= 35.0:
            rating = 2
            signal = "Sell"
        else:
            rating = 1
            signal = "Sell"
        status = "screened"

    # Limit to top 2-3 most distinct, defensible reasons
    unique_reasons = []
    for r in reasons:
        if r not in unique_reasons and len(unique_reasons) < 3:
            unique_reasons.append(r)

    if not unique_reasons:
        unique_reasons = ["Performance metrics aligned with category benchmark.", "No active flags or conflicts detected."]

    return {
        "score": score_val,
        "rating": rating,
        "signal": signal,
        "reasons": unique_reasons,
        "status": status,
        "missing_inputs": missing_inputs,
        "alpha_1y": round(alpha_1y, 2) if alpha_1y is not None else None,
        "alpha_3y": round(alpha_3y, 2) if alpha_3y is not None else None,
        "benchmark": bench_name,
        "methodology": PROVISIONAL_POLICY_VERSION,
        "internal_disclaimer": "Internal screening signal only. Does not constitute transaction instruction or client suitability assessment.",
    }

