import pytest

from app.data.loader import load_metrics
from app.engine import cas


def test_cas_validation_rejects_empty_file():
    with pytest.raises(cas.CASValidationError, match="empty"):
        cas.parse_cas_pdf_bytes(b"", password="pass")


def test_cas_validation_rejects_non_pdf():
    with pytest.raises(cas.CASValidationError, match="not a valid PDF"):
        cas.parse_cas_pdf_bytes(b"This is not a PDF file", password="pass")


def test_cas_validation_rejects_oversized_file():
    # 16 MB dummy bytes
    big = b"%PDF-1.4" + b"0" * (16 * 1024 * 1024)
    with pytest.raises(cas.CASValidationError, match="exceeds maximum allowed limit"):
        cas.parse_cas_pdf_bytes(big, password="pass", max_size=15 * 1024 * 1024)


def test_cas_analysis_synthetic_portfolio():
    metrics_df = load_metrics()

    synthetic_cas = {
        "statement_period": {"from": "2023-01-01", "to": "2026-10-09"},
        "investor_info": {
            "name": "Rohan Sharma",
            "email": "rohan@example.com",
            "mobile": "9876543210",
        },
        "file_type": "CAMS",
        "cas_type": "DETAILED",
        "folios": [
            {
                "folio": "1001/HDFC",
                "amc": "HDFC Mutual Fund",
                "PAN": "ABCDE1234F",
                "schemes": [
                    {
                        "scheme": "HDFC Banking and PSU Debt Fund - Regular Plan - Growth",
                        "isin": "INF179KA1JC4",
                        "amfi": "128628",
                        "advisor": "ARN-345439",
                        "close": 5000.0,
                        "valuation": {
                            "date": "2026-10-09",
                            "nav": 20.0,
                            "value": 100000.0,
                        },
                        "transactions": [
                            {
                                "date": "2023-01-01",
                                "description": "PURCHASE",
                                "amount": 80000.0,
                                "units": 4500.0,
                                "type": "PURCHASE",
                            },
                            {
                                "date": "2024-01-01",
                                "description": "SIP",
                                "amount": 10000.0,
                                "units": 500.0,
                                "type": "PURCHASE_SIP",
                            },
                        ],
                    }
                ],
            },
            {
                "folio": "2002/BAJAJ",
                "amc": "Bajaj Finserv Mutual Fund",
                "PAN": "ABCDE1234F",
                "schemes": [
                    {
                        "scheme": "BAJAJ FINSERV LARGE CAP FUND - Regular Plan - Growth",
                        "isin": "INF0QA701862",
                        "amfi": "152780",
                        "advisor": "ARN-345439",
                        "close": 2000.0,
                        "valuation": {
                            "date": "2026-10-09",
                            "nav": 50.0,
                            "value": 100000.0,
                        },
                        "transactions": [
                            {
                                "date": "2023-01-01",
                                "description": "PURCHASE",
                                "amount": 70000.0,
                                "units": 1800.0,
                                "type": "PURCHASE",
                            },
                            {
                                "date": "2024-06-01",
                                "description": "SIP",
                                "amount": 15000.0,
                                "units": 200.0,
                                "type": "PURCHASE_SIP",
                            },
                        ],
                    }
                ],
            },
        ],
    }

    res = cas.analyze_cas_data(synthetic_cas, metrics_df=metrics_df, target_band="Moderate")

    assert res["investor_name"] == "Rohan Sharma"
    assert res["total_value"] == 200000.0
    assert res["folios_count"] == 2
    assert res["holdings_count"] == 2
    assert res["overall_xirr"] is not None
    assert res["overall_xirr"] > 0.0

    # Holding level checks
    h0 = res["holdings"][0]
    assert h0["scheme_code"] == "128628"
    assert h0["is_mapped"] is True
    assert h0["asset_class"] == "debt"
    assert h0["xirr"] is not None

    h1 = res["holdings"][1]
    assert h1["scheme_code"] == "152780"
    assert h1["is_mapped"] is True
    assert h1["asset_class"] == "equity"
    assert h1["xirr"] is not None

    # Asset allocation breakdown
    assert "debt" in res["asset_allocation"]
    assert "equity" in res["asset_allocation"]
    assert abs(res["asset_allocation"]["debt"]["pct"] - 50.0) < 1.0
    assert abs(res["asset_allocation"]["equity"]["pct"] - 50.0) < 1.0

    # Band comparison checks
    assert res["band_comparison"] is not None
    assert res["band_comparison"]["target_band"] == "Moderate"
    comparison = res["band_comparison"]["comparison"]
    assert any(c["asset_class"] == "equity" for c in comparison)

    # Privacy copy checks
    assert "ARN 345439" in res["disclaimer"]
    assert "never stored" in res["privacy_notice"]


def test_api_cas_upload_requires_consent(client):
    res = client.post(
        "/api/cas/upload",
        data={"password": "mypass", "consent": "false"},
        files={"file": ("cas.pdf", b"%PDF-1.4 mock pdf content", "application/pdf")},
    )
    assert res.status_code == 400
    assert "Consent" in res.text


def test_api_cas_upload_rejects_non_pdf(client):
    res = client.post(
        "/api/cas/upload",
        data={"password": "mypass", "consent": "true"},
        files={"file": ("statement.txt", b"plain text", "text/plain")},
    )
    assert res.status_code == 400
    assert "PDF" in res.text


def test_api_cas_upload_handles_bad_pdf_bytes(client):
    res = client.post(
        "/api/cas/upload",
        data={"password": "mypass", "consent": "true"},
        files={"file": ("corrupt.pdf", b"%PDF-1.4 corrupt junk bytes", "application/pdf")},
    )
    assert res.status_code in (400, 422)
