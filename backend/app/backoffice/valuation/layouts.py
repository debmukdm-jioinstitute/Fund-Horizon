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
    body = text
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
    if not tot:
        warns.append("Row totals could not be confirmed against the provider.")
    else:  # a row the reader missed shows up as a gap against the provider's own total
        sv, si = sum(h.market_value for h in holdings), sum(h.invested_amount for h in holdings)
        if abs(sv - tot["total_value"]) > max(1.0, 0.0001 * sv) or abs(si - tot["total_invested"]) > max(1.0, 0.0001 * si):
            warns.append(f"Rows read ({len(holdings)}) sum to value {sv:,.2f} / invested {si:,.2f} but the provider total is "
                         f"{tot['total_value']:,.2f} / {tot['total_invested']:,.2f}: a row may be missing.")
    return holdings, tot, warns, []


_TX_WISE_HDR = re.compile(
    r"^\s*(?P<name>.+?)\s+Unrealised\s+Gain\s*/\s*\(Loss\)\s*:\s*₹?\s*(?P<gain>-?[\d,]+(?:\.\d+)?)"
    r"\s*\|\s*Absolute\s+Return\s*:\s*(?P<abs>-?[\d.]+)%"
    r"\s*\|\s*Annualised\s+Return\s*\(XIRR\)\s*:\s*(?P<xirr>-?[\d.]+%?|-)\s*$",
    re.I,
)
_TX_WISE_ROW = re.compile(
    r"^\s*(?P<sno>\d+)\s+(?P<folio>[A-Za-z0-9/\-]+)\s+(?P<inv>[\d,]+(?:\.\d+)?)\s+(?P<date>\d{2}-\d{2}-\d{4})"
    r"\s+(?P<div_reinv>[\d,]+(?:\.\d+)?)\s+(?P<pnav>[\d,]+(?:\.\d+)?)\s+(?P<bal>[\d,]+(?:\.\d+)?)"
    r"\s+(?P<days>\d+)\s+(?P<cnav>[\d,]+(?:\.\d+)?)\s+(?P<val>[\d,]+(?:\.\d+)?)"
    r"\s+(?P<abs>-?[\d.]+)%\s+(?P<xirr>-?[\d.]+%?|-)\s*$"
)
_TX_WISE_SUB = re.compile(
    r"^\s*Sub\s+Total\s+(?P<inv>[\d,]+(?:\.\d+)?)\s+(?P<units>[\d,]+(?:\.\d+)?)\s+(?P<val>[\d,]+(?:\.\d+)?)"
    r"\s+(?P<abs>-?[\d.]+)%\s+(?P<xirr>-?[\d.]+%?|-)\s*$",
    re.I,
)


def transaction_wise_mf(pages: list[str]):
    """'Portfolio Valuation Report - Transaction Wise': per-(scheme, folio) sections with dated purchase rows and Sub Total row,
    plus top KPI banner (INVESTED AMOUNT, CURRENT VALUE, UNREALISED GAIN / (LOSS), ABSOLUTE RETURN, ANNUALISED RETURN (XIRR))."""
    joined = "\n".join(pages)
    if "Transaction Wise" not in joined and not _TX_WISE_HDR.search(joined):
        return [], {}, [], [], [], False
    holdings: list[HoldingRec] = []
    flows: list[ing.FlowRec] = []
    warns: list[str] = []
    tot: dict[str, float | None] = {}

    flat = _clean(" ".join(pages[:2]))
    head = re.search(
        rf"INVESTED AMOUNT ₹({_N}) CURRENT VALUE ₹({_N}) UNREALISED GAIN / \(LOSS\) ₹(-?[\d,]+\.\d\d) "
        rf"ABSOLUTE RETURN ({_PCT}) ANNUALISED RETURN \(XIRR\) ({_PCT})",
        flat,
    )
    if head:
        hv = [ing.to_num(x.rstrip("%")) for x in head.groups()]
        tot["table_total_invested"] = tot["total_invested"] = hv[0]
        tot["table_total_value"] = tot["total_value"] = hv[1]
        tot["reported_unrealised_gain"] = hv[2]
        tot["reported_xirr"] = hv[4]

    cur_sec: dict | None = None
    sections: list[dict] = []
    expected_sno = 1

    for pno, pg in enumerate(pages, 1):
        for lno, raw_ln in enumerate(pg.splitlines(), 1):
            ln = raw_ln.strip()
            if not ln:
                continue
            if m := _TX_WISE_HDR.match(ln):
                xirr_s = m.group("xirr").rstrip("%").strip()
                cur_sec = {
                    "name": _name(m.group("name")),
                    "gain": ing.to_num(m.group("gain")),
                    "abs_ret": ing.to_num(m.group("abs")),
                    "xirr": None if xirr_s == "-" else ing.to_num(xirr_s),
                    "rows": [],
                    "sub": None,
                    "page": f"p{pno}",
                    "line": lno,
                }
                sections.append(cur_sec)
                continue
            if m := _TX_WISE_ROW.match(ln):
                if cur_sec is None:
                    continue
                sno = int(m.group("sno"))
                if sno != expected_sno:
                    warns.append(f"Transaction row S.No jumped from {expected_sno - 1} to {sno} on p{pno}.")
                expected_sno = sno + 1
                xirr_s = m.group("xirr").rstrip("%").strip()
                cur_sec["rows"].append({
                    "sno": sno,
                    "folio": m.group("folio"),
                    "inv": ing.to_num(m.group("inv")) or 0.0,
                    "date": ing.parse_date(m.group("date")),
                    "div_reinv": ing.to_num(m.group("div_reinv")) or 0.0,
                    "pnav": ing.to_num(m.group("pnav")) or 0.0,
                    "bal": ing.to_num(m.group("bal")) or 0.0,
                    "days": int(m.group("days")),
                    "cnav": ing.to_num(m.group("cnav")) or 0.0,
                    "val": ing.to_num(m.group("val")) or 0.0,
                    "abs": ing.to_num(m.group("abs")),
                    "xirr": None if xirr_s == "-" else ing.to_num(xirr_s),
                    "page": f"p{pno}",
                    "line": lno,
                })
                continue
            if m := _TX_WISE_SUB.match(ln):
                if cur_sec is not None:
                    xirr_s = m.group("xirr").rstrip("%").strip()
                    cur_sec["sub"] = {
                        "inv": ing.to_num(m.group("inv")),
                        "units": ing.to_num(m.group("units")),
                        "val": ing.to_num(m.group("val")),
                        "abs": ing.to_num(m.group("abs")),
                        "xirr": None if xirr_s == "-" else ing.to_num(xirr_s),
                    }

    for idx, sec in enumerate(sections, 1):
        rows = sec["rows"]
        if not rows:
            continue
        folio = rows[-1]["folio"]
        sum_inv = round(sum(r["inv"] + r["div_reinv"] for r in rows), 2)
        sum_val = round(sum(r["val"] for r in rows), 2)
        units = rows[-1]["bal"]
        cnav = rows[-1]["cnav"]
        sub = sec["sub"]
        inv = sub["inv"] if sub and sub.get("inv") is not None else sum_inv
        val = sub["val"] if sub and sub.get("val") is not None else sum_val
        h = HoldingRec(
            security_name=sec["name"], account_no=folio, quantity=units, price=cnav,
            market_value=val, invested_amount=inv, unrealised_gain=round(val - inv, 2),
            source_page=sec["page"], source_row=idx,
        )
        h.reported_xirr = sec["xirr"] if sec["xirr"] is not None else (sub["xirr"] if sub else None)
        if sub:
            if abs(sum_inv - (sub["inv"] or 0)) > 0.05 or abs(sum_val - (sub["val"] or 0)) > 0.05:
                h.issues.append(f"Row sum ({sum_inv:,.2f} / {sum_val:,.2f}) differs from Sub Total ({sub['inv']:,.2f} / {sub['val']:,.2f}).")
        for r in rows:
            if r["date"] and (r["inv"] + r["div_reinv"]) > 0:
                flows.append(ing.FlowRec(
                    flow_date=r["date"], kind="deposit", amount=round(r["inv"] + r["div_reinv"], 2),
                    description=f"{sec['name'][:60]} Purchase", account_no=folio,
                    source_page=r["page"], source_row=r["line"],
                ))
        holdings.append(h)

    if holdings and tot.get("total_value") is not None:
        sv = round(sum(h.market_value or 0 for h in holdings), 2)
        si = round(sum(h.invested_amount or 0 for h in holdings), 2)
        if abs(sv - tot["total_value"]) > max(1.0, 0.0001 * sv) or abs(si - tot["total_invested"]) > max(1.0, 0.0001 * si):
            warns.append(
                f"Sections read ({len(holdings)}) sum to value {sv:,.2f} / invested {si:,.2f} "
                f"but the header total is {tot['total_value']:,.2f} / {tot['total_invested']:,.2f}."
            )
        else:
            tot["table_total_invested"] = si
            tot["table_total_value"] = sv
    hints = [(h, "mutual fund") for h in holdings]
    return holdings, tot, warns, hints, flows, bool(holdings and flows)


def folio_date(plain: list[str]) -> str | None:
    """Report date printed under the investor name on a FundsIndia folio-wise or transaction-wise report ('05 Nov 2026')."""
    t = plain[0] if plain else ""
    m = re.search(r"(?:Folio|Transaction) Wise\n.*\n(\d{1,2} [A-Z][a-z]{2} \d{4})\n", t)
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
    n = r"(\d[\d,]*(?:\.\d+)?)"
    row = re.compile(rf"(.+?) {n} {n} {n} {n} {n} (-?[\d,]+(?:\.\d+)?)(?= |$)")
    pos = 0
    while (m := row.match(body, pos)) and not m.group(1).startswith("Total Holdings"):
        name, q, avg, inv, px, val, pnl = m.group(1).strip(), *(float(x.replace(",", "")) for x in m.groups()[1:])
        h = HoldingRec(security_name=name, asset_type="equity", quantity=q, avg_cost=avg, invested_amount=inv, price=px, market_value=val,
                       unrealised_gain=pnl, source_page="6", source_row=len(holdings) + 1)
        if abs(q * px - val) > max(1.0, 0.002 * val):
            h.issues.append(f"quantity x price = {q * px:,.2f} differs from printed value {val:,.2f}.")
        holdings.append(h)
        pos = m.end()
    tot = {}
    if m := re.search(r"Total Holdings Value (-?[\d,]+) (-?[\d,]+) (-?[\d,]+)", body):
        a, b, c = (float(x.replace(",", "")) for x in m.groups())
        tot = {"table_total_invested": a, "total_invested": a, "table_total_value": b, "total_value": b, "reported_unrealised_gain": c}
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


def is_distributor_report(plain: list[str]) -> bool:
    """The report is issued by an AMFI-registered mutual fund distributor (so its MF lines are Regular plans)."""
    return bool(re.search(r"(?i)AMFI Registered Mutual Fund Distributor", "\n".join(plain[:2])))
