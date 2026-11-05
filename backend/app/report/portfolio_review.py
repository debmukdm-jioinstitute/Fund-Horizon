from __future__ import annotations
"""Client "Portfolio Review" deck (16:9 PDF): holdings, live Fund Horizon view, stress test, recommendations.
Google Sans only (see CLAUDE.md). Pure rendering: the API layer supplies holdings and live fund data."""

import io
import textwrap
from datetime import datetime
from zoneinfo import ZoneInfo

import matplotlib
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

from app.config.disclosures import ARN, FIRM  # noqa: E402
from app.report import fonts  # noqa: E402,F401  (registers Google Sans with matplotlib)

NAVY, GREEN, RED, AMBER, LIGHT, GREY, LINE, INK = "#1B2A6B", "#2E9E44", "#C0392B", "#B7791F", "#F2F4F8", "#555555", "#DDDDDD", "#222222"
W, H = 1333, 750
MINUS = "−"
BUCKETS = {"flexi_cap": "Flexi, multi & large-mid cap", "multi_cap": "Flexi, multi & large-mid cap", "large_mid_cap": "Flexi, multi & large-mid cap",
           "elss": "Flexi, multi & large-mid cap", "mid_cap": "Mid cap", "small_cap": "Small cap", "large_cap": "Large cap",
           "gold": "Gold & silver", "sectoral_thematic": "Sector funds"}
SIGNAL_COL = {"Buy": GREEN, "Hold": AMBER, "Sell": RED, "Needs review": RED}
STRESS_WINDOWS = {"covid": ("2020-01-01", "2020-04-30", "Repeat of Covid crash (Jan to Mar 2020)"),
                  "fall2425": ("2024-09-01", "2025-03-31", "Repeat of 2024-25 fall (Sep 2024 to Feb 2025)")}


_GLYPHS = None


def _clean(v):
    """Replace/drop any character Google Sans lacks (a fallback font would break the typeface rule): double dagger becomes '*'."""
    global _GLYPHS
    if isinstance(v, str):
        _GLYPHS = _GLYPHS or matplotlib.ft2font.FT2Font(str(fonts.REGULAR_TTF))
        return "".join(c for c in v.replace("\u2021", "*") if c in "\n\t" or _GLYPHS.get_char_index(ord(c)))
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    return [_clean(x) for x in v] if isinstance(v, list) else v


def inr(n: float) -> str:
    d = f"{abs(int(round(n)))}"
    if len(d) <= 3:
        return d
    head, tail, parts = d[:-3], d[-3:], []
    while len(head) > 2:
        parts.insert(0, head[-2:]); head = head[:-2]
    return ",".join(([head] if head else []) + parts + [tail])


def rs(n: float, sign: bool = False) -> str:
    return (("+" if n >= 0 else MINUS) if sign else ("" if n >= 0 else MINUS)) + f"₹{inr(n)}"


def pc(x: float | None, d: int = 2, sign: bool = True) -> str:
    if x is None:
        return "-"
    return (("+" if x >= 0 else MINUS) if sign else ("" if x >= 0 else MINUS)) + f"{abs(x):.{d}f}%"


def col(x: float) -> str:
    return GREEN if x >= 0 else RED


def wrap(t: str, n: int) -> str:
    return "\n".join(textwrap.fill(x, n) for x in t.split("\n"))


def window_fall(nav, start: str, end: str) -> float | None:
    """Fund's own peak-to-trough fall (%) inside a window of its month-end NAVs; None if it did not exist then."""
    if nav is None or len(nav) < 2 or nav.index[0] > pd.Timestamp(start):
        return None
    s = nav.loc[start:end]
    return round(float((s / s.cummax() - 1).min() * 100), 1) if len(s) >= 2 else None


class _Deck:
    def __init__(self, buf: io.BytesIO, foot: str):
        self.pdf, self.foot, self.n = PdfPages(buf), foot, 0

    def page(self, dark: bool = False):
        fig = plt.figure(figsize=(13.33, 7.5), dpi=100)
        ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(H, 0); ax.axis("off")
        fig.patch.set_facecolor(NAVY if dark else "white")
        self.n += 1
        if not dark:
            ax.text(60, 716, self.foot, fontsize=8.5, color=GREY, va="center"); ax.text(1273, 713, str(self.n), fontsize=10, color=GREY, ha="right", va="center")
        return fig, ax

    def save(self, fig):
        self.pdf.savefig(fig); plt.close(fig)


def _title(ax, t):
    ax.text(60, 80, t, fontsize=25, fontweight="bold", color=NAVY, va="center")


def _note(ax, t, y=678):
    ax.text(60, y, wrap(t, 190), fontsize=9.5, color=GREY, va="top")


def _card(ax, x, y, w, h, big, small, bigcol=NAVY, size=26):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=14", fc=LIGHT, ec="none"))
    ax.text(x + 24, y + 38, big, fontsize=size, fontweight="bold", color=bigcol, va="center")
    ax.text(x + 24, y + 78, small, fontsize=11, color=INK, va="top", linespacing=1.4)


def _table(ax, x, y, cols, rows, widths, rh=33, fs=10.5, colors=None, aligns=None, fills=None, hh=32):
    cx = [x]
    for w in widths:
        cx.append(cx[-1] + w)
    al = aligns or ["l"] * len(cols)
    pos = lambda i, a: cx[i] + 8 if a == "l" else (cx[i + 1] - 8 if a == "r" else (cx[i] + cx[i + 1]) / 2)  # noqa: E731
    ha = {"l": "left", "r": "right", "c": "center"}
    ax.add_patch(Rectangle((x, y), sum(widths), hh, fc=NAVY, ec="white"))
    for i, c in enumerate(cols):
        ax.text(pos(i, al[i]), y + hh / 2, c, color="white", fontsize=fs, fontweight="bold", va="center", ha=ha[al[i]], linespacing=1.1)
    for r, row in enumerate(rows):
        yy = y + hh + r * rh
        for i, v in enumerate(row):
            fill = (fills[r][i] if fills and fills[r][i] else "white")
            ax.add_patch(Rectangle((cx[i], yy), widths[i], rh, fc=fill, ec=LINE, lw=0.8))
            ax.text(pos(i, al[i]), yy + rh / 2, v, fontsize=fs, color=(colors[r][i] if colors and colors[r][i] else INK), va="center", ha=ha[al[i]])


def _hbar(fig, rect, labels, vals, colors, fmt, xlabel, fs=8.5):
    a = fig.add_axes(rect)
    a.barh(range(len(vals)), vals, color=colors, height=0.68)
    a.set_yticks(range(len(vals))); a.set_yticklabels(labels, fontsize=fs); a.invert_yaxis()
    a.axvline(0, color="#444", lw=0.8); a.grid(axis="x", color="#eee"); a.set_axisbelow(True)
    for s in ("top", "right"):
        a.spines[s].set_visible(False)
    span = max([abs(v) for v in vals] + [1e-9])
    for i, v in enumerate(vals):
        a.text(v + (span * 0.01 if v >= 0 else -span * 0.01), i, fmt(v), va="center", ha="left" if v >= 0 else "right", fontsize=fs - 0.5, fontweight="bold")
    a.set_xlim(min(0, min(vals)) - span * 0.18, max(0, max(vals)) + span * 0.18); a.set_xlabel(xlabel, fontsize=9); a.tick_params(axis="x", labelsize=8)


def build_portfolio_review(d: dict, live: dict[str, dict]) -> bytes:
    """d = {client:{name,date}, holdings:[{code,name,invested,value,typ,period,inst,ret,flag}], compare:{...}|None, fetched_at}.
    live[code] = screener-row fields + 'falls'. Funds without live data render '-' (never estimated)."""
    d, live = _clean(d), _clean(live)
    cl, cmp_ = d["client"], d.get("compare") or {}
    ist = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y, %H:%M IST")
    hold = []
    for h in d["holdings"]:
        lv = live.get(h["code"], {})
        ret = h.get("ret")
        hold.append({**h, "name": h.get("name") or lv.get("name") or h["code"], "typ": h.get("typ") or lv.get("cat_label") or "",
                     "ret": ret if ret is not None else ((h["value"] / h["invested"] - 1) * 100 if h["invested"] else 0.0),
                     "ret_is_abs": ret is None, "bucket": BUCKETS.get(lv.get("cat"), "Other"), "flag": h.get("flag", ""), "lv": lv})
    inv, val = sum(h["invested"] for h in hold), sum(h["value"] for h in hold)
    xirr = cmp_.get("portfolio_xirr")
    pf = cmp_.get("per_fund") or {}
    for h in hold:
        h["v500"], h["v500rs"] = (pf.get(h["code"]) or {}).get("pct"), (pf.get(h["code"]) or {}).get("inr")
    navd = [h["lv"]["nav_date"] for h in hold if h["lv"].get("nav_date")]
    foot = f"{cl['name']}  ·  Valuation as on {cl['date']}  ·  Live fund data as on {max(navd) if navd else 'n/a'}  ·  Generated {ist}"
    buf = io.BytesIO(); dk = _Deck(buf, foot)

    f, a = dk.page(True)
    a.text(80, 300, "Portfolio Review", fontsize=48, fontweight="bold", color="white", va="center")
    a.text(80, 381, cl["name"], fontsize=26, color="white", va="center")
    a.text(80, 438, f"Your portfolio vs the market  ·  Valuation as on {cl['date']}", fontsize=17, color="#6DBF4B", va="center")
    a.text(80, 478, f"Live fund data refreshed {ist}", fontsize=12, color="#B8C0E0", va="center")
    dk.save(f)

    gain = val - inv
    f, a = dk.page(); _title(a, f"₹{inv/1e5:.2f} L invested is now ₹{val/1e5:.2f} L" + (f": {xirr:.2f}% a year" if xirr is not None else f": {pc(gain/inv*100 if inv else 0)}"))
    _card(a, 60, 150, 282, 160, f"₹{inr(inv)}", f"invested in {len(hold)} funds")
    _card(a, 370, 150, 282, 160, f"₹{inr(val)}", f"value today · gain\n{rs(gain, True)} ({pc(gain/inv*100 if inv else 0)})")
    if xirr is not None:
        _card(a, 681, 150, 282, 160, f"{xirr:.2f}%", f"your return (XIRR, % a year)\n· Nifty 500 TRI {cmp_.get('nifty500_xirr', 0):.2f}%", GREEN)
        _card(a, 991, 150, 282, 160, rs(cmp_.get("ahead_inr_500", 0), True), "vs the same instalments\nin the Nifty 500 TRI", col(cmp_.get("ahead_inr_500", 0)))
    else:
        _card(a, 681, 150, 282, 160, pc(gain / inv * 100 if inv else 0), "absolute return (not annualised;\nXIRR needs instalment dates)", col(gain))
        _card(a, 991, 150, 282, 160, f"{sum(1 for h in hold if h['ret'] >= 0)} of {len(hold)}", "funds with a positive return", GREEN)
    bk: dict[str, float] = {}
    for h in hold:
        bk[h["bucket"]] = bk.get(h["bucket"], 0) + h["value"]
    order = sorted(bk.items(), key=lambda kv: -kv[1])
    a.text(420, 352, "Where the money is today (₹ lakh)", fontsize=13, ha="center")
    _hbar(f, [0.30, 0.13, 0.30, 0.36], [k for k, _ in order], [v / 1e5 for _, v in order], [NAVY] * len(order), lambda v: f"₹{v:.1f} L", "", fs=10.5)
    a.add_patch(FancyBboxPatch((820, 340), 453, 340, boxstyle="round,pad=0,rounding_size=14", fc=LIGHT, ec="none"))
    a.text(845, 375, "In short", fontsize=17, fontweight="bold", color=NAVY, va="center")
    best, worst = max(hold, key=lambda h: h["ret"]), min(hold, key=lambda h: h["ret"])
    a.text(845, 400, wrap(f"Largest holding: {max(hold, key=lambda h: h['value'])['name']}.\n\nBest return: {best['name']} ({pc(best['ret'])}).\n\nWeakest return: {worst['name']} ({pc(worst['ret'])}).", 44), fontsize=12.5, va="top", linespacing=1.45, color=INK)
    dk.save(f)

    def hold_pages():
        chunks = [hold[i:i + 13] for i in range(0, len(hold), 13)]
        if len(chunks) > 1 and len(chunks[-1]) > 13:
            chunks.append([])
        for i, ch in enumerate(chunks, 1):
            last = i == len(chunks)
            f, a = dk.page(); _title(a, f"Your holdings ({i} of {len(chunks)}): when you invested and what it is worth")
            rws = [[h["name"] + (f" {h['flag']}" if h["flag"] else ""), h["typ"], h.get("period", ""), str(h.get("inst", "")), f"₹{inr(h['invested'])}", f"₹{inr(h['value'])}", pc(h["ret"])] for h in ch]
            cls = [[None] * 6 + [col(h["ret"])] for h in ch]; fl = [[None] * 7 for _ in rws]
            if last:
                rws.append(["Total portfolio", "", "", "", f"₹{inr(inv)}", f"₹{inr(val)}", pc(xirr if xirr is not None else (gain / inv * 100 if inv else 0))])
                cls.append([None] * 6 + [col(gain)]); fl.append([LIGHT] * 7)
            _table(a, 60, 140, ["Fund", "Type", "Period", "Instal.", "Invested", "Value today", "Return"], rws, [310, 200, 235, 85, 135, 135, 113], colors=cls, aligns=["l", "l", "c", "c", "r", "r", "r"], fills=fl)
            _note(a, "Return: XIRR % a year where supplied, otherwise absolute return since investment. † under one year. * estimated (held via another distributor).")
            dk.save(f)
    hold_pages()

    if cmp_ and pf:
        f, a = dk.page(); _title(a, "Ahead of the Nifty 50 and the Nifty 500 TRI" if (cmp_.get("ahead_inr_500", 0) > 0) else "Against the Nifty 50 and the Nifty 500 TRI")
        a.text(480, 165, "XIRR on the same instalments, % a year", fontsize=13, ha="center")
        _hbar(f, [0.145, 0.16, 0.5, 0.37], ["Your portfolio", "Nifty 50", "Nifty 500 TRI"], [xirr or 0, cmp_.get("nifty50_xirr", 0), cmp_.get("nifty500_xirr", 0)], [GREEN, NAVY, NAVY], lambda v: f"{v:.2f}%", "", fs=12)
        for i, (big, sm) in enumerate([(rs(cmp_.get("ahead_inr_500", 0), True), "vs the same instalments in the Nifty 500 TRI"), (rs(cmp_.get("ahead_inr_50", 0), True), "vs the same instalments in the Nifty 50"),
                                       (pc((xirr or 0) - cmp_.get("nifty500_xirr", 0)) + " a year", "vs the Nifty 500 TRI")]):
            _card(a, 840, 145 + i * 150, 433, 135, big, sm, GREEN if big.startswith("+") else RED, 28)
        _note(a, "Each instalment notionally invested in each index on the same date. Index data: index-fund NAVs (AMFI).")
        dk.save(f)
        L = sorted([h for h in hold if h["v500"] is not None], key=lambda h: -h["v500"])
        f, a = dk.page(); _title(a, f"{sum(1 for h in L if h['v500'] > 0)} of {len(L)} funds are ahead of the Nifty 500 TRI")
        _hbar(f, [0.17, 0.17, 0.36, 0.65], [h["name"] for h in L], [h["v500"] for h in L], [col(h["v500"]) for h in L], lambda v: f"{'+' if v >= 0 else MINUS}{abs(v):.1f}%", "Your return minus the Nifty 500 TRI on the same instalments (%)", fs=7.5)
        _card(a, 760, 140, 513, 120, f"{cmp_.get('funds_ahead_50', 0)} of {len(L)}", "funds ahead of the Nifty 50", NAVY, 30)
        _card(a, 760, 280, 513, 120, pc(L[0]["v500"], 1), f"best: {L[0]['name']}", GREEN, 30)
        _card(a, 760, 420, 513, 120, pc(L[-1]["v500"], 1), f"worst: {L[-1]['name']}", col(L[-1]["v500"]), 30)
        dk.save(f)
        R = sorted([h for h in L if h["v500rs"] is not None], key=lambda h: -h["v500rs"])
        if R:
            f, a = dk.page(); _title(a, f"In rupees: {rs(cmp_.get('ahead_inr_500', 0), True)} vs the Nifty 500 TRI")
            _hbar(f, [0.17, 0.17, 0.36, 0.65], [h["name"] for h in R], [h["v500rs"] / 1e5 for h in R], [col(h["v500rs"]) for h in R], lambda v: rs(v * 1e5, True), "₹ more (+) or less (−) than the same instalments in the Nifty 500 TRI (₹ lakh)", fs=7.5)
            top, bot = R[:4], [h for h in R[-3:][::-1] if h["v500rs"] < 0]
            rws = [[h["name"], rs(h["v500rs"], True)] for h in top] + ([["Biggest drags", ""]] + [[h["name"], rs(h["v500rs"], True)] for h in bot] if bot else [])
            cls = [[None, GREEN]] * len(top) + ([["white", "white"]] + [[None, RED]] * len(bot) if bot else [])
            fl = [[None, None]] * len(top) + ([[NAVY, NAVY]] + [[None, None]] * len(bot) if bot else [])
            _table(a, 760, 150, ["Biggest contributors", "vs Nifty 500"], rws, [330, 183], rh=40, hh=40, aligns=["l", "r"], colors=cls, fills=fl)
            dk.save(f)
        if cmp_.get("index_rows"):
            f, a = dk.page(); _title(a, "Against the matching Nifty index")
            rows = cmp_["index_rows"][:12]
            _table(a, 60, 140, ["Fund", "Nifty index", "Period", "Your return", "Index", "Lead", "₹ vs index"],
                   [[r["name"], r["index"], r["period"], pc(r["ret"]), pc(r["idx"]), pc(r["lead"], 1), rs(r["inr"], True)] for r in rows], [300, 175, 235, 150, 120, 120, 133], rh=40,
                   colors=[[None] * 5 + [col(r["lead"]), col(r["inr"])] for r in rows], aligns=["l", "l", "c", "r", "r", "r", "r"])
            _note(a, "Same instalments, same dates, against the matching Nifty TRI.", 660)
            dk.save(f)

    def lv_pages(title, field_rows, header, widths, notes, key, fmt_row):
        rows = [h for h in hold if h["lv"].get(key) is not None]
        for i in range(0, len(rows), 15):
            f, a = dk.page(); _title(a, title + ("" if len(rows) <= 15 else f" ({i // 15 + 1})"))
            rr = [fmt_row(h) for h in rows[i:i + 15]]
            _table(a, 60, 140, header, [r[0] for r in rr], widths, rh=33, aligns=["l"] + ["c"] * (len(header) - 1), colors=[r[1] for r in rr], fills=[r[2] for r in rr])
            _note(a, notes, 678)
            dk.save(f)

    def cap_row(h):
        lv = h["lv"]; up, dn, ra = lv["cap_up_3y"], lv["cap_down_3y"], lv.get("cap_ratio_3y")
        return ([h["name"], pc(lv.get("cagr_3y"), 2, False), f"{up:.0f}%", f"{dn:.0f}%", f"{ra:.2f}" if ra is not None else "-"],
                [None, col(lv.get("cagr_3y") or 0), GREEN if up > 100 else RED, GREEN if dn < 100 else RED, GREEN if (ra or 0) >= 1 else RED],
                [None] * 4 + ["#E3F2E3" if (ra or 0) >= 1 else "#FBE5E5"])
    lv_pages("Rising and falling markets: capture ratios", None, ["Fund", "3-yr CAGR", "Up-market capture", "Down-market\ncapture", "Capture ratio"], [420, 200, 220, 215, 158],
             "Last 3 years, Fund Horizon capture-ratio engine. Up capture > 100% and down capture < 100% are good; ratio (up / down) > 1 is good. Funds under 3 years old are not shown.", "cap_up_3y", cap_row)

    def dd_row(h):
        lv = h["lv"]
        return ([h["name"], pc(lv.get("max_dd_3y"), 1, False) if lv.get("max_dd_3y") is not None else "-", pc(lv.get("max_dd_all"), 1, False) if lv.get("max_dd_all") is not None else "-", f"{lv['history_years']:.1f} yrs" if lv.get("history_years") else "-"],
                [None, RED, RED, None], [None] * 4)
    lv_pages("Worst falls: last 3 years and full history", None, ["Fund", "Worst fall, last 3 yrs", "Worst fall, full history", "History"], [430, 280, 280, 223],
             "Maximum drawdown = largest fall from a previous high, from Fund Horizon's NAV history (live).", "max_dd_all", dd_row)

    f, a = dk.page(); _title(a, "Fund Horizon view on each fund (live)")
    fh_rows = sorted(hold, key=lambda h: -h["value"])
    for i in range(0, len(fh_rows), 13):
        if i:
            f, a = dk.page(); _title(a, "Fund Horizon view on each fund (live, continued)")
        ch = fh_rows[i:i + 13]; rws, cls = [], []
        for h in ch:
            lv = h["lv"]; sig = lv.get("fh_signal") or ("Not in FH universe" if not lv else ("Data excluded" if lv.get("reason") else "Not scored"))
            rws.append([h["name"], f"₹{inr(h['value'])}", f"{lv['fh_score']:.1f}" if lv.get("fh_score") is not None else "-", sig, "Yes" if lv.get("recommended") else "-", lv.get("nav_date") or "-", (lv.get("reason") or "")[:95]])
            cls.append([None] * 3 + [SIGNAL_COL.get(sig, GREY), None, None, GREY])
        _table(a, 60, 140, ["Fund", "Value", "FH score", "FH signal", "FH list", "NAV as of", "Basis"], rws, [235, 105, 80, 110, 70, 90, 543], rh=36, fs=9.5, aligns=["l", "r", "c", "c", "c", "c", "l"], colors=cls)
        _note(a, "FH score and signal from the Fund Horizon screener (live; refreshed every 6 hours). Research data, not personalised advice.", 690)
        dk.save(f)

    f, a = dk.page(); _title(a, "What we would look at: portfolio recommendations")
    def share(b): return sum(h["value"] for h in hold if h["bucket"] == b)
    sells = [h for h in hold if h["lv"].get("fh_signal") == "Sell"]; review = [h for h in hold if h["lv"].get("fh_signal") == "Needs review"]
    recs = []
    if sells:
        recs.append(("Review the FH 'Sell' signals", f"{', '.join(h['name'] for h in sells)}: live signal is Sell (below category on 3-yr CAGR / risk-adjusted metrics)." +
                     (" " + ", ".join(h["name"] for h in sells if h["lv"].get("recommended")) + " is also on the FH recommended list: needs an investment-committee decision." if any(h["lv"].get("recommended") for h in sells) else "")))
    if review:
        recs.append(("Funds with thin data", f"{', '.join(h['name'] for h in review)}: FH signal is 'Needs review' (data coverage below the scoring minimum). Do not add until reviewed."))
    for b, label in (("Gold & silver", "Gold & silver allocation"), ("Small cap", "Small-cap concentration"), ("Sector funds", "Sector funds are a satellite")):
        n, v = sum(1 for h in hold if h["bucket"] == b), share(b)
        if n and v / val > (0.05 if b != "Small cap" else 0.10):
            recs.append((label, f"{n} fund(s) hold ₹{v/1e5:.1f} L ({v/val*100:.1f}% of the portfolio). " + ("Confirm a target allocation before adding." if b != "Small cap" else "Consider consolidating similar mandates (check overlap).")))
    new = [h for h in hold if h["flag"] == "†"]
    if new:
        recs.append(("Recent money is still new", f"{len(new)} holding(s) are under one year old; judge on a 3-year view and review in a year."))
    if not recs:
        recs.append(("No flags", "No Sell or Needs-review signals and no concentration flags in the live data."))
    for i, (h_, t_) in enumerate(recs[:5]):
        y = 140 + i * 105
        a.add_patch(FancyBboxPatch((60, y), 1213, 90, boxstyle="round,pad=0,rounding_size=12", fc=LIGHT, ec="none"))
        a.text(85, y + 28, h_, fontsize=15, fontweight="bold", color=NAVY, va="center"); a.text(85, y + 55, wrap(t_, 150), fontsize=11, color=INK, va="center")
    _note(a, "Rule-based observations from the portfolio and Fund Horizon live data. Research data, not personalised investment advice; adviser suitability review required.", 690)
    dk.save(f)

    f, a = dk.page(); _title(a, "Stress test: what if markets fall again?")
    rws = []
    for k, (_, _, label) in STRESS_WINDOWS.items():
        cov = [h for h in hold if (h["lv"].get("falls") or {}).get(k) is not None]
        c = sum(h["value"] for h in cov); loss = sum(h["value"] * h["lv"]["falls"][k] / 100 for h in cov)
        rws.append([label + ", each fund's own fall", f"{c/val*100:.0f}%" if val else "-", rs(loss) if cov else "-", pc(loss / c * 100, 1) if c else "-"])
    eq = val - share("Gold & silver")
    for sh in (10, 20, 30):
        rws.append([f"All equity funds fall {sh}% (parametric; gold & silver unchanged)", "equity", rs(-eq * sh / 100), f"{MINUS}{sh:.1f}%"])
    if share("Gold & silver"):
        rws.append(["Gold & silver falls a further 10% (parametric)", f"{share('Gold & silver')/val*100:.0f}%", rs(-share("Gold & silver") * 0.1), f"{MINUS}10.0%"])
    _table(a, 60, 140, ["Scenario", "Value covered", "Estimated change (₹)", "On covered value"], rws, [640, 170, 230, 173], rh=46, aligns=["l", "c", "r", "r"], colors=[[None, None, RED, RED]] * len(rws))
    a.text(60, 560, wrap(f"Portfolio value today: ₹{inr(val)}. Historical rows use each fund's own measured peak-to-trough fall from its month-end NAV history; funds that did not exist in that window are excluded and the covered share is shown. Parametric rows are simple shocks, not forecasts.", 170), fontsize=10, color=GREY, va="top", linespacing=1.4)
    dk.save(f)

    f, a = dk.page(); _title(a, "Key takeaways")
    top = max(hold, key=lambda h: h["value"]); wk = min(hold, key=lambda h: h["ret"])
    tk = [("Portfolio today", f"₹{inr(val)} against ₹{inr(inv)} invested: {rs(gain, True)} ({pc(gain/inv*100 if inv else 0)})" + (f"; {xirr:.2f}% a year vs {cmp_.get('nifty500_xirr', 0):.2f}% for the Nifty 500 TRI" if xirr is not None else ""), col(gain)),
          ("Largest holding", f"{top['name']}: ₹{inr(top['value'])} ({top['value']/val*100:.1f}% of the portfolio)", NAVY),
          ("Biggest drag", f"{wk['name']}: {pc(wk['ret'])} on ₹{inr(wk['invested'])} invested", col(wk["ret"])),
          ("What to act on", recs[0][0] + (f" (and {len(recs) - 1} more flag(s) on the recommendations slide)" if len(recs) > 1 else ""), NAVY)]
    for i, (h_, t_, c_) in enumerate(tk):
        x, y = 60 + (i % 2) * 626, 150 + (i // 2) * 270
        a.add_patch(FancyBboxPatch((x, y), 587, 235, boxstyle="round,pad=0,rounding_size=14", fc=LIGHT, ec="none")); a.add_patch(plt.Circle((x + 80, y + 85), 46, fc=c_, ec="none"))
        a.text(x + 150, y + 55, h_, fontsize=19, fontweight="bold", color=NAVY, va="center"); a.text(x + 150, y + 100, wrap(t_, 44), fontsize=12.5, va="top", color=INK, linespacing=1.4)
    dk.save(f)

    f, a = dk.page(True)
    a.text(80, 280, "Thank you", fontsize=46, fontweight="bold", color="white", va="center"); a.text(80, 375, "Questions and next steps", fontsize=20, color="#6DBF4B", va="center")
    a.text(80, 430, f"Data sources and freshness: AMFI NAV (daily), AMFI TER, Fund Horizon FH score and signals (6-hourly), month-end NAV history. Valuation as on {cl['date']}; generated {ist}.", fontsize=11, color="#B8C0E0", va="top")
    a.text(80, 520, wrap(f"Mutual fund investments are subject to market risks; read all scheme-related documents carefully. Past performance may or may not be sustained in future. Index figures are mirror calculations based on index-fund NAVs (source: AMFI) and may differ slightly from published values. Funds marked * are estimated from their weighted-average investment date. This document is for information only and is not personalised investment advice. {FIRM} (ARN {ARN}).", 150), fontsize=11, color="#D6DAEE", va="top", linespacing=1.5)
    dk.save(f)
    dk.pdf.close()
    return buf.getvalue()
