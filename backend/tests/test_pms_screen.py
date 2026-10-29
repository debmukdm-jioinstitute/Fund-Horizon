from __future__ import annotations
"""Tests for PMS Screening and Scoring Policy."""

import pytest
from app.backoffice.pms_screen import score_pms_strategy, NINE_PMS_STRATEGIES


def test_score_pms_strategy_complete_data():
    strat = {
        "ia_id": "174",
        "strategy_name": "Stallion Asset Core Fund",
        "provider": "Stallion Asset Private Limited",
        "return_1m": 1.59,
        "return_3m": 7.82,
        "return_6m": 39.90,
        "return_1y": 18.39,
        "return_3y": 33.41,
        "aum_crore": 10340.31,
        "benchmark": "BSE 500 TRI",
    }
    bench = {
        "return_1m": -5.57,
        "return_1y": -2.33,
        "return_3y": 9.20,
    }
    res = score_pms_strategy(strat, bench)
    assert res["status"] == "screened"
    assert res["score"] == 100.0
    assert res["rating"] == 5
    assert res["signal"] == "Buy"
    assert len(res["reasons"]) >= 2
    assert "BSE 500 TRI" in res["reasons"][0]


def test_score_pms_strategy_lagging_returns():
    strat = {
        "ia_id": "999",
        "strategy_name": "Underperforming Strategy",
        "provider": "Test AMC",
        "return_1m": -10.0,
        "return_3m": -15.0,
        "return_6m": -12.0,
        "return_1y": -18.0,
        "return_3y": -2.0,
        "aum_crore": 50.0,
        "benchmark": "BSE 500 TRI",
    }
    bench = {
        "return_1m": -2.0,
        "return_1y": 10.0,
        "return_3y": 15.0,
    }
    res = score_pms_strategy(strat, bench)
    assert res["status"] == "screened"
    assert res["score"] < 35.0
    assert res["rating"] in (1, 2)
    assert res["signal"] == "Sell"


def test_score_pms_strategy_incomplete_data():
    strat = {
        "ia_id": "123",
        "strategy_name": "New Strategy",
        "provider": "Test Provider",
        "return_1m": 2.0,
        "return_1y": None,
        "return_3y": None,
        "aum_crore": None,
    }
    res = score_pms_strategy(strat)
    assert res["status"] == "incomplete_inputs"
    assert res["signal"] == "Needs review"
    assert res["score"] is None
    assert res["rating"] is None
    assert len(res["missing_inputs"]) >= 2
