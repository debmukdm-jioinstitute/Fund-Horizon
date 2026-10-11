import pytest

from app.engine import tax as tx
from app.engine.tax import TaxInputs


def T(gross, **kw):
    kw.setdefault("age", 35)
    return TaxInputs(gross_income=gross, **kw)


def new(g, **kw):
    return tx.regime_tax(T(g, **kw), "new")["total_tax"]


def old(g, **kw):
    return tx.regime_tax(T(g, **kw), "old")["total_tax"]


# ---- slabs, rebate, cess (values worked out by hand) ------------------------------------
def test_new_regime_salaried_12_75_lakh_pays_nil():
    # 12.75L - 75k std deduction = 12L taxable: slab tax 60,000 fully rebated
    assert new(1_275_000) == 0


def test_new_regime_15_lakh_salaried():
    # taxable 14.25L: 20,000 + 40,000 + 2.25L x 15% = 93,750; cess 4% -> 97,500
    assert new(1_500_000) == 97_500


def test_new_regime_15_75_lakh_salaried_full_slabs():
    # taxable 15L: 20,000 + 40,000 + 3L x 15% = 1,05,000; cess -> 1,09,200
    assert new(1_575_000) == 109_200


def test_new_regime_marginal_relief_just_above_rebate_limit():
    # taxable 12.25L: slab tax 63,750 but relief caps it at 25,000; cess -> 26,000
    assert new(1_300_000) == 26_000


def test_new_regime_non_salaried_gets_no_standard_deduction():
    assert new(1_200_000, salaried=False) == 0
    assert new(1_275_000, salaried=False) > 0


def test_old_regime_10_lakh_no_deductions():
    # taxable 9.5L: 12,500 + 4.5L x 20% = 1,02,500; cess -> 1,06,600
    assert old(1_000_000) == 106_600


def test_old_regime_with_80c():
    # taxable 8L: 12,500 + 3L x 20% = 72,500; cess -> 75,400
    assert old(1_000_000, ded_80c=150_000) == 75_400


def test_old_regime_80c_is_capped_at_limit():
    assert old(1_000_000, ded_80c=500_000) == old(1_000_000, ded_80c=150_000)


def test_old_regime_rebate_up_to_5_lakh_taxable():
    assert old(550_000) == 0   # 5.5L - 50k = 5L taxable -> 12,500 tax fully rebated
    assert old(560_000) > 0


def test_senior_slabs_and_super_senior():
    assert tx.slab_tax(300_000, "old", "senior") == 0
    assert tx.slab_tax(500_000, "old", "senior") == 10_000
    assert tx.slab_tax(500_000, "old", "super_senior") == 0
    assert tx.slab_tax(1_000_000, "old", "super_senior") == 100_000
    assert T(1, age=60).age_band == "senior" and T(1, age=80).age_band == "super_senior" and T(1, age=59).age_band == "general"


def test_zero_income():
    assert new(0) == 0 and old(0) == 0
    assert tx.regime_tax(T(0), "new")["effective_rate"] == 0.0


# ---- surcharge ---------------------------------------------------------------------------
def test_surcharge_none_below_50_lakh():
    assert tx.surcharge(1_000_000, 4_900_000, "new") == 0


def test_surcharge_full_when_well_above_threshold():
    # taxable 59.25L, new regime: tax 13,57,500, 10% surcharge, no relief needed
    assert new(6_000_000) == 1_552_980


def test_surcharge_marginal_relief_at_50_lakh():
    # tax 10,95,000 on 50.5L: raw surcharge 1,09,500 but relief leaves 35,000
    assert round(tx.surcharge(1_095_000, 5_050_000, "new")) == 35_000


def test_old_regime_top_surcharge_rate_exists():
    assert tx.surcharge(1_000_000, 60_000_000, "old") > tx.surcharge(1_000_000, 60_000_000, "new")


# ---- deductions --------------------------------------------------------------------------
def test_hra_exemption_least_of_three():
    i = T(2_000_000, basic_annual=800_000, hra_received=300_000, rent_paid_annual=360_000, metro=True)
    # rent - 10% basic = 2.8L; 50% basic = 4L; HRA = 3L -> 2.8L
    assert tx.hra_exemption(i) == 280_000
    assert tx.hra_exemption(T(1, basic_annual=800_000, hra_received=0, rent_paid_annual=360_000)) == 0
    assert tx.hra_exemption(T(1, basic_annual=100_000, hra_received=50_000, rent_paid_annual=5_000)) == 0


def test_hra_non_metro_uses_40_percent():
    i = T(2_000_000, basic_annual=500_000, hra_received=400_000, rent_paid_annual=500_000, metro=False)
    assert tx.hra_exemption(i) == 200_000


def test_80d_limits_and_senior_parents():
    d = tx.deductions(T(2_000_000, health_self=40_000, health_parents=60_000, parents_senior=True), "old")
    assert d["80d"] == 25_000 + 50_000
    d2 = tx.deductions(T(2_000_000, age=65, health_self=80_000, health_parents=80_000, parents_senior=True), "old")
    assert d2["80d"] == 100_000


def test_new_regime_allows_only_standard_and_employer_nps():
    d = tx.deductions(T(2_000_000, ded_80c=150_000, nps_self=50_000, health_self=25_000, home_loan_interest=200_000), "new")
    assert set(d) == {"std", "80ccd2"} and d["std"] == 75_000


def test_employer_nps_caps_by_regime_and_employer():
    i = T(2_000_000, basic_annual=1_000_000, employer_nps_pct=0.14)
    assert tx.employer_nps_deduction(i, "new") == 140_000
    assert tx.employer_nps_deduction(i, "old") == 100_000                       # private: 10%
    assert tx.employer_nps_deduction(T(1, basic_annual=1_000_000, employer_nps_pct=0.14, govt_employer=True), "old") == 140_000


def test_home_loan_interest_capped_at_2_lakh_old_regime():
    assert tx.deductions(T(2_000_000, home_loan_interest=350_000), "old")["24b"] == 200_000


def test_senior_80ttb_only_for_seniors():
    assert tx.deductions(T(1_000_000, age=65, fd_interest=80_000), "old")["80tt"] == 50_000
    assert tx.deductions(T(1_000_000, age=40, fd_interest=80_000), "old")["80tt"] == 0


# ---- comparison, break-even, marginal rate --------------------------------------------------
def test_compare_regimes_picks_cheaper_and_reports_saving():
    heavy = T(1_500_000, ded_80c=150_000, nps_self=50_000, health_self=25_000, home_loan_interest=200_000, health_parents=50_000, parents_senior=True)
    light = T(1_500_000)
    assert tx.compare_regimes(light)["better"] == "new"
    c = tx.compare_regimes(heavy)
    assert c["saving"] == abs(c["old"]["total_tax"] - c["new"]["total_tax"])
    assert c["better"] in ("old", "new")


def test_breakeven_extra_deductions_closes_gap():
    i = T(1_500_000, ded_80c=150_000, nps_self=50_000, health_self=25_000)
    c = tx.compare_regimes(i)
    assert c["better"] == "new" and c["breakeven_extra_deductions"] > 0
    j = T(1_500_000 - c["breakeven_extra_deductions"], ded_80c=150_000, nps_self=50_000, health_self=25_000)
    assert tx.regime_tax(j, "old")["total_tax"] <= c["new"]["total_tax"] + 5


def test_breakeven_zero_when_old_already_cheaper():
    i = T(1_500_000, ded_80c=150_000, nps_self=50_000, health_self=25_000, health_parents=50_000, parents_senior=True,
          home_loan_interest=200_000, hra_received=300_000, rent_paid_annual=420_000, basic_annual=700_000, metro=True)
    c = tx.compare_regimes(i)
    if c["better"] == "old":
        assert c["breakeven_extra_deductions"] == 0


def test_marginal_rate_values():
    assert tx.marginal_rate(T(1_500_000), "new") == 0.156      # 15% slab + 4% cess
    assert tx.marginal_rate(T(1_250_000), "new") == 0.0        # inside the rebate zone
    assert tx.marginal_rate(T(5_000_000), "new") == pytest.approx(0.312, abs=0.001)


def test_capital_gains_tax_special_rates():
    i = T(0, realised_stcg=100_000, realised_ltcg=225_000)
    assert tx.capital_gains_tax(i) == 100_000 * 0.20 + 100_000 * 0.125
    assert tx.capital_gains_tax(T(0, realised_ltcg=100_000)) == 0


# ---- post-tax returns ------------------------------------------------------------------------
PRE = {"equity": 0.11, "debt": 0.065, "gold": 0.075, "liquid": 0.06}


def test_post_tax_returns_are_lower_and_ordered_by_rate():
    lo = tx.post_tax_returns(PRE, 10, 0.052)
    hi = tx.post_tax_returns(PRE, 10, 0.312)
    for k in ("debt", "liquid"):
        assert hi[k] < lo[k] < PRE[k]            # slab-taxed classes depend on the bracket
    assert hi["equity"] == pytest.approx(lo["equity"])   # equity pays the flat 12.5% + cess
    assert hi["equity"] < PRE["equity"]
    assert hi["debt"] < hi["equity"]


def test_post_tax_equity_short_horizon_uses_stcg_rate():
    short = tx.post_tax_returns(PRE, 0.5, 0.3)["equity"]
    long = tx.post_tax_returns(PRE, 5, 0.3)["equity"]
    assert short < long


def test_post_tax_zero_marginal_leaves_debt_unchanged():
    assert tx.post_tax_returns(PRE, 5, 0.0)["debt"] == pytest.approx(0.065)


def test_apply_post_tax_shifts_assumptions_consistently():
    a = {"asset_returns": PRE, "montecarlo": {"asset_mean": {"equity": 0.12, "debt": 0.065, "gold": 0.08, "liquid": 0.06}},
         "retirement": {"post_retirement_return": 0.065}}
    out = tx.apply_post_tax(a, 10, 0.312)
    assert out["asset_returns"]["equity"] < 0.11
    d = out["asset_returns"]["equity"] - 0.11
    assert out["montecarlo"]["asset_mean"]["equity"] == pytest.approx(0.12 + d)
    assert out["retirement"]["post_retirement_return"] < 0.065
    assert a["asset_returns"]["equity"] == 0.11   # input not mutated


# ---- fund tax tags ---------------------------------------------------------------------------
def test_tax_tags_by_category():
    assert tx.tax_tag_for_category("large_cap")["class"] == "equity"
    assert tx.tax_tag_for_category("large_cap")["ltcg_exemption"] == 125_000
    assert tx.tax_tag_for_category("liquid")["slab_always"] is True
    assert tx.tax_tag_for_category("gold")["ltcg_months"] == 24
    assert tx.tax_tag_for_category("gold", needs_demat=True)["ltcg_months"] == 12
    assert tx.tax_tag_for_category("balanced_advantage")["check_factsheet"] is True
    assert tx.tax_tag_for_category("not_a_category")["class"] == "other_24m"
