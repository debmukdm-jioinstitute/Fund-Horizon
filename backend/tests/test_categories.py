import pytest

from app.config import load_allocation
from app.data.categories import needs_demat, normalise_category
from app.engine.funds import min_history


@pytest.mark.parametrize("cat,name,key", [
    ("Equity Scheme - Large Cap Fund", "X Large Cap", "large_cap"),
    ("Equity Schemes - Large Cap Fund", "X Large Cap", "large_cap"),
    ("Equity Scheme - Large & Mid Cap Fund", "X", "large_mid_cap"),
    ("Equity Scheme - Sectoral/ Thematic", "X", "sectoral_thematic"),
    ("Income/Debt Oriented Schemes - Liquid Fund", "X", "liquid"),
    ("Debt Scheme - Liquid Fund", "X", "liquid"),
    ("Debt Scheme - Banking and PSU Fund", "X", "banking_psu"),
    ("Income/Debt Oriented Schemes - Banking and PSU Debt Fund", "X", "banking_psu"),
    ("Income/Debt Oriented Schemes - Ultra Short to Short Term Fund", "X", "short_duration"),
    ("Hybrid Schemes - Aggressive Hybrid Fund", "X", "aggressive_hybrid"),
    ("Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage", "X", "balanced_advantage"),
    ("Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)", "Axis Gold Fund", "gold"),
    ("Other Scheme - Index Funds", "Nifty 50 Index Fund", "index_equity"),
    ("Other Scheme - Index Funds", "Nifty SDL Index Fund", "index_debt"),
])
def test_normalise_examples(cat, name, key):
    assert normalise_category(cat, name) == key


def test_goldman_is_not_gold():
    assert normalise_category("Equity Scheme - Large Cap Fund", "Goldman Sachs Large Cap") == "large_cap"


def test_gold_etf_needs_demat_fof_does_not():
    assert needs_demat("Exchange Traded Funds (ETFs) - Gold ETF", "Invesco India Gold Exchange Traded Fund")
    assert not needs_demat("Other Scheme - FoF Domestic", "Bandhan Gold ETF FOF")


def test_no_unmapped_eligible_categories(eligible):
    assert (eligible["cat"] == "other").sum() == 0


def test_every_allocator_category_has_five_eligible_schemes(eligible):
    cfg = load_allocation()
    cats = set(cfg["asset_class"])
    for cat in cats:
        pool = eligible[
            (eligible["cat"] == cat) & (~eligible["needs_demat"])
            & (eligible["history_years"] >= min_history(cat))
        ]
        assert len(pool) >= 5, f"{cat} has only {len(pool)} eligible schemes"
