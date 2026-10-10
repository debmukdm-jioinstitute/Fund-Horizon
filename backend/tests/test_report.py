import json
import re
import socket
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from reportlab.platypus import Paragraph

from app.api.serialize import clean
from app.config.disclosures import (
    ALLOCATION_HEADING,
    SCHEME_DOCS_NOTE,
    SUCCESS_PROB_NOTE,
    TAX_INFO,
    TAX_PER_GOAL_NOTE,
)
from app.engine.pipeline import build_full_plan
from app.main import create_app
from app.report.fmt import pct, short_inr, sized_status, xml_escape
from app.report.pdf import build_pdf
from app.schemas import PlanRequest

RAW = json.loads((Path(__file__).parent / "fixtures" / "personas.json").read_text())


def pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf))


def capture_paragraphs(monkeypatch):
    seen: list[str] = []
    real = Paragraph

    def wrap(text, *a, **k):
        seen.append(str(text))
        return real(text, *a, **k)

    monkeypatch.setattr("app.report.pdf.Paragraph", wrap)
    return seen


def test_pdf_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    with TestClient(create_app()) as c:
        plan_id = c.post("/api/plans", json=RAW["mid_career_dependents"]).json()["id"]
        r = c.get(f"/api/plans/{plan_id}/report.pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert len(r.content) > 20_000 and r.content.startswith(b"%PDF")
    assert "attachment" in r.headers["content-disposition"]


@pytest.mark.parametrize("name", list(RAW))
def test_pdf_pages_and_offline(name, eligible, monkeypatch):
    def no_net(*a, **k):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", no_net)
    r = clean(build_full_plan(PlanRequest(**RAW[name]), eligible))
    pdf = build_pdf(RAW[name]["client"]["first_name"], r)
    assert len(pdf) > 20_000
    assert 6 <= pages(pdf) <= 9


def test_formatters():
    assert short_inr(12_500_000) == "₹1.25 Cr" and short_inr(250_000) == "₹2.50 L" and short_inr(45_000) == "₹45,000"
    assert pct(-0.00001) == "0.0%" and pct(0.123) == "12.3%" and pct(None) == "-"
    assert xml_escape("<font color='red'>HACK</font>") == "&lt;font color='red'&gt;HACK&lt;/font&gt;"
    assert xml_escape(None) == ""
    assert sized_status("funded") == "Sized at assumed return"
    assert sized_status("partially_funded") == "Partly sized at assumed return"
    assert sized_status("unfunded") == "Not sized"


def test_pdf_escapes_markup_in_names(eligible, monkeypatch):
    seen = capture_paragraphs(monkeypatch)
    r = clean(build_full_plan(PlanRequest(**RAW["young_aggressive"]), eligible))
    r["planning"]["goals"][0]["name"] = "<font color='red'>HACK</font>"
    r["funds"][0]["scheme_name"] = "<b>INJECT</b>"
    pdf = build_pdf("<font color='red'>HackName</font>", r)
    assert pdf.startswith(b"%PDF") and len(pdf) > 20_000
    blob = "\n".join(seen)
    assert "&lt;font color='red'&gt;HACK&lt;/font&gt;" in blob
    assert "&lt;font color='red'&gt;HackName&lt;/font&gt;" in blob
    assert "&lt;b&gt;INJECT&lt;/b&gt;" in blob
    assert "<font color='red'>HACK</font>" not in blob
    assert "<b>INJECT</b>" not in blob


def test_pdf_page1_success_probability_and_tax_copy(eligible, monkeypatch):
    seen = capture_paragraphs(monkeypatch)
    r = clean(build_full_plan(PlanRequest(**RAW["young_aggressive"]), eligible))
    pdf = build_pdf(RAW["young_aggressive"]["client"]["first_name"], r)
    assert 6 <= pages(pdf) <= 9
    blob = "\n".join(seen)
    assert SUCCESS_PROB_NOTE in blob
    assert "not the same as likely to succeed" in blob
    assert ALLOCATION_HEADING in blob
    assert TAX_PER_GOAL_NOTE in blob
    assert TAX_INFO in blob
    assert SCHEME_DOCS_NOTE in blob
    assert "Sized at assumed return" in blob
    assert blob.count(TAX_PER_GOAL_NOTE) == len(r["planning"]["goals"])
    assert "partially funded" not in blob
