"""Phase 2 queries that span several CRM tables: contacts, owners, global search,
duplicate matching, record timelines and saved list views.

Everything is portable SQL (SQLAlchemy Core / ``text``) so it runs on SQLite and
Postgres alike, and every read takes the viewing RM's id (``None`` = admin) so
RM scoping is enforced in the query, not afterwards.
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.exc import IntegrityError

from app.repo_crm_core import CrmCoreError, Page, _new_id, _session, _utcnow, rm_ids

CONTACT_SORTS = {"name", "email", "mobile", "household_name", "relation", "tax_status", "dob", "role"}


def _like(q: str) -> str:
    return "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def digits(value: str | None) -> str:
    """Last 10 digits of a phone-ish string (drops +91/0 prefixes) for comparisons."""
    d = re.sub(r"\D", "", value or "")
    return d[-10:] if len(d) >= 10 else d


def _t(sql: str):
    """``text()`` that expands the ``:rms`` team list when the query uses it."""
    stmt = text(sql)
    for name in ("rms", "ids"):
        if f":{name}" in sql:
            stmt = stmt.bindparams(bindparam(name, expanding=True))
    return stmt


# ---------------------------------------------------------------------------
# Owners
# ---------------------------------------------------------------------------
def list_owners() -> list[dict[str, Any]]:
    with _session() as s:
        rows = s.execute(_t("SELECT id, name, role FROM customers WHERE role IN ('rm', 'admin') ORDER BY name")).all()
        return [{"id": r[0], "name": r[1], "role": r[2]} for r in rows]


# ---------------------------------------------------------------------------
# Contacts: customers that belong to a household, with their household
# ---------------------------------------------------------------------------
def list_contacts(
    viewer_rm_id: Any, page: Page, household_id: str | None = None, ids: list[str] | None = None
) -> list[dict[str, Any]]:
    where = ["1=1"]
    params: dict[str, Any] = {}
    if ids is not None:
        where.append("k.id IN :ids" if ids else "1=0")
        if ids:
            params["ids"] = ids
    if viewer_rm_id is not None:
        where.append("h.rm_id IN :rms")
        params["rms"] = rm_ids(viewer_rm_id)
    if household_id:
        where.append("h.id = :hh")
        params["hh"] = household_id
    if page.q:
        where.append(
            "(LOWER(c.name) LIKE :q ESCAPE '\\' OR LOWER(c.email) LIKE :q ESCAPE '\\' "
            "OR LOWER(c.mobile) LIKE :q ESCAPE '\\' OR LOWER(h.name) LIKE :q ESCAPE '\\')"
        )
        params["q"] = _like(page.q)
    base = (
        "FROM contacts k JOIN households h ON h.id = k.household_id "
        "JOIN customers c ON c.id = k.customer_id WHERE " + " AND ".join(where)
    )
    order = "c.name ASC"
    if page.sort:
        key = page.sort.lstrip("-")
        if key not in CONTACT_SORTS:
            raise CrmCoreError("bad_sort", f"sort must be one of: {', '.join(sorted(CONTACT_SORTS))}")
        col = {
            "name": "c.name", "email": "c.email", "mobile": "c.mobile", "household_name": "h.name", "role": "k.relation",
            "relation": "k.relation", "tax_status": "k.tax_status", "dob": "k.dob",
        }[key]
        order = f"{col} {'DESC' if page.sort.startswith('-') else 'ASC'}"
    with _session() as s:
        page.total = s.execute(_t("SELECT COUNT(*) " + base), params).scalar() or 0
        rows = s.execute(
            _t(
                "SELECT k.id, c.name, c.email, c.mobile, k.relation, h.id, h.name, h.rm_id, k.tax_status, k.dob, k.customer_id "
                + base
                + f" ORDER BY {order} LIMIT :lim OFFSET :off"
            ),
            {**params, "lim": page.limit, "off": page.offset},
        ).all()
        return [
            {
                "id": r[0], "name": r[1], "email": r[2], "mobile": r[3], "relation": r[4], "role": r[4],
                "household_id": r[5], "household_name": r[6], "rm_id": r[7], "tax_status": r[8], "dob": r[9],
                "customer_id": r[10],
            }
            for r in rows
        ]


# ---------------------------------------------------------------------------
# Global search + duplicates
# ---------------------------------------------------------------------------
def search(q: str, viewer_rm_id: str | None, per_type: int = 5) -> list[dict[str, Any]]:
    like, out = _like(q), []
    num = digits(q)
    rm_clause = " AND h.rm_id IN :rms" if viewer_rm_id is not None else ""
    params: dict[str, Any] = {"q": like, "lim": per_type, **({"rms": rm_ids(viewer_rm_id)} if viewer_rm_id is not None else {})}
    pan = q.strip().upper() if re.fullmatch(r"[A-Za-z0-9]{4}", q.strip()) else None
    with _session() as s:
        for r in s.execute(
            _t(f"SELECT h.id, h.name, h.notes FROM households h WHERE LOWER(h.name) LIKE :q ESCAPE '\\'{rm_clause} LIMIT :lim"),
            params,
        ):
            out.append({"type": "household", "id": r[0], "title": r[1], "subtitle": (r[2] or "")[:60], "href": f"/backoffice/crm/households/{r[0]}"})
        contact_where = "(LOWER(c.name) LIKE :q ESCAPE '\\' OR LOWER(c.email) LIKE :q ESCAPE '\\' OR LOWER(c.mobile) LIKE :q ESCAPE '\\'"
        if len(num) >= 4:
            contact_where += " OR c.mobile LIKE :num"
            params["num"] = f"%{num}"
        if pan:
            contact_where += " OR c.id IN (SELECT customer_id FROM kyc_records WHERE UPPER(pan_last4) = :pan)" if _has_table(s, "kyc_records") else ""
            params["pan"] = pan
        contact_where += ")"
        for r in s.execute(
            _t(
                "SELECT c.id, c.name, c.mobile, h.id, h.name FROM household_members m JOIN households h ON h.id = m.household_id "
                f"JOIN customers c ON c.id = m.customer_id WHERE {contact_where}{rm_clause} LIMIT :lim"
            ),
            params,
        ):
            out.append({"type": "contact", "id": r[0], "title": r[1], "subtitle": f"{r[2]} · {r[4]}", "href": f"/backoffice/crm/households/{r[3]}"})
        lead_where = "(LOWER(name) LIKE :q ESCAPE '\\' OR LOWER(email) LIKE :q ESCAPE '\\' OR LOWER(mobile) LIKE :q ESCAPE '\\')"
        lead_rm = " AND assigned_rm_id IN :rms" if viewer_rm_id is not None else ""
        for r in s.execute(
            _t(f"SELECT id, name, status, mobile FROM leads WHERE {lead_where}{lead_rm} LIMIT :lim"), params
        ):
            out.append({"type": "lead", "id": r[0], "title": r[1], "subtitle": f"{r[2]} · {r[3] or ''}".strip(" ·"), "href": f"/backoffice/crm/leads/{r[0]}"})
        opp_vis = (
            ""
            if viewer_rm_id is None
            else " AND (assigned_rm_id IN :rms OR household_id IN (SELECT id FROM households WHERE rm_id IN :rms))"
        )
        for r in s.execute(
            _t(f"SELECT id, title, stage, product_line FROM opportunities WHERE LOWER(title) LIKE :q ESCAPE '\\'{opp_vis} LIMIT :lim"),
            params,
        ):
            out.append({"type": "opportunity", "id": r[0], "title": r[1], "subtitle": f"{r[3].replace('_', ' ')} · {r[2]}", "href": f"/backoffice/crm/opportunities/{r[0]}"})
        case_vis = (
            ""
            if viewer_rm_id is None
            else " AND customer_id IN (SELECT m.customer_id FROM household_members m JOIN households h ON h.id = m.household_id WHERE h.rm_id IN :rms)"
        )
        for r in s.execute(
            _t(f"SELECT id, subject, status FROM cases WHERE LOWER(subject) LIKE :q ESCAPE '\\'{case_vis} LIMIT :lim"),
            params,
        ):
            out.append({"type": "case", "id": r[0], "title": r[1], "subtitle": r[2].replace("_", " "), "href": f"/backoffice/crm/cases/{r[0]}"})
    return out


def _has_table(s, name: str) -> bool:
    from sqlalchemy import inspect

    return name in inspect(s.get_bind()).get_table_names()


def find_duplicates(
    *,
    name: str | None,
    email: str | None,
    mobile: str | None,
    pan_last4: str | None,
    viewer_rm_id: str | None,
    exclude_lead_id: str | None = None,
) -> list[dict[str, Any]]:
    """Existing customers/leads that match on mobile, email, PAN last 4 or (weakly) name.

    Matches the viewer may not see come back with ``visible: False`` and no
    identifying details, so an RM learns only that a record already exists.
    """
    num = digits(mobile)
    em = (email or "").strip().lower()
    nm = (name or "").strip().lower()
    pan = (pan_last4 or "").strip().upper()
    found: dict[tuple[str, str], dict[str, Any]] = {}

    def add(kind: str, rec_id: str, label: str, reason: str, visible: bool, href: str | None) -> None:
        key = (kind, rec_id)
        item = found.setdefault(
            key,
            {"type": kind, "id": rec_id if visible else None, "name": label if visible else None,
             "visible": visible, "href": href if visible else None, "reasons": []},
        )
        if reason not in item["reasons"]:
            item["reasons"].append(reason)

    with _session() as s:
        scope_ids: set[str] = set()
        if viewer_rm_id is not None:
            scope_ids = {
                r[0]
                for r in s.execute(
                    _t(
                        "SELECT m.customer_id FROM household_members m JOIN households h ON h.id = m.household_id WHERE h.rm_id IN :rms"
                    ),
                    {"rms": rm_ids(viewer_rm_id)},
                )
            }
        clauses, params = [], {}
        if len(num) == 10:
            clauses.append(("mobile", "mobile LIKE :num"))
            params["num"] = f"%{num}"
        if em:
            clauses.append(("email", "LOWER(email) = :em"))
            params["em"] = em
        for reason, cond in clauses:
            for r in s.execute(_t(f"SELECT id, name, assigned_rm_id FROM customers WHERE {cond} AND role = 'customer'"), params):
                visible = viewer_rm_id is None or r[0] in scope_ids or r[2] == viewer_rm_id
                hh = s.execute(
                    _t("SELECT household_id FROM household_members WHERE customer_id = :c LIMIT 1"), {"c": r[0]}
                ).scalar()
                add("contact", r[0], r[1], reason, visible, f"/backoffice/crm/households/{hh}" if hh else None)
            for r in s.execute(_t(f"SELECT id, name, assigned_rm_id FROM leads WHERE {cond}"), params):
                if r[0] == exclude_lead_id:
                    continue
                visible = viewer_rm_id is None or r[2] == viewer_rm_id
                add("lead", r[0], r[1], reason, visible, f"/backoffice/crm/leads/{r[0]}")
        if len(pan) == 4 and _has_table(s, "kyc_records"):
            for r in s.execute(
                _t("SELECT c.id, c.name, c.assigned_rm_id FROM kyc_records k JOIN customers c ON c.id = k.customer_id WHERE UPPER(k.pan_last4) = :pan"),
                {"pan": pan},
            ):
                visible = viewer_rm_id is None or r[0] in scope_ids or r[2] == viewer_rm_id
                hh = s.execute(_t("SELECT household_id FROM household_members WHERE customer_id = :c LIMIT 1"), {"c": r[0]}).scalar()
                add("contact", r[0], r[1], "pan_last4", visible, f"/backoffice/crm/households/{hh}" if hh else None)
        if nm and len(nm) >= 3 and (found or not (em or num)):
            # Name alone is a weak signal: only reported next to another match, or when nothing else was supplied.
            for r in s.execute(_t("SELECT id, name, assigned_rm_id FROM customers WHERE LOWER(name) = :n AND role = 'customer'"), {"n": nm}):
                visible = viewer_rm_id is None or r[0] in scope_ids or r[2] == viewer_rm_id
                hh = s.execute(_t("SELECT household_id FROM household_members WHERE customer_id = :c LIMIT 1"), {"c": r[0]}).scalar()
                add("contact", r[0], r[1], "name", visible, f"/backoffice/crm/households/{hh}" if hh else None)
    return list(found.values())


# ---------------------------------------------------------------------------
# Saved list views
# ---------------------------------------------------------------------------
def _view_row(r: Any) -> dict[str, Any]:
    return {
        "id": r[0], "entity": r[1], "name": r[2], "filters": json.loads(r[3] or "{}"),
        "columns": json.loads(r[4] or "[]"), "is_default": bool(r[5]),
    }


_VIEW_COLS = "id, entity, name, filters, columns, is_default"


def list_views(user_id: str, entity: str | None) -> list[dict[str, Any]]:
    with _session() as s:
        sql = f"SELECT {_VIEW_COLS} FROM crm_list_views WHERE user_id = :u" + (" AND entity = :e" if entity else "") + " ORDER BY name"
        return [_view_row(r) for r in s.execute(_t(sql), {"u": user_id, "e": entity})]


def get_view(user_id: str, view_id: str) -> dict[str, Any] | None:
    with _session() as s:
        r = s.execute(_t(f"SELECT {_VIEW_COLS} FROM crm_list_views WHERE id = :i AND user_id = :u"), {"i": view_id, "u": user_id}).first()
        return _view_row(r) if r else None


def save_view(
    user_id: str, entity: str, name: str, filters: dict, columns: list, is_default: bool, view_id: str | None = None
) -> dict[str, Any]:
    now = _utcnow()
    try:
        with _session() as s:
            if is_default:
                s.execute(_t("UPDATE crm_list_views SET is_default = 0 WHERE user_id = :u AND entity = :e"), {"u": user_id, "e": entity})
            if view_id:
                n = s.execute(
                    _t("UPDATE crm_list_views SET name = :n, filters = :f, columns = :c, is_default = :d, updated_at = :t WHERE id = :i AND user_id = :u"),
                    {"n": name, "f": json.dumps(filters), "c": json.dumps(columns), "d": int(is_default), "t": now, "i": view_id, "u": user_id},
                ).rowcount
                if not n:
                    raise CrmCoreError("not_found", "View not found")
            else:
                view_id = _new_id()
                s.execute(
                    _t(
                        "INSERT INTO crm_list_views (id, user_id, entity, name, filters, columns, is_default, created_at, updated_at) "
                        "VALUES (:i, :u, :e, :n, :f, :c, :d, :t, :t)"
                    ),
                    {"i": view_id, "u": user_id, "e": entity, "n": name, "f": json.dumps(filters), "c": json.dumps(columns), "d": int(is_default), "t": now},
                )
    except IntegrityError as e:
        raise CrmCoreError("duplicate_view", "You already have a view with this name for this list.") from e
    return get_view(user_id, view_id) or {}


def delete_view(user_id: str, view_id: str) -> bool:
    with _session() as s:
        return bool(s.execute(_t("DELETE FROM crm_list_views WHERE id = :i AND user_id = :u"), {"i": view_id, "u": user_id}).rowcount)


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------
def timeline(entity: str, entity_id: str, customer_ids: list[str], opportunity_ids: list[str], limit: int = 100) -> list[dict[str, Any]]:
    """Merged activities, cases and audit changes for a record, newest first."""
    items: list[dict[str, Any]] = []
    with _session() as s:
        act_where, act_params = [], {}
        if entity == "household":
            act_where.append("household_id = :id")
            act_params["id"] = entity_id
        elif entity == "opportunity":
            act_where.append("opportunity_id = :id")
            act_params["id"] = entity_id
        elif entity == "case":
            act_where.append("case_id = :id")
            act_params["id"] = entity_id
        elif entity == "lead":
            act_where.append("lead_id = :id")
            act_params["id"] = entity_id
        if customer_ids and entity in ("household", "customer"):
            act_where.append("customer_id IN :cids")
            act_params["cids"] = customer_ids
        if act_where:
            stmt = _t(
                "SELECT id, kind, subject, body, due_at, done_at, assigned_rm_id, created_at, created_by FROM activities WHERE "
                + " OR ".join(act_where)
                + " ORDER BY created_at DESC LIMIT :lim"
            )
            if "cids" in act_params:
                stmt = stmt.bindparams(bindparam("cids", expanding=True))
            for r in s.execute(stmt, {**act_params, "lim": limit}):
                items.append({
                    "type": "activity", "id": r[0], "kind": r[1], "title": r[2], "detail": r[3], "at": r[7],
                    "due_at": r[4], "done_at": r[5], "actor_id": r[8] or r[6],
                })
        if customer_ids and entity == "household":
            stmt = _t("SELECT id, subject, status, category, created_at, created_by FROM cases WHERE customer_id IN :cids ORDER BY created_at DESC LIMIT :lim").bindparams(bindparam("cids", expanding=True))
            for r in s.execute(stmt, {"cids": customer_ids, "lim": limit}):
                items.append({"type": "case", "id": r[0], "kind": r[3], "title": r[1], "detail": r[2], "at": r[4], "actor_id": r[5]})
        audit_targets = [(entity, entity_id)] + [("opportunity", o) for o in opportunity_ids]
        for ent, eid in audit_targets:
            for r in s.execute(
                _t("SELECT field, old, new, actor_id, at, entity, entity_id FROM audit_log WHERE entity = :e AND entity_id = :i AND field <> '_created' ORDER BY at DESC LIMIT :lim"),
                {"e": ent, "i": eid, "lim": limit},
            ):
                items.append({
                    "type": "audit", "id": f"{r[5]}:{r[6]}:{r[0]}:{r[4]}", "kind": r[5], "title": f"{r[0].replace('_', ' ')} changed",
                    "detail": f"{r[1] if r[1] is not None else '—'} → {r[2] if r[2] is not None else '—'}", "at": r[4], "actor_id": r[3],
                })
    items.sort(key=lambda i: i["at"] or "", reverse=True)
    return items[:limit]
