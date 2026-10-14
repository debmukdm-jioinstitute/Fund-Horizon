"""Daily stored briefing for the Fund Horizon backoffice.

Replaces the old 7-line deterministic template with a daily, business-first
briefing built ONLY from data already in the local database and stored in the
``briefings`` table (upsert keyed by ``brief_date``). The API serves the stored
payload read-only: no live provider or NSE fetch happens in the request path.

Conventions:
- All dates are Asia/Kolkata. API carries ISO 8601; ``brief_date`` is the IST
  calendar date (``YYYY-MM-DD``).
- Missing data renders as "—" plus a reason. Numeric checks always use
  ``is not None``; 0 is a legitimate value.
- Every item carries ``as_of`` (ISO with offset) and ``source`` provenance.
- Empty sections are still included with ``items: []`` and a ``note`` explaining
  why (the frontend collapses them). No top-level ``not_available`` list is used.
- Change for market series is relative to the previous observation; change for
  fund NAVs / TER / managers is relative to the previous stored briefing
  (a strictly earlier ``brief_date``), so rebuilding the same date is idempotent.
"""
from __future__ import annotations

import math
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.backoffice.fh_recommended import FH_RECOMMENDED_MF_CODES

IST = ZoneInfo("Asia/Kolkata")
BRIEFING_VERSION = 1
BRIEFING_HOUR_IST = 8  # daily build target, Asia/Kolkata
MARKED_PICK_LABEL = "Marked pick"  # compliant phrasing for the FH curated list

# Sections in display order.
SECTION_ORDER = [
    ("market_pulse", "Market pulse"),
    ("fund_movers", "Fund movers"),
    ("screening_changes", "Screening changes"),
    ("cost_manager_changes", "Cost & manager changes"),
    ("regulatory_news", "Regulatory & news"),
    ("pms", "PMS"),
    ("client_actions", "Client actions"),
    ("data_freshness", "Data freshness"),
]

# FII/DII: stored category codes are normalised by the NSE provider to exactly
# these values ("FII" covers FPI rows). Match with ==, never substring.
FII_CATEGORY = "FII"
DII_CATEGORY = "DII"

# News feed ids for RBI / SEBI (category "regulator" in the RSS provider).
REGULATOR_FEED_IDS = {"rbi_press", "rbi_notif", "sebi"}

# Prerequisite collectors that should have completed a run today before the
# scheduled 08:00 IST build.
BRIEFING_PREREQ_SOURCES = ("SRC_AMFI", "SRC_NSE_FNO", "SRC_RSS", "SRC_IN_YIELDS")


# ---------------------------------------------------------------------------
# Date / time helpers
# ---------------------------------------------------------------------------

def ist_today() -> str:
    """Today's date in Asia/Kolkata as ``YYYY-MM-DD``."""
    return datetime.now(IST).date().isoformat()


def ist_now_iso() -> str:
    """Current time in Asia/Kolkata as ISO 8601 with offset."""
    return datetime.now(IST).isoformat(timespec="seconds")


def to_ist_iso(raw: Any) -> str | None:
    """Best-effort conversion of a stored timestamp to IST ISO 8601 with offset."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw).strip()
        if not text:
            return None
        dt = None
        # Date-only values are treated as start of day IST.
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            try:
                return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=IST).isoformat()
            except ValueError:
                return None
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        if dt is None:
            try:
                dt = datetime.fromisoformat(text)
            except ValueError:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(IST).isoformat(timespec="seconds")


def ist_date_of(raw: Any) -> str | None:
    """IST calendar date (``YYYY-MM-DD``) of a stored timestamp, or None."""
    iso = to_ist_iso(raw)
    return iso[:10] if iso else None


# ---------------------------------------------------------------------------
# Change helpers
# ---------------------------------------------------------------------------

def calc_change(new: float | None, old: float | None) -> tuple[float | None, float | None, str]:
    """Return ``(change, change_pct, direction)``; Nones propagate, never NaN."""
    if new is None or old is None:
        return None, None, "flat"
    if old == 0:
        return None, None, "flat"
    change = new - old
    change_pct = change / abs(old) * 100.0
    if math.isnan(change) or math.isnan(change_pct):
        return None, None, "flat"
    direction = "up" if change > 0 else "down" if change < 0 else "flat"
    return change, change_pct, direction


def make_item(
    text: str,
    value: str | None = None,
    change: float | None = None,
    change_pct: float | None = None,
    direction: str = "flat",
    so_what: str | None = None,
    as_of: str | None = None,
    source: str | None = None,
    source_url: str | None = None,
    link: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "text": text,
        "value": value,
        "change": change,
        "change_pct": change_pct,
        "direction": direction,
        "so_what": so_what,
        "as_of": as_of,
        "source": source,
        "source_url": source_url,
    }
    if link is not None:
        item["link"] = link
    return item


# ---------------------------------------------------------------------------
# Rule-based so_what table (market pulse)
# ---------------------------------------------------------------------------
# Each rule: metric key, predicate over the metrics dict, and the so_what text.
# First match per item wins. Copy is descriptive only; no advisory-tone words.
SO_WHAT_RULES: list[dict[str, Any]] = [
    {"metric": "in10y_move_bps", "when": lambda m: (m.get("in10y_move_bps") or 0) >= 10,
     "text": "Rates up: favour short-duration/accrual debt; long-duration NAVs under pressure."},
    {"metric": "in10y_move_bps", "when": lambda m: (m.get("in10y_move_bps") or 0) <= -10,
     "text": "Rates down: long-duration debt NAVs get a tailwind; accrual yields lock in lower."},
    {"metric": "vix", "when": lambda m: (m.get("vix") or 0) >= 20,
     "text": "Elevated volatility: stagger lumpsums via STP."},
    {"metric": "nifty_chg", "when": lambda m: (m.get("nifty_chg") or 0) <= -1.5,
     "text": "Sharp equity dip: review STP opportunities; avoid panic redemptions."},
    {"metric": "nifty_chg", "when": lambda m: (m.get("nifty_chg") or 0) >= 1.5,
     "text": "Strong rally day: stay invested unless a goal is near."},
    {"metric": "usdinr_chg", "when": lambda m: (m.get("usdinr_chg") or 0) >= 0.5,
     "text": "Rupee weaker vs USD: import-linked inflation risk; NRI remittances fetch more."},
    {"metric": "fii_dii", "when": lambda m: (m.get("fii_net") or 0) < 0 < (m.get("dii_net") or 0),
     "text": "FIIs selling, DIIs buying: domestic flows cushioning the market."},
    {"metric": "fii_dii", "when": lambda m: (m.get("fii_net") or 0) > 0,
     "text": "FII buying: supportive for large-cap momentum."},
    {"metric": "slope_bps", "when": lambda m: (m.get("slope_bps") if m.get("slope_bps") is not None else 1) < 0,
     "text": "Inverted curve (2Y above 10Y): caution signal; stay short duration."},
    {"metric": "in2y_move_bps", "when": lambda m: (m.get("in2y_move_bps") or 0) >= 10,
     "text": "Short rates up: liquid and money-market fund yields improving."},
    {"metric": "spread_bps", "when": lambda m: (m.get("spread_bps") or 0) >= 250,
     "text": "Wide India-US spread: carry supportive for INR debt."},
    {"metric": "spread_bps", "when": lambda m: (m.get("spread_bps") or 0) <= 150,
     "text": "Narrow India-US spread: watch for FII debt-flow pressure."},
]


def apply_so_what(metric_key: str, metrics: dict[str, Any]) -> str | None:
    """First matching rule for ``metric_key`` wins; None when nothing fires."""
    for rule in SO_WHAT_RULES:
        if rule["metric"] != metric_key:
            continue
        try:
            if rule["when"](metrics):
                return rule["text"]
        except (TypeError, ValueError):
            continue
    return None


# ---------------------------------------------------------------------------
# Repository access helpers (thin; SQL lives in BackofficeRepository)
# ---------------------------------------------------------------------------

def _latest_two(repo: Any, instrument_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Newest two observations with a numeric value, newest first."""
    series = [o for o in repo.get_observations_series(instrument_id, limit=500) if o.get("value_numeric") is not None]
    if not series:
        return None, None
    ordered = sorted(series, key=lambda o: str(o.get("observed_at") or ""), reverse=True)
    return ordered[0], (ordered[1] if len(ordered) > 1 else None)


def _paired_same_day(repo: Any, a: str, b: str, window_days: int = 45) -> tuple[float, float, str] | None:
    """Latest date on which BOTH series have an observation (never subtract across days)."""
    start = (datetime.now(UTC) - timedelta(days=window_days)).strftime("%Y-%m-%d")
    by_day = []
    for inst in (a, b):
        by_day.append(
            {
                (o.get("observed_at") or "")[:10]: o["value_numeric"]
                for o in repo.get_observations_series(inst, start_date=start)
                if o.get("value_numeric") is not None
            }
        )
    common = sorted(set(by_day[0]) & set(by_day[1]))
    if not common:
        return None
    day = common[-1]
    return by_day[0][day], by_day[1][day], day


def _source_lookup(repo: Any) -> dict[str, dict[str, Any]]:
    return {s["id"]: s for s in repo.list_sources()}


def _instrument_source(repo: Any, instrument_id: str, sources: dict[str, dict[str, Any]]) -> tuple[str | None, str | None]:
    """(source name, source url) for an instrument via the instrument registry."""
    try:
        instruments = {i["id"]: i for i in repo.list_instruments()}
    except Exception:  # noqa: BLE001 - registry read must never break the build
        return None, None
    inst = instruments.get(instrument_id) or {}
    src = sources.get(inst.get("source_id") or "", {})
    return src.get("name"), src.get("official_docs_url")


# ---------------------------------------------------------------------------
# Section 1: Market pulse
# ---------------------------------------------------------------------------

def _obs_item(
    repo: Any,
    sources: dict[str, dict[str, Any]],
    instrument_id: str,
    label: str,
    unit: str,
    metric_key: str,
    metrics: dict[str, Any],
    digits: int = 2,
    pct_change: bool = True,
) -> dict[str, Any] | None:
    latest, prev = _latest_two(repo, instrument_id)
    if latest is None:
        return None
    value = float(latest["value_numeric"])
    prev_value = float(prev["value_numeric"]) if prev is not None else None
    change, change_pct, direction = calc_change(value, prev_value)
    if not pct_change:
        change_pct = None
    src_name, src_url = _instrument_source(repo, instrument_id, sources)
    metrics[metric_key] = change_pct if pct_change else change
    text = f"{label}: {value:,.{digits}f}{unit}"
    if change_pct is not None and pct_change:
        text += f" ({change_pct:+.{digits}f}% day)"
    elif change is not None and not pct_change:
        text += f" ({change:+.{digits}f}{unit} day)"
    return make_item(
        text=text,
        value=f"{value:,.{digits}f}{unit}",
        change=change,
        change_pct=change_pct,
        direction=direction,
        so_what=apply_so_what(metric_key, metrics),
        as_of=to_ist_iso(latest.get("observed_at")),
        source=src_name,
        source_url=src_url,
    )


def build_market_pulse(repo: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Max 8 items: indices, yields+slope, FX, VIX, FII/DII. Returns (items, missing labels)."""
    sources = _source_lookup(repo)
    metrics: dict[str, Any] = {}
    items: list[dict[str, Any]] = []
    missing: list[str] = []

    def add(item: dict[str, Any] | None, label: str) -> None:
        if item is None:
            missing.append(label)
        else:
            items.append(item)
    # Indices (day % change)
    add(_obs_item(repo, sources, "INDEX:IN:NIFTY50", "NIFTY 50", "", "nifty_chg", metrics), "NIFTY 50")
    add(_obs_item(repo, sources, "INDEX:IN:NIFTYBANK", "NIFTY Bank", "", "banknifty_chg", metrics), "NIFTY Bank")
    add(_obs_item(repo, sources, "INDEX:IN:SENSEX", "SENSEX", "", "sensex_chg", metrics), "SENSEX")

    # India 10Y / 2Y with slope (day move in bps)
    in10y = _latest_two(repo, "YIELD:IN:10Y")
    in2y = _latest_two(repo, "YIELD:IN:2Y")
    if in10y[0] is not None and in2y[0] is not None:
        v10, v2 = float(in10y[0]["value_numeric"]), float(in2y[0]["value_numeric"])
        p10 = float(in10y[1]["value_numeric"]) if in10y[1] is not None else None
        p2 = float(in2y[1]["value_numeric"]) if in2y[1] is not None else None
        delta10, _, _ = calc_change(v10, p10)
        delta2, _, _ = calc_change(v2, p2)
        move10_bps = delta10 * 100.0 if delta10 is not None else None
        move2_bps = delta2 * 100.0 if delta2 is not None else None
        metrics["in10y_move_bps"] = move10_bps
        metrics["in2y_move_bps"] = move2_bps
        # Slope only from same-period observations (never subtract across weeks).
        d10 = (in10y[0].get("observed_at") or "")[:10]
        d2 = (in2y[0].get("observed_at") or "")[:10]
        slope_bps = (v10 - v2) * 100.0 if d10 and d2 and abs((datetime.strptime(d10, "%Y-%m-%d") - datetime.strptime(d2, "%Y-%m-%d")).days) <= 10 else None
        metrics["slope_bps"] = slope_bps
        slope_txt = f", 10Y-2Y slope {slope_bps:+.0f} bps" if slope_bps is not None else ", slope — (periods differ)"
        move_txt = f"{move10_bps:+.0f}" if move10_bps is not None else "—"
        text = f"India 10Y {v10:.2f}% / 2Y {v2:.2f}% ({move_txt} bps day){slope_txt}"
        so = apply_so_what("in10y_move_bps", metrics) or apply_so_what("slope_bps", metrics) or apply_so_what("in2y_move_bps", metrics)
        src_name, src_url = _instrument_source(repo, "YIELD:IN:10Y", sources)
        items.append(make_item(
            text=text, value=f"{v10:.2f}% / {v2:.2f}%", change=delta10, change_pct=None,
            direction="up" if (move10_bps or 0) > 0 else "down" if (move10_bps or 0) < 0 else "flat",
            so_what=so, as_of=to_ist_iso(in10y[0].get("observed_at")), source=src_name, source_url=src_url,
        ))
    else:
        missing.append("India 10Y/2Y")

    # India-US 10Y spread from the same-date pair.
    pair = _paired_same_day(repo, "YIELD:IN:10Y", "YIELD:US:10Y")
    if pair is not None:
        v_in, v_us, day = pair
        spread_bps = (v_in - v_us) * 100.0
        metrics["spread_bps"] = spread_bps
        so = apply_so_what("spread_bps", metrics)
        items.append(make_item(
            text=f"India-US 10Y spread {spread_bps:+.0f} bps (India {v_in:.2f}% vs US {v_us:.2f}%, both as of {day})",
            value=f"{spread_bps:+.0f} bps", change=None, change_pct=None, direction="flat",
            so_what=so, as_of=to_ist_iso(day), source="US Treasury / India G-Sec feeds",
            source_url="https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
        ))
    else:
        missing.append("India-US 10Y spread")

    # FX
    add(_obs_item(repo, sources, "FX:USDINR", "USD/INR", "", "usdinr_chg", metrics, digits=4), "USD/INR")
    # NRI FX: EUR and GBP vs INR combined into one item.
    eur = _latest_two(repo, "FX:EURINR")
    gbp = _latest_two(repo, "FX:GBPINR")
    nri_parts = []
    nri_chgs = []
    for obs_pair, label in ((eur, "EUR/INR"), (gbp, "GBP/INR")):
        if obs_pair[0] is None:
            continue
        v = float(obs_pair[0]["value_numeric"])
        pv = float(obs_pair[1]["value_numeric"]) if obs_pair[1] is not None else None
        _, chg, _ = calc_change(v, pv)
        if chg is not None:
            nri_chgs.append(abs(chg))
        nri_parts.append(f"{label} {v:.2f}" + (f" ({chg:+.2f}% day)" if chg is not None else ""))
    if nri_parts:
        metrics["nri_fx_chg"] = max(nri_chgs) if nri_chgs else 0.0
        src_name, src_url = _instrument_source(repo, "FX:EURINR", sources)
        items.append(make_item(
            text="NRI FX: " + ", ".join(nri_parts), value=None, change=None, change_pct=None,
            direction="flat", so_what=None,
            as_of=to_ist_iso((eur[0] or gbp[0] or {}).get("observed_at")),
            source=src_name, source_url=src_url,
        ))
    else:
        missing.append("EUR/INR, GBP/INR")

    # India VIX
    vix_obs = _latest_two(repo, "VOL:IN:INDIAVIX")[0]
    if vix_obs is not None:
        vix = float(vix_obs["value_numeric"])
        metrics["vix"] = vix
        src_name, src_url = _instrument_source(repo, "VOL:IN:INDIAVIX", sources)
        items.append(make_item(
            text=f"India VIX {vix:.2f}", value=f"{vix:.2f}", change=None, change_pct=None,
            direction="flat", so_what=apply_so_what("vix", metrics),
            as_of=to_ist_iso(vix_obs.get("observed_at")), source=src_name, source_url=src_url,
        ))
    else:
        missing.append("India VIX")

    # FII / DII net (exact category codes, latest report date).
    flows = repo.list_flows()
    if flows:
        latest_date = flows[0].get("report_date")
        same_day = [f for f in flows if f.get("report_date") == latest_date]
        fii_net = next((f.get("net") for f in same_day if f.get("category") == FII_CATEGORY), None)
        dii_net = next((f.get("net") for f in same_day if f.get("category") == DII_CATEGORY), None)
        prev_dates = sorted({f.get("report_date") for f in flows if f.get("report_date") != latest_date}, reverse=True)
        prev_day = [f for f in flows if f.get("report_date") == (prev_dates[0] if prev_dates else None)]
        fii_prev = next((f.get("net") for f in prev_day if f.get("category") == FII_CATEGORY), None)
        dii_prev = next((f.get("net") for f in prev_day if f.get("category") == DII_CATEGORY), None)
        if fii_net is not None or dii_net is not None:
            metrics["fii_net"] = fii_net
            metrics["dii_net"] = dii_net
            fii_txt = f"{fii_net:+,.0f}" if fii_net is not None else "—"
            dii_txt = f"{dii_net:+,.0f}" if dii_net is not None else "—"
            _, fii_chg, _ = calc_change(fii_net, fii_prev)
            _, dii_chg, _ = calc_change(dii_net, dii_prev)
            items.append(make_item(
                text=f"Institutional flows {latest_date}: FII net {fii_txt} Cr, DII net {dii_txt} Cr",
                value=f"FII {fii_txt} / DII {dii_txt} Cr",
                change=fii_chg, change_pct=None,
                direction="up" if (fii_net or 0) > 0 else "down" if (fii_net or 0) < 0 else "flat",
                so_what=apply_so_what("fii_dii", metrics),
                as_of=to_ist_iso(latest_date), source="NSE FII/DII",
                source_url="https://www.nseindia.com/reports/fii-dii",
            ))
        else:
            missing.append("FII/DII")
    else:
        missing.append("FII/DII")

    return items[:8], missing


# ---------------------------------------------------------------------------
# Section 2: Fund movers
# ---------------------------------------------------------------------------

def _asset_class_of(category: str | None) -> str:
    """Coarse asset class from the AMFI category header text."""
    c = (category or "").lower()
    if "equity" in c:
        return "equity"
    if "hybrid" in c:
        return "hybrid"
    if any(k in c for k in ("debt", "income", "liquid", "money market", "overnight", "gilt", "credit")):
        return "debt"
    return "other"


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def build_fund_movers(repo: Any, prev_history: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None, dict[str, Any]]:
    """Top 5 / bottom 5 Regular-plan funds by 1D % change, with category-median gaps.

    ``mf_schemes`` keeps only the latest NAV, so the 1D change is measured
    against the previous stored briefing's NAV for the same scheme.
    Returns (items, note, history_fragment).
    """
    schemes = repo.list_scheme_navs(plan="Regular")
    schemes = [s for s in schemes if _asset_class_of(s.get("category")) in ("equity", "hybrid", "debt")]

    marked = set(FH_RECOMMENDED_MF_CODES)
    universe = [s for s in schemes if s.get("scheme_code") in marked]
    note: str | None = None
    if marked and not universe:
        universe = schemes
        note = (
            f"{MARKED_PICK_LABEL} list has no schemes in the NAV feed today, "
            "so the whole Regular-plan universe is used."
        )
    elif marked:
        note = f"Universe: {MARKED_PICK_LABEL} list ({len(universe)} schemes with NAVs)."

    prev_navs: dict[str, dict[str, Any]] = (prev_history or {}).get("fund_movers") or {}
    history: dict[str, dict[str, Any]] = {}
    scored: list[dict[str, Any]] = []
    no_prev = 0
    for s in universe:
        code = s.get("scheme_code")
        nav = s.get("latest_nav")
        history[code] = {"nav": nav, "nav_date": s.get("nav_date")}
        if nav is None:
            continue
        prev = prev_navs.get(code) or {}
        prev_nav = prev.get("nav")
        if prev_nav is None:
            no_prev += 1
            continue
        change, change_pct, direction = calc_change(float(nav), float(prev_nav))
        if change_pct is None:
            continue
        scored.append({**s, "change": change, "change_pct": change_pct, "direction": direction})

    by_cat: dict[str, list[float]] = {}
    for s in scored:
        by_cat.setdefault(s.get("category") or "—", []).append(s["change_pct"])
    medians = {c: _median(v) for c, v in by_cat.items()}

    scored.sort(key=lambda s: s["change_pct"])
    picks = scored[:5] + [s for s in scored[-5:] if s not in scored[:5]]
    # Order: top 5 first (best first), then bottom 5 (worst first).
    picks = sorted([s for s in picks if s["change_pct"] >= 0], key=lambda s: -s["change_pct"]) + \
        sorted([s for s in picks if s["change_pct"] < 0], key=lambda s: s["change_pct"])

    items: list[dict[str, Any]] = []
    for s in picks[:10]:
        med = medians.get(s.get("category") or "—")
        gap = s["change_pct"] - med if med is not None else None
        gap_txt = f", {gap:+.2f}pp vs {s.get('category')} median" if gap is not None else ""
        name = s.get("scheme_name") or s.get("scheme_code")
        items.append(make_item(
            text=f"{name}: ₹{float(s['latest_nav']):,.2f} ({s['change_pct']:+.2f}% 1D{gap_txt})",
            value=f"₹{float(s['latest_nav']):,.2f}",
            change=s["change"],
            change_pct=round(s["change_pct"], 2),
            direction=s["direction"],
            so_what=None,
            as_of=to_ist_iso(s.get("nav_date")),
            source="AMFI India NAV",
            source_url="https://portal.amfiindia.com/spages/NAVAll.txt",
        ))

    extra = f" {no_prev} fund(s) have no prior-day NAV to compare." if no_prev else ""
    if not items:
        note = ((note + " ") if note else "") + "No 1D changes computable yet." + extra
    elif extra:
        note = ((note + " ") if note else "") + extra.strip()
    return items, note, {"fund_movers": history}


# ---------------------------------------------------------------------------
# Section 3: Screening changes
# ---------------------------------------------------------------------------

def build_screening_changes(repo: Any) -> tuple[list[dict[str, Any]], str | None]:
    """Funds whose quartile changed since the previous screening run."""
    try:
        current = repo.list_screening_quartiles()
    except Exception:  # noqa: BLE001
        current = []
    if not current:
        return [], "No screening data loaded yet."
    prev_ext = repo.list_external_quartiles(window_years=2)
    marked = set(FH_RECOMMENDED_MF_CODES)
    items: list[dict[str, Any]] = []
    for row in current:
        code = row.get("scheme_code")
        q = row.get("quartile_2y")
        if q is None:
            continue
        name = row.get("scheme_name") or code
        prev = prev_ext.get(code) or {}
        pq = prev.get("quartile")
        changed = pq is not None and pq != q
        left_band = code in marked and q not in (2, 3)
        if changed or left_band:
            reasons = []
            if changed:
                reasons.append(f"quartile Q{pq} → Q{q} (2Y)")
            if left_band:
                reasons.append(f"{MARKED_PICK_LABEL} fund outside Q2–Q3 band (now Q{q})")
            items.append(make_item(
                text=f"{name}: {'; '.join(reasons)}",
                value=f"Q{q}", change=None, change_pct=None, direction="flat", so_what=None,
                as_of=to_ist_iso(row.get("as_of")),
                source="FH screening engine",
                source_url="https://fundhorizon.in/internal/screening",
            ))
    note = None if items else "No quartile changes since the previous screening run."
    return items, note


# ---------------------------------------------------------------------------
# Section 4: Cost & manager changes
# ---------------------------------------------------------------------------

def build_cost_manager_changes(repo: Any, prev_history: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None, dict[str, Any]]:
    items: list[dict[str, Any]] = []
    ter_hist: dict[str, float] = {}
    mgr_hist: dict[str, str] = {}

    # TER: month-on-month moves of ±5 bps or more on Regular plans.
    try:
        ter_rows = repo.list_mf_ter()
    except Exception:  # noqa: BLE001
        ter_rows = []
    prev_ter: dict[str, float] = (prev_history or {}).get("ter") or {}
    for r in ter_rows:
        key = r.get("base_key")
        pct = r.get("regular_ter_pct")
        if key is None or pct is None:
            continue
        ter_hist[key] = float(pct)
        old = prev_ter.get(key)
        if old is None:
            continue
        delta_bps = (float(pct) - float(old)) * 100.0
        if abs(delta_bps) >= 5:
            items.append(make_item(
                text=f"{r.get('scheme_name') or key}: Regular TER {float(old):.2f}% → {float(pct):.2f}% ({delta_bps:+.0f} bps). Trail commission moves with TER.",
                value=f"{float(pct):.2f}%", change=delta_bps / 100.0, change_pct=None,
                direction="up" if delta_bps > 0 else "down",
                so_what=None, as_of=to_ist_iso(r.get("as_of")),
                source="AMFI TER", source_url="https://www.amfiindia.com/ter-of-mf-schemes",
            ))

    # Managers: changes since the last brief.
    managers_note: str | None = None
    try:
        managers = repo.list_mf_managers()
    except Exception:  # noqa: BLE001
        managers = {}
    if not managers:
        managers_note = "Manager data not loaded."
    else:
        prev_mgr: dict[str, str] = (prev_history or {}).get("managers") or {}
        for code, m in managers.items():
            name = (m or {}).get("manager_name")
            if not name:
                continue
            mgr_hist[code] = name
            old = prev_mgr.get(code)
            if old is not None and old != name:
                items.append(make_item(
                    text=f"Manager change ({code}): {old} → {name}.",
                    value=name, change=None, change_pct=None, direction="flat", so_what=None,
                    as_of=to_ist_iso((m or {}).get("updated_at")),
                    source=(m or {}).get("source") or "AMC factsheet",
                    source_url=(m or {}).get("provenance") or None,
                ))

    note = managers_note
    if not items and not note:
        note = "No TER or manager changes since the last briefing."
    return items, note, {"ter": ter_hist, "managers": mgr_hist}


# ---------------------------------------------------------------------------
# Section 5: Regulatory & news
# ---------------------------------------------------------------------------

def _norm_title(title: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", (title or "").lower())).strip()


def build_regulatory_news(repo: Any) -> tuple[list[dict[str, Any]], str | None]:
    try:
        news = repo.list_news(limit=200)
    except Exception:  # noqa: BLE001
        news = []
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    recent: list[dict[str, Any]] = []
    for n in news:
        ts = None
        for cand in (n.get("published_at"), n.get("fetched_at")):
            iso = to_ist_iso(cand)
            if not iso:
                continue
            try:
                ts = datetime.fromisoformat(iso)
                break
            except ValueError:
                continue
        if ts is not None and ts >= cutoff.astimezone(IST):
            recent.append(n)
    regulator = [n for n in recent if n.get("source_id") in REGULATOR_FEED_IDS]
    others = [n for n in recent if n.get("source_id") not in REGULATOR_FEED_IDS]
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for n in others:
        key = _norm_title(n.get("title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(n)
    items: list[dict[str, Any]] = []
    for n in regulator + deduped[:5]:
        link = n.get("link")
        items.append(make_item(
            text=n.get("title") or "—", value=None, change=None, change_pct=None,
            direction="flat", so_what=None,
            as_of=to_ist_iso(n.get("published_at") or n.get("fetched_at")),
            source=n.get("source_name"), source_url=link, link=link,
        ))
    note = None if items else "No RBI/SEBI or market headlines in the last 24h."
    return items, note


# ---------------------------------------------------------------------------
# Section 6: PMS
# ---------------------------------------------------------------------------

def build_pms(repo: Any, prev_history: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None, dict[str, Any]]:
    as_on = repo.latest_pms_as_on()
    if not as_on:
        return [], "No APMI data loaded yet.", {"pms_as_on": None}
    prev_as_on = (prev_history or {}).get("pms_as_on")
    if prev_as_on is not None and as_on <= prev_as_on:
        return [], f"No new month from APMI (as of {as_on}); last briefed month {prev_as_on}.", {"pms_as_on": as_on}
    strategies = [s for s in repo.list_pms_universe_strategies(as_on) if s.get("return_1m") is not None]
    if not strategies:
        return [], f"APMI month {as_on} has no 1M returns on file.", {"pms_as_on": as_on}
    benchmarks = repo.list_pms_cached_benchmarks()
    strategies.sort(key=lambda s: float(s["return_1m"]))
    picks = strategies[-5:][::-1] + strategies[:5]
    # De-duplicate while preserving order (small universes can overlap).
    seen: set[str] = set()
    ordered: list[dict[str, Any]] = []
    for s in picks:
        key = str(s.get("ia_id") or "") + "|" + str(s.get("strategy_name"))
        if key in seen:
            continue
        seen.add(key)
        ordered.append(s)
    items: list[dict[str, Any]] = []
    for s in ordered[:10]:
        r1m = float(s["return_1m"])
        bench = benchmarks.get(str(s.get("ia_id") or "")) or "benchmark not on file"
        items.append(make_item(
            text=f"{s.get('strategy_name')} ({s.get('provider')}): {r1m:+.2f}% 1M vs {bench}",
            value=f"{r1m:+.2f}%", change=None, change_pct=None,
            direction="up" if r1m > 0 else "down" if r1m < 0 else "flat",
            so_what=None, as_of=to_ist_iso(as_on),
            source="APMI PMS performance", source_url="https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu",
        ))
    note = f"APMI month {as_on}: top 5 / bottom 5 strategies by 1M return."
    return items, note, {"pms_as_on": as_on}


# ---------------------------------------------------------------------------
# Section 7: Client actions
# ---------------------------------------------------------------------------

def build_client_actions(repo: Any, mover_schemes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    """Households holding movers/screening funds + CRM follow-ups and cases due today."""
    items: list[dict[str, Any]] = []
    today = ist_today()
    conn = repo._conn()
    try:
        households = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM households").fetchall()}
        positions = [dict(r) for r in conn.execute("SELECT * FROM portfolio_positions").fetchall()]
    except Exception:  # noqa: BLE001 - CRM tables may not exist on older volumes
        return [], "Client book not linked."
    finally:
        conn.close()
    if not positions or not households:
        return [], "Client book not linked."

    codes = {s.get("scheme_code") for s in mover_schemes if s.get("scheme_code")}
    isins: dict[str, str] = {}
    try:
        for code in codes:
            row = repo.get_mf_schemes_by_codes([code])
            for r in row:
                if r.get("isin"):
                    isins[r["isin"]] = code
    except Exception:  # noqa: BLE001
        pass
    acct_to_household: dict[str, str] = {}
    conn = repo._conn()
    try:
        for r in conn.execute("SELECT id, household_id, customer_id FROM pms_accounts").fetchall():
            acct_to_household[r["id"]] = r["household_id"] or r["customer_id"] or r["id"]
    except Exception:  # noqa: BLE001
        pass
    finally:
        conn.close()
    holders: dict[str, set[str]] = {}
    for p in positions:
        key = str(p.get("symbol_or_isin") or "")
        code = isins.get(key)
        if code is None and key in codes:
            code = key
        if code is None:
            continue
        hh = acct_to_household.get(p.get("account_id")) or households.get(p.get("account_id"))
        holders.setdefault(code, set())
        if hh and hh in households:
            holders[code].add(households[hh])
        elif hh:
            holders[code].add(str(hh))
    for code in sorted(holders):
        names = sorted(holders[code])
        shown = ", ".join(names[:6]) + ("…" if len(names) > 6 else "")
        items.append(make_item(
            text=f"{len(names)} household(s) hold {code}: {shown}",
            value=str(len(names)), change=None, change_pct=None, direction="flat", so_what=None,
            as_of=to_ist_iso(today), source="Client book (portfolio positions)",
            source_url=None,
        ))

    # CRM follow-ups and cases due today (IST).
    conn = repo._conn()
    try:
        followups = [
            dict(r) for r in conn.execute(
                "SELECT subject, kind FROM activities WHERE done_at IS NULL AND due_at IS NOT NULL"
            ).fetchall()
            if ist_date_of(r["due_at"]) == today
        ]
        cases = [
            dict(r) for r in conn.execute(
                "SELECT subject, status FROM cases WHERE resolved_at IS NULL AND sla_due_at IS NOT NULL"
            ).fetchall()
            if (ist_date_of(r["sla_due_at"]) or "") <= today
        ]
    except Exception:  # noqa: BLE001
        followups, cases = [], []
    finally:
        conn.close()
    if followups:
        subjects = "; ".join(f.get("subject") or f.get("kind") or "follow-up" for f in followups[:5])
        items.append(make_item(
            text=f"{len(followups)} follow-up(s) due today: {subjects}",
            value=str(len(followups)), change=None, change_pct=None, direction="flat",
            so_what=None, as_of=to_ist_iso(today), source="CRM activities", source_url=None,
        ))
    if cases:
        items.append(make_item(
            text=f"{len(cases)} open case(s) due: " + "; ".join(c.get("subject") or "case" for c in cases[:5]),
            value=str(len(cases)), change=None, change_pct=None, direction="flat",
            so_what=None, as_of=to_ist_iso(today), source="CRM cases", source_url=None,
        ))
    note = None if items else "No client holdings overlap today's movers and no follow-ups due today."
    return items, note


# ---------------------------------------------------------------------------
# Section 8: Data freshness
# ---------------------------------------------------------------------------

def build_data_freshness(repo: Any) -> list[dict[str, Any]]:
    # Imported lazily: collectors imports this module, so a top-level import would be circular.
    from app.backoffice.collectors import REFRESH_INTERVALS

    default_interval = 24 * 3600
    now = datetime.now(UTC)
    out: list[dict[str, Any]] = []
    for s in repo.list_sources():
        if not s.get("enabled"):
            continue
        last_ok = to_ist_iso(s.get("last_success_at"))
        age_hours: float | None = None
        stale = True
        if s.get("last_success_at"):
            try:
                dt = datetime.fromisoformat(str(s["last_success_at"]))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=UTC)
                age_hours = (now - dt).total_seconds() / 3600.0
                interval = REFRESH_INTERVALS.get(s["id"], default_interval)
                stale = age_hours > 2 * (interval / 3600.0)
            except (ValueError, TypeError):
                stale = True
        out.append({
            "source": s.get("name") or s.get("id"),
            "last_ok": last_ok,
            "age_hours": round(age_hours, 1) if age_hours is not None else None,
            "stale": stale,
        })
    out.sort(key=lambda r: (not r["stale"], r["age_hours"] is None, r["age_hours"] or 0.0))
    return out


# ---------------------------------------------------------------------------
# Payload assembly + daily job
# ---------------------------------------------------------------------------

def _previous_briefing(repo: Any, brief_date: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    row = None
    for d in repo.list_briefing_dates(limit=60):
        if d < brief_date:
            row = repo.get_briefing_by_date(d)
            break
    payload = (row or {}).get("payload") or {}
    return payload, (payload.get("_history") or {})


def build_briefing_payload(repo: Any, brief_date: str | None = None) -> dict[str, Any]:
    """Assemble the full briefing payload for ``brief_date`` (IST). Pure read path."""
    brief_date = brief_date or ist_today()
    _prev_payload, prev_history = _previous_briefing(repo, brief_date)

    sections: list[dict[str, Any]] = []
    history: dict[str, Any] = dict(prev_history)  # carried forward unless rebuilt

    def add_section(key: str, title: str, items: list[dict[str, Any]], note: str | None = None) -> None:
        section: dict[str, Any] = {"key": key, "title": title, "items": items, "note": note}
        sections.append(section)

    pulse_items, pulse_missing = build_market_pulse(repo)
    pulse_note = None
    if pulse_missing:
        pulse_note = "Not available: " + ", ".join(pulse_missing) + " — no observation on file."
    add_section("market_pulse", "Market pulse", pulse_items, pulse_note)

    mover_items, mover_note, mover_hist = build_fund_movers(repo, prev_history)
    history.update(mover_hist)
    add_section("fund_movers", "Fund movers", mover_items, mover_note)

    screen_items, screen_note = build_screening_changes(repo)
    add_section("screening_changes", "Screening changes", screen_items, screen_note)

    cost_items, cost_note, cost_hist = build_cost_manager_changes(repo, prev_history)
    history.update(cost_hist)
    add_section("cost_manager_changes", "Cost & manager changes", cost_items, cost_note)

    news_items, news_note = build_regulatory_news(repo)
    add_section("regulatory_news", "Regulatory & news", news_items, news_note)

    pms_items, pms_note, pms_hist = build_pms(repo, prev_history)
    history.update(pms_hist)
    add_section("pms", "PMS", pms_items, pms_note)

    # Client actions need the underlying mover schemes; recover codes from the
    # stored history keys (fund_movers history holds every universe scheme).
    mover_schemes = [{"scheme_code": c} for c in (history.get("fund_movers") or {})]
    client_items, client_note = build_client_actions(repo, mover_schemes)
    add_section("client_actions", "Client actions", client_items, client_note)

    freshness = build_data_freshness(repo)
    add_section("data_freshness", "Data freshness", [], None)

    payload = {
        "brief_date": brief_date,
        "generated_at": ist_now_iso(),
        "version": BRIEFING_VERSION,
        "sections": sections,
        "freshness": freshness,
        "_history": history,
    }
    return payload


def build_daily_briefing(repo: Any | None = None, brief_date: str | None = None) -> dict[str, Any]:
    """Build today's briefing and upsert it keyed by ``brief_date`` (idempotent).

    Change for fund-level series is measured against the previous stored
    briefing (strictly earlier date), so rebuilding the same date produces an
    identical payload.
    """
    from app.backoffice.repository import BackofficeRepository

    repo = repo or BackofficeRepository()
    brief_date = brief_date or ist_today()
    payload = build_briefing_payload(repo, brief_date)
    repo.upsert_briefing(brief_date, payload, BRIEFING_VERSION)
    return {"ok": True, "brief_date": brief_date}


def briefing_missing_today(repo: Any | None = None) -> bool:
    """True when no briefing row exists for today's IST date."""
    from app.backoffice.repository import BackofficeRepository

    repo = repo or BackofficeRepository()
    return repo.get_briefing_by_date(ist_today()) is None
