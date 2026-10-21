from __future__ import annotations
"""Pure financial-math primitives. Money in rupees (float internally, rounded at the edges).

Conventions: rates are decimals; `r` is a per-period rate; annuity-due = payment at period start.
"""

import math

try:
    import numpy as np
except ImportError:
    np = None


def monthly_rate(annual: float) -> float:
    """Effective monthly rate: (1+annual)^(1/12) - 1. Conservative vs annual/12."""
    return (1.0 + annual) ** (1.0 / 12.0) - 1.0


def inflate(amount: float, rate: float, years: float) -> float:
    """amount * (1+rate)^years."""
    return amount * (1.0 + rate) ** years


def fv_lumpsum(pv: float, annual_rate: float, years: float) -> float:
    """pv * (1+annual_rate)^years."""
    return pv * (1.0 + annual_rate) ** years


def sip_fv_factor(r: float, n: int, due: bool = True, step_up: float = 0.0) -> float:
    """Future value of a SIP of Rs 1/month for n months at monthly rate r.

    Ordinary: sum_{t=1..n} (1+r)^(n-t); due: payment at start of month, i.e. times (1+r).
    step_up: payment grows by `step_up` at the start of each 12-month block.
    """
    if n <= 0:
        return 0.0
    t = np.arange(n)
    pay = (1.0 + step_up) ** (t // 12)
    grow = (1.0 + r) ** (n - t - (0 if due else 1))
    return float(np.sum(pay * grow))


def sip_fv(pmt: float, r: float, n: int, due: bool = False, step_up: float = 0.0) -> float:
    """FV = pmt * sip_fv_factor. Ordinary annuity by default (matches textbook anchor)."""
    return pmt * sip_fv_factor(r, n, due, step_up)


def required_sip(
    target: float, r: float, n: int, due: bool = True, step_up: float = 0.0, existing_fv: float = 0.0
) -> float:
    """Monthly SIP (first-year amount) needed to reach `target` after crediting `existing_fv`.

    SIP = max(target - existing_fv, 0) / sip_fv_factor.  Returns 0 if n <= 0 or target met.
    """
    gap = max(target - existing_fv, 0.0)
    if gap <= 0 or n <= 0:
        return 0.0
    return gap / sip_fv_factor(r, n, due, step_up)


def growing_annuity_due_pv(first_payment: float, growth: float, rate: float, n: int) -> float:
    """PV of n payments, first at t=0, growing at `growth`, discounted at `rate`.

    PV = P * (1 - q^n)/(1 - q), q=(1+g)/(1+r); if q == 1, PV = P*n.
    """
    if n <= 0:
        return 0.0
    q = (1.0 + growth) / (1.0 + rate)
    if math.isclose(q, 1.0, abs_tol=1e-12):
        return first_payment * n
    return first_payment * (1.0 - q**n) / (1.0 - q)


def level_annuity_pv(payment: float, rate: float, n: int, due: bool = False) -> float:
    """PV of n equal annual payments (ordinary by default)."""
    if n <= 0:
        return 0.0
    if math.isclose(rate, 0.0, abs_tol=1e-12):
        return payment * n
    pv = payment * (1.0 - (1.0 + rate) ** -n) / rate
    return pv * (1.0 + rate) if due else pv


def retirement_corpus(
    annual_expense_today: float,
    inflation: float,
    years_to_retirement: float,
    post_return: float,
    years_in_retirement: int,
) -> float:
    """Corpus needed at retirement.

    E = annual_expense_today*(1+inflation)^years_to_retirement  (first-year expense)
    corpus = PV at post_return of an inflation-growing annuity-due of E over N years.
    """
    e = inflate(annual_expense_today, inflation, years_to_retirement)
    return growing_annuity_due_pv(e, inflation, post_return, years_in_retirement)


def indian_format(amount: float) -> str:
    """Format as Indian digit grouping, e.g. 1234567 -> '₹12,34,567'."""
    n = int(round(amount))
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) <= 3:
        return f"{sign}₹{s}"
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return f"{sign}₹{','.join(groups)},{tail}"
