from __future__ import annotations
"""Tests for Brinson-Fachler attribution & portfolio contribution."""

import pytest
from app.backoffice.analytics.attribution import (
    calculate_brinson_fachler,
    calculate_portfolio_contribution,
)


def test_brinson_fachler_reconciliation():
    # Setup test sectors
    portfolio_sectors = [
        {"sector": "Financials", "weight": 0.40, "return": 15.0},
        {"sector": "Technology", "weight": 0.35, "return": 25.0},
        {"sector": "Consumer", "weight": 0.25, "return": 10.0},
    ]
    benchmark_sectors = [
        {"sector": "Financials", "weight": 0.30, "return": 12.0},
        {"sector": "Technology", "weight": 0.40, "return": 20.0},
        {"sector": "Consumer", "weight": 0.30, "return": 8.0},
    ]

    # R_p = 0.40*15 + 0.35*25 + 0.25*10 = 6.0 + 8.75 + 2.5 = 17.25%
    # R_b = 0.30*12 + 0.40*20 + 0.30*8  = 3.6 + 8.0 + 2.4  = 14.00%
    # Active Return = 17.25 - 14.00 = +3.25%

    res = calculate_brinson_fachler(portfolio_sectors, benchmark_sectors)
    assert res["status"] == "calculated"
    assert res["portfolio_return"] == 17.25
    assert res["benchmark_return"] == 14.00
    assert res["active_return"] == 3.25
    assert abs(res["sum_effects"] - res["active_return"]) < 1e-4
    assert res["residual"] == 0.0

    # Sector breakdown validation
    sec_map = {s["sector"]: s for s in res["sectors"]}
    assert "Financials" in sec_map
    assert "Technology" in sec_map
    assert "Consumer" in sec_map


def test_portfolio_contribution():
    holdings = [
        {"security": "Stock A", "sector": "Tech", "weight": 0.10, "return": 50.0},
        {"security": "Stock B", "sector": "Bank", "weight": 0.20, "return": 10.0},
        {"security": "Stock C", "sector": "Auto", "weight": 0.05, "return": -20.0},
    ]
    contribs = calculate_portfolio_contribution(holdings)
    assert len(contribs) == 3
    # Top contributor should be Stock A: 0.10 * 50.0 = 5.0
    assert contribs[0]["security"] == "Stock A"
    assert contribs[0]["contribution"] == 5.0
    # Stock B: 0.20 * 10 = 2.0
    assert contribs[1]["security"] == "Stock B"
    assert contribs[1]["contribution"] == 2.0
    # Stock C: 0.05 * -20 = -1.0
    assert contribs[2]["security"] == "Stock C"
    assert contribs[2]["contribution"] == -1.0

