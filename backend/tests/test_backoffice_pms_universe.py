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
