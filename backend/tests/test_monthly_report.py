import sqlite3

import pytest
from fastapi import HTTPException

from app.api import monthly_report as mr_api
from app.api.monthly_report import PushIn, history, latest, push, stored_pdf
from app.report.monthly_report import (
    build_monthly_report,
    parse_monthly_buckets,
    parse_monthly_files,
    summarize_monthly,
)

# Fixture text in the layout of the one-page monthly bucket report: same bucket
# names and amounts as the September example, with a generic client name and no
# contact details, so no real client's details live in the test suite.
MONTHLY_TEXT = """PORTFOLIO XIRR
A B Test
Value As On- 1-09-2026
Inception Date - 30 Apr 2020
Investments Invested amount Current value Gain/losses (%) Weightage (%)XIRR
Mutual funds
Debt Portfolio 41,12,800 60,61,476 19,48,676 9% 6.34%
Equity Portfolio 37,97,957 57,88,916 19,90,959 8% 12.99%
31st March 2023 1,34,99,325 1,70,98,796 35,99,471 24% 7.14%
1st April 2023 39,99,800 51,22,277 11,22,477 7% 7.52%
STP Portfolio 69,55,097 81,17,874 11,62,777 11% 7.92%
offline 1,19,43,751 2,88,44,397 1,69,00,646 41% 13.37%
Total 4,43,08,730 7,10,33,736 2,67,25,006 100.00% 7.49%
COMPLETE PORTFOLIO
Mutual funds 4,43,08,730 7,10,33,736 2,67,25,006 100% 7.49%
PMS 0 0 0 0 0
Total 4,43,08,730 7,10,33,736 2,67,25,006 100% 7.49%
"""

VALUATION_TEXT = """Portfolio Valuation Report - Folio Wise   Fund Horizon
A B Test   ARN: 345439  |  Phone: 1111111111
23 Oct 2026
1   Bandhan Nifty 50 Index Fund-  2696308/03   3,52,103.35   3,52,103.35   0.00   0.00   16,250.46   49.07   7,97,440.90   1.94%   126.48%   14.31%
  Reg(G)
Grand Total   3,52,103.35   3,52,103.35   0.00   0.00   7,97,440.90   100.00%   126.48%   14.31%
"""


def _report():
    d = parse_monthly_buckets(MONTHLY_TEXT)
    assert d is not None
    return {
        "client": d["client"], "month": "september 2026", "inception": d["inception"],
        "total_xirr": d["total_xirr"], "buckets": d["buckets"], "pms": d["pms"], "factsheets": [],
    }


def test_monthly_bucket_text_parses_to_six_rows_and_exact_totals():
    d = parse_monthly_buckets(MONTHLY_TEXT)
    assert d is not None
    assert [b["name"] for b in d["buckets"]] == [
        "Debt Portfolio", "Equity Portfolio", "31st March 2023",
        "1st April 2023", "STP Portfolio", "offline",
    ]
    assert d["totals"] == {"invested": 44308730.0, "current": 71033736.0, "gain": 26725006.0}
    assert d["total_xirr"] == 7.49
    assert d["pms"] == {"invested": 0.0, "current": 0.0, "xirr": 0.0}
    assert d["inception"] == "30 Apr 2020"
    assert d["client"]["name"] == "A B Test" and d["client"]["date"] == "1-09-2026"


def test_total_xirr_is_never_an_average_of_bucket_xirrs():
    r = _report()
    t = summarize_monthly(r)
    weighted = sum(b["current"] * b["xirr"] for b in r["buckets"]) / t["current"]
    assert abs(weighted - 10.19) < 0.02
    assert r["total_xirr"] == 7.49
    assert t["gain"] == 26725006.0


def test_gain_and_weight_recompute_when_a_value_is_edited():
    r = _report()
    r["buckets"][0]["current"] = 7061476.0  # Debt current +10,00,000
    t = summarize_monthly(r)
    assert r["buckets"][0]["gain"] == 7061476.0 - 4112800.0
    assert abs(sum(b["weight"] for b in r["buckets"]) - 100.0) < 0.01
    assert t["current"] == 71033736.0 + 1000000.0
    assert t["complete"]["current"] == t["current"]  # PMS is zero here


def test_pms_zero_report_builds_and_pdf_starts_with_magic():
    pdf = build_monthly_report(_report())
    assert pdf.startswith(b"%PDF")
    r = _report()
    r["pms"] = {"invested": 5000000.0, "current": 6200000.0, "xirr": 8.5}
    pdf = build_monthly_report(r)
    assert pdf.startswith(b"%PDF")
    t = summarize_monthly(r)
    assert t["complete"]["current"] == 71033736.0 + 6200000.0


def test_parse_monthly_files_keeps_valuation_as_cross_check_only(monkeypatch):
    def fake_extract(name, _data):
        return MONTHLY_TEXT if name == "m.pdf" else VALUATION_TEXT

    monkeypatch.setattr("app.report.monthly_report.extract_text", fake_extract)
    d = parse_monthly_files([("m.pdf", b""), ("v.pdf", b"")])
    assert len(d["buckets"]) == 6
    assert d["warnings"] == []
    assert d["valuation"] is not None
    assert d["valuation"]["invested"] == 352103.35
    assert d["valuation"]["value"] == 797440.90
    assert d["valuation"]["rows"] == 1


def test_non_monthly_text_returns_none():
    assert parse_monthly_buckets("hello world\nno tables here\n") is None


# ------------------------------------------------------- custom clients ----
# Corrected design: a custom client becomes a proper CRM customer + household
# at Create Report time. No portal login is ever created or returned here.

ADMIN = {"id": "staff-admin", "role": "admin"}


def _db(tmp_path):
    conn = sqlite3.connect(str(tmp_path / "test.db"))
    conn.row_factory = sqlite3.Row
    return conn


def _table(conn, name):
    try:
        return [dict(r) for r in conn.execute(f"SELECT * FROM {name}").fetchall()]
    except sqlite3.OperationalError:
        return []  # table not created yet because the push failed before any write


def _custom_push(monkeypatch, tmp_path, **overrides):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("DATABASE_URL", "")
    body = {
        "custom_client": {"name": "Test Custom Client", "mobile": "9876543210", "email": "customtest@example.com"},
        "report": _report(), "send_email": False,
    }
    body.update(overrides)
    return push(PushIn(**body), ADMIN)


def test_custom_create_makes_customer_household_primary_and_report_retrievable(monkeypatch, tmp_path):
    r = _custom_push(monkeypatch, tmp_path)
    assert r["matched_existing"] is False
    assert r["customer_id"] and r["household_id"] and r["emailed"] is False
    assert "password" not in r and "temp_password" not in r  # no usable login is ever returned
    conn = _db(tmp_path)
    customers = _table(conn, "customers")
    assert len(customers) == 1
    cust = customers[0]
    assert (cust["id"], cust["name"], cust["email"], cust["mobile"], cust["role"]) == (
        r["customer_id"], "Test Custom Client", "customtest@example.com", "9876543210", "customer")
    assert cust["password_hash"].startswith("pbkdf2_sha256$")
    assert cust["assigned_rm_id"] is None  # admin creator, not an RM
    households = _table(conn, "households")
    assert len(households) == 1
    assert households[0]["id"] == r["household_id"]
    assert households[0]["name"] == "Test Custom Client"
    assert households[0]["primary_customer_id"] == r["customer_id"]
    members = _table(conn, "household_members")
    assert len(members) == 1
    assert members[0]["household_id"] == r["household_id"]
    assert members[0]["customer_id"] == r["customer_id"] and members[0]["role"] == "primary"
    reports = _table(conn, "monthly_reports")
    assert len(reports) == 1
    assert reports[0]["customer_id"] == r["customer_id"] and reports[0]["household_id"] == r["household_id"]
    assert reports[0]["pdf"][:4] == b"%PDF"
    conn.close()
    assert [h["report_month"] for h in history(r["customer_id"], ADMIN)] == ["september 2026"]
    assert latest(r["customer_id"], ADMIN)["report"]["month"] == "september 2026"
    assert stored_pdf(r["id"], ADMIN).body[:4] == b"%PDF"


def test_custom_duplicate_email_reuses_existing_customer(monkeypatch, tmp_path):
    first = _custom_push(monkeypatch, tmp_path)
    second = _custom_push(monkeypatch, tmp_path,
                          custom_client={"name": "A Different Name", "mobile": "9111111111", "email": "customtest@example.com"})
    assert second["matched_existing"] is True
    assert second["customer_id"] == first["customer_id"]
    assert second["household_id"] == first["household_id"]
    conn = _db(tmp_path)
    assert len(_table(conn, "customers")) == 1
    assert len(_table(conn, "households")) == 1
    assert len(_table(conn, "monthly_reports")) == 2
    conn.close()


def test_custom_duplicate_mobile_reuses_existing_customer(monkeypatch, tmp_path):
    first = _custom_push(monkeypatch, tmp_path)
    second = _custom_push(monkeypatch, tmp_path,
                          custom_client={"name": "Another Name", "mobile": "9876543210", "email": "other@example.com"})
    assert second["matched_existing"] is True
    assert second["customer_id"] == first["customer_id"]
    conn = _db(tmp_path)
    assert len(_table(conn, "customers")) == 1
    conn.close()


def test_custom_email_and_mobile_matching_different_customers_is_422(monkeypatch, tmp_path):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("DATABASE_URL", "")
    from app.db import sqlite as sqlite_mod
    sqlite_mod.create_customer(name="First Person", email="first@example.com", mobile="9000000001",
                               password_hash="pbkdf2_sha256$1$aa$bb", role="customer")
    sqlite_mod.create_customer(name="Second Person", email="second@example.com", mobile="9000000002",
                               password_hash="pbkdf2_sha256$1$aa$bb", role="customer")
    with pytest.raises(HTTPException) as exc:
        push(PushIn(custom_client={"name": "Test Custom Client", "mobile": "9000000002", "email": "first@example.com"},
                    report=_report(), send_email=False), ADMIN)
    assert exc.value.status_code == 422


def test_custom_blank_name_is_422_and_creates_nothing(monkeypatch, tmp_path):
    with pytest.raises(HTTPException) as exc:
        _custom_push(monkeypatch, tmp_path, custom_client={"name": "   ", "mobile": "", "email": ""})
    assert exc.value.status_code == 422
    conn = _db(tmp_path)
    assert _table(conn, "customers") == []
    assert _table(conn, "monthly_reports") == []
    conn.close()


def test_custom_name_only_uses_placeholders_and_skips_email(monkeypatch, tmp_path):
    r = _custom_push(monkeypatch, tmp_path, send_email=True,
                     custom_client={"name": "Test Custom Client", "mobile": "", "email": ""})
    assert r["emailed"] is False
    assert r["email_error"] == "No email address on file for this client."
    conn = _db(tmp_path)
    cust = _table(conn, "customers")[0]
    assert cust["email"].startswith("no-email-") and cust["email"].endswith("@placeholder.invalid")
    assert cust["mobile"].startswith("0000")
    conn.close()


def test_custom_with_valid_email_sends_via_household_path(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr(mr_api, "send_email", lambda to, subj, text, attachments: sent.append(to) or "resend:1")
    r = _custom_push(monkeypatch, tmp_path, send_email=True)
    assert r["emailed"] is True and r["email_error"] is None
    assert sent == ["customtest@example.com"]
    conn = _db(tmp_path)
    assert _table(conn, "monthly_reports")[0]["emailed_at"] is not None
    kinds = [a["kind"] for a in _table(conn, "activities")]
    assert "email" in kinds and "note" in kinds
    conn.close()


def test_report_failure_after_crm_creation_is_reported_honestly(monkeypatch, tmp_path):
    monkeypatch.setattr(mr_api, "build_monthly_report", lambda data: (_ for _ in ()).throw(RuntimeError("pdf boom")))
    with pytest.raises(HTTPException) as exc:
        _custom_push(monkeypatch, tmp_path)
    assert exc.value.status_code == 500
    assert "but the report was not saved" in exc.value.detail
    conn = _db(tmp_path)
    assert len(_table(conn, "customers")) == 1  # CRM record stands; only the report is missing
    assert _table(conn, "monthly_reports") == []
    conn.close()


def test_household_push_behaviour_is_unchanged(monkeypatch, tmp_path):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("DATABASE_URL", "")
    from app.db import sqlite as sqlite_mod
    from app.repo_crm_core import get_crm_repository
    cust = sqlite_mod.create_customer(name="Household Client", email="household@example.com", mobile="9811111111",
                                      password_hash="pbkdf2_sha256$1$aa$bb", role="customer")
    repo = get_crm_repository()
    hh = repo.create_household(name="Household Client", primary_customer_id=cust["id"], actor_id="staff-admin")
    repo.add_household_member(household_id=hh["id"], customer_id=cust["id"], role="primary", actor_id="staff-admin")
    r = push(PushIn(customer_id=cust["id"], household_id=hh["id"], report=_report(), send_email=False), ADMIN)
    assert r["emailed"] is False and r["matched_existing"] is False
    assert [h["report_month"] for h in history(cust["id"], ADMIN)] == ["september 2026"]


# ------------------------------------------------------- phase 2 --------
# Valuation prefill, multi-file order independence, OCR, logo.

from pathlib import Path

import app.report.monthly_report as mr_mod
from app.report.monthly_report import PREFILL_BUCKET_NAME


def test_valuation_only_upload_prefills_one_labelled_bucket(monkeypatch):
    monkeypatch.setattr("app.report.monthly_report.extract_text", lambda n, _d: VALUATION_TEXT)
    d = parse_monthly_files([("v.pdf", b"")])
    # Exactly one bucket, honestly labelled — never a per-fund or per-category
    # split invented from fund names.
    assert [b["name"] for b in d["buckets"]] == [PREFILL_BUCKET_NAME]
    assert d["buckets"][0]["invested"] == 352103.35
    assert d["buckets"][0]["current"] == 797440.90
    assert d["buckets"][0]["xirr"] == 14.31
    # The valuation is still kept as the cross-check alongside the prefill.
    assert d["valuation"] is not None and d["valuation"]["invested"] == 352103.35
    assert d["file_results"] == [
        {"name": "v.pdf", "kind": "valuation", "method": "text", "buckets": 0, "valuation_rows": 1, "factsheet_items": 0}
    ]


def test_monthly_plus_valuation_in_either_order_gives_same_buckets_and_cross_check(monkeypatch):
    def fake_extract(name, _data):
        return MONTHLY_TEXT if name == "m.pdf" else VALUATION_TEXT

    monkeypatch.setattr("app.report.monthly_report.extract_text", fake_extract)
    a = parse_monthly_files([("m.pdf", b""), ("v.pdf", b"")])
    b = parse_monthly_files([("v.pdf", b""), ("m.pdf", b"")])
    assert [x["name"] for x in a["buckets"]] == [x["name"] for x in b["buckets"]]
    assert len(a["buckets"]) == 6  # real monthly buckets win, not the prefill
    assert a["valuation"] == b["valuation"]
    assert a["warnings"] == b["warnings"] == []
    assert sorted(r["kind"] for r in a["file_results"]) == ["monthly", "valuation"]
    assert sorted(r["kind"] for r in b["file_results"]) == ["monthly", "valuation"]


def test_second_monthly_and_second_valuation_are_ignored_with_warning(monkeypatch):
    monkeypatch.setattr("app.report.monthly_report.extract_text", lambda n, _d: MONTHLY_TEXT if n.startswith("m") else VALUATION_TEXT)
    d = parse_monthly_files([("m1.pdf", b""), ("m2.pdf", b""), ("v1.pdf", b""), ("v2.pdf", b"")])
    assert len(d["buckets"]) == 6
    assert d["valuation"]["rows"] == 1
    assert any("second monthly report" in w for w in d["warnings"])
    assert any("second valuation" in w for w in d["warnings"])


def test_file_results_name_image_reads_as_ocr(monkeypatch):
    def fake_extract(name, _data):
        return "Some Fund Portfolio\nNAV: 123.45\n" if name.endswith(".png") else MONTHLY_TEXT

    monkeypatch.setattr("app.report.monthly_report.extract_text", fake_extract)
    d = parse_monthly_files([("fs.png", b"")])
    assert d["file_results"][0]["kind"] == "factsheet"
    assert d["file_results"][0]["method"] == "ocr"
    assert d["file_results"][0]["factsheet_items"] == 1


def test_built_pdf_embeds_official_logo_and_grows_vs_text_only(monkeypatch, tmp_path):
    pdf = build_monthly_report(_report())
    assert pdf.startswith(b"%PDF")
    assert b"/Subtype /Image" in pdf  # an embedded image XObject, not text art
    monkeypatch.setattr(mr_mod, "LOGO_PATH", tmp_path / "missing-logo.png")
    plain = build_monthly_report(_report())
    assert plain.startswith(b"%PDF")  # missing logo never breaks the PDF
    assert b"/Subtype /Image" not in plain
    assert len(pdf) > len(plain)


# Note: a synthetic Helvetica page was tried as a portable OCR stand-in, but
# RapidOCR drops whole rows on it at several font/spacing settings, so it
# tests the renderer more than the parser. The September test below — the
# real Excel-rendered page — is the OCR regression test.
def test_ocr_on_rendered_september_page_recovers_six_buckets_and_totals():
    # The real September one-page report (a user file, not a repo fixture):
    # skipped wherever it is not present, so the suite stays portable.
    import pytest as _pytest

    _pytest.importorskip("pypdfium2")
    _pytest.importorskip("rapidocr_onnxruntime")
    import io as _io

    import pypdfium2
    from app.report.client_report import extract_text

    sept = Path.home() / "workspace" / "user" / "files" / "Satish_Nandlal_Vora_Monthly_report_september_2026.pdf"
    if not sept.exists():
        _pytest.skip("September monthly PDF not present in this checkout")
    pdf = pypdfium2.PdfDocument(sept.read_bytes())
    img = pdf[0].render(scale=2.5).to_pil()
    png = _io.BytesIO()
    img.save(png, format="PNG")
    ocr_text = extract_text("september-page.png", png.getvalue())
    d = parse_monthly_buckets(ocr_text)
    assert d is not None
    assert len(d["buckets"]) == 6
    assert abs(d["totals"]["invested"] - 44308730.0) / 44308730.0 < 0.02
    assert abs(d["totals"]["current"] - 71033736.0) / 71033736.0 < 0.02
    assert abs((d["total_xirr"] or 0) - 7.49) < 0.5


def test_ocr_failure_is_a_warning_not_a_500(monkeypatch):
    from app.report import monthly_report as m, statements

    monkeypatch.setattr(m, "extract_text", lambda n, d: "FundsIndia portfolio")
    monkeypatch.setattr(statements, "parse_provider_statement", lambda *a: (_ for _ in ()).throw(RuntimeError("oom")))
    out = m.parse_monthly_files([("FundsIndia - a.pdf", b"x")])
    assert out["file_results"][0]["kind"] == "error" and out["warnings"]


def test_error_is_exact_and_files_run_in_parallel(monkeypatch):
    from app.report import monthly_report as m

    def boom(n, d):
        if n == "bad.pdf":
            raise RuntimeError("onnx exploded")
        return "nothing here"

    monkeypatch.setattr(m, "extract_text", boom)
    out = m.parse_monthly_files([("bad.pdf", b"x"), ("ok.pdf", b"y")])
    assert out["file_results"][0]["error"] == "RuntimeError: onnx exploded"
    assert out["file_results"][1]["kind"] == "unrecognised"


def test_unticked_boxes_are_left_out_of_the_pdf():
    import io
    from pypdf import PdfReader

    from app.api.monthly_report import MonthlyReport
    from app.report.monthly_report import parse_monthly_buckets

    data = parse_monthly_buckets(MONTHLY_TEXT)
    data["month"] = "September 2026"
    data["pms"] = {"invested": 11033696.0, "current": 22271735.0, "xirr": 27.14, "hide": ["xirr", "invested"]}
    data["factsheets"] = [{"source": "Stallion", "items": [{"label": "Strategy", "value": "CORE-SHOWN"}, {"label": "Inception", "value": "SECRET-HIDDEN", "show": False}]}]
    pdf = build_monthly_report(MonthlyReport(**data).model_dump())
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "CORE-SHOWN" in text and "SECRET-HIDDEN" not in text
    assert "1,10,33,696" not in text and "27.14" not in text and "2,22,71,735" in text
