"""Customer self-service: own CRM view and staff chat. A customer only sees their own thread."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.auth import _hash_password
from app.db import get_repository
from app.main import create_app


def _signup(client, n):
    r = client.post("/api/auth/signup", json={"name": f"Cust {n}", "email": f"c{n}@example.com",
                                              "mobile": f"98765432{n:02d}", "password": "password123", "consent": True})
    assert r.status_code == 201, r.text
    return r.json()["customer"]["id"]


def test_chat_and_crm_scoping(client):
    a = _signup(client, 1)
    assert client.get("/api/me/crm").json() == {"households": [], "holdings": [], "sips": [], "cases": []}
    assert client.post("/api/me/messages", json={"body": "Hello team"}).status_code == 201
    assert client.post("/api/me/messages", json={"body": "  "}).status_code == 422
    assert [m["body"] for m in client.get("/api/me/messages").json()["messages"]] == ["Hello team"]
    assert client.get("/api/staff/chats").status_code == 403  # customers cannot read staff inbox

    repo = get_repository()
    staff = repo.create_customer(name="Staff", email="staff@example.com", mobile="9000000001",
                                 password_hash=_hash_password("password123"), role="admin")
    repo.update_customer(staff["id"], {"is_staff": 1})
    with TestClient(create_app()) as sc:
        assert sc.post("/api/auth/login", json={"email": "staff@example.com", "password": "password123"}).status_code == 200
        threads = sc.get("/api/staff/chats").json()["threads"]
        assert threads[0]["customer_id"] == a and threads[0]["unread"] == 1
        assert sc.post(f"/api/staff/chats/{a}", json={"body": "Hi, how can we help?"}).status_code == 201
    msgs = client.get("/api/me/messages").json()["messages"]
    assert [m["from_staff"] for m in msgs] == [0, 1]
