"""Parser and service tests for live feeds (no network: HTTP payloads are stubbed)."""
from __future__ import annotations

import pytest

from app.backoffice.providers.ecb import EcbProvider
from app.backoffice.providers.nse import NseClient, NseError, parse_nse_date
from app.backoffice.providers.treasury import TreasuryProvider

TREASURY_CSV = (
    'Date,"1 Mo","2 Yr","10 Yr","30 Yr"\n'
    "10/09/2026,4.13,4.80,5.24,5.60\n"
    "10/08/2026,4.14,4.75,5.22,\n"
)


def test_treasury_csv_parses_every_tenor_and_skips_blanks():
    res = TreasuryProvider().parse_csv(TREASURY_CSV)
    assert res.success and res.source_timestamp == "2026-10-09"
    by_key = {(o.instrument_id, o.observed_at): o.value_numeric for o in res.observations}
    assert by_key[("YIELD:US:10Y", "2026-10-09")] == 5.24
    assert ("YIELD:US:30Y", "2026-10-08") not in by_key


def test_treasury_rejects_unexpected_schema():
    assert TreasuryProvider().parse_csv("foo,bar\n1,2\n").status == "schema_error"


def test_ecb_history_keeps_each_day_separate():
    xml = (
        '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" '
        'xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube>'
        '<Cube time="2026-10-12"><Cube currency="USD" rate="1.1"/><Cube currency="INR" rate="110"/></Cube>'
        '<Cube time="2026-10-09"><Cube currency="USD" rate="1.2"/><Cube currency="INR" rate="108"/></Cube>'
        "</Cube></gesmes:Envelope>"
    )
    res = EcbProvider().parse_history_xml(xml)
    usdinr = {o.observed_at: o.value_numeric for o in res.observations if o.instrument_id == "FX:USDINR"}
    assert usdinr == {"2026-10-12": pytest.approx(100.0), "2026-10-09": pytest.approx(90.0)}


class _StubNse(NseClient):
    def __init__(self, payloads):
        super().__init__()
        self.payloads = payloads

    def get_json(self, path, params=None, referer=""):
        keyed = f"{path}?{params['expiry']}" if params and "expiry" in params else path
        if keyed not in self.payloads:
            raise NseError("not stubbed")
        return self.payloads[keyed]


def test_nse_date_parsing():
    assert parse_nse_date("12-Oct-2026") == "2026-10-12"
    assert parse_nse_date("13-Oct-2026 13:42") == "2026-10-13"


def test_fii_dii_maps_categories_and_negative_net():
    client = _StubNse({
        "/api/fiidiiTradeReact": [
            {"category": "DII", "date": "12-Oct-2026", "buyValue": "15506.73", "sellValue": "12461.71", "netValue": "3045.02"},
            {"category": "FII/FPI", "date": "12-Oct-2026", "buyValue": "12583.21", "sellValue": "14291.69", "netValue": "-1708.48"},
        ]
    })
    rows = {r["category"]: r for r in client.fetch_fii_dii()}
    assert rows["FII"]["net"] == -1708.48 and rows["DII"]["net"] == 3045.02
    assert rows["FII"]["report_date"] == "2026-10-12"


def test_option_chain_skips_empty_expiry_and_parses_legs():
    from datetime import datetime, timedelta

    from app.backoffice.providers.nse import IST

    # Expiries are relative to today: NSE code drops series that already expired.
    d1, d2 = (datetime.now(IST) + timedelta(days=n) for n in (7, 14))
    e1, e2 = d1.strftime("%d-%b-%Y"), d2.strftime("%d-%b-%Y")
    leg = lambda t, strike, oi: {  # noqa: E731
        "strikePrice": strike, "expiryDate": e2, "openInterest": oi, "changeinOpenInterest": 5,
        "totalTradedVolume": 100, "impliedVolatility": 12.5, "lastPrice": 10.0, "identifier": f"X{t}{strike}",
    }
    client = _StubNse({
        "/api/option-chain-contract-info": {"expiryDates": [e1, e2]},
        f"/api/option-chain-v3?{e1}": {"records": {"data": [], "expiryDates": []}},
        f"/api/option-chain-v3?{e2}": {
            "records": {
                "timestamp": "13-Oct-2026 13:46:15",
                "underlyingValue": 55114.5,
                "data": [{"strikePrice": 55000, "CE": leg("CE", 55000, 300), "PE": leg("PE", 55000, 200)}],
            }
        },
    })
    chain = client.fetch_option_chain("BANKNIFTY")
    assert chain["expiry"] == d2.strftime("%Y-%m-%d") and chain["underlying_price"] == 55114.5
    assert {c["option_type"] for c in chain["contracts"]} == {"CE", "PE"}
    assert chain["contracts"][0]["implied_vol"] == 12.5


def test_option_chain_never_serves_expired_series():
    client = _StubNse({"/api/option-chain-contract-info": {"expiryDates": ["13-Oct-2020", "14-Oct-2020"]}})
    with pytest.raises(NseError, match="unexpired"):
        client.fetch_option_chain("NIFTY")


def test_option_chain_rejects_non_nse_underlying():
    with pytest.raises(NseError):
        _StubNse({}).fetch_option_chain("SENSEX")


def test_quarterly_results_convert_lakh_to_crore_and_derive_ebitda():
    client = _StubNse({
        "/api/results-comparision": {
            "resCmpData": [
                {"re_to_dt": "31-DEC-2024", "re_net_sale": "3491500", "re_net_profit": "635800",
                 "re_pro_loss_bef_tax": "884400", "re_int_new": "5000", "re_depr_und_exp": "66100",
                 "re_oth_inc_new": "100100", "re_seq_num": "1"},
            ]
        }
    })
    q = client.fetch_quarterly_results("INFY")[0]
    assert q["period_end"] == "2024-12-31"
    assert q["revenue_crore"] == 34915.0 and q["ebitda_crore"] == 8554.0 and q["pat_crore"] == 6358.0
    assert q["ebitda_margin_pct"] == pytest.approx(24.5, abs=0.01)


def test_yields_board_has_no_invented_india_curve(client):
    from tests.test_backoffice_api import _create_staff, _login_staff

    _login_staff(client, _create_staff("analyst"))
    body = client.get("/api/backoffice/yields").json()
    assert body["data"]["india_curve"] == []
    assert body["data"]["india_status"] == "unavailable"
