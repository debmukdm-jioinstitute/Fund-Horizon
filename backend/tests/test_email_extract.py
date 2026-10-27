from app.email_extract import extract_text, suggest


def test_suggest_from_statement_text():
    s = suggest("x.pdf", "Consolidated Account Statement\nInvestor Name: Mr Rahul Sharma\nas on 31-Mar-2026")
    assert s["client_name"] == "Rahul Sharma" and s["first_name"] == "Rahul"
    assert s["doc_type"] == "Consolidated account statement"
    assert s["period"] == "31-Mar-2026"
    assert "{name}" in s["message"] and "31-Mar-2026" in s["subject"]


def test_suggest_falls_back_to_filename():
    s = suggest("scan_v2.pdf", "")
    assert s["client_name"] is None and "Scan V2".lower() in s["subject"].lower()


def test_txt_and_unknown_ext():
    assert "hello" in extract_text("a.txt", b"hello")
    assert extract_text("a.xlsx", b"zzz") == ""


def test_real_layouts():
    pms = suggest("I320_100537_PortFolioFactSheet6020CT.pdf", "Stallion Asset Private Limited\nAs of 11/10/2026\nAccount:  100537 - BATUL ABBAS DALAL - SACF573\n")
    assert pms["client_name"] == "BATUL ABBAS DALAL" and pms["first_name"] == "Batul" and pms["doc_type"] == "Portfolio factsheet"
    mf = suggest("x.pdf", "Proaffluence Associates Private Limited\nReport as on: 26-Oct-2026\nAditya Satish Parchure \n(ATMPP2601B)\nMF Summary Report - Sub Category wise\n")
    assert mf["client_name"] == "Aditya Satish Parchure" and mf["doc_type"] == "Portfolio summary"
