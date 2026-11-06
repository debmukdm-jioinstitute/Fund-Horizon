"""Lumpsum investment proposal: rules copied from the original tool, checked against its captured output."""
from __future__ import annotations

import pytest

from app.backoffice import investment_proposal as ip
from tests.test_backoffice_compare import _create_staff, _login_staff


def test_allocation_grid_matches_original():
    # Moderate, 10 years (captured from the original): hybrid-aggressive 30, large 30, flexi 15, mid 10, large&mid 15.
    assert ip.allocation(1_000_000, 10, "Moderate") == {"hagg": 30, "large": 30, "flexi": 15, "mid": 10, "lmc": 15}
    assert ip.allocation(1_000_000, 1, "Aggressive") == {"liquid": 20, "short": 80}
    assert ip.allocation(1_000_000, 3, "Conservative") == {"short": 40, "hcons": 40, "large": 20}
    assert ip.allocation(1_000_000, 20, "Aggressive") == {"mid": 20, "small": 20, "flexi": 30, "lmc": 30}
    for risk in ip.RISKS:
        for y in (1, 2, 3, 4, 5, 7, 8, 15, 16):
            assert sum(ip.allocation(1_000_000, y, risk).values()) == 100


def test_small_amounts_collapse_into_fewer_categories_and_still_total_100():
    for amt, n in ((8_000, 1), (12_000, 2), (20_000, 3), (50_000, 4), (50_001, 5)):
        mix = ip.allocation(amt, 10, "Moderate")
        assert len(mix) == n and sum(mix.values()) == 100
    assert ip.allocation(8_000, 10, "Moderate") == {"hagg": 100}  # mid -> large&mid -> flexi -> large -> hybrid, chained as in the original


def test_future_value_matches_original_capture():
    # Original: weighted 12.50% on Rs.10,00,000 for 10 years -> 32,47,322; its server calc at 11.5% -> 29,69,947.
    assert ip.future_value(1_000_000, 12.5, 10) == 3_247_322
    assert ip.future_value(1_000_000, 11.5, 10) == 2_969_947
    assert ip.future_value(1_000_000, 10, 1) == 1_100_000  # float noise must not push an exact result up


def test_validation():
    with pytest.raises(ip.ProposalError):
        ip.allocation(1000, 10, "Moderate")
    with pytest.raises(ip.ProposalError):
        ip.allocation(100_000, 0, "Moderate")
    with pytest.raises(ip.ProposalError):
        ip.allocation(100_000, 10, "Wild")


def _client():
    return None


def test_api_suggest_result_pdf(client):
    _login_staff(client, _create_staff())
    r = client.post("/api/backoffice/investment-proposal/suggest", json={"amount": 1_000_000, "years": 10, "risk": "Moderate"})
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert sum(x["amount"] for x in rows) == 1_000_000 and len(rows) >= 5
    assert all(x["amount"] > 0 for x in rows)
    one = client.get(f"/api/backoffice/investment-proposal/scheme/{rows[0]['code']}").json()
    assert one["name"] == rows[0]["name"] and one["exp_ret"] == rows[0]["exp_ret"]
    assert client.get("/api/backoffice/investment-proposal/scheme/99999999").status_code == 422
    body = {"years": 10, "rows": [{"code": x["code"], "amount": x["amount"], "exp_ret": x["exp_ret"]} for x in rows], "client": "Test"}
    res = client.post("/api/backoffice/investment-proposal/result", json=body).json()
    assert res["amount"] == 1_000_000 and res["future_value"] == ip.future_value(1_000_000, res["expected_return"], 10)
    assert abs(sum(x["alloc_pct"] for x in res["schemes"]) - 100) < 0.1
    assert sum(x["pct"] for x in res["category"]) == pytest.approx(100, abs=0.1)
    pdf = client.post("/api/backoffice/investment-proposal/pdf", json={**body, "risk": "Moderate", "purpose": "Wealth"})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and len(pdf.content) > 5000
    # exceeding the proposal amount and unknown / duplicate schemes are refused with a readable reason
    over = client.post("/api/backoffice/investment-proposal/result", json={**body, "amount": 500_000})
    assert over.status_code == 422 and "exceeds" in over.json()["detail"]
    bad = client.post("/api/backoffice/investment-proposal/result", json={"years": 5, "rows": [{"code": "99999999", "amount": 1000, "exp_ret": 8}]})
    assert bad.status_code == 422
    dup = client.post("/api/backoffice/investment-proposal/result", json={"years": 5, "rows": [body["rows"][0], body["rows"][0]]})
    assert dup.status_code == 422 and "twice" in dup.json()["detail"]
    small = client.post("/api/backoffice/investment-proposal/suggest", json={"amount": 8000, "years": 10, "risk": "Moderate"}).json()
    assert len(small["rows"]) == 1 and small["rows"][0]["amount"] == 8000


def test_pdf_is_branded_with_charts():
    import re
    from app.report.investment_proposal import build_pdf
    r = {"amount": 100000, "years": 5, "expected_return": 10, "future_value": 161051, "title": "Lumpsum", "mode": "lumpsum", "sip": 0, "curve": [{"year": 0, "invested": 100000, "value": 100000}, {"year": 5, "invested": 100000, "value": 161051}],
         "kpis": [{"label": "Lumpsum amount", "value": 100000, "fmt": "inr"}, {"label": "Investment period", "value": 5, "fmt": "yrs"},
                  {"label": "Expected return", "value": 10, "fmt": "pct"}, {"label": "Expected value at maturity", "value": 161051, "fmt": "inr"}],
         "schemes": [{"name": "A", "category": "Equity: Flexi Cap", "ret_1y": 1, "ret_3y": 2, "ret_5y": 3, "exp_ret": 10, "amount": 100000, "alloc_pct": 100}],
         "trailing": [{"name": "A", "category": "Equity: Flexi Cap", "aum_cr": 1, "ter": 1, "peers": 2, "returns": {"1y": 1, "3y": 2, "5y": 3, "10y": None},
                       "avg": {"1y": 1, "3y": 2, "5y": 3, "10y": None}, "rank": {"1y": 1, "3y": 1, "5y": 1, "10y": None}}], "rolling": [],
         "amc": [{"name": "X", "amount": 100000, "pct": 100}], "asset": [{"name": "Equity Schemes", "amount": 100000, "pct": 100}],
         "category": [{"name": "Equity: Flexi Cap", "amount": 100000, "pct": 100}], "holdings": {"sector": [], "equity": [], "debt": [], "coverage_pct": 0, "as_of": None}}
    pdf = build_pdf(r, "Deb", "Moderate", "Wealth")
    assert pdf.startswith(b"%PDF") and len(re.findall(rb"/Subtype\s*/Image", pdf)) >= 5  # logo x2 + charts


def test_mode_math():
    assert ip._sip_fv(10_000, 12, 12) == pytest.approx(10_000 * ((1.01) ** 12 - 1) / 0.01 * 1.01)
    assert ip._sip_fv(1000, 0, 12) == 12_000
    rows = [{"amount": 0, "sip": 10_000, "exp_ret": 12}]
    assert ip._project("sip", rows, 1, 12, 0, 0)["fv"] == 128_094  # ceil(128093.3)
    lump = [{"amount": 1_000_000, "sip": 0, "exp_ret": 12}]
    assert ip._project("swp", lump, 10, 12, 5_000, 0)["fv"] > 0
    r = ip._project("swp", lump, 10, 12, 20_000, 0)
    assert r["fv"] == 0 and r["months"] < r["planned"] and r["withdrawn"] > 1_000_000
    assert ip._project("stp", [{"amount": 120_000, "sip": 0, "exp_ret": 0}], 1, 0, 0, 0)["fv"] == 120_000
    with pytest.raises(ip.ProposalError):
        ip.check("swp", 100_000, 0, 200_000, 5)
    with pytest.raises(ip.ProposalError):
        ip.check("sip", 0, 100, 0, 5)
    with pytest.raises(ip.ProposalError):
        ip.check("nope", 100_000, 0, 0, 5)


def test_api_all_modes(client):
    _login_staff(client, _create_staff())
    u = "/api/backoffice/investment-proposal"
    cases = {"sip": {"sip": 10_000}, "stp": {"amount": 600_000}, "swp": {"amount": 2_000_000}, "lumpsum_sip": {"amount": 500_000, "sip": 10_000}}
    for mode, extra in cases.items():
        s = client.post(f"{u}/suggest", json={"mode": mode, "years": 10, "risk": "Moderate", **extra}).json()
        rows = s["rows"]
        assert sum(x["amount"] for x in rows) == extra.get("amount", 0) and sum(x["sip"] for x in rows) == extra.get("sip", 0), mode
        assert (s["source"] is not None) == (mode == "stp")
        body = {"mode": mode, "years": 10, "withdraw": 10_000 if mode == "swp" else 0, "source": (s["source"] or {}).get("code"),
                "rows": [{"code": x["code"], "amount": x["amount"], "sip": x["sip"], "exp_ret": x["exp_ret"]} for x in rows], **extra}
        res = client.post(f"{u}/result", json=body)
        assert res.status_code == 200, (mode, res.text)
        d = res.json()
        assert d["future_value"] >= 0 and d["kpis"] and d["title"]
        assert d["curve"][0]["year"] == 0 and d["curve"][-1]["value"] == d["future_value"], mode  # chart ends where the headline figure does
        pdf = client.post(f"{u}/pdf", json={**body, "client": "T", "risk": "Moderate"})
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF"), mode
    assert client.post(f"{u}/result", json={**body, "mode": "swp", "withdraw": 0}).status_code == 422
