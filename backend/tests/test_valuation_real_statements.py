"""Real demo statements (kept outside the repo: client data). Set FH_REAL_STATEMENTS to the folder holding them; skipped otherwise."""
import os
from pathlib import Path

import pytest

from app.backoffice.valuation import config as vcfg  # noqa: F401
from app.backoffice.valuation import service

D = Path(os.environ.get("FH_REAL_STATEMENTS", Path.home() / "Downloads"))
FI = D / "portfolio-valuation_1058662_FOLIO_WISE_20261105.pdf"
BUNDLE = D / "Shivanand Narsing Gulvady Summary Report as on 31-10-2026 (1).pdf"
pytestmark = pytest.mark.skipif(not (FI.exists() and BUNDLE.exists()), reason="real demo statements not present")


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "val.db"))
    monkeypatch.setenv("FH_VAL_STORE", str(tmp_path / "private"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    service._ENGINES.clear()


def _run(files, client="c1"):
    b = service.create_batch(client, "2026-10", "2026-10-31", "tester")
    for f in files:
        service.add_upload(b["id"], f.name, f.read_bytes(), "tester")
    return b["id"], service.process(b["id"], "tester")


def test_folio_wise_matches_provider_totals(env):
    _, pv = _run([FI])
    f = pv["files"][0]
    assert f["provider"] == "fundsindia" and len(f["holdings"]) == 23
    assert abs(sum(h["market_value"] for h in f["holdings"]) - 8211461.64) < 0.05
    assert abs(sum(h["invested_amount"] for h in f["holdings"]) - 6358631.43) < 0.005
    assert f["totals"]["reported_xirr"] == 5.99 and len(f["accounts"]) == 12 and None not in {a["account_no"] for a in f["accounts"]}


def test_bundle_split_into_sections(env):
    _, pv = _run([BUNDLE])
    by = {f["filename"].split(" - ", 1)[1]: f for f in pv["files"]}
    assert len(pv["files"]) == 4, list(by)
    assert {k: len(f["holdings"]) for k, f in by.items()} == {"MF summary.pdf": 4, "Stallion Core Fund.pdf": 48, "Incred Healthcare Portfolio.pdf": 17, "Direct equity.pdf": 4}
    st = next(f for k, f in by.items() if "Stallion" in k)
    assert st["totals"]["total_invested"] == 47000000 - 85829 and st["meta"]["account_no"] == "100381"
    assert not any(f["errors"] for f in pv["files"]), [f["errors"] for f in pv["files"]]


def test_report_has_provider_returns_dashboard_gap_and_factsheet_annexure(env):
    import io

    from pypdf import PdfReader

    b, _ = _run([FI, BUNDLE])
    service.reconcile(b, "t")
    from sqlalchemy import select

    from app.backoffice.valuation import models as m

    with service.scope() as s:
        ids = [c.id for c in s.scalars(select(m.ValReconciliation).where(m.ValReconciliation.severity == "error", m.ValReconciliation.status == "failed"))]
    for i in ids:  # the demo FundsIndia report is dated 5 Nov, outside the October month: an admin override is the documented path
        service.resolve_check(i, "overridden", "demo statements span two months", "t", "admin")
    service.reconcile(b, "t")
    ap = service.approve(b, "admin")
    pl = service.get_snapshot(ap["snapshot_id"])["payload"]
    assert pl["reported"]["dashboard"]["latest_value"] == 183888226 and abs(pl["reported"]["dashboard"]["difference_pct"] - 2.6693) < 0.001
    assert {r["xirr_pct"] for r in pl["reported"]["statement_xirr"]} == {5.99, 24.32, 3.78}
    matched = [e for e in pl["fund_sheets"] if e["matched"]]
    assert len(matched) >= 22 and all(e["nav_check"]["ok"] in (True, None) for e in matched)        # no NAV disagreement with AMFI
    rv = service.generate_report(ap["snapshot_id"], "admin", "Test Client")
    text = "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(service.report_bytes(rv["id"])[0])).pages)
    for needle in ("Returns printed by providers", "Distributor dashboard cross-check", "Annexure D", "Stallion / STALLION CORE FUND"):
        assert needle in text


def test_paperwork_reads_every_section_of_the_bundle_and_flags_mixed_clients():
    from app.report.monthly_report import parse_monthly_files

    one = parse_monthly_files([(BUNDLE.name, BUNDLE.read_bytes())])
    assert {b["name"] for b in one["buckets"]} == {"Proaffluence mutual funds", "Direct equity"}
    assert one["pms"]["invested"] == 72_000_000 - 0 and one["pms"]["current"] == 128_632_974 and one["pms"]["xirr"] == 15.03
    assert one["total_xirr"] == 14.13 and len(one["factsheets"]) == 2
    both = parse_monthly_files([(FI.name, FI.read_bytes()), (BUNDLE.name, BUNDLE.read_bytes())])
    assert any("different clients" in w for w in both["warnings"])
