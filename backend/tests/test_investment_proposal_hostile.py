from __future__ import annotations
from tests.test_backoffice_compare import _create_staff, _login_staff
U = "/api/backoffice/investment-proposal"

def test_hostile(client):
    _login_staff(client, _create_staff())
    s = client.post(f"{U}/suggest", json={"mode": "lumpsum", "amount": 1_000_000, "years": 10, "risk": "Moderate"}).json()["rows"]
    c = [x["code"] for x in s]
    row = lambda code=c[0], amount=1000, sip=0, er=10: {"code": code, "amount": amount, "sip": sip, "exp_ret": er}  # noqa: E731
    cases = [
        ("suggest", {"mode": "sip", "years": 5, "risk": "Moderate", "sip": 499}),
        ("suggest", {"mode": "sip", "years": 5, "risk": "Moderate"}),
        ("suggest", {"mode": "swp", "years": 5, "risk": "Moderate", "amount": 4999}),
        ("suggest", {"mode": "stp", "years": 5, "risk": "Wild", "amount": 100000}),
        ("suggest", {"mode": "lumpsum", "years": 0, "risk": "Moderate", "amount": 100000}),
        ("suggest", {"mode": "lumpsum", "years": 51, "risk": "Moderate", "amount": 100000}),
        ("suggest", {"mode": "lumpsum_sip", "years": 5, "risk": "Moderate", "amount": 100000}),
        ("suggest", {"mode": "bogus", "years": 5, "risk": "Moderate", "amount": 100000}),
        ("suggest", {"mode": "lumpsum", "years": 5, "risk": "Moderate", "amount": -5}),
        ("suggest", {"mode": "lumpsum", "years": 5, "risk": "Moderate", "amount": 1e12}),
        ("result", {"mode": "swp", "years": 5, "amount": 100000, "withdraw": 200000, "rows": [row(amount=100000)]}),
        ("result", {"mode": "swp", "years": 5, "amount": 100000, "withdraw": 0, "rows": [row(amount=100000)]}),
        ("result", {"mode": "sip", "years": 5, "sip": 5000, "rows": [row(sip=0)]}),
        ("result", {"mode": "sip", "years": 5, "sip": 5000, "rows": [row(sip=6000)]}),
        ("result", {"mode": "sip", "years": 5, "rows": [row(amount=100000, sip=0)]}),
        ("result", {"mode": "lumpsum_sip", "years": 5, "rows": [row(amount=0, sip=0)]}),
        ("result", {"mode": "lumpsum_sip", "years": 5, "rows": [row(amount=1000, sip=100)]}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": [row(amount=1000)]}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": [row(er=101)]}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": [row(er=-51)]}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": []}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": [row(code="abc")]}),
        ("result", {"mode": "stp", "years": 5, "amount": 100000, "source": "00000000", "rows": [row(amount=100000)]}),
        ("result", {"mode": "stp", "years": 5, "amount": 100000, "source": "12", "rows": [row(amount=100000)]}),
        ("result", {"mode": "stp", "years": 5, "amount": 100000, "rows": [row(code=c[0], amount=100000)]}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": [row(amount=5000, er=0), row(code=c[1], amount=5000, er=-50)]}),
        ("result", {"mode": "lumpsum", "years": 50, "rows": [row(amount=10**11, er=100)]}),
        ("result", {"mode": "sip", "years": 50, "rows": [row(sip=10**9, er=100)]}),
        ("result", {"mode": "swp", "years": 0.01, "amount": 100000, "withdraw": 1000, "rows": [row(amount=100000)]}),
        ("result", {"mode": "lumpsum", "years": 5, "rows": [row(amount=1000)] * 31}),
        ("pdf", {"mode": "lumpsum", "years": 5, "client": "हिन्दी नाम 日本語", "purpose": "<script>&</script>" * 10, "rows": [row(amount=5000)]}),
        ("pdf", {"mode": "lumpsum", "years": 5, "client": "x" * 500, "rows": [row(amount=5000)]}),
    ]
    out = []
    for path, body in cases:
        r = client.post(f"{U}/{path}", json=body)
        out.append((path, body.get("mode"), r.status_code, r.text[:110] if r.status_code != 200 else ""))
    assert not [o for o in out if o[2] >= 500]  # every bad input is a readable 422, including a Hindi/Japanese client name in the PDF header
