import copy
import json
from pathlib import Path

import pytest

from app.config import load_mf_tax_classes, load_tax_catalog, load_tax_rules
from app.data import categories as cats
from app.engine.pipeline import build_full_plan
from app.schemas import PlanRequest

FIX = Path(__file__).parent / "fixtures"
TAX_RAW = json.loads((FIX / "tax_personas.json").read_text())
BASE_RAW = json.loads((FIX / "personas.json").read_text())


def req(raw, **sw):
    r = copy.deepcopy(raw)
    if sw:
        r["tax_switches"] = sw
    return PlanRequest(**r)


@pytest.fixture(scope="module")
def plans(eligible):
    return {k: build_full_plan(req(v), eligible) for k, v in TAX_RAW.items()}


def test_hand_checked_tax_numbers(plans):
    a = plans["salaried_deductions"]["tax"]["regimes"]
    assert a["old"]["total_tax"] == 311_064 and a["new"]["total_tax"] == 204_880 and a["better"] == "new"
    assert a["old"]["deductions"]["hra"] == 280_000
    b = plans["senior_income"]["tax"]["regimes"]
    assert b["old"]["total_tax"] == 85_280 and b["new"]["total_tax"] == 0
    assert b["old"]["age_band"] == "senior"


def test_no_tax_profile_leaves_plan_unchanged_and_disabled(eligible):
    r = build_full_plan(req(BASE_RAW["young_aggressive"]), eligible)
    assert r["tax"]["enabled"] is False and r["tax"]["mode"] == "skip"
    assert all("tax_tag" in f for f in r["funds"])


def test_adding_tax_profile_does_not_change_pre_tax_plan(eligible):
    base = build_full_plan(req(BASE_RAW["mid_career_dependents"]), eligible)
    raw = copy.deepcopy(BASE_RAW["mid_career_dependents"])
    raw["client"]["tax"] = TAX_RAW["salaried_deductions"]["client"]["tax"]
    with_tax = build_full_plan(PlanRequest(**raw), eligible)
    assert [g["required_sip"] for g in with_tax["planning"]["goals"]] == [g["required_sip"] for g in base["planning"]["goals"]]
    assert with_tax["planning"]["totals"] == base["planning"]["totals"]
    assert [f["scheme_code"] for f in with_tax["funds"]] == [f["scheme_code"] for f in base["funds"]]


def test_post_tax_view_raises_required_sip_for_every_goal(eligible):
    raw = TAX_RAW["salaried_deductions"]
    pre = build_full_plan(req(raw), eligible)
    post = build_full_plan(req(raw, tax_view="post"), eligible)
    delta = post["tax"]["post_tax_goal_delta"]
    assert len(delta) == 3
    for g_pre, g_post, d in zip(pre["planning"]["goals"], post["planning"]["goals"], delta, strict=True):
        assert g_post["required_sip"] >= g_pre["required_sip"]
        assert d["extra_sip_needed"] == g_post["required_sip"] - g_pre["required_sip"]
        assert g_post["expected_return"] <= g_pre["expected_return"]
    assert any(d["extra_sip_needed"] > 0 for d in delta)
    assert "post_tax_goal_delta" not in pre["tax"]


def test_post_tax_without_tax_profile_changes_nothing(eligible):
    raw = BASE_RAW["young_aggressive"]
    a = build_full_plan(req(raw), eligible)
    b = build_full_plan(req(raw, tax_view="post"), eligible)
    assert a["planning"]["totals"] == b["planning"]["totals"]


def test_regime_switch_changes_tax_in_force_and_nudges(eligible):
    raw = TAX_RAW["salaried_deductions"]
    auto = build_full_plan(req(raw), eligible)["tax"]
    old = build_full_plan(req(raw, regime="old"), eligible)["tax"]
    assert auto["regime_in_force"] == "new" and old["regime_in_force"] == "old"
    assert old["in_force"]["total_tax"] == old["regimes"]["old"]["total_tax"]
    assert "sec_80c" in {n["id"] for n in old["nudges"]} and "sec_80c" not in {n["id"] for n in auto["nudges"]}


def test_applying_nudges_and_reinvesting_adds_sip(eligible):
    raw = TAX_RAW["salaried_deductions"]
    plain = build_full_plan(req(raw, regime="old"), eligible)
    applied = build_full_plan(req(raw, regime="old", apply=["sec_80c", "nps_1b", "health_80d"], reinvest=True), eligible)
    t = applied["tax"]["applied"]
    assert set(t["applied"]) == {"sec_80c", "nps_1b", "health_80d"} and t["tax_saved_year"] > 0
    assert applied["planning"]["totals"]["tax_reinvested"] == t["tax_saved_month"]
    assert applied["planning"]["totals"]["allocated_sip"] >= plain["planning"]["totals"]["allocated_sip"]
    no_reinvest = build_full_plan(req(raw, regime="old", apply=["sec_80c"], reinvest=False), eligible)
    assert no_reinvest["planning"]["totals"]["tax_reinvested"] == 0


def test_skip_mode_disables_tax(eligible):
    raw = copy.deepcopy(TAX_RAW["senior_income"])
    raw["client"]["tax"] = {"mode": "skip"}
    assert build_full_plan(PlanRequest(**raw), eligible)["tax"]["enabled"] is False


def test_bracket_only_mode_in_pipeline(eligible):
    raw = copy.deepcopy(TAX_RAW["salaried_deductions"])
    raw["client"]["tax"] = {"mode": "bracket_only", "bracket_pct": 30, "regime_current": "old"}
    t = build_full_plan(PlanRequest(**raw), eligible)["tax"]
    assert t["mode"] == "bracket_only" and t["regimes"] is None and t["marginal_rate"] == pytest.approx(0.312)
    assert {n["id"] for n in t["nudges"]} >= {"sec_80c", "nps_1b"}


def test_fund_tax_tags_on_shortlist(plans):
    for f in plans["salaried_deductions"]["funds"]:
        tag = f["tax_tag"]
        assert tag["class"] in load_mf_tax_classes()["classes"]
        assert tag["note"]


def test_old_if_maxed_insight(plans):
    om = plans["salaried_deductions"]["tax"]["regimes"]["old_if_maxed"]
    assert om["extra_deductions"] > 0 and om["total_tax"] <= plans["salaried_deductions"]["tax"]["regimes"]["old"]["total_tax"]
    assert isinstance(om["beats_new"], bool)


# ---- config integrity ---------------------------------------------------------------------------
def test_every_category_key_has_a_tax_class():
    keys = {k for k, _ in cats._CATEGORY_RULES} | {"gold", "other"}
    mapping = load_mf_tax_classes()
    assert keys == set(mapping["categories"])
    for entry in mapping["categories"].values():
        assert entry["class"] in mapping["classes"]


def test_tax_rules_are_dated_sourced_and_flagged():
    r = load_tax_rules()
    assert r["fy"] == "2026-27" and r["as_of"] and r["sources"]
    assert r["verified"] is False   # flips only after a chartered accountant signs off
    slabs = r["new_regime"]["slabs"]
    assert slabs[0][1] == 0.0 and slabs[-1][0] is None
    rates = [x[1] for x in slabs]
    assert rates == sorted(rates)
    for band in r["old_regime"]["slabs"].values():
        assert band[-1][0] is None
    for key in ("ppf", "ssy", "nsc", "scss"):
        assert 0.05 < r["small_savings"][key]["rate"] < 0.10


def test_catalog_integrity():
    cat = load_tax_catalog()
    ids = [i["id"] for i in cat["instruments"]]
    assert len(ids) == len(set(ids)) >= 20
    required = ("id", "name", "kind", "summary", "who_for", "lock_in", "risk", "liquidity", "return_note", "tax_in",
                "tax_on_growth", "tax_on_exit", "tax_label", "regime_benefit", "min_horizon_years", "goal_types", "watch_outs")
    for i in cat["instruments"]:
        for k in required:
            assert i.get(k) not in (None, "", []), f"{i['id']} missing {k}"
        assert i["kind"] in cat["kinds"]
        assert i["regime_benefit"] in ("old", "new", "both", "none")
        assert i["section"] is None or i["section"] in load_tax_rules()["section_labels"]
    assert {"ppf", "nps_tier1", "elss", "ssy", "scss", "equity_fund", "debt_fund", "term_insurance", "health_insurance"} <= set(ids)
