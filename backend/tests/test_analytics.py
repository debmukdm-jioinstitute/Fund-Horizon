import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.data.loader import eligible_funds, load_nav
from app.engine import analytics as an
from app.engine import montecarlo as mc
from app.main import create_app


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(scope="module")
def sample_fund():
    df = eligible_funds()
    return df[df["data_quality"] == "ok"].iloc[0]


def test_trailing_return_and_cagr():
    dates = pd.date_range("2020-01-31", periods=37, freq="ME")
    # Series with 10% annual compound growth
    navs = 100.0 * ((1.10) ** (np.arange(37) / 12.0))
    s = pd.Series(navs, index=dates)

    r_1y = an.trailing_return(s, years=1)
    r_3y = an.trailing_return(s, years=3)
    cagr_full = an.cagr(s)

    assert r_1y is not None and abs(r_1y - 0.10) < 0.01
    assert r_3y is not None and abs(r_3y - 0.10) < 0.005
    assert cagr_full is not None and abs(cagr_full - 0.10) < 0.005
    assert an.trailing_return(s, years=10) is None


def test_rolling_return_stats_matches_dataset_csv(sample_fund):
    code = sample_fund["scheme_code"]
    nav = load_nav(code)
    stats3y = an.rolling_return_stats(nav, window_years=3)

    assert stats3y["median"] is not None
    assert abs(stats3y["median"] - sample_fund["roll3y_median"]) < 1e-4
    assert abs(stats3y["min"] - sample_fund["roll3y_min"]) < 1e-4
    assert abs(stats3y["max"] - sample_fund["roll3y_max"]) < 1e-4
    assert abs(stats3y["pct_positive"] - sample_fund["roll3y_pct_positive"]) < 1e-4


def test_sip_xirr_positive_growth():
    dates = pd.date_range("2021-01-31", periods=36, freq="ME")
    navs = 10.0 * ((1.12) ** (np.arange(36) / 12.0))
    s = pd.Series(navs, index=dates)

    xirr = an.sip_xirr(s, pmt=1000.0)
    assert xirr is not None
    # For a 12% steady growth fund, SIP XIRR is close to 12%
    assert 0.10 < xirr < 0.14


def test_volatility_sharpe_sortino():
    dates = pd.date_range("2020-01-31", periods=36, freq="ME")
    np.random.seed(42)
    rets = np.random.normal(0.01, 0.04, 36)
    s = pd.Series(100.0 * np.cumprod(1.0 + rets), index=dates)

    vol = an.annualized_volatility(s, periods_per_year=12)
    assert vol > 0.05
    cagr_val = an.cagr(s)
    sharpe = an.sharpe_ratio(cagr_val, vol, rf=0.065)
    sortino = an.sortino_ratio(s, cagr_val, rf=0.065, periods_per_year=12)

    assert sharpe is not None
    assert sortino is not None


def test_max_drawdown_and_duration():
    dates = pd.date_range("2020-01-31", periods=5, freq="ME")
    # 100 -> 120 -> 90 -> 110 -> 130
    s = pd.Series([100.0, 120.0, 90.0, 110.0, 130.0], index=dates)

    dd = an.max_drawdown(s)
    # Peak is 120, trough is 90 -> dd = 90/120 - 1 = -0.25
    assert abs(dd - (-0.25)) < 1e-6

    dur = an.max_drawdown_duration(s)
    assert dur["max_drawdown"] == -0.25
    assert dur["longest_underwater_months"] >= 1
    assert dur["peak_date"] == "2020-02-29"
    assert dur["trough_date"] == "2020-03-31"


def test_capture_ratios():
    dates = pd.date_range("2020-01-31", periods=24, freq="ME")
    b_ret = np.array([0.02, -0.02] * 12)
    f_ret = np.array([0.03, -0.01] * 12)  # Better upside, milder downside

    bench = pd.Series(100.0 * np.cumprod(1.0 + b_ret), index=dates)
    fund = pd.Series(100.0 * np.cumprod(1.0 + f_ret), index=dates)

    cap = an.capture_ratios(fund, bench)
    assert cap["upside_capture"] is not None and cap["upside_capture"] > 100.0
    assert cap["downside_capture"] is not None and cap["downside_capture"] < 100.0


def test_correlation_matrix_and_overlap():
    dates = pd.date_range("2020-01-31", periods=24, freq="ME")
    s1 = pd.Series(100.0 * np.cumprod(1.0 + np.full(24, 0.01)), index=dates)
    s2 = pd.Series(100.0 * np.cumprod(1.0 + np.full(24, 0.01)), index=dates)
    s3 = pd.Series(100.0 * np.cumprod(1.0 + np.array([0.02, -0.01] * 12)), index=dates)

    res = an.return_correlation_matrix({"F1": s1, "F2": s2, "F3": s3}, threshold=0.80)
    assert res["label"] == "return-correlation overlap, not holdings overlap"
    assert len(res["codes"]) == 3
    assert len(res["matrix"]) == 3


def test_pyportfolioopt_weights():
    df = eligible_funds()
    sample_codes = df["scheme_code"].head(3).tolist()
    navs = {c: load_nav(c) for c in sample_codes}

    opt = an.optimize_portfolio_weights(navs, min_weight=0.05, max_weight=0.60)
    assert opt["max_sharpe"] is not None
    assert opt["min_volatility"] is not None
    assert opt["hrp"] is not None
    assert abs(sum(opt["max_sharpe"].values()) - 1.0) < 0.02
    assert abs(sum(opt["min_volatility"].values()) - 1.0) < 0.02
    assert abs(sum(opt["hrp"].values()) - 1.0) < 0.02


def test_montecarlo_bootstrap_mode():
    from app.config import load_assumptions

    mc_conf = load_assumptions()["montecarlo"]
    # 5 years of historical returns for 4 assets
    hist = np.array([
        [0.12, 0.06, 0.08, 0.06],
        [-0.10, 0.07, 0.15, 0.06],
        [0.15, 0.06, -0.02, 0.06],
        [0.20, 0.05, 0.10, 0.06],
    ])

    draws = mc.draw_returns(years=5, mc=mc_conf, method="bootstrap", historical_returns=hist)
    assert draws.shape == (mc_conf["sims"], 5, 4)

    sim = mc.simulate(
        {"equity": 70, "debt": 30},
        years=5,
        initial=100000,
        sip=10000,
        step_up=0.0,
        target=800000,
        mc=mc_conf,
        method="bootstrap",
        historical_returns=hist,
    )
    assert 0.0 <= sim["success_prob"] <= 1.0
    assert len(sim["fan"]) == 6


# --- API Endpoint Tests ---


def test_api_fund_analytics(client, sample_fund):
    code = sample_fund["scheme_code"]
    res = client.get(f"/api/funds/{code}/analytics")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["scheme_code"] == code
    assert "returns" in data and "rolling_returns" in data and "risk" in data
    assert data["returns"]["sip_xirr"] is not None
    assert "capture_ratios" in data
    assert "disclaimer" in data


def test_api_funds_compare(client):
    df = eligible_funds()
    codes = df["scheme_code"].head(3).tolist()
    res = client.get(f"/api/funds/compare?codes={','.join(codes)}")
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data["funds"]) == 3
    assert "correlation" in data
    assert data["correlation"]["label"] == "return-correlation overlap, not holdings overlap"


def test_api_category_ranking(client):
    res = client.get("/api/categories/large_cap/ranking")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["category"] == "large_cap"
    assert data["total_schemes"] > 5
    assert data["rankings"][0]["rank"] == 1
    assert "score" in data["rankings"][0]


def test_api_portfolio_analyze(client):
    df = eligible_funds()
    codes = df["scheme_code"].head(3).tolist()
    body = {
        "holdings": [
            {"scheme_code": codes[0], "weight_pct": 50.0},
            {"scheme_code": codes[1], "weight_pct": 30.0},
            {"scheme_code": codes[2], "weight_pct": 20.0},
        ],
        "correlation_threshold": 0.85,
    }
    res = client.post("/api/portfolio/analyze", json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data["holdings"]) == 3
    assert "correlation" in data
    assert "alternative_weights" in data
    assert data["alternative_weights"]["max_sharpe"] is not None
