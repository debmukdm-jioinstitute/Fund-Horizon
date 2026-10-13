"""Tests for data adapters, parser schemas, currency cross-rates, and import validation."""
from __future__ import annotations

import pytest

from app.backoffice.providers.amfi import AmfiProvider, classify_plan_option
from app.backoffice.providers.cboe import CboeProvider, parse_cboe_date
from app.backoffice.providers.ecb import EcbProvider, compute_cross_rates
from app.backoffice.providers.fred import FredProvider
from app.backoffice.providers.manual import ManualImportValidator, get_template_csv
from app.backoffice.providers.mfapi import MfapiProvider


def test_amfi_8_column_header_parser():
    provider = AmfiProvider()
    content = """Open Ended Schemes ( Equity Scheme - Multi Cap Fund )
Aditya Birla Sun Life Mutual Fund
Scheme Code;Scheme Name;Plan;Option;ISIN Div Payout/ ISIN Growth;Net Asset Value;Sale Price;Date
119551;Aditya Birla Sun Life Frontline Equity Fund;Direct;Growth;INF209K01157;428.12;;09-Oct-2026
119552;Aditya Birla Sun Life Frontline Equity Fund;Regular;Growth;INF209K01165;395.50;;09-Oct-2026
"""
    res = provider.parse_content(content)
    assert res.success is True
    assert res.status == "ready"
    assert len(res.observations) == 2
    obs1 = res.observations[0]
    assert obs1.instrument_id == "MF:119551"
    assert obs1.value_numeric == 428.12
    assert obs1.observed_at == "2026-10-09"
    assert obs1.provenance == "AMFI"
    schemes = res.metadata["schemes"]
    assert schemes[0]["plan"] == "Direct" and schemes[0]["option"] == "Growth"
    assert schemes[1]["plan"] == "Regular" and schemes[1]["option"] == "Growth"
    assert schemes[0]["latest_nav_date"] == "2026-10-09"


def test_amfi_live_navall_plan_option_and_missing_isin():
    provider = AmfiProvider()
    content = """Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Debt Scheme - Banking and PSU Fund)

Franklin Templeton Mutual Fund

129008;INF090I01KR8;-;Franklin India Banking & PSU Debt Fund;Direct Plan;Growth;25.3336;12-Oct-2026
129007;INF090I01KP2;INF090I01KQ0;Franklin India Banking & PSU Debt Fund;Regular Plan;IDCW;10.8459;12-Oct-2026
129006;-;-;No Date Fund;Regular Plan;Growth;10.0;
"""
    res = provider.parse_content(content)
    assert res.success is True
    by_code = {s["scheme_code"]: s for s in res.metadata["schemes"]}
    direct = by_code["129008"]
    regular = by_code["129007"]
    assert direct["plan"] == "Direct" and direct["option"] == "Growth"
    assert direct["latest_nav_date"] == "2026-10-12"
    assert direct["isin"] == "INF090I01KR8" and direct["isin_reinvest"] is None
    assert regular["plan"] == "Regular" and regular["option"] == "IDCW"
    assert regular["isin_reinvest"] == "INF090I01KQ0"
    assert "129006" not in by_code  # no NAV date → skip


def test_classify_plan_option_from_name_and_columns():
    assert classify_plan_option("Axis Children's Fund", "Direct Plan", "Growth Option") == ("Direct", "Growth")
    assert classify_plan_option("Axis Children's Fund", "Regular Plan", "IDCW Option") == ("Regular", "IDCW")
    assert classify_plan_option("HDFC Flexi Cap Fund - Direct Plan - Growth") == ("Direct", "Growth")
    assert classify_plan_option("Unknown Scheme") == (None, None)


def test_amfi_historical_header_and_invalid_rows():
    provider = AmfiProvider()
    content = """Scheme Code;Scheme Name;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date
119551;Fund Alpha;INF123;;100.50;;;09-Oct-2026
119552;Fund Beta with NA NAV;INF124;;N.A.;;;09-Oct-2026
119553;Fund Gamma Negative;INF125;;-15.0;;;09-Oct-2026
"""
    res = provider.parse_content(content)
    assert res.success is True
    assert len(res.observations) == 1  # Only Fund Alpha has valid positive NAV
    assert res.observations[0].value_numeric == 100.50


def test_ecb_all_four_cross_rates():
    # Tested reference rates where:
    # 1 EUR = 1.0925 USD
    # 1 EUR = 91.85 INR
    # 1 EUR = 0.8350 GBP
    # 1 EUR = 163.20 JPY
    raw_rates = {
        "USD": 1.0925,
        "INR": 91.85,
        "GBP": 0.8350,
        "JPY": 163.20,
    }
    cross = compute_cross_rates(raw_rates)

    # 1. EUR/USD = USD per EUR
    assert cross["FX:EURUSD"] == 1.0925

    # 2. USD/INR = INR_per_EUR / USD_per_EUR
    expected_usdinr = 91.85 / 1.0925
    assert abs(cross["FX:USDINR"] - expected_usdinr) < 1e-6

    # 3. GBP/USD = USD_per_EUR / GBP_per_EUR
    expected_gbpusd = 1.0925 / 0.8350
    assert abs(cross["FX:GBPUSD"] - expected_gbpusd) < 1e-6

    # 4. USD/JPY = JPY_per_EUR / USD_per_EUR
    expected_usdjpy = 163.20 / 1.0925
    assert abs(cross["FX:USDJPY"] - expected_usdjpy) < 1e-6


def test_ecb_xml_parsing():
    provider = EcbProvider()
    xml_data = """<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-05-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
    <Cube>
        <Cube time="2026-10-09">
            <Cube currency="USD" rate="1.0925"/>
            <Cube currency="JPY" rate="163.20"/>
            <Cube currency="GBP" rate="0.8350"/>
            <Cube currency="INR" rate="91.85"/>
        </Cube>
    </Cube>
</gesmes:Envelope>
"""
    res = provider.parse_xml(xml_data)
    assert res.success is True
    assert res.status == "ready"
    assert len(res.observations) == 4
    inst_ids = {o.instrument_id for o in res.observations}
    assert inst_ids == {"FX:EURUSD", "FX:USDINR", "FX:GBPUSD", "FX:USDJPY"}


def test_cboe_vix_csv_parsing():
    provider = CboeProvider()
    csv_data = """DATE,OPEN,HIGH,LOW,CLOSE
10/09/2026,18.50,19.20,18.10,18.75
10/08/2026,17.90,18.60,17.50,18.10
"""
    res = provider.parse_csv(csv_data)
    assert res.success is True
    assert res.status == "ready"
    assert len(res.observations) == 2
    assert res.observations[0].observed_at == "2026-10-09"
    assert res.observations[0].value_numeric == 18.75
    assert res.observations[0].instrument_id == "VOL:US:VIX"


def test_fred_needs_key_state_when_unconfigured():
    provider = FredProvider(api_key="")
    res = provider.fetch("DGS10")
    assert res.success is False
    assert res.status == "needs_key"
    assert "FRED_API_KEY" in res.error_message


def test_mfapi_divergence_check():
    # Matching dates, within tolerance
    res_ok = MfapiProvider.check_divergence(
        amfi_nav=428.12, amfi_date="2026-10-09",
        mfapi_nav=428.15, mfapi_date="2026-10-09",
        tolerance_pct=0.05,
    )
    assert res_ok["divergent"] is False

    # Outlier (> 0.05% diff)
    res_div = MfapiProvider.check_divergence(
        amfi_nav=428.12, amfi_date="2026-10-09",
        mfapi_nav=432.50, mfapi_date="2026-10-09",
        tolerance_pct=0.05,
    )
    assert res_div["divergent"] is True
    assert res_div["flag"] == "outlier"


def test_manual_import_template_and_preview():
    csv_str = get_template_csv("pms_strategies")
    assert "Provider,Strategy Name" in csv_str

    # Valid preview
    preview = ManualImportValidator.preview("pms_strategies", csv_str)
    assert preview["valid"] is True
    assert preview["valid_count"] >= 1
    assert preview["error_count"] == 0

    # Formula injection defense test
    injection_csv = """Provider,Strategy Name,Approach,Category,Report Month,AUM (Cr),Return 1M (%),Return 3M (%),Return 6M (%),Return 1Y (%),CAGR 3Y (%),CAGR 5Y (%),Benchmark Name,Benchmark 1Y (%)
=cmd|' /C calc'!A0,Dangerous Fund,Equity,Multi,2026-09,100,1,2,3,4,5,6,Nifty,10
"""
    inj_preview = ManualImportValidator.preview("pms_strategies", injection_csv)
    assert inj_preview["valid"] is True
    sanitized_provider = inj_preview["preview_rows"][0]["Provider"]
    assert sanitized_provider.startswith("'=")  # Prepend single quote neutralizing formula execution
