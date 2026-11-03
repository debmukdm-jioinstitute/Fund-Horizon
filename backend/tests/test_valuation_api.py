"""End-to-end: batch workflow over HTTP, duplicates, approval gate, revisions, immutability, transactions, PDF, access control."""
import hashlib
import io
import itertools
import re
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.backoffice.valuation import config as vcfg
from app.backoffice.valuation import service
from app.db import sqlite
from app.repo_crm_core import get_crm_repository
from tests import valuation_fixtures as fx

_n = itertools.count()
B = "/api/backoffice/valuation"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "val.db"))
    monkeypatch.setenv("FH_VAL_STORE", str(tmp_path / "private"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


def _user(role="customer", rm_for=None):
    n = next(_n)
    u = sqlite.create_customer(name=f"{role.title()} {n}", email=f"val{n}@example.com", mobile=f"96{10000000 + n:08d}", password_hash="x", role=role)
    return u


def _login(client, user):
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(user["id"], hashlib.sha256(token.encode()).hexdigest(), (datetime.now(UTC) + timedelta(days=1)).isoformat())
    client.cookies.set("fh_session", token)
    return user


def _book(rm, name="Client One"):
    """A client customer inside this RM's book (RM visibility is via household)."""
    cust = _user("customer")
    get_crm_repository().create_household(name=f"{name} HH", primary_customer_id=cust["id"], rm_id=rm["id"])
    return cust


def _upload(client, batch_id, files, **form):
    r = client.post(f"{B}/batches/{batch_id}/files", files=[("files", (n, io.BytesIO(d), "application/octet-stream")) for n, d in files], data=form)
    assert r.status_code == 201, r.text
    return r.json()["results"]


def _all_files():
    return [("fundsindia_oct.xlsx", fx.fundsindia_xlsx()), ("proaffluence_oct.pdf", fx.proaffluence_pdf()), ("stallion_oct.xlsx", fx.stallion_xlsx())]


def _run(client, cid, month="2026-10", vdate="2026-10-31", files=None, revises=None):
    r = client.post(f"{B}/batches", json={"client_id": cid, "report_month": month, "valuation_date": vdate, "revises_batch_id": revises})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    res = _upload(client, bid, files or _all_files())
    assert all(x["ok"] for x in res)
    assert client.post(f"{B}/batches/{bid}/process", json={}).status_code == 200
    rec = client.post(f"{B}/batches/{bid}/validate").json()
    return bid, rec


@pytest.fixture
def admin(client):
    return _login(client, _user("admin"))


def test_full_workflow_totals_report_and_history(client, admin):
    cust = _user("customer")
    bid, rec = _run(client, cust["id"])
    assert rec["summary"]["failed_errors"] == 0 and rec["summary"]["can_approve"], [c for c in rec["checks"] if c["status"] == "failed"]
    prev = client.get(f"{B}/batches/{bid}/preview").json()
    assert {f["provider"] for f in prev["files"]} == {"fundsindia", "proaffluence", "stallion"}
    assert all(f["status"] == "extracted" and f["provider_source"] == "detected" for f in prev["files"])
    assert all(f["adapter_verified"] is False for f in prev["files"])                      # honesty flag surfaced to the UI
    cons = client.get(f"{B}/batches/{bid}/consolidated").json()
    assert cons["totals"]["total_value"] == pytest.approx(1_321_092.10)
    assert cons["totals"]["invested"] == pytest.approx(1_075_030.00)

    ap = client.post(f"{B}/batches/{bid}/approve", json={"generate_report": True})
    assert ap.status_code == 200, ap.text
    body = ap.json()
    snap = client.get(f"{B}/snapshots/{body['snapshot_id']}").json()
    assert snap["total_value"] == pytest.approx(1_321_092.10) and snap["payload"]["totals"] == cons["totals"]

    pdf = client.get(f"{B}/reports/{body['report']['id']}/download")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["cache-control"] == "private, no-store"
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    flat = text.replace(",", "").replace("₹", "")
    for needle in ("1321092.10", "1075030.00", "246062.10", "561092.10", "445000.00", "315000.00"):
        assert needle in flat, needle
    for h in ("Annexure A", "Annexure B", "Annexure C", "Holding-level details", "Methodology and disclosures", "Month-on-month", "Page 2 of"):
        assert h in text
    fonts = set(re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9\-]+)", pdf.content))
    assert fonts and all(f.startswith((b"GS", b"GoogleSans")) for f in fonts), fonts          # Google Sans only

    hist = client.get(f"{B}/clients/{cust['id']}/history").json()["data"]
    assert len(hist) == 1 and hist[0]["is_latest_revision"] and hist[0]["reports"][0]["version_no"] == 1
    lst = client.get(f"{B}/batches").json()["data"][0]
    assert lst["status"] == "approved" and lst["report_status"] == "v1" and lst["providers"] == ["fundsindia", "proaffluence", "stallion"]
    # private storage: files live outside any static dir and are not served
    assert str(vcfg.private_dir()).endswith("private")
    assert client.get("/private").status_code == 404


def test_duplicate_upload_by_content_not_filename(client, admin):
    cust = _user("customer")
    bid = client.post(f"{B}/batches", json={"client_id": cust["id"], "report_month": "2026-10", "valuation_date": "2026-10-31"}).json()["id"]
    assert _upload(client, bid, [("a.xlsx", fx.stallion_xlsx())])[0]["ok"]
    dup = _upload(client, bid, [("totally_different_name.xlsx", fx.stallion_xlsx())])[0]
    assert not dup["ok"] and dup["status"] == 409 and "SHA-256" in dup["error"]
    # same file name, different content is NOT a duplicate
    assert _upload(client, bid, [("a.xlsx", fx.stallion_xlsx(deposit_desc="Capital Contribution"))])[0]["ok"]


def test_same_account_and_date_in_two_files_blocks_approval(client, admin):
    cust = _user("customer")
    files = _all_files() + [("fundsindia_corrected.xlsx", fx.fundsindia_xlsx_corrected())]
    bid, rec = _run(client, cust["id"], files=files)
    failed = [c for c in rec["checks"] if c["status"] == "failed" and c["severity"] == "error"]
    assert "duplicate_statement" in {c["check_code"] for c in failed} and not rec["summary"]["can_approve"]
    assert client.post(f"{B}/batches/{bid}/approve", json={}).status_code == 409
    # removing the superseded file and re-validating clears the block
    old = next(f for f in client.get(f"{B}/batches/{bid}/preview").json()["files"] if f["filename"] == "fundsindia_oct.xlsx")
    assert client.delete(f"{B}/files/{old['id']}").status_code == 204
    assert client.post(f"{B}/batches/{bid}/approve", json={}).status_code == 409          # must reprocess + revalidate after a change
    client.post(f"{B}/batches/{bid}/process", json={})
    assert client.post(f"{B}/batches/{bid}/validate").json()["summary"]["can_approve"]


def test_provider_mapping_error_and_manual_correction(client, admin):
    cust = _user("customer")
    bid = client.post(f"{B}/batches", json={"client_id": cust["id"], "report_month": "2026-10", "valuation_date": "2026-10-31"}).json()["id"]
    _upload(client, bid, [("x.xlsx", fx.stallion_xlsx())], provider="proaffluence")      # wrong manual mapping
    client.post(f"{B}/batches/{bid}/process", json={})
    rec = client.post(f"{B}/batches/{bid}/validate").json()
    assert "provider_mapping" in {c["check_code"] for c in rec["checks"] if c["status"] == "failed"}
    fid = client.get(f"{B}/batches/{bid}/preview").json()["files"][0]["id"]
    assert client.patch(f"{B}/files/{fid}/provider", json={"provider": "stallion"}).status_code == 200
    client.post(f"{B}/batches/{bid}/process", json={})
    assert client.post(f"{B}/batches/{bid}/validate").json()["summary"]["can_approve"]


def test_scanned_file_blocks_and_cannot_be_overridden(client, admin):
    cust = _user("customer")
    bid, rec = _run(client, cust["id"], files=[("scan.pdf", fx.image_only_pdf())])
    pre = client.get(f"{B}/batches/{bid}/preview").json()["files"][0]
    assert pre["status"] == "manual_review" and pre["provider"] is None and not pre["holdings"]
    chk = next(c for c in rec["checks"] if c["check_code"] == "file_unreadable")
    r = client.post(f"{B}/checks/{chk['id']}/resolve", json={"action": "overridden", "reason": "trust me, it is fine really"})
    assert r.status_code == 422 and not rec["summary"]["can_approve"]


def test_material_discrepancy_needs_admin_override_with_recorded_reason(client, admin):
    cust = _user("customer")
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(fx.stallion_xlsx()))
    wb["Summary"]["B6"] = 320_000.0                                                       # total no longer equals holdings + cash
    b = io.BytesIO()
    wb.save(b)
    bid, rec = _run(client, cust["id"], files=[("st.xlsx", b.getvalue())])
    chk = next(c for c in rec["checks"] if c["check_code"] == "total_value" and c["status"] == "failed")
    assert chk["difference"] == pytest.approx(-5000.0) and chk["overridable"]
    assert client.post(f"{B}/batches/{bid}/approve", json={}).status_code == 409
    assert client.post(f"{B}/checks/{chk['id']}/resolve", json={"action": "overridden", "reason": "short"}).status_code == 422   # reason too short
    rm = _user("rm")
    _login(client, rm)
    # the RM has no access to this client at all; and even with access an RM cannot override an error
    assert client.post(f"{B}/checks/{chk['id']}/resolve", json={"action": "overridden", "reason": "long enough reason here"}).status_code == 403
    ops = _login(client, _user("operations"))                    # crm_user maps this staff role to "admin" for scoping; it must still not override
    sqlite_staff = sqlite3.connect(sqlite.db_path())
    sqlite_staff.execute("UPDATE customers SET is_staff = 1 WHERE id = ?", (ops["id"],))
    sqlite_staff.commit()
    r = client.post(f"{B}/checks/{chk['id']}/resolve", json={"action": "overridden", "reason": "operations staff must not override"})
    assert r.status_code == 403, r.text
    _login(client, admin)
    ok = client.post(f"{B}/checks/{chk['id']}/resolve", json={"action": "overridden", "reason": "Provider rounding confirmed by phone call"})
    assert ok.status_code == 200 and ok.json()["resolved_by"] == admin["id"]
    # a re-run keeps the override because the discrepancy is identical, and approval now succeeds with the override on the record
    assert client.post(f"{B}/batches/{bid}/validate").json()["summary"]["can_approve"]
    ap = client.post(f"{B}/batches/{bid}/approve", json={"generate_report": False}).json()
    res = client.get(f"{B}/snapshots/{ap['snapshot_id']}").json()["payload"]["reconciliation"]["resolutions"]
    assert res[0]["status"] == "overridden" and "phone call" in res[0]["reason"]


def test_revision_preserves_earlier_snapshot_report_and_audit(client, admin):
    cust = _user("customer")
    bid, _ = _run(client, cust["id"])
    first = client.post(f"{B}/batches/{bid}/approve", json={"generate_report": True}).json()
    snap1 = client.get(f"{B}/snapshots/{first['snapshot_id']}").json()
    assert client.post(f"{B}/batches", json={"client_id": cust["id"], "report_month": "2026-10", "valuation_date": "2026-10-31"}).status_code == 409
    # an approved batch accepts no more changes
    assert client.post(f"{B}/batches/{bid}/process", json={}).status_code == 409
    files = [("fundsindia_corrected.xlsx", fx.fundsindia_xlsx_corrected()), ("proaffluence_oct.pdf", fx.proaffluence_pdf()), ("stallion_oct.xlsx", fx.stallion_xlsx())]
    bid2, rec2 = _run(client, cust["id"], files=files, revises=bid)
    assert rec2["batch"]["revision_no"] == 2 and rec2["summary"]["can_approve"]
    second = client.post(f"{B}/batches/{bid2}/approve", json={"generate_report": True}).json()
    assert second["revision_no"] == 2 and second["report"]["version_no"] == 2
    hist = client.get(f"{B}/clients/{cust['id']}/history").json()["data"]
    assert [h["revision_no"] for h in hist] == [2, 1] and [h["is_latest_revision"] for h in hist] == [True, False]
    snap1_again = client.get(f"{B}/snapshots/{first['snapshot_id']}").json()
    assert snap1_again["payload_sha256"] == snap1["payload_sha256"] and snap1_again["total_value"] == pytest.approx(1_321_092.10)
    assert client.get(f"{B}/snapshots/{second['snapshot_id']}").json()["total_value"] == pytest.approx(1_321_092.10 - 36_000.0)   # Gamma 1000->900 units
    assert client.get(f"{B}/reports/{first['report']['id']}/download").status_code == 200       # v1 still downloadable
    with service.scope() as s:
        actions = list(s.scalars(service.select(service.m.ValAuditLog.action)))
    assert actions.count("batch_approved") == 2 and "report_generated" in actions


def test_month_on_month_uses_previous_approved_snapshot(client, admin):
    cust = _user("customer")
    bid, _ = _run(client, cust["id"], month="2026-09", vdate="2026-09-30", files=[("st.xlsx", fx.stallion_xlsx())])
    # September statement is dated 29 Oct in the fixture -> outside the month; override on purpose to build history
    rec = client.get(f"{B}/batches/{bid}/reconciliation").json()
    for c in rec["checks"]:
        if c["status"] == "failed" and c["severity"] == "error":
            assert client.post(f"{B}/checks/{c['id']}/resolve", json={"action": "overridden", "reason": "Synthetic history for MoM test"}).status_code == 200
    client.post(f"{B}/batches/{bid}/validate")
    assert client.post(f"{B}/batches/{bid}/approve", json={"generate_report": False}).status_code == 200
    bid2, rec2 = _run(client, cust["id"])
    cons = client.get(f"{B}/batches/{bid2}/consolidated").json()
    mom = cons["month_on_month"]
    assert mom["previous_month"] == "2026-09" and mom["previous_total"] == pytest.approx(315_000.0)
    assert mom["change"] == pytest.approx(1_321_092.10 - 315_000.0)


def test_snapshots_and_audit_are_append_only_at_database_level(client, admin):
    cust = _user("customer")
    bid, _ = _run(client, cust["id"])
    client.post(f"{B}/batches/{bid}/approve", json={"generate_report": True})
    con = sqlite3.connect(sqlite.db_path())
    for stmt in ("UPDATE val_snapshots SET total_value = 1", "DELETE FROM val_snapshots", "UPDATE val_report_versions SET size_bytes = 1",
                 "DELETE FROM val_audit_log", "UPDATE val_audit_log SET action = 'x'"):
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            con.execute(stmt)


def test_approval_is_atomic_when_a_step_fails(client, admin, monkeypatch):
    cust = _user("customer")
    bid, _ = _run(client, cust["id"])
    orig = service.audit

    def boom(s, actor, action, *a, **k):
        if action == "batch_approved":
            raise RuntimeError("disk full")
        return orig(s, actor, action, *a, **k)

    monkeypatch.setattr(service, "audit", boom)
    with pytest.raises(RuntimeError):
        with TestClient(client.app, raise_server_exceptions=True) as c2:
            c2.cookies.update(client.cookies)
            c2.post(f"{B}/batches/{bid}/approve", json={"generate_report": False})
    monkeypatch.setattr(service, "audit", orig)
    with service.scope() as s:
        assert s.scalar(service.select(service.func.count()).select_from(service.m.ValSnapshot)) == 0
        assert s.get(service.m.ValBatch, bid).status == "reconciled"                     # nothing half-applied
    assert client.post(f"{B}/batches/{bid}/approve", json={"generate_report": False}).status_code == 200


def test_encrypted_pdf_flow_uses_password_in_memory_only(client, admin):
    from pypdf import PdfWriter
    w = PdfWriter()
    for p in PdfReader(io.BytesIO(fx.proaffluence_pdf())).pages:
        w.add_page(p)
    w.encrypt("pw123")
    buf = io.BytesIO()
    w.write(buf)
    cust = _user("customer")
    bid = client.post(f"{B}/batches", json={"client_id": cust["id"], "report_month": "2026-10", "valuation_date": "2026-10-31"}).json()["id"]
    r = _upload(client, bid, [("pa.pdf", buf.getvalue())], provider="proaffluence")[0]["file"]
    assert r["status"] == "manual_review"
    out = client.post(f"{B}/batches/{bid}/process", json={"passwords": {r["id"]: "pw123"}}).json()
    assert out["files"][0]["status"] == "extracted" and out["files"][0]["totals"]["total_value"] == fx.PA["total"]
    with service.scope() as s:
        assert "pw123" not in (s.get(service.m.ValSourceFile, r["id"]).detect_note or "")


def test_input_validation(client, admin):
    cust = _user("customer")
    bad = {"client_id": cust["id"], "report_month": "2026-10", "valuation_date": "2026-11-02"}
    assert client.post(f"{B}/batches", json=bad).status_code == 422                        # valuation date outside month
    assert client.post(f"{B}/batches", json={**bad, "report_month": "2026-13"}).status_code == 422
    assert client.post(f"{B}/batches", json={**bad, "client_id": "nope", "valuation_date": "2026-10-31"}).status_code == 404
    bid = client.post(f"{B}/batches", json={**bad, "valuation_date": "2026-10-31"}).json()["id"]
    r = _upload(client, bid, [("a.docx", b"PK\x03\x04zzzz"), ("empty.xlsx", b"")])
    assert [x["status"] for x in r] == [415, 422]
    assert client.post(f"{B}/batches/{bid}/process", json={}).status_code == 422          # nothing usable uploaded
    assert client.get(f"{B}/batches/does-not-exist").status_code == 404


# ---------------- client-level access control
def test_rm_sees_only_own_clients_on_every_endpoint(client, admin):
    rm1, rm2 = _user("rm"), _user("rm")
    c1, c2 = _book(rm1, "One"), _book(rm2, "Two")
    _login(client, admin)
    b1, _ = _run(client, c1["id"])
    ap1 = client.post(f"{B}/batches/{b1}/approve", json={"generate_report": True}).json()
    b2, rec2 = _run(client, c2["id"], files=[("st.xlsx", fx.stallion_xlsx())])
    check2 = rec2["checks"][0]["id"]
    file2 = client.get(f"{B}/batches/{b2}/preview").json()["files"][0]["id"]

    _login(client, rm1)
    assert [b["client_id"] for b in client.get(f"{B}/batches").json()["data"]] == [c1["id"]]          # list is scoped
    assert client.get(f"{B}/batches/{b1}").status_code == 200
    assert client.get(f"{B}/clients/{c1['id']}/history").status_code == 200
    assert client.get(f"{B}/reports/{ap1['report']['id']}/download").status_code == 200
    # every other client's data: 403 on every endpoint
    forbidden = [("get", f"/batches/{b2}"), ("get", f"/batches/{b2}/preview"), ("get", f"/batches/{b2}/reconciliation"),
                 ("get", f"/batches/{b2}/consolidated"), ("post", f"/batches/{b2}/process"), ("post", f"/batches/{b2}/validate"),
                 ("post", f"/batches/{b2}/approve"), ("delete", f"/files/{file2}"), ("patch", f"/files/{file2}/provider"),
                 ("post", f"/checks/{check2}/resolve"), ("get", f"/clients/{c2['id']}/history"), ("get", f"/batches?client_id={c2['id']}")]
    for method, path in forbidden:
        kw = {"json": {}} if method in ("post", "patch") else {}
        if "resolve" in path:
            kw = {"json": {"action": "resolved", "reason": "a sufficiently long reason"}}
        if "provider" in path:
            kw = {"json": {"provider": "stallion"}}
        r = getattr(client, method)(B + path, **kw)
        assert r.status_code == 403, (method, path, r.status_code)
    assert client.post(f"{B}/batches", json={"client_id": c2["id"], "report_month": "2026-11", "valuation_date": "2026-11-30"}).status_code == 403
    assert client.post(f"{B}/batches/{b2}/files", files=[("files", ("a.xlsx", b"x"))]).status_code == 403
    # RM2 cannot fetch RM1's snapshot or report either
    _login(client, rm2)
    assert client.get(f"{B}/snapshots/{ap1['snapshot_id']}").status_code == 403
    assert client.get(f"{B}/reports/{ap1['report']['id']}/download").status_code == 403
    assert client.post(f"{B}/snapshots/{ap1['snapshot_id']}/report").status_code == 403


def test_customers_and_anonymous_users_are_refused_and_compliance_is_read_only(client, admin):
    cust = _user("customer")
    bid, _ = _run(client, cust["id"])
    _login(client, _user("customer"))
    assert client.get(f"{B}/batches").status_code == 403
    _login(client, _user("compliance"))
    assert client.get(f"{B}/batches/{bid}").status_code == 200                              # read everything
    assert client.post(f"{B}/batches/{bid}/approve", json={}).status_code == 403            # but write nothing
    assert client.post(f"{B}/batches", json={"client_id": cust["id"], "report_month": "2026-11", "valuation_date": "2026-11-30"}).status_code == 403
    client.cookies.clear()
    assert client.get(f"{B}/batches").status_code == 401
    assert client.get(f"{B}/providers").status_code == 401


def test_xirr_appears_only_after_admin_attests_flows_and_matches_independent_solution(client, admin):
    from datetime import date

    from scipy.optimize import brentq

    cust = _user("customer")
    pms_only = [("proaffluence_oct.pdf", fx.proaffluence_pdf()), ("stallion_oct.xlsx", fx.stallion_xlsx(deposit=600_000.0))]
    bid, _ = _run(client, cust["id"], files=pms_only)
    cons = client.get(f"{B}/batches/{bid}/consolidated").json()
    assert cons["performance"]["consolidated"]["xirr"]["value"] is None and "not confirmed" in cons["performance"]["consolidated"]["xirr"]["reason"]
    accounts = [a for f in client.get(f"{B}/batches/{bid}/preview").json()["files"] for a in f["accounts"]]
    for a in accounts:
        assert client.post(f"{B}/accounts/{a['id']}/attest-flows", json={"reason": "Confirmed complete from inception ledger"}).status_code == 200
    assert client.post(f"{B}/batches/{bid}/validate").json()["summary"]["can_approve"]
    got = client.get(f"{B}/batches/{bid}/consolidated").json()["performance"]["consolidated"]["xirr"]["value"]
    d = lambda s: (date.fromisoformat(s) - date(2026, 4, 2)).days / 365.25                    # noqa: E731
    flows = [(0.0, -600_000.0), (d("2026-10-15"), 20_000.0), (d("2026-10-15"), -100_000.0),
             (d("2026-10-31"), 445_000.0), (d("2026-10-29"), 315_000.0)]                # each account closes on its own date
    ref = brentq(lambda r: sum(c / (1 + r) ** t for t, c in flows), -0.9, 50) * 100
    assert got == pytest.approx(ref, abs=0.01)
    rm = _user("rm")
    _login(client, rm)
    assert client.post(f"{B}/accounts/{accounts[0]['id']}/attest-flows", json={"reason": "Confirmed complete from inception ledger"}).status_code == 403


def test_manual_holding_corrections_are_audited_and_blocked_after_approval(client, admin):
    cust = _user("customer")
    bid, _ = _run(client, cust["id"])
    prev = client.get(f"{B}/batches/{bid}/preview").json()
    acct = prev["files"][0]["accounts"][0]["id"]
    rows = client.get(f"{B}/batches/{bid}/holdings").json()["data"]
    hid, mv = rows[0]["id"], rows[0]["market_value"]
    # no reason, no change
    assert client.patch(f"{B}/holdings/{hid}", json={"market_value": 1}).status_code == 422
    r = client.patch(f"{B}/holdings/{hid}", json={"market_value": mv + 100, "reason": "Corrected from the printed statement"})
    assert r.status_code == 200 and r.json()["market_value"] == mv + 100 and r.json()["validation_status"] == "warning"
    assert client.get(f"{B}/batches/{bid}").json()["batch"]["status"] == "processed"  # must be validated again
    # add and remove a manual holding
    a = client.post(f"{B}/accounts/{acct}/holdings", json={"security_name": "Manual Co", "market_value": 500, "asset_type": "equity", "reason": "Missing from the statement"})
    assert a.status_code == 201 and a.json()["source_page"] == "manual"
    d = client.request("DELETE", f"{B}/holdings/{a.json()['id']}", json={"reason": "Added by mistake earlier"})
    assert d.status_code == 200
    with sqlite3.connect(sqlite.db_path()) as c:
        acts = [x[0] for x in c.execute("SELECT action FROM val_audit_log WHERE batch_id = ?", (bid,))]
    assert {"holding_edited", "holding_added", "holding_removed"} <= set(acts)
    # an edit that breaks the provider's totals blocks approval; put the true figure back, then approve
    assert client.patch(f"{B}/holdings/{hid}", json={"market_value": mv, "reason": "Restored to the statement figure"}).status_code == 200
    client.post(f"{B}/batches/{bid}/validate")
    assert client.post(f"{B}/batches/{bid}/approve", json={"generate_report": False}).status_code == 200
    assert client.patch(f"{B}/holdings/{hid}", json={"market_value": 1, "reason": "Trying after approval"}).status_code == 409
    # discard an open batch
    bid2, _ = _run(client, _user("customer")["id"])
    assert client.request("DELETE", f"{B}/batches/{bid2}", json={"reason": "Wrong client selected"}).status_code == 200
    assert client.get(f"{B}/batches/{bid2}").json()["batch"]["status"] == "rejected"
