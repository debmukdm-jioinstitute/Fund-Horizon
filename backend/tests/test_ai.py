from app.ai.explain import explain_plan
from app.ai.guardrails import (
    append_statutory_disclosures,
    extract_numbers_from_payload,
    scan_banned_wording,
    scrub_pii,
    verify_number_consistency,
)


def test_guardrail_number_consistency():
    payload = {"target_future_rupees": 5000000, "monthly_sip": 25000, "expected_return": 0.12}
    nums = extract_numbers_from_payload(payload)
    assert 5000000.0 in nums
    assert 25000.0 in nums
    assert 12.0 in nums or 0.12 in nums

    # Consistent text
    good_text = "Your projected target is 5000000 with a monthly SIP of 25000."
    assert verify_number_consistency(good_text, nums) is True

    # Hallucinated number (e.g. 99.9%)
    bad_text = "Your projected target is 5000000 with a 99.9% assured outcome."
    assert verify_number_consistency(bad_text, nums) is False


def test_guardrail_banned_wording():
    assert scan_banned_wording("This is an educational financial plan.") is True
    assert scan_banned_wording("This is the best mutual fund scheme.") is False
    assert scan_banned_wording("We provide guaranteed returns.") is False
    assert scan_banned_wording("Here is our financial advice.") is False
    assert scan_banned_wording("We recommend you buy this equity fund.") is False


def test_guardrail_pii_scrubbing():
    data = {
        "pan": "ABCDE1234F",
        "email": "investor@example.com",
        "phone": "+91 9876543210",
        "nested": {"notes": "Call 9876543210 regarding PAN ABCDE1234F"},
    }
    scrubbed = scrub_pii(data)
    assert scrubbed["pan"] == "[PAN-REDACTED]"
    assert scrubbed["email"] == "[EMAIL-REDACTED]"
    assert "[PAN-REDACTED]" in scrubbed["nested"]["notes"]
    assert "[PHONE-REDACTED]" in scrubbed["nested"]["notes"]


def test_statutory_disclosure_appended():
    text = "Short plan explanation."
    with_disc = append_statutory_disclosures(text)
    assert "ARN 345439" in with_disc
    assert "Educational illustration" in with_disc


def test_explain_plan_deterministic_fallback():
    plan_mock = {
        "profile": {"band": "Moderate", "capacity_band": "Moderate", "monthly_surplus": 50000},
        "total_monthly_sip": 30000,
        "goals": [
            {
                "name": "Retirement",
                "target_future_rupees": 20000000,
                "monthly_sip": 20000,
                "success_probability_base": 0.55,
            }
        ],
    }
    res = explain_plan(plan_mock)
    assert res["kind"] == "plan"
    assert "Moderate" in res["explanation"]
    assert "ARN 345439" in res["explanation"]
    assert res["ai_generated"] is False


def test_explain_plan_mocked_llm_valid(monkeypatch):
    plan_mock = {
        "profile": {"band": "Aggressive", "capacity_band": "High", "monthly_surplus": 80000},
        "total_monthly_sip": 50000,
        "goals": [],
    }
    monkeypatch.setenv(
        "FH_MOCK_LLM_RESPONSE",
        "Here is an educational explanation. Your monthly SIP is 50000 with a monthly surplus of 80000.",
    )
    res = explain_plan(plan_mock)
    assert res["ai_generated"] is True
    assert res["provider"] == "mock"
    assert "ARN 345439" in res["explanation"]


def test_explain_plan_mocked_llm_rejected_by_guardrail(monkeypatch):
    plan_mock = {
        "profile": {"band": "Conservative", "capacity_band": "Low", "monthly_surplus": 20000},
        "total_monthly_sip": 15000,
        "goals": [],
    }
    # Contains banned word "advice"
    monkeypatch.setenv(
        "FH_MOCK_LLM_RESPONSE",
        "Here is our professional advice for your 15000 SIP.",
    )
    res = explain_plan(plan_mock)
    # Guardrail rejects it and falls back to deterministic template
    assert res["ai_generated"] is False
    assert "advice" not in res["explanation"].lower()


def test_api_explain_endpoints(client):
    # Fund explanation
    res_fund = client.post("/api/ai/explain/fund", json={"scheme_code": "128628"})
    assert res_fund.status_code == 200
    fund_data = res_fund.json()
    assert fund_data["kind"] == "fund"
    assert "explanation" in fund_data
    assert "ARN 345439" in fund_data["explanation"]

    # CAS explanation
    res_cas = client.post(
        "/api/ai/explain/cas",
        json={
            "cas_data": {
                "total_value": 1500000,
                "overall_xirr": 0.142,
                "folios_count": 2,
                "holdings_count": 3,
                "plan_breakdown": {
                    "direct": {"pct": 40.0, "value": 600000},
                    "regular": {"pct": 60.0, "value": 900000},
                },
            }
        },
    )
    assert res_cas.status_code == 200
    cas_data = res_cas.json()
    assert cas_data["kind"] == "cas"
    assert "14.20%" in cas_data["explanation"]
    assert "ARN 345439" in cas_data["explanation"]


def test_explain_plan_real_result_shape_uses_capacity_score_not_band():
    plan = {
        "profile": {"band": "Moderate", "capacity": {"score": 69.5}},
        "planning": {"totals": {"allocated_sip": 30000, "monthly_surplus": 50000},
                     "goals": [{"name": "Home", "future_cost": 4000000, "allocated_sip": 30000,
                                "monte_carlo": {"success_prob": 0.5}}]},
    }
    text = explain_plan(plan)["explanation"]
    assert "70 out of 100" in text and "Moderate" in text
    assert "₹4,000,000" in text and "₹30,000" in text
