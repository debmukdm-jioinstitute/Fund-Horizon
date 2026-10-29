from __future__ import annotations
"""API tests for PMS Screening, Matrix, Upload, and Attribution."""

import io
import pytest
from tests.test_backoffice_api import _create_staff, _login_staff


def test_pms_screening_and_matrix_api(client):
    _login_staff(client, _create_staff("analyst"))

    # Test matrix endpoint
    res = client.get("/api/backoffice/pms/matrix")
    assert res.status_code == 200
    data = res.json()
    assert data["strategies_count"] == 9
    assert len(data["data"]) == 9
    first = data["data"][0]
    assert "strategy_name" in first
    assert "score" in first
    assert "signal" in first
    assert "reasons" in first

    # Test attribution endpoint
    body = {
        "portfolio_sectors": [
            {"sector": "Financials", "weight": 0.40, "return": 15.0},
            {"sector": "Technology", "weight": 0.35, "return": 25.0},
            {"sector": "Consumer", "weight": 0.25, "return": 10.0},
        ],
        "benchmark_sectors": [
            {"sector": "Financials", "weight": 0.30, "return": 12.0},
            {"sector": "Technology", "weight": 0.40, "return": 20.0},
            {"sector": "Consumer", "weight": 0.30, "return": 8.0},
        ],
    }
    att_res = client.post("/api/backoffice/pms/attribution", json=body)
    assert att_res.status_code == 200
    att = att_res.json()
    assert att["active_return"] == 3.25
    assert att["sum_effects"] == 3.25
    assert att["residual"] == 0.0
