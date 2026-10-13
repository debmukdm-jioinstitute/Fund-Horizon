"""Factsheet discovery (no network) and the factsheets API."""
from __future__ import annotations

import httpx

from app.backoffice.fh_recommended import (
    FH_RECOMMENDED_MF_CODES,
    MF_FACTSHEET_SOURCE,
    PMS_FACTSHEET_SOURCE,
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


def test_factsheets_api_lists_newest_first_and_flags_unmapped_picks(client):
    from app.backoffice.repository import BackofficeRepository

    repo = BackofficeRepository()
    for period in ("2026-06", "2026-08", "2026-07"):
        repo.upsert_factsheet("dsp", fs.Found(period, f"DSP {period}", f"https://example.test/{period}.pdf"))
    _login_staff(client, _create_staff("analyst"))

    body = client.get("/api/backoffice/factsheets?kind=mf&id=101635").json()
    assert [i["period"] for i in body["data"]["items"]] == ["2026-08", "2026-07", "2026-06"]
    assert body["data"]["items"][0]["url"] == "https://example.test/2026-08.pdf"
    assert body["data"]["source"] == "DSP Mutual Fund"

    unmapped = client.get("/api/backoffice/factsheets?kind=mf&id=150799").json()  # WhiteOak: no source yet
    assert unmapped["availability"] == "unavailable" and unmapped["data"]["items"] == []
    assert client.get("/api/backoffice/factsheets?kind=mf&id=abc").status_code == 422
    assert client.get("/api/backoffice/factsheets/999999/file").status_code == 404
