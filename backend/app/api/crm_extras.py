"""CRM Phase 2 endpoints: saved list views, contacts, owners + bulk reassign,
record timelines, global search, duplicate checks and CSV export.

Same auth model as ``crm_core``: admin and RM only; an RM only ever sees their
own book (scoping is applied inside the SQL, see ``repo_crm_extras``).
"""

from __future__ import annotations

import csv
import io
import os
import secrets
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import repo_crm_extras as extras
from app import repo_crm_phase3 as p3
from app.api.crm_core import (
    ACTIVE_LEAD_STATUSES,
    CASE_OPEN_STATUSES,
    CLOSED_STAGES,
    LEAD_STATUSES,
    WON_STAGE,
    Me,
    _check_enum,
    _get_visible,
    _owner,
    _require_rm_account,
    _scope,
    _viewer,
    _visible_case,
    _visible_household,
    _visible_lead,
    _visible_opportunity,
)
from app.api.crm_page import PageParams, guard, send_total
from app.repo_crm_core import IST, Page, get_crm_repository, month_start_utc, today_ist

router = APIRouter(prefix="/api/crm", tags=["crm-phase2"])

LIST_ENTITIES = ("households", "contacts", "leads", "opportunities", "activities", "cases")

BUILTIN_VIEWS = [
    {
        "id": "builtin:my-open-leads", "entity": "leads", "name": "My open leads",
        "filters": {"status": ",".join(ACTIVE_LEAD_STATUSES), "assigned_rm_id": "me"}, "columns": [], "is_default": False,
    },
    {
        "id": "builtin:overdue-tasks", "entity": "activities", "name": "Overdue tasks",
        "filters": {"overdue": "true"}, "columns": [], "is_default": False,
    },
    {
        "id": "builtin:sla-breaching-cases", "entity": "cases", "name": "SLA breaching cases",
        "filters": {"sla_breaching": "true"}, "columns": [], "is_default": False,
    },
]


# ---------------------------------------------------------------------------
# Owners + bulk reassign
# ---------------------------------------------------------------------------
@router.get("/owners")
def owners(me: Me):
    """RM/admin accounts for owner avatars and filters."""
    return extras.list_owners()


class BulkReassign(BaseModel):
    entity: str
    ids: list[str] = Field(min_length=1, max_length=500)
    assigned_rm_id: str | None = None


@router.post("/bulk-reassign")
def bulk_reassign(body: BulkReassign, me: Me):
    if me["role"] != "admin":
        raise HTTPException(403, "Only an admin can reassign records in bulk.")
    _check_enum(body.entity, ("households", "leads", "opportunities", "activities"), "entity")
    _require_rm_account(body.assigned_rm_id)
    repo = get_crm_repository()
    update, field = {
        "households": (repo.update_household, "rm_id"),
        "leads": (repo.update_lead, "assigned_rm_id"),
        "opportunities": (repo.update_opportunity, "assigned_rm_id"),
        "activities": (repo.update_activity, "assigned_rm_id"),
    }[body.entity]
    updated, missing = 0, []
    for rec_id in dict.fromkeys(body.ids):
        if update(rec_id, {field: body.assigned_rm_id}, actor_id=me["id"]):
            updated += 1
        else:
            missing.append(rec_id)
    return {"updated": updated, "missing": missing}


class BulkDelete(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    code: str


@router.post("/leads/bulk-delete")
def bulk_delete_leads(body: BulkDelete, me: Me):
    if me["role"] != "admin":
        raise HTTPException(403, "Only an admin can delete leads.")
    # Guard against accidental deletes; set CRM_DELETE_CODE in the environment to change it.
    if not secrets.compare_digest(body.code, os.environ.get("CRM_DELETE_CODE", "0000")):
        raise HTTPException(403, "Wrong delete code.")
    repo = get_crm_repository()
    deleted, missing = 0, []
    for lead_id in dict.fromkeys(body.ids):
        if repo.delete_lead(lead_id, actor_id=me["id"]):
            deleted += 1
        else:
            missing.append(lead_id)
    return {"deleted": deleted, "missing": missing}


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------
def _gap_ids(me: dict) -> list[str]:
    from app.api.crm_phase3 import gap_rows  # late import: crm_phase3 imports from this package

    return [r["id"] for r in gap_rows(me)]


@router.get("/contacts")
def contacts(
    me: Me, response: Response, page: PageParams, household_id: str | None = Query(None),
    gaps: bool = Query(False, description="Only contacts with a nominee/KYC/FATCA gap"),
):
    rows = guard(extras.list_contacts, _viewer(me), page, household_id, _gap_ids(me) if gaps else None)
    send_total(response, page)
    return rows


# ---------------------------------------------------------------------------
# Saved views
# ---------------------------------------------------------------------------
class ViewIn(BaseModel):
    entity: str
    name: str = Field(min_length=1, max_length=80)
    filters: dict[str, Any] = Field(default_factory=dict)
    columns: list[str] = Field(default_factory=list, max_length=40)
    is_default: bool = False


class ViewPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    filters: dict[str, Any] | None = None
    columns: list[str] | None = Field(None, max_length=40)
    is_default: bool | None = None


@router.get("/views")
def list_views(me: Me, entity: str | None = Query(None)):
    _check_enum(entity, LIST_ENTITIES, "entity")
    builtin = [{**v, "builtin": True} for v in BUILTIN_VIEWS if entity in (None, v["entity"])]
    mine = [{**v, "builtin": False} for v in extras.list_views(me["id"], entity)]
    return builtin + mine


@router.post("/views", status_code=201)
def create_view(body: ViewIn, me: Me):
    _check_enum(body.entity, LIST_ENTITIES, "entity")
    return {**guard(extras.save_view, me["id"], body.entity, body.name.strip(), body.filters, body.columns, body.is_default), "builtin": False}


@router.patch("/views/{view_id}")
def update_view(view_id: str, body: ViewPatch, me: Me):
    if view_id.startswith("builtin:"):
        raise HTTPException(403, "Built-in views cannot be edited; save a copy instead.")
    current = extras.get_view(me["id"], view_id)
    if not current:
        raise HTTPException(404, "View not found")
    merged = {**current, **{k: v for k, v in body.model_dump().items() if k in body.model_fields_set and v is not None}}
    saved = guard(
        extras.save_view, me["id"], current["entity"], merged["name"].strip(), merged["filters"], merged["columns"],
        bool(merged["is_default"]), view_id,
    )
    return {**saved, "builtin": False}


@router.delete("/views/{view_id}", status_code=204)
def delete_view(view_id: str, me: Me):
    if view_id.startswith("builtin:"):
        raise HTTPException(403, "Built-in views cannot be deleted.")
    if not extras.delete_view(me["id"], view_id):
        raise HTTPException(404, "View not found")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Search + duplicates
# ---------------------------------------------------------------------------
@router.get("/search")
def global_search(me: Me, q: str = Query(..., min_length=2, max_length=80)):
    """⌘K: households, contacts, leads, opportunities, cases; also matches ids, mobile, email, lead notes (e.g. game tokens) and PAN last 4."""
    return {"results": extras.search(q, _viewer(me))}


class DuplicateCheck(BaseModel):
    name: str | None = None
    email: str | None = None
    mobile: str | None = None
    pan_last4: str | None = Field(None, max_length=4)
    exclude_lead_id: str | None = None


@router.post("/duplicates/check")
def duplicates_check(body: DuplicateCheck, me: Me):
    """Matches on mobile, email, PAN last 4 (strong) or name (weak). Out-of-scope matches are anonymised."""
    matches = extras.find_duplicates(
        name=body.name, email=body.email, mobile=body.mobile, pan_last4=body.pan_last4,
        viewer_rm_id=_viewer(me), exclude_lead_id=body.exclude_lead_id,
    )
    return {"matches": matches, "blocking": any(set(m["reasons"]) - {"name"} for m in matches)}


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------
@router.get("/timeline")
def record_timeline(
    me: Me,
    entity: str = Query(...),
    id: str = Query(...),
    limit: int = Query(100, ge=1, le=300),
):
    """Activities, cases and audit changes for one record, newest first."""
    _check_enum(entity, ("household", "lead", "opportunity", "case"), "entity")
    repo = get_crm_repository()
    scope = _scope(me)
    customer_ids: list[str] = []
    opp_ids: list[str] = []
    if entity == "household":
        h = _get_visible(repo.get_household, id, me, scope, _visible_household, "Household")
        ids = {m["customer_id"] for m in repo.list_household_members(id)}
        if h.get("primary_customer_id"):
            ids.add(h["primary_customer_id"])
        customer_ids = sorted(ids)
        opp_ids = [o["id"] for o in repo.list_opportunities(household_id=id, viewer_rm_id=_viewer(me))]
    elif entity == "lead":
        _get_visible(repo.get_lead, id, me, scope, _visible_lead, "Lead")
    elif entity == "opportunity":
        _get_visible(repo.get_opportunity, id, me, scope, _visible_opportunity, "Opportunity")
    else:
        _get_visible(repo.get_case, id, me, scope, _visible_case, "Case")
    items = extras.timeline(entity, id, customer_ids, opp_ids, limit)
    names = repo.customer_names([i["actor_id"] for i in items if i.get("actor_id")])
    return [{**i, "actor_name": names.get(i.get("actor_id"))} for i in items]


# ---------------------------------------------------------------------------
# CSV export (same filters as the list endpoints)
# ---------------------------------------------------------------------------
def _csv_safe(v: Any) -> str:
    """Neutralise spreadsheet formula injection (cells starting with = + - @)."""
    text = "" if v is None else str(v)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


_EXPORT_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "households": [("name", "Household"), ("owner", "Owner"), ("member_count", "Members"), ("open_opportunities", "Open opportunities"), ("created_at", "Created")],
    "contacts": [("name", "Name"), ("email", "Email"), ("mobile", "Mobile"), ("role", "Role"), ("household_name", "Household"), ("owner", "Owner")],
    "leads": [("name", "Name"), ("email", "Email"), ("mobile", "Mobile"), ("source", "Source"), ("status", "Status"), ("owner", "Owner"), ("created_at", "Created")],
    "opportunities": [("title", "Title"), ("product_line", "Product line"), ("stage", "Stage"), ("amount_rupees", "Amount (₹)"), ("probability", "Probability %"), ("household_name", "Household"), ("owner", "Owner"), ("expected_close", "Expected close"), ("lost_reason", "Lost reason")],
    "activities": [("subject", "Subject"), ("kind", "Type"), ("due_at", "Due"), ("done_at", "Done"), ("owner", "Owner"), ("created_at", "Created")],
    "cases": [("subject", "Subject"), ("category", "Category"), ("status", "Status"), ("customer_name", "Customer"), ("sla_due_at", "SLA due"), ("created_at", "Created")],
}


def _export_rows(entity: str, me: Me, qp: dict[str, str], page: Page) -> list[dict]:
    repo = get_crm_repository()
    viewer = _viewer(me)
    owner = _owner(me, qp.get("assigned_rm_id") or qp.get("rm_id"))
    if entity == "households":
        ids = p3.households_in_tier(viewer or owner, qp["tier"]) if qp.get("tier") else None
        return repo.list_households(rm_id=viewer or owner, ids=ids, page=page)
    if entity == "contacts":
        return extras.list_contacts(viewer, page, qp.get("household_id"), _gap_ids(me) if qp.get("gaps") == "true" else None)
    if entity == "leads":
        statuses = tuple(x for x in qp.get("status", "").split(",") if x)
        for st in statuses:
            _check_enum(st, LEAD_STATUSES, "status")
        return repo.list_leads(statuses=statuses, assigned_rm_id=owner, viewer_rm_id=viewer, page=page)
    if entity == "opportunities":
        won = qp.get("won_this_month") == "true"
        return repo.list_opportunities(
            product_line=qp.get("product_line"), stage=WON_STAGE if won else qp.get("stage"), household_id=qp.get("household_id"),
            assigned_rm_id=owner, viewer_rm_id=viewer, page=page,
            exclude_stages=CLOSED_STAGES if qp.get("open") == "true" else (), closed_from=month_start_utc() if won else None,
        )
    if entity == "activities":
        overdue = qp.get("overdue") == "true"
        done = None if qp.get("done") is None else qp.get("done") == "true"
        return repo.list_activities(
            assigned_rm_id=owner, overdue_before=today_ist() if overdue else None,
            done=False if overdue else done, viewer_rm_id=viewer, page=page,
        )
    breaching = qp.get("sla_breaching") == "true"
    return repo.list_cases(
        status=qp.get("status"), statuses=CASE_OPEN_STATUSES if breaching else (),
        sla_before=today_ist() if breaching else None, viewer_rm_id=viewer, page=page,
    )


@router.get("/export/{entity}")
def export_csv(entity: str, request: Request, me: Me):
    _check_enum(entity, LIST_ENTITIES, "entity")
    qp = dict(request.query_params)
    repo = get_crm_repository()
    owners_by_id = {o["id"]: o["name"] for o in extras.list_owners()}
    rows: list[dict] = []
    for offset in range(0, 20000, 500):  # hard cap: 20,000 rows per export
        page = Page(limit=500, offset=offset, sort=qp.get("sort") or None, q=(qp.get("q") or "").strip() or None)
        chunk = guard(_export_rows, entity, me, qp, page)
        rows.extend(chunk)
        if len(chunk) < 500:
            break
    hh = repo.household_names([r["household_id"] for r in rows if r.get("household_id")])
    cust = repo.customer_names([r["customer_id"] for r in rows if r.get("customer_id")])
    counts = (repo.member_counts([r["id"] for r in rows]), repo.open_opp_counts([r["id"] for r in rows])) if entity == "households" else ({}, {})
    cols = _EXPORT_COLUMNS[entity]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([label for _, label in cols])
    for r in rows:
        r = {
            **r,
            "owner": owners_by_id.get(r.get("assigned_rm_id") or r.get("rm_id"), ""),
            "household_name": r.get("household_name") or hh.get(r.get("household_id"), ""),
            "customer_name": cust.get(r.get("customer_id"), ""),
            "amount_rupees": "" if r.get("amount") is None else f"{r['amount'] / 100:.2f}",
        }
        if entity == "households":
            r["member_count"], r["open_opportunities"] = counts[0].get(r["id"], 0), counts[1].get(r["id"], 0)
        writer.writerow([_csv_safe(r.get(key)) for key, _ in cols])
    name = f"crm-{entity}-{datetime.now(IST).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
