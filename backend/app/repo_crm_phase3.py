"""CRM Phase 3 persistence: contacts, holdings + AUM, SIP/STP/SWP schedules, trail commissions, campaigns and
RM teams. Portable SQLAlchemy (SQLite and Postgres); every read that is RM-scoped takes the viewing RM or
team (``None`` = unscoped admin/compliance) and applies it inside the query.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import bindparam, delete, func, select, text

from app.models.crm_core import ContactModel, HouseholdMemberModel, HouseholdModel
from app.models.crm_phase3 import (
    CampaignMemberModel,
    CampaignModel,
    CommissionModel,
    HoldingModel,
    RmTeamModel,
    SipScheduleModel,
)
from app.repo_crm_core import (
    IST,
    CrmCoreError,
    Page,
    _audit,
    _create,
    _page,
    _row,
    _session,
    _update,
    _utcnow,
    rm_ids,
    today_ist,
)

# ---------------------------------------------------------------------------
# Constants shared with the API and the UI
# ---------------------------------------------------------------------------
TAX_STATUSES = ("resident", "nri", "oci")
RELATIONS = ("self", "spouse", "child", "parent", "sibling", "dependent", "other")
FATCA_CRS = ("not_collected", "self_certified", "resident_india_only", "us_person", "other_foreign_tax_resident")
SIP_TYPES = ("sip", "stp", "swp")
SIP_STATUSES = ("active", "paused", "ended", "bounced")
CAMPAIGN_STATUSES = ("draft", "active", "completed")
MEMBER_STATUSES = ("targeted", "contacted", "responded", "converted", "declined")

# household tier by AUM (paise)
TIERS = (("platinum", 1_00_00_000 * 100), ("gold", 25_00_000 * 100), ("silver", 5_00_000 * 100), ("standard", 0))

RISKOMETER_LABELS = {1: "Low", 2: "Low to Moderate", 3: "Moderate", 4: "Moderately High", 5: "High", 6: "Very High"}
# highest riskometer a risk band may be sold, per the existing profiling bands
BAND_MAX_RISKOMETER = {
    "Conservative": 2, "Moderately Conservative": 3, "Moderate": 4, "Moderately Aggressive": 5, "Aggressive": 6,
}


def tier_for(aum_paise: int) -> str:
    return next(name for name, floor in TIERS if aum_paise >= floor)


def riskometer_for_category(category: str | None) -> int | None:
    """Category-typical SEBI riskometer (1 Low … 6 Very High). A scheme's own SID riskometer should be passed
    explicitly when known; this is only the default."""
    c = (category or "").lower()
    if not c:
        return None
    if any(k in c for k in ("overnight", "liquid")):
        return 1
    if any(k in c for k in ("money market", "ultra short", "low duration", "short duration", "banking and psu", "floater")):
        return 2
    if any(k in c for k in ("corporate bond", "gilt", "dynamic bond", "medium duration", "conservative hybrid", "arbitrage")):
        return 3
    if any(k in c for k in ("credit risk", "long duration", "medium to long")):
        return 4
    if any(k in c for k in ("small cap", "sectoral", "thematic", "micro")):
        return 6
    if any(k in c for k in ("equity", "elss", "index", "etf", "aggressive hybrid", "balanced", "multi cap", "flexi", "large", "mid cap", "value", "focused", "dividend yield", "contra")):
        return 5
    if "hybrid" in c:
        return 4
    return 4


# ---------------------------------------------------------------------------
# NAV lookup (mf_schemes lives in the backoffice store)
# ---------------------------------------------------------------------------
_NAV_REPO: Any = None


def latest_navs(codes: list[str]) -> dict[str, dict[str, Any]]:
    """AMFI NAV per scheme code. Missing or unreadable data yields no entry; callers must treat that as
    'not valued', never as zero."""
    global _NAV_REPO
    codes = sorted({c for c in codes if c})
    if not codes:
        return {}
    try:
        if _NAV_REPO is None:
            from app.backoffice.repository import BackofficeRepository

            _NAV_REPO = BackofficeRepository()
        rows = _NAV_REPO.get_mf_schemes_by_codes(codes)
    except Exception:
        return {}
    return {
        str(r["scheme_code"]): {
            "nav": r.get("latest_nav"), "nav_date": r.get("nav_date"), "plan": r.get("plan"),
            "category": r.get("category"), "name": r.get("scheme_name"),
        }
        for r in rows
        if r.get("latest_nav") is not None
    }


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------
def team_ids(rm_id: str) -> list[str]:
    """``rm_id`` plus everyone who reports to them, directly or indirectly (depth-limited, cycle-safe)."""
    seen = {rm_id}
    frontier = [rm_id]
    with _session() as s:
        for _ in range(6):
            if not frontier:
                break
            rows = s.scalars(select(RmTeamModel.rm_id).where(RmTeamModel.lead_id.in_(frontier))).all()
            frontier = [r for r in rows if r not in seen]
            seen.update(frontier)
    return sorted(seen)


def set_team_lead(rm_id: str, lead_id: str | None) -> None:
    with _session() as s:
        if lead_id is not None:
            if lead_id == rm_id:
                raise CrmCoreError("bad_team", "An RM cannot lead themselves.")
            # refuse cycles: the new lead must not already report (transitively) to rm_id
            cur, hops = lead_id, 0
            while cur and hops < 8:
                if cur == rm_id:
                    raise CrmCoreError("bad_team", "That would create a reporting loop.")
                cur = s.scalar(select(RmTeamModel.lead_id).where(RmTeamModel.rm_id == cur))
                hops += 1
        s.execute(delete(RmTeamModel).where(RmTeamModel.rm_id == rm_id))
        if lead_id is not None:
            s.add(RmTeamModel(rm_id=rm_id, lead_id=lead_id))


def list_team_links() -> list[dict[str, str]]:
    with _session() as s:
        return [{"rm_id": r.rm_id, "lead_id": r.lead_id} for r in s.scalars(select(RmTeamModel)).all()]


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------
def _age(dob: str | None, today: date | None = None) -> int | None:
    if not dob:
        return None
    try:
        d = date.fromisoformat(dob)
    except ValueError:
        return None
    t = today or datetime.now(IST).date()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day))


def _contact_view(row: dict, cust: Any, hh: Any) -> dict[str, Any]:
    age = _age(row.get("dob"))
    return {
        **row,
        "name": cust[0], "email": cust[1], "mobile": cust[2],
        "household_name": hh[0] if hh else None, "rm_id": hh[1] if hh else None,
        "age": age, "is_minor": age is not None and age < 18,
    }


def get_contact(contact_id: str) -> dict[str, Any] | None:
    with _session() as s:
        k = s.get(ContactModel, contact_id)
        if not k:
            return None
        cust = s.execute(text("SELECT name, email, mobile FROM customers WHERE id = :i"), {"i": k.customer_id}).first()
        hh = s.execute(select(HouseholdModel.name, HouseholdModel.rm_id).where(HouseholdModel.id == k.household_id)).first()
        return _contact_view(_row(k), cust or ("", None, None), hh)


def contact_by_customer(customer_id: str) -> dict[str, Any] | None:
    with _session() as s:
        contact_id = s.scalar(select(ContactModel.id).where(ContactModel.customer_id == customer_id))
    return get_contact(contact_id) if contact_id else None


def create_contact(
    *, name: str, email: str | None, mobile: str | None, household_id: str, relation: str, owner_rm_id: str | None,
    password_hash: str, actor_id: str | None, **fields: Any,
) -> dict[str, Any]:
    """Create the person, their customer record (no usable login) and household membership in one transaction.
    Email and mobile are optional; a clearly-marked placeholder fills whichever is missing."""
    role = {"self": "primary", "spouse": "spouse", "child": "child", "dependent": "dependent", "parent": "dependent"}.get(relation, "other")
    with _session() as s:
        if not s.get(HouseholdModel, household_id):
            raise CrmCoreError("household_not_found", "Household not found")
        if email and s.execute(text("SELECT 1 FROM customers WHERE email = :e"), {"e": email}).first():
            raise CrmCoreError("duplicate_email", "A customer with this email already exists.")
        if mobile and s.execute(text("SELECT 1 FROM customers WHERE mobile = :m"), {"m": mobile}).first():
            raise CrmCoreError("duplicate_mobile", "A customer with this mobile number already exists.")
        token = uuid.uuid4().hex
        customer_id = str(uuid.uuid4())
        s.execute(
            text(
                "INSERT INTO customers (id, name, email, mobile, password_hash, role, assigned_rm_id, is_staff, status, "
                "must_change_password, created_at) VALUES (:id, :name, :email, :mobile, :ph, 'customer', :rm, 0, 'active', 0, :now)"
            ),
            {
                "id": customer_id, "name": name,
                "email": email or f"no-email-{token[:12]}@placeholder.invalid",
                "mobile": mobile or f"0000{token[:8]}",
                "ph": password_hash, "rm": owner_rm_id, "now": _utcnow(),
            },
        )
        _create(s, HouseholdMemberModel, "household_member", actor_id, household_id=household_id, customer_id=customer_id, role=role)
        row = _create(s, ContactModel, "contact", actor_id, customer_id=customer_id, household_id=household_id, relation=relation, **fields)
    return get_contact(row["id"]) or {}


_CONTACT_FIELDS = {
    "relation", "dob", "guardian_contact_id", "tax_status", "country", "nre_bank", "nro_bank", "nominee_name",
    "nominee_relation", "nominee_pct", "fatca_crs", "kyc_expiry",
}


def update_contact(contact_id: str, fields: dict[str, Any], actor_id: str | None) -> dict[str, Any] | None:
    ident = {k: fields[k] for k in ("name", "email", "mobile") if k in fields}
    own = {k: v for k, v in fields.items() if k in _CONTACT_FIELDS}
    with _session() as s:
        k = s.get(ContactModel, contact_id)
        if not k:
            return None
        old_ident = dict(zip(("name", "email", "mobile"), s.execute(text("SELECT name, email, mobile FROM customers WHERE id = :i"), {"i": k.customer_id}).first() or (None, None, None)))
        for col, label in (("email", "email"), ("mobile", "mobile")):
            if ident.get(col) and ident[col] != old_ident.get(col) and s.execute(
                text(f"SELECT 1 FROM customers WHERE {col} = :v AND id <> :i"), {"v": ident[col], "i": k.customer_id}
            ).first():
                raise CrmCoreError(f"duplicate_{col}", f"A customer with this {label} already exists.")
        if ident:
            sets = ", ".join(f"{c} = :{c}" for c in ident)
            s.execute(text(f"UPDATE customers SET {sets} WHERE id = :i"), {**ident, "i": k.customer_id})
            _audit(s, "contact", contact_id, actor_id, old_ident, {**old_ident, **ident})
        if own:
            _update(s, ContactModel, "contact", contact_id, own, _CONTACT_FIELDS, actor_id)
    return get_contact(contact_id)


def contact_ids_for_household(household_id: str) -> list[str]:
    with _session() as s:
        return list(s.scalars(select(ContactModel.id).where(ContactModel.household_id == household_id)).all())


# ---------------------------------------------------------------------------
# Holdings + AUM
# ---------------------------------------------------------------------------
def upsert_holdings(rows: list[dict[str, Any]], actor_id: str | None) -> tuple[int, int]:
    """Insert or replace positions keyed on (contact, folio, scheme); returns (created, updated)."""
    created = updated = 0
    with _session() as s:
        for r in rows:
            cur = s.scalar(
                select(HoldingModel).where(
                    HoldingModel.contact_id == r["contact_id"], HoldingModel.folio == r["folio"],
                    HoldingModel.scheme_code == r["scheme_code"],
                )
            )
            if cur is None:
                _create(s, HoldingModel, "holding", actor_id, **r)
                created += 1
            else:
                _update(s, HoldingModel, "holding", cur.id, r, {"units", "cost_paise", "as_of", "scheme_name", "source"}, actor_id)
                updated += 1
    return created, updated


def list_holdings(
    *, contact_ids: list[str] | None = None, household_id: str | None = None, viewer_rm: Any = None,
    page: Page | None = None,
) -> list[dict[str, Any]]:
    with _session() as s:
        stmt = select(HoldingModel).order_by(HoldingModel.as_of.desc(), HoldingModel.scheme_name)
        if contact_ids is not None:
            stmt = stmt.where(HoldingModel.contact_id.in_(contact_ids or [""]))
        if household_id:
            stmt = stmt.where(HoldingModel.contact_id.in_(select(ContactModel.id).where(ContactModel.household_id == household_id)))
        if viewer_rm is not None:
            hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(rm_ids(viewer_rm)))
            stmt = stmt.where(HoldingModel.contact_id.in_(select(ContactModel.id).where(ContactModel.household_id.in_(hh))))
        return [_row(h) for h in _page(s, stmt, HoldingModel, page, ("scheme_name", "folio", "scheme_code"))]


def value_holdings(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add NAV, value and a Direct-plan flag. A position with no NAV is *unvalued*, not zero."""
    navs = latest_navs([r["scheme_code"] for r in rows])
    out = []
    for r in rows:
        n = navs.get(r["scheme_code"])
        value = round(r["units"] * float(n["nav"]) * 100) if n else None
        plan = (n or {}).get("plan") or ("Direct" if "direct" in (r.get("scheme_name") or "").lower() else None)
        out.append({
            **r, "nav": n["nav"] if n else None, "nav_date": n["nav_date"] if n else None, "value_paise": value,
            "plan": plan, "is_direct": (plan or "").lower() == "direct",
            "category": (n or {}).get("category"),
            "gain_paise": None if value is None else value - r["cost_paise"],
        })
    return out


def households_in_tier(viewer_rm: Any, tier: str) -> list[str]:
    """Ids of the households (in the viewer's book) whose AUM falls in ``tier``."""
    if tier not in {t for t, _ in TIERS}:
        raise CrmCoreError("bad_tier", f"tier must be one of: {', '.join(t for t, _ in TIERS)}")
    from app.repo_crm_core import get_crm_repository

    ids = [h["id"] for h in get_crm_repository().list_households(rm_id=viewer_rm)]
    aum = household_aum(ids)
    return [i for i in ids if aum.get(i, {}).get("tier", "standard") == tier]


def household_aum(household_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Per-household roll-up of valued holdings, with the Direct-plan flag the distributor must watch."""
    if not household_ids:
        return {}
    with _session() as s:
        rows = s.execute(
            select(HoldingModel, ContactModel.household_id)
            .join(ContactModel, ContactModel.id == HoldingModel.contact_id)
            .where(ContactModel.household_id.in_(household_ids))
        ).all()
        data = [({**_row(h)}, hh) for h, hh in rows]
    valued = value_holdings([d for d, _ in data])
    out: dict[str, dict[str, Any]] = {}
    for v, (_, hh) in zip(valued, data):
        agg = out.setdefault(hh, {"aum_paise": 0, "cost_paise": 0, "holdings": 0, "unvalued": 0, "direct_value_paise": 0, "direct_holdings": 0, "as_of": None})
        agg["holdings"] += 1
        agg["cost_paise"] += v["cost_paise"]
        if v["value_paise"] is None:
            agg["unvalued"] += 1
        else:
            agg["aum_paise"] += v["value_paise"]
        if v["is_direct"]:
            agg["direct_holdings"] += 1
            agg["direct_value_paise"] += v["value_paise"] or 0
        agg["as_of"] = max(filter(None, [agg["as_of"], v["as_of"]])) if v["as_of"] else agg["as_of"]
    for agg in out.values():
        agg["tier"] = tier_for(agg["aum_paise"])
        agg["has_direct_plan"] = agg["direct_holdings"] > 0
    return out


# ---------------------------------------------------------------------------
# SIP / STP / SWP
# ---------------------------------------------------------------------------
def create_sip(actor_id: str | None, **fields: Any) -> dict[str, Any]:
    with _session() as s:
        return _create(s, SipScheduleModel, "sip", actor_id, **fields)


def get_sip(sip_id: str) -> dict[str, Any] | None:
    with _session() as s:
        r = s.get(SipScheduleModel, sip_id)
        return _row(r) if r else None


def update_sip(sip_id: str, fields: dict[str, Any], actor_id: str | None) -> dict[str, Any] | None:
    allowed = {"scheme_code", "scheme_name", "type", "amount_paise", "day", "start_date", "end_date", "mandate_id", "status", "bounce_count", "last_bounce_at"}
    with _session() as s:
        return _update(s, SipScheduleModel, "sip", sip_id, fields, allowed, actor_id)


def list_sips(
    *, contact_id: str | None = None, household_id: str | None = None, status: str | None = None, viewer_rm: Any = None,
    page: Page | None = None,
) -> list[dict[str, Any]]:
    with _session() as s:
        stmt = select(SipScheduleModel).order_by(SipScheduleModel.created_at.desc())
        if contact_id:
            stmt = stmt.where(SipScheduleModel.contact_id == contact_id)
        if household_id:
            stmt = stmt.where(SipScheduleModel.contact_id.in_(select(ContactModel.id).where(ContactModel.household_id == household_id)))
        if status:
            stmt = stmt.where(SipScheduleModel.status == status)
        if viewer_rm is not None:
            hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(rm_ids(viewer_rm)))
            stmt = stmt.where(SipScheduleModel.contact_id.in_(select(ContactModel.id).where(ContactModel.household_id.in_(hh))))
        return [_row(r) for r in _page(s, stmt, SipScheduleModel, page, ("scheme_name", "scheme_code", "type"))]


def sip_book(viewer_rm: Any) -> dict[str, int]:
    """Active SIP book: monthly ₹ (paise) and count, SIPs only."""
    with _session() as s:
        stmt = select(func.count(), func.coalesce(func.sum(SipScheduleModel.amount_paise), 0)).where(
            SipScheduleModel.status == "active", SipScheduleModel.type == "sip"
        )
        if viewer_rm is not None:
            hh = select(HouseholdModel.id).where(HouseholdModel.rm_id.in_(rm_ids(viewer_rm)))
            stmt = stmt.where(SipScheduleModel.contact_id.in_(select(ContactModel.id).where(ContactModel.household_id.in_(hh))))
        n, total = s.execute(stmt).one()
        return {"count": int(n), "monthly_paise": int(total)}


def sip_alerts(viewer_rm: Any, horizon_days: int = 30) -> list[dict[str, Any]]:
    """SIPs ending within the horizon, bounced SIPs, and mandates expiring within the horizon that back a live SIP."""
    today = datetime.now(IST).date()
    horizon = (today + timedelta(days=horizon_days)).isoformat()
    sips = list_sips(viewer_rm=viewer_rm)
    contacts = {c["id"]: c for c in (get_contact(i) for i in {s["contact_id"] for s in sips}) if c}
    alerts: list[dict[str, Any]] = []

    def base(sip: dict[str, Any], kind: str, due: str, message: str, ref: str) -> dict[str, Any]:
        c = contacts.get(sip["contact_id"], {})
        return {
            "kind": kind, "sip_id": sip["id"], "contact_id": sip["contact_id"], "contact_name": c.get("name"),
            "household_id": c.get("household_id"), "customer_id": c.get("customer_id"), "rm_id": c.get("rm_id"),
            "due": due, "message": message, "source_ref": ref, "scheme_name": sip.get("scheme_name") or sip["scheme_code"],
        }

    mandate_ids = {s["mandate_id"] for s in sips if s.get("mandate_id")}
    mandates: dict[str, str | None] = {}
    if mandate_ids:
        with _session() as s:
            try:
                for mid, vu in s.execute(
                    text("SELECT id, valid_until FROM mandates WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)),
                    {"ids": sorted(mandate_ids)},
                ):
                    mandates[mid] = vu
            except Exception:
                mandates = {}
    for sip in sips:
        label = sip.get("scheme_name") or sip["scheme_code"]
        if sip["status"] == "bounced" or (sip["bounce_count"] or 0) > 0 and sip["status"] == "active" and (sip.get("last_bounce_at") or "") >= (today - timedelta(days=30)).isoformat():
            alerts.append(base(sip, "bounce", sip.get("last_bounce_at") or today.isoformat(), f"{sip['type'].upper()} bounced: {label}", f"sip_bounce:{sip['id']}:{sip.get('last_bounce_at') or sip['bounce_count']}"))
        if sip["status"] == "active" and sip.get("end_date") and today.isoformat() <= sip["end_date"] <= horizon:
            alerts.append(base(sip, "ending_soon", sip["end_date"], f"{sip['type'].upper()} ends {sip['end_date']}: {label}", f"sip_end:{sip['id']}"))
        vu = mandates.get(sip.get("mandate_id") or "")
        if sip["status"] == "active" and vu and today.isoformat() <= vu <= horizon:
            alerts.append(base(sip, "mandate_expiring", vu, f"Mandate expires {vu} (backs {label})", f"mandate_end:{sip['mandate_id']}:{vu}"))
    return alerts


# ---------------------------------------------------------------------------
# Commissions
# ---------------------------------------------------------------------------
def resolve_positions(keys: list[tuple[str, str]]) -> dict[tuple[str, str], dict[str, Any]]:
    """(folio, scheme_code) -> contact/household/RM, from the holdings the brokerage line belongs to."""
    if not keys:
        return {}
    folios = sorted({k[0] for k in keys})
    with _session() as s:
        rows = s.execute(
            select(HoldingModel.folio, HoldingModel.scheme_code, ContactModel.id, ContactModel.household_id, HouseholdModel.rm_id)
            .join(ContactModel, ContactModel.id == HoldingModel.contact_id)
            .join(HouseholdModel, HouseholdModel.id == ContactModel.household_id)
            .where(HoldingModel.folio.in_(folios))
        ).all()
    return {(f, sc): {"contact_id": c, "household_id": h, "rm_id": rm} for f, sc, c, h, rm in rows}


def upsert_commissions(rows: list[dict[str, Any]], actor_id: str | None) -> tuple[int, int]:
    created = updated = 0
    with _session() as s:
        for r in rows:
            cur = s.scalar(
                select(CommissionModel).where(
                    CommissionModel.folio == r["folio"], CommissionModel.scheme_code == r["scheme_code"], CommissionModel.month == r["month"]
                )
            )
            if cur is None:
                _create(s, CommissionModel, "commission", actor_id, **r)
                created += 1
            else:
                cur.amount_paise, cur.contact_id, cur.household_id, cur.rm_id, cur.source = (
                    r["amount_paise"], r.get("contact_id"), r.get("household_id"), r.get("rm_id"), r.get("source"),
                )
                updated += 1
    return created, updated


def commission_summary(viewer_rm: Any, month_from: str | None, month_to: str | None) -> dict[str, Any]:
    """Trail by household and by RM over a month range; rows with no matching holding appear under 'unmatched'."""
    with _session() as s:
        stmt = select(CommissionModel)
        if month_from:
            stmt = stmt.where(CommissionModel.month >= month_from)
        if month_to:
            stmt = stmt.where(CommissionModel.month <= month_to)
        if viewer_rm is not None:
            stmt = stmt.where(CommissionModel.rm_id.in_(rm_ids(viewer_rm)))
        rows = [_row(r) for r in s.scalars(stmt).all()]
        hh_names = dict(s.execute(select(HouseholdModel.id, HouseholdModel.name)).all()) if rows else {}
    by_hh: dict[str, int] = {}
    by_rm: dict[str, int] = {}
    by_month: dict[str, int] = {}
    unmatched = 0
    for r in rows:
        by_month[r["month"]] = by_month.get(r["month"], 0) + r["amount_paise"]
        if r["household_id"]:
            by_hh[r["household_id"]] = by_hh.get(r["household_id"], 0) + r["amount_paise"]
            by_rm[r["rm_id"] or "unassigned"] = by_rm.get(r["rm_id"] or "unassigned", 0) + r["amount_paise"]
        else:
            unmatched += r["amount_paise"]
    return {
        "total_paise": sum(r["amount_paise"] for r in rows),
        "unmatched_paise": unmatched,
        "by_household": sorted(({"household_id": k, "household_name": hh_names.get(k), "amount_paise": v} for k, v in by_hh.items()), key=lambda x: -x["amount_paise"]),
        "by_rm": sorted(({"rm_id": k, "amount_paise": v} for k, v in by_rm.items()), key=lambda x: -x["amount_paise"]),
        "by_month": [{"month": k, "amount_paise": v} for k, v in sorted(by_month.items())],
    }


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------
def _campaign_row(r: Any) -> dict[str, Any]:
    d = _row(r)
    d["segment"] = json.loads(d.get("segment") or "{}")
    return d


def create_campaign(name: str, description: str | None, segment: dict, owner_id: str | None, actor_id: str | None) -> dict[str, Any]:
    with _session() as s:
        row = _create(s, CampaignModel, "campaign", actor_id, name=name, description=description, segment=json.dumps(segment), owner_id=owner_id, status="draft")
    row["segment"] = segment
    return row


def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    with _session() as s:
        c = s.get(CampaignModel, campaign_id)
        return _campaign_row(c) if c else None


def list_campaigns(viewer_rm: Any, page: Page | None = None) -> list[dict[str, Any]]:
    with _session() as s:
        stmt = select(CampaignModel).order_by(CampaignModel.created_at.desc())
        if viewer_rm is not None:
            stmt = stmt.where(CampaignModel.owner_id.in_(rm_ids(viewer_rm)))
        rows = [_campaign_row(c) for c in _page(s, stmt, CampaignModel, page, ("name", "description"))]
        counts: dict[str, dict[str, int]] = {}
        if rows:
            for cid, st, n in s.execute(
                select(CampaignMemberModel.campaign_id, CampaignMemberModel.status, func.count())
                .where(CampaignMemberModel.campaign_id.in_([r["id"] for r in rows]))
                .group_by(CampaignMemberModel.campaign_id, CampaignMemberModel.status)
            ):
                counts.setdefault(cid, {})[st] = n
    for r in rows:
        r["member_counts"] = counts.get(r["id"], {})
        r["member_total"] = sum(r["member_counts"].values())
    return rows


def update_campaign(campaign_id: str, fields: dict[str, Any], actor_id: str | None) -> dict[str, Any] | None:
    if "segment" in fields:
        fields = {**fields, "segment": json.dumps(fields["segment"])}
    with _session() as s:
        row = _update(s, CampaignModel, "campaign", campaign_id, fields, {"name", "description", "status", "segment", "owner_id"}, actor_id)
    if row:
        row["segment"] = json.loads(row["segment"] or "{}")
    return row


def add_campaign_members(campaign_id: str, contact_ids: list[str]) -> int:
    added = 0
    with _session() as s:
        have = set(s.scalars(select(CampaignMemberModel.contact_id).where(CampaignMemberModel.campaign_id == campaign_id)).all())
        for cid in contact_ids:
            if cid in have:
                continue
            s.add(CampaignMemberModel(id=uuid.uuid4().hex, campaign_id=campaign_id, contact_id=cid, status="targeted", created_at=_utcnow()))
            have.add(cid)
            added += 1
    return added


def list_campaign_members(campaign_id: str, viewer_rm: Any = None) -> list[dict[str, Any]]:
    with _session() as s:
        stmt = (
            select(CampaignMemberModel, ContactModel.customer_id, ContactModel.household_id, HouseholdModel.name, HouseholdModel.rm_id)
            .join(ContactModel, ContactModel.id == CampaignMemberModel.contact_id)
            .join(HouseholdModel, HouseholdModel.id == ContactModel.household_id)
            .where(CampaignMemberModel.campaign_id == campaign_id)
        )
        if viewer_rm is not None:
            stmt = stmt.where(HouseholdModel.rm_id.in_(rm_ids(viewer_rm)))
        rows = s.execute(stmt).all()
        names = dict(s.execute(text("SELECT id, name FROM customers WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)), {"ids": [r[1] for r in rows] or [""]}).all())
        return [{**_row(m), "name": names.get(cust), "household_id": hh, "household_name": hhn, "rm_id": rm} for m, cust, hh, hhn, rm in rows]


def update_campaign_member(campaign_id: str, contact_id: str, status: str, notes: str | None) -> dict[str, Any] | None:
    with _session() as s:
        m = s.scalar(select(CampaignMemberModel).where(CampaignMemberModel.campaign_id == campaign_id, CampaignMemberModel.contact_id == contact_id))
        if not m:
            return None
        m.status = status
        m.updated_at = _utcnow()
        if status in ("responded", "converted", "declined") and not m.responded_at:
            m.responded_at = _utcnow()
        if notes is not None:
            m.notes = notes
        s.flush()
        return _row(m)


def segment_contacts(segment: dict[str, Any], viewer_rm: Any) -> list[dict[str, Any]]:
    """Contacts matching a segment: AUM range (₹), household tier, tax status, SIP status, Direct-plan flag."""
    with _session() as s:
        stmt = select(ContactModel.id, ContactModel.customer_id, ContactModel.household_id, ContactModel.tax_status, HouseholdModel.name, HouseholdModel.rm_id).join(
            HouseholdModel, HouseholdModel.id == ContactModel.household_id
        )
        if viewer_rm is not None:
            stmt = stmt.where(HouseholdModel.rm_id.in_(rm_ids(viewer_rm)))
        if segment.get("tax_status"):
            stmt = stmt.where(ContactModel.tax_status.in_(list(segment["tax_status"])))
        if segment.get("relation"):
            stmt = stmt.where(ContactModel.relation.in_(list(segment["relation"])))
        rows = s.execute(stmt).all()
        names = dict(s.execute(text("SELECT id, name FROM customers WHERE id IN :ids").bindparams(bindparam("ids", expanding=True)), {"ids": [r[1] for r in rows] or [""]}).all())
        sip_state: dict[str, set[str]] = {}
        for cid, st in s.execute(select(SipScheduleModel.contact_id, SipScheduleModel.status)):
            sip_state.setdefault(cid, set()).add(st)
    aum = household_aum(sorted({r[2] for r in rows}))
    out = []
    for cid, cust, hh, tax, hh_name, rm in rows:
        a = aum.get(hh, {"aum_paise": 0, "has_direct_plan": False})
        rupees = a["aum_paise"] / 100
        if segment.get("aum_min") is not None and rupees < float(segment["aum_min"]):
            continue
        if segment.get("aum_max") is not None and rupees > float(segment["aum_max"]):
            continue
        if segment.get("tier") and tier_for(a["aum_paise"]) not in segment["tier"]:
            continue
        sips = sip_state.get(cid, set())
        want = segment.get("sip_status")
        if want == "active" and "active" not in sips:
            continue
        if want == "none" and sips:
            continue
        if want == "ended" and not (sips and "active" not in sips):
            continue
        if segment.get("has_direct_plan") is True and not a["has_direct_plan"]:
            continue
        out.append({"contact_id": cid, "name": names.get(cust), "household_id": hh, "household_name": hh_name, "rm_id": rm, "tax_status": tax, "aum_paise": a["aum_paise"], "tier": tier_for(a["aum_paise"])})
    return out


def delete_campaign_members(campaign_id: str) -> None:
    with _session() as s:
        s.execute(delete(CampaignMemberModel).where(CampaignMemberModel.campaign_id == campaign_id))



# ---------------------------------------------------------------------------
# Suitability (reads the W2 ``suitability_records`` table, which the products router creates lazily)
# ---------------------------------------------------------------------------
def latest_suitability(customer_id: str) -> dict[str, Any] | None:
    with _session() as s:
        try:
            r = s.execute(
                text(
                    "SELECT id, risk_band, score, review_due, max_riskometer, recorded_at FROM suitability_records "
                    "WHERE customer_id = :c ORDER BY recorded_at DESC LIMIT 1"
                ),
                {"c": customer_id},
            ).first()
        except Exception:
            return None
    if not r:
        return None
    today = today_ist()
    max_rk = r[4] if r[4] is not None else BAND_MAX_RISKOMETER.get(r[1] or "")
    return {
        "id": r[0], "risk_band": r[1], "score": r[2], "review_due": r[3], "max_riskometer": max_rk,
        "recorded_at": r[5], "valid": bool(r[3]) and r[3] >= today if r[3] else False,
    }


def suitability_check(riskometer: int | None, customer_id: str | None) -> dict[str, Any]:
    """Compare a product's riskometer with the client's assessed limit.

    ``level``: ``ok`` | ``warn`` (one step above their band, or no valid profile) | ``block`` (two or more steps above).
    """
    if riskometer is None:
        return {"level": "ok", "message": None, "gap": None}
    a = latest_suitability(customer_id) if customer_id else None
    if not a or a["max_riskometer"] is None:
        return {"level": "warn", "gap": None, "message": "No risk assessment on file for this client. Complete the risk questionnaire before recommending."}
    if not a["valid"]:
        return {"level": "warn", "gap": None, "message": f"The client's risk assessment is out of date (review was due {a['review_due'] or 'unknown'})."}
    gap = riskometer - a["max_riskometer"]
    label, limit = RISKOMETER_LABELS.get(riskometer, str(riskometer)), RISKOMETER_LABELS.get(a["max_riskometer"], str(a["max_riskometer"]))
    if gap <= 0:
        return {"level": "ok", "message": None, "gap": gap}
    msg = f"Product riskometer “{label}” is above this client's {a['risk_band']} limit (“{limit}”)."
    return {"level": "warn" if gap == 1 else "block", "message": msg, "gap": gap}
