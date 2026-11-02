"""Fill market-desk charts, CSV downloads and search without running upstream JS."""

from __future__ import annotations

import csv
import html
import json
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from io import StringIO
from urllib.parse import parse_qs, urlencode
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup, Tag
from fastapi import HTTPException
from fastapi.responses import Response

JSON_TTL = 15 * 60
CATALOG_TTL = 30 * 60
_MAX_JSON = 16
_MAX_POINTS = 160
_MAX_TABLE_ROWS = 400

_json_lock = threading.Lock()
_json_cache: dict[str, tuple[float, dict]] = {}
_live_lock = threading.Lock()
_live_pages: list[tuple[str, str, str]] = []
_live_at = 0.0

_SLOT = {1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8"}
_TONE = {"hist": "10", "pos": "3", "neg": "2"}

STATIC_PAGES: list[tuple[str, str, str]] = [
    ("/", "Market overview", "Dashboards"),
    ("/indices/", "Every NSE index: returns, trend and risk", "Indices"),
    ("/trend/", "Trend", "Markets"),
    ("/markets/", "Breadth", "Markets"),
    ("/valuation/", "Valuation", "Markets"),
    ("/activity/", "Turnover", "Trading"),
    ("/flows/", "Flows", "Buyers"),
    ("/funds/", "Funds", "Products"),
    ("/economy/", "Economy", "Economy"),
    ("/global/", "Global", "World"),
    ("/models/", "Models", "Tools"),
    ("/methods/", "Methods", "Tools"),
    ("/search/", "Search markets", "Tools"),
]

def _esc(text: object) -> str:
    return html.escape("" if text is None else str(text), quote=True)


def _src_path(src: str) -> str:
    path = (src or "").split("?", 1)[0].strip()
    if path.startswith("http"):
        from app.backoffice.market_desk import UPSTREAM

        if path.startswith(UPSTREAM):
            path = path[len(UPSTREAM) :]
        else:
            return ""
    return path.lstrip("/")


def load_json(path: str) -> dict | None:
    path = _src_path(path)
    if not path.startswith("data/") or ".." in path.split("/"):
        return None
    now = time.monotonic()
    with _json_lock:
        hit = _json_cache.get(path)
        if hit and now - hit[0] < JSON_TTL:
            return hit[1]
    from app.backoffice.market_desk import fetch_upstream

    try:
        status, _ctype, data = fetch_upstream(path)
    except HTTPException:
        return None
    if status >= 400:
        return None
    try:
        blob = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(blob, dict):
        return None
    with _json_lock:
        _json_cache[path] = (now, blob)
    return blob


def _prefetch(srcs: list[str]) -> dict[str, dict]:
    uniq: list[str] = []
    seen: set[str] = set()
    for src in srcs:
        path = _src_path(src)
        if not path or path in seen or not path.startswith("data/"):
            continue
        seen.add(path)
        uniq.append(path)
        if len(uniq) >= _MAX_JSON:
            break
    out: dict[str, dict] = {}
    if not uniq:
        return out

    def one(p: str) -> tuple[str, dict | None]:
        return p, load_json(p)

    if len(uniq) == 1:
        p, blob = one(uniq[0])
        if blob:
            out[p] = blob
        return out
    with ThreadPoolExecutor(max_workers=min(8, len(uniq))) as pool:
        futs = [pool.submit(one, p) for p in uniq]
        for fut in as_completed(futs):
            p, blob = fut.result()
            if blob:
                out[p] = blob
    return out


def _dates_series(blob: dict | None) -> tuple[list, dict]:
    if not isinstance(blob, dict):
        return [], {}
    dates = blob.get("dates") or blob.get("index") or []
    series = blob.get("series")
    if not isinstance(series, dict):
        series = {}
        for k, v in blob.items():
            if k in ("dates", "index", "schema", "generated_at", "name", "resolution", "meta", "series") or not isinstance(v, list):
                continue
            series[k] = v
    return list(dates), series


def _slice_from(dates: list, from_date: str | None) -> int:
    if not from_date:
        return 0
    for i, d in enumerate(dates):
        if str(d) >= from_date:
            return i
    return 0


def _rebase(values: list, base: float) -> list:
    v0 = next((v for v in values if isinstance(v, (int, float))), None)
    if not v0:
        return values
    out = []
    for v in values:
        out.append(None if not isinstance(v, (int, float)) else base * float(v) / float(v0))
    return out


def _stride(n: int, cap: int = _MAX_POINTS) -> list[int]:
    if n <= cap:
        return list(range(n))
    step = math.ceil(n / cap)
    idx = list(range(0, n, step))
    if idx[-1] != n - 1:
        idx.append(n - 1)
    return idx


def _fmt(v: float | None, fmt: str, digits: int) -> str:
    if v is None or not isinstance(v, (int, float)) or not math.isfinite(v):
        return ""
    if fmt == "pct":
        return f"{v:.{digits}f}%"
    if fmt == "int":
        return f"{v:,.0f}"
    return f"{v:,.{digits}f}"


def _slot_class(spec: dict, prefix: str) -> str:
    tone = (spec.get("tone") or "").lower()
    if tone in _TONE:
        return f"{prefix}{_TONE[tone]}"
    slot = spec.get("slot")
    return f"{prefix}{_SLOT.get(int(slot), '1') if isinstance(slot, (int, float)) else '1'}"


def _nice_ticks(lo: float, hi: float, n: int = 4) -> list[float]:
    if not math.isfinite(lo) or not math.isfinite(hi) or lo == hi:
        mid = lo if math.isfinite(lo) else 0.0
        return [mid - 1, mid, mid + 1]
    pad = (hi - lo) * 0.06
    lo, hi = lo - pad, hi + pad
    span = hi - lo or 1.0
    raw = span / max(n - 1, 1)
    mag = 10 ** math.floor(math.log10(raw))
    step = next((s * mag for s in (1, 2, 2.5, 5, 10) if s * mag >= raw), 10 * mag)
    start = math.floor(lo / step) * step
    ticks = []
    x = start
    for _ in range(12):
        if x > hi + step * 0.01:
            break
        ticks.append(x)
        x += step
    return ticks or [lo, hi]


def _line_d(xs: list[float], ys: list[float | None]) -> str:
    parts: list[str] = []
    cmd = "M"
    for x, y in zip(xs, ys, strict=False):
        if y is None:
            cmd = "M"
            continue
        parts.append(f"{cmd}{x:.1f},{y:.1f}")
        cmd = "L"
    return " ".join(parts)


def _prepare(cfg: dict, blob: dict | None) -> tuple[list[str], list[dict], str, int]:
    dates, series = _dates_series(blob if blob is not None else cfg.get("data") if isinstance(cfg.get("data"), dict) else {})
    specs = [s for s in (cfg.get("series") or []) if isinstance(s, dict) and s.get("col")]
    start = _slice_from(dates, cfg.get("from"))
    dates = [str(d) for d in dates[start:]]
    transform = cfg.get("transform") if isinstance(cfg.get("transform"), dict) else {}
    base = float(transform.get("base") or 100) if transform.get("type") == "rebase" else None
    cols = []
    for spec in specs:
        raw = list((series.get(spec["col"]) or [])[start:])
        raw = raw[: len(dates)]
        if base is not None:
            raw = _rebase(raw, base)
        cols.append({**spec, "values": raw})
    if dates:
        n = min(len(dates), max((len(c["values"]) for c in cols), default=0))
        idx = _stride(n)
        dates = [dates[i] for i in idx]
        for c in cols:
            c["values"] = [(c["values"][i] if i < len(c["values"]) else None) for i in idx]
    fmt = str(cfg.get("fmt") or "num")
    digits = int(cfg.get("digits") if cfg.get("digits") is not None else (1 if fmt == "pct" else 0))
    return dates, cols, fmt, digits


def _axis(vals: list[float], zero: bool) -> tuple[float, float, list[float]]:
    lo, hi = min(vals), max(vals)
    if zero:
        lo = min(lo, 0.0)
        hi = max(hi, 0.0)
    ticks = _nice_ticks(lo, hi)
    return ticks[0], ticks[-1], ticks


def _y_map(vals: list[float], h: float, top: float, bot: float, zero: bool):
    lo, hi, ticks = _axis(vals, zero)
    span = (hi - lo) or 1.0
    inner = h - top - bot

    def y(v: float) -> float:
        return top + (hi - v) / span * inner

    return y, ticks, lo, hi


def _x_map(vals: list[float], w: float, left: float, right: float, zero: bool):
    lo, hi, ticks = _axis(vals, zero)
    span = (hi - lo) or 1.0
    inner = w - left - right

    def x(v: float) -> float:
        return left + (v - lo) / span * inner

    return x, ticks, lo, hi


def _svg_line(cfg: dict, blob: dict | None, kind: str) -> str:
    dates, cols, fmt, digits = _prepare(cfg, blob)
    nums = [v for c in cols for v in c["values"] if isinstance(v, (int, float))]
    if not dates or not nums:
        return ""
    w, h, left, right, top, bot = 640, 252, 44, 118, 12, 28
    y, ticks, _lo, _hi = _y_map(nums, h, top, bot, bool(cfg.get("zero")))
    n = len(dates)
    inner_w = w - left - right
    xs = [left + (i / max(n - 1, 1)) * inner_w for i in range(n)]
    grid = []
    for t in ticks:
        yy = y(t)
        grid.append(f'<line class="tc-grid" x1="{left:.1f}" x2="{w - right:.1f}" y1="{yy:.1f}" y2="{yy:.1f}"/>')
        grid.append(f'<text class="tc-tick" x="{left - 6:.1f}" y="{yy + 3:.1f}" text-anchor="end">{_esc(_fmt(t, fmt, digits))}</text>')
    paths = []
    if kind == "band" and isinstance(cfg.get("band"), dict):
        band_cfg = {
            **cfg,
            "series": [
                {"col": cfg["band"].get("lo"), "label": "lo"},
                {"col": cfg["band"].get("hi"), "label": "hi"},
            ],
        }
        _d2, band_cols, _f, _di = _prepare(band_cfg, blob)
        if len(band_cols) == 2 and len(band_cols[0]["values"]) == n:
            lo_pts, hi_pts = [], []
            for x, lo_v, hi_v in zip(xs, band_cols[0]["values"], band_cols[1]["values"], strict=False):
                if isinstance(lo_v, (int, float)):
                    lo_pts.append((x, y(float(lo_v))))
                if isinstance(hi_v, (int, float)):
                    hi_pts.append((x, y(float(hi_v))))
            if lo_pts and hi_pts:
                d = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{yy:.1f}" for i, (x, yy) in enumerate(hi_pts))
                d += " " + " ".join(f"L{x:.1f},{yy:.1f}" for x, yy in reversed(lo_pts)) + " Z"
                paths.append(f'<path class="tc-fan tc-f1" d="{d}" fill-opacity="0.18" stroke="none"/>')
    for spec in cols:
        mapped: list[float | None] = [y(float(v)) if isinstance(v, (int, float)) else None for v in spec["values"]]
        d = _line_d(xs, mapped)
        if not d:
            continue
        cls = _slot_class(spec, "tc-s")
        if kind == "bars":
            bw = max(inner_w / max(n, 1) * 0.7, 1.2)
            y0 = y(0.0)
            fill = _slot_class(spec, "tc-f")
            rects = []
            for x, v in zip(xs, spec["values"], strict=False):
                if not isinstance(v, (int, float)):
                    continue
                yy = y(float(v))
                top_y, bot_y = (yy, y0) if v >= 0 else (y0, yy)
                rects.append(
                    f'<rect class="tc-bar {fill}" x="{x - bw / 2:.1f}" y="{top_y:.1f}" width="{bw:.1f}" height="{max(bot_y - top_y, 0.6):.1f}"/>'
                )
            paths.append("".join(rects))
        else:
            paths.append(f'<path class="tc-line {cls}" d="{d}"/>')
        last = next(((xs[i], spec["values"][i]) for i in range(n - 1, -1, -1) if isinstance(spec["values"][i], (int, float))), None)
        if last:
            lx, lv = last
            fill = _slot_class(spec, "tc-f")
            paths.append(f'<circle class="tc-end {fill}" cx="{lx:.1f}" cy="{y(float(lv)):.1f}" r="3"/>')
            label = _esc(spec.get("label") or spec.get("col") or "")
            paths.append(
                f'<text class="tc-endlabel" x="{lx + 8:.1f}" y="{y(float(lv)) - 6:.1f}">{label}</text>'
                f'<text class="tc-endvalue" x="{lx + 8:.1f}" y="{y(float(lv)) + 10:.1f}">{_esc(_fmt(float(lv), fmt, digits))}</text>'
            )
    x_labels = ""
    if dates:
        x_labels = (
            f'<text class="tc-tick" x="{left:.1f}" y="{h - 8:.1f}">{_esc(dates[0][:10])}</text>'
            f'<text class="tc-tick" x="{w - right:.1f}" y="{h - 8:.1f}" text-anchor="end">{_esc(dates[-1][:10])}</text>'
        )
    name = _esc(cfg.get("name") or "Chart")
    return (
        f'<svg class="tc" viewBox="0 0 {w} {h}" width="100%" height="auto" role="img" aria-label="{name}" '
        f'preserveAspectRatio="xMidYMid meet">{"".join(grid)}{"".join(paths)}{x_labels}</svg>'
    )


def _svg_outcomes(cfg: dict) -> str:
    data = cfg.get("data") if isinstance(cfg.get("data"), dict) else {}
    cats = [str(c) for c in (data.get("categories") or [])]
    series = data.get("series") if isinstance(data.get("series"), dict) else {}
    horizons = [h for h in (cfg.get("horizons") or []) if isinstance(h, dict)] or [
        cfg.get("outcome") if isinstance(cfg.get("outcome"), dict) else None
    ]
    horizons = [h for h in horizons if h]
    if not cats or not horizons:
        return ""
    fmt, digits = str(cfg.get("fmt") or "pct"), int(cfg.get("digits") if cfg.get("digits") is not None else 1)
    nums: list[float] = []
    for h in horizons:
        for key in (h.get("lo"), h.get("mid"), h.get("hi")):
            for v in series.get(key) or []:
                if isinstance(v, (int, float)):
                    nums.append(float(v))
    if not nums:
        return ""
    row_h, label_w, top, bot = 26, 168, 28, 16
    w, h = 640, top + bot + row_h * len(cats)
    x_of, ticks, _lo, _hi = _x_map(nums, w, label_w, 24, False)

    parts = [
        f'<text class="tc-headline" x="{label_w:.0f}" y="16">{_esc(cfg.get("name") or "")}</text>',
    ]
    for t in ticks:
        xx = x_of(t)
        parts.append(f'<line class="tc-grid" x1="{xx:.1f}" x2="{xx:.1f}" y1="{top:.1f}" y2="{h - bot:.1f}"/>')
        parts.append(f'<text class="tc-tick" x="{xx:.1f}" y="{h - 4:.1f}" text-anchor="middle">{_esc(_fmt(t, fmt, digits))}</text>')
    for i, cat in enumerate(cats):
        cy = top + i * row_h + row_h / 2
        parts.append(f'<text class="tc-cat" x="{label_w - 8:.1f}" y="{cy + 4:.1f}" text-anchor="end">{_esc(cat)}</text>')
        for hi, hor in enumerate(horizons):
            mid_s = series.get(hor.get("mid")) or []
            lo_s = series.get(hor.get("lo")) or []
            hi_s = series.get(hor.get("hi")) or []
            if i >= len(mid_s) or not isinstance(mid_s[i], (int, float)):
                continue
            mid = float(mid_s[i])
            lo = float(lo_s[i]) if i < len(lo_s) and isinstance(lo_s[i], (int, float)) else mid
            hi_v = float(hi_s[i]) if i < len(hi_s) and isinstance(hi_s[i], (int, float)) else mid
            yy = cy - 4 + hi * 8
            cls = f"tc-s{hi + 1}"
            fill = f"tc-f{hi + 1}"
            parts.append(
                f'<line class="tc-iqr {cls}" x1="{x_of(lo):.1f}" x2="{x_of(hi_v):.1f}" y1="{yy:.1f}" y2="{yy:.1f}"/>'
                f'<circle class="tc-end {fill}" cx="{x_of(mid):.1f}" cy="{yy:.1f}" r="3.2"/>'
            )
    return (
        f'<svg class="tc" viewBox="0 0 {w} {h}" width="100%" height="auto" role="img" '
        f'aria-label="{_esc(cfg.get("name") or "Outcomes")}" preserveAspectRatio="xMidYMid meet">{"".join(parts)}</svg>'
    )


def _svg_multiples(cfg: dict) -> str:
    data = cfg.get("data") if isinstance(cfg.get("data"), dict) else {}
    dates, cols, fmt, digits = _prepare({**cfg, "data": data}, data)
    if not dates or not cols:
        return ""
    n_cols = max(int(cfg.get("cols") or 4), 1)
    cell_h = float(cfg.get("height") or 118)
    n = len(cols)
    n_rows = math.ceil(n / n_cols)
    gap, left, top = 12, 36, 18
    w = 640
    cell_w = (w - gap * (n_cols - 1)) / n_cols
    h = n_rows * cell_h + (n_rows - 1) * gap + 8
    parts = []
    xs_n = len(dates)
    for i, spec in enumerate(cols):
        r, c = divmod(i, n_cols)
        x0 = c * (cell_w + gap)
        y0 = r * (cell_h + gap)
        nums = [float(v) for v in spec["values"] if isinstance(v, (int, float))]
        if not nums:
            continue
        y, ticks, _lo, _hi = _y_map(nums, cell_h, top, 16, bool(cfg.get("zero")))
        xs = [x0 + left + (k / max(xs_n - 1, 1)) * (cell_w - left - 8) for k in range(xs_n)]
        mapped: list[float | None] = [
            y0 + y(float(v)) if isinstance(v, (int, float)) else None for v in spec["values"]
        ]
        d = _line_d(xs, mapped)
        cls = _slot_class(spec, "tc-s")
        fill = _slot_class(spec, "tc-f")
        last = next((v for v in reversed(spec["values"]) if isinstance(v, (int, float))), None)
        parts.append(f'<text class="tc-paneltitle" x="{x0:.1f}" y="{y0 + 12:.1f}">{_esc(spec.get("label") or spec.get("col"))}</text>')
        if d:
            parts.append(f'<path class="tc-line {cls}" d="{d}"/>')
        if last is not None and xs:
            parts.append(
                f'<circle class="tc-end {fill}" cx="{xs[-1]:.1f}" cy="{y0 + y(float(last)):.1f}" r="2.6"/>'
                f'<text class="tc-endvalue" x="{xs[-1] - 4:.1f}" y="{y0 + 14:.1f}" text-anchor="end">{_esc(_fmt(float(last), fmt, digits))}</text>'
            )
        if ticks:
            parts.append(
                f'<text class="tc-tick" x="{x0:.1f}" y="{y0 + cell_h - 2:.1f}">{_esc(_fmt(ticks[0], fmt, digits))}</text>'
            )
    name = _esc(cfg.get("name") or "Series")
    return (
        f'<svg class="tc" viewBox="0 0 {w} {h}" width="100%" height="auto" role="img" aria-label="{name}" '
        f'preserveAspectRatio="xMidYMid meet">{"".join(parts)}</svg>'
    )


def _svg_hbars(cfg: dict, blob: dict | None) -> str:
    dates, cols, fmt, digits = _prepare(cfg, blob)
    rows = []
    for spec in cols:
        last = next((v for v in reversed(spec["values"]) if isinstance(v, (int, float))), None)
        if last is None:
            continue
        rows.append((spec.get("label") or spec.get("col") or "", float(last), spec))
    data = cfg.get("data") if isinstance(cfg.get("data"), dict) else {}
    cats = data.get("categories")
    if cats and cols:
        rows = []
        for i, cat in enumerate(cats):
            spec = cols[0]
            vals = spec["values"]
            if i < len(vals) and isinstance(vals[i], (int, float)):
                rows.append((str(cat), float(vals[i]), spec))
    if not rows:
        return ""
    nums = [v for _l, v, _s in rows]
    w, row_h, left, top, bot = 640, 22, 160, 8, 20
    h = top + bot + row_h * len(rows)
    x_of, ticks, _lo, _hi = _x_map(nums, w, left, 16, True)

    x0 = x_of(0.0)
    parts = []
    for t in ticks:
        xx = x_of(t)
        parts.append(f'<line class="tc-grid" x1="{xx:.1f}" x2="{xx:.1f}" y1="{top:.1f}" y2="{h - bot:.1f}"/>')
        parts.append(f'<text class="tc-tick" x="{xx:.1f}" y="{h - 4:.1f}" text-anchor="middle">{_esc(_fmt(t, fmt, digits))}</text>')
    for i, (label, val, spec) in enumerate(rows):
        cy = top + i * row_h + row_h / 2
        fill = _slot_class(spec, "tc-f")
        xx = x_of(val)
        x_start, width = (x0, xx - x0) if val >= 0 else (xx, x0 - xx)
        parts.append(f'<text class="tc-cat" x="{left - 8:.1f}" y="{cy + 4:.1f}" text-anchor="end">{_esc(label)}</text>')
        parts.append(
            f'<rect class="tc-bar {fill}" x="{x_start:.1f}" y="{cy - 6:.1f}" width="{max(width, 0.8):.1f}" height="12"/>'
        )
        parts.append(f'<text class="tc-barvalue" x="{xx + 6:.1f}" y="{cy + 4:.1f}">{_esc(_fmt(val, fmt, digits))}</text>')
    name = _esc(cfg.get("name") or "Chart")
    return (
        f'<svg class="tc" viewBox="0 0 {w} {h}" width="100%" height="auto" role="img" aria-label="{name}" '
        f'preserveAspectRatio="xMidYMid meet">{"".join(parts)}</svg>'
    )


def render_chart(cfg: dict, blob: dict | None) -> str:
    kind = str(cfg.get("kind") or "line").lower()
    if kind == "outcomes":
        return _svg_outcomes(cfg)
    if kind == "multiples":
        return _svg_multiples(cfg)
    if kind in ("hbars", "dots"):
        return _svg_hbars(cfg, blob)
    if kind in ("line", "bars", "band", "share", "range", "forest", "histogram", "scatter"):
        return _svg_line(cfg, blob, "bars" if kind in ("bars", "histogram") else "band" if kind == "band" else "line")
    return _svg_line(cfg, blob, "line")


def _table_html(dates: list[str], cols: list[dict], fmt: str, digits: int) -> str:
    if not dates or not cols:
        return ""
    n = min(len(dates), _MAX_TABLE_ROWS)
    start = max(len(dates) - n, 0)
    head = "".join(f"<th>{_esc(c.get('label') or c.get('col'))}</th>" for c in cols)
    body = []
    for i in range(start, len(dates)):
        cells = "".join(
            f"<td>{_esc(_fmt(float(c['values'][i]), fmt, digits) if i < len(c['values']) and isinstance(c['values'][i], (int, float)) else '')}</td>"
            for c in cols
        )
        body.append(f"<tr><td>{_esc(dates[i][:10])}</td>{cells}</tr>")
    return f'<table class="data dense"><thead><tr><th>Date</th>{head}</tr></thead><tbody>{"".join(body)}</tbody></table>'


def _cfg_of(el: Tag) -> dict | None:
    raw = el.get("data-chart")
    if not raw or not isinstance(raw, str):
        return None
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError:
        try:
            cfg = json.loads(html.unescape(raw))
        except json.JSONDecodeError:
            return None
    return cfg if isinstance(cfg, dict) else None


def _replace_plot(el: Tag, svg: str) -> None:
    plot = el.find("div", class_="plot")
    if not plot or not isinstance(plot, Tag):
        return
    plot.clear()
    if not svg:
        p = BeautifulSoup('<p class="loading">Chart unavailable</p>', "html.parser")
        for child in list(p.children):
            plot.append(child)
        return
    frag = BeautifulSoup(svg, "html.parser")
    node = frag.find("svg")
    if node:
        plot.append(node)


def _fill_tableview(el: Tag, cfg: dict, blob: dict | None) -> None:
    tv = el.find(class_="tableview")
    if not tv or not isinstance(tv, Tag):
        return
    dates, cols, fmt, digits = _prepare(cfg, blob)
    markup = _table_html(dates, cols, fmt, digits)
    if not markup:
        return
    tv.clear()
    frag = BeautifulSoup(markup, "html.parser")
    table = frag.find("table")
    if table:
        tv.append(table)
    tv["hidden"] = True


def _rewrite_csv(el: Tag, cfg: dict) -> None:
    from app.backoffice.market_desk import rebase

    src = cfg.get("src")
    btn = el.find("button", attrs={"data-act": "csv"})
    if not btn or not isinstance(btn, Tag):
        return
    if not src:
        return
    cols = ",".join(s["col"] for s in (cfg.get("series") or []) if isinstance(s, dict) and s.get("col"))
    href = rebase(str(src))
    q = {"format": "csv"}
    if cols:
        q["cols"] = cols
    sep = "&" if "?" in href else "?"
    a = BeautifulSoup("", "html.parser").new_tag("a")
    a["class"] = " ".join([*(btn.get("class") or []), "tool"])
    a["href"] = f"{href}{sep}{urlencode(q)}"
    a["download"] = ""
    a.string = btn.get_text(" ", strip=True) or "Download CSV"
    btn.replace_with(a)


def _harvest(root: Tag) -> None:
    global _live_pages, _live_at
    found: list[tuple[str, str, str]] = []
    for a in root.find_all("a"):
        if not isinstance(a, Tag):
            continue
        href = (a.get("href") or "").split("?", 1)[0]
        title = a.get_text(" ", strip=True)
        if not title or len(title) > 80:
            continue
        path = ""
        if href.startswith("/backoffice/markets/"):
            path = href[len("/backoffice/markets") :] or "/"
        elif href.startswith("/") and not href.startswith(("/api/", "/backoffice")):
            last = href.rstrip("/").rsplit("/", 1)[-1]
            if "." in last and not last.endswith(".html"):
                continue
            path = href
        if not path or path in ("/",):
            continue
        if not path.endswith("/") and "." not in path.rsplit("/", 1)[-1]:
            path += "/"
        found.append((path, title, path.strip("/").split("/")[0].title() if path.strip("/") else "Markets"))
    if not found:
        return
    with _live_lock:
        seen = {(p, t) for p, t, _s in _live_pages}
        for item in found:
            if (item[0], item[1]) not in seen:
                _live_pages.append(item)
                seen.add((item[0], item[1]))
        if len(_live_pages) > 800:
            _live_pages[:] = _live_pages[-800:]
        _live_at = time.monotonic()


def _refresh_indices() -> None:
    global _live_pages, _live_at
    now = time.monotonic()
    with _live_lock:
        if _live_at and now - _live_at < CATALOG_TTL and any("/indices/" in p for p, _t, _s in _live_pages):
            return
    from app.backoffice.market_desk import fetch_upstream

    try:
        status, ctype, data = fetch_upstream("indices/")
    except HTTPException:
        return
    if status >= 400 or "html" not in (ctype or "").lower():
        return
    text = data.decode("utf-8", errors="replace")
    extra: list[tuple[str, str, str]] = []
    for m in re.finditer(r'href="(/indices/[^"]+/)"[^>]*>([^<]+)', text):
        extra.append((m.group(1), html.unescape(m.group(2)).strip(), "Indices"))
    if not extra:
        return
    with _live_lock:
        seen = {(p, t) for p, t, _s in _live_pages}
        for item in extra:
            if (item[0], item[1]) not in seen:
                _live_pages.append(item)
                seen.add((item[0], item[1]))
        _live_at = time.monotonic()


def search_catalog(q: str, fetch_live: bool = False) -> list[dict[str, str]]:
    words = [w for w in q.lower().split() if w]
    if not words:
        return []
    if fetch_live:
        _refresh_indices()
    pages = list(STATIC_PAGES)
    with _live_lock:
        pages += list(_live_pages)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for path, title, subtitle in pages:
        hay = f"{title} {path} {subtitle}".lower()
        if not all(w in hay for w in words):
            continue
        key = path.rstrip("/") or "/"
        if key in seen:
            continue
        seen.add(key)
        out.append({"path": path if path.endswith("/") or path == "/" else path + "/", "title": title, "subtitle": subtitle})
        if len(out) >= 40:
            break
    return out


def _fill_search(root: Tag, path: str, query: str) -> None:
    slug = path.replace("\\", "/").strip("/").split("/")[-1] if path.strip("/") else ""
    if slug != "search":
        return
    q = (parse_qs(query).get("q") or [""])[0].strip()
    status = root.find(attrs={"data-status": True}) or root.find(class_="search-status")
    results = root.find(attrs={"data-results": True}) or root.find(class_="search-results")
    more = root.find(attrs={"data-more": True})
    if more and isinstance(more, Tag):
        more["hidden"] = True
    if not isinstance(results, Tag):
        return
    results.clear()
    if not q:
        if isinstance(status, Tag):
            status.string = ""
        return
    hits = search_catalog(q, fetch_live=True)
    if isinstance(status, Tag):
        status.string = f"{len(hits)} {'page' if len(hits) == 1 else 'pages'}" if hits else f"Nothing matches “{q}”."
    from app.backoffice.market_desk import rebase

    for hit in hits:
        href = rebase(hit["path"])
        li = BeautifulSoup(
            f'<li><a class="sr-title" href="{_esc(href)}">{_esc(hit["title"])}</a>'
            f'<span class="sr-path">{_esc(hit["path"])}</span>'
            f'<p class="sr-snip">{_esc(hit["subtitle"])}</p></li>',
            "html.parser",
        ).li
        if li:
            results.append(li)


def _fill_charts(root: Tag) -> None:
    nodes = [el for el in root.find_all(attrs={"data-chart": True}) if isinstance(el, Tag)]
    srcs = []
    cfgs: list[tuple[Tag, dict]] = []
    for el in nodes:
        cfg = _cfg_of(el)
        if not cfg:
            continue
        cfgs.append((el, cfg))
        if cfg.get("src"):
            srcs.append(str(cfg["src"]))
    blobs = _prefetch(srcs)
    for el, cfg in cfgs:
        try:
            src = _src_path(str(cfg.get("src") or ""))
            blob = blobs.get(src)
            if cfg.get("src") and blob is None:
                blob = load_json(src)
            svg = render_chart(cfg, blob)
            _replace_plot(el, svg)
            _fill_tableview(el, cfg, blob)
            _rewrite_csv(el, cfg)
        except Exception:  # noqa: BLE001 - one bad figure must not blank the page
            _replace_plot(el, "")


def enhance_document(html_text: str, path: str = "", query: str = "") -> str:
    soup = BeautifulSoup(f'<div id="fh-wrap">{html_text}</div>', "html.parser")
    root = soup.find(id="fh-wrap")
    if not isinstance(root, Tag):
        return html_text
    _harvest(root)
    _fill_charts(root)
    _fill_search(root, path, query)
    return root.decode_contents()


def json_to_csv(blob: dict, cols: list[str] | None = None) -> str:
    dates, series = _dates_series(blob)
    names = [c for c in (cols or list(series.keys())) if c in series]
    buf = StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", *names])
    for i, d in enumerate(dates):
        row = [d]
        for name in names:
            vals = series.get(name) or []
            v = vals[i] if i < len(vals) else ""
            row.append("" if v is None else v)
        w.writerow(row)
    return buf.getvalue()


def tables_to_csv(sheets: list[tuple[str, list[list[str]]]]) -> str:
    if not sheets:
        raise HTTPException(404, "No tables on this page.")
    buf = StringIO()
    w = csv.writer(buf)
    for title, rows in sheets:
        w.writerow([title])
        for row in rows:
            w.writerow(row)
        w.writerow([])
    return buf.getvalue()


def csv_filename(path: str) -> str:
    slug = (path or "overview").strip("/").replace("/", "-") or "overview"
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", slug).strip("-")[:60] or "overview"
    day = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y%m%d")
    return f"markets-{slug}-{day}.csv"


def json_csv_response(path: str, query: str = "") -> Response:
    blob = load_json(path)
    if not blob:
        raise HTTPException(404, "Series unavailable.")
    cols = [c for c in (parse_qs(query).get("cols") or [""])[0].split(",") if c]
    payload = json_to_csv(blob, cols or None)
    return Response(
        content=payload.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{csv_filename(path)}"',
            "Cache-Control": "private, no-store",
        },
    )
