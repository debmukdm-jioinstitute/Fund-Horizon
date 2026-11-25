"""Unit & API tests for Equities and Scrip Details module."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from app.api.equities import _chart, _detail, _fmt_inr_short, _raw
from app.db import sqlite


def _create_staff(role="analyst"):
    tag = secrets.token_hex(6)
    created = sqlite.create_customer(
        name="Staff Equity",
        email=f"staff_equity_{tag}@fundhorizon.internal",
        mobile=f"98{secrets.randbelow(90000000) + 10000000}",
        password_hash="pbkdf2_sha256$test",
        role=role,
    )
    user_id = created["id"]
    sqlite.update_customer(user_id, {"is_staff": 1, "status": "active"})
    return user_id


def _login_staff(client, staff_id):
    client.cookies.clear()
    token = secrets.token_urlsafe(32)
    sqlite.create_auth_session(
        staff_id,
        hashlib.sha256(token.encode()).hexdigest(),
        (datetime.now(UTC) + timedelta(days=30)).isoformat(),
    )
    client.cookies.set("fh_session", token)


def test_fmt_inr_short():
    assert _fmt_inr_short(None) == "—"
    assert _fmt_inr_short(18.59e12) == "₹18.59T"
    assert _fmt_inr_short(50_000_000) == "₹5.00 Cr"
    assert _fmt_inr_short(250_000) == "₹2.50 Lakh"
    assert _fmt_inr_short(1500) == "₹1,500.00"


def test_raw_helper():
    assert _raw(None) is None
    assert _raw({"raw": 42.5, "fmt": "42.5%"}) == 42.5
    assert _raw(100) == 100
    assert _raw(None, default=0) == 0


def test_detail_mocked():
    mock_quote = {
        "symbol": "TCS",
        "name": "Tata Consultancy Services Limited",
        "price": 2500.0,
        "prev_close": 2450.0,
        "day_high": 2520.0,
        "day_low": 2440.0,
        "high_52w": 3000.0,
        "low_52w": 2200.0,
        "volume": 1200000,
        "currency": "INR",
    }
    mock_summary = {
        "quoteSummary": {
            "result": [{
                "assetProfile": {
                    "sector": "Technology",
                    "industry": "Information Technology Services",
                    "website": "https://www.tcs.com",
                    "fullTimeEmployees": 600000,
                    "city": "Mumbai",
                    "longBusinessSummary": "Tata Consultancy Services provides IT services.",
                    "companyOfficers": [{"name": "K. Krithivasan", "title": "CEO & MD", "age": 59}],
                },
                "summaryDetail": {
                    "marketCap": {"raw": 9000000000000},
                    "trailingPE": {"raw": 28.5},
                    "forwardPE": {"raw": 24.2},
                    "priceToSalesTrailing12Months": {"raw": 4.1},
                    "dividendYield": {"raw": 0.018},
                    "dividendRate": {"raw": 45.0},
                    "beta": {"raw": 0.85},
                },
                "defaultKeyStatistics": {
                    "priceToBook": {"raw": 8.5},
                    "enterpriseValue": {"raw": 8800000000000},
                    "trailingEps": {"raw": 87.7},
                    "forwardEps": {"raw": 103.3},
                    "pegRatio": {"raw": 2.1},
                },
                "financialData": {
                    "returnOnEquity": {"raw": 0.42},
                    "operatingMargins": {"raw": 0.25},
                    "totalDebt": {"raw": 80000000000},
                    "totalCash": {"raw": 150000000000},
                    "freeCashflow": {"raw": 350000000000},
                    "targetMeanPrice": {"raw": 2800.0},
                    "recommendationKey": "buy",
                    "numberOfAnalystOpinions": {"raw": 35},
                },
                "majorHoldersBreakdown": {
                    "insidersPercentHeld": {"raw": 0.72},
                    "institutionsPercentHeld": {"raw": 0.18},
                },
                "earnings": {
                    "financialsChart": {
                        "yearly": [{"date": 2024, "revenue": {"raw": 2400000000000}, "earnings": {"raw": 460000000000}}],
                    }
                },
            }]
        }
    }

    with patch("app.api.equities._quote", return_value=mock_quote), \
         patch("app.api.equities._YS.get_crumb", return_value="test_crumb"), \
         patch("app.api.equities._YS.get_json", return_value=mock_summary):
        res = _detail("TCS")
        assert res["symbol"] == "TCS"
        assert res["name"] == "Tata Consultancy Services Limited"
        assert res["price"] == 2500.0
        assert res["pe_trailing"] == 28.5
        assert res["roe"] == 0.42
        assert res["profile"]["sector"] == "Technology"
        assert res["profile"]["city"] == "Mumbai"
        assert res["shareholding"]["promoter_pct"] == 72.0
        assert res["analyst"]["recommendation"] == "Buy"
        assert res["analyst"]["upside_pct"] == 12.0
        assert "screener" in res["external_links"]
        assert "tradingview" in res["external_links"]


def test_chart_mocked():
    mock_chart_resp = {
        "chart": {
            "result": [{
                "meta": {
                    "currency": "INR",
                    "symbol": "TCS.NS",
                    "regularMarketPrice": 2500.0,
                    "chartPreviousClose": 2400.0,
                },
                "timestamp": [1700000000, 1700003600, 1700007200],
                "indicators": {
                    "quote": [{
                        "open": [2400.0, 2450.0, 2480.0],
                        "high": [2460.0, 2490.0, 2510.0],
                        "low": [2390.0, 2440.0, 2470.0],
                        "close": [2450.0, 2480.0, 2500.0],
                        "volume": [100000, 120000, 150000],
                    }]
                }
            }]
        }
    }
    with patch("app.api.equities._get", return_value=mock_chart_resp):
        res = _chart("TCS", "1mo")
        assert res["symbol"] == "TCS"
        assert res["range"] == "1mo"
        assert len(res["candles"]) == 3
        assert res["period_change"] == 50.0
        assert res["period_high"] == 2510.0
        assert res["period_low"] == 2390.0


def test_equities_api_endpoints(client):
    sid = _create_staff("analyst")
    _login_staff(client, sid)

    # 1. Invalid symbol returns 422
    r_bad = client.get("/api/backoffice/equities/detail?symbol=INVALID$$$")
    assert r_bad.status_code == 422

    # 2. Detail endpoint with mock
    with patch("app.api.equities._detail", return_value={"symbol": "INFY", "price": 1500.0}):
        r = client.get("/api/backoffice/equities/detail?symbol=INFY")
        assert r.status_code == 200
        assert r.json()["data"]["symbol"] == "INFY"

    # 3. Chart endpoint with mock
    with patch("app.api.equities._chart", return_value={"symbol": "INFY", "candles": []}):
        r = client.get("/api/backoffice/equities/chart?symbol=INFY&range=1y")
        assert r.status_code == 200
        assert r.json()["data"]["symbol"] == "INFY"
