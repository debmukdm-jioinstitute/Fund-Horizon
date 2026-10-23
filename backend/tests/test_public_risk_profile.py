def _body(**over):
    b = {
        "name": "Asha Rao", "email": "asha@example.com", "phone": "9876543210", "password": "s3cretpass1", "consent": True,
        "age": 35, "employment_type": "salaried_private", "monthly_income": 120000, "monthly_expenses": 50000,
        "answers": {f"q{i}": 2 for i in range(1, 11)},
    }
    return {**b, **over}


def test_public_risk_profile_creates_account_and_pdf(client):
    r = client.post("/api/crm/public/risk-profile", json=_body())
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    login = client.post("/api/auth/login", json={"email": "asha@example.com", "password": "s3cretpass1"})
    assert login.status_code == 200


def test_public_risk_profile_rejects_duplicate_and_bad_input(client):
    assert client.post("/api/crm/public/risk-profile", json=_body()).status_code == 200
    assert client.post("/api/crm/public/risk-profile", json=_body()).status_code == 409
    assert client.post("/api/crm/public/risk-profile", json=_body(email="b@example.com", phone="9876543211", consent=False)).status_code == 422
    assert client.post("/api/crm/public/risk-profile", json=_body(email="c@example.com", phone="9876543212", answers={"q1": 1})).status_code == 422


def test_public_plan_lead_saves_once_and_emails(client, monkeypatch):
    import base64
    from app.api import crm_core
    sent = []
    monkeypatch.setattr(crm_core, "send_email", lambda to, subject, text, attachments=None, **kw: sent.append((to, attachments)))
    b = {"name": "Ravi Kumar", "email": "ravi@example.com", "phone": "9876543299", "consent": True, "plan": {"Style": "Moderate"}}
    pdf = base64.b64encode(b"%PDF-1.4 test").decode()
    assert client.post("/api/crm/public/plan-lead", json=b).json() == {"emailed": False, "error": None}
    r = client.post("/api/crm/public/plan-lead", json={**b, "recorded": True, "pdf_base64": pdf})
    assert r.json()["emailed"] is True and sent[0][0] == "ravi@example.com"
    assert client.post("/api/crm/public/plan-lead", json={**b, "pdf_base64": base64.b64encode(b"nope").decode()}).status_code == 422
    assert client.post("/api/crm/public/plan-lead", json={**b, "consent": False}).status_code == 422
