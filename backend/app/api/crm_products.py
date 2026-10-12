"""CRM products & compliance endpoints (W2).

``router`` (prefix ``/api/crm``) covers insurance policies, fixed deposits, PMS
accounts, KYC records, mandates, consents, suitability history, disclosure
logs, and the bulk client import.

Auth: ``require_role("admin", "rm")`` gives 401 when not signed in and 403 for
``customer`` accounts. Admins see everything; RMs are scoped to households with
``households.rm_id == me.id``, customers with ``assigned_rm_id == me.id``, and
customers who are members of their households.

Money is integer paise in and out. ``pan_last4`` is validated as exactly four
alphanumerics and the full PAN is never accepted or stored.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app import db_crm_products
from app.api.auth import _hash_password, require_role

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PAN4_RE = re.compile(r"^[A-Za-z0-9]{4}$")


def _use_postgres() -> bool:
    return os.environ.get("DATABASE_URL", "").strip().startswith(("postgres://", "postgresql://"))


def _store() -> Any:
    if _use_postgres():
        from app.repo_crm_products import get_store

        return get_store()
    return db_crm_products


def _ensure_schema() -> None:
    store = _store()
    if hasattr(store, "ensure_crm_products_schema"):
        store.ensure_crm_products_schema()
    else:  # pragma: no cover - postgres path
        store.ensure_schema()


router = APIRouter(prefix="/api/crm", tags=["crm-products"], dependencies=[Depends(_ensure_schema)])

Me = Annotated[dict, Depends(require_role("admin", "rm"))]


# ------------------------------------------------------------ validators ----
def _check_date(v: str | None, field: str) -> str | None:
    if v is None:
        return None
    if not _DATE_RE.match(v):
        raise ValueError(f"{field} must be YYYY-MM-DD")
    try:
        datetime.strptime(v, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"{field} must be a real calendar date") from None
    return v


class PolicyIn(BaseModel):
    model_config = {"extra": "forbid"}
    household_id: str | None = None
    customer_id: str | None = None
    policy_type: Literal["term", "health", "motor", "other_general", "other_life"]
    insurer: str | None = None
    policy_no: str | None = None
    premium_amount: int | None = Field(default=None, ge=0)
    premium_due_date: str | None = None
    renewal_date: str | None = None
    status: Literal["active", "lapsed", "renewed", "claimed"] = "active"
    notes: str | None = None

    @field_validator("premium_due_date", "renewal_date")
    @classmethod
    def _dates(cls, v: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _check_date(v, info.field_name)


class PolicyPatch(BaseModel):
    model_config = {"extra": "forbid"}
    household_id: str | None = None
    customer_id: str | None = None
    policy_type: Literal["term", "health", "motor", "other_general", "other_life"] | None = None
    insurer: str | None = None
    policy_no: str | None = None
    premium_amount: int | None = Field(default=None, ge=0)
    premium_due_date: str | None = None
    renewal_date: str | None = None
    status: Literal["active", "lapsed", "renewed", "claimed"] | None = None
    notes: str | None = None

    @field_validator("premium_due_date", "renewal_date")
    @classmethod
    def _dates(cls, v: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _check_date(v, info.field_name)


class FdIn(BaseModel):
    model_config = {"extra": "forbid"}
    household_id: str | None = None
    customer_id: str | None = None
    company: str | None = None
    amount: int | None = Field(default=None, ge=0)
    interest_rate: float | None = None
    start_date: str | None = None
    maturity_date: str | None = None
    status: Literal["active", "matured", "reinvested", "premature"] = "active"
    notes: str | None = None

    @field_validator("start_date", "maturity_date")
    @classmethod
    def _dates(cls, v: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _check_date(v, info.field_name)

    @field_validator("interest_rate")
    @classmethod
    def _rate(cls, v: float | None) -> float | None:
        if v is not None and not (0 <= v <= 100):
            raise ValueError("interest_rate must be between 0 and 100")
        return v


class FdPatch(BaseModel):
    model_config = {"extra": "forbid"}
    household_id: str | None = None
    customer_id: str | None = None
    company: str | None = None
    amount: int | None = Field(default=None, ge=0)
    interest_rate: float | None = None
    start_date: str | None = None
    maturity_date: str | None = None
    status: Literal["active", "matured", "reinvested", "premature"] | None = None
    notes: str | None = None

    @field_validator("start_date", "maturity_date")
    @classmethod
    def _dates(cls, v: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _check_date(v, info.field_name)


class PmsIn(BaseModel):
    model_config = {"extra": "forbid"}
    household_id: str | None = None
    customer_id: str | None = None
    provider: str | None = None
    agreement_date: str | None = None
    amount: int | None = Field(default=None, ge=0)
    fee_fixed_pct: float | None = None
    fee_performance_pct: float | None = None
    hurdle_pct: float | None = None
    high_water_mark: int = Field(default=0, ge=0)
    exit_load_pct: float | None = None
    disclosure_doc_version: str | None = None
    disclosure_given_at: str | None = None
    fee_acknowledged_at: str | None = None
    reporting_cycle: Literal["monthly", "quarterly"] = "quarterly"
    last_report_at: str | None = None
    accredited_investor: bool = False
    status: Literal["prospect", "active", "exited"] = "prospect"

    @field_validator("agreement_date", "disclosure_given_at", "fee_acknowledged_at", "last_report_at")
    @classmethod
    def _dates(cls, v: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _check_date(v, info.field_name)


class PmsPatch(BaseModel):
    model_config = {"extra": "forbid"}
    household_id: str | None = None
    customer_id: str | None = None
    provider: str | None = None
    agreement_date: str | None = None
    amount: int | None = Field(default=None, ge=0)
    fee_fixed_pct: float | None = None
    fee_performance_pct: float | None = None
    hurdle_pct: float | None = None
    high_water_mark: int | None = Field(default=None, ge=0)
    exit_load_pct: float | None = None
    disclosure_doc_version: str | None = None
    disclosure_given_at: str | None = None
    fee_acknowledged_at: str | None = None
    reporting_cycle: Literal["monthly", "quarterly"] | None = None
    last_report_at: str | None = None
    accredited_investor: bool | None = None
    status: Literal["prospect", "active", "exited"] | None = None

    @field_validator("agreement_date", "disclosure_given_at", "fee_acknowledged_at", "last_report_at")
    @classmethod
    def _dates(cls, v: str | None, info) -> str | None:  # type: ignore[no-untyped-def]
        return _check_date(v, info.field_name)


class KycIn(BaseModel):
    model_config = {"extra": "forbid"}
    customer_id: str
    pan_last4: str | None = None
    kra_status: Literal["validated", "registered", "on_hold", "unknown"] = "unknown"
    ckyc_id: str | None = None

    @field_validator("pan_last4")
    @classmethod
    def _pan(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().upper()
        if not _PAN4_RE.match(v):
            raise ValueError("pan_last4 must be exactly 4 alphanumeric characters; never send the full PAN")
        return v


class MandateIn(BaseModel):
    model_config = {"extra": "forbid"}
    customer_id: str
    umrn: str | None = None
    bank_name: str | None = None
    amount_cap: int | None = Field(default=None, ge=0)
    status: Literal["registered", "processing", "approved", "rejected"] = "registered"


class MandatePatch(BaseModel):
    model_config = {"extra": "forbid"}
    umrn: str | None = None
    bank_name: str | None = None
    amount_cap: int | None = Field(default=None, ge=0)
    status: Literal["registered", "processing", "approved", "rejected"] | None = None


class ConsentIn(BaseModel):
    model_config = {"extra": "forbid"}
    customer_id: str
    purpose: Literal["onboarding", "regulatory_reporting", "communications", "marketing", "data_sharing"]
    granted: bool
    notice_version: str | None = None


class SuitabilityIn(BaseModel):
    model_config = {"extra": "forbid"}
    customer_id: str
    financial_status: str | None = None
    investment_experience: str | None = None
    objectives: str | None = None
    risk_band: str | None = None


class DisclosureIn(BaseModel):
    model_config = {"extra": "forbid"}
    customer_id: str
    opportunity_id: str | None = None
    schemes_compared: list[str] | None = None
    commissions_disclosed: str | None = None
    regular_plan_noted: bool = False


class ImportRow(BaseModel):
    model_config = {"extra": "forbid"}
    name: str
    email: str
    mobile: str | None = None
    household_name: str | None = None
    rm_email: str | None = None


class ImportIn(BaseModel):
    model_config = {"extra": "forbid"}
    rows: list[ImportRow] = Field(max_length=1000)


# ------------------------------------------------------------------ scope ---
def _scope_ids(me: dict) -> tuple[set[str], set[str]]:
    """(household ids, customer ids) the RM may act on. Admins bypass."""
    if me["role"] == "admin":
        return set(), set()
    store = _store()
    return store.rm_household_ids(me["id"]), store.rm_customer_ids(me["id"])


def _row_visible(me: dict, row: dict, hh_ids: set[str], cust_ids: set[str]) -> bool:
    if me["role"] == "admin":
        return True
    hh, cust = row.get("household_id"), row.get("customer_id")
    if hh and hh in hh_ids:
        return True
    if cust and cust in cust_ids:
        return True
    return hh is None and cust is None


def _check_customer_link(me: dict, customer_id: str | None, cust_ids: set[str]) -> None:
    if customer_id is None or me["role"] == "admin":
        return
    if customer_id not in cust_ids:
        raise HTTPException(403, "You do not have permission to access this customer's records.")


def _check_household_link(me: dict, household_id: str | None, hh_ids: set[str]) -> None:
    if household_id is None or me["role"] == "admin":
        return
    if household_id not in hh_ids:
        raise HTTPException(403, "You do not have permission to access this household's records.")


def _resolve_links(me: dict, customer_id: str | None, household_id: str | None) -> None:
    """404 on unknown ids, 403 on out-of-scope ids."""
    store = _store()
    if customer_id is not None and store.get_customer(customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    if household_id is not None and store.get_household(household_id) is None:
        raise HTTPException(404, "Household not found.")
    hh_ids, cust_ids = _scope_ids(me)
    _check_customer_link(me, customer_id, cust_ids)
    _check_household_link(me, household_id, hh_ids)


def _consent_out(row: dict) -> dict:
    return {**row, "granted": bool(row["granted"])}


# ---------------------------------------------------------------- policies --
@router.get("/policies")
def list_policies(
    me: Me,
    household_id: str | None = Query(default=None),
    customer_id: str | None = Query(default=None),
):
    _resolve_links(me, customer_id, household_id)
    rows = _store().list_policies(household_id=household_id, customer_id=customer_id)
    hh_ids, cust_ids = _scope_ids(me)
    return [r for r in rows if _row_visible(me, r, hh_ids, cust_ids)]


@router.post("/policies", status_code=201)
def create_policy(body: PolicyIn, me: Me):
    data = body.model_dump()
    _resolve_links(me, data.get("customer_id"), data.get("household_id"))
    return _store().create_policy(data)


@router.patch("/policies/{policy_id}")
def update_policy(policy_id: str, body: PolicyPatch, me: Me):
    store = _store()
    row = store.get_policy(policy_id)
    if row is None:
        raise HTTPException(404, "Policy not found.")
    hh_ids, cust_ids = _scope_ids(me)
    if not _row_visible(me, row, hh_ids, cust_ids):
        raise HTTPException(403, "You do not have permission to access this policy.")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    _resolve_links(me, data.get("customer_id"), data.get("household_id"))
    return store.patch_policy(policy_id, data)


# -------------------------------------------------------------------- fds ---
@router.get("/fds")
def list_fds(
    me: Me,
    household_id: str | None = Query(default=None),
    customer_id: str | None = Query(default=None),
):
    _resolve_links(me, customer_id, household_id)
    rows = _store().list_fds(household_id=household_id, customer_id=customer_id)
    hh_ids, cust_ids = _scope_ids(me)
    return [r for r in rows if _row_visible(me, r, hh_ids, cust_ids)]


@router.post("/fds", status_code=201)
def create_fd(body: FdIn, me: Me):
    data = body.model_dump()
    _resolve_links(me, data.get("customer_id"), data.get("household_id"))
    return _store().create_fd(data)


@router.patch("/fds/{fd_id}")
def update_fd(fd_id: str, body: FdPatch, me: Me):
    store = _store()
    row = store.get_fd(fd_id)
    if row is None:
        raise HTTPException(404, "Fixed deposit not found.")
    hh_ids, cust_ids = _scope_ids(me)
    if not _row_visible(me, row, hh_ids, cust_ids):
        raise HTTPException(403, "You do not have permission to access this fixed deposit.")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    _resolve_links(me, data.get("customer_id"), data.get("household_id"))
    return store.patch_fd(fd_id, data)


# -------------------------------------------------------------------- pms ---
@router.get("/pms")
def list_pms(
    me: Me,
    household_id: str | None = Query(default=None),
    customer_id: str | None = Query(default=None),
):
    _resolve_links(me, customer_id, household_id)
    rows = _store().list_pms(household_id=household_id, customer_id=customer_id)
    hh_ids, cust_ids = _scope_ids(me)
    return [r for r in rows if _row_visible(me, r, hh_ids, cust_ids)]


@router.post("/pms", status_code=201)
def create_pms(body: PmsIn, me: Me):
    data = body.model_dump()
    data["accredited_investor"] = 1 if data.pop("accredited_investor") else 0
    _resolve_links(me, data.get("customer_id"), data.get("household_id"))
    return _store().create_pms(data)


@router.patch("/pms/{pms_id}")
def update_pms(pms_id: str, body: PmsPatch, me: Me):
    store = _store()
    row = store.get_pms(pms_id)
    if row is None:
        raise HTTPException(404, "PMS account not found.")
    hh_ids, cust_ids = _scope_ids(me)
    if not _row_visible(me, row, hh_ids, cust_ids):
        raise HTTPException(403, "You do not have permission to access this PMS account.")
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "accredited_investor" in data:
        data["accredited_investor"] = 1 if data["accredited_investor"] else 0
    _resolve_links(me, data.get("customer_id"), data.get("household_id"))
    return store.patch_pms(pms_id, data)


# -------------------------------------------------------------------- kyc ---
@router.get("/kyc")
def get_kyc(me: Me, customer_id: str = Query()):
    store = _store()
    if store.get_customer(customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, customer_id, cust_ids)
    rec = store.get_kyc(customer_id)
    if rec is None:
        raise HTTPException(404, "No KYC record for this customer.")
    return rec


@router.post("/kyc")
def upsert_kyc(body: KycIn, me: Me):
    store = _store()
    if store.get_customer(body.customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, body.customer_id, cust_ids)
    existed = store.get_kyc(body.customer_id) is not None
    rec = store.upsert_kyc(body.model_dump())
    return {"record": rec, "created": not existed}


# --------------------------------------------------------------- mandates ---
@router.get("/mandates")
def list_mandates(me: Me, customer_id: str | None = Query(default=None)):
    if customer_id is not None:
        if _store().get_customer(customer_id) is None:
            raise HTTPException(404, "Customer not found.")
        _, cust_ids = _scope_ids(me)
        _check_customer_link(me, customer_id, cust_ids)
    rows = _store().list_mandates(customer_id=customer_id)
    _, cust_ids = _scope_ids(me)
    return [r for r in rows if me["role"] == "admin" or r.get("customer_id") in cust_ids]


@router.post("/mandates", status_code=201)
def create_mandate(body: MandateIn, me: Me):
    store = _store()
    if store.get_customer(body.customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, body.customer_id, cust_ids)
    return store.create_mandate(body.model_dump())


@router.patch("/mandates/{mandate_id}")
def update_mandate(mandate_id: str, body: MandatePatch, me: Me):
    store = _store()
    row = store.get_mandate(mandate_id)
    if row is None:
        raise HTTPException(404, "Mandate not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, row.get("customer_id"), cust_ids)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    return store.patch_mandate(mandate_id, data)


# --------------------------------------------------------------- consents ---
@router.get("/consents")
def list_consents(me: Me, customer_id: str = Query()):
    store = _store()
    if store.get_customer(customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, customer_id, cust_ids)
    return [_consent_out(r) for r in store.list_consents(customer_id=customer_id)]


@router.post("/consents")
def upsert_consent(body: ConsentIn, me: Me):
    store = _store()
    if store.get_customer(body.customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, body.customer_id, cust_ids)
    existed = any(
        r["purpose"] == body.purpose for r in store.list_consents(customer_id=body.customer_id)
    )
    rec = _consent_out(store.upsert_consent(body.model_dump()))
    return {"consent": rec, "created": not existed}


# ------------------------------------------------------------ suitability ---
@router.get("/suitability")
def list_suitability(me: Me, customer_id: str = Query()):
    store = _store()
    if store.get_customer(customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, customer_id, cust_ids)
    return store.list_suitability(customer_id)  # latest first


@router.post("/suitability", status_code=201)
def create_suitability(body: SuitabilityIn, me: Me):
    store = _store()
    if store.get_customer(body.customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, body.customer_id, cust_ids)
    data = body.model_dump()
    data["recorded_by_rm_id"] = me["id"]  # append-only; the recorder is always the caller
    return store.create_suitability(data)


# ------------------------------------------------------------ disclosures ---
@router.get("/disclosures")
def list_disclosures(
    me: Me,
    customer_id: str | None = Query(default=None),
    opportunity_id: str | None = Query(default=None),
):
    store = _store()
    if customer_id is not None:
        if store.get_customer(customer_id) is None:
            raise HTTPException(404, "Customer not found.")
        _, cust_ids = _scope_ids(me)
        _check_customer_link(me, customer_id, cust_ids)
    rows = store.list_disclosures(customer_id=customer_id, opportunity_id=opportunity_id)
    hh_ids, cust_ids = _scope_ids(me)
    return [r for r in rows if _row_visible(me, r, hh_ids, cust_ids)]


@router.post("/disclosures", status_code=201)
def create_disclosure(body: DisclosureIn, me: Me):
    store = _store()
    if store.get_customer(body.customer_id) is None:
        raise HTTPException(404, "Customer not found.")
    _, cust_ids = _scope_ids(me)
    _check_customer_link(me, body.customer_id, cust_ids)
    data = body.model_dump()
    data["schemes_compared"] = json.dumps(data["schemes_compared"]) if data["schemes_compared"] else None
    data["regular_plan_noted"] = 1 if data.pop("regular_plan_noted") else 0
    rec = store.create_disclosure(data)
    return {**rec, "regular_plan_noted": bool(rec["regular_plan_noted"])}


# ----------------------------------------------------------------- import ---
def _normalize_mobile(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits if re.fullmatch(r"[6-9]\d{9}", digits) else None


def _placeholder_mobile() -> str:
    return "9" + "".join(secrets.choice("0123456789") for _ in range(9))


@router.post("/import/clients")
def import_clients(body: ImportIn, me: Me):
    """Bulk client import. Never fails the batch: bad or duplicate rows are
    reported in ``skipped`` with a reason. Resolves ``rm_email`` to an RM;
    creates a household (and a primary member link) when ``household_name``
    is given."""
    store = _store()
    created = 0
    households_created = 0
    skipped: list[dict[str, str]] = []

    for row in body.rows:
        name = (row.name or "").strip()
        email = (row.email or "").strip().lower()
        if len(name) < 2:
            skipped.append({"email": email or row.email, "reason": "name is required"})
            continue
        if not _EMAIL_RE.match(email):
            skipped.append({"email": row.email, "reason": "invalid email address"})
            continue
        if store.get_customer_by_email(email) is not None:
            skipped.append({"email": email, "reason": "duplicate email"})
            continue

        rm_id: str | None = None
        if me["role"] == "rm":
            rm_id = me["id"]  # RMs can only import under themselves
        elif row.rm_email:
            rm = store.get_customer_by_email(row.rm_email.strip().lower())
            if rm is None or rm.get("role") not in ("rm", "admin"):
                skipped.append({"email": email, "reason": "rm not found"})
                continue
            rm_id = rm["id"]

        mobile = _normalize_mobile(row.mobile) or _placeholder_mobile()
        temp_password = secrets.token_urlsafe(16)
        for _ in range(5):  # placeholder mobiles must stay unique
            try:
                customer = store.create_import_customer(
                    name=name,
                    email=email,
                    mobile=mobile,
                    password_hash=_hash_password(temp_password),
                    assigned_rm_id=rm_id,
                )
                break
            except ValueError:
                mobile = _placeholder_mobile()
        else:
            skipped.append({"email": email, "reason": "could not assign a unique mobile number"})
            continue

        household_name = (row.household_name or "").strip()
        if household_name:
            household = store.create_household(household_name, rm_id)
            store.add_household_member(household["id"], customer["id"], "primary")
            store.set_household_primary(household["id"], customer["id"])
            households_created += 1
        created += 1

    return {"created": created, "skipped": skipped, "households_created": households_created}
