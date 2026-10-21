from concurrent.futures import ThreadPoolExecutor

from tests.test_backoffice_api import _create_staff, _login_staff
from tests.test_pdf_fill import _pdf

H = {"sec-fetch-site": "same-origin"}


def _fill(client, title="CAMS Nomination Form", **extra):
    return client.post(
        "/api/backoffice/operations/pdf-fill",
        files={"file": ("f.pdf", _pdf(), "application/pdf")},
        data={"edits": "[]", "filename": "x", "log_filing": "true", "form_title": title, "client_name": "Sharma", "folio": "1/2", **extra},
        headers=H,
    )


def test_register_roundtrip_status_and_redownload(client):
    _login_staff(client, _create_staff("operations"))
    r = _fill(client)
    assert r.status_code == 200
    fid = r.headers["x-filing-id"]
    rows = client.get("/api/backoffice/operations/filings").json()["data"]
    row = next(x for x in rows if x["id"] == fid)
    assert row["form_title"] == "CAMS Nomination Form" and row["status"] == 0 and row["client_name"] == "Sharma"
    assert "pdf" not in row
    assert client.get(f"/api/backoffice/operations/filings/{fid}/pdf").content == r.content  # re-download is the same PDF
    assert client.patch(f"/api/backoffice/operations/filings/{fid}", json={"status": 1}, headers=H).json()["data"]["status"] == 1
    assert client.patch(f"/api/backoffice/operations/filings/{fid}", json={"status": 0}, headers=H).status_code == 409
    assert client.patch(f"/api/backoffice/operations/filings/{fid}", json={"status": 5}, headers=H).status_code == 422
    assert client.patch("/api/backoffice/operations/filings/nope", json={"status": 1}, headers=H).status_code == 404


def test_fill_without_register_stores_nothing(client):
    _login_staff(client, _create_staff("operations"))
    before = len(client.get("/api/backoffice/operations/filings").json()["data"])
    r = client.post("/api/backoffice/operations/pdf-fill", files={"file": ("f.pdf", _pdf(), "application/pdf")}, data={"edits": "[]"}, headers=H)
    assert r.status_code == 200 and "x-filing-id" not in r.headers
    assert len(client.get("/api/backoffice/operations/filings").json()["data"]) == before


def test_stress_many_filings_and_concurrent_writes(client):
    from app.api.backoffice import _REPO

    _login_staff(client, _create_staff("operations"))
    for i in range(25):
        assert _fill(client, title=f"Form {i}").status_code == 200
    pdf = _pdf()

    def work(i):
        f = _REPO.add_filing(form_title=f"Concurrent {i}", form_url=None, household_id=None, client_name="C", folio=None, staff_id=None, staff_name=None, pdf=pdf)
        _REPO.set_filing_status(f["id"], 1)
        return f["id"]

    with ThreadPoolExecutor(16) as ex:
        ids = list(ex.map(work, range(120)))
    assert len(set(ids)) == 120
    rows = client.get("/api/backoffice/operations/filings").json()["data"]
    assert len(rows) >= 120 and all(r["status"] in (0, 1) for r in rows)
    assert sum(1 for r in rows if r["form_title"].startswith("Concurrent") and r["status"] == 1) == 120
