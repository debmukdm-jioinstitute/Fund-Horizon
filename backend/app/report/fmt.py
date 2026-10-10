"""Display formatting for money (Indian grouping, lakh/crore shorthand)."""
from __future__ import annotations

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
