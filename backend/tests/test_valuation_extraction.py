"""Provider adapters, detection, PDF/Excel extraction and normalisation, on synthetic anonymised statements."""
import pytest

from app.backoffice.valuation import detection, ingestion
from app.backoffice.valuation.canonical import ExtractionError
from app.backoffice.valuation.providers import ADAPTERS
from tests import valuation_fixtures as fx


def _sum_mv(st):
    return round(sum(h.market_value for h in st.holdings), 2)


def test_no_adapter_claims_real_sample_verification():
    assert not any(a.verified for a in ADAPTERS.values())


def test_fundsindia_excel_extraction_matches_reference():
    st = ADAPTERS["fundsindia"].extract("fi.xlsx", fx.fundsindia_xlsx())
    assert st.statement_date == fx.FI["date"] and st.account_no == fx.FI["client"]
    assert _sum_mv(st) == fx.FI["value"]
    assert round(sum(h.invested_amount for h in st.holdings), 2) == fx.FI["invested"]
    assert round(sum(h.unrealised_gain for h in st.holdings), 2) == fx.FI["unrealised"]
    assert {h.account_no for h in st.holdings} == {"1001/1", "2002/2", "3003/3"}      # folios kept as accounts
    assert all(h.asset_type == "mutual_fund" and h.isin for h in st.holdings)
    assert st.totals["table_total_value"] == fx.FI["value"]
    assert st.holdings[0].source_page == "Holdings" and st.holdings[0].source_row == 6  # traceable to sheet + row


def test_proaffluence_pdf_extraction_matches_reference():
    st = ADAPTERS["proaffluence"].extract("pa.pdf", fx.proaffluence_pdf())
    assert st.account_no == fx.PA["account"] and st.statement_date == fx.PA["date"] and st.period_start == "2026-10-01"
    assert _sum_mv(st) == fx.PA["holdings"]
    assert st.totals["cash_balance"] == fx.PA["cash"] and st.totals["total_value"] == fx.PA["total"]
    assert st.totals["opening_value"] == fx.PA["opening"] and st.totals["total_invested"] == fx.PA["invested"]
    assert [(f.flow_date, f.kind, f.amount) for f in st.flows] == [("2026-10-15", "deposit", 100000.0)]
    assert st.holdings[0].source_page == "p1"
    assert not st.errors


def test_stallion_excel_extraction_matches_reference():
    st = ADAPTERS["stallion"].extract("st.xlsx", fx.stallion_xlsx())
    assert st.account_no == fx.ST["account"] and st.statement_date == fx.ST["date"]
    assert _sum_mv(st) == fx.ST["holdings"] and st.totals["cash_balance"] == fx.ST["cash"]
    assert sorted((f.kind, f.amount) for f in st.flows) == [("deposit", 200000.0), ("withdrawal", 20000.0)]


@pytest.mark.parametrize("name,data,fn,expected", [
    ("fi", fx.fundsindia_xlsx(), "x.xlsx", "fundsindia"), ("pa", fx.proaffluence_pdf(), "x.pdf", "proaffluence"),
    ("st", fx.stallion_xlsx(), "x.xlsx", "stallion")])
def test_provider_detection(name, data, fn, expected):
    assert detection.detect(fn, data)[0] == expected


def test_detection_is_content_based_not_filename_only_and_ambiguity_is_manual():
    # generic PMS statement without a provider name: both PMS adapters tie -> manual selection, never a coin flip
    pdf = fx.proaffluence_pdf(["Portfolio Management Services", "Client Code: X-100", "PMS statement"])
    pid, note = detection.detect("statement.pdf", pdf)
    assert pid is None and "select manually" in note
    # a misleading file name alone cannot override content: the content names Stallion, the name says nothing
    assert detection.detect("statement.xlsx", fx.stallion_xlsx())[0] == "stallion"


def test_scanned_pdf_is_flagged_for_manual_review_not_guessed():
    st = ADAPTERS["proaffluence"].extract("scan.pdf", fx.image_only_pdf())
    assert st.needs_manual_review and not st.holdings and not st.totals and "No text layer" in st.errors[0]


def test_unsupported_and_corrupt_files():
    with pytest.raises(ExtractionError) as e:
        ADAPTERS["stallion"].extract("x.docx", b"PK\x03\x04junk")
    assert e.value.code == "unsupported_file"
    with pytest.raises(ExtractionError) as e:
        ADAPTERS["stallion"].extract("x.xlsx", b"PK\x03\x04not really a workbook")
    assert e.value.code == "corrupt_file"
    with pytest.raises(ExtractionError) as e:
        ADAPTERS["stallion"].extract("x.pdf", b"%PDF-1.4 garbage")
    assert e.value.code == "corrupt_file"


def test_password_protected_pdf_requires_password():
    import io

    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for p in PdfReader(io.BytesIO(fx.proaffluence_pdf())).pages:
        w.add_page(p)
    w.encrypt("s3cret")
    b = io.BytesIO()
    w.write(b)
    with pytest.raises(ExtractionError) as e:
        ADAPTERS["proaffluence"].extract("pa.pdf", b.getvalue())
    assert e.value.code == "password_required"
    assert ADAPTERS["proaffluence"].extract("pa.pdf", b.getvalue(), "s3cret").account_no == fx.PA["account"]


def test_unrecognised_layout_is_flagged_not_invented():
    st = ADAPTERS["stallion"].extract("x.csv", b"hello,world\n1,2\n")
    assert st.needs_manual_review and not st.holdings


def test_incomplete_row_keeps_missing_values_missing():
    csv = (b"Security,ISIN,Qty,Market Value\nTata Consultancy Services Ltd,INE467B01029,10,\n"
           b"Reliance Industries Ltd,INE002A01018,5,13000\n")
    st = ADAPTERS["stallion"].extract("x.csv", csv)
    tcs = next(h for h in st.holdings if "Tata" in h.security_name)
    assert tcs.market_value is None and tcs.price is None and tcs.avg_cost is None   # nothing derived or defaulted
    assert any("no market value" in w for w in st.warnings)


def test_pdf_row_with_wrong_column_count_is_skipped_with_warning():
    lines = [x for x in fx.PA_LINES]
    lines[lines.index(next(x for x in lines if "Tata" in x))] = f"Tata Consultancy Services Ltd {fx.ISIN_TCS} 50 3,000.00 150,000.00"
    st = ADAPTERS["proaffluence"].extract("pa.pdf", fx.proaffluence_pdf(lines))
    assert len(st.holdings) == 1 and any("skipped" in w for w in st.warnings)


def test_isin_checksum_and_number_parsing_helpers():
    assert ingestion.valid_isin(fx.ISIN_REL) and not ingestion.valid_isin("INE002A01019") and not ingestion.valid_isin("abc")
    assert ingestion.to_num("(1,234.50)") == -1234.5 and ingestion.to_num("-") is None and ingestion.to_num("NA") is None
    assert ingestion.parse_date("31/10/2026") == "2026-10-31" and ingestion.parse_date("31 Oct 2026") == "2026-10-31"
    assert ingestion.parse_date("13/13/2026") is None


def test_bad_isin_is_flagged_on_the_holding():
    csv = b"Security,ISIN,Qty,Market Price,Market Value\nSome Co Ltd,INE002A01019,10,100,1000\n"
    st = ADAPTERS["stallion"].extract("x.csv", csv)
    assert st.holdings[0].validation_status == "warning" and "ISIN" in st.holdings[0].issues[0]
