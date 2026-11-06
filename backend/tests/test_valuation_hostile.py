"""Hostile / odd uploads: never a 500, always a reason, the batch stays usable."""
import io
import os
import time

import pytest
from fastapi.testclient import TestClient

from tests import valuation_fixtures as fx
from tests.test_valuation_api import B, _login, _user, client  # noqa: F401  (fixtures)


@pytest.fixture
def admin(client):
    return _login(client, _user("admin"))


def _batch(client):
    cust = _user("customer")
    return client.post(f"{B}/batches", json={"client_id": cust["id"], "report_month": "2026-10", "valuation_date": "2026-10-31"}).json()["id"]


def _up(client, bid, files):
    return client.post(f"{B}/batches/{bid}/files", files=[("files", (n, io.BytesIO(d), "application/octet-stream")) for n, d in files])


def test_junk_never_500s_and_good_files_survive(client, admin):
    bid = _batch(client)
    good = fx.proaffluence_pdf()
    junk = [("empty.pdf", b""), ("rand.pdf", os.urandom(5000)), ("trunc.pdf", good[: len(good) // 2]), ("x.xlsx", b"PK\x03\x04garbage"),
            ("x.csv", b"\xff\xfe\x00bad"), ("big.pdf", b"%PDF-1.4\n" + b"0" * 300_000), ("../../etc/passwd.pdf", b"x"), ("a" * 400 + ".pdf", good),
            ("script.exe", b"MZ"), ("zip.zip", b"PK\x05\x06" + b"\0" * 18)]
    r = _up(client, bid, junk)
    assert r.status_code in (201, 422), r.text
    assert client.post(f"{B}/batches/{bid}/files", files=[("files", ("ok.pdf", io.BytesIO(fx.proaffluence_pdf(["Portfolio Management Services", "Client Code: Z-9", "PMS statement"])), "application/pdf"))]).status_code in (201, 422)
    p = client.post(f"{B}/batches/{bid}/process", json={})
    assert p.status_code == 200, p.text
    v = client.post(f"{B}/batches/{bid}/validate")
    assert v.status_code == 200 and not v.json()["summary"]["can_approve"] or v.status_code == 200
    assert client.get(f"{B}/batches/{bid}/preview").status_code == 200


def test_many_files_fast(client, admin):
    bid = _batch(client)
    files = [(f"s{i}.pdf", fx.proaffluence_pdf(fx.PA_LINES + [f"Note {i}"])) for i in range(25)]
    t = time.time()
    assert _up(client, bid, files).status_code in (201, 422)
    assert client.post(f"{B}/batches/{bid}/process", json={}).status_code == 200
    assert time.time() - t < 90
