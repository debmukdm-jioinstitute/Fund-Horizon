"""Display formatting for money (Indian grouping, lakh/crore shorthand)."""
from __future__ import annotations

from xml.sax.saxutils import escape as _xml_escape

from app.config.disclosures import SIZED_STATUS_LABELS
from app.engine.finmath import indian_format


def inr(v: float | None) -> str:
    return "-" if v is None else indian_format(v)


def short_inr(v: float | None) -> str:
    """₹1.25 Cr / ₹12.5 L / ₹45,000."""
    if v is None:
        return "-"
    a = abs(v)
    sign = "-" if v < 0 else ""
    if a >= 1e7:
        return f"{sign}₹{a / 1e7:.2f} Cr"
    if a >= 1e5:
        return f"{sign}₹{a / 1e5:.2f} L"
    return indian_format(v)


def pct(v: float | None, digits: int = 1) -> str:
    if v is None:
        return "-"
    x = round(v * 100, digits)
    return f"{(0.0 if x == 0 else x):.{digits}f}%"


def xml_escape(text: object) -> str:
    """Escape user-supplied text for ReportLab Paragraph and drawString."""
    return _xml_escape("" if text is None else str(text))


def sized_status(status: str) -> str:
    """Map engine funding status to wording that does not read as 'likely'."""
    return SIZED_STATUS_LABELS.get(status, status.replace("_", " "))
