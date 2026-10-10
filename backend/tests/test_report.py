import json
import re
import socket
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.serialize import clean
from app.engine.pipeline import build_full_plan
from app.main import create_app
from app.report.fmt import pct, short_inr
from app.report.pdf import build_pdf
from app.schemas import PlanRequest

RAW = json.loads((Path(__file__).parent / "fixtures" / "personas.json").read_text())


def pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf))


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
