"""CAS (Consolidated Account Statement) ingestion and portfolio analysis engine.

Processes CAMS/KFintech CAS PDFs entirely in memory using casparser.
NEVER persists the raw PDF or password to disk or remote database.
Numbers are deterministic Python; no LLM and no runtime network calls.
"""
from __future__ import annotations

import io
from datetime import date
from typing import Any

import pandas as pd

from app.config import load_allocation
from app.config.disclosures import CAS_DISCLAIMER, CAS_PRIVACY_NOTICE
from app.engine import analytics as an

MAX_CAS_PDF_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB limit


class CASValidationError(Exception):
    """Raised when uploaded file fails initial validation (size, magic bytes, etc.)."""


class CASPasswordError(Exception):
    """Raised when password provided for encrypted CAS is incorrect."""


class CASParsingError(Exception):
    """Raised when casparser fails to parse the document structure."""


def parse_cas_pdf_bytes(
    pdf_bytes: bytes,
    password: str,
    max_size: int = MAX_CAS_PDF_SIZE_BYTES,
) -> dict[str, Any]:
    """Parse a CAS PDF strictly in memory.

    Validates size limit and %PDF magic bytes before invoking casparser.
    Returns the parsed dictionary. Never writes bytes or password to disk.
    """
    if not pdf_bytes:
        raise CASValidationError("Uploaded file is empty.")

    if len(pdf_bytes) > max_size:
        raise CASValidationError(
            f"File size ({len(pdf_bytes) / (1024 * 1024):.1f} MB) exceeds maximum allowed limit of {max_size / (1024 * 1024):.0f} MB."
        )

    # Magic byte check
    if not pdf_bytes.startswith(b"%PDF"):
        raise CASValidationError("Uploaded file is not a valid PDF document (missing %PDF signature).")

    try:
        import casparser
        from casparser.exceptions import IncorrectPasswordError, ParserException

        f = io.BytesIO(pdf_bytes)
        parsed = casparser.read_cas_pdf(f, password=password.strip(), output="dict")
        return parsed
    except IncorrectPasswordError as e:
        raise CASPasswordError("Incorrect password for CAS statement. Please verify and try again.") from e
    except ParserException as e:
        raise CASParsingError(f"Failed to parse CAS statement structure: {e}") from e
    except Exception as e:
        raise CASParsingError(f"Unexpected error while parsing CAS statement: {e}") from e


def build_isin_lookup(metrics_df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """Build fast lookup mapping normalized ISIN to scheme metrics row."""
    lookup: dict[str, dict[str, Any]] = {}
    if metrics_df.empty:
        return lookup

    for _, row in metrics_df.iterrows():
        d = row.to_dict()
        isin1 = str(row.get("isin_growth_or_payout", "")).strip().upper()
        if isin1 and isin1 != "NAN":
            lookup[isin1] = d
        isin2 = str(row.get("isin_reinvest", "")).strip().upper()
        if isin2 and isin2 != "NAN":
            lookup[isin2] = d
    return lookup


def infer_asset_class(cat: str | None, scheme_name: str) -> str:
    """Infer high-level asset class (equity, debt, hybrid, commodities, cash) from cat or name."""
    if cat:
        alloc = load_allocation()
        ac_map = alloc.get("asset_class", {})
        if cat in ac_map:
            return ac_map[cat]

    name_lower = scheme_name.lower()
    if any(k in name_lower for k in ["overnight", "liquid", "money market", "ultra short"]):
        return "cash"
    if any(k in name_lower for k in ["debt", "bond", "gilt", "banking & psu", "corporate bond", "credit risk", "treasury"]):
        return "debt"
    if any(k in name_lower for k in ["hybrid", "balanced", "multi asset", "arbitrage", "equity savings"]):
        return "hybrid"
    if any(k in name_lower for k in ["gold", "silver", "commodity"]):
        return "commodities"
    return "equity"


def analyze_cas_data(
    cas_dict: dict[str, Any],
    metrics_df: pd.DataFrame,
    target_band: str | None = None,
) -> dict[str, Any]:
    """Extract portfolio holdings, compute folio and overall XIRRs, and analyze asset allocation.

    Compares current allocation against target_band if specified.
    """
    lookup = build_isin_lookup(metrics_df)
    folios_raw = cas_dict.get("folios", [])

    parsed_holdings: list[dict[str, Any]] = []
    portfolio_cash_flows: list[tuple[date | pd.Timestamp, float]] = []

    total_portfolio_value = 0.0
    direct_value = 0.0
    regular_value = 0.0

    folios_summary: list[dict[str, Any]] = []

    for f_idx, folio in enumerate(folios_raw):
        folio_num = str(folio.get("folio", f"Folio-{f_idx+1}")).strip()
        amc = str(folio.get("amc", "")).strip()
        pan = str(folio.get("PAN", "")).strip()

        folio_value = 0.0
        folio_cash_flows: list[tuple[date | pd.Timestamp, float]] = []
        folio_schemes: list[dict[str, Any]] = []

        for scheme in folio.get("schemes", []):
            s_name = str(scheme.get("scheme", "")).strip()
            isin = str(scheme.get("isin", "")).strip().upper()
            amfi = str(scheme.get("amfi", "")).strip()
            units = float(scheme.get("close", 0.0) or 0.0)

            val_dict = scheme.get("valuation", {}) or {}
            val_date_str = val_dict.get("date")
            nav = float(val_dict.get("nav", 0.0) or 0.0)
            cur_val = float(val_dict.get("value", 0.0) or 0.0)
            if cur_val <= 0.0 and units > 0 and nav > 0:
                cur_val = units * nav

            # Match against metrics database
            matched = lookup.get(isin)
            if not matched and amfi:
                amfi_rows = metrics_df[metrics_df["scheme_code"] == str(amfi)]
                if not amfi_rows.empty:
                    matched = amfi_rows.iloc[0].to_dict()

            is_direct = "direct" in s_name.lower() or (matched and matched.get("plan") == "Direct")
            canonical_cat = matched.get("cat") if matched else None
            asset_class = infer_asset_class(canonical_cat, s_name)

            # Build transaction cash flows for XIRR
            scheme_cash_flows: list[tuple[date | pd.Timestamp, float]] = []
            for tx in scheme.get("transactions", []):
                tx_date_raw = tx.get("date")
                tx_amt = float(tx.get("amount", 0.0) or 0.0)
                tx_type = str(tx.get("type", "")).upper()
                if not tx_date_raw or tx_amt == 0.0:
                    continue

                tx_d = pd.to_datetime(tx_date_raw).date()
                # Investments/purchases are negative cash outflows from investor
                if any(k in tx_type for k in ["PURCHASE", "SIP", "SWITCH IN", "REINVEST"]):
                    flow = -abs(tx_amt)
                elif any(k in tx_type for k in ["REDEMPTION", "SWITCH OUT", "PAYOUT", "DIVIDEND"]):
                    flow = abs(tx_amt)
                else:
                    flow = -abs(tx_amt) if tx_amt > 0 else abs(tx_amt)

                scheme_cash_flows.append((tx_d, flow))

            # Terminal valuation is a positive cash inflow to the investor
            if cur_val > 0 and val_date_str:
                terminal_d = pd.to_datetime(val_date_str).date()
                scheme_cash_flows.append((terminal_d, cur_val))

            scheme_xirr = an.xirr(scheme_cash_flows) if len(scheme_cash_flows) >= 2 else None

            # Accumulate into folio cash flows
            folio_cash_flows.extend(scheme_cash_flows)
            portfolio_cash_flows.extend(scheme_cash_flows)

            folio_value += cur_val
            total_portfolio_value += cur_val
            if is_direct:
                direct_value += cur_val
            else:
                regular_value += cur_val

            holding_item = {
                "folio": folio_num,
                "scheme_name": s_name,
                "isin": isin,
                "scheme_code": matched.get("scheme_code") if matched else None,
                "is_mapped": bool(matched),
                "is_direct": bool(is_direct),
                "plan": "Direct" if is_direct else "Regular",
                "category": matched.get("category", "Other") if matched else "Other",
                "cat": canonical_cat,
                "asset_class": asset_class,
                "units": round(units, 4),
                "nav": round(nav, 4) if nav > 0 else None,
                "current_value": round(cur_val, 2),
                "valuation_date": val_date_str,
                "xirr": round(scheme_xirr, 4) if scheme_xirr is not None else None,
                "tx_count": len(scheme.get("transactions", [])),
            }
            parsed_holdings.append(holding_item)
            folio_schemes.append(holding_item)

        folio_xirr = an.xirr(folio_cash_flows) if len(folio_cash_flows) >= 2 else None
        folios_summary.append({
            "folio": folio_num,
            "amc": amc,
            "pan": pan,
            "current_value": round(folio_value, 2),
            "schemes_count": len(folio_schemes),
            "xirr": round(folio_xirr, 4) if folio_xirr is not None else None,
            "schemes": folio_schemes,
        })

    # Portfolio-wide XIRR
    overall_xirr = an.xirr(portfolio_cash_flows) if len(portfolio_cash_flows) >= 2 else None

    # Calculate weight percentages for each holding
    for h in parsed_holdings:
        h["weight_pct"] = (
            round(h["current_value"] / total_portfolio_value * 100.0, 2)
            if total_portfolio_value > 0
            else 0.0
        )

    # Asset class breakdown
    asset_breakdown: dict[str, dict[str, Any]] = {}
    for h in parsed_holdings:
        ac = h["asset_class"]
        if ac not in asset_breakdown:
            asset_breakdown[ac] = {"value": 0.0, "pct": 0.0, "count": 0}
        asset_breakdown[ac]["value"] += h["current_value"]
        asset_breakdown[ac]["count"] += 1

    for ac, d in asset_breakdown.items():
        d["value"] = round(d["value"], 2)
        d["pct"] = round(d["value"] / total_portfolio_value * 100.0, 1) if total_portfolio_value > 0 else 0.0

    # Category breakdown
    cat_breakdown: dict[str, dict[str, Any]] = {}
    for h in parsed_holdings:
        cat_key = h["cat"] or "unclassified"
        if cat_key not in cat_breakdown:
            cat_breakdown[cat_key] = {"value": 0.0, "pct": 0.0, "count": 0}
        cat_breakdown[cat_key]["value"] += h["current_value"]
        cat_breakdown[cat_key]["count"] += 1

    for ck, d in cat_breakdown.items():
        d["value"] = round(d["value"], 2)
        d["pct"] = round(d["value"] / total_portfolio_value * 100.0, 1) if total_portfolio_value > 0 else 0.0

    # Plan comparison / drift if target_band provided
    band_comparison: dict[str, Any] | None = None
    if target_band:
        alloc = load_allocation()
        bands = alloc.get("bands", [])
        band_cfg = next((b for b in bands if b.get("name") == target_band), None)
        if band_cfg:
            target_split = {
                "equity": float(band_cfg.get("equity", 0.0)),
                "debt": float(band_cfg.get("debt", 0.0)),
                "commodities": float(band_cfg.get("gold", 0.0)),
                "cash": float(band_cfg.get("liquid", 0.0)),
            }
            comparison_rows = []
            for ac_name, target_pct in target_split.items():
                actual_pct = asset_breakdown.get(ac_name, {}).get("pct", 0.0)
                diff = round(actual_pct - target_pct, 1)
                comparison_rows.append({
                    "asset_class": ac_name,
                    "target_pct": target_pct,
                    "actual_pct": actual_pct,
                    "gap_pct": diff,
                    "status": "overweight" if diff > 5.0 else ("underweight" if diff < -5.0 else "aligned"),
                })
            band_comparison = {
                "target_band": target_band,
                "comparison": comparison_rows,
            }

    # Direct vs Regular breakdown notice
    plan_breakdown = {
        "direct": {
            "value": round(direct_value, 2),
            "pct": round(direct_value / total_portfolio_value * 100.0, 1) if total_portfolio_value > 0 else 0.0,
        },
        "regular": {
            "value": round(regular_value, 2),
            "pct": round(regular_value / total_portfolio_value * 100.0, 1) if total_portfolio_value > 0 else 0.0,
        },
        "notice": (
            "Fund Horizon distributes Regular plans only under ARN 345439. Direct plans are displayed for your portfolio tracking."
            if direct_value > 0
            else "All parsed holdings are Regular plans."
        ),
    }

    return {
        "statement_period": cas_dict.get("statement_period"),
        "investor_name": cas_dict.get("investor_info", {}).get("name"),
        "email": cas_dict.get("investor_info", {}).get("email"),
        "cas_type": cas_dict.get("cas_type"),
        "file_type": cas_dict.get("file_type"),
        "total_value": round(total_portfolio_value, 2),
        "overall_xirr": round(overall_xirr, 4) if overall_xirr is not None else None,
        "folios_count": len(folios_raw),
        "holdings_count": len(parsed_holdings),
        "holdings": parsed_holdings,
        "folios": folios_summary,
        "asset_allocation": asset_breakdown,
        "category_allocation": cat_breakdown,
        "plan_breakdown": plan_breakdown,
        "band_comparison": band_comparison,
        "privacy_notice": CAS_PRIVACY_NOTICE,
        "disclaimer": CAS_DISCLAIMER,
    }
