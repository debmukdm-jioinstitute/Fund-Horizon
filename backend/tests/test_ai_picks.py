"""AI fund picks: only FH Recommended funds, weights total 100, bad model output falls back to the rule."""
from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pytest

from app.ai import picks as P

PLAN = {"profile": {"band": "Moderate"}, "allocation": {"by_asset_class": {"equity": 60, "debt": 40}}, "data_asof": "2026-10-09"}
CODES = [c["scheme_code"] for c in P.candidates()]


def _gen(answer):
    with patch.object(P, "call_openai_json", return_value=answer):
        return P.generate(PLAN, sqlite3.connect(":memory:"))


def test_ai_answer_is_used_when_valid():
    out = _gen({"picks": [{"scheme_code": CODES[0], "weight_pct": 60, "reason": "steady large companies"},
                          {"scheme_code": CODES[1], "weight_pct": 40, "reason": "has 5 digits"}], "market_note": "calm"})
    assert out["ai_generated"] and [p["weight_pct"] for p in out["picks"]] == [60, 40]
    assert out["picks"][0]["reason"] == "steady large companies"
    assert any(ch.isdigit() for ch in out["picks"][1]["reason"]) and out["picks"][1]["reason"] != "has 5 digits"  # replaced by template


@pytest.mark.parametrize("bad", [None, {"picks": [{"scheme_code": "999999", "weight_pct": 100, "reason": "x"}]},
                                 {"picks": [{"scheme_code": CODES[0], "weight_pct": 50, "reason": "x"}]}])
def test_bad_answer_falls_back_to_rule(bad):
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
