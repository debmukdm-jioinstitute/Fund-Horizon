"""Adversarial inputs for the real-statement readers, bundle splitting, matching and upload atomicity (synthetic, no client data)."""
import io

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.backoffice.valuation import bundle, factsheets, layouts, service


def _pdf(pages: list[str]) -> bytes:
    b = io.BytesIO()
    c = canvas.Canvas(b, pagesize=A4)
    for t in pages:
        y = 800
        for ln in t.split("\n"):
            c.drawString(40, y, ln)
            y -= 14
        c.showPage()
    c.save()
    return b.getvalue()


def _folio(rows, grand):
    body = "\n".join(f"{n} {name} {folio} {inv:,.2f} {inv:,.2f} 0.00 0.00 {u:,.2f} {nav:,.2f} {val:,.2f} 50.00% 10.00% 5.00%"
                     for n, (name, folio, inv, u, nav, val) in enumerate(rows, 1))
    return ["Portfolio Valuation Report - Folio Wise\nX\n05 Nov 2026\n" + body + f"\nGrand Total {grand[0]:,.2f} {grand[0]:,.2f} 0.00 0.00 {grand[1]:,.2f} 100.00% 10.00% 5.00%"]


ROWS = [("Alpha Fund-Reg(G)", "123456", 1000.0, 10.0, 120.0, 1200.0), ("Beta Nifty 50 Index Fund(G)", "A/9988/7", 2000.0, 20.0, 110.0, 2200.0)]


def test_folio_reader_handles_digits_in_names_and_alpha_folios():
    h, tot, w, _ = layouts.folio_wise_mf(_folio([ROWS[0], ("Beta Nifty 50 Index Fund(G)", "9988776", 2000.0, 20.0, 110.0, 2200.0)], (3000.0, 3400.0)))
    assert [x.security_name for x in h] == ["Alpha Fund-Reg(G)", "Beta Nifty 50 Index Fund(G)"] and not w and tot["total_value"] == 3400.0


def test_folio_reader_flags_a_row_it_cannot_read():
    # row 2 has a folio the reader cannot parse -> rows no longer sum to the provider total: must be reported, never silent
    h, _, w, _ = layouts.folio_wise_mf(_folio(ROWS, (3000.0, 3400.0)))
    assert len(h) == 1 and any("may be missing" in x for x in w)


def test_direct_equity_with_thousands_separators():
    t = ("Client Name X\nScript Name Quantity Avg Unit Cost Invested Value Current Price Current Value Unrealized P&L\n"
         "Big Co Ltd 1,200 1,039.64 12,47,568.00 1,164.90 13,97,880.00 1,50,312.00\nTotal Holdings Value 1,247,568 1,397,880 150,312\nHolding Date 30-10-2026")
    h, tot, d, _ = layouts.direct_equity([t])
    assert len(h) == 1 and h[0].quantity == 1200 and tot["total_value"] == 1397880 and d == "2026-10-30"


def test_pms_identity_gap_is_an_error():
    from app.backoffice.valuation.canonical import ExtractedStatement

    t = "Strategy: S\nAccount: 1 - X - Y\nInception Date: 01/01/2020\nContribution\nWithdrawal\nProfit/Loss\nPortfolio Value(31/10/2026)\n100\n0\n50\n999\nPortfolio -1.00% 2.00% 3.00% 4.00%\n BSE 500 TRI"
    st = ExtractedStatement(provider="stallion", asset_class="pms", filename="f", adapter_version="v")
    layouts.enrich_pms(st, [t])
    assert st.errors and "999" in st.errors[0]


def test_bundle_merges_repeated_mf_header_and_ignores_plain_statements():
    mf = "Acme Pvt Ltd\nMF Summary Report - Sub Category wise\nrows"
    secs, _ = bundle.split(_pdf([mf, mf, mf, "Script Name Quantity Avg Unit Cost\nrow"]))
    assert [s["kind"] for s in secs] == ["mf", "direct"] and secs[0]["pages"] == [0, 1, 2]
    assert bundle.split(_pdf(["just one page of text", "another page"]))[0] == []          # not a bundle


def test_bundle_upload_is_all_or_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "v.db"))
    monkeypatch.setenv("FH_VAL_STORE", str(tmp_path / "p"))
    service._ENGINES.clear()
    pdf = _pdf(["Acme Pvt Ltd\nMF Summary Report x", "Script Name Quantity Avg Unit Cost\nrow"])
    b = service.create_batch("c1", "2026-10", "2026-10-31", "t")["id"]
    assert len(service.add_upload(b, "r.pdf", pdf, "t")) == 2
    with pytest.raises(service.ServiceError) as e:                                  # identical content: 409 on section 1
        service.add_upload(b, "r2.pdf", pdf, "t")
    assert "no section" in e.value.message and len(service.preview(b)["files"]) == 2


def test_match_scheme_never_guesses():
    df = factsheets._frame()
    assert factsheets.match_scheme("Totally Unknown Wealth Builder", 10.0, "2026-11-05", df)[0] is None
    assert factsheets.match_scheme("Fund", None, None, df)[0] is None                    # only noise words
    row, how = factsheets.match_scheme("Axis Midcap Fund-Reg(G)", None, None, df)
    assert row and row["plan"] == "Regular"                                             # the statement states its plan
    row, _ = factsheets.match_scheme("Axis Midcap Fund-Dir(G)", None, None, df)
    assert row and row["plan"] == "Direct"


def test_nav_check_dates():
    from datetime import date

    ok = factsheets.nav_check(100.0, date(2026, 11, 9), ("06-Nov-2026", 100.1))     # Monday statement -> Friday NAV
    assert ok["ok"] is True
    assert factsheets.nav_check(100.0, date(2026, 11, 9), ("09-Nov-2026", 100.1))["ok"] is None   # same-day NAV is not the printed one
    assert factsheets.nav_check(100.0, date(2026, 11, 9), ("06-Nov-2026", 103.0))["ok"] is False   # 3% apart on the right date
