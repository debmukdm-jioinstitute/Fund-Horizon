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


def test_backtest_daily_extends_to_oldest_fund_and_falls_back_to_monthly():
    from unittest.mock import patch

    import pandas as pd

    from app.ai import backtest as B

    idx = pd.bdate_range("2015-01-01", "2026-01-01")
    old = pd.Series(range(100, 100 + len(idx)), index=idx, dtype=float)
    new = old[idx >= "2020-01-01"]
    with patch.object(B, "_daily", side_effect=[old, new]):
        bt = B.backtest([{"scheme_code": CODES[0], "weight_pct": 50}, {"scheme_code": CODES[1], "weight_pct": 50}])
    assert bt["basis"] == "daily" and bt["start"].endswith("2015") and bt["cagr"]["10y"] is not None and len(bt["joins"]) == 1
    assert bt["growth"][0]["v"] == 100 and bt["max_drawdown"] <= 0
    with patch.object(B, "_daily", return_value=None):  # network down: shipped monthly files
        m = B.backtest([{"scheme_code": CODES[0], "weight_pct": 50}, {"scheme_code": CODES[1], "weight_pct": 50}])
        assert m and m["basis"] == "monthly"
        assert B.backtest([{"scheme_code": "000000", "weight_pct": 100}]) is None  # no NAV file: no result, no crash


def test_risk_pdf_shows_question_text_and_100_scale():
    import io

    from pypdf import PdfReader

    from app.api.backoffice import BackofficeRiskProfileRequest, risk_profile_report

    _, pdf = risk_profile_report(BackofficeRiskProfileRequest(answers={f"q{i}": 3 for i in range(1, 11)}))
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
    assert "Your investing experience" in text and "75 / 100" in text


def test_risk_pdf_always_carries_signature_stamp():
    import io

    from pypdf import PdfReader

    from app.api.backoffice import BackofficeRiskProfileRequest, risk_profile_report

    _, pdf = risk_profile_report(BackofficeRiskProfileRequest())
    sizes = [i.image.size for i in PdfReader(io.BytesIO(pdf)).pages[-1].images]
    assert (256, 166) in sizes  # signature_stamp.png on the sign-off block
