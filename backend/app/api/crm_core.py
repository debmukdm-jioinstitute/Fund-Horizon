"""CRM core API (W1): households, leads, opportunities, activities, cases.

Every endpoint requires a signed-in session (401) and refuses the ``customer``
role (403); ``admin`` sees everything while ``rm`` is scoped to their own
households and assigned/linked records (see CONTRACT.md §1).

Money is integer paise; dates are ``YYYY-MM-DD``; timestamps are ISO-8601 UTC.
"""

from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import _hash_password, require_role
from app.db import sqlite
from app.repo_crm_core import CrmCoreError, get_crm_repository

router = APIRouter(prefix="/api/crm", tags=["crm"])

# 401 when not logged in, 403 when role == "customer".
Me = Annotated[dict, Depends(require_role("admin", "rm"))]

# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------
PRODUCT_LINES = ("mutual_fund", "life_insurance", "general_insurance", "corporate_fd", "pms")

OPPORTUNITY_STAGES: dict[str, list[str]] = {
    "mutual_fund": ["illustration", "discussion", "invested", "sip_active", "closed"],
    "life_insurance": ["need_analysis", "proposal", "issued", "active", "closed"],
    "general_insurance": ["quote", "proposal", "issued", "renewal_due", "renewed"],
    "corporate_fd": ["proposed", "booked", "matured", "reinvested"],
    "pms": ["prospect", "disclosure_given", "agreement_signed", "funded", "reporting", "closed"],
}
LOST_STAGE = "lost"
CLOSED_STAGES = ("closed", "lost")

LEAD_STATUSES = ("new", "contacted", "qualified", "converted", "lost")
ACTIVE_LEAD_STATUSES = ("new", "contacted", "qualified")
LEAD_SOURCES = ("sip_calculator", "website", "blog", "referral", "plan_link", "other")

ACTIVITY_KINDS = ("call", "meeting", "note", "followup", "email", "review")

MEMBER_ROLES = ("primary", "spouse", "child", "dependent", "other")

CASE_CATEGORIES = (
    "onboarding",
    "kyc",
    "mandate",
    "transaction",
    "folio",
    "charges",
    "disclosure",
    "platform",
    "data_privacy",
    "other",
)
CASE_STATUSES = ("open", "in_progress", "resolved", "escalated_amc", "escalated_scores", "closed")
CASE_OPEN_STATUSES = ("open", "in_progress", "escalated_amc", "escalated_scores")
CASE_RESOLVED_STATUSES = ("resolved", "closed")

GENERATE_TASK_TYPES = ("policy", "fd")

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class _Scope(NamedTuple):
    admin: bool
    household_ids: set[str]
    customer_ids: set[str]


def _scope(me: dict) -> _Scope:
    """Household/customer ids visible to an RM. Admins are unscoped."""
    if me["role"] == "admin":
        return _Scope(True, set(), set())
    repo = get_crm_repository()
    households = repo.list_households(rm_id=me["id"])
    hids = {h["id"] for h in households}
    cids: set[str] = set()
    for h in households:
        if h.get("primary_customer_id"):
            cids.add(h["primary_customer_id"])
        for m in repo.list_household_members(h["id"]):
            cids.add(m["customer_id"])
    return _Scope(False, hids, cids)


def _public_customer(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "password_hash"}


def _customer_or_404(customer_id: str) -> dict:
    customer = sqlite.get_customer_by_id(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    return _public_customer(customer)


def _customer_name(customer_id: str | None) -> str | None:
    if not customer_id:
        return None
    customer = sqlite.get_customer_by_id(customer_id)
    return customer["name"] if customer else None


def _require_rm_account(rm_id: str | None) -> None:
    if rm_id is None:
        return
    person = sqlite.get_customer_by_id(rm_id)
    if not person or person.get("role") not in ("rm", "admin"):
        raise HTTPException(422, "assigned_rm_id must reference an existing RM or admin account.")


def _check_enum(value: str | None, allowed: tuple[str, ...], field: str) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(422, f"{field} must be one of: {', '.join(allowed)}")


def _clean_str(value: str | None, field: str, *, min_len: int = 1) -> str | None:
    if value is None:
        return None
    v = value.strip()
    if len(v) < min_len:
        raise HTTPException(422, f"{field} must be at least {min_len} characters")
    return v


def _check_email(value: str | None, field: str = "email") -> str | None:
    if value is None:
        return None
    v = value.strip().lower()
    if not _EMAIL_RE.match(v):
        raise HTTPException(422, f"Enter a valid {field} address")
    return v


def _check_mobile(value: str | None) -> str | None:
    if value is None:
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if not _MOBILE_RE.match(digits):
        raise HTTPException(422, "Enter a valid 10-digit Indian mobile number")
    return digits


def _check_date(value: str | None, field: str) -> str | None:
    """Accept YYYY-MM-DD or ISO-8601; return normalized ISO string."""
    if value is None:
        return None
    v = value.strip()
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        raise HTTPException(422, f"{field} must be a valid date (YYYY-MM-DD) or ISO-8601 datetime") from None
    if dt.tzinfo is None and "T" not in v:
        return dt.date().isoformat()
    return dt.isoformat()


def _visible_household(h: dict, me: dict, scope: _Scope) -> bool:
    return scope.admin or h.get("rm_id") == me["id"]


def _visible_lead(lead: dict, me: dict, scope: _Scope) -> bool:
    # RMs see their own leads plus the unassigned pool they can claim.
    return scope.admin or lead.get("assigned_rm_id") in (me["id"], None)


def _visible_opportunity(opp: dict, me: dict, scope: _Scope) -> bool:
    if scope.admin:
        return True
    return (
        opp.get("assigned_rm_id") == me["id"]
        or (opp.get("household_id") in scope.household_ids)
        or (opp.get("customer_id") in scope.customer_ids)
    )


def _visible_case(case: dict, me: dict, scope: _Scope) -> bool:
    return scope.admin or case.get("customer_id") in scope.customer_ids


def _visible_activity(act: dict, me: dict, scope: _Scope) -> bool:
    if scope.admin:
        return True
    repo = get_crm_repository()
    if act.get("assigned_rm_id") == me["id"]:
        return True
    if act.get("household_id") in scope.household_ids:
        return True
    if act.get("customer_id") in scope.customer_ids:
        return True
    if act.get("opportunity_id"):
        opp = repo.get_opportunity(act["opportunity_id"])
        if opp and _visible_opportunity(opp, me, scope):
            return True
    if act.get("case_id"):
        case = repo.get_case(act["case_id"])
        if case and _visible_case(case, me, scope):
            return True
    return False


def _get_visible(getter, rec_id: str, me: dict, scope: _Scope, visible_fn, noun: str) -> dict:
    rec = getter(rec_id)
    if not rec:
        raise HTTPException(404, f"{noun} not found")
    if not visible_fn(rec, me, scope):
        raise HTTPException(403, "You do not have permission to access this resource.")
    return rec


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class HouseholdCreate(BaseModel):
    name: str
    primary_customer_id: str | None = None
    rm_id: str | None = None
    notes: str | None = None


class HouseholdUpdate(BaseModel):
    name: str | None = None
    primary_customer_id: str | None = None
    rm_id: str | None = None
    notes: str | None = None


class MemberCreate(BaseModel):
    customer_id: str
    role: str = "other"


class LeadCreate(BaseModel):
    name: str
    email: str | None = None
    mobile: str | None = None
    source: str = "other"
    notes: str | None = None
    assigned_rm_id: str | None = None


class LeadUpdate(BaseModel):
    status: str | None = None
    assigned_rm_id: str | None = None
    notes: str | None = None


class LeadConvert(BaseModel):
    household_name: str | None = None
    password: str | None = Field(None, min_length=8)


class OpportunityCreate(BaseModel):
    household_id: str | None = None
    customer_id: str | None = None
    product_line: str
    title: str
    amount: int | None = Field(None, ge=0)
    stage: str | None = None
    probability: int = Field(0, ge=0, le=100)
    expected_close: str | None = None
    assigned_rm_id: str | None = None
    notes: str | None = None


class OpportunityUpdate(BaseModel):
    stage: str | None = None
    probability: int | None = Field(None, ge=0, le=100)
    amount: int | None = Field(None, ge=0)
    expected_close: str | None = None
    notes: str | None = None
    assigned_rm_id: str | None = None
    title: str | None = None


class ActivityCreate(BaseModel):
    kind: str
    subject: str
    body: str | None = None
    household_id: str | None = None
    customer_id: str | None = None
    opportunity_id: str | None = None
    case_id: str | None = None
    policy_id: str | None = None
    fd_id: str | None = None
    due_at: str | None = None
    assigned_rm_id: str | None = None


class ActivityUpdate(BaseModel):
    done_at: str | None = None
    subject: str | None = None
    body: str | None = None
    due_at: str | None = None
    assigned_rm_id: str | None = None


class CaseCreate(BaseModel):
    customer_id: str
    category: str
    subject: str
    body: str | None = None
    sla_due_at: str | None = None


class CaseUpdate(BaseModel):
    status: str | None = None
    sla_due_at: str | None = None
    body: str | None = None


class GenerateTasksRequest(BaseModel):
    type: str


# ---------------------------------------------------------------------------
# Households
# ---------------------------------------------------------------------------
@router.get("/households")
def list_households(me: Me):
    repo = get_crm_repository()
    rows = repo.list_households() if me["role"] == "admin" else repo.list_households(rm_id=me["id"])
    out = []
    for h in rows:
        out.append(
            {
                **h,
                "member_count": repo.count_household_members(h["id"]),
                "open_opportunities": repo.count_open_opportunities(h["id"]),
            }
        )
    return out


@router.post("/households", status_code=201)
def create_household(body: HouseholdCreate, me: Me):
    name = _clean_str(body.name, "name")
    assert name is not None
    if body.primary_customer_id:
        _customer_or_404(body.primary_customer_id)
    rm_id = body.rm_id
    if me["role"] != "admin":
        if rm_id is not None and rm_id != me["id"]:
            raise HTTPException(403, "You cannot assign a household to another RM.")
        rm_id = rm_id or me["id"]
    else:
        _require_rm_account(rm_id)
    repo = get_crm_repository()
    return repo.create_household(name=name, primary_customer_id=body.primary_customer_id, rm_id=rm_id, notes=body.notes)


@router.get("/households/{household_id}")
def get_household(household_id: str, me: Me):
    repo = get_crm_repository()
    h = _get_visible(repo.get_household, household_id, me, _scope(me), _visible_household, "Household")
    members = []
    for m in repo.list_household_members(household_id):
        customer = sqlite.get_customer_by_id(m["customer_id"])
        if not customer:
            continue
        members.append(
            {
                "customer_id": m["customer_id"],
                "name": customer["name"],
                "email": customer["email"],
                "mobile": customer["mobile"],
                "role": m["role"],
            }
        )
    scope = _scope(me)
    opportunities = [
        o for o in repo.list_opportunities(household_id=household_id) if _visible_opportunity(o, me, scope)
    ]
    activities = [a for a in repo.list_activities(household_id=household_id) if _visible_activity(a, me, scope)][:20]
    cases = [
        c
        for c in repo.list_cases()
        if c["status"] in CASE_OPEN_STATUSES
        and _visible_case(c, me, scope)
        and (
            c["customer_id"] == h.get("primary_customer_id") or c["customer_id"] in {m["customer_id"] for m in members}
        )
    ]
    return {
        "household": h,
        "members": members,
        "opportunities": opportunities,
        "activities": activities,
        "cases": cases,
    }


@router.patch("/households/{household_id}")
def update_household(household_id: str, body: HouseholdUpdate, me: Me):
    repo = get_crm_repository()
    _get_visible(repo.get_household, household_id, me, _scope(me), _visible_household, "Household")
    fields: dict[str, Any] = {}
    if "name" in body.model_fields_set:
        fields["name"] = _clean_str(body.name, "name")
    if "primary_customer_id" in body.model_fields_set:
        if body.primary_customer_id:
            _customer_or_404(body.primary_customer_id)
        fields["primary_customer_id"] = body.primary_customer_id
    if "rm_id" in body.model_fields_set:
        if me["role"] != "admin":
            if body.rm_id is not None and body.rm_id != me["id"]:
                raise HTTPException(403, "You cannot assign a household to another RM.")
        else:
            _require_rm_account(body.rm_id)
        fields["rm_id"] = body.rm_id
    if "notes" in body.model_fields_set:
        fields["notes"] = body.notes
    updated = repo.update_household(household_id, fields)
    if not updated:
        raise HTTPException(404, "Household not found")
    return updated


@router.post("/households/{household_id}/members", status_code=201)
def add_household_member(household_id: str, body: MemberCreate, me: Me):
    repo = get_crm_repository()
    _get_visible(repo.get_household, household_id, me, _scope(me), _visible_household, "Household")
    _check_enum(body.role, MEMBER_ROLES, "role")
    _customer_or_404(body.customer_id)
    try:
        return repo.add_household_member(household_id=household_id, customer_id=body.customer_id, role=body.role)
    except CrmCoreError as e:
        raise HTTPException(422, str(e)) from e


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------
@router.get("/leads")
def list_leads(
    me: Me,
    status: str | None = Query(None),
    assigned_rm_id: str | None = Query(None),
):
    _check_enum(status, LEAD_STATUSES, "status")
    repo = get_crm_repository()
    leads = repo.list_leads(status=status, assigned_rm_id=assigned_rm_id)
    scope = _scope(me)
    return [lead for lead in leads if _visible_lead(lead, me, scope)]


@router.post("/leads", status_code=201)
def create_lead(body: LeadCreate, me: Me):
    name = _clean_str(body.name, "name")
    assert name is not None
    _check_enum(body.source, LEAD_SOURCES, "source")
    _require_rm_account(body.assigned_rm_id)
    repo = get_crm_repository()
    return repo.create_lead(
        name=name,
        email=_check_email(body.email),
        mobile=_check_mobile(body.mobile),
        source=body.source,
        status="new",
        assigned_rm_id=body.assigned_rm_id,
        notes=body.notes,
    )


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: str, body: LeadUpdate, me: Me):
    repo = get_crm_repository()
    _get_visible(repo.get_lead, lead_id, me, _scope(me), _visible_lead, "Lead")
    if body.status is not None:
        _check_enum(body.status, LEAD_STATUSES, "status")
    if "assigned_rm_id" in body.model_fields_set:
        _require_rm_account(body.assigned_rm_id)
    fields = {
        k: v
        for k, v in {"status": body.status, "assigned_rm_id": body.assigned_rm_id, "notes": body.notes}.items()
        if k in body.model_fields_set
    }
    updated = repo.update_lead(lead_id, fields)
    if not updated:
        raise HTTPException(404, "Lead not found")
    return updated


@router.post("/leads/{lead_id}/convert")
def convert_lead(lead_id: str, body: LeadConvert, me: Me):
    repo = get_crm_repository()
    lead = _get_visible(repo.get_lead, lead_id, me, _scope(me), _visible_lead, "Lead")
    if lead["status"] == "converted":
        raise HTTPException(422, "This lead has already been converted.")

    email = _check_email(lead.get("email"))
    if not email:
        raise HTTPException(422, "Add an email address to the lead before converting.")
    if sqlite.get_customer_by_email(email):
        raise HTTPException(422, "An account with this email already exists.")
    mobile = _check_mobile(lead.get("mobile"))
    if not mobile:
        raise HTTPException(422, "Add a mobile number to the lead before converting.")
    if sqlite.get_customer_by_mobile(mobile):
        raise HTTPException(422, "An account with this mobile number already exists.")

    temp_password: str | None = None
    if body.password:
        password = body.password
    else:
        password = secrets.token_urlsafe(24)  # 32 chars
        temp_password = password

    owner_rm_id = me["id"] if me["role"] == "rm" else lead.get("assigned_rm_id")
    if owner_rm_id:
        _require_rm_account(owner_rm_id)

    customer = sqlite.create_customer(
        name=lead["name"],
        email=email,
        mobile=mobile,
        password_hash=_hash_password(password),
        role="customer",
        assigned_rm_id=owner_rm_id,
    )
    household_name = (body.household_name or f"{lead['name']} Household").strip()
    household = repo.create_household(name=household_name, primary_customer_id=customer["id"], rm_id=owner_rm_id)
    repo.add_household_member(household_id=household["id"], customer_id=customer["id"], role="primary")
    repo.update_lead(lead_id, {"status": "converted"})

    result: dict[str, Any] = {"customer_id": customer["id"], "household_id": household["id"]}
    if temp_password is not None:
        # Returned once; never stored in plain text.
        result["temp_password"] = temp_password
    return result


# ---------------------------------------------------------------------------
# Opportunities
# ---------------------------------------------------------------------------
def _check_stage(product_line: str, stage: str | None, field: str = "stage") -> str:
    stages = OPPORTUNITY_STAGES[product_line]
    if stage is None:
        return stages[0]
    if stage not in stages and stage != LOST_STAGE:
        raise HTTPException(422, f"{field} must be one of: {', '.join(stages + [LOST_STAGE])}")
    return stage


@router.get("/opportunities")
def list_opportunities(
    me: Me,
    product_line: str | None = Query(None),
    stage: str | None = Query(None),
    household_id: str | None = Query(None),
    assigned_rm_id: str | None = Query(None),
):
    _check_enum(product_line, PRODUCT_LINES, "product_line")
    repo = get_crm_repository()
    opps = repo.list_opportunities(
        product_line=product_line,
        stage=stage,
        household_id=household_id,
        assigned_rm_id=assigned_rm_id,
    )
    scope = _scope(me)
    out = []
    for o in opps:
        if not _visible_opportunity(o, me, scope):
            continue
        out.append(
            {
                **o,
                "household_name": repo.get_household(o["household_id"])["name"]
                if o.get("household_id") and repo.get_household(o["household_id"])
                else None,
                "customer_name": _customer_name(o.get("customer_id")),
            }
        )
    return out


@router.post("/opportunities", status_code=201)
def create_opportunity(body: OpportunityCreate, me: Me):
    _check_enum(body.product_line, PRODUCT_LINES, "product_line")
    stage = _check_stage(body.product_line, body.stage)
    title = _clean_str(body.title, "title")
    assert title is not None
    scope = _scope(me)
    repo = get_crm_repository()
    if body.household_id:
        h = repo.get_household(body.household_id)
        if not h:
            raise HTTPException(404, "Household not found")
        if not _visible_household(h, me, scope):
            raise HTTPException(403, "You do not have permission to use this household.")
    if body.customer_id:
        _customer_or_404(body.customer_id)
        if not scope.admin and body.customer_id not in scope.customer_ids:
            raise HTTPException(403, "You do not have permission to use this customer.")
    _require_rm_account(body.assigned_rm_id)
    return repo.create_opportunity(
        household_id=body.household_id,
        customer_id=body.customer_id,
        product_line=body.product_line,
        title=title,
        amount=body.amount,
        stage=stage,
        probability=body.probability,
        expected_close=_check_date(body.expected_close, "expected_close"),
        assigned_rm_id=body.assigned_rm_id,
        notes=body.notes,
    )


@router.patch("/opportunities/{opportunity_id}")
def update_opportunity(opportunity_id: str, body: OpportunityUpdate, me: Me):
    repo = get_crm_repository()
    scope = _scope(me)
    opp = _get_visible(
        repo.get_opportunity,
        opportunity_id,
        me,
        scope,
        lambda o, m, s: _visible_opportunity(o, m, s),
        "Opportunity",
    )
    fields: dict[str, Any] = {}
    if "stage" in body.model_fields_set:
        fields["stage"] = _check_stage(opp["product_line"], body.stage)
    if "probability" in body.model_fields_set:
        fields["probability"] = body.probability
    if "amount" in body.model_fields_set:
        fields["amount"] = body.amount
    if "expected_close" in body.model_fields_set:
        fields["expected_close"] = _check_date(body.expected_close, "expected_close")
    if "notes" in body.model_fields_set:
        fields["notes"] = body.notes
    if "title" in body.model_fields_set:
        fields["title"] = _clean_str(body.title, "title")
    if "assigned_rm_id" in body.model_fields_set:
        _require_rm_account(body.assigned_rm_id)
        fields["assigned_rm_id"] = body.assigned_rm_id
    updated = repo.update_opportunity(opportunity_id, fields)
    if not updated:
        raise HTTPException(404, "Opportunity not found")
    return updated


@router.get("/pipeline")
def pipeline_summary(me: Me, product_line: str | None = Query(None)):
    _check_enum(product_line, PRODUCT_LINES, "product_line")
    repo = get_crm_repository()
    opps = repo.list_opportunities(product_line=product_line, exclude_stages=(LOST_STAGE,))
    scope = _scope(me)
    opps = [o for o in opps if _visible_opportunity(o, me, scope)]
    if product_line:
        ordered = OPPORTUNITY_STAGES[product_line]
    else:
        ordered = []
        for line in PRODUCT_LINES:
            for st in OPPORTUNITY_STAGES[line]:
                if st not in ordered:
                    ordered.append(st)
    stages = []
    total_value = 0
    for st in ordered:
        bucket = [o for o in opps if o["stage"] == st]
        value = sum(o["amount"] or 0 for o in bucket)
        stages.append({"stage": st, "count": len(bucket), "value": value})
        total_value += value
    return {"stages": stages, "total_value": total_value, "total_count": len(opps)}


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------
@router.get("/activities")
def list_activities(
    me: Me,
    assigned_rm_id: str | None = Query(None),
    household_id: str | None = Query(None),
    customer_id: str | None = Query(None),
    opportunity_id: str | None = Query(None),
    case_id: str | None = Query(None),
    done: bool | None = Query(None),
    due_before: str | None = Query(None),
):
    repo = get_crm_repository()
    acts = repo.list_activities(
        assigned_rm_id=assigned_rm_id,
        household_id=household_id,
        customer_id=customer_id,
        opportunity_id=opportunity_id,
        case_id=case_id,
        done=done,
        due_before=due_before,
    )
    scope = _scope(me)
    return [a for a in acts if _visible_activity(a, me, scope)]


@router.post("/activities", status_code=201)
def create_activity(body: ActivityCreate, me: Me):
    _check_enum(body.kind, ACTIVITY_KINDS, "kind")
    subject = _clean_str(body.subject, "subject")
    assert subject is not None
    scope = _scope(me)
    repo = get_crm_repository()
    if body.household_id:
        h = repo.get_household(body.household_id)
        if not h:
            raise HTTPException(404, "Household not found")
        if not _visible_household(h, me, scope):
            raise HTTPException(403, "You do not have permission to use this household.")
    if body.customer_id:
        _customer_or_404(body.customer_id)
        if not scope.admin and body.customer_id not in scope.customer_ids:
            raise HTTPException(403, "You do not have permission to use this customer.")
    if body.opportunity_id:
        opp = repo.get_opportunity(body.opportunity_id)
        if not opp:
            raise HTTPException(404, "Opportunity not found")
        if not _visible_opportunity(opp, me, scope):
            raise HTTPException(403, "You do not have permission to use this opportunity.")
    if body.case_id:
        case = repo.get_case(body.case_id)
        if not case:
            raise HTTPException(404, "Case not found")
        if not _visible_case(case, me, scope):
            raise HTTPException(403, "You do not have permission to use this case.")
    _require_rm_account(body.assigned_rm_id)
    return repo.create_activity(
        kind=body.kind,
        subject=subject,
        body=body.body,
        household_id=body.household_id,
        customer_id=body.customer_id,
        opportunity_id=body.opportunity_id,
        case_id=body.case_id,
        policy_id=body.policy_id,
        fd_id=body.fd_id,
        due_at=_check_date(body.due_at, "due_at"),
        assigned_rm_id=body.assigned_rm_id,
    )


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: str, body: ActivityUpdate, me: Me):
    repo = get_crm_repository()
    scope = _scope(me)
    _get_visible(
        repo.get_activity,
        activity_id,
        me,
        scope,
        lambda a, m, s: _visible_activity(a, m, s),
        "Activity",
    )
    fields: dict[str, Any] = {}
    if "done_at" in body.model_fields_set:
        # done_at=null reopens the activity.
        fields["done_at"] = _check_date(body.done_at, "done_at") if body.done_at else None
    if "subject" in body.model_fields_set:
        fields["subject"] = _clean_str(body.subject, "subject")
    if "body" in body.model_fields_set:
        fields["body"] = body.body
    if "due_at" in body.model_fields_set:
        fields["due_at"] = _check_date(body.due_at, "due_at") if body.due_at else None
    if "assigned_rm_id" in body.model_fields_set:
        _require_rm_account(body.assigned_rm_id)
        fields["assigned_rm_id"] = body.assigned_rm_id
    updated = repo.update_activity(activity_id, fields)
    if not updated:
        raise HTTPException(404, "Activity not found")
    return updated


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------
@router.get("/cases")
def list_cases(
    me: Me,
    status: str | None = Query(None),
    customer_id: str | None = Query(None),
):
    _check_enum(status, CASE_STATUSES, "status")
    repo = get_crm_repository()
    cases = repo.list_cases(status=status, customer_id=customer_id)
    scope = _scope(me)
    out = []
    for c in cases:
        if not _visible_case(c, me, scope):
            continue
        out.append({**c, "customer_name": _customer_name(c.get("customer_id"))})
    return out


@router.post("/cases", status_code=201)
def create_case(body: CaseCreate, me: Me):
    _check_enum(body.category, CASE_CATEGORIES, "category")
    subject = _clean_str(body.subject, "subject")
    assert subject is not None
    _customer_or_404(body.customer_id)
    scope = _scope(me)
    if not scope.admin and body.customer_id not in scope.customer_ids:
        raise HTTPException(403, "You do not have permission to open a case for this customer.")
    repo = get_crm_repository()
    return repo.create_case(
        customer_id=body.customer_id,
        category=body.category,
        subject=subject,
        body=body.body,
        status="open",
        sla_due_at=_check_date(body.sla_due_at, "sla_due_at"),
    )


@router.patch("/cases/{case_id}")
def update_case(case_id: str, body: CaseUpdate, me: Me):
    repo = get_crm_repository()
    scope = _scope(me)
    case = _get_visible(
        repo.get_case,
        case_id,
        me,
        scope,
        lambda c, m, s: _visible_case(c, m, s),
        "Case",
    )
    fields: dict[str, Any] = {}
    if "status" in body.model_fields_set:
        _check_enum(body.status, CASE_STATUSES, "status")
        fields["status"] = body.status
        if body.status in CASE_RESOLVED_STATUSES and not case.get("resolved_at"):
            fields["resolved_at"] = _utcnow()
        elif body.status not in CASE_RESOLVED_STATUSES:
            fields["resolved_at"] = None
    if "sla_due_at" in body.model_fields_set:
        fields["sla_due_at"] = _check_date(body.sla_due_at, "sla_due_at") if body.sla_due_at else None
    if "body" in body.model_fields_set:
        fields["body"] = body.body
    updated = repo.update_case(case_id, fields)
    if not updated:
        raise HTTPException(404, "Case not found")
    return updated


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
def dashboard(me: Me):
    repo = get_crm_repository()
    scope = _scope(me)

    if scope.admin:
        households = repo.list_households()
    else:
        households = repo.list_households(rm_id=me["id"])

    leads = [
        lead for lead in repo.list_leads() if lead["status"] in ACTIVE_LEAD_STATUSES and _visible_lead(lead, me, scope)
    ]

    opps = [o for o in repo.list_opportunities(exclude_stages=(LOST_STAGE,)) if _visible_opportunity(o, me, scope)]
    pipeline_value_by_line = {line: 0 for line in PRODUCT_LINES}
    for o in opps:
        pipeline_value_by_line[o["product_line"]] += o["amount"] or 0

    renewals = repo.list_policy_renewals(days=30)
    if not scope.admin:
        renewals = [
            p
            for p in renewals
            if (p.get("household_id") in scope.household_ids) or (p.get("customer_id") in scope.customer_ids)
        ]
    maturities = repo.list_fd_maturities(days=60)
    if not scope.admin:
        maturities = [
            f
            for f in maturities
            if (f.get("household_id") in scope.household_ids) or (f.get("customer_id") in scope.customer_ids)
        ]

    open_cases = [c for c in repo.list_cases() if c["status"] in CASE_OPEN_STATUSES and _visible_case(c, me, scope)]

    horizon = (_utcnow_dt() + timedelta(days=7)).isoformat()
    tasks_due = [
        a
        for a in repo.list_activities(done=False)
        if a.get("due_at") and a["due_at"] <= horizon and _visible_activity(a, me, scope)
    ]

    return {
        "households_count": len(households),
        "active_leads_count": len(leads),
        "pipeline_value_by_line": pipeline_value_by_line,
        "renewals_due_30d": len(renewals),
        "fd_maturities_60d": len(maturities),
        "open_cases_count": len(open_cases),
        "tasks_due_count": len(tasks_due),
    }


def _utcnow_dt() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Renewals / maturities (W2 product tables; defensive when absent)
# ---------------------------------------------------------------------------
def _enrich_product_rows(rows: list[dict]) -> list[dict]:
    repo = get_crm_repository()
    out = []
    for r in rows:
        h = repo.get_household(r["household_id"]) if r.get("household_id") else None
        out.append(
            {
                **r,
                "household_name": h["name"] if h else None,
                "customer_name": _customer_name(r.get("customer_id")),
            }
        )
    return out


@router.get("/renewals")
def list_renewals(me: Me, days: int = Query(45, ge=1, le=365)):
    repo = get_crm_repository()
    scope = _scope(me)
    rows = repo.list_policy_renewals(days=days)
    if not scope.admin:
        rows = [
            p
            for p in rows
            if (p.get("household_id") in scope.household_ids) or (p.get("customer_id") in scope.customer_ids)
        ]
    return _enrich_product_rows(rows)


@router.get("/maturities")
def list_maturities(me: Me, days: int = Query(60, ge=1, le=365)):
    repo = get_crm_repository()
    scope = _scope(me)
    rows = repo.list_fd_maturities(days=days)
    if not scope.admin:
        rows = [
            f
            for f in rows
            if (f.get("household_id") in scope.household_ids) or (f.get("customer_id") in scope.customer_ids)
        ]
    return _enrich_product_rows(rows)


def _resolve_task_rm(item: dict, me: dict, repo) -> str | None:
    """RM for a renewal/maturity follow-up: household RM, else customer's RM, else me."""
    if item.get("household_id"):
        h = repo.get_household(item["household_id"])
        if h and h.get("rm_id"):
            return h["rm_id"]
    if item.get("customer_id"):
        customer = sqlite.get_customer_by_id(item["customer_id"])
        if customer and customer.get("assigned_rm_id"):
            return customer["assigned_rm_id"]
    return me["id"] if me["role"] == "rm" else None


@router.post("/renewals/generate-tasks")
def generate_renewal_tasks(body: GenerateTasksRequest, me: Me):
    _check_enum(body.type, GENERATE_TASK_TYPES, "type")
    repo = get_crm_repository()
    scope = _scope(me)

    created = 0
    if body.type == "policy":
        items = repo.list_policy_renewals(days=45)
        for item in items:
            if not scope.admin and not (
                item.get("household_id") in scope.household_ids or item.get("customer_id") in scope.customer_ids
            ):
                continue
            if repo.open_followup_exists(policy_id=item["id"]):
                continue  # idempotent: an open follow-up already covers this policy
            label = " ".join(p for p in (item.get("insurer"), item.get("policy_no")) if p) or item.get(
                "policy_type", ""
            )
            repo.create_activity(
                kind="followup",
                subject=f"Policy renewal due: {label}".strip(),
                body=f"Renewal date {item.get('renewal_date')}. Premium {(item.get('premium_amount') or 0) / 100:.2f}.",
                household_id=item.get("household_id"),
                customer_id=item.get("customer_id"),
                policy_id=item["id"],
                due_at=item.get("renewal_date"),
                assigned_rm_id=_resolve_task_rm(item, me, repo),
            )
            created += 1
    else:
        items = repo.list_fd_maturities(days=60)
        for item in items:
            if not scope.admin and not (
                item.get("household_id") in scope.household_ids or item.get("customer_id") in scope.customer_ids
            ):
                continue
            if repo.open_followup_exists(fd_id=item["id"]):
                continue  # idempotent
            label = item.get("company") or "FD"
            repo.create_activity(
                kind="followup",
                subject=f"FD maturity due: {label}".strip(),
                body=f"Maturity date {item.get('maturity_date')}. Amount {(item.get('amount') or 0) / 100:.2f}.",
                household_id=item.get("household_id"),
                customer_id=item.get("customer_id"),
                fd_id=item["id"],
                due_at=item.get("maturity_date"),
                assigned_rm_id=_resolve_task_rm(item, me, repo),
            )
            created += 1
    return {"created": created}
