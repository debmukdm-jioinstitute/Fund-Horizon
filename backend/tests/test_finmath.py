import math

from app.engine import finmath as fm


def test_sip_fv_anchor_ordinary():
    assert round(fm.sip_fv(10_000, 0.01, 120, due=False)) == 2_300_387


def test_sip_fv_anchor_due():
    assert round(fm.sip_fv(10_000, 0.01, 120, due=True)) == 2_323_391


def test_required_sip_inverts_fv():
    assert abs(fm.required_sip(2_300_387, 0.01, 120, due=False) - 10_000) <= 1
    assert abs(fm.required_sip(2_323_391, 0.01, 120, due=True) - 10_000) <= 1


def test_required_sip_credits_existing_and_floors_zero():
    assert fm.required_sip(100, 0.01, 12, existing_fv=500) == 0.0
    assert fm.required_sip(100, 0.01, 0) == 0.0


def test_step_up_reduces_initial_sip():
    flat = fm.required_sip(5_000_000, 0.009, 180)
    stepped = fm.required_sip(5_000_000, 0.009, 180, step_up=0.10)
    assert stepped < flat
    assert math.isclose(fm.sip_fv(stepped, 0.009, 180, due=True, step_up=0.10), 5_000_000, rel_tol=1e-9)


def test_monthly_rate_effective():
    r = fm.monthly_rate(0.12)
    assert math.isclose((1 + r) ** 12, 1.12)


def test_growing_annuity_edge_equal_rates():
    assert fm.growing_annuity_due_pv(100, 0.06, 0.06, 10) == 1000


def test_growing_annuity_known_value():
    # g=0: due annuity of 100 for 3 yrs at 10%: 100 + 100/1.1 + 100/1.21
    assert math.isclose(fm.growing_annuity_due_pv(100, 0, 0.10, 3), 100 + 100 / 1.1 + 100 / 1.21)


def test_retirement_corpus_positive_and_scales():
    c = fm.retirement_corpus(600_000, 0.06, 20, 0.065, 25)
    assert c > 600_000 * 20
    assert math.isclose(fm.retirement_corpus(1_200_000, 0.06, 20, 0.065, 25), 2 * c)


def test_level_annuity_pv():
    assert math.isclose(fm.level_annuity_pv(100, 0.0, 5), 500)
    assert math.isclose(fm.level_annuity_pv(100, 0.1, 2), 100 / 1.1 + 100 / 1.21)


def test_indian_format():
    assert fm.indian_format(1234567) == "₹12,34,567"
    assert fm.indian_format(999) == "₹999"
    assert fm.indian_format(100000) == "₹1,00,000"
    assert fm.indian_format(-250000) == "-₹2,50,000"
