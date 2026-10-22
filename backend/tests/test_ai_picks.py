"""AI fund picks: only FH Recommended funds, weights total 100, bad model output falls back to the rule."""
from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pytest

from app.ai import picks as P

PLAN = {"profile": {"band": "Moderate"}, "allocation": {"by_asset_class": {"equity": 60, "debt": 40}}, "data_asof": "2026-10-09"}
CODES = [c["scheme_code"] for c in P.candidates()]
CODE_A, CODE_B = [c["scheme_code"] for c in P.shortlist(P.candidates())[:2]]


def _gen(answer):
    with patch.object(P, "call_openai_json", return_value=answer):
        return P.generate(PLAN, sqlite3.connect(":memory:"))


def test_ai_answer_is_used_when_valid():
    P._CACHE.clear()
    out = _gen({"p": [[CODE_A, 60, "steady large companies"], [CODE_B, 40, "has 5 digits"]], "m": "calm"})
    assert out["ai_generated"] and [p["weight_pct"] for p in out["picks"]] == [60, 40]
    assert out["picks"][0]["reason"] == "steady large companies"
    assert len(P.shortlist(P.candidates())) <= 2 * len({c["cat"] for c in P.candidates()})
    assert any(ch.isdigit() for ch in out["picks"][1]["reason"]) and out["picks"][1]["reason"] != "has 5 digits"  # replaced by template


@pytest.mark.parametrize("bad", [None, {"p": [["999999", 100, "x"]]}, {"p": [[CODE_A, 50, "x"]]}, {"nonsense": 1}])
def test_bad_answer_falls_back_to_rule(bad):
    P._CACHE.clear()
    out = _gen(bad)
    assert not out["ai_generated"] and out["picks"]
    assert {p["scheme_code"] for p in out["picks"]} <= set(CODES)
    assert abs(sum(p["weight_pct"] for p in out["picks"]) - 100) < 0.05


def test_edit_validation():
    allowed = set(CODES)
    P.validate_weights([{"scheme_code": CODES[0], "weight_pct": 100}], allowed)
    for bad in ([{"scheme_code": "1", "weight_pct": 100}], [{"scheme_code": CODES[0], "weight_pct": 90}],
                [{"scheme_code": CODES[0], "weight_pct": 50}, {"scheme_code": CODES[0], "weight_pct": 50}], []):
        with pytest.raises(ValueError):
            P.validate_weights(bad, allowed)


def test_preview_needs_staff_login(client):
    body = {"band": "Moderate", "equity": 50, "debt": 33, "gold": 10, "liquid": 7}
    assert client.post("/api/staff/ai-picks", json=body).status_code == 401


def test_risk_profile_pdf_lists_fund_picks():
    import io

    import pytest
    from fastapi import HTTPException
    from pypdf import PdfReader

    from app.api.backoffice import BackofficeRiskProfileRequest, risk_profile_report

    picks = [{"scheme_code": CODES[0], "weight_pct": 60}, {"scheme_code": CODES[1], "weight_pct": 40}]
    _, pdf = risk_profile_report(BackofficeRiskProfileRequest(fund_picks=picks))
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
    name = next(c["scheme_name"] for c in P.candidates() if c["scheme_code"] == CODES[0])
    assert "FH Recommended list (AI-assisted)" in text and name.split()[0] in text
    _, plain = risk_profile_report(BackofficeRiskProfileRequest())
    assert "AI-assisted" not in "".join(p.extract_text() for p in PdfReader(io.BytesIO(plain)).pages)
    with pytest.raises(HTTPException):
        risk_profile_report(BackofficeRiskProfileRequest(fund_picks=[{"scheme_code": "000000", "weight_pct": 100}]))


def test_backtest_blends_funds_and_reports_window():
    from app.ai.backtest import backtest

    bt = backtest([{"scheme_code": CODES[0], "weight_pct": 50}, {"scheme_code": CODES[1], "weight_pct": 50}])
    assert bt and bt["months"] >= 12 and bt["growth"][0]["v"] == 100 and bt["max_drawdown"] <= 0
    assert backtest([{"scheme_code": "000000", "weight_pct": 100}]) is None  # no NAV file: no result, no crash
