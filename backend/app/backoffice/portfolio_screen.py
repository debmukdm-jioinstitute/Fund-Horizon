from __future__ import annotations
"""Mutual Fund Portfolio Screening Service.

Parses client portfolio statements (CAMS / KFintech / CDSL / NSDL CAS PDFs) in memory,
accurately matches holdings against canonical AMFI screening data,
preserves Direct/Regular and Growth/IDCW distinctions,
and assigns FH scores /100, star ratings, Buy/Hold/Sell signals, and concise evidence reasons.
"""

import difflib
import io
import re
from typing import Any

import pandas as pd

from app.backoffice import fh_score
from app.engine import cas


class PortfolioPDFError(Exception):
    def __init__(self, message: str, code: str = "bad_request", status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


def clean_isin(val: Any) -> str | None:
    if not val:
        return None
    s = str(val).strip().upper()
    if re.match(r"^INF[A-Z0-9]{9}$", s):
        return s
    return None


def clean_code(val: Any) -> str | None:
    if not val:
        return None
    s = str(val).strip()
    if s.isdigit() and len(s) in (5, 6):
        return s
    return None


def detect_plan(name: str) -> str:
    n = name.lower()
    if "direct" in n:
        return "Direct"
    if "regular" in n:
        return "Regular"
    return "Unknown"


def detect_option(name: str) -> str:
    n = name.lower()
    if "idcw" in n or "dividend" in n:
        return "IDCW"
    if "growth" in n:
        return "Growth"
    return "Unknown"


def normalize_scheme_text(text: str) -> str:
    """Normalize fund name for tolerant name matching."""
    t = text.lower()
    tokens_to_remove = [
        "mutual fund", "fund", "growth", "idcw", "dividend", "payout", "reinvestment",
        "direct", "regular", "plan", "option", "-", "/", "(", ")", ",", ".", "bonus",
        "retail", "institutional"
    ]
    for tok in tokens_to_remove:
        t = t.replace(tok, " ")
    return " ".join(t.split())


def extract_raw_holdings(parsed_cas: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract clean holdings from parsed CAS folios, discarding closed/zero positions."""
    holdings: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    folios = parsed_cas.get("folios", [])
    for folio_obj in folios:
        folio_num = str(folio_obj.get("folio") or "").strip()
        amc = str(folio_obj.get("amc") or "").strip()
        for s in folio_obj.get("schemes", []):
            name = str(s.get("scheme") or "").strip()
            if not name:
                continue

            isin = clean_isin(s.get("isin"))
            amfi = clean_code(s.get("amfi"))
            close_units = float(s.get("close") or 0.0)
            val_obj = s.get("valuation") or {}
            val = float(val_obj.get("value") or 0.0)
            nav = float(val_obj.get("nav") or 0.0)
            val_date = str(val_obj.get("date") or "") or None

            # Skip zero / closed holdings
            if close_units <= 0.0 and val <= 0.0:
                continue

            # If value is 0 but units and nav exist
            if val <= 0.0 and close_units > 0 and nav > 0:
                val = round(close_units * nav, 2)

            key = f"{folio_num}|{isin or amfi or name}"
            if key in seen_keys:
                for h in holdings:
                    if h.get("_dedup_key") == key:
                        h["units"] = round((h.get("units") or 0.0) + close_units, 4)
                        if val > 0:
                            h["statement_value"] = round((h.get("statement_value") or 0.0) + val, 2)
                        break
                continue

            seen_keys.add(key)
            holdings.append({
                "_dedup_key": key,
                "raw_name": name,
                "isin": isin,
                "amfi_code": amfi,
                "folio": folio_num or None,
                "amc": amc or None,
                "units": round(close_units, 4) if close_units > 0 else None,
                "statement_nav": round(nav, 4) if nav > 0 else None,
                "statement_value": round(val, 2) if val > 0 else None,
                "valuation_date": val_date,
            })

    return holdings


def parse_portfolio_pdf_bytes(pdf_bytes: bytes, password: str = "") -> dict[str, Any]:
    """Parse statement PDF in memory, enforcing file validations and decryption checks."""
    if not pdf_bytes:
        raise PortfolioPDFError("Uploaded PDF file is empty.", code="empty_file", status_code=400)

    if len(pdf_bytes) > cas.MAX_CAS_PDF_SIZE_BYTES:
        raise PortfolioPDFError(
            f"File size exceeds maximum allowed limit of {cas.MAX_CAS_PDF_SIZE_BYTES // (1024 * 1024)} MB.",
            code="file_too_large",
            status_code=400,
        )

    if not pdf_bytes.startswith(b"%PDF"):
        raise PortfolioPDFError("Uploaded file is not a valid PDF document (missing %PDF signature).", code="invalid_pdf", status_code=400)

    try:
        parsed = cas.parse_cas_pdf_bytes(pdf_bytes, password=password)
        return parsed
    except cas.CASPasswordError as pe:
        msg = str(pe)
        if not password:
            raise PortfolioPDFError("This portfolio PDF is password-protected. Please enter the password to decrypt.", code="password_required", status_code=400) from pe
        raise PortfolioPDFError("Incorrect password for this statement. Please verify and try again.", code="incorrect_password", status_code=400) from pe
    except cas.CASValidationError as ve:
        raise PortfolioPDFError(str(ve), code="validation_error", status_code=400) from ve
    except cas.CASParsingError as cpe:
        raise PortfolioPDFError("Unable to extract text structure from this statement. If this is a scanned document without a text layer, please upload an electronic e-CAS statement.", code="scanned_or_unsupported", status_code=422) from cpe
    except Exception as e:
        raise PortfolioPDFError(f"Statement parsing failed: {e}", code="parse_error", status_code=422) from e


def match_and_screen_portfolio(holdings: list[dict[str, Any]], frame: pd.DataFrame) -> dict[str, Any]:
    """Match extracted holdings against the scored screener frame and compile screening signals."""
    # Build fast indexed lookups from frame
    isin_map: dict[str, dict[str, Any]] = {}
    code_map: dict[str, dict[str, Any]] = {}
    pool_by_plan: dict[str, list[tuple[str, str, str, dict[str, Any]]]] = {"Direct": [], "Regular": [], "All": []}

    for row in frame.to_dict("records"):
        c = str(row.get("code") or "")
        code_map[c] = row
        isin_val = clean_isin(row.get("isin"))
        if isin_val and isin_val not in isin_map:
            isin_map[isin_val] = row

        plan = str(row.get("plan") or "")
        name = str(row.get("name") or "")
        norm = normalize_scheme_text(name)
        entry = (c, name, norm, row)
        if plan in pool_by_plan:
            pool_by_plan[plan].append(entry)
        pool_by_plan["All"].append(entry)

    results: list[dict[str, Any]] = []
    total_val: float = 0.0

    for idx, h in enumerate(holdings, start=1):
        raw_name = h["raw_name"]
        isin = h.get("isin")
        amfi = h.get("amfi_code")
        det_plan = detect_plan(raw_name)
        det_opt = detect_option(raw_name)

        matched_row: dict[str, Any] | None = None
        match_type: str = "unmatched"
        candidates: list[dict[str, Any]] = []

        # 1. Exact ISIN match
        if isin and isin in isin_map:
            candidate = isin_map[isin]
            matched_row = candidate
            match_type = "exact_isin"

        # 2. Exact AMFI code match
        if not matched_row and amfi and amfi in code_map:
            candidate = code_map[amfi]
            matched_row = candidate
            match_type = "exact_code"

        # 3. High confidence name matching with plan/option filtering
        if not matched_row:
            target_plan = det_plan if det_plan in ("Direct", "Regular") else "All"
            search_pool = pool_by_plan.get(target_plan) or pool_by_plan["All"]
            norm_raw = normalize_scheme_text(raw_name)

            scored_candidates: list[tuple[float, dict[str, Any]]] = []
            for c_code, c_name, c_norm, c_row in search_pool:
                score = difflib.SequenceMatcher(None, norm_raw, c_norm).ratio()
                # Bonus if AMC or main keyphrase aligns
                if c_norm and norm_raw and (c_norm in norm_raw or norm_raw in c_norm):
                    score = min(1.0, score + 0.15)
                if score >= 0.55:
                    scored_candidates.append((score, c_row))

            scored_candidates.sort(key=lambda x: x[0], reverse=True)

            if scored_candidates:
                top_score, top_row = scored_candidates[0]
                runner_up = scored_candidates[1][0] if len(scored_candidates) > 1 else 0.0

                if top_score >= 0.82 and (top_score - runner_up >= 0.08 or top_score >= 0.92):
                    matched_row = top_row
                    match_type = "matched_name"
                else:
                    match_type = "ambiguous"
                    candidates = [
                        {
                            "code": str(r["code"]),
                            "name": r["name"],
                            "plan": r["plan"],
                            "cat_label": r.get("cat_label") or r.get("cat"),
                            "fh_score": r.get("fh_score"),
                            "fh_rating": r.get("fh_rating"),
                            "fh_signal": r.get("fh_signal"),
                            "similarity": round(sc, 2),
                        }
                        for sc, r in scored_candidates[:5]
                    ]

        st_val = h.get("statement_value")
        if st_val is not None and st_val > 0:
            total_val += st_val

        # Compile signal, score, stars and reasons
        if matched_row:
            c_code = str(matched_row["code"])
            c_name = matched_row["name"]
            c_plan = matched_row.get("plan") or det_plan
            c_cat = matched_row.get("cat_label") or matched_row.get("cat") or "Equity"
            c_score = matched_row.get("fh_score")
            c_rating = matched_row.get("fh_rating")
            c_asof = matched_row.get("nav_date")

            if det_opt == "IDCW":
                signal = "Needs review"
                reasons = [
                    "IDCW (Dividend) option held in client statement.",
                    "Fund Horizon screener monitors total-return Growth options; review dividend payout efficiency and reinvestment.",
                    f"Growth counterpart scored {c_score}/100 ({int(c_rating or 0)} stars) with {matched_row.get('fh_signal', 'signal')} signal.",
                ]
            else:
                signal = matched_row.get("fh_signal") or "Needs review"
                reasons = list(matched_row.get("fh_signal_reasons") or [])
                if not reasons:
                    reasons = fh_score.generate_signal_reasons(matched_row, signal)
        else:
            c_code = None
            c_name = None
            c_plan = det_plan if det_plan in ("Direct", "Regular") else "Unknown"
            c_cat = cas.infer_scheme_category(raw_name)
            c_score = None
            c_rating = None
            c_asof = None
            signal = "Needs review"

            if match_type == "ambiguous":
                reasons = [
                    f"Ambiguous match ({len(candidates)} candidates found).",
                    "Staff must select the exact matching AMFI scheme to verify the screening signal.",
                ]
            else:
                reasons = [
                    "Scheme identifier not verified in AMFI screening catalog.",
                    "Check if the holding is an unlisted fund, closed-ended scheme, or new launch.",
                ]

        results.append({
            "id": f"holding-{idx}",
            "raw_name": raw_name,
            "isin": isin or (clean_isin(matched_row.get("isin")) if matched_row else None),
            "amfi_code": c_code,
            "canonical_name": c_name,
            "folio": h.get("folio"),
            "amc": h.get("amc") or (matched_row.get("amc") if matched_row else None),
            "plan": c_plan,
            "option": det_opt,
            "category": c_cat,
            "units": h.get("units"),
            "statement_nav": h.get("statement_nav"),
            "statement_value": st_val,
            "portfolio_weight_pct": None,  # populated below
            "valuation_date": h.get("valuation_date"),
            "data_as_of": c_asof,
            "fh_score": c_score,
            "fh_rating": c_rating,
            "fh_signal": signal,
            "fh_signal_reasons": reasons,
            "match_type": match_type,
            "candidates": candidates,
            "detail_path": f"/backoffice/mutual-funds/{c_code}" if c_code else None,
            "underlying_metrics": {
                "sortino_3y": matched_row.get("sortino_3y") if matched_row else None,
                "sharpe_3y": matched_row.get("sharpe_3y") if matched_row else None,
                "out_3y": matched_row.get("out_3y") if matched_row else None,
                "out_1y": matched_row.get("out_1y") if matched_row else None,
                "cagr_3y": matched_row.get("cagr_3y") if matched_row else None,
                "manager_tenure_years": matched_row.get("manager_tenure_years") if matched_row else None,
                "ter": matched_row.get("ter") if matched_row else None,
            } if matched_row else None,
        })

    # Calculate portfolio weights
    for r in results:
        v = r.get("statement_value")
        if v is not None and total_val > 0:
            r["portfolio_weight_pct"] = round((v / total_val) * 100, 2)

    matched_cnt = sum(1 for r in results if r["match_type"] in ("exact_isin", "exact_code", "matched_name"))
    buy_cnt = sum(1 for r in results if r["fh_signal"] == "Buy")
    hold_cnt = sum(1 for r in results if r["fh_signal"] == "Hold")
    sell_cnt = sum(1 for r in results if r["fh_signal"] == "Sell")
    review_cnt = sum(1 for r in results if r["fh_signal"] == "Needs review")
    val_dates = [r["valuation_date"] for r in results if r.get("valuation_date")]
    asof_dates = [r["data_as_of"] for r in results if r.get("data_as_of")]

    summary = {
        "total_value": round(total_val, 2) if total_val > 0 else None,
        "holdings_count": len(results),
        "matched_count": matched_cnt,
        "needs_review_count": review_cnt,
        "buy_count": buy_cnt,
        "hold_count": hold_cnt,
        "sell_count": sell_cnt,
        "statement_date": max(val_dates) if val_dates else None,
        "screening_date": max(asof_dates) if asof_dates else None,
        "is_partial": any(r["statement_value"] is None for r in results),
    }

    return {
        "holdings": results,
        "summary": summary,
    }


def score_single_scheme_resolution(code: str, raw_name: str, statement_value: float | None, total_value: float | None, frame: pd.DataFrame) -> dict[str, Any] | None:
    """Helper to re-score a holding when staff manually assigns a canonical scheme."""
    match = frame[frame["code"].astype(str) == str(code)]
    if match.empty:
        return None
    r = match.to_dict("records")[0]
    det_opt = detect_option(raw_name)

    if det_opt == "IDCW":
        signal = "Needs review"
        reasons = [
            "IDCW (Dividend) option held in client statement.",
            "Fund Horizon screener monitors total-return Growth options; review dividend payout impact.",
            f"Growth counterpart scored {r.get('fh_score')}/100 with {r.get('fh_signal', 'signal')} signal.",
        ]
    else:
        signal = r.get("fh_signal") or "Needs review"
        reasons = list(r.get("fh_signal_reasons") or [])
        if not reasons:
            reasons = fh_score.generate_signal_reasons(r, signal)

    weight = round((statement_value / total_value * 100), 2) if statement_value and total_value and total_value > 0 else None

    return {
        "amfi_code": str(r["code"]),
        "canonical_name": r["name"],
        "plan": r["plan"],
        "option": det_opt,
        "category": r.get("cat_label") or r.get("cat"),
        "statement_value": statement_value,
        "portfolio_weight_pct": weight,
        "data_as_of": r.get("nav_date"),
        "fh_score": r.get("fh_score"),
        "fh_rating": r.get("fh_rating"),
        "fh_signal": signal,
        "fh_signal_reasons": reasons,
        "match_type": "manual_resolved",
        "detail_path": f"/backoffice/mutual-funds/{r['code']}",
        "underlying_metrics": {
            "sortino_3y": r.get("sortino_3y"),
            "sharpe_3y": r.get("sharpe_3y"),
            "out_3y": r.get("out_3y"),
            "out_1y": r.get("out_1y"),
            "cagr_3y": r.get("cagr_3y"),
            "manager_tenure_years": r.get("manager_tenure_years"),
            "ter": r.get("ter"),
        },
    }

