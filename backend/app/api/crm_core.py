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

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import repo_crm_phase3 as p3
from app.api.auth import _hash_password
from app.api.crm_auth import crm_user, unscoped
from app.api.crm_page import PageParams, guard, paginate_rows, send_total
from app.db import sqlite
from app.repo_crm_core import IST, CrmCoreError, Page, get_crm_repository, today_ist
from app.repo_crm_extras import find_duplicates

router = APIRouter(prefix="/api/crm", tags=["crm"])

# 401 when not logged in, 403 for customers; compliance is read-only; RMs see their team (see crm_auth).
Me = Annotated[dict, Depends(crm_user)]

# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------
PRODUCT_LINES = ("mutual_fund", "life_insurance", "general_insurance", "corporate_fd", "pms")

# Each line ends in ``won``; ``lost`` is a separate terminal stage reachable from any open stage.
OPPORTUNITY_STAGES: dict[str, list[str]] = {
    "mutual_fund": ["illustration", "discussion", "invested", "sip_active", "won"],
    "life_insurance": ["need_analysis", "proposal", "issued", "active", "won"],
    "general_insurance": ["quote", "proposal", "issued", "renewal_due", "won"],
    "corporate_fd": ["proposed", "booked", "matured", "won"],
    "pms": ["prospect", "disclosure_given", "agreement_signed", "funded", "reporting", "won"],
}
WON_STAGE = "won"
LOST_STAGE = "lost"
CLOSED_STAGES = (WON_STAGE, LOST_STAGE)


def open_stages(line: str) -> list[str]:
    return OPPORTUNITY_STAGES[line][:-1]


def allowed_transitions(line: str) -> dict[str, set[str]]:
    """Open stages move freely among themselves and to lost; only the last open stage can win. Won/lost are final."""
    opened = open_stages(line)
    out = {st: (set(opened) - {st}) | {LOST_STAGE} for st in opened}
    out[opened[-1]].add(WON_STAGE)
    out[WON_STAGE] = set()
    out[LOST_STAGE] = set()
    return out


def default_probability(line: str, stage: str) -> int:
    if stage == WON_STAGE:
        return 100
    if stage == LOST_STAGE:
        return 0
    stages = OPPORTUNITY_STAGES[line]
    return round(100 * (stages.index(stage) + 1) / len(stages))


LEAD_STATUSES = ("new", "contacted", "qualified", "converted", "lost")
ACTIVE_LEAD_STATUSES = ("new", "contacted", "qualified")
LEAD_SOURCES = ("sip_calculator", "website", "blog", "referral", "plan_link", "other")

ACTIVITY_KINDS = ("call", "meeting", "note", "followup", "email", "review", "whatsapp")

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
_INTL_MOBILE_RE = re.compile(r"^\+[1-9]\d{6,14}$")  # NRIs: +<country code><number>




# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class _Scope(NamedTuple):
    admin: bool
    household_ids: set[str]
    customer_ids: set[str]


def _scope(me: dict) -> _Scope:
    """Household/customer ids visible to an RM (two queries). Admins are unscoped."""
    if unscoped(me):
        return _Scope(True, set(), set())
    hids, cids = get_crm_repository().scope_ids(me["_team"])
    return _Scope(False, hids, cids)


def _owner(me: dict, value: str | None) -> str | None:
    """List filters accept the literal ``me`` for the signed-in user."""
    return me["id"] if value == "me" else value


def _viewer(me: dict) -> list[str] | None:
    """The RM team (just themselves for a plain RM) to filter list queries by; None when unscoped."""
    return me["_team"]


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


def _assignee(me: dict, value: str | None, *, create: bool) -> str | None:
    """Resolve ``assigned_rm_id``: RMs can only assign to themselves; admins to any RM/admin (or nobody)."""
    if me["role"] == "admin":
        _require_rm_account(value)
        return value
    if value is None:
        if create:
            return me["id"]  # RM-created records belong to the RM
        raise HTTPException(403, "You cannot unassign a record; ask an admin.")
    if value not in me["_team"]:  # a team lead may also assign to their reports
        raise HTTPException(403, "You can only assign records to yourself or your team.")
    return value


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
    if not v:
        return None
    if not _EMAIL_RE.match(v):
        raise HTTPException(422, f"Enter a valid {field} address")
    return v


def _check_mobile(value: str | None) -> str | None:
    """10-digit Indian mobile (optional +91/91/0 prefix), or ``+<cc><number>`` for NRIs."""
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    compact = re.sub(r"[\s\-()]", "", raw)
    if compact.startswith("+") and not compact.startswith("+91"):
        if not _INTL_MOBILE_RE.match(compact):
            raise HTTPException(422, "Enter an international number as +<country code><number>")
        return compact
    digits = re.sub(r"\D", "", compact)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not _MOBILE_RE.match(digits):
        raise HTTPException(422, "Enter a valid 10-digit Indian mobile number (or +<country code> for NRIs)")
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


def _past_warnings(due_at: str | None) -> list[str]:
    """A due date before today (IST) is allowed but flagged."""
    if not due_at:
        return []
    try:
        dt = datetime.fromisoformat(due_at)
    except ValueError:
        return []
    if "T" in due_at:
        past = (dt if dt.tzinfo else dt.replace(tzinfo=UTC)) < datetime.now(UTC)
    else:
        past = dt.date().isoformat() < today_ist()
    return ["due_at is in the past"] if past else []


def _with_warnings(row: dict, warnings: list[str]) -> dict:
    return {**row, "warnings": warnings} if warnings else row


def _visible_household(h: dict, me: dict, scope: _Scope) -> bool:
    return scope.admin or h.get("rm_id") in me["_team"]


def _visible_lead(lead: dict, me: dict, scope: _Scope) -> bool:
    # RMs see their own leads; the unassigned pool is admin-only.
    return scope.admin or lead.get("assigned_rm_id") in me["_team"]


def _visible_opportunity(opp: dict, me: dict, scope: _Scope) -> bool:
    if scope.admin:
        return True
    return (
        opp.get("assigned_rm_id") in me["_team"]
        or (opp.get("household_id") in scope.household_ids)
        or (opp.get("customer_id") in scope.customer_ids)
    )


def _visible_case(case: dict, me: dict, scope: _Scope) -> bool:
    return scope.admin or case.get("customer_id") in scope.customer_ids


def _visible_activity(act: dict, me: dict, scope: _Scope) -> bool:
    if scope.admin:
        return True
    repo = get_crm_repository()
    if act.get("assigned_rm_id") in me["_team"]:
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
    if act.get("lead_id"):
        lead = repo.get_lead(act["lead_id"])
        if lead and _visible_lead(lead, me, scope):
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
    override: bool = False  # admin only: allow a customer who already belongs to another household


class LeadCreate(BaseModel):
    name: str
    email: str | None = None
    mobile: str | None = None
    source: str = "other"
    notes: str | None = None
    assigned_rm_id: str | None = None
    allow_duplicates: bool = False  # continue even though a possible duplicate exists


class LeadUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    mobile: str | None = None
    status: str | None = None
    assigned_rm_id: str | None = None
    notes: str | None = None


class LeadConvert(BaseModel):
    household_name: str | None = None
    household_id: str | None = None  # convert into an existing household instead of creating one
    member_role: str | None = None
    invite_to_portal: bool = False  # only then does the new customer get a usable login
    password: str | None = Field(None, min_length=8)


class OpportunityCreate(BaseModel):
    household_id: str | None = None
    customer_id: str | None = None
    product_line: str
    title: str
    amount: int | None = Field(None, ge=0)
    stage: str | None = None
    probability: int | None = Field(None, ge=0, le=100)  # defaults from the stage
    expected_close: str | None = None
    assigned_rm_id: str | None = None
    notes: str | None = None
    scheme_code: str | None = None  # AMFI code: its category gives a default riskometer
    riskometer: int | None = Field(None, ge=1, le=6)  # 1 Low .. 6 Very High; overrides the category default
    suitability_override_reason: str | None = None  # admin only: proceed despite a blocking mismatch


class OpportunityUpdate(BaseModel):
    stage: str | None = None
    probability: int | None = Field(None, ge=0, le=100)
    amount: int | None = Field(None, ge=0)
    expected_close: str | None = None
    notes: str | None = None
    assigned_rm_id: str | None = None
    title: str | None = None
    lost_reason: str | None = None  # required when moving to lost
    won_amount: int | None = Field(None, ge=0)  # paise; defaults to amount when moving to won


class ActivityCreate(BaseModel):
    kind: str
    subject: str
    body: str | None = None
    household_id: str | None = None
    customer_id: str | None = None
    opportunity_id: str | None = None
    case_id: str | None = None
    lead_id: str | None = None
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
def list_households(me: Me, response: Response, page: PageParams, rm_id: str | None = Query(None, description="RM id, or 'me'")):
    repo = get_crm_repository()
    owner = _owner(me, rm_id)
    if _viewer(me) is not None and owner is not None and owner not in me["_team"]:
        raise HTTPException(403, "You can only filter by yourself or your team.")
    rows = guard(repo.list_households, rm_id=[owner] if owner and _viewer(me) is not None else (_viewer(me) or owner), page=page)
    send_total(response, page)
    ids = [h["id"] for h in rows]
    members, open_opps = repo.member_counts(ids), repo.open_opp_counts(ids)
    aum = p3.household_aum(ids)
    return [
        {
            **h,
            "member_count": members.get(h["id"], 0),
            "open_opportunities": open_opps.get(h["id"], 0),
            "aum_paise": aum.get(h["id"], {}).get("aum_paise", 0),
            "tier": aum.get(h["id"], {}).get("tier", "standard"),
            "has_direct_plan": aum.get(h["id"], {}).get("has_direct_plan", False),
        }
        for h in rows
    ]


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
    return repo.create_household(
        name=name, primary_customer_id=body.primary_customer_id, rm_id=rm_id, notes=body.notes, actor_id=me["id"]
    )


@router.get("/households/{household_id}")
def get_household(household_id: str, me: Me):
    repo = get_crm_repository()
    scope = _scope(me)
    h = _get_visible(repo.get_household, household_id, me, scope, _visible_household, "Household")
    customers = {}
    members = []
    for m in repo.list_household_members(household_id):
        customer = sqlite.get_customer_by_id(m["customer_id"])
        if not customer:
            continue
        customers[m["customer_id"]] = customer
        members.append(
            {
                "customer_id": m["customer_id"],
                "name": customer["name"],
                "email": customer["email"],
                "mobile": customer["mobile"],
                "role": m["role"],
            }
        )
    viewer = _viewer(me)
    opportunities = repo.list_opportunities(household_id=household_id, viewer_rm_id=viewer)
    activities = repo.list_activities(household_id=household_id, viewer_rm_id=viewer, page=Page(limit=20))
    member_ids = {m["customer_id"] for m in members}
    if h.get("primary_customer_id"):
        member_ids.add(h["primary_customer_id"])
    cases = repo.list_cases(statuses=CASE_OPEN_STATUSES, customer_ids=member_ids, viewer_rm_id=viewer)
    return {
        "household": h,
        "members": members,
        "opportunities": opportunities,
        "activities": activities,
        "cases": cases,
        "aum": p3.household_aum([household_id]).get(household_id),
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
            if body.rm_id != me["id"]:
                raise HTTPException(403, "You cannot assign a household to another RM.")
        else:
            _require_rm_account(body.rm_id)
        fields["rm_id"] = body.rm_id
    if "notes" in body.model_fields_set:
        fields["notes"] = body.notes
    updated = repo.update_household(household_id, fields, actor_id=me["id"])
    if not updated:
        raise HTTPException(404, "Household not found")
    return updated


@router.post("/households/{household_id}/members", status_code=201)
def add_household_member(household_id: str, body: MemberCreate, me: Me):
    repo = get_crm_repository()
    scope = _scope(me)
    _get_visible(repo.get_household, household_id, me, scope, _visible_household, "Household")
    _check_enum(body.role, MEMBER_ROLES, "role")
    customer = _customer_or_404(body.customer_id)
    others = [m for m in repo.customer_memberships(body.customer_id) if m["household_id"] != household_id]
    if me["role"] != "admin":
        if body.override:
            raise HTTPException(403, "Only an admin can override the one-household-per-customer rule.")
        if others:
            if body.customer_id in scope.customer_ids:
                raise HTTPException(422, "This customer already belongs to another household. Ask an admin to override.")
            raise HTTPException(403, "You do not have permission to use this customer.")
        # A brand-new customer must not already be another RM's client.
        if customer.get("assigned_rm_id") not in (None, me["id"]) and body.customer_id not in scope.customer_ids:
            raise HTTPException(403, "You do not have permission to use this customer.")
    elif others and not body.override:
        names = repo.household_names([m["household_id"] for m in others])
        where = ", ".join(sorted(names.values())) or "another household"
        raise HTTPException(422, f"This customer already belongs to {where}. Pass override=true to add them anyway.")
    try:
        return repo.add_household_member(
            household_id=household_id, customer_id=body.customer_id, role=body.role, actor_id=me["id"]
        )
    except CrmCoreError as e:
        raise HTTPException(422, str(e)) from e


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------
@router.get("/leads")
def list_leads(
    me: Me,
    response: Response,
    page: PageParams,
    status: str | None = Query(None, description="One status or a comma-separated list"),
    assigned_rm_id: str | None = Query(None, description="RM id, or 'me'"),
):
    statuses = tuple(x for x in (status or "").split(",") if x)
    for st in statuses:
        _check_enum(st, LEAD_STATUSES, "status")
    repo = get_crm_repository()
    rows = guard(
        repo.list_leads, statuses=statuses, assigned_rm_id=_owner(me, assigned_rm_id), viewer_rm_id=_viewer(me), page=page
    )
    send_total(response, page)
    return rows


@router.get("/leads/{lead_id}")
def get_lead(lead_id: str, me: Me):
    repo = get_crm_repository()
    return _get_visible(repo.get_lead, lead_id, me, _scope(me), _visible_lead, "Lead")


@router.post("/leads", status_code=201)
def create_lead(body: LeadCreate, me: Me):
    name = _clean_str(body.name, "name")
    assert name is not None
    _check_enum(body.source, LEAD_SOURCES, "source")
    assigned = _assignee(me, body.assigned_rm_id, create=True)
    email, mobile = _check_email(body.email), _check_mobile(body.mobile)
    if not body.allow_duplicates:
        strong = [
            m for m in find_duplicates(name=name, email=email, mobile=mobile, pan_last4=None, viewer_rm_id=_viewer(me))
            if set(m["reasons"]) - {"name"}
        ]
        if strong:
            raise HTTPException(
                409,
                detail={
                    "message": "Possible duplicate: a record with the same " + " / ".join(sorted({r for m in strong for r in m["reasons"] if r != "name"}))
                    + " already exists. Resubmit with allow_duplicates=true to continue.",
                    "matches": strong,
                },
            )
    repo = get_crm_repository()
    return repo.create_lead(
        name=name,
        email=email,
        mobile=mobile,
        source=body.source,
        status="new",
        assigned_rm_id=assigned,
        notes=body.notes,
        actor_id=me["id"],
    )


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: str, body: LeadUpdate, me: Me):
    repo = get_crm_repository()
    lead = _get_visible(repo.get_lead, lead_id, me, _scope(me), _visible_lead, "Lead")
    fields: dict[str, Any] = {}
    if "status" in body.model_fields_set:
        _check_enum(body.status, LEAD_STATUSES, "status")
        if body.status == "converted" and lead["status"] != "converted":
            raise HTTPException(422, "Use the convert action to convert a lead.")
        if lead["status"] == "converted" and body.status != "converted":
            raise HTTPException(422, "A converted lead cannot be reopened.")
        fields["status"] = body.status
    if "assigned_rm_id" in body.model_fields_set:
        fields["assigned_rm_id"] = _assignee(me, body.assigned_rm_id, create=False)
    if "notes" in body.model_fields_set:
        fields["notes"] = body.notes
    if "name" in body.model_fields_set:
        if body.name is None:
            raise HTTPException(422, "name cannot be empty")
        fields["name"] = _clean_str(body.name, "name")
    if "email" in body.model_fields_set:
        fields["email"] = _check_email(body.email)
    if "mobile" in body.model_fields_set:
        fields["mobile"] = _check_mobile(body.mobile)
    updated = repo.update_lead(lead_id, fields, actor_id=me["id"])
    if not updated:
        raise HTTPException(404, "Lead not found")
    return updated


@router.post("/leads/{lead_id}/convert")
def convert_lead(lead_id: str, body: LeadConvert, me: Me):
    repo = get_crm_repository()
    scope = _scope(me)
    lead = _get_visible(repo.get_lead, lead_id, me, scope, _visible_lead, "Lead")
    if lead["status"] == "converted":
        raise HTTPException(422, "This lead has already been converted.")
    if body.member_role is not None:
        _check_enum(body.member_role, MEMBER_ROLES, "member_role")
    if lead.get("email"):
        _check_email(lead["email"])
    if lead.get("mobile"):
        _check_mobile(lead["mobile"])

    if body.household_id:
        h = repo.get_household(body.household_id)
        if not h:
            raise HTTPException(404, "Household not found")
        if not _visible_household(h, me, scope):
            raise HTTPException(403, "You do not have permission to use this household.")

    owner_rm_id = me["id"] if me["role"] == "rm" else lead.get("assigned_rm_id")
    _require_rm_account(owner_rm_id)

    # No usable login unless the RM explicitly invites the client to the portal.
    temp_password: str | None = None
    if body.invite_to_portal:
        password = body.password
        if not password:
            password = temp_password = secrets.token_urlsafe(24)
    else:
        password = secrets.token_urlsafe(32)  # unknowable; the client cannot sign in

    household_name = (body.household_name or "").strip() or None
    result = guard(
        repo.convert_lead,
        lead_id,
        actor_id=me["id"],
        owner_rm_id=owner_rm_id,
        password_hash=_hash_password(password),
        household_id=body.household_id,
        household_name=household_name,
        member_role=body.member_role or ("other" if body.household_id else "primary"),
    )
    result["invited"] = body.invite_to_portal
    if temp_password is not None:
        result["temp_password"] = temp_password  # returned once; never stored in plain text
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
    response: Response,
    page: PageParams,
    product_line: str | None = Query(None),
    stage: str | None = Query(None),
    household_id: str | None = Query(None),
    assigned_rm_id: str | None = Query(None),
):
    _check_enum(product_line, PRODUCT_LINES, "product_line")
    repo = get_crm_repository()
    opps = guard(
        repo.list_opportunities,
        product_line=product_line,
        stage=stage,
        household_id=household_id,
        assigned_rm_id=_owner(me, assigned_rm_id),
        viewer_rm_id=_viewer(me),
        page=page,
    )
    send_total(response, page)
    hh = repo.household_names([o["household_id"] for o in opps if o.get("household_id")])
    cust = repo.customer_names([o["customer_id"] for o in opps if o.get("customer_id")])
    return [{**o, "household_name": hh.get(o.get("household_id")), "customer_name": cust.get(o.get("customer_id"))} for o in opps]


@router.get("/opportunities/{opportunity_id}")
def get_opportunity(opportunity_id: str, me: Me):
    repo = get_crm_repository()
    opp = _get_visible(repo.get_opportunity, opportunity_id, me, _scope(me), _visible_opportunity, "Opportunity")
    hh = repo.household_names([opp["household_id"]] if opp.get("household_id") else [])
    cust = repo.customer_names([opp["customer_id"]] if opp.get("customer_id") else [])
    return {**opp, "household_name": hh.get(opp.get("household_id")), "customer_name": cust.get(opp.get("customer_id"))}


@router.post("/opportunities", status_code=201)
def create_opportunity(body: OpportunityCreate, me: Me):
    _check_enum(body.product_line, PRODUCT_LINES, "product_line")
    stage = _check_stage(body.product_line, body.stage)
    if stage in CLOSED_STAGES:
        raise HTTPException(422, "New opportunities must start in an open stage.")
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
    assigned = _assignee(me, body.assigned_rm_id, create=True)
    probability = body.probability if body.probability is not None else default_probability(body.product_line, stage)
    riskometer, suitability, note = _suitability_for(body, me, repo)
    opp = repo.create_opportunity(
        household_id=body.household_id,
        customer_id=body.customer_id,
        product_line=body.product_line,
        title=title,
        amount=body.amount,
        stage=stage,
        probability=probability,
        expected_close=_check_date(body.expected_close, "expected_close"),
        assigned_rm_id=assigned,
        notes=body.notes,
        scheme_code=body.scheme_code,
        riskometer=riskometer,
        suitability_note=note,
        actor_id=me["id"],
    )
    return _with_warnings(opp, [suitability["message"]] if suitability["level"] != "ok" and suitability["message"] else [])


def _suitability_for(body: OpportunityCreate, me: dict, repo) -> tuple[int | None, dict, str | None]:
    """Riskometer vs the client's assessed limit: warn one step over, block two or more (admin may override with a reason)."""
    riskometer = body.riskometer
    if riskometer is None and body.scheme_code:
        info = p3.latest_navs([body.scheme_code]).get(body.scheme_code)
        riskometer = p3.riskometer_for_category((info or {}).get("category"))
    if riskometer is None and body.product_line == "pms":
        riskometer = 6  # PMS carries no scheme riskometer; treat as the highest until an explicit value is given
    if body.product_line not in ("mutual_fund", "pms") or riskometer is None:
        return None, {"level": "ok", "message": None, "gap": None}, None
    client = body.customer_id
    if not client and body.household_id:
        h = repo.get_household(body.household_id)
        client = (h or {}).get("primary_customer_id")
        if not client:  # the household's primary member, else the earliest-added one
            members = repo.list_household_members(body.household_id)
            primary = next((m for m in members if m["role"] == "primary"), members[0] if members else None)
            client = primary["customer_id"] if primary else None
    check = p3.suitability_check(riskometer, client)
    note = check["message"]
    if check["level"] == "block":
        reason = (body.suitability_override_reason or "").strip()
        if me["role"] != "admin" or not reason:
            raise HTTPException(422, f"Suitability block: {check['message']} An admin can proceed only with a documented reason.")
        note = f"{check['message']} Override by {me['name']}: {reason}"
    return riskometer, check, note


def _stage_change_fields(opp: dict, body: OpportunityUpdate) -> dict[str, Any]:
    """Validate a stage move against the transitions map and derive close fields."""
    new = _check_stage(opp["product_line"], body.stage)
    if new == opp["stage"]:
        return {}
    if new not in allowed_transitions(opp["product_line"]).get(opp["stage"], set()):
        if opp["stage"] in CLOSED_STAGES:
            raise HTTPException(422, f"A {opp['stage']} opportunity is final and cannot change stage.")
        raise HTTPException(422, f"Cannot move from {opp['stage']} to {new}.")
    fields: dict[str, Any] = {"stage": new}
    if "probability" not in body.model_fields_set:
        fields["probability"] = default_probability(opp["product_line"], new)
    if new == WON_STAGE:
        won_amount = body.won_amount if body.won_amount is not None else (body.amount or opp.get("amount"))
        if won_amount is None:
            raise HTTPException(422, "won_amount is required to mark an opportunity won.")
        fields.update(won_amount=won_amount, closed_at=_utcnow(), lost_reason=None)
    elif new == LOST_STAGE:
        reason = (body.lost_reason or "").strip()
        if not reason:
            raise HTTPException(422, "lost_reason is required to mark an opportunity lost.")
        fields.update(lost_reason=reason, closed_at=_utcnow())
    return fields


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
        fields.update(_stage_change_fields(opp, body))
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
        fields["assigned_rm_id"] = _assignee(me, body.assigned_rm_id, create=False)
    updated = repo.update_opportunity(opportunity_id, fields, actor_id=me["id"])
    if not updated:
        raise HTTPException(404, "Opportunity not found")
    return updated


@router.get("/pipeline")
def pipeline_summary(me: Me, product_line: str | None = Query(None)):
    """Open pipeline by stage. Won and lost are excluded from the totals and reported under ``closed``."""
    _check_enum(product_line, PRODUCT_LINES, "product_line")
    repo = get_crm_repository()
    viewer = _viewer(me)
    opps = repo.list_opportunities(product_line=product_line, exclude_stages=CLOSED_STAGES, viewer_rm_id=viewer)
    if product_line:
        ordered = open_stages(product_line)
    else:
        ordered = []
        for line in PRODUCT_LINES:
            for st in open_stages(line):
                if st not in ordered:
                    ordered.append(st)
    stages = []
    total_value = 0
    for st in ordered:
        bucket = [o for o in opps if o["stage"] == st]
        value = sum(o["amount"] or 0 for o in bucket)
        stages.append({"stage": st, "count": len(bucket), "value": value})
        total_value += value
    closed = {}
    for st in CLOSED_STAGES:
        rows = repo.list_opportunities(product_line=product_line, stage=st, viewer_rm_id=viewer)
        key = "won_amount" if st == WON_STAGE else "amount"
        closed[st] = {"count": len(rows), "value": sum((o[key] if o.get(key) is not None else o["amount"]) or 0 for o in rows)}
    return {"stages": stages, "total_value": total_value, "total_count": len(opps), "closed": closed}


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------
@router.get("/activities")
def list_activities(
    me: Me,
    response: Response,
    page: PageParams,
    assigned_rm_id: str | None = Query(None),
    household_id: str | None = Query(None),
    customer_id: str | None = Query(None),
    opportunity_id: str | None = Query(None),
    case_id: str | None = Query(None),
    lead_id: str | None = Query(None),
    done: bool | None = Query(None),
    due_before: str | None = Query(None),
    overdue: bool = Query(False, description="Open tasks due before today (IST)"),
):
    repo = get_crm_repository()
    rows = guard(
        repo.list_activities,
        overdue_before=today_ist() if overdue else None,
        assigned_rm_id=_owner(me, assigned_rm_id),
        household_id=household_id,
        customer_id=customer_id,
        opportunity_id=opportunity_id,
        case_id=case_id,
        lead_id=lead_id,
        done=False if overdue else done,
        due_before=due_before,
        viewer_rm_id=_viewer(me),
        page=page,
    )
    send_total(response, page)
    return rows


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
    if body.lead_id:
        _get_visible(repo.get_lead, body.lead_id, me, scope, _visible_lead, "Lead")
    assigned = _assignee(me, body.assigned_rm_id, create=True)
    due_at = _check_date(body.due_at, "due_at")
    row = repo.create_activity(
        kind=body.kind,
        subject=subject,
        body=body.body,
        household_id=body.household_id,
        customer_id=body.customer_id,
        opportunity_id=body.opportunity_id,
        case_id=body.case_id,
        lead_id=body.lead_id,
        policy_id=body.policy_id,
        fd_id=body.fd_id,
        due_at=due_at,
        assigned_rm_id=assigned,
        actor_id=me["id"],
    )
    return _with_warnings(row, _past_warnings(due_at))


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
    warnings: list[str] = []
    if "done_at" in body.model_fields_set:
        # done_at=null reopens the activity.
        fields["done_at"] = _check_date(body.done_at, "done_at") if body.done_at else None
    if "subject" in body.model_fields_set:
        if body.subject is None:
            raise HTTPException(422, "subject cannot be empty")
        fields["subject"] = _clean_str(body.subject, "subject")
    if "body" in body.model_fields_set:
        fields["body"] = body.body
    if "due_at" in body.model_fields_set:
        fields["due_at"] = _check_date(body.due_at, "due_at") if body.due_at else None
        warnings = _past_warnings(fields["due_at"])
    if "assigned_rm_id" in body.model_fields_set:
        fields["assigned_rm_id"] = _assignee(me, body.assigned_rm_id, create=False)
    updated = repo.update_activity(activity_id, fields, actor_id=me["id"])
    if not updated:
        raise HTTPException(404, "Activity not found")
    return _with_warnings(updated, warnings)


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------
@router.get("/cases")
def list_cases(
    me: Me,
    response: Response,
    page: PageParams,
    status: str | None = Query(None),
    customer_id: str | None = Query(None),
    sla_breaching: bool = Query(False, description="Open cases whose SLA date is before today (IST)"),
):
    _check_enum(status, CASE_STATUSES, "status")
    repo = get_crm_repository()
    cases = guard(
        repo.list_cases,
        status=status,
        statuses=CASE_OPEN_STATUSES if sla_breaching else (),
        sla_before=today_ist() if sla_breaching else None,
        customer_id=customer_id,
        viewer_rm_id=_viewer(me),
        page=page,
    )
    send_total(response, page)
    names = repo.customer_names([c["customer_id"] for c in cases])
    return [{**c, "customer_name": names.get(c.get("customer_id"))} for c in cases]


@router.get("/cases/{case_id}")
def get_case(case_id: str, me: Me):
    repo = get_crm_repository()
    case = _get_visible(repo.get_case, case_id, me, _scope(me), _visible_case, "Case")
    return {**case, "customer_name": _customer_name(case.get("customer_id"))}


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
        actor_id=me["id"],
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
    updated = repo.update_case(case_id, fields, actor_id=me["id"])
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
    viewer = _viewer(me)

    households = repo.list_households(rm_id=viewer)
    leads = [lead for lead in repo.list_leads(viewer_rm_id=viewer) if lead["status"] in ACTIVE_LEAD_STATUSES]

    opps = repo.list_opportunities(exclude_stages=CLOSED_STAGES, viewer_rm_id=viewer)
    pipeline_value_by_line = {line: 0 for line in PRODUCT_LINES}
    for o in opps:
        pipeline_value_by_line[o["product_line"]] += o["amount"] or 0

    renewals = _scoped_product_rows(repo.list_policy_renewals(days=30), scope)
    maturities = _scoped_product_rows(repo.list_fd_maturities(days=60), scope)
    open_cases = repo.list_cases(statuses=CASE_OPEN_STATUSES, viewer_rm_id=viewer)

    horizon = (datetime.now(IST) + timedelta(days=7)).isoformat()
    tasks_due = repo.list_activities(done=False, due_before=horizon, viewer_rm_id=viewer)

    return {
        "households_count": len(households),
        "active_leads_count": len(leads),
        "pipeline_value_by_line": pipeline_value_by_line,
        "renewals_due_30d": len(renewals),
        "fd_maturities_60d": len(maturities),
        "open_cases_count": len(open_cases),
        "tasks_due_count": len(tasks_due),
    }


def _scoped_product_rows(rows: list[dict], scope: _Scope) -> list[dict]:
    if scope.admin:
        return rows
    return [r for r in rows if (r.get("household_id") in scope.household_ids) or (r.get("customer_id") in scope.customer_ids)]


# ---------------------------------------------------------------------------
# Renewals / maturities (W2 product tables; defensive when absent)
# ---------------------------------------------------------------------------
def _enrich_product_rows(rows: list[dict]) -> list[dict]:
    repo = get_crm_repository()
    hh = repo.household_names([r["household_id"] for r in rows if r.get("household_id")])
    cust = repo.customer_names([r["customer_id"] for r in rows if r.get("customer_id")])
    return [{**r, "household_name": hh.get(r.get("household_id")), "customer_name": cust.get(r.get("customer_id"))} for r in rows]


@router.get("/renewals")
def list_renewals(me: Me, response: Response, page: PageParams, days: int = Query(45, ge=1, le=365)):
    repo = get_crm_repository()
    rows = _scoped_product_rows(repo.list_policy_renewals(days=days), _scope(me))
    rows = paginate_rows(rows, page)
    send_total(response, page)
    return _enrich_product_rows(rows)


@router.get("/maturities")
def list_maturities(me: Me, response: Response, page: PageParams, days: int = Query(60, ge=1, le=365)):
    repo = get_crm_repository()
    rows = _scoped_product_rows(repo.list_fd_maturities(days=days), _scope(me))
    rows = paginate_rows(rows, page)
    send_total(response, page)
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
        items = _scoped_product_rows(repo.list_policy_renewals(days=45), scope)
        for item in items:
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
                actor_id=me["id"],
            )
            created += 1
    else:
        items = _scoped_product_rows(repo.list_fd_maturities(days=60), scope)
        for item in items:
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
                actor_id=me["id"],
            )
            created += 1
    return {"created": created}
