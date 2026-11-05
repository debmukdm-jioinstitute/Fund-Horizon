from __future__ import annotations
from app.db.d1 import on_workers
from fastapi import HTTPException

"""matplotlib charts rendered offline to PNG bytes (Agg backend)."""

import io

if not on_workers():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter
    import app.report.fonts  # noqa: F401  (sets Google Sans as the matplotlib default)
from app.report.fmt import short_inr

NAVY, TEAL, GREY = "#0B2545", "#13A89E", "#8D99AE"
PALETTE = ["#0B2545", "#13A89E", "#F2A541", "#6C8EAD", "#8E5572", "#B8B8D1", "#3D5A80", "#98C1D9", "#E0FBFC"]
LABELS = {
    "large_cap": "Large cap", "flexi_cap": "Flexi cap", "mid_cap": "Mid cap", "small_cap": "Small cap",
    "corporate_bond": "Corporate bond", "banking_psu": "Banking & PSU", "short_duration": "Short duration",
    "gold": "Gold", "liquid": "Liquid",
}


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def donut(by_category: dict[str, float], palette: list[str] | None = None) -> bytes:
    items = [(LABELS.get(k, k), v) for k, v in sorted(by_category.items(), key=lambda kv: -kv[1]) if v > 0]
    fig, ax = plt.subplots(figsize=(4.2, 3.4))
    wedges, _ = ax.pie([v for _, v in items], colors=(palette or PALETTE)[: len(items)], startangle=90,
                       wedgeprops=dict(width=0.38, edgecolor="white"))
    ax.legend(wedges, [f"{n} {v:.1f}%" for n, v in items], loc="center left", bbox_to_anchor=(1, 0.5),
              frameon=False, fontsize=8)
    ax.set(aspect="equal")
    return _png(fig)


def stress_chart(path: list[dict]) -> bytes:
    fig, ax = plt.subplots(figsize=(6.4, 2.8))
    ax.plot([p["date"] for p in path], [p["value"] for p in path], color=TEAL, lw=1.6)
    ax.axhline(path[0]["value"], color=GREY, lw=0.6, ls="--")
    step = max(len(path) // 6, 1)
    ax.set_xticks([p["date"] for p in path][::step], [p["date"][:4] for p in path][::step], fontsize=8)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: short_inr(v)))
    ax.tick_params(axis="y", labelsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.set_title("Illustrative ₹10 lakh invested in this mix (past data)", fontsize=9, color=NAVY)
    return _png(fig)


def backtest_chart(growth: list[dict]) -> bytes:
    fig, ax = plt.subplots(figsize=(6.4, 2.4))
    ax.plot([g["d"] for g in growth], [g["v"] for g in growth], color=TEAL, lw=1.6)
    ax.axhline(100, color=GREY, lw=0.6, ls="--")
    step = max(len(growth) // 6, 1)
    ax.set_xticks([g["d"] for g in growth][::step], [g["d"][:4] for g in growth][::step], fontsize=8)
    ax.tick_params(axis="y", labelsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.set_title("Growth of 100 invested in this split (past data)", fontsize=9, color=NAVY)
    return _png(fig)


def fan_chart(fan: list[dict], target: float, title: str) -> bytes:
    xs = [f["year"] for f in fan]
    fig, ax = plt.subplots(figsize=(3.9, 2.2))
    ax.fill_between(xs, [f["p10"] for f in fan], [f["p90"] for f in fan], color=TEAL, alpha=0.25, label="P10-P90")
    ax.plot(xs, [f["p50"] for f in fan], color=NAVY, lw=1.5, label="Median")
    ax.axhline(target, color="#C0392B", lw=1, ls="--", label="Goal (inflated)")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: short_inr(v)))
    ax.tick_params(labelsize=7)
    ax.set_xlabel("Years", fontsize=7)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(fontsize=6, frameon=False, loc="upper left")
    ax.set_title(title, fontsize=8, color=NAVY)
    return _png(fig)


def growth_chart(amount: float, rate: float, years: float) -> bytes:
    """Invested amount vs projected value at the expected return, year by year."""
    xs = [i * years / max(int(years), 1) for i in range(max(int(years), 1) + 1)]
    fig, ax = plt.subplots(figsize=(5.2, 2.6))
    ax.fill_between(xs, [amount * (1 + rate / 100) ** x for x in xs], amount, color="#5BB031", alpha=0.25)
    ax.plot(xs, [amount * (1 + rate / 100) ** x for x in xs], color="#183883", lw=1.8, label=f"Projected value @ {rate:.2f}% p.a.")
    ax.axhline(amount, color=GREY, lw=0.8, ls="--", label="Amount invested")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: short_inr(v)))
    ax.tick_params(labelsize=7)
    ax.set_xlabel("Years", fontsize=7)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(fontsize=6.5, frameon=False, loc="upper left")
    return _png(fig)


def returns_bar(rows: list[dict], period: str = "3y") -> bytes:
    """Scheme return vs category average for one trailing period (rows are the proposal's `trailing` entries)."""
    rows = [r for r in rows if r["returns"].get(period) is not None]
    fig, ax = plt.subplots(figsize=(5.2, max(1.6, 0.5 * len(rows) + 0.7)))
    ys = list(range(len(rows)))
    ax.barh([y + 0.2 for y in ys], [r["returns"][period] for r in rows], height=0.36, color="#183883", label="Scheme")
    ax.barh([y - 0.2 for y in ys], [r["avg"][period] or 0 for r in rows], height=0.36, color="#5BB031", label="Category average")
    ax.set_yticks(ys, [r["name"][:34] for r in rows], fontsize=6.5)
    ax.invert_yaxis()
    ax.tick_params(axis="x", labelsize=7)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(fontsize=6.5, frameon=False, loc="lower right")
    ax.set_title(f"{period.upper()} return (% p.a.)", fontsize=8, color=NAVY)
    return _png(fig)
