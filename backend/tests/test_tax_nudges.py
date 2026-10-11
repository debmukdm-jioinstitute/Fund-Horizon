import pytest

from app.config import load_tax_catalog, load_tax_rules
from app.engine import tax as tx
from app.engine import tax_nudges as nd
from app.engine import tax_plan as tp
from app.engine.tax import TaxInputs

RULES = load_tax_rules()
LONG = [{"name": "Retirement", "type": "retirement", "years": 20}, {"name": "Home", "type": "home", "years": 8}]
SHORT = [{"name": "Car", "type": "vehicle", "years": 2}]


def prof(**kw):
    base = {"mode": "detailed", "regime_current": "old", "lock_in_comfort": "5y", "gross_income_annual": 1_800_000}
    base.update(kw)
    return base


def build(i, profile, goals=LONG, regime="old"):
    return nd.build_nudges(i, profile, goals, regime, tx.compare_regimes(i, RULES), RULES)


def ids(nudges):
    return {n["id"] for n in nudges}


def inp(**kw):
    kw.setdefault("age", 35)
    kw.setdefault("gross_income", 1_800_000)
    kw.setdefault("basic_annual", 720_000)
    return TaxInputs(**kw)


def by_id(nudges, nid):
    return next(n for n in nudges if n["id"] == nid)


def test_80c_fires_with_headroom_and_saving_equals_tax_difference():
    i = inp(ded_80c=50_000)
    n = by_id(build(i, prof()), "sec_80c")
    assert n["amount"] == 100_000 and n["switchable"] and n["regime"] == "old"
    expect = tx.regime_tax(i, "old")["total_tax"] - tx.regime_tax(i, "old", {"80c": 100_000})["total_tax"]
    assert n["est_saving_year"] == expect > 0
    assert "elss" in n["catalog_ids"]


def test_80c_absent_when_limit_used_or_new_regime():
    assert "sec_80c" not in ids(build(inp(ded_80c=150_000), prof()))
    assert "sec_80c" not in ids(build(inp(), prof(), regime="new"))


def test_80c_warns_about_lock_in_for_short_goals():
    n = by_id(build(inp(), prof(), goals=SHORT), "sec_80c")
    assert any("under 3 years" in w for w in n["watch_outs"])
    assert any("lock" in w.lower() for w in n["watch_outs"])


def test_80c_prefers_govt_products_when_asked():
    n = by_id(build(inp(), prof(govt_backed_pref=True, lock_in_comfort="15y")), "sec_80c")
    assert "elss" not in n["catalog_ids"] and "ppf" in n["catalog_ids"]


def test_nps_1b_fires_and_respects_headroom():
    n = by_id(build(inp(nps_self=20_000), prof()), "nps_1b")
    assert n["amount"] == 30_000 and n["lock_in"] == "Until age 60"
    assert "nps_1b" not in ids(build(inp(nps_self=50_000), prof()))
    assert "nps_1b" not in ids(build(inp(), prof(), regime="new"))


def test_employer_nps_needs_flag_and_basic():
    assert "employer_nps" not in ids(build(inp(), prof()))
    n = by_id(build(inp(), prof(employer_offers_nps=True)), "employer_nps")
    assert n["regime"] == "both" and n["switchable"] and n["est_saving_year"] > 0
    assert "employer_nps" not in ids(build(inp(basic_annual=0), prof(employer_offers_nps=True)))
    assert "employer_nps" in ids(build(inp(), prof(employer_offers_nps=True), regime="new"))


def test_health_80d_fires_and_senior_limits():
    n = by_id(build(inp(), prof()), "health_80d")
    assert n["amount"] == 25_000 + 25_000
    n2 = by_id(build(inp(age=65, gross_income=1_800_000), prof(), regime="old"), "health_80d")
    assert n2["amount"] == 50_000 + 25_000
    assert "health_80d" not in ids(build(inp(health_self=25_000, health_parents=25_000), prof()))


def test_hra_nudge_needs_rent_and_hra():
    assert "hra" not in ids(build(inp(), prof()))
    i = inp(hra_received=300_000, rent_paid_annual=360_000, metro=True)
    n = by_id(build(i, prof()), "hra")
    assert n["est_saving_year"] > 0


def test_rebate_cliff_new_regime_only_near_limit():
    i_near = inp(gross_income=1_300_000, basic_annual=520_000)   # taxable 12.25L
    n = by_id(build(i_near, prof(employer_offers_nps=True), regime="new"), "rebate_cliff")
    assert n["amount"] == 25_000 and n["est_saving_year"] > 0
    assert "rebate_cliff" not in ids(build(inp(gross_income=2_000_000), prof(), regime="new"))
    assert "rebate_cliff" not in ids(build(inp(gross_income=1_000_000), prof(), regime="new"))


def test_ltcg_harvest_and_stcg_timing():
    n = by_id(build(inp(), prof(unrealised_equity_gain=400_000)), "ltcg_harvest")
    assert n["amount"] == 125_000 and n["timing"] == "future"
    assert n["est_saving_year"] == round(125_000 * 0.125 * 1.04)
    assert "ltcg_harvest" not in ids(build(inp(realised_ltcg=125_000), prof(unrealised_equity_gain=400_000)))
    assert "ltcg_harvest" not in ids(build(inp(), prof()))
    s = by_id(build(inp(realised_stcg=100_000), prof()), "stcg_timing")
    assert s["est_saving_year"] == round(100_000 * 0.075 * 1.04)


def test_fd_vs_funds_needs_high_bracket():
    assert "fd_vs_funds" in ids(build(inp(fd_interest=100_000), prof()))
    assert "fd_vs_funds" not in ids(build(inp(fd_interest=100_000, gross_income=400_000), prof()))
    assert "fd_vs_funds" not in ids(build(inp(), prof()))


def test_senior_nudges():
    i = inp(age=66, gross_income=300_000, fd_interest=150_000, basic_annual=0)
    got = build(i, prof(), regime="old")
    assert "senior_80ttb" in ids(got)
    assert "senior_scss" in ids(got)
    assert "form_15h" in ids(got)       # tax is nil, interest above the senior TDS threshold
    assert "senior_80ttb" not in ids(build(inp(fd_interest=150_000), prof()))


def test_spouse_split_only_for_high_bracket_with_low_earning_spouse():
    assert "spouse_split" in ids(build(inp(), prof(spouse_income_band="none")))
    assert "spouse_split" not in ids(build(inp(), prof(spouse_income_band="higher")))
    assert "spouse_split" not in ids(build(inp(gross_income=400_000), prof(spouse_income_band="none")))


def test_regime_nudge_wording_follows_current_regime():
    i = inp()
    assert by_id(build(i, prof(regime_current="old")), "regime")["title"].startswith("Switch to")
    assert by_id(build(i, prof(regime_current="new")), "regime")["title"].startswith("Stay in")
    assert by_id(build(i, prof(regime_current="unsure")), "regime")["title"].startswith("The ")


def test_ranked_by_saving_and_all_have_required_fields():
    got = build(inp(ded_80c=0), prof(employer_offers_nps=True, unrealised_equity_gain=300_000))
    savings = [n["est_saving_year"] or 0 for n in got]
    assert savings == sorted(savings, reverse=True)
    assert [n["rank"] for n in got] == list(range(1, len(got) + 1))
    catalog_ids = {i["id"] for i in load_tax_catalog()["instruments"]}
    for n in got:
        assert n["title"] and n["summary"] and n["regime"] in ("old", "new", "both") and n["timing"] in ("this_year", "future")
        assert set(n["catalog_ids"]) <= catalog_ids, n["id"]


def test_apply_nudges_sums_deductions_and_ignores_unknown():
    i = inp(ded_80c=0)
    got = build(i, prof())
    r = nd.apply_nudges(i, "old", got, ["sec_80c", "nps_1b", "does_not_exist", "ltcg_harvest"], RULES)
    assert set(r["applied"]) == {"sec_80c", "nps_1b"}
    both = tx.regime_tax(i, "old", {"80c": 150_000, "80ccd1b": 50_000})["total_tax"]
    assert r["tax_after"] == both and r["tax_saved_year"] == r["tax_before"] - both
    assert r["tax_saved_month"] == round(r["tax_saved_year"] / 12)
    none = nd.apply_nudges(i, "old", got, [], RULES)
    assert none["tax_saved_year"] == 0 and none["applied"] == []


# ---- build_tax_section -------------------------------------------------------------------------
SW = {"regime": "auto", "tax_view": "pre", "apply": [], "reinvest": False}


def test_section_skip_and_missing_profile():
    assert tp.build_tax_section(35, "salaried_private", None, LONG, SW)["enabled"] is False
    assert tp.build_tax_section(35, "salaried_private", {"mode": "skip"}, LONG, SW)["enabled"] is False


def test_section_detailed_regime_selection():
    p = prof(ded_80c_used=150_000, nps_self_annual=50_000, health_premium_self=25_000, home_loan_interest=200_000)
    auto = tp.build_tax_section(35, "salaried_private", p, LONG, SW)
    assert auto["regime_in_force"] == auto["recommended_regime"] == auto["regimes"]["better"]
    forced = tp.build_tax_section(35, "salaried_private", p, LONG, {**SW, "regime": "old"})
    assert forced["regime_in_force"] == "old"
    assert forced["in_force"]["regime"] == "old"


def test_section_post_tax_and_reinvest_flags():
    p = prof(ded_80c_used=0)
    s = tp.build_tax_section(35, "salaried_private", p, LONG,
                             {"regime": "old", "tax_view": "post", "apply": ["sec_80c"], "reinvest": True})
    assert s["_post_tax_marginal"] == s["marginal_rate"] > 0
    assert s["_reinvest_monthly"] == s["applied"]["tax_saved_month"] > 0
    s2 = tp.build_tax_section(35, "salaried_private", p, LONG, {"regime": "old", "tax_view": "pre", "apply": ["sec_80c"], "reinvest": False})
    assert s2["_post_tax_marginal"] is None and s2["_reinvest_monthly"] == 0


def test_applying_nudges_lowers_marginal_rate_never_raises():
    p = prof(gross_income_annual=2_600_000)
    a = tp.build_tax_section(35, "salaried_private", p, LONG, {**SW, "regime": "old"})
    b = tp.build_tax_section(35, "salaried_private", p, LONG, {**SW, "regime": "old", "apply": ["sec_80c", "nps_1b"]})
    assert b["marginal_rate"] <= a["marginal_rate"]
    assert b["in_force"]["total_tax"] < a["in_force"]["total_tax"]


def test_section_bracket_only_mode():
    p = {"mode": "bracket_only", "bracket_pct": 30, "regime_current": "old", "ded_80c_used": 50_000, "unrealised_equity_gain": 200_000}
    s = tp.build_tax_section(40, "salaried_private", p, LONG, SW)
    assert s["mode"] == "bracket_only" and s["regimes"] is None
    assert s["marginal_rate"] == pytest.approx(0.312)
    n80c = by_id(s["nudges"], "sec_80c")
    assert n80c["est_saving_year"] == round(100_000 * 0.312)
    assert "ltcg_harvest" in ids(s["nudges"])
    zero = tp.build_tax_section(40, "salaried_private", {"mode": "bracket_only", "bracket_pct": 0}, LONG, SW)
    assert zero["nudges"] == []
    new = tp.build_tax_section(40, "salaried_private", {**p, "regime_current": "new"}, LONG, SW)
    assert "sec_80c" not in ids(new["nudges"])


def test_inputs_from_profile_defaults_and_conversions():
    i = tp.inputs_from_profile(40, "govt_psu", {"gross_income_annual": 1_000_000, "rent_paid_monthly": 20_000,
                                                "employer_nps_pct": 10})
    assert i.basic_annual == 400_000 and i.salaried and i.govt_employer
    assert i.rent_paid_annual == 240_000 and i.employer_nps_pct == 0.10
    j = tp.inputs_from_profile(40, "freelance_variable", {"gross_income_annual": 1_000_000})
    assert not j.salaried and j.basic_annual == 0
