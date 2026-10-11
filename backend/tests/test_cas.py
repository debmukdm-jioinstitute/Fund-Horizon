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


def test_resilient_detect_file_type_heuristics():
    from casparser.enums import FileType

    class MockDoc:
        def __init__(self, text: str):
            self._text = text

        def __len__(self):
            return 1

        def __getitem__(self, idx):
            class MockPage:
                def __init__(self, text):
                    self._text = text

                def get_textpage(self):
                    class MockTP:
                        def __init__(self, text):
                            self._text = text

                        def get_text_bounded(self):
                            return self._text

                    return MockTP(self._text)

            return MockPage(self._text)

    # 1. CAMS Mailback without CAMSCASWS
    cams_doc = MockDoc("Computer Age Management Services Ltd\nConsolidated Account Statement\nFolio: 12345/67")
    assert cas.resilient_detect_file_type("dummy.pdf", "pass", _doc=cams_doc) == FileType.CAMS

    # 2. Spaced CAMS
    spaced_cams = MockDoc("C A M S Consolidated Statement\nPeriod: 01-Jan-2023 to 01-Jan-2026")
    assert cas.resilient_detect_file_type("dummy.pdf", "pass", _doc=spaced_cams) == FileType.CAMS

    # 3. KFintech / Karvy without KFINCASWS
    kfin_doc = MockDoc("Karvy Computershare Pvt Ltd / KFin Technologies\nMutual Fund Statement")
    assert cas.resilient_detect_file_type("dummy.pdf", "pass", _doc=kfin_doc) == FileType.KFINTECH

    # 4. CDSL e-CAS
    cdsl_doc = MockDoc("Central Depository Services\nCDSL e-CAS Statement\nBO ID: 1208160012345678")
    assert cas.resilient_detect_file_type("dummy.pdf", "pass", _doc=cdsl_doc) == FileType.CDSL

    # 5. NSDL e-CAS
    nsdl_doc = MockDoc("National Securities Depository Limited\nCAS - NSDL\nDP ID: IN300000")
    assert cas.resilient_detect_file_type("dummy.pdf", "pass", _doc=nsdl_doc) == FileType.NSDL

    # 6. Generic Mutual Fund Folio layout fallback
    folio_doc = MockDoc("Consolidated Portfolio Statement\nFolio No: 54321/98\nOpening Unit Balance: 500.0\nNAV: 25.5")
    assert cas.resilient_detect_file_type("dummy.pdf", "pass", _doc=folio_doc) == FileType.CAMS


def test_normalize_cas_dict_demat_accounts():
    raw_demat = {
        "statement_period": {"from": "2023-01-01", "to": "2026-10-09"},
        "investor_info": {"name": "Priya Sharma", "pan": "ABCDE1234F"},
        "file_type": "CDSL",
        "accounts": [
            {
                "name": "Zerodha Broking Limited",
                "dp_id": "12081600",
                "client_id": "00987654",
                "mutual_funds": [
                    {
                        "name": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
                        "isin": "INF879O01018",
                        "amfi": "122639",
                        "balance": 1000.0,
                        "nav": 75.0,
                        "value": 75000.0,
                    }
                ],
                "equities": [
                    {
                        "name": "Infosys Limited",
                        "isin": "INE009A01021",
                        "balance": 50.0,
                        "value": 75000.0,
                    }
                ],
            }
        ],
    }

    norm = cas.normalize_cas_dict(raw_demat)
    assert "folios" in norm
    assert len(norm["folios"]) == 1
    f0 = norm["folios"][0]
    assert f0["folio"] == "12081600/00987654"
    assert f0["amc"] == "Zerodha Broking Limited"
    assert len(f0["schemes"]) == 2
    assert f0["schemes"][0]["scheme"] == "Parag Parikh Flexi Cap Fund - Direct Plan - Growth"
    assert f0["schemes"][0]["valuation"]["value"] == 75000.0
    assert f0["schemes"][1]["scheme"] == "Infosys Limited"
    assert f0["schemes"][1]["valuation"]["value"] == 75000.0


def test_analyze_cas_data_with_demat_account():
    metrics_df = load_metrics()
    raw_demat = {
        "statement_period": {"from": "2023-01-01", "to": "2026-10-09"},
        "investor_info": {"name": "Priya Sharma", "pan": "ABCDE1234F"},
        "file_type": "CDSL",
        "accounts": [
            {
                "name": "Zerodha Broking Limited",
                "dp_id": "12081600",
                "client_id": "00987654",
                "mutual_funds": [
                    {
                        "name": "HDFC Banking and PSU Debt Fund - Regular Plan - Growth",
                        "isin": "INF179KA1JC4",
                        "amfi": "128628",
                        "balance": 2500.0,
                        "nav": 20.0,
                        "value": 50000.0,
                    }
                ],
            }
        ],
    }

    res = cas.analyze_cas_data(raw_demat, metrics_df=metrics_df, target_band="Moderate")
    assert res["investor_name"] == "Priya Sharma"
    assert res["total_value"] == 50000.0
    assert res["holdings_count"] == 1
    assert res["holdings"][0]["asset_class"] == "debt"


def test_tabular_demat_row_token_extraction_and_resolution():
    metrics_df = load_metrics()
    raw_statement = {
        "statement_period": {"from": "2023-01-01", "to": "2026-10-09"},
        "investor_info": {"name": "Debabrata Mukherjee", "pan": "ABCDE1234F"},
        "file_type": "CDSL",
        "accounts": [
            {
                "name": "CDSL Depository Participant",
                "dp_id": "/s",
                "client_id": "s",
                "mutual_funds": [
                    {
                        "name": "INF109K01ED5 0.000 34.8642 0.00 0.00% 0.00",
                        "isin": "INF109K01ED5",
                        "balance": 0.0,
                        "nav": 0.0,
                        "value": 0.0,
                    },
                    {
                        "name": "INF109K013K9 25,670.185 60.0662 14,50,000.00 6.34% 15,41,910.47",
                        "isin": "INF109K013K9",
                        "balance": 0.0,
                        "nav": 0.0,
                        "value": 0.0,
                    },
                ],
            }
        ],
    }

    norm = cas.normalize_cas_dict(raw_statement)
    # Ensure folio is never '/s'
    assert norm["folios"][0]["folio"] == "Demat-1"

    res = cas.analyze_cas_data(norm, metrics_df=metrics_df, target_band="Moderate")
    assert res["holdings_count"] == 2
    assert res["total_value"] == 1541910.47
    assert res["total_invested"] == 1450000.0
    assert res["total_gain"] == 91910.47
    assert res["overall_xirr"] == 0.0634

    h0 = res["holdings"][0]
    assert h0["isin"] == "INF109K01ED5"
    assert h0["scheme_code"] == "101143"
    assert "ICICI Prudential Multi-Asset Fund" in h0["scheme_name"]
    assert h0["plan"] == "Regular"
    assert h0["category"] == "Multi Asset Allocation"
    assert h0["units"] == 0.0
    assert h0["nav"] == 34.8642
    assert h0["current_value"] == 0.0

    h1 = res["holdings"][1]
    assert h1["isin"] == "INF109K013K9"
    assert h1["scheme_code"] == "120335"
    assert "ICICI Prudential Multi-Asset Fund" in h1["scheme_name"]
    assert "Direct" in h1["scheme_name"]
    assert h1["plan"] == "Direct"
    assert h1["category"] == "Multi Asset Allocation"
    assert h1["units"] == 25670.185
    assert h1["nav"] == 60.0662
    assert h1["invested_value"] == 1450000.0
    assert h1["current_value"] == 1541910.47
    assert h1["xirr"] == 0.0634
    assert h1["cagr"] == 0.0634
    assert h1["folio"] == "Demat-1"


