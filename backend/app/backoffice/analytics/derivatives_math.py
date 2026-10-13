"""Indian Index Derivatives Analytics: Put-Call Ratio (PCR), Open Interest & Volume.

Equations:
- PCR_OI = sum(put OI) / sum(call OI)
- PCR_volume = sum(put volume) / sum(call volume)
- Zero denominator or missing side => null with explicit reason
- Cash index level has no intrinsic traded volume or OI; derivatives displayed N/A for cash-only indices.
"""
from __future__ import annotations

from typing import Any


def calculate_pcr(
    contracts: list[dict[str, Any]],
    expiry_filter: str | None = None,
) -> dict[str, Any]:
    """Compute PCR_OI and PCR_volume for a set of option contracts."""
    filtered = contracts
    if expiry_filter:
        filtered = [c for c in contracts if c.get("expiry_date") == expiry_filter]

    if not filtered:
        return {
            "pcr_oi": None,
            "pcr_volume": None,
            "total_call_oi": 0,
            "total_put_oi": 0,
            "total_call_volume": 0,
            "total_put_volume": 0,
            "status": "unavailable",
            "reason": "No contracts found for the selected scope",
        }

    total_call_oi = 0
    total_put_oi = 0
    total_call_vol = 0
    total_put_vol = 0

    for c in filtered:
        opt_type = (c.get("option_type") or "").upper()
        oi = int(c.get("oi") or 0)
        vol = int(c.get("volume") or 0)

        if opt_type == "CE":
            total_call_oi += oi
            total_call_vol += vol
        elif opt_type == "PE":
            total_put_oi += oi
            total_put_vol += vol

    # PCR OI calculation
    pcr_oi = None
    pcr_oi_reason = None
    if total_call_oi > 0:
        pcr_oi = round(total_put_oi / total_call_oi, 4)
    else:
        pcr_oi_reason = "Zero call open interest"

    # PCR Volume calculation
    pcr_vol = None
    pcr_vol_reason = None
    if total_call_vol > 0:
        pcr_vol = round(total_put_vol / total_call_vol, 4)
    else:
        pcr_vol_reason = "Zero call volume"

    status = "ready" if (pcr_oi is not None and pcr_vol is not None) else "partial"

    return {
        "pcr_oi": pcr_oi,
        "pcr_volume": pcr_vol,
        "total_call_oi": total_call_oi,
        "total_put_oi": total_put_oi,
        "total_call_volume": total_call_vol,
        "total_put_volume": total_put_vol,
        "status": status,
        "pcr_oi_reason": pcr_oi_reason,
        "pcr_vol_reason": pcr_vol_reason,
        "contract_count": len(filtered),
        "expiry_filter": expiry_filter,
    }


def compute_max_pain(contracts: list[dict[str, Any]], expiry_filter: str | None = None) -> float | None:
    """Calculate descriptive Max Pain strike for the given expiry."""
    filtered = [c for c in contracts if not expiry_filter or c.get("expiry_date") == expiry_filter]
    strikes = sorted({float(c["strike_price"]) for c in filtered if "strike_price" in c})
    if not strikes:
        return None

    min_total_loss = float("inf")
    max_pain_strike = None

    for candidate in strikes:
        total_loss = 0.0
        for c in filtered:
            strike = float(c["strike_price"])
            oi = int(c.get("oi", 0))
            opt_type = (c.get("option_type") or "").upper()
            if opt_type == "CE" and candidate > strike:
                total_loss += (candidate - strike) * oi
            elif opt_type == "PE" and candidate < strike:
                total_loss += (strike - candidate) * oi

        if total_loss < min_total_loss:
            min_total_loss = total_loss
            max_pain_strike = candidate

    return max_pain_strike
