import numpy as np
import pytest

from app.config import load_assumptions
from app.engine import montecarlo as mc_

MC = load_assumptions()["montecarlo"]
MIX_EQ = {"equity": 80, "debt": 10, "gold": 5, "liquid": 5}
MIX_DEBT = {"equity": 10, "debt": 70, "gold": 5, "liquid": 15}


def run(mix, sip, **kw):
    return mc_.simulate(mix, 15, kw.get("initial", 100000), sip, kw.get("step", 0.0), 8_000_000, MC)


def test_reproducible():
    a, b = run(MIX_EQ, 15000), run(MIX_EQ, 15000)
    assert a == b


def test_draw_moments_close_to_config():
    d = mc_.draw_returns(5, MC)
    assert d.shape == (MC["sims"], 5, 4)
    for i, name in enumerate(mc_.ASSETS):
        assert abs(d[:, :, i].mean() - MC["asset_mean"][name]) < 0.01
        assert abs(d[:, :, i].std() - MC["asset_vol"][name]) < 0.01


def test_correlations_close():
    d = mc_.draw_returns(40, MC).reshape(-1, 4)
    c = np.corrcoef(d.T)
    assert abs(c[0, 1] - MC["correlations"]["equity_debt"]) < 0.05
    assert abs(c[0, 3]) < 0.05


def test_success_monotone_in_sip():
    probs = [run(MIX_EQ, s)["success_prob"] for s in range(0, 60001, 5000)]
    assert all(b >= a for a, b in zip(probs, probs[1:]))
    assert probs[0] < probs[-1]


def test_equity_widens_spread():
    e, d = run(MIX_EQ, 20000), run(MIX_DEBT, 20000)
    assert (e["p90"] - e["p10"]) > (d["p90"] - d["p10"])


def test_percentiles_ordered_and_fan_length():
    r = run(MIX_EQ, 20000)
    assert r["p10"] <= r["p50"] <= r["p90"]
    assert len(r["fan"]) == 16 and r["fan"][0]["year"] == 0
    assert all(f["p10"] <= f["p50"] <= f["p90"] for f in r["fan"])


def test_sip_for_success_hits_target():
    s = mc_.sip_for_success(MIX_EQ, 15, 100000, 0.0, 8_000_000, MC)
    assert run(MIX_EQ, s)["success_prob"] >= MC["target_success"]
    assert run(MIX_EQ, max(s - 2, 0))["success_prob"] < MC["target_success"]


def test_sip_for_success_zero_when_already_funded():
    assert mc_.sip_for_success(MIX_EQ, 15, 50_000_000, 0.0, 1_000_000, MC) == 0


def test_step_up_improves_success():
    assert run(MIX_EQ, 10000, step=0.10)["success_prob"] > run(MIX_EQ, 10000)["success_prob"]


def test_zero_volatility_matches_deterministic():
    mc = dict(MC, asset_vol={k: 1e-9 for k in MC["asset_vol"]}, sims=200)
    r = mc_.simulate({"equity": 100}, 10, 0, 10000, 0.0, 1, mc)
    rm = (1.12) ** (1 / 12) - 1
    from app.engine.finmath import sip_fv_factor
    assert r["p50"] == pytest.approx(10000 * sip_fv_factor(rm, 120, True), rel=1e-4)
