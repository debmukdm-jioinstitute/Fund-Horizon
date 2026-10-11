"""Illustrative cover-plan shortlists attached to a plan. Pure functions.

The underlying lists are curated research in app.data.insurance_plans. The
marked pick in each list is the highest claim-settlement record, and the reason
is written in plain words that refer to the customer's own gap, age and
dependents. No premiums are quoted: they vary by age, health, occupation, city
and sum insured.
"""
from __future__ import annotations

from app.config.disclosures import INSURANCE_SHORTLIST_NOTE
from app.data.insurance_plans import HEALTH_PLANS, RESEARCHED_ON, TERM_PLANS


def _inr_short(v: float) -> str:
    a = abs(v)
    if a >= 1e7:
        return f"₹{a / 1e7:.2f} Cr"
    if a >= 1e5:
        return f"₹{a / 1e5:.2f} L"
    return f"₹{a:,.0f}"


def _block(kind: str, gap: float, plans: list[dict], pick_reason: list[str]) -> dict:
    entries = [{**p, "marked_pick": i == 0} for i, p in enumerate(plans)]
    return {
        "kind": kind,
        "gap": round(float(gap)),
        "researched_on": RESEARCHED_ON,
        "note": INSURANCE_SHORTLIST_NOTE,
        "plans": entries,
        "pick_reason": pick_reason,
    }


def suggest_term_cover(term_gap: float, age: int, dependents: int) -> dict | None:
    """Illustrative term-plan shortlist, or None when there is no term gap."""
    if not term_gap or term_gap <= 0:
        return None
    pick = TERM_PLANS[0]
    csr = pick["claim_settlement"].split(" (")[0]
    solv = (pick["solvency"] or "").split(" (")[0]
    dep_word = f"{dependents} dependent" + ("" if dependents == 1 else "s")
    reason = [
        f"Marked because {pick['insurer']} paid {csr} of individual death claims in "
        "FY 2024-25 — the highest record in this shortlist (IRDAI Annual Report).",
        f"Solvency ratio {solv}, above the IRDAI minimum of 1.5x.",
        f"With a cover gap of about {_inr_short(term_gap)} and {dep_word}, "
        "claim-settlement reliability is weighted first; compare the other three "
        "plans on riders and price before deciding.",
    ]
    return _block("term", term_gap, TERM_PLANS, reason)


def suggest_health_cover(health_gap: float, age: int, dependents: int, health_target: float) -> dict | None:
    """Illustrative health-plan shortlist, or None when there is no health gap."""
    if not health_gap or health_gap <= 0:
        return None
    pick = HEALTH_PLANS[0]
    csr = pick["claim_settlement"].split(" (")[0]
    members = max(dependents + 1, 2)
    reason = [
        f"Marked because {pick['insurer']} reports a {csr} claim-settlement record — "
        "the highest in this shortlist.",
        f"Wellness-linked rewards and a sum-insured range up to ₹6 Cr suit a family "
        f"floater covering about {members} members; check restore terms and room-rent "
        f"limits of each plan against the {_inr_short(health_target)} target.",
        "Health premiums rise steeply with age — locking cover early usually costs less.",
    ]
    return _block("health", health_gap, HEALTH_PLANS, reason)


def suggest_cover_plans(client, insurance: dict) -> dict:
    """{'term': block|None, 'health': block|None} for the plan payload."""
    age = int(getattr(client, "age", 0) or 0)
    dependents = int(getattr(client, "dependents", 0) or 0)
    term = insurance.get("term") or {}
    health = insurance.get("health") or {}
    term_gap = term.get("gap") or 0
    health_gap = health.get("gap") or 0
    return {
        "term": suggest_term_cover(term_gap, age, dependents),
        "health": suggest_health_cover(health_gap, age, dependents, health.get("target") or 0),
    }
