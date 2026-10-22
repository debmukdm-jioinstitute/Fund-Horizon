"""Download proxy: staff only, and the tunnel link keeps nothing but cobalt's own parameters."""
from __future__ import annotations

import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.auth import _hash_password
from app.db import get_repository
from app.main import create_app


class _Resp:
    def __init__(self, payload): self._p = json.dumps(payload).encode()
    def read(self): return self._p
    def __enter__(self): return self
    def __exit__(self, *a): return False


def test_download_is_staff_only_and_sanitises(client, monkeypatch):
    monkeypatch.setenv("FH_COBALT_URL", "http://cobalt:9000")
    body = {"url": "https://example.com/v"}
    assert client.post("/api/staff/download", json=body).status_code == 401
    client.post("/api/auth/signup", json={"name": "Cust", "email": "c@example.com", "mobile": "9876543210",
                                          "password": "password123", "consent": True})
    assert client.post("/api/staff/download", json=body).status_code == 403  # customers cannot use it

    repo = get_repository()
    s = repo.create_customer(name="Staff", email="s@example.com", mobile="9000000002",
                             password_hash=_hash_password("password123"), role="admin")
    repo.update_customer(s["id"], {"is_staff": 1})
    with TestClient(create_app()) as sc:
        sc.post("/api/auth/login", json={"email": "s@example.com", "password": "password123"})
        assert sc.post("/api/staff/download", json={"url": "ftp://x"}).status_code == 422
        fake = _Resp({"status": "tunnel", "filename": "a.mp4",
                      "url": "http://cobalt:9000/tunnel?id=1&exp=2&sig=3&sec=4&iv=5&evil=6"})
        with patch("urllib.request.urlopen", return_value=fake):
            r = sc.post("/api/staff/download", json=body).json()
        assert r["file"] == "/api/staff/download/file?id=1&exp=2&sig=3&sec=4&iv=5"
