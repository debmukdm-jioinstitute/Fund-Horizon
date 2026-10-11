"""Tests for the customer portal v1 backend: engine views, PATCH recompute and persistence."""
from __future__ import annotations

import re
from datetime import date

import pytest

from app.engine import portal as portal_engine

BANNED_RE = re.compile(r"\b(best|guaranteed|advice|advisory|recommend|suggested)\b", re.IGNORECASE)


def _result(**overrides):
    result = {
        "profile": {"band": "Moderate", "final_score": 52.0},
        "allocation": {
            "band": "Moderate",
            "by_asset_class": {"equity": 50.0, "debt": 33.0, "gold": 10.0, "liquid": 7.0},
            "by_category": {
                "large_cap": 20.0, "flexi_cap": 15.0, "mid_cap": 10.0, "small_cap": 5.0,
                "corporate_bond": 20.0, "banking_psu": 13.0, "gold": 10.0, "liquid": 7.0,
            },
        },
        "funds": [
            {"scheme_code": "F1", "scheme_name": "Alpha Large", "amc": "AMC A",
             "cat": "large_cap", "suggested_monthly_sip": 8000},
            {"scheme_code": "F2", "scheme_name": "Beta Flexi", "amc": "AMC A",
             "cat": "flexi_cap", "suggested_monthly_sip": 6000},
            {"scheme_code": "F3", "scheme_name": "Gamma Mid", "amc": "AMC B",
             "cat": "mid_cap", "suggested_monthly_sip": 4000},
            {"scheme_code": "F4", "scheme_name": "Delta Corp", "amc": "AMC B",
             "cat": "corporate_bond", "suggested_monthly_sip": 8000},
            {"scheme_code": "F5", "scheme_name": "Epsilon Gold", "amc": "AMC C",
             "cat": "gold", "suggested_monthly_sip": 4000},
        ],
        "planning": {
            "totals": {"required_sip": 40000, "allocated_sip": 30000,
                       "monthly_surplus": 35000, "unused_surplus": 5000},
            "goals": [
                {"name": "Home", "type": "home", "years": 8, "future_cost": 7000000,
                 "required_sip": 25000, "allocated_sip": 20000, "status": "partially_funded",
                 "monte_carlo": {"success_prob": 0.72}},
                {"name": "Retirement", "type": "retirement", "years": 25, "future_cost": 40000000,
                 "required_sip": 15000, "allocated_sip": 10000, "status": "partially_funded",
                 "monte_carlo": {"success_prob": 0.65}},
            ],
            "insurance": {
                "term": {"need": 10000000, "cover": 5000000, "gap": 5000000},
                "health": {"target": 1000000, "cover": 1000000, "gap": 0},
            },
            "emergency_fund": {"target_months": 6, "target": 300000, "current": 300000, "gap": 0},
        },
    }
    result.update(overrides)
    return result


def _row(**overrides):
    request = {
        "client": {
            "first_name": "Asha", "age": 35, "employment_type": "salaried_private",
            "dependents": 1, "monthly_income": 150000, "monthly_expenses": 80000,
            "monthly_emi": 20000, "liquid_assets": 300000, "investments": 1000000,
            "liabilities": 0, "term_cover": 5000000, "health_cover": 1000000,
            "retirement_age": 60,
        },
        "goals": [
            {"name": "Home", "type": "home", "target_amount_today": 5000000,
             "years_to_goal": 8, "priority": 1, "existing_investment_earmarked": 0},
            {"name": "Retirement", "type": "retirement", "target_amount_today": 0,
             "years_to_goal": 25, "priority": 2, "existing_investment_earmarked": 0},
        ],
        "answers": {"q1": 2, "q2": 1},
        "step_up": 0.0,
        "consent": True,
    }
    row = {
        "id": "plan-1",
        "created_at": "2026-10-12T00:00:00+00:00",
        "expires_at": "2026-11-11T00:00:00+00:00",
        "request": request,
        "result": _result(),
    }
    row.update(overrides)
    return row


def _with_planning(**kw):
    row = _row()
    row["result"]["planning"].update(kw)
    return row


# ---------- dashboard ----------

def test_dashboard_shape():
    d = portal_engine.build_dashboard("plan-1", _row())
    assert set(d) == {
        "plan_id", "client_name", "as_of", "declared_invested", "declared_liquid",
        "declared_portfolio_value", "declared_label", "monthly_sip_commitment",
        "active_fund_count", "risk_band", "risk_score", "allocation", "goals",
        "goal_inputs", "next_step", "alerts",
    }
    assert set(d["goals"][0]) == {
        "name", "type", "target_date", "target_amount", "monthly_sip", "required_sip",
        "status", "status_label", "success_prob", "progress_pct",
    }
    assert set(d["next_step"]) == {"kind", "title", "detail", "disclaimer"}
    assert d["declared_label"].startswith("As declared in your plan inputs")
    assert d["next_step"]["disclaimer"] == "This is an illustration, not a recommendation."


def test_dashboard_declared_values():
    d = portal_engine.build_dashboard("plan-1", _row())
    assert d["client_name"] == "Asha"
    assert d["declared_invested"] == 1000000
    assert d["declared_liquid"] == 300000
    assert d["declared_portfolio_value"] == 1300000
    assert d["monthly_sip_commitment"] == 30000
    assert d["active_fund_count"] == 5
    assert d["risk_band"] == "Moderate"
    assert d["risk_score"] == 52
    assert len(d["goal_inputs"]) == 2
    assert d["goal_inputs"][0]["name"] == "Home"


def test_dashboard_fraction_scale():
    d = portal_engine.build_dashboard("plan-1", _row())
    assert d["allocation"]["equity"] == pytest.approx(0.5)
    assert d["allocation"]["debt"] == pytest.approx(0.33)
    for v in d["allocation"].values():
        assert 0 <= v <= 1, f"allocation value {v} is not a 0-1 fraction"


def test_goal_progress_math():
    d = portal_engine.build_dashboard("plan-1", _row())
    by_name = {g["name"]: g for g in d["goals"]}
    assert by_name["Home"]["progress_pct"] == 80  # 20000/25000
    assert by_name["Retirement"]["progress_pct"] == 67  # 10000/15000
    assert by_name["Home"]["status_label"] == "Partially funded"
    assert by_name["Home"]["success_prob"] == pytest.approx(0.72)
    # zero required SIP -> fully "funded" progress, not a crash
    assert portal_engine._goal_progress({"required_sip": 0, "allocated_sip": 0}) == 100


def test_goal_target_date():
    d = portal_engine.build_dashboard("plan-1", _row())
    today = date.today()
    by_name = {g["name"]: g for g in d["goals"]}
    assert by_name["Home"]["target_date"] == f"{today.year + 8:04d}-{today.month:02d}"
    assert by_name["Retirement"]["target_date"] == f"{today.year + 25:04d}-{today.month:02d}"


def test_dashboard_alerts():
    d = portal_engine.build_dashboard("plan-1", _row())
    kinds = [a["kind"] for a in d["alerts"]]
    assert "insurance" in kinds  # term cover gap
    assert kinds.count("goal") == 2
    assert "surplus" in kinds  # unused surplus 5000
    assert "emergency" not in kinds
    assert all(set(a) == {"kind", "text"} for a in d["alerts"])


# ---------- next_step priority ----------

def test_next_step_emergency_first():
    row = _with_planning(emergency_fund={"target_months": 6, "target": 300000,
                                         "current": 100000, "gap": 200000})
    ns = portal_engine.build_dashboard("p", row)["next_step"]
    assert ns["kind"] == "emergency"
    assert "2,00,000" in ns["detail"]  # the ₹2,00,000 gap, Indian grouping


def test_next_step_term_then_health():
    row = _row()  # term gap 5M, health gap 0
    assert portal_engine.build_dashboard("p", row)["next_step"]["kind"] == "term"
    row2 = _with_planning(insurance={
        "term": {"need": 10000000, "cover": 10000000, "gap": 0},
        "health": {"target": 1000000, "cover": 600000, "gap": 400000},
    })
    assert portal_engine.build_dashboard("p", row2)["next_step"]["kind"] == "health"


def test_next_step_lowest_progress_goal():
    row = _with_planning(insurance={
        "term": {"need": 10000000, "cover": 10000000, "gap": 0},
        "health": {"target": 1000000, "cover": 1000000, "gap": 0},
    })
    ns = portal_engine.build_dashboard("p", row)["next_step"]
    assert ns["kind"] == "goal"
    assert "Retirement" in ns["title"]  # 67% < 80%


# ---------- health ----------

def test_health_scores_bounds_and_overall():
    h = portal_engine.build_health("plan-1", _row())
    assert set(h) == {"plan_id", "scores", "improvements"}
    assert set(h["scores"]) == {
        "goal_readiness", "risk_alignment", "diversification",
        "sip_adequacy", "emergency_readiness", "overall",
    }
    scores = h["scores"]
    five = [scores[k] for k in ("goal_readiness", "risk_alignment", "diversification",
                                "sip_adequacy", "emergency_readiness")]
    assert all(isinstance(v, int) and 0 <= v <= 100 for v in five)
    assert scores["overall"] == round(sum(five) / 5)
    assert scores["sip_adequacy"] == 75  # 30000/40000
    assert scores["emergency_readiness"] == 100  # gap 0


def test_health_three_improvements():
    h = portal_engine.build_health("plan-1", _row())
    assert len(h["improvements"]) == 3
    keys = {i["title"] for i in h["improvements"]}
    assert len(keys) == 3
    for imp in h["improvements"]:
        assert set(imp) == {"title", "detail", "disclaimer"}
        assert imp["disclaimer"] == "This is an illustration, not a recommendation."
        assert "₹" in imp["detail"]  # concrete rupee figures


def test_health_diversification_penalties():
    row = _row()
    row["result"]["allocation"]["by_category"] = {"large_cap": 45.0, "liquid": 55.0}
    h = portal_engine.build_health("p", row)
    assert h["scores"]["diversification"] == 75  # -15 concentration, -10 categories<4
    row2 = _row()
    row2["result"]["funds"] = row2["result"]["funds"][:3]
    h2 = portal_engine.build_health("p", row2)
    assert h2["scores"]["diversification"] == 90  # -10 funds<5 only


def test_health_risk_alignment():
    h = portal_engine.build_health("plan-1", _row())
    assert h["scores"]["risk_alignment"] == 100  # equity 50 vs Moderate midpoint 50
    row = _row()
    row["result"]["allocation"]["by_asset_class"]["equity"] = 80.0
    h2 = portal_engine.build_health("p", row)
    assert h2["scores"]["risk_alignment"] == 40  # 100 - 2*|80-50|


def test_health_emergency_readiness():
    row = _with_planning(emergency_fund={"target_months": 6, "target": 300000,
                                         "current": 150000, "gap": 150000})
    h = portal_engine.build_health("p", row)
    assert h["scores"]["emergency_readiness"] == 50


# ---------- analytics ----------

def test_analytics_shape_and_scale():
    a = portal_engine.build_analytics("plan-1", _row())
    assert set(a) == {
        "plan_id", "allocation", "category_mix", "amc_mix",
        "fund_count", "risk_band", "top_category_pct",
    }
    assert a["allocation"]["equity"] == pytest.approx(0.5)
    assert a["fund_count"] == 5
    assert a["risk_band"] == "Moderate"
    assert a["top_category_pct"] == pytest.approx(0.2)
    first = a["category_mix"][0]
    assert first["pct"] == pytest.approx(0.2)
    assert first["sip"] == 6000  # 0.2 * 30000
    for c in a["category_mix"]:
        assert 0 < c["pct"] <= 1
        assert set(c) == {"category", "pct", "sip"}
    amc_total = sum(m["pct"] for m in a["amc_mix"])
    assert amc_total == pytest.approx(1.0)
    by_amc = {m["amc"]: m["pct"] for m in a["amc_mix"]}
    assert by_amc["AMC A"] == pytest.approx(14000 / 30000)


# ---------- PATCH recompute ----------

def _valid_request():
    return _row()["request"]


def test_recompute_plan_merges_patch(monkeypatch):
    captured = {}

    def fake_build(req, eligible):
        captured["req"] = req
        return {"rebuilt": True}

    monkeypatch.setattr(portal_engine, "build_full_plan", fake_build)
    row = {"request": _valid_request()}
    body = {"client": {**_valid_request()["client"], "first_name": "Ravi"}}
    new_req, result = portal_engine.recompute_plan(row, body, eligible=None)
    assert new_req["client"]["first_name"] == "Ravi"
    assert new_req["client"]["age"] == 35  # untouched fields preserved
    assert new_req["goals"][0]["name"] == "Home"  # unpatched sections preserved
    assert result == {"rebuilt": True}
    assert captured["req"].client.first_name == "Ravi"


def test_recompute_plan_invalid_raises(monkeypatch):
    monkeypatch.setattr(portal_engine, "build_full_plan", lambda req, eligible: {})
    row = {"request": _valid_request()}
    body = {"client": {**_valid_request()["client"], "age": 5}}
    with pytest.raises(ValueError):
        portal_engine.recompute_plan(row, body, eligible=None)


# ---------- persistence ----------

def test_update_plan_roundtrip_sqlite(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "plans.db"))
    from app.db import sqlite as sqlite_mod

    saved = sqlite_mod.save_plan({"v": 1}, {"r": 1})
    pid = saved["id"]
    before = sqlite_mod.get_plan(pid)
    sqlite_mod.update_plan(pid, {"v": 2}, {"r": 2})
    after = sqlite_mod.get_plan(pid)
    assert after["created_at"] == before["created_at"]  # preserved
    assert after["request"] == {"v": 2}
    assert after["result"] == {"r": 2}


# ---------- misc ----------

def test_pct_to_frac_defensive():
    assert portal_engine._pct_to_frac(50.0) == pytest.approx(0.5)
    assert portal_engine._pct_to_frac(100) == pytest.approx(1.0)
    assert portal_engine._pct_to_frac(0.5) == pytest.approx(0.5)
    assert portal_engine._pct_to_frac(0) == 0.0
    assert portal_engine._pct_to_frac(None) == 0.0
    assert portal_engine._pct_to_frac(1) == 1.0


def test_no_banned_words():
    row = _row()
    views = [
        portal_engine.build_dashboard("p", row),
        portal_engine.build_health("p", row),
    ]
    strings: list[str] = []

    def collect(o):
        if isinstance(o, dict):
            for v in o.values():
                collect(v)
        elif isinstance(o, list):
            for v in o:
                collect(v)
        elif isinstance(o, str):
            strings.append(o)

    for v in views:
        collect(v)
    offenders = [s for s in strings if BANNED_RE.search(s)]
    assert not offenders, offenders
