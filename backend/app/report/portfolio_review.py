"""Client "Portfolio Review" deck (16:9 PDF): holdings, 4-index market comparison matrix, live Fund Horizon view,
capture ratios, worst falls, recommendations, and stress test.
Google Sans only (see CLAUDE.md). Pure rendering: the API layer supplies holdings and live fund data."""
from __future__ import annotations

import io
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import matplotlib
import numpy as np
import pandas as pd
from PIL import Image as PILImage

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
FOUR_IDX_COLS: tuple[tuple[str, str], ...] = (
    ("n50", "Nifty 50"),
    ("n500", "Nifty 500 TRI"),
    ("mid150", "Nifty Midcap\n150 TRI"),
    ("small250", "Nifty Smallcap\n250 TRI"),
)

_GLYPHS = None
_LOGO_ARR: np.ndarray | None = None
_LOGO_Loaded = False


def _load_logo() -> np.ndarray | None:
    """Load and auto-crop the official Fund Horizon logo (`logo.png` / `fund-horizon-logo.png`)."""
    global _LOGO_ARR, _LOGO_Loaded
    if _LOGO_Loaded:
        return _LOGO_ARR
    _LOGO_Loaded = True
    assets = Path(__file__).resolve().parent / "assets"
    for fn in ("logo.png", "fund-horizon-logo.png"):
        p = assets / fn
        if not p.exists():
            continue
        try:
            with PILImage.open(p) as im:
                rgba = im.convert("RGBA")
                arr = np.asarray(rgba)
                non_white = (arr[:, :, 0] < 246) | (arr[:, :, 1] < 246) | (arr[:, :, 2] < 246)
                ys, xs = np.where(non_white)
                if len(xs) and len(ys):
                    pad = 6
                    x0, x1 = max(0, int(xs.min()) - pad), min(arr.shape[1], int(xs.max()) + pad)
                    y0, y1 = max(0, int(ys.min()) - pad), min(arr.shape[0], int(ys.max()) + pad)
                    _LOGO_ARR = arr[y0:y1, x0:x1]
                else:
                    _LOGO_ARR = arr
                return _LOGO_ARR
        except Exception:
            continue
    return None


def _draw_logo(fig, dark: bool = False) -> None:
    arr = _load_logo()
    if arr is None:
        return
    if dark:
        # Subtle white badge on dark cover / closing slides so the official logo stays crisp
        fig.axes[0].add_patch(FancyBboxPatch((1106, 20), 174, 76, boxstyle="round,pad=0,rounding_size=10", fc="white", ec="none"))
    la = fig.add_axes([1115 / W, 1 - 90 / H, 156 / W, 64 / H])
    la.imshow(arr)
    la.axis("off")


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
        parts.insert(0, head[-2:])
        head = head[:-2]
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
    return "\n".join(textwrap.fill(x, n) if x.strip() else "" for x in str(t).split("\n"))


def _fit_cell(v: str, max_chars: int, max_lines: int = 2) -> str:
    """Wrap cell text cleanly to `max_chars` per line (up to `max_lines`) so long names never bleed into adjacent columns."""
    s = str(v or "").strip()
    if not s or "\n" in s or len(s) <= max_chars:
        return s
    lines = textwrap.wrap(s, width=max_chars, break_long_words=False, break_on_hyphens=False)
    if not lines:
        return s
    if len(lines) > max_lines:
        kept = lines[:max_lines]
        kept[-1] = kept[-1][: max(1, max_chars - 1)].rstrip() + "…"
        return "\n".join(kept)
    return "\n".join(lines)


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
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_xlim(0, W)
        ax.set_ylim(H, 0)
        ax.axis("off")
        fig.patch.set_facecolor(NAVY if dark else "white")
        self.n += 1
        if not dark:
            ax.text(60, 718, self.foot, fontsize=9, color=GREY, va="center")
            ax.text(1273, 718, str(self.n), fontsize=10, fontweight="bold", color=INK, ha="right", va="center")
        _draw_logo(fig, dark=dark)
        return fig, ax

    def save(self, fig):
        self.pdf.savefig(fig)
        plt.close(fig)


def _title(ax, t: str, size: float = 24.5):
    fs = size if len(t) <= 64 else (21.5 if len(t) <= 78 else 19.0)
    ax.text(60, 68, t, fontsize=fs, fontweight="bold", color=NAVY, va="center")


def _note(ax, t: str, y: float = 682, italic: bool = False):
    ax.text(60, y, wrap(t, 175), fontsize=9.5, color=GREY, va="top", style="italic" if italic else "normal")


def _card(ax, x, y, w, h, big, small, bigcol=NAVY, size=26):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=14", fc=LIGHT, ec="none"))
    ax.text(x + 24, y + 40, big, fontsize=size, fontweight="bold", color=bigcol, va="center")
    ax.text(x + 24, y + 78, small, fontsize=11, color=INK, va="top", linespacing=1.38)


def _table(ax, x, y, cols, rows, widths, rh=34, fs=10.0, colors=None, aligns=None, fills=None, hh=34, bold_rows=None):
    cx = [x]
    for w in widths:
        cx.append(cx[-1] + w)
    al = aligns or ["l"] * len(cols)
    pos = lambda i, a: cx[i] + 8 if a == "l" else (cx[i + 1] - 8 if a == "r" else (cx[i] + cx[i + 1]) / 2)
    ha = {"l": "left", "r": "right", "c": "center"}
    ax.add_patch(Rectangle((x, y), sum(widths), hh, fc=NAVY, ec="white", lw=0.8))
    for i, c in enumerate(cols):
        ax.text(pos(i, al[i]), y + hh / 2, c, color="white", fontsize=fs, fontweight="bold", va="center", ha=ha[al[i]], linespacing=1.1)
    bold_set = set(bold_rows or ())
    for r, row in enumerate(rows):
        yy = y + hh + r * rh
        is_b = r in bold_set
        for i, v in enumerate(row):
            fill = fills[r][i] if fills and fills[r][i] else "white"
            ax.add_patch(Rectangle((cx[i], yy), widths[i], rh, fc=fill, ec=LINE, lw=0.8))
            max_ch = max(6, int(widths[i] / (fs * 0.62)))
            cell_txt = _fit_cell(str(v), max_ch, max_lines=2 if rh >= 30 else 1) if al[i] == "l" else str(v)
            cell_fs = fs - 0.8 if "\n" in cell_txt and fs >= 9.5 else fs
            ax.text(
                pos(i, al[i]), yy + rh / 2, cell_txt,
                fontsize=cell_fs, fontweight="bold" if (is_b or i == 0 and is_b) else "normal",
                color=(colors[r][i] if colors and colors[r][i] else INK),
                va="center", ha=ha[al[i]], linespacing=1.12,
            )


def _hbar(fig, rect, labels, vals, colors, fmt, xlabel, fs=8.5):
    a = fig.add_axes(rect)
    short_labels = [_fit_cell(str(lbl), 32, max_lines=1) for lbl in labels]
    a.barh(range(len(vals)), vals, color=colors, height=0.66)
    a.set_yticks(range(len(vals)))
    a.set_yticklabels(short_labels, fontsize=fs)
    a.invert_yaxis()
    a.axvline(0, color="#444", lw=0.8)
    a.grid(axis="x", color="#eee")
    a.set_axisbelow(True)
    for s in ("top", "right"):
        a.spines[s].set_visible(False)
    span = max([abs(v) for v in vals] + [1e-9])
    for i, v in enumerate(vals):
        a.text(v + (span * 0.015 if v >= 0 else -span * 0.015), i, fmt(v), va="center", ha="left" if v >= 0 else "right", fontsize=max(6.5, fs - 0.5), fontweight="bold")
    a.set_xlim(min(0, min(vals)) - span * 0.22, max(0, max(vals)) + span * 0.22)
    a.set_xlabel(xlabel, fontsize=9)
    a.tick_params(axis="x", labelsize=8)


def _matrix_slides(dk: _Deck, cmp_: dict[str, Any], cl_date: str, inv: float, val: float) -> None:
    """Render the 'The portfolio beat X of 4 Nifty indices' comparison slide(s), matching the Fund Horizon benchmark layout."""
    m_rows = cmp_.get("matrix_rows") or []
    idx_tots = cmp_.get("index_totals") or {}
    if not m_rows or not idx_tots:
        return
    p_xirr = float(cmp_.get("portfolio_xirr") or 0.0)
    beaten = int(cmp_.get("indices_beaten") or sum(1 for k, _ in FOUR_IDX_COLS if p_xirr > float((idx_tots.get(k) or {}).get("idx") or 0.0)))
    primary_key = str(cmp_.get("primary_bench_key") or "n500")
    primary_lbl = str(cmp_.get("primary_bench_label") or "Nifty 500 TRI")
    primary_inr = float(cmp_.get("primary_bench_ahead_inr") if cmp_.get("primary_bench_ahead_inr") is not None else cmp_.get("ahead_inr_500") or 0.0)
    ahead_50 = float(cmp_.get("ahead_inr_50") or 0.0)
    bench_note = str(cmp_.get("benchmark_note") or "")
    tot_inv = float(cmp_.get("total_invested") or inv)
    tot_val = float(cmp_.get("total_value") or val)

    # First slide fits up to 7 funds alongside the bottom chart + right KPI cards; remaining funds go to continuation slide(s)
    first_chunk = m_rows[:7]
    rest = m_rows[7:]
    chunks = [first_chunk] + [rest[i : i + 12] for i in range(0, len(rest), 12)]

    if beaten == 4:
        base_title = "The portfolio beat all 4 Nifty indices"
    elif beaten > 0:
        base_title = f"The portfolio beat {beaten} of 4 Nifty indices"
    else:
        base_title = "Your portfolio against all 4 Nifty indices"

    for c_idx, chunk in enumerate(chunks, 1):
        is_first = c_idx == 1
        is_last = c_idx == len(chunks)
        f, a = dk.page()
        _title(a, base_title if len(chunks) == 1 else f"{base_title} ({c_idx} of {len(chunks)})")

        widths = [165, 76, 86, 86, 86, 86, 65]
        cx = [60]
        for w in widths:
            cx.append(cx[-1] + w)
        hh = 32
        y0 = 112
        a.add_patch(Rectangle((60, y0), sum(widths), hh, fc=NAVY, ec="white", lw=0.8))
        headers = [
            "Fund",
            "Your return",
            *[lbl + ("*" if k == primary_key else "") for k, lbl in FOUR_IDX_COLS],
            "Indices\nbeaten",
        ]
        for i, h_txt in enumerate(headers):
            al = "l" if i == 0 else "c"
            px = cx[i] + 7 if al == "l" else (cx[i] + cx[i + 1]) / 2
            a.text(px, y0 + hh / 2, h_txt, color="white", fontsize=8.3, fontweight="bold", va="center", ha="left" if al == "l" else "center", linespacing=1.08)

        rh = 32 if len(chunk) <= 6 else (28 if len(chunk) <= 7 else 33)
        yy = y0 + hh
        for r in chunk:
            for i in range(len(widths)):
                a.add_patch(Rectangle((cx[i], yy), widths[i], rh, fc="white", ec=LINE, lw=0.8))
            fname = _fit_cell(str(r.get("name") or ""), 23, max_lines=2)
            a.text(cx[0] + 7, yy + rh / 2, fname, fontsize=8.3, fontweight="bold", color=INK, va="center", ha="left", linespacing=1.08)
            a.text((cx[1] + cx[2]) / 2, yy + rh / 2, pc(r.get("ret"), 2, False), fontsize=8.6, fontweight="bold", color=INK, va="center", ha="center")
            cells = r.get("cells") or {}
            for j, (ikey, _ilbl) in enumerate(FOUR_IDX_COLS, start=2):
                cell = cells.get(ikey) or {}
                idx_v, lead_v = cell.get("idx"), cell.get("lead")
                if idx_v is not None and lead_v is not None:
                    a.text((cx[j] + cx[j + 1]) / 2, yy + rh * 0.33, pc(idx_v, 2, True), fontsize=8.0, color=GREY, va="center", ha="center")
                    a.text((cx[j] + cx[j + 1]) / 2, yy + rh * 0.72, f"You {pc(lead_v, 2, True)}", fontsize=7.6, fontweight="bold", color=col(lead_v), va="center", ha="center")
                else:
                    a.text((cx[j] + cx[j + 1]) / 2, yy + rh / 2, "-", fontsize=8.2, color=GREY, va="center", ha="center")
            a.text((cx[6] + cx[7]) / 2, yy + rh / 2, f"{r.get('beaten', 0)} of 4", fontsize=8.3, fontweight="bold", color=INK, va="center", ha="center")
            yy += rh

        if is_first or is_last:
            # Total portfolio row
            for i in range(len(widths)):
                a.add_patch(Rectangle((cx[i], yy), widths[i], rh, fc="#F7F9FC", ec=LINE, lw=0.8))
            a.text(cx[0] + 7, yy + rh / 2, "Total portfolio", fontsize=8.4, fontweight="bold", color=INK, va="center", ha="left")
            a.text((cx[1] + cx[2]) / 2, yy + rh / 2, pc(p_xirr, 2, False), fontsize=8.6, fontweight="bold", color=INK, va="center", ha="center")
            for j, (ikey, _ilbl) in enumerate(FOUR_IDX_COLS, start=2):
                tc = idx_tots.get(ikey) or {}
                if tc.get("idx") is not None and tc.get("lead") is not None:
                    a.text((cx[j] + cx[j + 1]) / 2, yy + rh * 0.33, pc(tc["idx"], 2, True), fontsize=8.0, color=GREY, va="center", ha="center")
                    a.text((cx[j] + cx[j + 1]) / 2, yy + rh * 0.72, f"You {pc(tc['lead'], 2, True)}", fontsize=7.6, fontweight="bold", color=col(tc["lead"]), va="center", ha="center")
            a.text((cx[6] + cx[7]) / 2, yy + rh / 2, f"{beaten} of 4", fontsize=8.4, fontweight="bold", color=INK, va="center", ha="center")
            yy += rh

            # SIPs worth today row
            rh_val = 25
            for i in range(len(widths)):
                a.add_patch(Rectangle((cx[i], yy), widths[i], rh_val, fc=LIGHT, ec=LINE, lw=0.8))
            inv_lbl = f"₹{tot_inv / 1e5:.1f} lakh SIPs worth today" if tot_inv >= 1e5 else f"₹{inr(tot_inv)} SIPs worth today"
            a.text(cx[0] + 7, yy + rh_val / 2, inv_lbl, fontsize=7.8, color=INK, va="center", ha="left")
            a.text((cx[1] + cx[2]) / 2, yy + rh_val / 2, f"₹{inr(tot_val)}", fontsize=8.2, fontweight="bold", color=INK, va="center", ha="center")
            for j, (ikey, _ilbl) in enumerate(FOUR_IDX_COLS, start=2):
                tc = idx_tots.get(ikey) or {}
                if tc.get("val"):
                    a.text((cx[j] + cx[j + 1]) / 2, yy + rh_val / 2, f"₹{inr(tc['val'])}", fontsize=8.0, color=INK, va="center", ha="center")
            yy += rh_val

        if bench_note:
            a.text(60, yy + 7, _fit_cell(bench_note, 105, max_lines=1), fontsize=8.2, style="italic", color=GREY, va="top")

        if is_first:
            # Bottom horizontal bar chart: Your portfolio vs 4 Nifty indices
            chart_bars = [("Your portfolio", p_xirr, GREEN if p_xirr > 0 else NAVY)]
            for ikey, ilbl in FOUR_IDX_COLS:
                tc = idx_tots.get(ikey) or {}
                if tc.get("idx") is not None:
                    chart_bars.append((ilbl.replace("\n", " "), float(tc["idx"]), NAVY))
            _hbar(
                f, [0.145, 0.165, 0.34, 0.195],
                [b[0] for b in chart_bars], [b[1] for b in chart_bars], [b[2] for b in chart_bars],
                lambda v: pc(v, 2, False), f"Return on the same SIPs (%) — whole portfolio, valued {cl_date}", fs=8.0,
            )

            # Right-hand summary cards
            _card(a, 755, 112, 518, 130, f"{beaten} of 4", "Nifty indices beaten by the portfolio", GREEN if beaten >= 2 else NAVY, 32)
            cat_desc = (
                "the small-cap\nfunds' benchmark" if primary_key == "small250"
                else "the mid-cap\nfunds' benchmark" if primary_key == "mid150"
                else "the large-cap\nfunds' benchmark" if primary_key == "n50"
                else "the flexi & multi-cap\nfunds' benchmark"
            )
            _card(
                a, 755, 262, 518, 135,
                rs(primary_inr, True),
                f"{'ahead of' if primary_inr >= 0 else 'behind'} the {primary_lbl} — {cat_desc}",
                col(primary_inr), 32,
            )
            _card(
                a, 755, 417, 518, 130,
                rs(ahead_50, True),
                f"{'more' if ahead_50 >= 0 else 'less'} than the same SIPs in the Nifty 50",
                col(ahead_50), 32,
            )

        _note(a, "Top figure in each cell: index return. Below: your lead (+) or lag (−). Returns on money invested.", 686, italic=True)
        dk.save(f)


def summarize_review(d: dict, live: dict[str, dict]) -> dict:
    """Enrich holdings with live FH data, bucket weights, recommendations and stress-test rows (shared by PDF and UI)."""
    cmp_ = d.get("compare") or {}
    pf = cmp_.get("per_fund") or {}
    hold = []
    for h in d["holdings"]:
        lv = live.get(h["code"], {})
        ret = h.get("ret")
        c_pf = pf.get(h["code"]) or {}
        hold.append({**h, "name": h.get("name") or lv.get("name") or h["code"], "typ": h.get("typ") or lv.get("cat_label") or "",
                     "ret": ret if ret is not None else ((h["value"] / h["invested"] - 1) * 100 if h["invested"] else 0.0),
                     "ret_is_abs": ret is None, "bucket": BUCKETS.get(lv.get("cat"), "Other"), "flag": h.get("flag", ""),
                     "v500": c_pf.get("pct"), "v500rs": c_pf.get("inr"), "lv": lv})
    inv, val = sum(h["invested"] for h in hold), sum(h["value"] for h in hold)
    bk: dict[str, float] = {}
    for h in hold:
        bk[h["bucket"]] = bk.get(h["bucket"], 0) + h["value"]
    order = sorted(bk.items(), key=lambda kv: -kv[1])

    def share(b):
        return sum(h["value"] for h in hold if h["bucket"] == b)

    sells = [h for h in hold if h["lv"].get("fh_signal") == "Sell"]
    review = [h for h in hold if h["lv"].get("fh_signal") == "Needs review"]
    recs: list[tuple[str, str]] = []
    if sells:
        recs.append(("Review the FH 'Sell' signals", f"{', '.join(h['name'] for h in sells)}: live signal is Sell (below category on 3-yr CAGR / risk-adjusted metrics)." +
                     (" " + ", ".join(h["name"] for h in sells if h["lv"].get("recommended")) + " is also on the FH recommended list: needs an investment-committee decision." if any(h["lv"].get("recommended") for h in sells) else "")))
    if review:
        recs.append(("Funds with thin data", f"{', '.join(h['name'] for h in review)}: FH signal is 'Needs review' (data coverage below the scoring minimum). Do not add until reviewed."))
    for b, label in (("Gold & silver", "Gold & silver allocation"), ("Small cap", "Small-cap concentration"), ("Sector funds", "Sector funds are a satellite")):
        n, v = sum(1 for h in hold if h["bucket"] == b), share(b)
        if n and val and v / val > (0.05 if b != "Small cap" else 0.10):
            recs.append((label, f"{n} fund(s) hold ₹{v/1e5:.1f} L ({v/val*100:.1f}% of the portfolio). " + ("Confirm a target allocation before adding." if b != "Small cap" else "Consider consolidating similar mandates (check overlap).")))
    new = [h for h in hold if h["flag"] == "†"]
    if new:
        recs.append(("Recent money is still new", f"{len(new)} holding(s) are under one year old; judge on a 3-year view and review in a year."))
    if not recs:
        recs.append(("No flags", "No Sell or Needs-review signals and no concentration flags in the live data."))
    stress_rws = []
    for k, (_, _, label) in STRESS_WINDOWS.items():
        cov = [h for h in hold if (h["lv"].get("falls") or {}).get(k) is not None]
        c = sum(h["value"] for h in cov)
        loss = sum(h["value"] * h["lv"]["falls"][k] / 100 for h in cov)
        stress_rws.append([label + ", each fund's own fall", f"{c/val*100:.0f}%" if val else "-", rs(loss) if cov else "-", pc(loss / c * 100, 1) if c else "-"])
    eq = val - share("Gold & silver")
    for sh in (10, 20, 30):
        stress_rws.append([f"All equity funds fall {sh}% (parametric; gold & silver unchanged)", "equity", rs(-eq * sh / 100), f"{MINUS}{sh:.1f}%"])
    if share("Gold & silver") and val:
        stress_rws.append(["Gold & silver falls a further 10% (parametric)", f"{share('Gold & silver')/val*100:.0f}%", rs(-share("Gold & silver") * 0.1), f"{MINUS}10.0%"])
    navd = [h["lv"]["nav_date"] for h in hold if h["lv"].get("nav_date")]
    return {"hold": hold, "inv": inv, "val": val, "gain": val - inv, "xirr": cmp_.get("portfolio_xirr"), "order": order,
            "recs": recs[:5], "stress_rows": stress_rws, "nav_date": max(navd) if navd else None}


def build_portfolio_review(d: dict, live: dict[str, dict]) -> bytes:
    """d = {client:{name,date}, holdings:[{code,name,invested,value,typ,period,inst,ret,flag}], compare:{...}|None, fetched_at}.
    live[code] = screener-row fields + 'falls'. Funds without live data render '-' (never estimated)."""
    d, live = _clean(d), _clean(live)
    cl, cmp_ = d["client"], d.get("compare") or {}
    ist = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%d %b %Y, %H:%M IST")
    s = summarize_review(d, live)
    hold, inv, val, gain, xirr, order, recs, stress_rws = s["hold"], s["inv"], s["val"], s["gain"], s["xirr"], s["order"], s["recs"], s["stress_rows"]
    foot = f"Fund Horizon  ·  {cl['name']}  ·  Valuation as on {cl['date']}" + (f"  ·  Live NAV as on {s['nav_date']}" if s["nav_date"] else "")
    buf = io.BytesIO()
    dk = _Deck(buf, foot)

    # Slide 1: Cover
    f, a = dk.page(True)
    a.text(80, 285, "Portfolio Review", fontsize=48, fontweight="bold", color="white", va="center")
    a.text(80, 365, cl["name"], fontsize=26, color="white", va="center")
    a.text(80, 425, f"Your portfolio vs the market  ·  Valuation as on {cl['date']}", fontsize=17, color="#6DBF4B", va="center")
    a.text(80, 468, f"Live fund data refreshed {ist}", fontsize=12, color="#B8C0E0", va="center")
    dk.save(f)

    # Slide 2: Portfolio summary
    f, a = dk.page()
    _title(a, f"₹{inv/1e5:.2f} L invested is now ₹{val/1e5:.2f} L" + (f": {xirr:.2f}% a year" if xirr is not None else f": {pc(gain/inv*100 if inv else 0)}"))
    _card(a, 60, 138, 282, 160, f"₹{inr(inv)}", f"invested in {len(hold)} funds")
    _card(a, 370, 138, 282, 160, f"₹{inr(val)}", f"value today · gain\n{rs(gain, True)} ({pc(gain/inv*100 if inv else 0)})")
    if xirr is not None:
        _card(a, 681, 138, 282, 160, f"{xirr:.2f}%", f"your return (XIRR, % a year)\n· Nifty 500 TRI {cmp_.get('nifty500_xirr', 0):.2f}%", GREEN)
        _card(a, 991, 138, 282, 160, rs(cmp_.get("ahead_inr_500", 0), True), "vs the same instalments\nin the Nifty 500 TRI", col(cmp_.get("ahead_inr_500", 0)))
    else:
        _card(a, 681, 138, 282, 160, pc(gain / inv * 100 if inv else 0), "absolute return (not annualised;\nXIRR needs instalment dates)", col(gain))
        _card(a, 991, 138, 282, 160, f"{sum(1 for h in hold if h['ret'] >= 0)} of {len(hold)}", "funds with a positive return", GREEN)
    a.text(420, 342, "Where the money is today (₹ lakh)", fontsize=13, fontweight="bold", color=NAVY, ha="center")
    _hbar(f, [0.29, 0.13, 0.31, 0.36], [k for k, _ in order], [v / 1e5 for _, v in order], [NAVY] * len(order), lambda v: f"₹{v:.1f} L", "", fs=10.0)
    a.add_patch(FancyBboxPatch((820, 332), 453, 338, boxstyle="round,pad=0,rounding_size=14", fc=LIGHT, ec="none"))
    a.text(845, 368, "In short", fontsize=17, fontweight="bold", color=NAVY, va="center")
    best, worst = max(hold, key=lambda h: h["ret"]), min(hold, key=lambda h: h["ret"])
    a.text(845, 396, wrap(f"Largest holding: {max(hold, key=lambda h: h['value'])['name']}.\n\nBest return: {best['name']} ({pc(best['ret'])}).\n\nWeakest return: {worst['name']} ({pc(worst['ret'])}).", 44), fontsize=12, va="top", linespacing=1.42, color=INK)
    dk.save(f)

    # Slide 3+: 4-Nifty-indices matrix slide (when matrix_rows present)
    if cmp_ and cmp_.get("matrix_rows") and cmp_.get("index_totals"):
        _matrix_slides(dk, cmp_, cl["date"], inv, val)

    # Holdings slides (12 rows per page so the Total portfolio row never overflows onto the footer)
    def hold_pages():
        per_pg = 12
        chunks = [hold[i : i + per_pg] for i in range(0, len(hold), per_pg)] or [[]]
        for i, ch in enumerate(chunks, 1):
            last = i == len(chunks)
            f, a = dk.page()
            _title(a, f"Your holdings ({i} of {len(chunks)}): when you invested and what it is worth" if len(chunks) > 1 else "Your holdings: when you invested and what it is worth")
            rws = [[h["name"] + (f" {h['flag']}" if h["flag"] else ""), h["typ"], h.get("period", ""), str(h.get("inst", "")), f"₹{inr(h['invested'])}", f"₹{inr(h['value'])}", pc(h["ret"])] for h in ch]
            cls = [[None] * 6 + [col(h["ret"])] for h in ch]
            fl = [[None] * 7 for _ in rws]
            bold_r = []
            if last:
                bold_r.append(len(rws))
                rws.append(["Total portfolio", "", "", "", f"₹{inr(inv)}", f"₹{inr(val)}", pc(xirr if xirr is not None else (gain / inv * 100 if inv else 0))])
                cls.append([None] * 6 + [col(gain)])
                fl.append([LIGHT] * 7)
            _table(a, 60, 128, ["Fund", "Category", "Period", "Instal.", "Invested", "Value today", "Return"], rws, [325, 195, 225, 80, 135, 135, 118], rh=36, fs=9.8, colors=cls, aligns=["l", "l", "c", "c", "r", "r", "r"], fills=fl, bold_rows=bold_r)
            _note(a, "Return: XIRR % a year where supplied, otherwise absolute return since investment. † under one year. * estimated from weighted investment date.")
            dk.save(f)
    hold_pages()

    # Same-instalment comparison slides (paginated when > 15 funds)
    L = sorted([h for h in hold if h["v500"] is not None], key=lambda h: -h["v500"])
    if cmp_ and L:
        f, a = dk.page()
        _title(a, "Ahead of the Nifty 50 and the Nifty 500 TRI" if (cmp_.get("ahead_inr_500", 0) > 0) else "Against the Nifty 50 and the Nifty 500 TRI")
        a.text(460, 150, "XIRR on the same instalments, % a year", fontsize=13, fontweight="bold", color=NAVY, ha="center")
        _hbar(f, [0.145, 0.16, 0.48, 0.37], ["Your portfolio", "Nifty 50", "Nifty 500 TRI"], [xirr or 0, cmp_.get("nifty50_xirr", 0), cmp_.get("nifty500_xirr", 0)], [GREEN, NAVY, NAVY], lambda v: f"{v:.2f}%", "", fs=11.5)
        for i, (big, sm) in enumerate([
            (rs(cmp_.get("ahead_inr_500", 0), True), "vs the same instalments in the Nifty 500 TRI"),
            (rs(cmp_.get("ahead_inr_50", 0), True), "vs the same instalments in the Nifty 50"),
            (pc((xirr or 0) - cmp_.get("nifty500_xirr", 0)) + " a year", "vs the Nifty 500 TRI"),
        ]):
            _card(a, 840, 135 + i * 150, 433, 135, big, sm, GREEN if big.startswith("+") else RED, 28)
        _note(a, "Each instalment notionally invested in each index on the same date. Index data: index-fund NAVs (AMFI).")
        dk.save(f)

        # Lead % per fund vs Nifty 500 TRI (chunked at 16 funds per page)
        l_chunks = [L[i : i + 16] for i in range(0, len(L), 16)]
        for ci, lch in enumerate(l_chunks, 1):
            f, a = dk.page()
            t_str = f"{sum(1 for h in L if h['v500'] > 0)} of {len(L)} funds are ahead of the Nifty 500 TRI"
            _title(a, t_str + (f" ({ci} of {len(l_chunks)})" if len(l_chunks) > 1 else ""))
            _hbar(f, [0.18, 0.16, 0.35, 0.65], [h["name"] for h in lch], [h["v500"] for h in lch], [col(h["v500"]) for h in lch], lambda v: f"{'+' if v >= 0 else MINUS}{abs(v):.1f}%", "Your return minus the Nifty 500 TRI on the same instalments (%)", fs=7.8)
            _card(a, 760, 135, 513, 120, f"{cmp_.get('funds_ahead_50', 0)} of {len(L)}", "funds ahead of the Nifty 50", NAVY, 30)
            _card(a, 760, 275, 513, 120, pc(L[0]["v500"], 1), f"top lead: {_fit_cell(L[0]['name'], 34, 1)}", col(L[0]["v500"]), 30)
            _card(a, 760, 415, 513, 120, pc(L[-1]["v500"], 1), f"lagging: {_fit_cell(L[-1]['name'], 34, 1)}", col(L[-1]["v500"]), 30)
            dk.save(f)

        R = sorted([h for h in L if h["v500rs"] is not None], key=lambda h: -h["v500rs"])
        if R:
            r_chunks = [R[i : i + 16] for i in range(0, len(R), 16)]
            for ci, rch in enumerate(r_chunks, 1):
                f, a = dk.page()
                t_str = f"In rupees: {rs(cmp_.get('ahead_inr_500', 0), True)} vs the Nifty 500 TRI"
                _title(a, t_str + (f" ({ci} of {len(r_chunks)})" if len(r_chunks) > 1 else ""))
                _hbar(f, [0.18, 0.16, 0.35, 0.65], [h["name"] for h in rch], [h["v500rs"] / 1e5 for h in rch], [col(h["v500rs"]) for h in rch], lambda v: rs(v * 1e5, True), "₹ more (+) or less (−) than the same instalments in the Nifty 500 TRI (₹ lakh)", fs=7.8)
                top, bot = R[:4], [h for h in R[-3:][::-1] if h["v500rs"] < 0]
                rws = [[h["name"], rs(h["v500rs"], True)] for h in top] + ([["Biggest drags", ""]] + [[h["name"], rs(h["v500rs"], True)] for h in bot] if bot else [])
                cls = [[None, GREEN if h["v500rs"] >= 0 else RED] for h in top] + ([["white", "white"]] + [[None, RED]] * len(bot) if bot else [])
                fl = [[None, None]] * len(top) + ([[NAVY, NAVY]] + [[None, None]] * len(bot) if bot else [])
                _table(a, 760, 140, ["Biggest contributors", "vs Nifty 500"], rws, [330, 183], rh=40, hh=38, fs=9.5, aligns=["l", "r"], colors=cls, fills=fl)
                dk.save(f)

        if cmp_.get("index_rows"):
            idx_all = cmp_["index_rows"]
            idx_chunks = [idx_all[i : i + 12] for i in range(0, len(idx_all), 12)]
            for ci, rows in enumerate(idx_chunks, 1):
                f, a = dk.page()
                _title(a, "Against the matching Nifty index" + (f" ({ci} of {len(idx_chunks)})" if len(idx_chunks) > 1 else ""))
                _table(
                    a, 60, 130, ["Fund", "Official Nifty benchmark", "Period", "Your return", "Index", "Lead", "₹ vs index"],
                    [[r["name"], r["index"], r["period"], pc(r["ret"]), pc(r["idx"]), pc(r["lead"], 1), rs(r["inr"], True)] for r in rows],
                    [310, 185, 215, 140, 120, 115, 128], rh=38, fs=9.5,
                    colors=[[None] * 5 + [col(r["lead"]), col(r["inr"])] for r in rows],
                    aligns=["l", "l", "c", "r", "r", "r", "r"],
                )
                _note(a, "Same instalments, same dates, against each fund's official SEBI category Nifty TRI benchmark.", 674)
                dk.save(f)

    def lv_pages(title, header, widths, notes, key, fmt_row):
        rows = [h for h in hold if h["lv"].get(key) is not None]
        chunks = [rows[i : i + 13] for i in range(0, len(rows), 13)]
        for ci, ch in enumerate(chunks, 1):
            f, a = dk.page()
            _title(a, title + ("" if len(chunks) <= 1 else f" ({ci} of {len(chunks)})"))
            rr = [fmt_row(h) for h in ch]
            _table(a, 60, 130, header, [r[0] for r in rr], widths, rh=35, fs=9.8, aligns=["l"] + ["c"] * (len(header) - 1), colors=[r[1] for r in rr], fills=[r[2] for r in rr])
            _note(a, notes, 678)
            dk.save(f)

    def cap_row(h):
        lv = h["lv"]
        up, dn, ra = lv["cap_up_3y"], lv["cap_down_3y"], lv.get("cap_ratio_3y")
        return ([h["name"], pc(lv.get("cagr_3y"), 2, False), f"{up:.0f}%", f"{dn:.0f}%", f"{ra:.2f}" if ra is not None else "-"],
                [None, col(lv.get("cagr_3y") or 0), GREEN if up > 100 else RED, GREEN if dn < 100 else RED, GREEN if (ra or 0) >= 1 else RED],
                [None] * 4 + ["#E3F2E3" if (ra or 0) >= 1 else "#FBE5E5"])
    lv_pages("Rising and falling markets: capture ratios", ["Fund", "3-yr CAGR", "Up-market capture", "Down-market\ncapture", "Capture ratio"], [420, 200, 220, 215, 158],
             "Last 3 years, Fund Horizon capture-ratio engine. Up capture > 100% and down capture < 100% are good; ratio (up / down) > 1 is good. Funds under 3 years old are not shown.", "cap_up_3y", cap_row)

    def dd_row(h):
        lv = h["lv"]
        return ([h["name"], pc(lv.get("max_dd_3y"), 1, False) if lv.get("max_dd_3y") is not None else "-", pc(lv.get("max_dd_all"), 1, False) if lv.get("max_dd_all") is not None else "-", f"{lv['history_years']:.1f} yrs" if lv.get("history_years") else "-"],
                [None, RED, RED, None], [None] * 4)
    lv_pages("Worst falls: last 3 years and full history", ["Fund", "Worst fall, last 3 yrs", "Worst fall, full history", "History"], [430, 280, 280, 223],
             "Maximum drawdown = largest fall from a previous high, from Fund Horizon's NAV history (live).", "max_dd_all", dd_row)

    # Fund Horizon live view (12 rows per page)
    fh_rows = sorted(hold, key=lambda h: -h["value"])
    fh_chunks = [fh_rows[i : i + 12] for i in range(0, len(fh_rows), 12)] or [[]]
    for ci, ch in enumerate(fh_chunks, 1):
        f, a = dk.page()
        _title(a, "Fund Horizon view on each fund (live)" + (f" ({ci} of {len(fh_chunks)})" if len(fh_chunks) > 1 else ""))
        rws, cls = [], []
        for h in ch:
            lv = h["lv"]
            sig = lv.get("fh_signal") or ("Not in FH universe" if not lv else ("Data excluded" if lv.get("reason") else "Not scored"))
            rws.append([h["name"], f"₹{inr(h['value'])}", f"{lv['fh_score']:.1f}" if lv.get("fh_score") is not None else "-", sig, "Yes" if lv.get("recommended") else "-", lv.get("nav_date") or "-", (lv.get("reason") or "")[:95]])
            cls.append([None] * 3 + [SIGNAL_COL.get(sig, GREY), None, None, GREY])
        _table(a, 60, 130, ["Fund", "Value", "FH score", "FH signal", "FH list", "NAV as of", "Basis"], rws, [245, 105, 80, 110, 70, 90, 513], rh=38, fs=9.4, aligns=["l", "r", "c", "c", "c", "c", "l"], colors=cls)
        _note(a, "FH score and signal from the Fund Horizon screener (live; refreshed every 6 hours). Research data, not personalised advice.", 682)
        dk.save(f)

    # Portfolio recommendations
    f, a = dk.page()
    _title(a, "What we would look at: portfolio recommendations")
    for i, (h_, t_) in enumerate(recs):
        y = 132 + i * 105
        a.add_patch(FancyBboxPatch((60, y), 1213, 92, boxstyle="round,pad=0,rounding_size=12", fc=LIGHT, ec="none"))
        a.text(85, y + 26, h_, fontsize=15, fontweight="bold", color=NAVY, va="center")
        a.text(85, y + 56, wrap(t_, 145), fontsize=10.8, color=INK, va="center", linespacing=1.28)
    _note(a, "Rule-based observations from the portfolio and Fund Horizon live data. Research data, not personalised investment advice; adviser suitability review required.", 682)
    dk.save(f)

    # Stress test
    f, a = dk.page()
    _title(a, "Stress test: what if markets fall again?")
    _table(a, 60, 132, ["Scenario", "Value covered", "Estimated change (₹)", "On covered value"], stress_rws, [640, 170, 230, 173], rh=45, fs=10.0, aligns=["l", "c", "r", "r"], colors=[[None, None, RED, RED]] * len(stress_rws))
    a.text(60, 560, wrap(f"Portfolio value today: ₹{inr(val)}. Historical rows use each fund's own measured peak-to-trough fall from its month-end NAV history; funds that did not exist in that window are excluded and the covered share is shown. Parametric rows are simple shocks, not forecasts.", 170), fontsize=10, color=GREY, va="top", linespacing=1.4)
    dk.save(f)

    # Key takeaways
    f, a = dk.page()
    _title(a, "Key takeaways")
    top = max(hold, key=lambda h: h["value"])
    wk = min(hold, key=lambda h: h["ret"])
    tk = [
        ("Portfolio today", f"₹{inr(val)} against ₹{inr(inv)} invested: {rs(gain, True)} ({pc(gain/inv*100 if inv else 0)})" + (f"; {xirr:.2f}% a year vs {cmp_.get('nifty500_xirr', 0):.2f}% for the Nifty 500 TRI" if xirr is not None else ""), col(gain)),
        ("Largest holding", f"{top['name']}: ₹{inr(top['value'])} ({top['value']/val*100:.1f}% of the portfolio)" if val else top["name"], NAVY),
        ("Biggest drag", f"{wk['name']}: {pc(wk['ret'])} on ₹{inr(wk['invested'])} invested", col(wk["ret"])),
        ("What to act on", recs[0][0] + (f" (and {len(recs) - 1} more flag(s) on the recommendations slide)" if len(recs) > 1 else ""), NAVY),
    ]
    for i, (h_, t_, c_) in enumerate(tk):
        x, y = 60 + (i % 2) * 626, 142 + (i // 2) * 268
        a.add_patch(FancyBboxPatch((x, y), 587, 235, boxstyle="round,pad=0,rounding_size=14", fc=LIGHT, ec="none"))
        a.add_patch(plt.Circle((x + 80, y + 85), 46, fc=c_, ec="none"))
        a.text(x + 150, y + 55, h_, fontsize=19, fontweight="bold", color=NAVY, va="center")
        a.text(x + 150, y + 100, wrap(t_, 42), fontsize=12.2, va="top", color=INK, linespacing=1.38)
    dk.save(f)

    # Closing slide
    f, a = dk.page(True)
    a.text(80, 275, "Thank you", fontsize=46, fontweight="bold", color="white", va="center")
    a.text(80, 368, "Questions and next steps", fontsize=20, color="#6DBF4B", va="center")
    a.text(80, 425, f"Data sources and freshness: AMFI NAV (daily), AMFI TER, Fund Horizon FH score and signals (6-hourly), month-end NAV history. Valuation as on {cl['date']}; generated {ist}.", fontsize=11, color="#B8C0E0", va="top")
    a.text(80, 515, wrap(f"Mutual fund investments are subject to market risks; read all scheme-related documents carefully. Past performance may or may not be sustained in future. Index figures are mirror calculations based on index-fund NAVs (source: AMFI) and may differ slightly from published values. Funds marked * are estimated from their weighted-average investment date. This document is for information only and is not personalised investment advice. {FIRM} (ARN {ARN}).", 150), fontsize=11, color="#D6DAEE", va="top", linespacing=1.5)
    dk.save(f)
    dk.pdf.close()
    return buf.getvalue()
