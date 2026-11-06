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


STMT = """Account details,,,,
Date,Narration,Debit,Credit,Balance
01-10-2026,SWIGGY ORDER,500,,10
05-10-2026,SALARY ACME,,80000,10
10-10-2026,RENT TO LANDLORD,20000,,10
03-11-2026,ZOMATO,700,,10
05-11-2026,SALARY ACME,,80000,10
bad,row,1,,
"""


def test_calc():
    from app import finance_calc as fc

    got = fc.parse_statement(STMT)
    assert got["months"] == 2 and got["skipped"] == 1 and got["expense"] == {"Food": 600, "Home": 10000} and got["income"] == {"Salary / income": 80000}
    assert fc.parse_statement("Date,Description,Amount\n01-10-2026,Uber ride,-250\n")["expense"] == {"Travel": 250}
    for bad in ("nothing here", "Date,Foo\n1,2\n3,4"):
        try:
            fc.parse_statement(bad)
            raise AssertionError("should reject")
        except ValueError:
            pass
    assert fc.payoff(100000, 12, 2000)["months"] == 70 and fc.payoff(100000, 12, 1000) is None  # 1000 only covers the monthly interest
    assert round(fc.emi_for(1_000_000, 12, 1)) == 88849
    assert fc.afford(100000, 60000, 10000, 15000)["verdict"] == "comfortable"
    assert fc.afford(100000, 95000, 10000, 15000)["verdict"] == "too high"
    g = fc.goal_plan([{"label": "House", "amount": 1_200_000, "years": 10, "saved": 0}, {"label": "x", "amount": 5, "years": None, "saved": 0}])
    assert 5000 < g[0]["monthly_needed"] < 7000 and g[1]["monthly_needed"] is None
    ics = fc.bills_ics([{"id": "a", "label": "Rent, home", "due_day": 31, "amount": 100}])
    assert "RRULE:FREQ=MONTHLY" in ics and "Rent\\, home" in ics
    assert fc.tax_view(35, 1_500_000)["better"] in ("old", "new")
    assert fc.report_pdf(finance.summarize([]) | {"net_worth": 0}, None, "Nov 2026")[:4] == b"%PDF"


def test_full_flow(client):
    _signup(client, 3)
    r = client.post("/api/me/finance/import", json={"csv": STMT})
    assert r.status_code == 200 and r.json()["added"] == 3
    assert client.post("/api/me/finance/import", json={"csv": STMT}).json()["added"] == 3  # replaces, does not double
    d = client.get("/api/me/finance").json()
    assert d["summary"]["monthly_income"] == 80000 and len(d["entries"]) == 3 and d["changes"] is None
    assert client.post("/api/me/finance/import", json={"csv": "garbage garbage garbage"}).status_code == 400
    client.post("/api/me/finance", json={"kind": "goal", "label": "House", "amount": 1200000, "years": 10})
    client.post("/api/me/finance", json={"kind": "budget", "label": "Food", "category": "Food", "amount": 700})
    client.post("/api/me/finance", json={"kind": "insurance", "label": "Term", "category": "life", "amount": 1000000})
    sm = client.get("/api/me/finance").json()["summary"]
    assert sm["goal_plan"][0]["monthly_needed"] > 0 and sm["budgets"][0]["pct"] == 86
    assert any("Food spending is 86%" in f for f in sm["flags"]) and any("Life cover" in f for f in sm["flags"])
    assert client.post("/api/me/finance/afford", json={"loan_amount": 500000, "apr": 10, "years": 5}).json()["verdict"] in ("comfortable", "stretch", "too high")
    assert client.post("/api/me/finance/afford", json={}).status_code == 422
    assert client.post("/api/me/finance/tax", json={"age": 30}).json()["gross_annual"] == 960000
    assert client.post("/api/me/finance/bills.ics").status_code == 400  # no due days yet
    client.post("/api/me/finance", json={"kind": "expense", "label": "Rent", "amount": 20000, "due_day": 5})
    assert client.post("/api/me/finance/bills.ics").text.startswith("BEGIN:VCALENDAR")
    assert client.post("/api/me/finance/report.pdf").content[:4] == b"%PDF"
    assert client.post("/api/me/finance/share").status_code == 201
    assert "My money summary" in client.get("/api/me/messages").json()["messages"][-1]["body"]
