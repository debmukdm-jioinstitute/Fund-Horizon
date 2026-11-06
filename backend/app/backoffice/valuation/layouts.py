"""Readers for statement layouts seen on REAL files (FundsIndia folio-wise valuation, PMS factsheet 'Portfolio Summary',
distributor direct-equity page, distributor dashboard). Every reader returns nothing when its layout is absent and never
fills a missing value. Figures printed by the provider (XIRR, totals) are kept as ``reported_*`` and labelled as such."""
from __future__ import annotations

import re

from app.backoffice.valuation import ingestion as ing
from app.backoffice.valuation.canonical import HoldingRec

_N = r"-?[\d,]+\.\d\d"
_PCT = r"-?[\d.]+%"
_ROW_TAIL = rf" (.+?) ([\d/]{{4,}}) ((?:{_N} ){{6}}{_N}) ({_PCT}) ({_PCT}) ({_PCT})"
_DATE = r"(\d{1,2}[/-]\d{1,2}[/-]\d{4})"


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _name(s: str) -> str:
    """pypdf drops the space at a wrapped cell boundary ('SaverFund'); restore it at lower->Upper and UPPER->Upper+lower joins."""
    return re.sub(r"(?<=[a-z])(?=[A-Z][a-z])|(?<=[A-Z])(?=[A-Z][a-z])(?<![A-Z]{2}(?=[a-z]))", " ", _clean(s))


def folio_wise_mf(pages: list[str]):
    """FundsIndia 'Portfolio Valuation Report - Folio Wise'. Row: S.No, name (may wrap), folio, 7 money columns
    (invested, investments, div reinvested, div payout, units, NAV, value), weight %, absolute %, XIRR %."""
    text = _clean(" ".join(pages))
    if "Folio Wise" not in text:
        return [], {}, [], []
    body = re.sub(r"S\. No Fund Name.*?Annualised Return \(%\)", " ", text)  # repeated table headers
    body = re.sub(r"Portfolio Valuation Report - Folio Wise \|[^|]*\|[^N]*?\d{4}", " ", body)
    holdings, warns, expected, pos = [], [], 1, 0
    while m := re.compile(rf"(?<![\d,.]){expected}{_ROW_TAIL}", re.S).search(body, pos):  # rows are numbered 1..n: anchors on S.No
        expected += 1
        pos = m.end()
        inv, _a, _b, _payout, units, nav, val = (ing.to_num(x) for x in m.group(3).split())
        h = HoldingRec(security_name=_name(m.group(1)), account_no=m.group(2), quantity=units, price=nav, market_value=val,
                       invested_amount=inv, source_page="1-2", source_row=len(holdings) + 1)
        h.unrealised_gain = round(val - inv, 2)
        # every printed per-row figure that can be recomputed is recomputed; a mismatch is flagged on the row, not hidden
        if abs(units * nav - val) > max(1.0, 0.002 * val):
            h.issues.append(f"units x NAV = {units * nav:,.2f} differs from printed value {val:,.2f}.")
        pa = ing.to_num(m.group(5).rstrip("%"))
        if inv and pa is not None and abs((val / inv - 1) * 100 - pa) > 0.02:
            h.issues.append(f"printed absolute return {pa}% differs from recomputed {(val / inv - 1) * 100:.2f}%.")
        h.reported_xirr = ing.to_num(m.group(6).rstrip("%"))
        holdings.append(h)
    if not holdings:
        return [], {}, ["Folio-wise layout recognised but no rows could be read."], []
    tot: dict[str, float | None] = {}
    if g := re.search(rf"Grand Total ({_N}) ({_N}) ({_N}) ({_N}) ({_N}) ({_PCT}) ({_PCT}) ({_PCT})", body):
        tot["table_total_invested"], tot["table_total_value"] = ing.to_num(g.group(1)), ing.to_num(g.group(5))
        tot["total_invested"], tot["total_value"] = tot["table_total_invested"], tot["table_total_value"]
        tot["reported_xirr"] = ing.to_num(g.group(8).rstrip("%"))
    elif holdings:
        warns.append("Grand Total row not found: row sum cannot be checked against the provider.")
    head = re.search(rf"INVESTED AMOUNT ₹({_N}) CURRENT VALUE ₹({_N}) UNREALISED GAIN / \(LOSS\) ₹(-?[\d,]+\.\d\d) ABSOLUTE RETURN ({_PCT}) "
                     rf"ANNUALISED RETURN \(XIRR\) ({_PCT})", text)
    if head:
        hv = [ing.to_num(x.rstrip("%")) for x in head.groups()]
        if tot and (abs(hv[0] - tot["total_invested"]) > 1 or abs(hv[1] - tot["total_value"]) > 1):
            warns.append("Report header totals differ from the Grand Total row.")
        tot.setdefault("reported_xirr", hv[4])
        tot["reported_unrealised_gain"] = hv[2]
    if (n := expected - 1) != len(holdings) or not tot:
        warns.append("Row count / totals could not be confirmed.")
    return holdings, tot, warns, []


def folio_date(plain: list[str]) -> str | None:
    """Report date printed under the investor name on a FundsIndia folio-wise report ('05 Nov 2026')."""
    t = plain[0] if plain else ""
    m = re.search(r"Folio Wise\n.*\n(\d{1,2} [A-Z][a-z]{2} \d{4})\n", t)
    return ing.parse_date(m.group(1)) if m else None


def pms_summary(pages: list[str]) -> dict:
    """PMS factsheet 'Portfolio Summary': contribution, withdrawal, profit/loss, value, strategy IRR since inception."""
    t = "\n".join(pages)
    out: dict = {}
    if m := re.search(r"Strategy:\s*(.+)", t):
        out["strategy"] = m.group(1).strip()
    if m := re.search(r"Account:\s*([A-Za-z0-9\- ]+?)\s*-\s*([A-Z][A-Z ]+)", t):
        out["account_no"] = m.group(1).split(" - ")[0].strip()
    if m := re.search(rf"Inception Date:\s*{_DATE}", t):
        out["inception"] = ing.parse_date(m.group(1))
    nums = re.search(r"Contribution\s*\nWithdrawal\s*\nProfit/Loss\s*\nPortfolio Value\([^)]*\)\s*\n([\d,]+)\s*\n(-?[\d,]+)\s*\n(-?[\d,]+)\s*\n([\d,]+)", t)
    if nums:
        c, w, p, v = (ing.to_num(x) for x in nums.groups())
        out.update(contribution=c, withdrawal=w, profit=p, value=v)
        out["identity_gap"] = round(c - w + p - v, 2)  # contribution - withdrawal + profit must equal value (rounding only)
    if m := re.search(r"Portfolio\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*\n\s*BSE 500 TRI", t):
        out["irr_since_inception"] = float(m.group(4))
    return out


def direct_equity(pages: list[str]):
    """Distributor 'Script Name / Quantity / Avg Unit Cost / Invested / Price / Value / P&L' page."""
    t = _clean(" ".join(pages))
    if "Script Name" not in t or "Avg Unit Cost" not in t:
        return [], {}, "", None
    body = t.split("Unrealized P&L", 1)[-1]
    holdings = []
    row = re.compile(r"(.+?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)(?= |$)")
    pos = 0
    while (m := row.match(body, pos)) and not m.group(1).startswith("Total Holdings"):
        name, q, avg, inv, px, val, pnl = m.group(1).strip(), *(float(x) for x in m.groups()[1:])
        h = HoldingRec(security_name=name, asset_type="equity", quantity=q, avg_cost=avg, invested_amount=inv, price=px, market_value=val,
                       unrealised_gain=pnl, source_page="6", source_row=len(holdings) + 1)
        if abs(q * px - val) > max(1.0, 0.002 * val):
            h.issues.append(f"quantity x price = {q * px:,.2f} differs from printed value {val:,.2f}.")
        holdings.append(h)
        pos = m.end()
    tot = {}
    if m := re.search(r"Total Holdings Value (-?\d+) (-?\d+) (-?\d+)", body):
        tot = {"table_total_invested": float(m.group(1)), "total_invested": float(m.group(1)),
               "table_total_value": float(m.group(2)), "total_value": float(m.group(2)), "reported_unrealised_gain": float(m.group(3))}
    d = re.search(r"Holding Date " + _DATE, t)
    return holdings, tot, ing.parse_date(d.group(1)) if d else None, None


def dashboard(pages: list[str]) -> dict:
    """Distributor 'FY ANNUAL - DASHBOARD' page: provider-reported XIRR (client level) and per-year values."""
    t = "\n".join(pages)
    if "FY ANNUAL - DASHBOARD" not in t:
        return {}
    out: dict = {}
    for k, rx in (("since_inception_xirr", r"Since Inception\s+(-?[\d.]+)\s*\n"), ("net_investment", r"Net Investment:\s*(-?\d+)"),
                  ("from", r"From Period\s*:\s*" + _DATE), ("to", r"To Period\s*:\s*" + _DATE)):
        if m := re.search(rx, t):
            out[k] = m.group(1)
    if m := re.search(r"Since Inception\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)", t):
        out["xirr_by_class"] = dict(zip(("portfolio", "mf", "pms", "stock"), map(float, m.groups())))
    if m := re.findall(r"FY (\d{4}-\d{2}) (\d+) (-?\d+|-) (-?[\d.]+|-)\n", t):
        out["years"] = [{"fy": a, "value": int(b), "new_investment": None if c == "-" else int(c), "xirr": None if d == "-" else float(d)}
                        for a, b, c, d in m]
    for k in ("from", "to"):
        if k in out:
            out[k] = ing.parse_date(out[k])
    return out


_CASH_ROW = re.compile(r"(?i)^(cash\b|dividend\s*/\s*interest receivable)")


def enrich_pms(st, plain: list[str]) -> None:
    """Apply a PMS factsheet 'Portfolio Summary' to a statement: net capital, provider totals, reported IRR, identity check."""
    ps = pms_summary(plain)
    if not ps or "value" not in ps:
        return
    st.reported["pms"] = ps
    net = ps["contribution"] - ps["withdrawal"]
    st.totals.update(total_invested=net, total_value=ps["value"], reported_unrealised_gain=ps["profit"])  # overrides row-scan guesses
    if ps.get("account_no"):
        st.account_no = ps["account_no"]
    if abs(ps["identity_gap"]) > 2:
        st.errors.append(f"Contribution - withdrawal + profit = {net + ps['profit']:,.0f} but printed portfolio value is {ps['value']:,.0f}.")
    equity_factsheet = "Sector Allocation" in "\n".join(plain)  # factsheet lists equity sectors; debt/other would be shown by name
    for h in st.holdings:
        if _CASH_ROW.match(h.security_name):
            h.issues.append("asset_type_hint:cash")
        elif equity_factsheet:
            h.issues.append("asset_type_hint:equity")
