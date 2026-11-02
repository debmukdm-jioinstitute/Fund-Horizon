"""Synthetic, anonymised statements with hand-computed reference totals. NOT real provider layouts."""
from __future__ import annotations

import io

import openpyxl


def make_isin(body11: str) -> str:
    """Append the correct ISIN check digit (Luhn on the digit-expanded string)."""
    digits = "".join(str(int(c, 36)) for c in body11)
    for chk in range(10):
        s = digits + str(chk)
        t = 0
        for i, ch in enumerate(reversed(s)):
            n = int(ch)
            if i % 2 == 1:
                n = n * 2 - (9 if n * 2 > 9 else 0)
            t += n
        if t % 10 == 0:
            return body11 + str(chk)
    raise AssertionError


ISIN_A, ISIN_B, ISIN_C = make_isin("INF179K01VQ"), make_isin("INF204K01XY"), make_isin("INF109K01ZZ")
ISIN_REL, ISIN_TCS = "INE002A01018", "INE467B01029"

# ---- reference figures (rupees), computed by hand ----
FI = dict(value=561_092.10, invested=515_030.00, unrealised=46_062.10, date="2026-10-31", client="FI900123")
PA = dict(holdings=420_000.00, cash=25_000.00, total=445_000.00, invested=380_000.00, cost=390_000.00, contribution=100_000.00,
          date="2026-10-31", account="PA-2201", opening=330_000.00)
ST = dict(holdings=300_000.00, cash=15_000.00, total=315_000.00, invested=180_000.00, date="2026-10-29", account="ST-7788",
          deposit=200_000.00, withdrawal=20_000.00)


def _xlsx(sheets: dict[str, list[list]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def fundsindia_xlsx() -> bytes:
    return _xlsx({"Holdings": [
        ["FundsIndia Mutual Fund Statement"], [f"Client Code: {FI['client']}"], ["Statement as on 31-Oct-2026"], [],
        ["Folio No", "Scheme Name", "ISIN", "Units", "Avg Cost", "Invested Amount", "NAV", "Current Value", "Unrealised Gain/Loss", "Return %"],
        ["1001/1", "Alpha Flexi Cap Fund - Direct Growth", ISIN_A, 100.0, 1500.0, 150000.0, 1800.0, 180000.0, 30000.0, 20.0],
        ["2002/2", "Beta Flexi Cap Fund - Direct Growth", ISIN_B, 250.5, 60.0, 15030.0, 84.2, 21092.10, 6062.10, 40.3],
        ["3003/3", "Gamma Liquid Fund - Direct Growth", ISIN_C, 1000.0, 350.0, 350000.0, 360.0, 360000.0, 10000.0, 2.9],
        ["Total", None, None, None, None, 515030.0, None, 561092.10, 46062.10, None],
    ]})


PA_LINES = [
    "ProAffluence Portfolio Management Services",
    "Client Code: PA-2201", "Statement for the period 01-10-2026 to 31-10-2026",
    "Valuation as on 31-10-2026", "",
    "Opening Value 330,000.00", "Capital Invested 380,000.00", "Cash Balance 25,000.00", "Total Portfolio Value 445,000.00", "",
    "Equity",
    "Security Name ISIN Quantity Avg Cost Cost Value Market Price Market Value % Assets",
    f"Reliance Industries Ltd {ISIN_REL} 100 2,400.00 240,000.00 2,600.00 260,000.00 58.43",
    f"Tata Consultancy Services Ltd {ISIN_TCS} 50 3,000.00 150,000.00 3,200.00 160,000.00 35.96",
    "Total 390,000.00 420,000.00 94.38", "",
    "Date Transaction Amount",
    "15-10-2026 Capital Contribution 100,000.00",
]


def proaffluence_pdf(lines: list[str] | None = None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    import app.report.fonts  # noqa: F401  (registers Google Sans)
    from app.report.fonts import BODY_FONT

    b = io.BytesIO()
    c = canvas.Canvas(b, pagesize=A4)
    c.setFont(BODY_FONT, 8)
    y = 800
    for ln in (PA_LINES if lines is None else lines):
        c.drawString(30, y, ln)
        y -= 14
    c.save()
    return b.getvalue()


def image_only_pdf() -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    b = io.BytesIO()
    c = canvas.Canvas(b, pagesize=A4)
    c.rect(50, 50, 200, 200, fill=1)  # no text layer, like a scan
    c.save()
    return b.getvalue()


def stallion_xlsx(deposit_desc: str = "Capital Infusion", deposit: float = 200000.0) -> bytes:
    return _xlsx({
        "Summary": [["Stallion Asset PMS - Portfolio Statement"], ["Account No: ST-7788"], ["Valuation Date", "29-Oct-2026"],
                    ["Capital Invested", 180000.0], ["Cash Balance", 15000.0], ["Total Portfolio Value", 315000.0]],
        "Holdings": [["Security", "ISIN", "Qty", "Average Price", "Cost Value", "Market Price", "Market Value"],
                     ["Reliance Industries Ltd", ISIN_REL, 60, 2500.0, 150000.0, 2600.0, 156000.0],
                     ["Tata Consultancy Services Ltd", ISIN_TCS, 45, 3000.0, 135000.0, 3200.0, 144000.0],
                     ["Total", None, None, None, 285000.0, None, 300000.0]],
        "Transactions": [["Date", "Transaction", "Amount"],
                         ["02-04-2026", deposit_desc, deposit], ["15-10-2026", "Capital Withdrawal", 20000.0]],
    })


def fundsindia_xlsx_corrected() -> bytes:
    """Same folios/date as fundsindia_xlsx but Gamma units corrected 1000 -> 900 (a revised statement, different bytes)."""
    return _xlsx({"Holdings": [
        ["FundsIndia Mutual Fund Statement"], [f"Client Code: {FI['client']}"], ["Statement as on 31-Oct-2026"], [],
        ["Folio No", "Scheme Name", "ISIN", "Units", "Avg Cost", "Invested Amount", "NAV", "Current Value", "Unrealised Gain/Loss"],
        ["1001/1", "Alpha Flexi Cap Fund - Direct Growth", ISIN_A, 100.0, 1500.0, 150000.0, 1800.0, 180000.0, 30000.0],
        ["2002/2", "Beta Flexi Cap Fund - Direct Growth", ISIN_B, 250.5, 60.0, 15030.0, 84.2, 21092.10, 6062.10],
        ["3003/3", "Gamma Liquid Fund - Direct Growth", ISIN_C, 900.0, 350.0, 315000.0, 360.0, 324000.0, 9000.0],
        ["Total", None, None, None, None, 480030.0, None, 525092.10, 45062.10],
    ]})
