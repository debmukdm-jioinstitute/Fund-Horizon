import io
import pytest
import pandas as pd
from starlette.testclient import TestClient

from app.backoffice import fh_score, portfolio_screen
from app.data.loader import load_metrics
from app.main import create_app


def test_rating_to_signal_mapping():
    # 5 or 4 stars -> Buy
    assert fh_score.signal_for_rating(5, 0.8) == "Buy"
    assert fh_score.signal_for_rating(4, 0.7) == "Buy"
    # 3 stars -> Hold
    assert fh_score.signal_for_rating(3, 0.8) == "Hold"
    # 2 or 1 star -> Sell
    assert fh_score.signal_for_rating(2, 0.8) == "Sell"
    assert fh_score.signal_for_rating(1, 0.8) == "Sell"
    # Missing / None / incomplete coverage -> Needs review
    assert fh_score.signal_for_rating(None) == "Needs review"
    assert fh_score.signal_for_rating(5, 0.4) == "Needs review"  # coverage below 60%
    assert fh_score.signal_for_rating(3, 0.2) == "Needs review"


def test_signal_reasons_generation():
    row_buy = {
        "fh_score": 85.0,
        "fh_rating": 5.0,
        "fh_coverage": 0.9,
        "out_3y": 3.5,
        "sortino_3y": 2.1,
        "manager_tenure_years": 4.2,
        "cat_label": "Flexi Cap",
    }
    reasons = fh_score.generate_signal_reasons(row_buy, "Buy")
    assert len(reasons) >= 2
    assert any("outperforms" in r for r in reasons)
    assert any("Sortino" in r for r in reasons)

    row_sell = {
        "fh_score": 32.0,
        "fh_rating": 1.0,
        "fh_coverage": 0.85,
        "out_3y": -4.2,
        "sortino_3y": 0.8,
        "manager_tenure_years": 0.5,
        "cat_label": "Large Cap",
    }
    reasons_sell = fh_score.generate_signal_reasons(row_sell, "Sell")
    assert len(reasons_sell) >= 2
    assert any("trails" in r for r in reasons_sell)

    row_review = {
        "fh_score": None,
        "fh_rating": None,
        "fh_coverage": 0.35,
        "cat_label": "Small Cap",
    }
    reasons_rev = fh_score.generate_signal_reasons(row_review, "Needs review")
    assert any("coverage" in r.lower() for r in reasons_rev)


def test_extract_and_deduplicate_holdings():
    parsed = {
        "folios": [
            {
                "folio": "12345/0",
                "amc": "HDFC Mutual Fund",
                "schemes": [
                    {
                        "scheme": "HDFC Flexi Cap Fund - Direct Plan - Growth",
                        "isin": "INF179K01BE2",
                        "close": 100.0,
                        "valuation": {"nav": 150.0, "value": 15000.0, "date": "2026-10-25"},
                    },
                    # Repeated folio entry (e.g. summary or transaction) should be combined
                    {
                        "scheme": "HDFC Flexi Cap Fund - Direct Plan - Growth",
                        "isin": "INF179K01BE2",
                        "close": 50.0,
                        "valuation": {"nav": 150.0, "value": 7500.0, "date": "2026-10-25"},
                    },
                    # Zero units / closed position should be skipped
                    {
                        "scheme": "HDFC Liquid Fund - Regular Plan - Growth",
                        "isin": "INF179K01010",
                        "close": 0.0,
                        "valuation": {"nav": 10.0, "value": 0.0, "date": "2026-10-25"},
                    },
                ],
            }
        ]
    }
    holdings = portfolio_screen.extract_raw_holdings(parsed)
    assert len(holdings) == 1
    h = holdings[0]
    assert h["isin"] == "INF179K01BE2"
    assert h["units"] == 150.0
    assert h["statement_value"] == 22500.0


def test_direct_regular_and_growth_idcw_distinctions():
    # Synthetic frame with Direct and Regular versions
    frame = pd.DataFrame([
        {
            "code": "1001",
            "isin": "INF100DIRECT",
            "name": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
            "plan": "Direct",
            "cat": "flexi_cap",
            "cat_label": "Flexi Cap",
            "fh_score": 82.0,
            "fh_rating": 4.0,
            "fh_signal": "Buy",
            "fh_signal_reasons": ["Outperforms category"],
            "nav_date": "2026-10-28",
        },
        {
            "code": "1002",
            "isin": "INF100REGULAR",
            "name": "Parag Parikh Flexi Cap Fund - Regular Plan - Growth",
            "plan": "Regular",
            "cat": "flexi_cap",
            "cat_label": "Flexi Cap",
            "fh_score": 75.0,
            "fh_rating": 3.0,
            "fh_signal": "Hold",
            "fh_signal_reasons": ["Consistent performance"],
            "nav_date": "2026-10-28",
        },
    ])

    holdings = [
        # Direct holding must match Direct scheme
        {"raw_name": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", "isin": "INF100DIRECT", "statement_value": 50000.0},
        # Regular holding must match Regular scheme
        {"raw_name": "Parag Parikh Flexi Cap Fund - Regular Plan - Growth", "isin": "INF100REGULAR", "statement_value": 30000.0},
        # IDCW holding must flag Needs Review
        {"raw_name": "Parag Parikh Flexi Cap Fund - Direct Plan - IDCW", "isin": "INF100DIRECT", "statement_value": 20000.0},
    ]

    res = portfolio_screen.match_and_screen_portfolio(holdings, frame)
    h_list = res["holdings"]
    assert len(h_list) == 3

    # Direct matched
    assert h_list[0]["amfi_code"] == "1001"
    assert h_list[0]["plan"] == "Direct"
    assert h_list[0]["fh_signal"] == "Buy"

    # Regular matched
    assert h_list[1]["amfi_code"] == "1002"
    assert h_list[1]["plan"] == "Regular"
    assert h_list[1]["fh_signal"] == "Hold"

    # IDCW flags Needs review
    assert h_list[2]["fh_signal"] == "Needs review"
    assert any("IDCW" in r for r in h_list[2]["fh_signal_reasons"])

    # Weights sum to 100%
    assert round(sum(h["portfolio_weight_pct"] for h in h_list), 1) == 100.0


def test_screener_and_portfolio_score_equality():
    from app.api.backoffice import _fh_frame

    frame = _fh_frame()
    sample_fund = frame[frame["fh_rating"].notna()].iloc[0]

    code = str(sample_fund["code"])
    isin = sample_fund["isin"]
    name = sample_fund["name"]

    holdings = [{
        "raw_name": name,
        "isin": isin,
        "amfi_code": code,
        "statement_value": 100000.0,
    }]

    screen_res = portfolio_screen.match_and_screen_portfolio(holdings, frame)
    h = screen_res["holdings"][0]

    # Scores, ratings and signals must be identical
    assert h["fh_score"] == sample_fund["fh_score"]
    assert h["fh_rating"] == sample_fund["fh_rating"]
    assert h["fh_signal"] == sample_fund["fh_signal"]


def test_portfolio_screen_api_access_control():
    app = create_app()
    client = TestClient(app)

    # Without staff auth header/cookie -> 401 Unauthorized
    resp = client.post(
        "/api/backoffice/mutual-funds/portfolio-screen",
        files={"file": ("test.pdf", b"%PDF-1.4 dummy", "application/pdf")},
    )
    assert resp.status_code in (401, 403)


def test_universal_distributor_statement_extraction():
    sample_text = """
    Proaffluence Associates Private Limited
    AMFI Registered Mutual Fund Distributor
    Report as on: 26-Oct-2026
    Aditya Satish Parchure (ATMPP2601B)
    MF Summary Report - Sub Category wise
    Equity - Large Cap Fund
    Mirae Asset Large Cap Fund - Regular Plan - Growth | 70414596465 | Aditya Satish Parchure
    104.3080
    23-10-2026
    10-06-2024 763.647 ₹ 84,011 ₹ 79,654 ₹ -4,357 -5.19 0 -4.53 427
    Equity - Mid Cap Fund
    HDFC Mid Cap Fund - Regular Plan - Growth | 15668524/46 | Aditya Satish Parchure
    192.3300
    23-10-2026
    24-04-2019 2,879.186 ₹ 2,70,000 ₹ 5,53,754 ₹ 2,83,754 105.09 0 18.81 1760
    Equity -Flexi Cap
    Kotak Flexi Cap Fund - Growth | 5771141 | Aditya Satish Parchure
    78.8310
    23-10-2026
    04-01-2019 5,422.026 ₹ 2,82,000 ₹ 4,27,424 ₹ 1,45,424 51.57 0 10.48 1703
    Grand total
    ₹ 6,36,011 ₹ 10,60,832 ₹ 4,24,821 66.79 0 14.26
    """
    holdings, st_date = portfolio_screen.extract_universal_from_text(sample_text)
    assert len(holdings) == 3
    assert holdings[0]["raw_name"] == "Mirae Asset Large Cap Fund - Regular Plan - Growth"
    assert holdings[0]["units"] == 763.647
    assert holdings[0]["statement_value"] == 79654.0
    assert holdings[1]["raw_name"] == "HDFC Mid Cap Fund - Regular Plan - Growth"
    assert holdings[1]["statement_value"] == 553754.0
    assert holdings[2]["raw_name"] == "Kotak Flexi Cap Fund - Growth"
    assert holdings[2]["statement_value"] == 427424.0
    assert sum(h["statement_value"] for h in holdings) == 1060832.0
    assert st_date == "26-Oct-2026"

