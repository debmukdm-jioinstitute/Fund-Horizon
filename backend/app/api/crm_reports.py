"""CRM Phase 4: the home dashboard.

Every widget is computed with the same repo calls (and the same scoping) as the list it links to, and
carries ``link`` = {tab, params}: the CRM tab and list filters that reproduce its number. A test walks
every link and checks the list's total equals the widget's count.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app import repo_crm_phase3 as p3
from app.api.crm_core import (
    CASE_OPEN_STATUSES,
    CLOSED_STAGES,
    PRODUCT_LINES,
    WON_STAGE,
    Me,
    _scope,
    _scoped_product_rows,
    _viewer,
    open_stages,
)
from app.api.crm_phase3 import gap_rows
from app.repo_crm_core import get_crm_repository, month_start_utc, today_ist

router = APIRouter(prefix="/api/crm/reports", tags=["crm-reports"])

TIER_ORDER = ("platinum", "gold", "silver", "standard")
DEADLINE_DAYS = 30


def _link(tab: str, **params: Any) -> dict[str, Any]:
    return {"tab": tab, "params": {k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in params.items()}}


@router.get("/dashboard")
def reports_dashboard(me: Me):
    repo = get_crm_repository()
    viewer, scope = _viewer(me), _scope(me)

    # AUM by household tier
    households = repo.list_households(rm_id=viewer)
    aum = p3.household_aum([h["id"] for h in households])
    tiers = {t: {"tier": t, "households": 0, "aum_paise": 0} for t in TIER_ORDER}
    for h in households:
        a = aum.get(h["id"], {})
        row = tiers[a.get("tier", "standard")]
        row["households"] += 1
        row["aum_paise"] += a.get("aum_paise", 0)
    aum_by_tier = [{**r, "count": r["households"], "link": _link("households", tier=r["tier"])} for r in tiers.values()]

    # Pipeline: open opportunities by stage and by RM; won this month
    open_opps = repo.list_opportunities(exclude_stages=CLOSED_STAGES, viewer_rm_id=viewer)
    stage_order: list[str] = []
    for line in PRODUCT_LINES:
        for st in open_stages(line):
            if st not in stage_order:
                stage_order.append(st)
    by_stage = []
    for st in stage_order:
        bucket = [o for o in open_opps if o["stage"] == st]
        by_stage.append({"stage": st, "count": len(bucket), "value": sum(o["amount"] or 0 for o in bucket), "link": _link("opportunities", stage=st)})
    rm_names = repo.customer_names([o["assigned_rm_id"] for o in open_opps if o.get("assigned_rm_id")])
    rm_rows: dict[str | None, dict[str, Any]] = {}
    for o in open_opps:
        rid = o.get("assigned_rm_id")
        r = rm_rows.setdefault(rid, {"rm_id": rid, "rm_name": rm_names.get(rid) if rid else "Unassigned", "count": 0, "value": 0})
        r["count"] += 1
        r["value"] += o["amount"] or 0
    by_rm = sorted(
        ({**r, "link": _link("opportunities", assigned_rm_id=r["rm_id"], open=True) if r["rm_id"] else None} for r in rm_rows.values()),
        key=lambda r: -r["value"],
    )
    won = repo.list_opportunities(stage=WON_STAGE, closed_from=month_start_utc(), viewer_rm_id=viewer)

    # Work due
    overdue = repo.list_activities(overdue_before=today_ist(), done=False, viewer_rm_id=viewer)
    breaching = repo.list_cases(statuses=CASE_OPEN_STATUSES, sla_before=today_ist(), viewer_rm_id=viewer)
    gaps = gap_rows(me)
    gap_kinds: dict[str, int] = {}
    for g in gaps:
        for k in g["gaps"]:
            gap_kinds[k] = gap_kinds.get(k, 0) + 1
    renewals = _scoped_product_rows(repo.list_policy_renewals(days=DEADLINE_DAYS), scope)
    maturities = _scoped_product_rows(repo.list_fd_maturities(days=DEADLINE_DAYS), scope)

    # Trail: top households in the latest month with data
    summary = p3.commission_summary(viewer, None, None)
    months = [m["month"] for m in summary["by_month"]]
    latest = months[-1] if months else None
    top_trail = []
    if latest:
        month_sum = p3.commission_summary(viewer, latest, latest)
        top_trail = month_sum["by_household"][:5]

    return {
        "as_of": today_ist(),
        "aum_by_tier": aum_by_tier,
        "aum_total_paise": sum(r["aum_paise"] for r in tiers.values()),
        "sip_book": {**p3.sip_book(viewer), "link": _link("book", section="sips")},
        "pipeline_by_stage": by_stage,
        "pipeline_by_rm": by_rm,
        "pipeline_open": {"count": len(open_opps), "value": sum(o["amount"] or 0 for o in open_opps)},
        "won_this_month": {
            "count": len(won), "value": sum((o["won_amount"] if o.get("won_amount") is not None else o["amount"]) or 0 for o in won),
            "link": _link("opportunities", won_this_month=True),
        },
        "overdue_tasks": {"count": len(overdue), "link": _link("activities", overdue=True)},
        "sla_breaching": {"count": len(breaching), "link": _link("cases", sla_breaching=True)},
        "gaps": {"count": len(gaps), "by_kind": gap_kinds, "link": _link("contacts", gaps=True)},
        "renewals": {"count": len(renewals), "days": DEADLINE_DAYS, "link": _link("deadlines", kind="renewals", days=DEADLINE_DAYS)},
        "maturities": {"count": len(maturities), "days": DEADLINE_DAYS, "link": _link("deadlines", kind="maturities", days=DEADLINE_DAYS)},
        "top_trail": {"month": latest, "rows": top_trail, "link": _link("book", section="commissions")},
    }
