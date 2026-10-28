"""Regression tests for backoffice contract and import bugs."""
from __future__ import annotations

import pytest

from app.backoffice.providers.manual import ManualImportValidator, sanitize_cell
from tests.test_backoffice_api import _create_staff, _login_staff


@pytest.fixture()
def admin_client(client):
    _login_staff(client, _create_staff("admin"))
    return client


def test_sanitize_keeps_signed_numbers_but_neutralizes_formulas():
    assert sanitize_cell("-1500") == "-1500"
    assert sanitize_cell("+12.5") == "+12.5"
    assert sanitize_cell("-1,500.25") == "-1,500.25"
    assert sanitize_cell("=SUM(A1)").startswith("'=")
    assert sanitize_cell("-cmd|calc").startswith("'-")


def test_flows_import_accepts_negative_net_outflow():
    csv_text = (
        "Report Date,Category,Segment,Gross Buy,Gross Sell,Net,Unit,Status\n"
        "2026-10-12,FII,equity_cash,12000,13500,-1500,inr_crore,final\n"
    )
    assert ManualImportValidator.preview("fii_dii_flows", csv_text)["valid"] is True


def test_data_health_returns_summary(admin_client):
    r = admin_client.get("/api/backoffice/data-health")
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["total"] == len(body["sources"])


def test_commit_invalid_rows_returns_422_not_500(admin_client):
    bad = (
        "Report Date,Category,Segment,Gross Buy,Gross Sell,Net,Unit,Status\n"
        "2026-10-12,XXX,equity_cash,1,2,3,inr_crore,final\n"
    )
    r = admin_client.post(
        "/api/backoffice/imports/commit",
        json={"import_type": "fii_dii_flows", "filename": "bad.csv", "csv_content": bad},
    )
    assert r.status_code == 422


def test_staff_list_and_provision_without_password(admin_client):
    r = admin_client.post(
        "/api/backoffice/staff/provision",
        json={"name": "New Analyst", "email": "new.analyst@fundhorizon.internal", "mobile": "9000000011", "role": "analyst", "pages": ["/backoffice/mutual-funds"]},
    )
    assert r.status_code == 201
    assert r.json()["temporary_password"]
    listed = admin_client.get("/api/backoffice/staff")
    assert listed.status_code == 200
    assert any(s["email"] == "new.analyst@fundhorizon.internal" for s in listed.json()["data"])
