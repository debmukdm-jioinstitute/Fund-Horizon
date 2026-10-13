"""APMI PMS universe: parser and storage round-trip (no network)."""
from __future__ import annotations

from datetime import UTC, datetime

from app.backoffice.providers import apmi

PAGE = """
<select class="form-control" id="pmsProvideName" multiple="multiple">
<option value="395" title="x">1729 ADVISORS LLP</option>
<option value="90">360 ONE Asset Management Limited</option>
<option value="7">Silent Provider Pvt Ltd</option>
</select>
"""


def _row(provider: str, strategy: str, ia: str, aum: str, vals: list[str]) -> str:
    tds = "".join(f'<td class="x">{v}</td>' for v in vals)
    return (
        f"<tr><td>{provider}</td><td><!-- c --><a href=\"IaInsight.htm?IAID={ia}\">{strategy}</a></td>"
        f"<td>&#8377;{aum}</td>{tds}</tr>"
    )


REPORT = (
    "<table><tr><th>PMS Provider Name</th></tr>"
    + _row("360 ONE Asset Management Limited", "360 ONE Multicap PMS", "1", "2,841.06",
           ["-4.69", "-0.58", "15.82", "1.31", "-4.12", "8.13", "10.46", "7.73", "18.99"])
    + _row("1729 ADVISORS LLP", "1729 Fundamental value Investing", "1975", "NA",
           ["1.0", "2.0", "3.0", "4.0", "NA", "NA", "NA", "NA", "5.0", "6.0"])
    + "</table>"
)


def test_providers_include_those_without_strategies():
    names = [p["name"] for p in apmi.parse_providers(PAGE)]
    assert names == ["1729 ADVISORS LLP", "360 ONE Asset Management Limited", "Silent Provider Pvt Ltd"]


def test_report_rows_handle_missing_9m_column_and_na():
    rows = apmi.parse_report(REPORT, "Equity", "D")
    assert len(rows) == 2
    a = rows[0]
    assert a["aum_crore"] == 2841.06 and a["ia_id"] == "1"
    assert (a["return_1m"], a["return_6m"], a["return_9m"], a["return_1y"], a["return_since_inception"]) == (-4.69, 15.82, None, 1.31, 18.99)
    b = rows[1]  # 10 return cells: the 9-month column is present
    assert b["aum_crore"] is None and b["return_9m"] == 4.0 and b["return_1y"] is None and b["return_since_inception"] == 6.0
    assert a["service_type"] == "Discretionary"


def test_candidate_months_are_latest_completed_first():
    assert apmi.candidate_months(datetime(2026, 1, 15, tzinfo=UTC), 3) == ["2025-12-31", "2025-11-30", "2025-10-31"]
    assert apmi.candidate_months(datetime(2026, 3, 1, tzinfo=UTC), 1) == ["2026-02-28"]


def test_universe_roundtrip_and_api(client):
    from app.backoffice.repository import BackofficeRepository
    from tests.test_backoffice_api import _create_staff, _login_staff

    repo = BackofficeRepository()
    providers = apmi.parse_providers(PAGE)
    strategies = apmi.parse_report(REPORT, "Equity", "D")
    assert repo.replace_pms_universe("2026-09-30", providers, strategies) == 2
    assert repo.replace_pms_universe("2026-09-30", providers, strategies) == 2  # idempotent

    _login_staff(client, _create_staff("analyst"))
    body = client.get("/api/backoffice/pms/providers").json()
    by_name = {p["name"]: p for p in body["data"]}
    assert by_name["Silent Provider Pvt Ltd"]["strategy_count"] == 0
    assert by_name["360 ONE Asset Management Limited"]["total_aum_crore"] == 2841.06
    assert body["count"] == 3 and body["reporting_count"] == 2
    strat = client.get("/api/backoffice/pms/strategies").json()
    assert strat["as_on"] == "2026-09-30" and any(s["strategy_name"] == "360 ONE Multicap PMS" for s in strat["data"])


DETAIL_HTML = """
<div>KRIIS MULTICAP FUND STRATEGY</div><a>Export To PDF</a>
<h4>Investment Approach Details</h4><div>&#8377;477.75</div><div>(AUM CR)</div>
<td>PMS Provider Name</td><td>&nbsp; KRIIS PORTFOLIO PRIVATE LIMITED</td>
<td>Benchmark</td><td>BSE 500 TRI</td><td>Strategy Name</td><td>Equity</td><td>Product Name</td><td>Equity</td>
<td>Date Of Inception</td><td>09/05/2019</td><td>Age</td><td>7.5 Years</td><td>Min. Inv. Amount</td><td>5000000</td>
<td>Fixed Fees Structure</td><td>NA</td><td>Variable Fees Structure</td><td>20% over 10% hurdle</td><td>Exit Load</td><td>NA</td>
<td>Purpose</td><td>The Portfolio Manager&Atilde;?&Acirc;&cent;??s philosophy uses fundamental analysis.</td>
<h4>Fund Manager Details</h4><b>RAKESH DOSHI</b><td>Work Exp.</td><td>12 years</td><td>Email ID</td><td>x@y.in</td>
<h4>Turnover Details As On 30/09/2026</h4><td>1 Month Turnover</td><td>0.09</td><td>1 Year Turnover</td><td>1.22</td>
"""


def test_strategy_detail_parser_extracts_profile_and_drops_contact_details():
    d = apmi.parse_strategy_detail(DETAIL_HTML)
    assert d["strategy_name"] == "KRIIS MULTICAP FUND STRATEGY" and d["aum_crore"] == 477.75
    assert d["provider"] == "KRIIS PORTFOLIO PRIVATE LIMITED" and d["benchmark"] == "BSE 500 TRI"
    assert d["inception_date"] == "2019-05-09" and d["min_investment_inr"] == 5000000.0
    assert d["fixed_fees"] is None and d["variable_fees"] == "20% over 10% hurdle"
    assert d["fund_manager"] == "RAKESH DOSHI" and d["fund_manager_experience"] == "12 years"
    assert d["turnover_as_on"] == "2026-09-30" and d["turnover_1m"] == 0.09 and d["turnover_1y"] == 1.22
    assert "Ã" not in d["purpose"] and "x@y.in" not in str(d)
    assert apmi.parse_strategy_detail("<html>blocked</html>") is None


def test_strategy_detail_endpoint_merges_history_and_handles_apmi_failure(client, monkeypatch):
    from app.backoffice.repository import BackofficeRepository
    from tests.test_backoffice_api import _create_staff, _login_staff

    repo = BackofficeRepository()
    rows = apmi.parse_report(REPORT, "Equity", "D")
    repo.replace_pms_universe("2026-08-31", apmi.parse_providers(PAGE), rows)
    repo.replace_pms_universe("2026-09-30", apmi.parse_providers(PAGE), rows)
    _login_staff(client, _create_staff("analyst"))

    def boom(_ia):
        raise OSError("apmi down")

    monkeypatch.setattr(apmi, "fetch_strategy_detail", boom)
    r = client.get("/api/backoffice/pms/strategies/1")
    assert r.status_code == 200
    data = r.json()["data"]
    assert [h["as_on"] for h in data["history"]] == ["2026-09-30", "2026-08-31"]
    assert data["detail"] is None and "unavailable" in data["detail_error"]
    assert data["latest"]["strategy_name"] == "360 ONE Multicap PMS"

    assert client.get("/api/backoffice/pms/strategies/99999").status_code == 404
    assert client.get("/api/backoffice/pms/strategies/abc").status_code == 404


def test_failed_refresh_retries_soon_not_after_a_full_interval(monkeypatch):
    import asyncio
    import time

    from app.backoffice import collectors

    async def fail(_source_id):
        return {"status": "unavailable", "source_id": "SRC_APMI", "error": "dns"}

    monkeypatch.setattr(collectors, "_refresh_source", fail)
    collectors._LAST_RUN.pop("SRC_APMI", None)
    asyncio.run(collectors.refresh_source("SRC_APMI"))
    due_in = collectors.REFRESH_INTERVALS["SRC_APMI"] - (time.monotonic() - collectors._LAST_RUN["SRC_APMI"])
    assert due_in <= collectors.RETRY_AFTER_FAILURE_SECONDS + 1
