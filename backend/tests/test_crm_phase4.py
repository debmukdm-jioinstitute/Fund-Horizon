# ruff: noqa: F401, F811  (pytest fixtures are imported from test_crm_core)
"""Phase 4 tests: the dashboard's numbers equal the list views its widgets link to, and are scoped."""

from __future__ import annotations

import pytest

from .test_crm_core import _login, _login_as, _make_customer, admin, client, rm, rm2
from .test_crm_phase3 import CAS, book, contact, household, in_days, seed_scheme

# CRM tab -> (list endpoint, filter params it adds)
LIST_ENDPOINT = {
    "households": "/api/crm/households",
    "contacts": "/api/crm/contacts",
    "opportunities": "/api/crm/opportunities",
    "activities": "/api/crm/activities",
    "cases": "/api/crm/cases",
    "deadlines:renewals": "/api/crm/renewals",
    "deadlines:maturities": "/api/crm/maturities",
}


def widgets(d: dict) -> list[tuple[str, int, dict]]:
    """Every (name, count, link) the dashboard shows."""
    out = []
    for key in ("overdue_tasks", "sla_breaching", "gaps", "renewals", "maturities", "won_this_month"):
        out.append((key, d[key]["count"], d[key]["link"]))
    for r in d["aum_by_tier"]:
        out.append((f"tier:{r['tier']}", r["count"], r["link"]))
    for r in d["pipeline_by_stage"]:
        out.append((f"stage:{r['stage']}", r["count"], r["link"]))
    for r in d["pipeline_by_rm"]:
        if r["link"]:
            out.append((f"rm:{r['rm_name']}", r["count"], r["link"]))
    return out


def list_total(client, link: dict) -> int:
    tab, params = link["tab"], dict(link["params"])
    if tab == "deadlines":
        path = LIST_ENDPOINT[f"deadlines:{params.pop('kind')}"]
    else:
        path = LIST_ENDPOINT[tab]
    r = client.get(path, params={**params, "limit": 1})
    assert r.status_code == 200, (path, params, r.text)
    return int(r.headers["X-Total-Count"])


def seed(client, rm_id=None):
    """Households across tiers, open/won/lost opps, an overdue task, a breaching case, renewals, FDs, gaps."""
    seed_scheme("100001", "Alpha Large Cap Fund - Regular Growth", 50.0, "Regular")
    seed_scheme("100002", "Beta Flexi Cap Fund - Direct Growth", 120.5, "Direct", "Equity Scheme - Flexi Cap Fund")
    hh = household(client, "Iyer family", rm_id=rm_id)
    meera = contact(client, hh, "Meera Iyer", mobile="9811111111")
    contact(client, hh, "Ravi Menon", mobile="9822222222", relation="spouse")
    client.post("/api/crm/kyc", json={"customer_id": meera["customer_id"], "pan": "ABCDE1234F", "kra_status": "validated"})
    assert client.post("/api/crm/holdings/import", json={"csv_text": CAS, "as_of": "2026-10-13"}).status_code == 200
    small = household(client, "Small family", rm_id=rm_id)
    contact(client, small, "Solo Saver", mobile="9833333333")
    ids = {}
    for title, line, stage in (("Open MF", "mutual_fund", None), ("Open PMS", "pms", None), ("Won PMS", "pms", "won"), ("Lost PMS", "pms", "lost")):
        r = client.post("/api/crm/opportunities", json={"household_id": hh["id"], "product_line": line, "title": title, "amount": 500000})
        assert r.status_code == 201, r.text
        ids[title] = r.json()
    for title, stage, extra in (("Won PMS", "won", {}), ("Lost PMS", "lost", {"lost_reason": "price"})):
        o = ids[title]
        if stage == "won":  # only the last open stage can win
            client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": "reporting"})
        r = client.patch(f"/api/crm/opportunities/{o['id']}", json={"stage": stage, **extra})
        assert r.status_code == 200, r.text
    client.post("/api/crm/activities", json={"kind": "followup", "subject": "Late", "household_id": hh["id"], "due_at": in_days(-2)})
    client.post("/api/crm/activities", json={"kind": "followup", "subject": "Fine", "household_id": hh["id"], "due_at": in_days(5)})
    cust = meera["customer_id"]
    client.post("/api/crm/cases", json={"customer_id": cust, "category": "kyc", "subject": "Breach", "sla_due_at": in_days(-1)})
    client.post("/api/crm/cases", json={"customer_id": cust, "category": "kyc", "subject": "OK", "sla_due_at": in_days(10)})
    client.post("/api/crm/policies", json={"household_id": hh["id"], "policy_type": "term", "insurer": "LIC", "renewal_date": in_days(10)})
    client.post("/api/crm/policies", json={"household_id": hh["id"], "policy_type": "term", "insurer": "Far", "renewal_date": in_days(200)})
    client.post("/api/crm/fds", json={"household_id": hh["id"], "company": "Bajaj", "amount": 100000, "maturity_date": in_days(12)})
    return hh


def test_dashboard_numbers_equal_list_view_counts(client, admin):
    seed(client)
    d = client.get("/api/crm/reports/dashboard").json()
    assert d["overdue_tasks"]["count"] == 1 and d["sla_breaching"]["count"] == 1
    assert d["renewals"]["count"] == 1 and d["maturities"]["count"] == 1
    assert d["won_this_month"]["count"] == 1 and d["gaps"]["count"] >= 2
    assert d["pipeline_open"]["count"] == 2  # won and lost are not in the open pipeline
    assert sum(r["count"] for r in d["pipeline_by_stage"]) == d["pipeline_open"]["count"]
    assert sum(r["count"] for r in d["pipeline_by_rm"]) == d["pipeline_open"]["count"]
    assert sum(r["count"] for r in d["aum_by_tier"]) == 2
    assert d["aum_total_paise"] > 0 and d["aum_by_tier"][0]["tier"] == "platinum"
    for name, count, link in widgets(d):
        assert list_total(client, link) == count, name


def test_dashboard_is_scoped_to_the_viewers_book(client, rm, rm2):
    seed(client, rm_id=rm["id"])
    mine = client.get("/api/crm/reports/dashboard").json()
    assert mine["pipeline_open"]["count"] == 2 and sum(r["households"] for r in mine["aum_by_tier"]) == 2
    for name, count, link in widgets(mine):
        assert list_total(client, link) == count, name
    _login_as(client, rm2)
    theirs = client.get("/api/crm/reports/dashboard").json()
    assert theirs["pipeline_open"]["count"] == 0 and theirs["overdue_tasks"]["count"] == 0
    assert theirs["gaps"]["count"] == 0 and theirs["renewals"]["count"] == 0 and theirs["aum_total_paise"] == 0
    assert theirs["sip_book"]["count"] == 0 and theirs["top_trail"]["rows"] == []


def test_sip_book_and_top_trail_on_dashboard(client, admin):
    seed(client)
    c = client.get("/api/crm/contacts").json()[0]
    m = client.post("/api/crm/sips", json={"contact_id": c["id"], "scheme_code": "100001", "amount_paise": 250000, "day": 5, "start_date": "2026-01-05"})
    assert m.status_code == 201, m.text
    client.post("/api/crm/commissions/import", json={"csv_text": "Folio,AMFI Code,Month,Brokerage\n1001/01,100001,2026-09,100\n1001/01,100001,2026-10,1200\n"})
    d = client.get("/api/crm/reports/dashboard").json()
    assert d["sip_book"]["count"] == 1 and d["sip_book"]["monthly_paise"] == 250000
    assert d["top_trail"]["month"] == "2026-10"
    assert [(r["household_name"], r["amount_paise"]) for r in d["top_trail"]["rows"]] == [("Iyer family", 120000)]


def test_new_list_filters(client, admin):
    seed(client)
    assert {h["name"] for h in client.get("/api/crm/households", params={"tier": "standard"}).json()} == {"Small family", "Iyer family"}  # ~₹77k AUM is still standard
    assert client.get("/api/crm/households", params={"tier": "platinum"}).json() == []
    assert client.get("/api/crm/households", params={"tier": "nope"}).status_code == 422
    opens = client.get("/api/crm/opportunities", params={"open": "true"}).json()
    assert {o["title"] for o in opens} == {"Open MF", "Open PMS"}
    assert [o["title"] for o in client.get("/api/crm/opportunities", params={"won_this_month": "true"}).json()] == ["Won PMS"]
    gaps = client.get("/api/crm/contacts", params={"gaps": "true"})
    assert int(gaps.headers["X-Total-Count"]) == client.get("/api/crm/contacts/gaps").json().__len__()
    csv = client.get("/api/crm/export/opportunities", params={"open": "true"}).text
    assert "Open MF" in csv and "Won PMS" not in csv


def test_compliance_reads_dashboard_unscoped(client, admin):
    seed(client)
    comp = _make_customer("compliance")
    _login_as(client, comp)
    d = client.get("/api/crm/reports/dashboard")
    assert d.status_code == 200 and d.json()["pipeline_open"]["count"] == 2
