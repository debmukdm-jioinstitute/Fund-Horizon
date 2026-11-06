"""In-house personal finance: arithmetic, scoping, and AI answer guardrails."""
from __future__ import annotations

from app.api import finance
from tests.test_customer_portal import _signup

E = lambda **k: {"category": "", "monthly_payment": 0, "apr": 0, "due_day": None, "liquid": 0, **k}  # noqa: E731


def test_summarize_and_missing():
    assert finance.summarize([])["missing"][0].startswith("What is your monthly take-home")
    rows = [E(kind="income", label="Salary", amount=100000), E(kind="expense", label="Rent", amount=30000, category="Home", due_day=5),
            E(kind="debt", label="Card", amount=50000, monthly_payment=45000, apr=36),
            E(kind="saving", label="Cash", amount=60000, liquid=1)]
    s = finance.summarize(rows)
    assert (s["monthly_surplus"], s["interest_per_year"], s["emi_to_income_pct"]) == (25000, 18000, 45.0)
    assert s["emergency_months"] == 0.8 and len(s["flags"]) == 3 and s["upcoming_payments"][0]["label"] == "Rent"


def test_api_scoping_and_ask(client, monkeypatch):
    _signup(client, 1)
    assert client.post("/api/me/finance", json={"kind": "income", "label": "Salary", "amount": 80000}).status_code == 201
    assert client.post("/api/me/finance", json={"kind": "income", "label": "x", "amount": -5}).status_code == 422
    eid = client.get("/api/me/finance").json()["entries"][0]["id"]
    monkeypatch.setattr(finance, "call_llm", lambda *a, **k: ("You have Rs 999999 left.", "mock"))  # invented number
    r = client.post("/api/me/finance/ask", json={"question": "How much can I save?"}).json()
    assert r["ai_generated"] is False and "80000" in r["answer"]  # fell back to computed facts
    monkeypatch.setattr(finance, "call_llm", lambda *a, **k: ("Your income is Rs 80000 a month.", "mock"))
    assert client.post("/api/me/finance/ask", json={"question": "What is my income?"}).json()["ai_generated"] is True
    client.cookies.clear()
    _signup(client, 2)  # another customer cannot see or delete it
    assert client.get("/api/me/finance").json()["entries"] == []
    client.delete(f"/api/me/finance/{eid}")
    assert client.get("/api/staff/finance/x").status_code == 403
