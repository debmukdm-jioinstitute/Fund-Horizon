"""Factsheet discovery (no network) and the factsheets API."""
from __future__ import annotations

import httpx

from app.backoffice.fh_recommended import (
    FH_RECOMMENDED_MF_CODES,
    MF_FACTSHEET_SOURCE,
    PMS_FACTSHEET_SOURCE,
    PMS_NO_PUBLIC_FACTSHEET,
)
from app.backoffice.providers import factsheets as fs
from tests.test_backoffice_api import _create_staff, _login_staff


def test_period_from_name_handles_publisher_filename_styles():
    assert fs.period_from_name("Nippon-FS-Aug-2025.pdf") == "2025-08"
    assert fs.period_from_name("Factsheet-February-2020.pdf") == "2020-02"
    assert fs.period_from_name("Edelweiss_Factsheet_July2026_20072026185303.pdf") == "2026-07"
    assert fs.period_from_name("Edelweiss_Factsheet_September_2026_15092026193426.pdf") == "2026-09"
    assert fs.period_from_name("no-date-here.pdf") is None


def test_template_urls_format_every_placeholder():
    for src in fs.SOURCES.values():
        for tpl in src.templates:
            url = fs._fmt(tpl, 2026, 12)
            assert "{" not in url, (src.key, url)
    assert "2027-01" in fs._fmt("{ny}-{nm}", 2026, 12)  # HDFC files are filed under the following month


def test_template_discovery_only_records_verified_pdfs():
    def handler(request: httpx.Request) -> httpx.Response:
        ok = "september-2026" in str(request.url)
        return httpx.Response(200 if ok else 404, headers={"content-type": "application/pdf" if ok else "text/html"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        found = fs.discover_templates(client, fs.SOURCES["dsp"], [(2026, 9), (2026, 8)])
    assert [f.period for f in found] == ["2026-09"]


def test_soft_404_html_is_not_a_factsheet():
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, headers={"content-type": "text/html"}))) as client:
        assert fs.discover_templates(client, fs.SOURCES["dsp"], [(2026, 9)]) == []


def test_every_mapped_pick_points_at_a_known_source():
    assert set(MF_FACTSHEET_SOURCE) <= set(FH_RECOMMENDED_MF_CODES)
    assert set(MF_FACTSHEET_SOURCE.values()) <= set(fs.SOURCES)
    assert set(PMS_FACTSHEET_SOURCE.values()) <= set(fs.SOURCES)
    assert all(fs.SOURCES[k].kind == "mf" for k in MF_FACTSHEET_SOURCE.values())
    assert all(fs.SOURCES[k].kind == "pms" for k in PMS_FACTSHEET_SOURCE.values())


def test_factsheets_api_lists_newest_first_and_reports_empty_sources(client):
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    for period in ("2026-06", "2026-08", "2026-07"):
        repo.upsert_factsheet("dsp", fs.Found(period, f"DSP {period}", f"https://example.test/{period}.pdf"))
    _login_staff(client, _create_staff("analyst"))

    body = client.get("/api/backoffice/factsheets?kind=mf&id=101635").json()
    assert [i["period"] for i in body["data"]["items"]] == ["2026-08", "2026-07", "2026-06"]
    assert body["data"]["items"][0]["url"] == "https://example.test/2026-08.pdf"
    assert body["data"]["source"] == "DSP Mutual Fund"

    nothing_yet = client.get("/api/backoffice/factsheets?kind=mf&id=108466").json()  # ICICI: connected, nothing recorded
    assert nothing_yet["availability"] == "unavailable" and nothing_yet["data"]["items"] == []
    assert client.get("/api/backoffice/factsheets?kind=mf&id=abc").status_code == 422
    assert client.get("/api/backoffice/factsheets/999999/file").status_code == 404


def test_numeric_period_names_and_links_file_ingest():
    assert fs.period_from_name("Buoyant-Factsheet-2022-09.pdf") == "2022-09"
    assert fs.period_from_name("Quick-Insights-September-2025.pdf") == "2025-09"
    data = {"whiteoak": [
        {"period": "2026-09", "title": "WhiteOak factsheet 2026-09", "url": "https://content.whiteoakamc.com/x.pdf"},
        {"period": "bad", "url": "https://content.whiteoakamc.com/y.pdf"},  # malformed period is dropped
        {"period": "2026-08", "url": "http://insecure.example/z.pdf"},  # non-https is dropped
    ]}
    found = fs.discover_links_file(fs.SOURCES["whiteoak"], data)
    assert [f.period for f in found] == ["2026-09"]
    assert fs.discover_links_file(fs.SOURCES["helios"], data) == []


def test_pms_without_public_factsheet_is_flagged_not_blank(client):
    _login_staff(client, _create_staff("analyst"))
    body = client.get("/api/backoffice/factsheets?kind=pms&id=731").json()  # 360 ONE Multicap
    assert body["data"]["no_public"] is True and body["data"]["items"] == []
    assert not set(PMS_FACTSHEET_SOURCE) & PMS_NO_PUBLIC_FACTSHEET
    assert client.get("/api/backoffice/factsheets?kind=mf&id=150799").json()["data"]["source"] == "WhiteOak Capital Mutual Fund"


def test_period_from_text_two_digit_years_and_dates():
    assert fs.period_from_text("Sept26.pdf") == "2026-09"
    assert fs.period_from_text("Factsheet-as-on-February-26-2021.pdf") == "2021-02"  # 26 is a day, not a year
    assert fs.period_from_text("NIMF-30-Mar-31.pdf") is None  # would be a future month
    assert fs.period_from_text("no-date.pdf") is None


def test_every_amc_in_the_scheme_list_has_a_factsheet_source():
    from app.data.loader import load_metrics

    assert set(load_metrics()["amc"].unique()) <= set(fs.AMC_SOURCES)
    assert {k for k, _ in fs.AMC_SOURCES.values()} <= set(fs.SOURCES)
    assert set(fs.BROWSER_PAGES) <= set(fs.SOURCES)


def test_factsheets_api_covers_any_scheme_through_its_amc(client):
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    conn = repo._conn()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO mf_schemes (scheme_code, scheme_name, amc, updated_at) VALUES ('999001', 'Union Test Fund - Regular Plan - Growth', 'Union Mutual Fund', '2026-10-14')"
        )
    repo.upsert_factsheet("union", fs.Found("2026-09", "Union factsheet 2026-09", "https://example.test/union-2026-09.pdf"))
    _login_staff(client, _create_staff("analyst"))
    body = client.get("/api/backoffice/factsheets?kind=mf&id=999001").json()
    assert body["data"]["source"] == "Union Mutual Fund"
    assert [i["period"] for i in body["data"]["items"]] == ["2026-09"]
    assert client.get("/api/backoffice/factsheets?kind=mf&id=888888").json()["data"]["source"] is None  # unknown scheme
