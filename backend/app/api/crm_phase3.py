from __future__ import annotations
"""CRM Phase 3 endpoints for an Indian MF distributor: contacts (NRI/minor/nominee/KYC), CAS holdings and AUM,
SIP/STP/SWP schedules and alerts, trail commission, suitability scoring, campaigns and RM teams.

Auth and scoping come from ``crm_auth`` (admin, RM/team lead, read-only compliance). Money is integer paise.
"""


import re
import secrets
from datetime import date, datetime, timedelta
from typing import Any

import io
from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from app import repo_crm_extras as extras
from app import repo_crm_phase3 as p3
from app.api.auth import _hash_password
from app.api.crm_auth import unscoped
from app.api.crm_core import (
    Me,
    _check_email,
    _check_enum,
    _check_mobile,
    _clean_str,
    _get_visible,
    _require_rm_account,
    _scope,
    _viewer,
    _visible_household,
)
from app.api.crm_page import PageParams, guard, send_total
from app.crm_csv import CsvError, parse_date, parse_decimal, parse_month, read_csv, to_paise
from app.repo_crm_core import IST, Page, _session, get_crm_repository, today_ist

router = APIRouter(prefix="/api/crm", tags=["crm-phase3"])


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _contact_or_404(contact_id: str, me: dict) -> dict:
    c = p3.get_contact(contact_id)
    if not c:
        raise HTTPException(404, "Contact not found")
    if not unscoped(me) and c["rm_id"] not in me["_team"]:
        raise HTTPException(403, "You do not have permission to access this resource.")
    return c


def _household_or_403(household_id: str, me: dict) -> dict:
    return _get_visible(get_crm_repository().get_household, household_id, me, _scope(me), _visible_household, "Household")


def _iso_date(value: str | None, field: str) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(422, f"{field} must be a valid date (YYYY-MM-DD)") from None


def _kyc_row(customer_id: str) -> dict | None:
    repo = get_crm_repository()
    if not repo.table_exists("kyc_records"):
        return None
    with _session() as s:
        from sqlalchemy import text

        r = s.execute(text("SELECT pan_last4, kra_status, ckyc_id FROM kyc_records WHERE customer_id = :c"), {"c": customer_id}).first()
    return {"pan_last4": r[0], "kra_status": r[1], "ckyc_id": r[2]} if r else None


def _contact_detail(c: dict) -> dict:
    kyc = _kyc_row(c["customer_id"])
    today = today_ist()
    gaps = []
    if not c.get("nominee_name"):
        gaps.append("nominee")
    if not kyc or kyc["kra_status"] != "validated" or not kyc["pan_last4"]:
        gaps.append("kyc")
    if c.get("kyc_expiry") and c["kyc_expiry"] < today:
        gaps.append("kyc_expired")
    if c["fatca_crs"] == "not_collected":
        gaps.append("fatca_crs")
    return {**c, "kyc": kyc, "gaps": gaps}


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------
class ContactIn(BaseModel):
    name: str | None = None
    email: str | None = None
    mobile: str | None = None
    household_id: str | None = None
    relation: str | None = None
    dob: str | None = None
    guardian_contact_id: str | None = None
    tax_status: str | None = None
    country: str | None = None
    nre_bank: str | None = None
    nro_bank: str | None = None
    nominee_name: str | None = None
    nominee_relation: str | None = None
    nominee_pct: int | None = Field(None, ge=1, le=100)
    fatca_crs: str | None = None
    kyc_expiry: str | None = None


def _validate_contact(merged: dict, household_id: str, self_id: str | None = None) -> None:
    """Rules on the *resulting* contact, so create and patch share them."""
    _check_enum(merged["relation"], p3.RELATIONS, "relation")
    _check_enum(merged["tax_status"], p3.TAX_STATUSES, "tax_status")
    _check_enum(merged["fatca_crs"], p3.FATCA_CRS, "fatca_crs")
    if merged["tax_status"] in ("nri", "oci"):
        if not (merged.get("country") or "").strip():
            raise HTTPException(422, "Country of residence is required for an NRI or OCI client.")
        if (merged["country"] or "").strip().lower() == "india":
            raise HTTPException(422, "An NRI or OCI client's country of residence cannot be India.")
    elif merged.get("nre_bank") or merged.get("nro_bank"):
        raise HTTPException(422, "NRE/NRO bank details apply only to NRI or OCI clients.")
    if merged.get("nominee_pct") and not (merged.get("nominee_name") or "").strip():
        raise HTTPException(422, "A nominee name is required when a nominee share is given.")
    age = p3._age(merged.get("dob"))
    if merged.get("dob") and age is None:
        raise HTTPException(422, "dob must be a valid date (YYYY-MM-DD)")
    if age is not None and age < 0:
        raise HTTPException(422, "dob cannot be in the future")
    if age is not None and age < 18:
        gid = merged.get("guardian_contact_id")
        if not gid:
            raise HTTPException(422, "A guardian is required for a minor (under 18).")
        g = p3.get_contact(gid)
        if not g or g["household_id"] != household_id:
            raise HTTPException(422, "The guardian must be a contact in the same household.")
        if gid == self_id:
            raise HTTPException(422, "A contact cannot be their own guardian.")
        if g["is_minor"]:
            raise HTTPException(422, "The guardian must be an adult.")


def _clean_contact_fields(body: ContactIn, fields: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in fields:
        v = getattr(body, f)
        if f == "name":
            out[f] = _clean_str(v, "name") if v is not None else None
        elif f == "email":
            out[f] = _check_email(v)
        elif f == "mobile":
            out[f] = _check_mobile(v)
        elif f in ("dob", "kyc_expiry"):
            out[f] = _iso_date(v, f)
        elif isinstance(v, str):
            out[f] = v.strip() or None
        else:
            out[f] = v
    return out


@router.post("/contacts", status_code=201)
def create_contact(body: ContactIn, me: Me):
    """Add a person to a household without giving them a login."""
    name = _clean_str(body.name, "name")
    if not name or not body.household_id:
        raise HTTPException(422, "name and household_id are required")
    h = _household_or_403(body.household_id, me)
    fields = _clean_contact_fields(body, {"email", "mobile", "dob", "guardian_contact_id", "country", "nre_bank", "nro_bank", "nominee_name", "nominee_relation", "nominee_pct", "kyc_expiry"})
    fields["relation"] = body.relation or "other"
    fields["tax_status"] = body.tax_status or "resident"
    fields["fatca_crs"] = body.fatca_crs or "not_collected"
    _validate_contact(fields, body.household_id)
    email, mobile = fields.pop("email"), fields.pop("mobile")
    contact = guard(
        p3.create_contact, name=name, email=email, mobile=mobile, household_id=body.household_id,
        owner_rm_id=h.get("rm_id"), password_hash=_hash_password(secrets.token_urlsafe(32)), actor_id=me["id"],
        **fields,
    )
    return _contact_detail(contact)


def gap_rows(me: dict) -> list[dict]:
    """Contacts missing a nominee, KYC, FATCA/CRS, or with an expired KYC (the book the viewer may see)."""
    rows = guard(extras.list_contacts, _viewer(me), Page(limit=100_000))
    out = []
    for r in rows:
        c = p3.get_contact(r["id"])
        d = _contact_detail(c) if c else None
        if d and d["gaps"]:
            out.append({k: d[k] for k in ("id", "name", "household_id", "household_name", "rm_id", "gaps", "kyc_expiry")})
    out.sort(key=lambda x: (x["household_name"] or "", x["name"] or ""))
    return out


@router.get("/contacts/gaps")
def contact_gaps(me: Me, response: Response, page: PageParams):
    """Contacts missing a nominee, KYC, FATCA/CRS, or with an expired KYC."""
    out = gap_rows(me)
    page.total = len(out)
    send_total(response, page)
    return out[page.offset : page.offset + page.limit]


@router.get("/contacts/{contact_id}")
def get_contact(contact_id: str, me: Me):
    return _contact_detail(_contact_or_404(contact_id, me))


@router.patch("/contacts/{contact_id}")
def update_contact(contact_id: str, body: ContactIn, me: Me):
    cur = _contact_or_404(contact_id, me)
    changed = set(body.model_fields_set)
    if "household_id" in changed:
        raise HTTPException(422, "A contact cannot be moved to another household here.")
    fields = _clean_contact_fields(body, changed)
    if "name" in fields and not fields["name"]:
        raise HTTPException(422, "name cannot be empty")
    merged = {k: cur.get(k) for k in ("relation", "tax_status", "fatca_crs", "country", "nre_bank", "nro_bank", "nominee_name", "nominee_pct", "dob", "guardian_contact_id")}
    merged.update({k: v for k, v in fields.items() if k in merged})
    for k in ("relation", "tax_status", "fatca_crs"):
        if merged[k] is None:
            raise HTTPException(422, f"{k} cannot be empty")
    _validate_contact(merged, cur["household_id"], contact_id)
    updated = guard(p3.update_contact, contact_id, fields, me["id"])
    if not updated:
        raise HTTPException(404, "Contact not found")
    return _contact_detail(updated)


# ---------------------------------------------------------------------------
# Holdings, AUM and the CAS import
# ---------------------------------------------------------------------------
def _holdings_payload(rows: list[dict]) -> dict[str, Any]:
    valued = p3.value_holdings(rows)
    total = sum(v["value_paise"] or 0 for v in valued)
    return {
        "holdings": valued,
        "aum_paise": total,
        "cost_paise": sum(v["cost_paise"] for v in valued),
        "unvalued": sum(1 for v in valued if v["value_paise"] is None),
        "direct_plan_holdings": [v for v in valued if v["is_direct"]],
        "tier": p3.tier_for(total),
    }


@router.get("/contacts/{contact_id}/holdings")
def contact_holdings(contact_id: str, me: Me):
    _contact_or_404(contact_id, me)
    return _holdings_payload(p3.list_holdings(contact_ids=[contact_id]))


@router.get("/households/{household_id}/aum")
def household_aum(household_id: str, me: Me):
    """Household AUM roll-up (units × latest AMFI NAV) with per-contact positions and the Direct-plan flag."""
    _household_or_403(household_id, me)
    rows = p3.list_holdings(household_id=household_id)
    payload = _holdings_payload(rows)
    names = {c["id"]: c for c in (p3.get_contact(i) for i in p3.contact_ids_for_household(household_id)) if c}
    payload["holdings"] = [{**h, "contact_name": (names.get(h["contact_id"]) or {}).get("name")} for h in payload["holdings"]]
    payload["direct_plan_holdings"] = [h for h in payload["holdings"] if h["is_direct"]]
    payload["has_direct_plan"] = bool(payload["direct_plan_holdings"])
    return payload


class HoldingIn(BaseModel):
    contact_id: str
    folio: str = Field(min_length=1, max_length=40)
    scheme_code: str = Field(min_length=1, max_length=32)
    scheme_name: str | None = Field(default=None, max_length=255)
    units: float = Field(gt=0)
    cost: float | None = Field(default=None, ge=0)
    cost_paise: int = Field(default=0, ge=0)
    as_of: str | None = None
    source: str = Field(default="manual", max_length=40)


@router.post("/holdings")
def create_holding(body: HoldingIn, me: Me):
    """Add or update a holding position directly from the CRM."""
    _contact_or_404(body.contact_id, me)
    as_of = _iso_date(body.as_of, "as_of") or today_ist()
    if as_of > today_ist():
        raise HTTPException(422, "as_of cannot be in the future")
    cost_paise = round(float(body.cost) * 100) if body.cost is not None else body.cost_paise
    scheme_name = body.scheme_name
    if not scheme_name:
        navs = p3.latest_navs([body.scheme_code])
        if body.scheme_code in navs:
            scheme_name = navs[body.scheme_code].get("name")
    row = {
        "contact_id": body.contact_id,
        "folio": body.folio.strip(),
        "scheme_code": body.scheme_code.strip(),
        "scheme_name": scheme_name.strip() if scheme_name else None,
        "units": float(body.units),
        "cost_paise": cost_paise,
        "as_of": as_of,
        "source": body.source,
    }
    created, updated = p3.upsert_holdings([row], me["id"])
    return {"status": "ok", "created": created, "updated": updated, "holding": row}


@router.delete("/holdings/{holding_id}")
def delete_holding(holding_id: str, me: Me):
    """Delete a holding position."""
    holding = p3.get_holding(holding_id)
    if not holding:
        raise HTTPException(404, "Holding not found")
    _contact_or_404(holding["contact_id"], me)
    p3.delete_holding(holding_id, me["id"])
    return {"status": "ok", "deleted": True}


class HoldingsImport(BaseModel):
    csv_text: str = Field(max_length=6_000_000)
    as_of: str | None = None  # default for rows with no date column; YYYY-MM-DD
    source: str = Field("cas", max_length=40)
    dry_run: bool = False


_HOLDING_ALIASES = {
    "folio": ("folio_no", "folio_number", "folio_num"),
    "scheme_code": ("amfi_code", "amfi", "code", "scheme_amfi_code", "schemecode"),
    "scheme_name": ("scheme", "fund", "fund_name", "scheme_description"),
    "units": ("closing_units", "balance_units", "closing_balance", "unit_balance", "closing_unit_balance"),
    "cost": ("cost_value", "invested", "invested_amount", "cost_of_investment", "amount_invested", "purchase_cost"),
    "as_of": ("date", "nav_date", "valuation_date", "statement_date"),
    "pan": ("pan_number", "pan_no"),
    "mobile": ("phone", "mobile_no", "mobile_number"),
    "email": ("email_id", "email_address"),
    "investor_name": ("name", "investor", "holder_name", "first_holder"),
    "contact_id": (),
}


def _digits10(v: str | None) -> str:
    d = re.sub(r"\D", "", v or "")
    return d[-10:] if len(d) >= 10 else d


def _name_key(v: str | None) -> str:
    return re.sub(r"\s+", " ", (v or "").strip().lower())


class _Matcher:
    """Maps a registrar row to one contact in the importer's own book: contact id, PAN last 4, mobile, email, name."""

    def __init__(self, me: dict) -> None:
        big = Page(limit=100_000)
        self.contacts = guard(extras.list_contacts, _viewer(me), big)
        self.by_id = {c["id"]: c for c in self.contacts}
        pans: dict[str, str] = {}
        if get_crm_repository().table_exists("kyc_records"):
            from sqlalchemy import text

            with _session() as s:
                pans = {cid: (p or "").upper() for cid, p in s.execute(text("SELECT customer_id, pan_last4 FROM kyc_records")).all()}
        self.pan = {c["id"]: pans.get(c["customer_id"], "") for c in self.contacts}

    def match(self, row: dict[str, str]) -> tuple[dict | None, str | None]:
        cid = row.get("contact_id")
        if cid:
            c = self.by_id.get(cid)
            return (c, None) if c else (None, "contact_id is not in your book")
        name = _name_key(row.get("investor_name"))
        pan = (row.get("pan") or "").strip().upper()[-4:]
        if len(pan) == 4:
            hits = [c for c in self.contacts if self.pan.get(c["id"]) == pan]
            if len(hits) > 1 and name:
                hits = [c for c in hits if _name_key(c["name"]) == name]
            if len(hits) == 1:
                return hits[0], None
            if len(hits) > 1:
                return None, "PAN matches more than one contact; add the investor name"
        mob = _digits10(row.get("mobile"))
        if len(mob) == 10:
            hits = [c for c in self.contacts if _digits10(c["mobile"]) == mob]
            if len(hits) == 1:
                return hits[0], None
        em = (row.get("email") or "").strip().lower()
        if em:
            hits = [c for c in self.contacts if (c["email"] or "").lower() == em]
            if len(hits) == 1:
                return hits[0], None
        if name:
            hits = [c for c in self.contacts if _name_key(c["name"]) == name]
            if len(hits) == 1:
                return hits[0], None
            if len(hits) > 1:
                return None, "name matches more than one contact; add PAN or mobile"
        return None, "no matching contact in your book"


@router.post("/holdings/import")
def import_holdings(body: HoldingsImport, me: Me):
    """Import a CAMS/KFin CAS holdings CSV: positions are matched to contacts and upserted by (contact, folio,
    scheme). Rows that cannot be matched or parsed are reported, never silently dropped."""
    default_as_of = _iso_date(body.as_of, "as_of") or today_ist()
    if default_as_of > today_ist():
        raise HTTPException(422, "as_of cannot be in the future")
    try:
        rows = read_csv(body.csv_text, _HOLDING_ALIASES, ("folio", "scheme_code", "units"))
    except CsvError as e:
        raise HTTPException(422, str(e)) from e
    matcher = _Matcher(me)
    good: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for line, r in rows:
        try:
            units = parse_decimal(r.get("units"))
            cost = parse_decimal(r.get("cost"))
            if not r.get("folio") or not r.get("scheme_code"):
                raise ValueError("folio and scheme_code are required")
            if units is None or units <= 0:
                raise ValueError("units must be greater than zero")
            if cost is not None and cost < 0:
                raise ValueError("cost cannot be negative")
            as_of = parse_date(r["as_of"]) if r.get("as_of") else default_as_of
            if as_of > today_ist():
                raise ValueError("date is in the future")
        except ValueError as e:
            skipped.append({"row": line, "reason": str(e)})
            continue
        contact, why = matcher.match(r)
        if not contact:
            skipped.append({"row": line, "reason": why, "folio": r["folio"]})
            continue
        good.append({
            "contact_id": contact["id"], "folio": r["folio"], "scheme_code": r["scheme_code"], "scheme_name": r.get("scheme_name") or None,
            "units": float(units), "cost_paise": to_paise(cost) if cost is not None else 0, "as_of": as_of, "source": body.source,
        })
    navs = p3.latest_navs([g["scheme_code"] for g in good])
    for g in good:
        if not g["scheme_name"] and g["scheme_code"] in navs:
            g["scheme_name"] = navs[g["scheme_code"]]["name"]
    created = updated = 0
    if not body.dry_run and good:
        created, updated = p3.upsert_holdings(good, me["id"])
    return {
        "dry_run": body.dry_run, "rows": len(rows), "created": created, "updated": updated,
        "matched_rows": len(good), "skipped": skipped, "contacts": len({g["contact_id"] for g in good}),
        "unvalued_schemes": sorted({g["scheme_code"] for g in good if g["scheme_code"] not in navs}),
        "aum_paise": sum(round(g["units"] * float(navs[g["scheme_code"]]["nav"]) * 100) for g in good if g["scheme_code"] in navs),
    }


@router.post("/holdings/upload")
async def upload_holdings(
    file: UploadFile = File(...),
    password: str = Form(""),
    contact_id: str | None = Form(None),
    as_of: str | None = Form(None),
    dry_run: bool = Form(False),
    source: str = Form("upload"),
    me: Me = None,
):
    """Upload a CAS PDF, Excel (.xlsx/.xls), or CSV file to import holdings."""
    default_as_of = _iso_date(as_of, "as_of") or today_ist()
    if default_as_of > today_ist():
        raise HTTPException(422, "as_of cannot be in the future")

    if contact_id:
        _contact_or_404(contact_id, me)

    filename = (file.filename or "").lower()
    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Uploaded file is empty.")

    matcher = _Matcher(me)
    good: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    if filename.endswith(".pdf"):
        from app.engine import cas

        try:
            parsed_cas = cas.parse_cas_pdf_bytes(contents, password=password)
        except cas.CASValidationError as e:
            raise HTTPException(400, str(e)) from e
        except cas.CASPasswordError as e:
            raise HTTPException(400, str(e)) from e
        except cas.CASParsingError as e:
            raise HTTPException(422, str(e)) from e
        except Exception as e:
            raise HTTPException(422, f"Failed to parse PDF statement: {e}") from e

        holdings_list = parsed_cas.get("holdings", [])
        if not holdings_list:
            raise HTTPException(422, "No holdings found in the uploaded CAS PDF.")

        matched_contact = None
        if contact_id:
            matched_contact = p3.get_contact(contact_id)
        else:
            investor_info = {
                "name": parsed_cas.get("investor_name"),
                "email": parsed_cas.get("email"),
                "pan": parsed_cas.get("pan"),
            }
            c, _ = matcher.match(investor_info)
            if c:
                matched_contact = c

        for idx, h in enumerate(holdings_list, start=1):
            folio_no = str(h.get("folio") or "").strip()
            scheme_cd = str(h.get("scheme_code") or h.get("isin") or "").strip()
            units_val = float(h.get("units") or 0)
            if not folio_no or not scheme_cd or units_val <= 0:
                skipped.append({"row": idx, "reason": "Missing folio, scheme_code, or valid units", "folio": folio_no})
                continue

            target_c = matched_contact
            if not target_c:
                c, why = matcher.match({"folio": folio_no, "scheme_code": scheme_cd, "name": parsed_cas.get("investor_name"), "email": parsed_cas.get("email")})
                if not c:
                    skipped.append({"row": idx, "reason": why or "no matching contact", "folio": folio_no})
                    continue
                target_c = c

            cost_val = float(h.get("invested_value") or 0)
            h_as_of = h.get("valuation_date") or default_as_of

            good.append({
                "contact_id": target_c["id"],
                "folio": folio_no,
                "scheme_code": scheme_cd,
                "scheme_name": h.get("scheme_name") or h.get("scheme") or None,
                "units": units_val,
                "cost_paise": round(cost_val * 100),
                "as_of": h_as_of,
                "source": "cas_pdf",
            })

    elif filename.endswith((".xlsx", ".xls")):
        import pandas as pd

        try:
            df = pd.read_excel(io.BytesIO(contents))
            csv_text = df.to_csv(index=False)
            rows = read_csv(csv_text, _HOLDING_ALIASES, ("folio", "scheme_code", "units"))
        except Exception as e:
            raise HTTPException(422, f"Failed to parse Excel file: {e}") from e

        for line, r in rows:
            try:
                units = parse_decimal(r.get("units"))
                cost = parse_decimal(r.get("cost"))
                if not r.get("folio") or not r.get("scheme_code"):
                    raise ValueError("folio and scheme_code are required")
                if units is None or units <= 0:
                    raise ValueError("units must be greater than zero")
                if cost is not None and cost < 0:
                    raise ValueError("cost cannot be negative")
                row_as_of = parse_date(r["as_of"]) if r.get("as_of") else default_as_of
                if row_as_of > today_ist():
                    raise ValueError("date is in the future")
            except ValueError as e:
                skipped.append({"row": line, "reason": str(e)})
                continue

            target_c = None
            if contact_id:
                target_c = p3.get_contact(contact_id)
            else:
                target_c, why = matcher.match(r)
                if not target_c:
                    skipped.append({"row": line, "reason": why, "folio": r["folio"]})
                    continue

            good.append({
                "contact_id": target_c["id"],
                "folio": r["folio"],
                "scheme_code": r["scheme_code"],
                "scheme_name": r.get("scheme_name") or None,
                "units": float(units),
                "cost_paise": to_paise(cost) if cost is not None else 0,
                "as_of": row_as_of,
                "source": "excel",
            })

    elif filename.endswith(".csv"):
        try:
            csv_text = contents.decode("utf-8", errors="replace")
            rows = read_csv(csv_text, _HOLDING_ALIASES, ("folio", "scheme_code", "units"))
        except Exception as e:
            raise HTTPException(422, f"Failed to parse CSV file: {e}") from e

        for line, r in rows:
            try:
                units = parse_decimal(r.get("units"))
                cost = parse_decimal(r.get("cost"))
                if not r.get("folio") or not r.get("scheme_code"):
                    raise ValueError("folio and scheme_code are required")
                if units is None or units <= 0:
                    raise ValueError("units must be greater than zero")
                if cost is not None and cost < 0:
                    raise ValueError("cost cannot be negative")
                row_as_of = parse_date(r["as_of"]) if r.get("as_of") else default_as_of
                if row_as_of > today_ist():
                    raise ValueError("date is in the future")
            except ValueError as e:
                skipped.append({"row": line, "reason": str(e)})
                continue

            target_c = None
            if contact_id:
                target_c = p3.get_contact(contact_id)
            else:
                target_c, why = matcher.match(r)
                if not target_c:
                    skipped.append({"row": line, "reason": why, "folio": r["folio"]})
                    continue

            good.append({
                "contact_id": target_c["id"],
                "folio": r["folio"],
                "scheme_code": r["scheme_code"],
                "scheme_name": r.get("scheme_name") or None,
                "units": float(units),
                "cost_paise": to_paise(cost) if cost is not None else 0,
                "as_of": row_as_of,
                "source": "csv",
            })
    else:
        raise HTTPException(400, "Supported formats: .pdf (CAS), .xlsx/.xls (Excel), .csv")

    navs = p3.latest_navs([g["scheme_code"] for g in good])
    for g in good:
        if not g["scheme_name"] and g["scheme_code"] in navs:
            g["scheme_name"] = navs[g["scheme_code"]]["name"]

    created = updated = 0
    if not dry_run and good:
        created, updated = p3.upsert_holdings(good, me["id"])

    return {
        "filename": file.filename,
        "matched_rows": len(good),
        "created": created,
        "updated": updated,
        "contacts": len({g["contact_id"] for g in good}),
        "skipped": skipped,
        "unvalued_schemes": sorted({g["scheme_code"] for g in good if g["scheme_code"] not in navs}),
        "aum_paise": sum(round(g["units"] * float(navs[g["scheme_code"]]["nav"]) * 100) for g in good if g["scheme_code"] in navs),
    }


# ---------------------------------------------------------------------------
# SIP / STP / SWP
# ---------------------------------------------------------------------------
class SipIn(BaseModel):
    contact_id: str
    scheme_code: str = Field(min_length=1, max_length=32)
    scheme_name: str | None = None
    type: str = "sip"
    amount_paise: int = Field(gt=0)
    day: int = Field(ge=1, le=28)
    start_date: str
    end_date: str | None = None
    mandate_id: str | None = None
    status: str = "active"


class SipPatch(BaseModel):
    scheme_code: str | None = Field(None, min_length=1, max_length=32)
    scheme_name: str | None = None
    type: str | None = None
    amount_paise: int | None = Field(None, gt=0)
    day: int | None = Field(None, ge=1, le=28)
    start_date: str | None = None
    end_date: str | None = None
    mandate_id: str | None = None
    status: str | None = None


def _check_mandate(mandate_id: str | None, customer_id: str) -> None:
    if not mandate_id:
        return
    with _session() as s:
        from sqlalchemy import text

        try:
            owner = s.execute(text("SELECT customer_id FROM mandates WHERE id = :i"), {"i": mandate_id}).scalar()
        except Exception:
            owner = None
    if owner is None:
        raise HTTPException(422, "Mandate not found.")
    if owner != customer_id:
        raise HTTPException(422, "That mandate belongs to a different client.")


def _validate_sip(m: dict, customer_id: str) -> None:
    _check_enum(m["type"], p3.SIP_TYPES, "type")
    _check_enum(m["status"], p3.SIP_STATUSES, "status")
    start, end = _iso_date(m["start_date"], "start_date"), _iso_date(m.get("end_date"), "end_date")
    if end and start and end < start:
        raise HTTPException(422, "end_date cannot be before start_date")
    _check_mandate(m.get("mandate_id"), customer_id)


@router.post("/sips", status_code=201)
def create_sip(body: SipIn, me: Me):
    c = _contact_or_404(body.contact_id, me)
    data = body.model_dump()
    _validate_sip(data, c["customer_id"])
    if not data.get("scheme_name"):
        data["scheme_name"] = (p3.latest_navs([data["scheme_code"]]).get(data["scheme_code"]) or {}).get("name")
    return p3.create_sip(me["id"], **data)


@router.get("/sips")
def list_sips(
    me: Me, response: Response, page: PageParams, contact_id: str | None = Query(None), household_id: str | None = Query(None),
    status: str | None = Query(None),
):
    _check_enum(status, p3.SIP_STATUSES, "status")
    rows = guard(p3.list_sips, contact_id=contact_id, household_id=household_id, status=status, viewer_rm=_viewer(me), page=page)
    send_total(response, page)
    return rows


@router.get("/sips/book")
def sip_book(me: Me):
    """Active SIP book: count and monthly ₹ (paise)."""
    return p3.sip_book(_viewer(me))


@router.get("/sips/alerts")
def sip_alerts(me: Me, days: int = Query(30, ge=1, le=120)):
    return p3.sip_alerts(_viewer(me), days)


@router.post("/sips/generate-alerts")
def generate_sip_alerts(me: Me, days: int = Query(30, ge=1, le=120)):
    """Turn SIP-ending, bounce and mandate-expiry alerts into follow-up tasks for the household's RM. Idempotent."""
    repo = get_crm_repository()
    created = 0
    alerts = p3.sip_alerts(_viewer(me), days)
    for a in alerts:
        if repo.open_followup_exists(source_ref=a["source_ref"]):
            continue
        repo.create_activity(
            kind="followup", subject=a["message"], body=f"{a['contact_name']} · generated from the SIP book ({a['kind'].replace('_', ' ')}).",
            household_id=a["household_id"], customer_id=a["customer_id"], due_at=a["due"],
            assigned_rm_id=a["rm_id"] or (me["id"] if me["role"] == "rm" else None), source_ref=a["source_ref"], actor_id=me["id"],
        )
        created += 1
    return {"created": created, "alerts": len(alerts)}


@router.get("/sips/{sip_id}")
def get_sip(sip_id: str, me: Me):
    sip = p3.get_sip(sip_id)
    if not sip:
        raise HTTPException(404, "SIP not found")
    _contact_or_404(sip["contact_id"], me)
    return sip


@router.patch("/sips/{sip_id}")
def update_sip(sip_id: str, body: SipPatch, me: Me):
    sip = p3.get_sip(sip_id)
    if not sip:
        raise HTTPException(404, "SIP not found")
    c = _contact_or_404(sip["contact_id"], me)
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    _validate_sip({**sip, **fields}, c["customer_id"])
    return p3.update_sip(sip_id, fields, me["id"])


@router.post("/sips/{sip_id}/bounce")
def record_bounce(sip_id: str, me: Me):
    """Record a failed instalment: the SIP is marked bounced and a follow-up task is raised on the next alert run."""
    sip = p3.get_sip(sip_id)
    if not sip:
        raise HTTPException(404, "SIP not found")
    _contact_or_404(sip["contact_id"], me)
    return p3.update_sip(sip_id, {"bounce_count": (sip["bounce_count"] or 0) + 1, "last_bounce_at": today_ist(), "status": "bounced"}, me["id"])


class ValidUntil(BaseModel):
    valid_until: str | None = None


@router.put("/mandates/{mandate_id}/valid-until")
def set_mandate_valid_until(mandate_id: str, body: ValidUntil, me: Me):
    """Mandate expiry date (drives the 'mandate expiring' SIP alert)."""
    from sqlalchemy import text

    from app.api.crm_products import _ensure_schema

    _ensure_schema()
    vu = _iso_date(body.valid_until, "valid_until")
    with _session() as s:
        row = s.execute(text("SELECT customer_id, valid_until FROM mandates WHERE id = :i"), {"i": mandate_id}).first()
        if not row:
            raise HTTPException(404, "Mandate not found.")
        cust = p3.contact_by_customer(row[0])
        if not unscoped(me) and (not cust or cust["rm_id"] not in me["_team"]):
            raise HTTPException(403, "You do not have permission to access this resource.")
        s.execute(text("UPDATE mandates SET valid_until = :v, updated_by = :u, updated_at = :t WHERE id = :i"), {"v": vu, "u": me["id"], "t": datetime.now(IST).isoformat(), "i": mandate_id})
    get_crm_repository().record_audit("mandate", mandate_id, me["id"], {"valid_until": row[1]}, {"valid_until": vu})
    return {"id": mandate_id, "valid_until": vu}


# ---------------------------------------------------------------------------
# Trail commission
# ---------------------------------------------------------------------------
class CommissionImport(BaseModel):
    csv_text: str = Field(max_length=6_000_000)
    source: str | None = Field(None, max_length=80)
    dry_run: bool = False


_COMMISSION_ALIASES = {
    "folio": ("folio_no", "folio_number"),
    "scheme_code": ("amfi_code", "amfi", "code", "scheme_amfi_code"),
    "month": ("period", "brokerage_month", "for_month"),
    "amount": ("brokerage", "trail", "commission", "trail_amount", "brokerage_amount", "amount_inr"),
}


@router.post("/commissions/import")
def import_commissions(body: CommissionImport, me: Me):
    """Upload a monthly brokerage CSV (folio, scheme_code, month, amount in ₹). Re-uploading a month replaces
    those lines. Lines whose folio and scheme are not in the holdings are kept but reported as unmatched."""
    if me["role"] != "admin":
        raise HTTPException(403, "Only an admin can upload brokerage files.")
    try:
        rows = read_csv(body.csv_text, _COMMISSION_ALIASES, ("folio", "scheme_code", "month", "amount"))
    except CsvError as e:
        raise HTTPException(422, str(e)) from e
    parsed: dict[tuple[str, str, str], dict[str, Any]] = {}
    skipped: list[dict[str, Any]] = []
    for line, r in rows:
        try:
            if not r.get("folio") or not r.get("scheme_code"):
                raise ValueError("folio and scheme_code are required")
            amount = parse_decimal(r.get("amount"))
            if amount is None:
                raise ValueError("amount is required")
            month = parse_month(r["month"])
        except ValueError as e:
            skipped.append({"row": line, "reason": str(e)})
            continue
        key = (r["folio"], r["scheme_code"], month)
        prev = parsed.get(key)
        # two lines for the same folio/scheme/month in one file add up (brokerage can come in several lines)
        parsed[key] = {"folio": key[0], "scheme_code": key[1], "month": month, "amount_paise": to_paise(amount) + (prev["amount_paise"] if prev else 0), "source": body.source}
    pos = p3.resolve_positions([(k[0], k[1]) for k in parsed])
    lines = [{**v, **(pos.get((v["folio"], v["scheme_code"])) or {})} for v in parsed.values()]
    unmatched = [ln for ln in lines if not ln.get("household_id")]
    created = updated = 0
    if not body.dry_run and lines:
        created, updated = p3.upsert_commissions(lines, me["id"])
    return {
        "dry_run": body.dry_run, "rows": len(rows), "lines": len(lines), "created": created, "updated": updated, "skipped": skipped,
        "unmatched": [{"folio": u["folio"], "scheme_code": u["scheme_code"], "month": u["month"], "amount_paise": u["amount_paise"]} for u in unmatched],
        "total_paise": sum(ln["amount_paise"] for ln in lines),
    }


@router.get("/commissions/summary")
def commission_summary(me: Me, month_from: str | None = Query(None, alias="from"), month_to: str | None = Query(None, alias="to")):
    """Trail by household, RM and month (your book only, unless you are admin or compliance)."""
    for m in (month_from, month_to):
        if m and not re.fullmatch(r"\d{4}-\d{2}", m):
            raise HTTPException(422, "from/to must be YYYY-MM")
    out = p3.commission_summary(_viewer(me), month_from, month_to)
    names = get_crm_repository().customer_names([r["rm_id"] for r in out["by_rm"] if r["rm_id"] != "unassigned"])
    out["by_rm"] = [{**r, "rm_name": names.get(r["rm_id"])} for r in out["by_rm"]]
    return out


# ---------------------------------------------------------------------------
# Suitability
# ---------------------------------------------------------------------------
class AssessIn(BaseModel):
    customer_id: str
    answers: dict[str, int]
    notes: str | None = None


@router.get("/suitability/questionnaire")
def suitability_questionnaire(me: Me):
    from app.config import load_questionnaire

    return {**load_questionnaire(), "riskometer_labels": p3.RISKOMETER_LABELS, "band_limits": p3.BAND_MAX_RISKOMETER}


@router.post("/suitability/assess", status_code=201)
def assess_suitability(body: AssessIn, me: Me):
    """Score the risk questionnaire, derive the risk band and the highest riskometer it allows, and set the review date."""
    import json

    from app.api.crm_products import _ensure_schema, _store
    from app.config import load_questionnaire
    from app.engine.profiling import band_for, risk_tolerance

    _ensure_schema()  # W2 tables (+ the Phase 3 columns on suitability_records) are created lazily
    cust = p3.contact_by_customer(body.customer_id)
    if not cust:
        raise HTTPException(404, "Customer not found")
    _contact_or_404(cust["id"], me)
    questions = load_questionnaire()["questions"]
    if set(body.answers) != {q["id"] for q in questions}:
        raise HTTPException(422, "Answer every question: " + ", ".join(sorted(q["id"] for q in questions)))
    for q in questions:  # each answer is the index of the chosen option
        if not 0 <= body.answers[q["id"]] < len(q["options"]):
            raise HTTPException(422, f"Question {q['id']}: choose one of the {len(q['options'])} options.")
    score = risk_tolerance(body.answers)
    band = band_for(score)["name"]
    review_due = (datetime.now(IST).date() + timedelta(days=365)).isoformat()
    store = _store()
    rec = store.create_suitability({
        "customer_id": body.customer_id, "risk_band": band, "recorded_by_rm_id": me["id"], "financial_status": None,
        "investment_experience": None, "objectives": body.notes, "score": score, "answers": json.dumps(body.answers),
        "review_due": review_due, "max_riskometer": p3.BAND_MAX_RISKOMETER[band],
    })
    get_crm_repository().record_audit("suitability", rec["id"], me["id"], None, rec)
    return {**rec, "max_riskometer_label": p3.RISKOMETER_LABELS[p3.BAND_MAX_RISKOMETER[band]]}


@router.get("/suitability/status")
def suitability_status(me: Me, customer_id: str = Query(...)):
    cust = p3.contact_by_customer(customer_id)
    if not cust:
        raise HTTPException(404, "Customer not found")
    _contact_or_404(cust["id"], me)
    a = p3.latest_suitability(customer_id)
    if a and a["max_riskometer"]:
        a["max_riskometer_label"] = p3.RISKOMETER_LABELS.get(a["max_riskometer"])
    return {"assessment": a}


class RiskCheckIn(BaseModel):
    customer_id: str | None = None
    riskometer: int | None = Field(None, ge=1, le=6)
    scheme_code: str | None = None


@router.post("/suitability/check")
def suitability_check(body: RiskCheckIn, me: Me):
    """What would happen if this product were proposed to this client (ok / warn / block)."""
    rk = body.riskometer
    if rk is None and body.scheme_code:
        info = p3.latest_navs([body.scheme_code]).get(body.scheme_code)
        rk = p3.riskometer_for_category((info or {}).get("category"))
    if body.customer_id:
        cust = p3.contact_by_customer(body.customer_id)
        if cust:
            _contact_or_404(cust["id"], me)
    return {"riskometer": rk, **p3.suitability_check(rk, body.customer_id)}


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------
class Segment(BaseModel):
    aum_min: float | None = Field(None, ge=0)  # ₹
    aum_max: float | None = Field(None, ge=0)
    tier: list[str] | None = None
    tax_status: list[str] | None = None
    relation: list[str] | None = None
    sip_status: str | None = None
    has_direct_plan: bool | None = None


def _segment_dict(seg: Segment) -> dict[str, Any]:
    d = seg.model_dump(exclude_none=True)
    for t in d.get("tier", []):
        _check_enum(t, tuple(n for n, _ in p3.TIERS), "tier")
    for t in d.get("tax_status", []):
        _check_enum(t, p3.TAX_STATUSES, "tax_status")
    if d.get("sip_status"):
        _check_enum(d["sip_status"], ("active", "none", "ended"), "sip_status")
    if d.get("aum_min") is not None and d.get("aum_max") is not None and d["aum_min"] > d["aum_max"]:
        raise HTTPException(422, "aum_min cannot be above aum_max")
    return d


class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    segment: Segment = Field(default_factory=Segment)


class CampaignPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    status: str | None = None
    segment: Segment | None = None


def _campaign_or_404(campaign_id: str, me: dict) -> dict:
    c = p3.get_campaign(campaign_id)
    if not c:
        raise HTTPException(404, "Campaign not found")
    if not unscoped(me) and c["owner_id"] not in me["_team"]:
        raise HTTPException(403, "You do not have permission to access this resource.")
    return c


@router.get("/campaigns")
def list_campaigns(me: Me, response: Response, page: PageParams):
    rows = guard(p3.list_campaigns, _viewer(me), page)
    send_total(response, page)
    return rows


@router.post("/campaigns", status_code=201)
def create_campaign(body: CampaignIn, me: Me):
    name = _clean_str(body.name, "name")
    assert name is not None
    return guard(p3.create_campaign, name, body.description, _segment_dict(body.segment), me["id"], me["id"])


@router.post("/campaigns/preview")
def preview_campaign(segment: Segment, me: Me):
    """Who a segment would target, without saving anything."""
    rows = p3.segment_contacts(_segment_dict(segment), _viewer(me))
    return {"count": len(rows), "households": len({r["household_id"] for r in rows}), "sample": rows[:20]}


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, me: Me):
    c = _campaign_or_404(campaign_id, me)
    members = p3.list_campaign_members(campaign_id, _viewer(me))
    counts: dict[str, int] = {}
    for m in members:
        counts[m["status"]] = counts.get(m["status"], 0) + 1
    return {**c, "members": members, "member_counts": counts, "member_total": len(members)}


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: CampaignPatch, me: Me):
    _campaign_or_404(campaign_id, me)
    fields: dict[str, Any] = {}
    if "name" in body.model_fields_set and body.name is not None:
        fields["name"] = _clean_str(body.name, "name")
    if "description" in body.model_fields_set:
        fields["description"] = body.description
    if "status" in body.model_fields_set:
        _check_enum(body.status, p3.CAMPAIGN_STATUSES, "status")
        fields["status"] = body.status
    if "segment" in body.model_fields_set and body.segment is not None:
        fields["segment"] = _segment_dict(body.segment)
    return p3.update_campaign(campaign_id, fields, me["id"])


@router.post("/campaigns/{campaign_id}/populate")
def populate_campaign(campaign_id: str, me: Me):
    """Add everyone in your book who matches the campaign's segment (existing members are kept)."""
    c = _campaign_or_404(campaign_id, me)
    rows = p3.segment_contacts(c["segment"], _viewer(me))
    added = p3.add_campaign_members(campaign_id, [r["contact_id"] for r in rows])
    return {"matched": len(rows), "added": added}


class MemberPatch(BaseModel):
    status: str
    notes: str | None = None


@router.patch("/campaigns/{campaign_id}/members/{contact_id}")
def update_campaign_member(campaign_id: str, contact_id: str, body: MemberPatch, me: Me):
    _campaign_or_404(campaign_id, me)
    _contact_or_404(contact_id, me)
    _check_enum(body.status, p3.MEMBER_STATUSES, "status")
    row = p3.update_campaign_member(campaign_id, contact_id, body.status, body.notes)
    if not row:
        raise HTTPException(404, "That contact is not in this campaign")
    return row


# ---------------------------------------------------------------------------
# RM teams
# ---------------------------------------------------------------------------
class TeamIn(BaseModel):
    lead_id: str | None = None


@router.get("/teams")
def teams(me: Me):
    """Reporting lines. Admins and compliance see all; an RM sees their own team."""
    links = p3.list_team_links()
    if not unscoped(me):
        links = [lk for lk in links if lk["rm_id"] in me["_team"] or lk["lead_id"] in me["_team"]]
    return {"links": links, "my_team": me["_team"]}


@router.put("/teams/{rm_id}")
def set_team(rm_id: str, body: TeamIn, me: Me):
    if me["role"] != "admin":
        raise HTTPException(403, "Only an admin can change reporting lines.")
    _require_rm_account(rm_id)
    if body.lead_id is not None:
        _require_rm_account(body.lead_id)
    guard(p3.set_team_lead, rm_id, body.lead_id)
    return {"rm_id": rm_id, "lead_id": body.lead_id}
