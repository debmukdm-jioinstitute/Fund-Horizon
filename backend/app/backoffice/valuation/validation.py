"""Statement-level checks on one extracted statement. Pure functions: no DB, no I/O."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.backoffice.valuation import config as cfg
from app.backoffice.valuation.canonical import ExtractedStatement

NON_OVERRIDABLE = {"file_unreadable"}


@dataclass
class Check:
    code: str
    severity: str                 # error | warning | info
    status: str                   # passed | failed
    message: str
    subject: str = ""
    expected: float | None = None
    actual: float | None = None
    difference: float | None = None

    def fingerprint(self) -> str:
        raw = f"{self.code}|{self.subject}|{self.severity}|{self.expected}|{self.actual}|{self.message}"
        return hashlib.sha256(raw.encode()).hexdigest()


def D(v: float | None) -> Decimal | None:
    return None if v is None else Decimal(str(round(v, 6)))


def within(a: float | Decimal, b: float | Decimal, abs_tol: float | None = None, rel_tol: float | None = None) -> bool:
    """Tolerances are read at call time so FH_VAL_* / config changes apply without re-import."""
    abs_tol = cfg.ABS_TOL if abs_tol is None else abs_tol
    rel_tol = cfg.REL_TOL if rel_tol is None else rel_tol
    a, b = Decimal(str(a)), Decimal(str(b))
    return abs(a - b) <= max(Decimal(str(abs_tol)), Decimal(str(rel_tol)) * max(abs(a), abs(b)))


def _cmp(code, subject, msg, expected, actual, severity="error", abs_tol=None, rel_tol=None) -> Check:
    diff = float(Decimal(str(actual)) - Decimal(str(expected)))
    ok = within(expected, actual, abs_tol, rel_tol)
    return Check(code, severity if not ok else "info", "passed" if ok else "failed",
                 msg if not ok else f"{msg} (within tolerance)", subject, float(expected), float(actual), round(diff, 2))


def holdings_sum(st: ExtractedStatement) -> Decimal:
    return sum((D(h.market_value) or Decimal(0) for h in st.holdings), Decimal(0))


def value_basis(st: ExtractedStatement) -> tuple[str, Decimal | None, Check | None]:
    """How the provider's own total relates to holdings and cash. Cash is added ONLY when the total proves it is separate,
    so cash already inside a provider valuation is never counted twice."""
    hs = holdings_sum(st)
    cash = D(st.totals.get("cash_balance"))
    total = D(st.totals.get("total_value"))
    if total is None and cash in (None, Decimal(0)):
        total = D(st.totals.get("table_total_value"))  # no cash to disambiguate: the printed holdings total is the provider total
    subj = st.filename
    if total is None:
        if cash not in (None, Decimal(0)):
            return "holdings_only_unverified", hs, Check(
                "cash_treatment_unverified", "error", "failed", "Statement shows a cash balance but no total value, so it cannot be "
                "shown whether cash is already inside the holdings. Resolve with a reason (cash excluded from the valuation).",
                subj, None, float(cash), None)
        return "holdings_only_unverified", hs, Check("provider_total_missing", "warning", "failed",
                                                      "No provider total value found; holdings sum is unverified.", subj, None, float(hs), None)
    if within(total, hs):
        return "holdings_only", hs, _cmp("total_value", subj, "Provider total vs sum of holdings", total, hs)
    if cash is not None and within(total, hs + cash):
        return "holdings_plus_cash", hs + cash, _cmp("total_value", subj, "Provider total vs holdings + cash", total, hs + cash)
    return "mismatch", hs, _cmp("total_value", subj, "Provider total does not match extracted holdings" +
                                (" (+ cash)" if cash is not None else ""), total, hs + (cash or Decimal(0)))


def validate_statement(st: ExtractedStatement) -> tuple[list[Check], str, Decimal | None]:
    """Returns (checks, value_basis, closing_value)."""
    out: list[Check] = []
    subj = st.filename
    for e in st.errors:
        out.append(Check("file_unreadable" if st.needs_manual_review else "extraction_error", "error", "failed", e, subj))
    for w in st.warnings:
        out.append(Check("extraction_warning", "warning", "failed", w, subj))
    if st.needs_manual_review:
        return out, "unavailable", None

    if not st.statement_date:
        out.append(Check("missing_statement_date", "error", "failed", "Statement/valuation date not found.", subj))
    else:
        out.append(Check("statement_date", "info", "passed", f"Statement date {st.statement_date}.", subj))

    seen: dict[tuple, int] = {}
    missing = qty_bad = 0
    for h in st.holdings:
        req = [("security_name", h.security_name), ("market_value", h.market_value), ("account_no", h.account_no)]
        gaps = [n for n, v in req if v in (None, "")]
        if gaps:
            missing += 1
            h.validation_status = "error"
            out.append(Check("missing_required_field", "error", "failed",
                             f"{h.security_name[:50] or '(unnamed)'}: missing {', '.join(gaps)} ({h.source_page} row {h.source_row}).", subj))
        if h.asset_type != "cash" and not h.isin:
            h.issues.append("ISIN missing; matching falls back to name within the account.")
            h.validation_status = h.validation_status if h.validation_status == "error" else "warning"
        if h.quantity is not None and h.price is not None and h.market_value is not None:
            exp = D(h.quantity) * D(h.price)
            if not within(exp, h.market_value, cfg.ROW_TOL, cfg.ROW_REL_TOL):
                qty_bad += 1
                h.validation_status = "error"
                out.append(_cmp("qty_price_mismatch", subj, f"{h.security_name[:50]}: quantity x price differs from market value "
                                f"({h.source_page} row {h.source_row})", exp, h.market_value, "error", cfg.ROW_TOL, cfg.ROW_REL_TOL))
        if h.quantity is not None and h.avg_cost is not None and h.invested_amount is not None:
            exp = D(h.quantity) * D(h.avg_cost)
            if not within(exp, h.invested_amount, cfg.ROW_TOL, cfg.ROW_REL_TOL):
                out.append(_cmp("cost_mismatch", subj, f"{h.security_name[:50]}: quantity x average cost differs from invested amount", exp,
                                h.invested_amount, "warning", cfg.ROW_TOL, cfg.ROW_REL_TOL))
        if h.market_value is not None and h.invested_amount is not None and h.unrealised_gain is not None:
            exp = D(h.market_value) - D(h.invested_amount)
            if not within(exp, h.unrealised_gain, cfg.ROW_TOL, cfg.ROW_REL_TOL):
                out.append(_cmp("gain_mismatch", subj, f"{h.security_name[:50]}: reported unrealised gain differs from value - cost", exp,
                                h.unrealised_gain, "warning", cfg.ROW_TOL, cfg.ROW_REL_TOL))
        key = (h.account_no, h.isin or h.security_name.lower(), h.quantity, h.market_value)
        if key in seen:
            h.validation_status = "error"
            out.append(Check("duplicate_row", "error", "failed", f"Duplicate row for '{h.security_name[:50]}' "
                             f"(rows {seen[key]} and {h.source_row}).", subj))
        seen[key] = h.source_row or 0
    if st.holdings and not missing:
        out.append(Check("required_fields", "info", "passed", f"All {len(st.holdings)} holdings have name, value and account.", subj))
    if st.holdings and not qty_bad:
        out.append(Check("qty_price", "info", "passed", "Quantity x price agrees with market value on every row that reports both.", subj))

    basis, closing, c = value_basis(st)
    if c:
        out.append(c)
    tv = D(st.totals.get("table_total_value"))
    if tv is not None:
        out.append(_cmp("table_total", subj, "Printed holdings total vs sum of extracted rows", tv, holdings_sum(st)))
    if st.asset_class == "mutual_fund":
        ti = D(st.totals.get("total_invested") if st.totals.get("total_invested") is not None else st.totals.get("table_total_invested"))
        inv = [D(h.invested_amount) for h in st.holdings]
        if ti is not None and inv and all(v is not None for v in inv):
            out.append(_cmp("invested_total", subj, "Printed invested total vs sum of rows", ti, sum(inv, Decimal(0)), "warning"))
    for k, label in (("unrealised_gain", "unrealised"), ("realised_gain", "realised")):
        rows = [D(getattr(h, k)) for h in st.holdings]
        t = D(st.totals.get(k))
        if t is not None and rows and all(v is not None for v in rows):
            out.append(_cmp(f"{label}_total", subj, f"Printed {label} gain vs sum of rows", t, sum(rows, Decimal(0)), "warning"))
    if st.asset_class == "pms" and not st.flows:
        out.append(Check("flows_missing", "warning", "failed", "No cash flows extracted: XIRR and Modified Dietz are unavailable for this account.", subj))
    if st.statement_date and st.period_start and st.period_start > st.statement_date:
        out.append(Check("period_order", "error", "failed", "Period start is after the statement date.", subj))
    try:
        if st.statement_date:
            date.fromisoformat(st.statement_date)
    except ValueError:
        out.append(Check("bad_date", "error", "failed", f"Invalid statement date {st.statement_date}.", subj))
    return out, basis, closing
