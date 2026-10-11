"""CAS (Consolidated Account Statement) ingestion and portfolio analysis engine.

Processes CAMS/KFintech CAS PDFs entirely in memory using casparser.
NEVER persists the raw PDF or password to disk or remote database.
Numbers are deterministic Python; no LLM and no runtime network calls.
"""
from __future__ import annotations

import io
import re
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


def _get_doc_text_samples(doc: Any, max_pages: int = 15) -> str:
    """Extract bounded text from up to max_pages of a pypdfium2 document."""
    samples = []
    try:
        page_count = len(doc)
    except Exception:
        page_count = 0

    for i in range(min(max_pages, page_count)):
        try:
            tp = doc[i].get_textpage()
            text = tp.get_text_bounded()
            if text:
                samples.append(text)
        except Exception:
            continue
    return "\n".join(samples)


def resilient_detect_file_type(
    pdf_path: Any,
    password: str,
    *,
    _doc: Any = None,
) -> Any:
    """Identify the CAS issuer with deep heuristic fallback for diverse statement formats."""
    from casparser.enums import FileType
    from casparser.parsers.detect import _open_document

    doc = _doc if _doc is not None else _open_document(pdf_path, password)
    text = _get_doc_text_samples(doc, max_pages=15)

    # 1. Standard exact casparser signatures
    if "CAMSCASWS" in text:
        return FileType.CAMS
    if "KFINCASWS" in text:
        return FileType.KFINTECH
    if "NSDL Consolidated Account Statement" in text or "About NSDL" in text:
        return FileType.NSDL
    if "Central Depository Services (India) Limited" in text:
        return FileType.CDSL

    # 2. Text normalization for tolerant matching
    text_upper = text.upper()
    text_collapsed = re.sub(r"[\s\-_.:/]+", "", text_upper)

    # CAMS patterns (mailback, online portal, aggregator)
    cams_patterns = [
        "CAMSCAS", "CAMSONLINE", "COMPUTERAGEMANAGEMENT", "CAMS_CAS",
        "CAMSCONSOLIDATED", "CAMSEMAIL", "CAMSMAILBACK", "CAMSINDIA",
    ]
    if any(p in text_collapsed for p in cams_patterns) or re.search(r"\bC\s*A\s*M\s*S\b", text, re.I):
        return FileType.CAMS

    # KFintech patterns (Karvy, KFin, portal)
    kfin_patterns = [
        "KFINCAS", "KFINTECH", "KFINTECHNOLOGIES", "KARVYCOMPUTERSHARE",
        "KARVYFINTECH", "KARVY", "KFIN", "KFINTECH.COM",
    ]
    if any(p in text_collapsed for p in kfin_patterns) or re.search(r"\bK\s*F\s*I\s*N(?:\s*T\s*E\s*C\s*H)?\b", text, re.I):
        return FileType.KFINTECH

    # NSDL patterns
    nsdl_patterns = [
        "NATIONALSECURITIESDEPOSITORY", "NSDLCONSOLIDATED", "NSDLECAS",
        "NSDLCAS", "NSDL.CO.IN", "NSDLINDIA", "CASNSDL",
    ]
    if any(p in text_collapsed for p in nsdl_patterns) or re.search(r"\bN\s*S\s*D\s*L\b", text, re.I):
        return FileType.NSDL

    # CDSL patterns
    cdsl_patterns = [
        "CENTRALDEPOSITORYSERVICES", "CDSLCONSOLIDATED", "CDSLECAS",
        "CDSLCAS", "CDSLINDIA", "CDSLVENTURES", "CASCDSL",
    ]
    if any(p in text_collapsed for p in cdsl_patterns) or re.search(r"\bC\s*D\s*S\s*L\b", text, re.I):
        return FileType.CDSL

    # 3. Structural Demat signatures
    if any(k in text_collapsed for k in ["BENEFICIARYOWNER", "BOID", "12081600"]):
        return FileType.CDSL
    if any(k in text_collapsed for k in ["DEPOSITORYPARTICIPANT", "DPID", "IN30"]):
        return FileType.NSDL

    # 4. Structural Mutual Fund / RTA signatures (CAMS / KFintech table layouts)
    rta_markers = [
        "FOLIONO", "FOLIONUMBER", "OPENINGUNITBALANCE", "CLOSINGUNITBALANCE",
        "TRANSACTIONDESCRIPTION", "NAVON", "VALUATIONON", "MUTUALFUND",
        "REGISTRAR", "PURCHASE/SIP", "TOTALCOSTVALUE",
    ]
    if any(m in text_collapsed for m in rta_markers) or "FOLIO" in text_upper:
        return FileType.CAMS

    # 5. Default fallback to CAMS (the most universal RTA parser) rather than failing
    return FileType.CAMS


def resilient_detect_cas_type(
    pdf_path: Any,
    password: str,
    *,
    _doc: Any = None,
) -> Any:
    """Identify whether statement is SUMMARY or DETAILED without failing on cover pages."""
    from casparser.enums import CASFileType
    from casparser.parsers.detect import _open_document

    doc = _doc if _doc is not None else _open_document(pdf_path, password)
    text = _get_doc_text_samples(doc, max_pages=6).lower()

    if "summary" in text and "statement" not in text and "detailed" not in text:
        return CASFileType.SUMMARY
    return CASFileType.DETAILED


def _apply_casparser_patches() -> None:
    """Safely monkeypatch casparser's issuer detectors to handle real-world CAS PDFs."""
    try:
        import casparser.parsers as _c_parsers
        import casparser.parsers.detect as _c_detect

        _c_detect.detect_file_type = resilient_detect_file_type
        _c_parsers.detect_file_type = resilient_detect_file_type
        _c_detect.detect_cas_type = resilient_detect_cas_type
        _c_parsers.detect_cas_type = resilient_detect_cas_type
    except Exception:
        pass


_apply_casparser_patches()


def normalize_cas_dict(parsed: Any) -> dict[str, Any]:
    """Ensure parsed CAS data is a python dictionary and normalize Demat accounts into standard folios."""
    if hasattr(parsed, "model_dump"):
        data = parsed.model_dump(by_alias=True)
    elif hasattr(parsed, "dict"):
        data = parsed.dict()
    elif isinstance(parsed, dict):
        data = dict(parsed)
    else:
        data = {"folios": []}

    period = data.get("statement_period")
    if isinstance(period, dict):
        for k, v in period.items():
            if hasattr(v, "isoformat"):
                period[k] = v.isoformat()

    # Convert Demat accounts (from NSDL/CDSL statements) to folios if folios is empty
    if not data.get("folios") and data.get("accounts"):
        folios = []
        for a_idx, acc in enumerate(data.get("accounts", [])):
            dp_name = str(acc.get("name") or "Demat Holding Account").strip()
            dp_id = str(acc.get("dp_id") or "").strip()
            client_id = str(acc.get("client_id") or "").strip()
            folio_id = f"{dp_id}/{client_id}" if dp_id and client_id else (client_id or dp_id or f"Demat-{a_idx+1}")

            schemes = []
            for mf in acc.get("mutual_funds", []):
                s_name = str(mf.get("name") or "Mutual Fund Scheme").strip()
                isin = str(mf.get("isin") or "").strip().upper()
                amfi = str(mf.get("amfi") or "").strip()
                balance = float(mf.get("balance", 0.0) or 0.0)
                nav = float(mf.get("nav", 0.0) or 0.0)
                val = float(mf.get("value", 0.0) or 0.0)
                if val <= 0.0 and balance > 0 and nav > 0:
                    val = balance * nav

                schemes.append({
                    "scheme": s_name,
                    "isin": isin,
                    "amfi": amfi,
                    "close": balance,
                    "valuation": {
                        "date": str(period.get("to") if isinstance(period, dict) else "") or None,
                        "nav": nav,
                        "value": val,
                    },
                    "transactions": [],
                })

            for eq in acc.get("equities", []):
                eq_name = str(eq.get("name") or "Equity Share").strip()
                isin = str(eq.get("isin") or "").strip().upper()
                balance = float(eq.get("balance", 0.0) or 0.0)
                val = float(eq.get("value", 0.0) or 0.0)
                nav = round(val / balance, 2) if balance > 0 and val > 0 else 0.0

                schemes.append({
                    "scheme": eq_name,
                    "isin": isin,
                    "amfi": "",
                    "close": balance,
                    "valuation": {
                        "date": str(period.get("to") if isinstance(period, dict) else "") or None,
                        "nav": nav,
                        "value": val,
                    },
                    "transactions": [],
                })

            if schemes:
                folios.append({
                    "folio": folio_id,
                    "amc": dp_name,
                    "PAN": str(data.get("investor_info", {}).get("pan", "") or ""),
                    "schemes": schemes,
                })

        data["folios"] = folios

    return data


def extract_cas_via_text_fallback(pdf_bytes: bytes, password: str) -> dict[str, Any]:
    """Fallback in-memory text extractor for custom, aggregator, or non-standard CAS PDFs."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes), password=password)
    pages_text: list[str] = []
    for page in doc:
        tp = page.get_textpage()
        pages_text.append(tp.get_text_bounded())
    doc.close()

    full_text = "\n".join(pages_text)

    investor_name = "Valued Investor"
    m_name = re.search(r"(?:Name|Investor(?:\s*Name)?)\s*[:\-]\s*([A-Za-z\s.]{3,40})", full_text, re.I)
    if m_name:
        investor_name = m_name.group(1).strip()
    elif pages_text:
        lines = [line_txt.strip() for line_txt in pages_text[0].splitlines() if line_txt.strip()]
        for line_txt in lines[:5]:
            if len(line_txt) > 3 and not any(k in line_txt.lower() for k in ["statement", "cas", "cams", "kfin", "nsdl", "cdsl", "portfolio", "folio"]):
                investor_name = line_txt
                break

    statement_period: dict[str, str | None] = {"from": None, "to": None}
    m_period = re.search(r"(?:Period|Statement\s*Period)\s*[:\-]?\s*(?:From\s*)?([0-9A-Za-z\-/]+)\s*(?:To|to|-)\s*([0-9A-Za-z\-/]+)", full_text, re.I)
    if m_period:
        statement_period["from"] = m_period.group(1).strip()
        statement_period["to"] = m_period.group(2).strip()

    isin_pattern = re.compile(r"\b(INF[A-Z0-9]{9})\b")
    current_folio_num = "Folio-1"
    current_amc = "Mutual Fund Portfolio"

    schemes: list[dict[str, Any]] = []
    seen_isins: set[str] = set()

    for page_text in pages_text:
        lines = [line_txt.strip() for line_txt in page_text.splitlines() if line_txt.strip()]
        for idx, line in enumerate(lines):
            amc_match = re.search(r"([A-Za-z\s]+(?:Mutual\s*Fund|Asset\s*Management))", line, re.I)
            if amc_match:
                current_amc = amc_match.group(1).strip()

            folio_match = re.search(r"(?:Folio\s*(?:No\.?|Number)?\s*[:\-]?\s*)([A-Za-z0-9/\-_]+)", line, re.I)
            if folio_match:
                current_folio_num = folio_match.group(1).strip()

            isin_match = isin_pattern.search(line)
            if isin_match:
                isin = isin_match.group(1).upper()
                if isin in seen_isins:
                    continue
                seen_isins.add(isin)

                scheme_name = line
                if len(line.replace(isin, "").strip()) < 5 and idx > 0:
                    scheme_name = lines[idx - 1]

                window = " ".join(lines[max(0, idx - 2):min(len(lines), idx + 6)])

                nav = 0.0
                val = 0.0
                units = 0.0

                m_nav = re.search(r"NAV\s*[:\-]?\s*(?:INR|Rs\.?)?\s*([0-9]+(?:\.[0-9]+)?)", window, re.I)
                if m_nav:
                    nav = float(m_nav.group(1))

                m_val = re.search(r"(?:Value|Market\s*Value)\s*[:\-]?\s*(?:INR|Rs\.?)?\s*([0-9,]+(?:\.[0-9]+)?)", window, re.I)
                if m_val:
                    val = float(m_val.group(1).replace(",", ""))

                m_units = re.search(r"(?:Units|Balance)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)", window, re.I)
                if m_units:
                    units = float(m_units.group(1).replace(",", ""))

                if val <= 0.0 and units > 0 and nav > 0:
                    val = units * nav

                schemes.append({
                    "scheme": scheme_name,
                    "isin": isin,
                    "amfi": "",
                    "close": units,
                    "valuation": {
                        "date": statement_period["to"],
                        "nav": nav,
                        "value": val,
                    },
                    "transactions": [],
                })

    folios: list[dict[str, Any]] = []
    if schemes:
        folios.append({
            "folio": current_folio_num,
            "amc": current_amc,
            "PAN": "",
            "schemes": schemes,
        })

    return {
        "statement_period": statement_period,
        "investor_info": {
            "name": investor_name,
            "email": "",
            "mobile": "",
        },
        "file_type": "CAMS",
        "cas_type": "DETAILED",
        "folios": folios,
    }


def parse_cas_pdf_bytes(
    pdf_bytes: bytes,
    password: str,
    max_size: int = MAX_CAS_PDF_SIZE_BYTES,
) -> dict[str, Any]:
    """Parse a CAS PDF strictly in memory.

    Validates size limit and %PDF magic bytes before invoking multi-strategy parsing.
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

    # Ensure resilient patches are active
    _apply_casparser_patches()

    clean_pass = password.strip()

    # Pre-verify password using pypdfium2 to return clear, immediate feedback on password errors
    try:
        import pypdfium2 as pdfium
        from pypdfium2._helpers.misc import PdfiumError

        test_doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes), password=clean_pass)
        test_doc.close()
    except PdfiumError as pe:
        msg = str(pe)
        if "PASSWORD" in msg.upper() or "password" in msg:
            raise CASPasswordError("Incorrect password for CAS statement. Please verify and try again.") from pe
        raise CASValidationError(f"Unable to read PDF document: {pe}") from pe
    except Exception as e:
        if "password" in str(e).lower():
            raise CASPasswordError("Incorrect password for CAS statement. Please verify and try again.") from e

    import casparser
    from casparser.enums import FileType
    from casparser.exceptions import IncorrectPasswordError

    last_err: Exception | None = None

    # Strategy 1: Standard casparser dispatcher with resilient detection
    try:
        f = io.BytesIO(pdf_bytes)
        parsed = casparser.read_cas_pdf(f, password=clean_pass, output="dict")
        return normalize_cas_dict(parsed)
    except IncorrectPasswordError as e:
        raise CASPasswordError("Incorrect password for CAS statement. Please verify and try again.") from e
    except Exception as e:
        last_err = e

    # Strategy 2: Direct targeted parser invocations
    try:
        from casparser.parsers import cams_detailed
        parsed = cams_detailed.parse(io.BytesIO(pdf_bytes), clean_pass, file_type=FileType.CAMS)
        return normalize_cas_dict(parsed)
    except Exception:
        pass

    try:
        from casparser.parsers import cdsl
        parsed = cdsl.parse_cdsl(io.BytesIO(pdf_bytes), clean_pass, file_type=FileType.CDSL)
        return normalize_cas_dict(parsed)
    except Exception:
        pass

    try:
        from casparser.parsers import nsdl
        parsed = nsdl.parse_nsdl(io.BytesIO(pdf_bytes), clean_pass, file_type=FileType.NSDL)
        return normalize_cas_dict(parsed)
    except Exception:
        pass

    try:
        from casparser.parsers import cams_summary
        parsed = cams_summary.parse(io.BytesIO(pdf_bytes), clean_pass, file_type=FileType.CAMS)
        return normalize_cas_dict(parsed)
    except Exception:
        pass

    # Strategy 3: Text-based holding extraction fallback
    try:
        fallback_res = extract_cas_via_text_fallback(pdf_bytes, clean_pass)
        if fallback_res and fallback_res.get("folios") and fallback_res["folios"][0].get("schemes"):
            return normalize_cas_dict(fallback_res)
    except Exception:
        pass

    if last_err:
        raise CASParsingError(f"Failed to parse CAS statement structure: {last_err}")
    raise CASParsingError("Unable to extract portfolio holdings from this CAS PDF format.")


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
    cas_dict = normalize_cas_dict(cas_dict)
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
