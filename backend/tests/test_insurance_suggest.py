import re
from types import SimpleNamespace

from app.config import disclosures as d
from app.data import insurance_plans as ip
from app.engine import insurance_suggest as sg
from app.engine.pipeline import build_full_plan

BANNED = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(d.BANNED_WORDS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def _csr_num(entry: dict) -> float:
    return float(entry["claim_settlement"].split("%")[0].split("–")[0].split("-")[0])


def test_term_shortlist_is_csr_ordered_with_marked_pick():
    block = sg.suggest_term_cover(24_000_000, 35, 2)
    assert block is not None
    assert block["kind"] == "term"
    assert block["gap"] == 24_000_000
    assert block["researched_on"] == "2026-10"
    assert len(block["plans"]) == 4
    assert [p["marked_pick"] for p in block["plans"]] == [True, False, False, False]
    csrs = [_csr_num(p) for p in block["plans"]]
    assert csrs == sorted(csrs, reverse=True)
    for p in block["plans"]:
        assert p["insurer"] and p["plan"] and p["features"] and p["why_included"]
        assert "FY 2024-25" in p["claim_settlement"]
    # The reason refers to the customer's own numbers.
    blob = " ".join(block["pick_reason"])
    assert "2.40 Cr" in blob and "2 dependents" in blob


def test_no_term_gap_gives_no_block():
    assert sg.suggest_term_cover(0, 35, 2) is None
    assert sg.suggest_term_cover(-5, 35, 2) is None


def test_health_shortlist_with_marked_pick():
    block = sg.suggest_health_cover(1_000_000, 35, 2, 1_500_000)
    assert block is not None
    assert block["kind"] == "health"
    assert len(block["plans"]) == 4
    assert block["plans"][0]["marked_pick"] is True
    blob = " ".join(block["pick_reason"])
    assert "15.00 L" in blob  # health target surfaced in the reason


def test_no_health_gap_gives_no_block():
    assert sg.suggest_health_cover(0, 35, 2, 1_500_000) is None


def test_suggest_cover_plans_wires_client_and_insurance():
    client = SimpleNamespace(age=35, dependents=2)
    out = sg.suggest_cover_plans(
        client,
        {"term": {"gap": 24_000_000}, "health": {"gap": 1_000_000, "target": 1_500_000}},
    )
    assert out["term"]["kind"] == "term"
    assert out["health"]["kind"] == "health"


def test_no_banned_words_in_insurance_copy():
    offenders = []
    for coll in (ip.TERM_PLANS, ip.HEALTH_PLANS):
        for p in coll:
            for v in (*p.values(),):
                if isinstance(v, str) and BANNED.search(v):
                    offenders.append((p["plan"], v[:60]))
                if isinstance(v, list):
                    for item in v:
                        if BANNED.search(item):
                            offenders.append((p["plan"], item[:60]))
    assert not BANNED.search(d.INSURANCE_SHORTLIST_NOTE)
    assert not offenders, offenders


def test_pipeline_attaches_suggestions(personas, eligible, monkeypatch):
    import app.engine.pipeline as pl

    monkeypatch.setattr(pl, "stress_test", lambda *a, **k: pl._empty_stress())
    r = build_full_plan(personas["mid_career_dependents"], eligible)
    sugg = r["insurance_suggestions"]
    assert sugg["term"] is not None  # persona carries a term gap
    assert sugg["health"] is not None  # and a health gap
    assert sugg["term"]["plans"][0]["marked_pick"] is True


def test_pipeline_omits_term_block_without_gap(personas, eligible, monkeypatch):
    import app.engine.pipeline as pl

    monkeypatch.setattr(pl, "stress_test", lambda *a, **k: pl._empty_stress())
    r = build_full_plan(personas["near_retirement"], eligible)
    sugg = r["insurance_suggestions"]
    assert sugg["term"] is None  # term need is 0 for this persona
    assert sugg["health"] is not None


def test_insurance_document_generation_pdf():
    from app.report.insurance_doc import build_insurance_plan_pdf

    sample_plan = ip.TERM_PLANS[0]
    pdf_bytes = build_insurance_plan_pdf(sample_plan)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500
    assert pdf_bytes.startswith(b"%PDF")


def test_insurance_document_endpoint():
    from fastapi.testclient import TestClient

    from app.main import create_app

    client = TestClient(create_app())
    # Test PDF download
    res = client.get("/api/insurance/document/smart-term-plan-plus")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert "attachment" in res.headers["content-disposition"]
    assert "Smart_Term_Plan_Plus" in res.headers["content-disposition"]
    assert res.content.startswith(b"%PDF")

    # Test web redirect
    res_web = client.get("/api/insurance/document/smart-term-plan-plus?action=web", follow_redirects=False)
    assert res_web.status_code in (302, 307)
    assert "maxlifeinsurance.com" in res_web.headers["location"]

    # Test 404 for unknown plan
    res_404 = client.get("/api/insurance/document/non-existent-plan")
    assert res_404.status_code == 404

