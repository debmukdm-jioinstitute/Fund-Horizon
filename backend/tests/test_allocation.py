import itertools
import math

import pytest

from app.config import load_allocation
from app.engine import allocation as al

BANDS = [b["name"] for b in load_allocation()["bands"]]


@pytest.mark.parametrize("band,years", list(itertools.product(BANDS, range(1, 41))))
def test_rows_sum_to_100(band, years):
    a = al.goal_allocation(band, years)
    assert math.isclose(sum(a.values()), 100.0, abs_tol=1e-9)
    mix = al.asset_mix_for_goal(band, years)
    assert math.isclose(sum(mix.values()), 100.0, abs_tol=1e-9)
    assert math.isclose(sum(al.to_asset_classes(a).values()), 100.0, abs_tol=1e-9)


@pytest.mark.parametrize("band", BANDS)
def test_short_goals_never_have_equity_or_gold(band):
    for years in (1, 2):
        mix = al.asset_mix_for_goal(band, years)
        assert mix["equity"] == 0 and mix["gold"] == 0
        a = al.goal_allocation(band, years)
        assert set(a) == {"liquid", "short_duration"} and a["liquid"] == a["short_duration"] == 50


@pytest.mark.parametrize("years,cap", [(2.9, 0), (3, 30), (4.9, 30), (5, 50), (6.9, 50), (7, 70), (9.9, 70), (10, 100)])
def test_equity_cap_boundaries(years, cap):
    assert al.equity_cap(years) == cap


def test_band_equity_matches_config_at_long_horizon():
    for b in load_allocation()["bands"]:
        assert al.asset_mix_for_goal(b["name"], 15)["equity"] == b["equity"]
        mix = al.asset_mix_for_goal(b["name"], 15)
        assert (mix["debt"], mix["gold"], mix["liquid"]) == (b["debt"], b["gold"], b["liquid"])


def test_equity_cut_by_horizon_and_freed_to_debt_liquid():
    mix = al.asset_mix_for_goal("Aggressive", 4)
    assert mix["equity"] == 30 and mix["gold"] == 6
    assert math.isclose(mix["debt"] + mix["liquid"], 64)


def test_weighted_allocation_is_weighted_average():
    a1 = al.goal_allocation("Moderate", 15)
    a2 = al.goal_allocation("Moderate", 2)
    w = al.weighted_allocation([(a1, 3.0), (a2, 1.0)])
    for cat in set(a1) | set(a2):
        expect = (3 * a1.get(cat, 0) + 1 * a2.get(cat, 0)) / 4
        assert math.isclose(w.get(cat, 0), expect, abs_tol=1e-9)
    assert math.isclose(sum(w.values()), 100.0)
    with pytest.raises(ValueError):
        al.weighted_allocation([(a1, 0.0)])


def test_equity_split_matches_config():
    a = al.goal_allocation("Moderate", 15)
    assert math.isclose(a["large_cap"] / a["flexi_cap"], 40 / 30)
    assert "mid_cap" in a and "small_cap" in a
    assert "mid_cap" not in al.goal_allocation("Conservative", 15)
