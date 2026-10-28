"""MF Research V2 pure helpers: portfolio look-through, true-index metrics,
consistency metrics, co-manager handling, fund operations, client overlap.

Every function here is pure (plain dicts / pandas Series in, dicts out) so it
is unit-testable without a database or a network call. Nothing in this module
invents data: a missing input yields None plus a reason string, never 0 and
never a fabricated figure. New user-facing copy uses "Marked pick" only; this
module produces no pick language at all.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import pandas as pd

from app.backoffice.mf_holdings import normalize_holding_name
from app.engine import analytics as an

# ---------------------------------------------------------------------------
# Small shared parsers
# ---------------------------------------------------------------------------

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

_SSD_DATE_RE = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December"
    r"|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})",
    re.IGNORECASE,
)


def parse_ssd_date(text: str | None) -> str | None:
    """Parse an AMFI SSD "Managing Since <Month> <day>, <year>" string to ISO date.

    Returns None when the text carries no parseable calendar date, so callers
    keep the raw wording instead of guessing a date.
    """
    if not text:
        return None
    m = _SSD_DATE_RE.search(text)
    if not m:
        return None
    month = _MONTHS.get(m.group(1).lower())
    if month is None:
        return None
    try:
        return datetime(int(m.group(3)), month, int(m.group(2))).date().isoformat()
    except ValueError:
        return None


def tenure_years(start_iso: str | None, as_of_iso: str | None) -> float | None:
    """Years between a manager start date and an as-of date; None when unusable."""
    if not start_iso or not as_of_iso:
        return None
    try:
        start = pd.Timestamp(start_iso)
        as_of = pd.Timestamp(as_of_iso)
    except (ValueError, TypeError):
        return None
    days = (as_of - start).days
    return round(days / 365.25, 2) if days >= 0 else None


RISKOMETER_LEVELS: dict[str, int] = {
    "low": 1, "low to moderate": 2, "moderate": 3,
    "moderately high": 4, "high": 5, "very high": 6,
}


def riskometer_level(text: str | None) -> int | None:
    """SEBI riskometer wording -> 1..6 level. None when the wording is unknown."""
    if not text:
        return None
    # Accept both "Moderate" and "Moderate Risk".
    key = re.sub(r"\s+", " ", text.strip().lower()).replace(" risk", "").strip()
    return RISKOMETER_LEVELS.get(key)


# ---------------------------------------------------------------------------
# Portfolio look-through (holdings in, aggregates out)
# ---------------------------------------------------------------------------

def _holding_isin(h: dict[str, Any]) -> str:
    return str(h.get("isin") or "").strip().upper()


def _holding_key(h: dict[str, Any]) -> str:
    """ISIN-first holding key, falling back to the normalised holding name.

    An ISIN, when present, is the key (prefixed so it can never collide
    with a name string); a holding without an ISIN keys on its normalised
    name (mf_holdings.normalize_holding_name: case/punctuation/& folded).
    Never fuzzy: two names match only when their normalised forms agree.
    """
    isin = _holding_isin(h)
    if isin:
        return f"isin:{isin}"
    return f"name:{normalize_holding_name(h.get('name'))}"


def sector_aggregation(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    """Sector percentages from a holdings list [{name, isin, sector, weight_pct}].

    Holdings without a sector land in "Unclassified" and are flagged, never
    silently dropped; the percentages always sum to the classified total and
    the unclassified share is reported separately.
    """
    sectors: dict[str, float] = {}
    unclassified = 0.0
    total = 0.0
    for h in holdings:
        w = h.get("weight_pct")
        if w is None:
            continue
        try:
            w = float(w)
        except (TypeError, ValueError):
            continue
        total += w
        sector = (h.get("sector") or "").strip()
        if sector:
            sectors[sector] = sectors.get(sector, 0.0) + w
        else:
            unclassified += w
    ordered = sorted(sectors.items(), key=lambda kv: -kv[1])
    return {
        "sectors": [{"sector": s, "weight_pct": round(w, 2)} for s, w in ordered],
        "unclassified_pct": round(unclassified, 2),
        "total_weight_pct": round(total, 2),
        "coverage": "full" if holdings and unclassified == 0 else ("partial" if holdings else "none"),
    }


def portfolio_summary(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    """Counts, concentration and cash share for one holdings snapshot."""
    weights = sorted(
        (float(h["weight_pct"]) for h in holdings if h.get("weight_pct") is not None),
        reverse=True,
    )
    # Cash by name (legacy fixtures) or by the snapshot's instrument_type
    # (real disclosures label the row "TREPS / Reverse Repo" or
    # "Net Receivables / (Payables)", which the name list does not cover).
    cash = sum(
        float(h["weight_pct"]) for h in holdings
        if h.get("weight_pct") is not None
        and (str(h.get("name") or "").strip().lower() in {"cash", "cash & equivalents", "cash and equivalents", "net receivables"}
             or h.get("instrument_type") == "cash")
    )
    return {
        "holdings_count": len(holdings),
        "top10_concentration_pct": round(sum(weights[:10]), 2) if weights else None,
        "top_holding_pct": round(weights[0], 2) if weights else None,
        "cash_pct": round(cash, 2) if holdings else None,
        "total_weight_pct": round(sum(weights), 2) if weights else None,
    }


def fund_overlap(
    holdings_a: list[dict[str, Any]], holdings_b: list[dict[str, Any]]
) -> dict[str, Any]:
    """Overlap between two funds' holdings, matched on ISIN then name.

    Returns shared holdings with their weight in each fund, plus the shared
    weight totals. Empty input on either side yields shared weight None with
    a reason, never 0% (0% would claim "no overlap" from missing data).
    Matching: an ISIN in fund A matches only the same ISIN in fund B; a
    holding with no ISIN falls back to its normalised name. An ISIN
    mismatch is never rescued by a name match — different ISINs are
    different securities even when the names look alike.
    """
    if not holdings_a or not holdings_b:
        return {
            "shared_holdings": [], "shared_count": 0,
            "shared_weight_in_a_pct": None, "shared_weight_in_b_pct": None,
            "reason": "Portfolio snapshot unavailable for one or both funds",
        }
    b_by_isin = {_holding_isin(h): h for h in holdings_b if _holding_isin(h)}
    b_by_name = {normalize_holding_name(h.get("name")): h
                 for h in holdings_b if normalize_holding_name(h.get("name"))}
    shared = []
    wa = wb = 0.0
    for h in holdings_a:
        isin = _holding_isin(h)
        other = b_by_isin.get(isin) if isin else b_by_name.get(normalize_holding_name(h.get("name")))
        if other is None:
            continue
        wa += float(h.get("weight_pct") or 0)
        wb += float(other.get("weight_pct") or 0)
        shared.append({
            "name": h.get("name"), "isin": h.get("isin"),
            "weight_in_a_pct": h.get("weight_pct"), "weight_in_b_pct": other.get("weight_pct"),
        })
    shared.sort(key=lambda r: -(r["weight_in_a_pct"] or 0))
    return {
        "shared_holdings": shared, "shared_count": len(shared),
        "shared_weight_in_a_pct": round(wa, 2), "shared_weight_in_b_pct": round(wb, 2),
        "reason": None,
    }


# ---------------------------------------------------------------------------
# True-index metrics (vs a real TRI series, kept separate from vs-median)
# ---------------------------------------------------------------------------

def index_metrics(
    fund_monthly_nav: pd.Series,
    index_series: pd.Series,
    rf: float = 0.065,
) -> dict[str, Any]:
    """Alpha, beta, tracking error and information ratio vs a real index series.

    All windows are 3Y on month-end points, matching the screening risk
    window. Every field is None (with a reason) when fewer than 12 common
    monthly points exist, so a young fund never gets a fabricated index beta.
    Returns are in percent for display; ratios are unit-free.
    """
    if fund_monthly_nav is None or index_series is None or len(fund_monthly_nav) < 2 or len(index_series) < 2:
        return {"alpha_3y_pct": None, "beta_3y": None, "tracking_error_3y_pct": None,
                "information_ratio_3y": None, "index_ret_3y_pct": None, "fund_ret_3y_pct": None,
                "reason": "Index series unavailable or too short"}
    fund = fund_monthly_nav.sort_index()
    index = index_series.sort_index()
    end = fund.index[-1]
    start = end - pd.DateOffset(years=3)
    fund_3y = fund.loc[fund.index >= start]
    index_3y = index.loc[index.index >= start]
    if len(fund_3y) < 13 or len(index_3y) < 13:
        return {"alpha_3y_pct": None, "beta_3y": None, "tracking_error_3y_pct": None,
                "information_ratio_3y": None, "index_ret_3y_pct": None, "fund_ret_3y_pct": None,
                "reason": "Fewer than 12 common monthly points in the 3Y window"}
    beta = an.beta(fund_3y, index_3y)
    fund_cagr = an.trailing_return(fund_3y, years=3)
    index_cagr = an.trailing_return(index_3y, years=3)
    alpha = an.jensen_alpha(fund_cagr, index_cagr, beta, rf=rf)
    te = an.tracking_error(fund_3y, index_3y)
    ir = an.information_ratio(fund_cagr, index_cagr, te)
    return {
        "alpha_3y_pct": round(alpha * 100, 2) if alpha is not None else None,
        "beta_3y": round(beta, 3) if beta is not None else None,
        "tracking_error_3y_pct": round(te * 100, 2) if te is not None else None,
        "information_ratio_3y": round(ir, 3) if ir is not None else None,
        "index_ret_3y_pct": round(index_cagr * 100, 2) if index_cagr is not None else None,
        "fund_ret_3y_pct": round(fund_cagr * 100, 2) if fund_cagr is not None else None,
        "reason": None,
    }


# ---------------------------------------------------------------------------
# Consistency metrics (shared by the nightly refresh and the detail fallback)
# ---------------------------------------------------------------------------

def calendar_year_returns(monthly_nav: pd.Series) -> dict[int, float]:
    """Calendar-year return per year with a full year of month-end NAVs."""
    points = {(d.year, d.month): float(v) for d, v in monthly_nav.items()}
    out: dict[int, float] = {}
    for year in sorted({d.year for d in monthly_nav.index}):
        if (year - 1, 12) not in points:
            continue
        if any((year, m) not in points for m in range(1, 13)):
            continue
        dec = monthly_nav[(monthly_nav.index.year == year) & (monthly_nav.index.month == 12)].iloc[0]
        out[year] = float(dec) / points[(year - 1, 12)] - 1.0
    return out


def compute_consistency(
    fund_monthly_nav: pd.Series,
    median_monthly_returns: pd.Series | None,
    peer_cal_by_year: dict[int, dict[str, float]] | None,
    scheme_code: str,
    quartile_fn=None,
) -> dict[str, Any]:
    """Rolling-win, calendar-win/top-quartile, downside deviation and SIP CAGR.

    Basis is vs the category median, labelled as such everywhere it is shown.
    ``median_monthly_returns`` is a monthly return series (fractions, not a
    NAV series); ``peer_cal_by_year`` maps calendar year -> {code: return}.
    Missing inputs yield None per metric, never 0.
    """
    out: dict[str, Any] = {
        "roll_win_pct": None, "cal_topq_years": None, "cal_win_pct": None,
        "downside_dev_3y": None, "sip_cagr_3y": None, "sip_cagr_5y": None,
    }
    if fund_monthly_nav is None or len(fund_monthly_nav) < 2:
        return out
    monthly = fund_monthly_nav.sort_index()
    if median_monthly_returns is not None and not median_monthly_returns.empty:
        fund_roll = monthly / monthly.shift(12) - 1.0
        med = median_monthly_returns.dropna()
        med_roll = (1.0 + med).rolling(12).apply(lambda x: float(pd.Series(x).prod()) - 1.0, raw=True)
        end = monthly.index[-1]
        both = pd.DataFrame({"fund": fund_roll, "med": med_roll}).dropna()
        both = both[(both.index > end - pd.DateOffset(years=5)) & (both.index <= end)]
        if len(both) >= 12:
            out["roll_win_pct"] = round(float((both["fund"] > both["med"]).mean()) * 100, 1)
        fund_cal = calendar_year_returns(monthly)
        med_cal: dict[int, float] = {}
        for year in fund_cal:
            seg = med[(med.index.year == year)]
            if len(seg) >= 12:
                med_cal[year] = float((1.0 + seg).prod() - 1.0)
        completed = sorted(set(fund_cal) & set(med_cal))
        if len(completed) >= 3:
            out["cal_win_pct"] = round(float(sum(fund_cal[y] > med_cal[y] for y in completed) / len(completed)) * 100, 1)
        if peer_cal_by_year and quartile_fn is not None and completed:
            topq = 0
            for year in completed:
                peers = {c: v for c, v in peer_cal_by_year.get(year, {}).items() if v is not None}
                if len(peers) >= 8 and scheme_code in peers:
                    if quartile_fn(peers, min_peers=8).get(scheme_code) == 1:
                        topq += 1
            out["cal_topq_years"] = topq
        elif completed:
            out["cal_topq_years"] = None
    rets_3y = monthly.pct_change().dropna().tail(36)
    if len(rets_3y) >= 12:
        downside = rets_3y.clip(upper=0.0)
        out["downside_dev_3y"] = round(float((downside ** 2).mean() ** 0.5 * (12 ** 0.5)) * 100, 2)
    for months, field in ((37, "sip_cagr_3y"), (61, "sip_cagr_5y")):
        window = monthly.tail(months)
        if len(window) >= months:
            val = an.sip_xirr(window)
            out[field] = round(float(val) * 100, 2) if val is not None else None
    return out


# ---------------------------------------------------------------------------
# Managers: co-managers, change history, bio (from the AMFI snapshot + profiles)
# ---------------------------------------------------------------------------

def normalize_manager_name(name: str | None) -> str:
    """Lowercase, collapse spaces, strip Mr/Mrs/Ms/Dr prefixes for matching."""
    if not name:
        return ""
    key = re.sub(r"\s+", " ", name.strip().lower())
    key = re.sub(r"^(mr|mrs|ms|dr)\.?\s+", "", key)
    return key


def manager_bio_from_profiles(
    name: str | None, profiles: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Bio/education/experience for one manager from mf_manager_profiles.json.

    Only what is published there is returned, with its sources; a manager
    with no profile entry yields None (never a generated bio).
    """
    if not name:
        return None
    key = normalize_manager_name(name)
    for p in profiles:
        names = [p.get("name")] + list(p.get("aliases") or [])
        if any(normalize_manager_name(n) == key for n in names):
            return {
                "name": p.get("name"),
                "firm": p.get("firm"),
                "current_title": p.get("current_title"),
                "education": p.get("education"),
                "years_experience": p.get("years_experience"),
                "bio_summary": p.get("bio_summary"),
                "investment_philosophy": p.get("investment_philosophy"),
                "career_history": p.get("career_history") or [],
                "sources": p.get("sources") or [],
            }
    return None


def co_managers_from_reference(
    managers_rows: list[dict[str, Any]], as_of_iso: str | None
) -> dict[str, Any]:
    """Normalise mfref manager_scheme_map rows into a co-manager list.

    A scheme with several rows lists ALL of them; tenure and "return under
    manager" must never silently attribute the full record to one person, so
    the payload carries ``is_co_managed`` and a shared-record note for the UI.
    Rows are the raw mfref rows (manager_id, full_name, designation,
    role_as_stated, start_date_as_stated, start_date_managing, end_date).
    """
    managers = []
    for m in managers_rows:
        start = m.get("start_date_managing") or parse_ssd_date(m.get("start_date_as_stated"))
        managers.append({
            "manager_id": m.get("manager_id"),
            "name": m.get("full_name"),
            "designation": m.get("designation"),
            "role_as_stated": m.get("role_as_stated"),
            "start_date": start,
            "start_date_as_stated": m.get("start_date_as_stated"),
            "end_date": m.get("end_date"),
            "tenure_years": tenure_years(start, as_of_iso),
        })
    managers.sort(key=lambda r: (r["start_date"] is None, r["start_date"] or ""))
    return {
        "managers": managers,
        "is_co_managed": len(managers) > 1,
        "shared_record_note": (
            "This scheme is managed jointly: tenure and return since a manager's start date "
            "are scheme figures shared across the co-managers, not attributable to one person alone."
            if len(managers) > 1 else None
        ),
    }


def manager_changes_from_reference(
    changes_rows: list[dict[str, Any]], manager_names: dict[str, str]
) -> list[dict[str, Any]]:
    """Resolve manager_history_changes rows (manager ids) to names + dates."""
    out = []
    for r in changes_rows:
        out.append({
            "old_manager": manager_names.get(r.get("old_manager_id") or ""),
            "new_manager": manager_names.get(r.get("new_manager_id") or ""),
            "effective_date": r.get("effective_date"),
            "notice_url": r.get("amc_notice_addendum_url"),
            "source": r.get("source_url"),
        })
    out.sort(key=lambda r: r["effective_date"] or "", reverse=True)
    return out


# ---------------------------------------------------------------------------
# Fund operations snapshot (from scheme_master; history fields are flagged)
# ---------------------------------------------------------------------------

def operations_from_reference(scheme: dict[str, Any] | None) -> dict[str, Any]:
    """Operations facts for one scheme from the AMFI/SEBI snapshot.

    History (AUM history, flows, folios, TER history) is NOT in the snapshot:
    those fields are returned as unavailable with a reason, never estimated
    from the single snapshot row. Merger/rename history is likewise absent
    from the snapshot census (its own notes say so) and is reported as such.
    """
    if not scheme:
        return {"available": False, "reason": "Scheme not found in the AMFI/SEBI reference snapshot (as of 2026-10-15)"}
    return {
        "available": True,
        "as_of": scheme.get("as_of_date"),
        "source": scheme.get("source_url"),
        "launch_date": scheme.get("launch_allotment_date"),
        "exit_load": scheme.get("exit_load"),
        "minimum_investment_inr": scheme.get("minimum_investment_inr"),
        "minimum_application_text": scheme.get("ssd_minimum_application_text"),
        "riskometer": scheme.get("riskometer_level"),
        "riskometer_level": riskometer_level(scheme.get("riskometer_level")),
        "benchmark_tri": scheme.get("benchmark_index_tri"),
        "ter_regular_pct": scheme.get("current_ter_regular_pct"),
        "ter_direct_pct": scheme.get("current_ter_direct_pct"),
        "ter_date": scheme.get("ter_date"),
        "aum_inr_crore": scheme.get("current_aum_inr_crore"),
        "aum_date": scheme.get("aum_date"),
        "scheme_status": scheme.get("scheme_status"),
        "merged_into_scheme_code": scheme.get("merged_into_scheme_code"),
        "history_unavailable": {
            "aum_history": "AUM history is not in the reference snapshot (single dated AUM only, where verified)",
            "flows": "Investor flows are not published in the reference snapshot",
            "folios": "Folio counts are not published in the reference snapshot",
            "ter_history": "TER history is not in the reference snapshot (single dated TER only)",
            "merger_rename_history": "No merger/rename notice census in the reference snapshot; merged_into is blank for this scheme",
        },
    }


# ---------------------------------------------------------------------------
# Client layer (read-only helpers; the endpoint supplies the holdings)
# ---------------------------------------------------------------------------

def tax_notes_for_category(cat: str | None, plan: str | None = None) -> list[str]:
    """Plain-English, educational tax notes. No rates are quoted: tax rules
    change, and a stale rate in a research tool would mislead. ELSS lock-in
    is a scheme rule, not a tax rate, so it is stated exactly."""
    notes = [
        "Past performance is not a guide to future returns. Tax rules change; check the current rules before acting.",
    ]
    if cat == "elss":
        notes.append("ELSS (tax-saving) funds lock your money in for 3 years from each investment date — you cannot redeem earlier, even in part.")
    if cat in {"flexi_cap", "large_cap", "mid_cap", "small_cap", "multi_cap", "large_mid_cap",
               "focused", "value", "contra", "dividend_yield", "sectoral_thematic", "elss"}:
        notes.append("Equity funds: gains on units held for a shorter period are taxed differently from gains on units held longer — the holding period decides which rule applies.")
    elif cat in {"liquid", "overnight", "money_market", "short_duration", "corporate_bond",
                 "banking_psu", "credit_risk", "dynamic_bond", "gilt", "floater", "medium_long_duration"}:
        notes.append("Debt funds: gains are taxed as per the holding-period rules for debt schemes, which differ from equity rules.")
    if (plan or "").lower() == "direct":
        notes.append("Direct plans carry no distributor commission, so their expense ratio is lower — but this tool shows the fund, not a purchase route.")
    return notes


def horizon_flag(cat: str | None, horizon_years: float | None) -> dict[str, Any]:
    """Simple horizon rule (not a risk model): equity volatility over a short
    horizon, and ELSS lock-in versus the horizon. None when no horizon given."""
    if horizon_years is None:
        return {"level": None, "message": None, "reason": "No goal horizon supplied"}
    equity_cats = {"flexi_cap", "large_cap", "mid_cap", "small_cap", "multi_cap", "large_mid_cap",
                   "focused", "value", "contra", "dividend_yield", "sectoral_thematic", "elss"}
    if cat == "elss" and horizon_years < 3:
        return {"level": "warn",
                "message": "ELSS money is locked in for 3 years, which is longer than this goal horizon.",
                "reason": "Simple rule: ELSS lock-in (3 years) vs horizon"}
    if cat in equity_cats and horizon_years < 3:
        return {"level": "warn",
                "message": "Equity funds can fall sharply over short periods; a horizon under 3 years is short for an equity fund.",
                "reason": "Simple rule: equity category vs horizon under 3 years"}
    return {"level": "ok", "message": None, "reason": "Simple rule: category vs horizon"}


def client_overlap(
    candidate: dict[str, Any], holdings: list[dict[str, Any]]
) -> dict[str, Any]:
    """Duplication of a candidate fund against a client's existing holdings.

    Matching is by scheme code first, then by same category, then same AMC.
    Holdings rows carry scheme_code / scheme_name / category / plan as stored
    in CRM (value_holdings adds category + plan from NAV where available).
    Purely descriptive: it never changes client data.
    """
    code = str(candidate.get("code") or candidate.get("scheme_code") or "")
    cat = candidate.get("cat")
    amc = candidate.get("amc")
    exact = [h for h in holdings if str(h.get("scheme_code") or "") == code]
    same_cat = [h for h in holdings
                if str(h.get("scheme_code") or "") != code and h.get("category") and cat and h["category"] == cat]
    same_amc = [h for h in holdings
                if str(h.get("scheme_code") or "") != code and h.get("category") != cat
                and h.get("amc") and amc and h["amc"] == amc]
    return {
        "already_held": bool(exact),
        "exact_holdings": exact,
        "same_category_holdings": same_cat,
        "same_amc_other_category_holdings": same_amc,
        "duplication_note": (
            "Client already holds this exact scheme." if exact else
            (f"Client already holds {len(same_cat)} fund(s) in this category — adding this one increases duplication in that category."
             if same_cat else "No holding in this category on file for this client.")
        ),
    }


def replacement_candidates(
    candidate: dict[str, Any], frame_rows: list[dict[str, Any]], limit: int = 5
) -> list[dict[str, Any]]:
    """Same-category funds that beat the candidate on all three: higher FH
    Checklist Score, lower TER, and longer manager tenure. Strictly better on
    all three, so the list is short and honest; empty is a valid answer."""
    cat = candidate.get("cat")
    try:
        score = float(candidate.get("score")) if candidate.get("score") is not None else None
        ter = float(candidate.get("ter")) if candidate.get("ter") is not None else None
        tenure = float(candidate.get("manager_tenure_years")) if candidate.get("manager_tenure_years") is not None else None
    except (TypeError, ValueError):
        return []
    if score is None or ter is None or tenure is None:
        return []
    out = []
    for r in frame_rows:
        if r.get("cat") != cat or str(r.get("code")) == str(candidate.get("code")):
            continue
        try:
            if (r.get("score") is not None and float(r["score"]) > score
                    and r.get("ter") is not None and float(r["ter"]) < ter
                    and r.get("manager_tenure_years") is not None and float(r["manager_tenure_years"]) > tenure):
                out.append(r)
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda r: (-float(r["score"]), float(r["ter"])))
    return [{
        "scheme_code": r.get("code"), "fund": r.get("name"), "plan": r.get("plan"),
        "score": r.get("score"), "ter": r.get("ter"),
        "manager_name": r.get("manager_name"), "manager_tenure_years": r.get("manager_tenure_years"),
        "cagr_3y": r.get("cagr_3y"),
    } for r in out[:limit]]
