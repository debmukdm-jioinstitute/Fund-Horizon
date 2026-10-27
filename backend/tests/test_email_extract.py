from app.email_extract import extract_text, suggest


def test_suggest_from_statement_text():
    s = suggest("x.pdf", "Consolidated Account Statement\nInvestor Name: Mr Rahul Sharma\nas on 31-Mar-2026\nrahul@example.com")
    assert s["client_name"] == "Rahul Sharma" and s["first_name"] == "Rahul"
    assert s["doc_type"] == "Consolidated account statement"
    assert s["period"] == "31-Mar-2026" and s["email"] == "rahul@example.com"
    assert "{name}" in s["message"] and "31-Mar-2026" in s["subject"]


def test_suggest_falls_back_to_filename():
    s = suggest("kyc_form-v2.pdf", "")
    assert s["client_name"] is None and "Kyc Form V2".lower() in s["subject"].lower()


def test_txt_and_unknown_ext():
    assert "hello" in extract_text("a.txt", b"hello")
    assert extract_text("a.xlsx", b"zzz") == ""
