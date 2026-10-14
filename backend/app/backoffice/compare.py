"""Side-by-side compare payload for backoffice PMS and MF (single batched builder)."""
from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, Literal

import pandas as pd
from fastapi import HTTPException

from app.backoffice.providers.mfapi import MfapiProvider
from app.backoffice.repository import BackofficeRepository
from app.data.loader import load_metrics, load_nav
from app.engine import analytics as an
from app.engine.stress import category_median_series

CompareType = Literal["pms", "mf"]
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 3600.0
_MFAPI = MfapiProvider()


def _cache_key(compare_type: CompareType, ids: list[str]) -> str:
    return f"{compare_type}:{','.join(sorted(ids))}"


def _nan_none(v: float | None) -> float | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except TypeError:
        pass
    return float(v)


def _pct(v: float | None) -> float | None:
    v = _nan_none(v)
    if v is None:
        return None
    return round(v * 100.0, 2) if abs(v) <= 1.5 else round(v, 2)


def _parse_inception(raw: str | None) -> pd.Timestamp | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d %B %Y", "%d %b %Y"):
        try:
            return pd.Timestamp(datetime.strptime(raw, fmt).date())
        except ValueError:
            continue
    try:
        return pd.Timestamp(raw)
    except (ValueError, TypeError):
        return None


def _month_end_nav(nav: pd.Series) -> pd.Series:
    if nav.empty:
        return nav
    monthly = nav.resample("ME").last().dropna()
    return monthly if not monthly.empty else nav


def _common_start(inceptions: list[pd.Timestamp | None]) -> pd.Timestamp | None:
    valid = [d for d in inceptions if d is not None]
    if not valid:
        return None
    return max(valid)


def _rebase_series(nav: pd.Series, start: pd.Timestamp | None, max_points: int = 120) -> list[list[Any]]:
    s = _month_end_nav(nav.sort_index())
    if start is not None:
        s = s.loc[s.index >= start]
    s = s.dropna()
    if len(s) < 2:
        return []
    base = float(s.iloc[0])
    if base <= 0:
        return []
    rebased = (s / base * 100.0).astype(float)
    if len(rebased) > max_points:
        step = max(1, len(rebased) // max_points)
        rebased = rebased.iloc[::step]
        if rebased.index[-1] != s.index[-1]:
            rebased = pd.concat([rebased, pd.Series({s.index[-1]: float(s.iloc[-1] / base * 100.0)})])
    return [[d.strftime("%Y-%m-%d"), round(float(v), 4)] for d, v in rebased.items()]


def _resolve_pms(repo: BackofficeRepository, token: str, as_on: str | None) -> dict[str, Any] | None:
    as_on = as_on or repo.latest_pms_as_on()
    if not as_on:
        return None
    if "::" in token:
        provider, strategy_name = token.split("::", 1)
        rows = repo.list_pms_apmi_history(provider.strip(), strategy_name.strip())
        if rows:
            latest = next((r for r in rows if r.get("as_on") == as_on), rows[-1])
            return latest
    conn_row = repo.get_pms_apmi_by_ia_id(token, as_on) if token else None
    if conn_row:
        return conn_row
    return None


def _pms_series_from_history(rows: list[dict[str, Any]], start: pd.Timestamp | None) -> list[list[Any]]:
    if not rows:
        return []
    points: list[tuple[pd.Timestamp, float]] = []
    for r in rows:
        as_on = r.get("as_on")
        ret = r.get("return_since_inception")
        if not as_on or ret is None:
            continue
        try:
            ts = pd.Timestamp(f"{as_on}-01") if len(str(as_on)) == 7 else pd.Timestamp(str(as_on))
            points.append((ts, float(ret)))
        except (ValueError, TypeError):
            continue
    if len(points) < 2:
        return []
    points.sort(key=lambda x: x[0])
    base = points[0][1]
    if base == 0:
        return []
    series = [(ts, (val / base) * 100.0) for ts, val in points]
    if start is not None:
        series = [(ts, v) for ts, v in series if ts >= start]
    if len(series) < 2:
        return []
    if len(series) > 120:
        step = max(1, len(series) // 120)
        series = series[::step]
    return [[ts.strftime("%Y-%m-%d"), round(v, 4)] for ts, v in series]


def _mf_nav_for_code(code: str) -> tuple[pd.Series, str]:
    try:
        nav = load_nav(code)
        if len(nav) >= 2:
            return nav, "derived"
    except (FileNotFoundError, OSError, ValueError):
        pass
    res = _MFAPI.fetch_scheme(code)
    if not res.success or not res.observations:
        return pd.Series(dtype=float), "mfapi"
    obs = sorted(res.observations, key=lambda o: o.observed_at)
    idx = pd.to_datetime([o.observed_at for o in obs])
    vals = [float(o.value_numeric) for o in obs]
    return pd.Series(vals, index=idx).sort_index(), "mfapi"


def _mf_item(repo: BackofficeRepository, code: str) -> dict[str, Any]:
    metrics_df = load_metrics()
    row = metrics_df.loc[metrics_df["scheme_code"] == str(code)]
    nav, nav_source = _mf_nav_for_code(code)
    if row.empty:
        db_rows = repo.get_mf_schemes_by_codes([str(code)])
        if not db_rows:
            raise HTTPException(422, f"Unknown mutual fund scheme: {code}")
        db = db_rows[0]
        name = db.get("scheme_name") or code
        category = db.get("category")
        amc = db.get("amc")
        ter = db.get("ter_pct")
        inception = db.get("first_nav_date") or db.get("nav_date")
        metrics = {k: None for k in (
            "ret_1y", "ret_3y", "ret_5y", "ret_si", "cagr", "std_dev", "sharpe", "sortino",
            "alpha", "beta", "max_dd", "up_capture", "down_capture", "ter", "aum", "nav_or_min_ticket",
            "manager", "manager_tenure", "quartile",
        )}
        metrics["ter"] = _nan_none(ter)
        metrics["nav_or_min_ticket"] = _nan_none(db.get("latest_nav"))
        source = nav_source
    else:
        r = row.iloc[0]
        name = str(r["scheme_name"])
        category = str(r.get("category") or "")
        amc = str(r.get("amc") or "")
        inception = str(r.get("first_nav_date") or r.get("last_nav_date") or "")
        cat = str(r.get("cat") or "")
        start_3y = nav.index[-1] - pd.DateOffset(years=3) if len(nav) > 1 else nav.index[0]
        nav_3y = nav.loc[nav.index >= start_3y] if len(nav) > 1 else nav
        vol_3y = an.annualized_volatility(nav_3y) if len(nav_3y) > 1 else None
        cagr_3y = an.trailing_return(nav, years=3)
        sharpe = an.sharpe_ratio(cagr_3y, vol_3y, rf=0.065) if vol_3y else None
        sortino = an.sortino_ratio(nav_3y, cagr_3y, rf=0.065) if len(nav_3y) > 1 else None
        cat_med = category_median_series(metrics_df, cat, min_funds=3) if cat else pd.Series(dtype=float)
        capture = an.capture_ratios(nav, cat_med) if len(cat_med) > 1 else {}
        metrics = {
            "ret_1y": _pct(_nan_none(r.get("ret_1y"))),
            "ret_3y": _pct(_nan_none(r.get("cagr_3y"))),
            "ret_5y": _pct(_nan_none(r.get("cagr_5y"))),
            "ret_si": _pct(_nan_none(r.get("cagr_since_inception"))),
            "cagr": _pct(cagr_3y),
            "std_dev": _pct(vol_3y),
            "sharpe": _nan_none(sharpe),
            "sortino": _nan_none(sortino),
            "alpha": None,
            "beta": None,
            "max_dd": _pct(_nan_none(r.get("max_drawdown_3y"))),
            "up_capture": _nan_none(capture.get("upside_capture")),
            "down_capture": _nan_none(capture.get("downside_capture")),
            "ter": None,
            "aum": None,
            "nav_or_min_ticket": _nan_none(r.get("latest_nav")),
            "manager": None,
            "manager_tenure": None,
            "quartile": None,
        }
        db_rows = repo.get_mf_schemes_by_codes([str(code)])
        if db_rows:
            metrics["ter"] = _nan_none(db_rows[0].get("ter_pct"))
        source = "derived"

    inc_ts = _parse_inception(str(inception) if inception else None)
    return {
        "id": str(code),
        "name": name,
        "category": category,
        "amc_or_manager": amc,
        "inception": inception or None,
        "_inception_ts": inc_ts,
        "_nav": nav,
        "_source": source,
        "metrics": metrics,
    }


def _pms_item(repo: BackofficeRepository, token: str) -> dict[str, Any]:
    as_on = repo.latest_pms_as_on()
    row = _resolve_pms(repo, token, as_on)
    if not row:
        raise HTTPException(422, f"Unknown PMS strategy: {token}")
    provider = row.get("provider") or ""
    strategy_name = row.get("strategy_name") or ""
    history = repo.list_pms_apmi_history(provider, strategy_name)
    metrics = {
        "ret_1y": _nan_none(row.get("return_1y")),
        "ret_3y": _nan_none(row.get("return_3y")),
        "ret_5y": _nan_none(row.get("return_5y")),
        "ret_si": _nan_none(row.get("return_since_inception")),
        "cagr": _nan_none(row.get("return_3y")),  # APMI reports are already in %
        "std_dev": None,
        "sharpe": None,
        "sortino": None,
        "alpha": None,
        "beta": None,
        "max_dd": None,
        "up_capture": None,
        "down_capture": None,
        "ter": None,
        "aum": _nan_none(row.get("aum_crore")),
        "nav_or_min_ticket": None,
        "manager": row.get("principal_officer"),
        "manager_tenure": None,
        "quartile": None,
    }
    return {
        "id": token,
        "name": strategy_name,
        "category": row.get("strategy_type"),
        "amc_or_manager": provider,
        "inception": None,
        "_inception_ts": None,
        "_history": history,
        "_source": "apmi",
        "metrics": metrics,
    }


def build_compare_payload(repo: BackofficeRepository, compare_type: CompareType, ids: list[str]) -> dict[str, Any]:
    if len(ids) < 2 or len(ids) > 4:
        raise HTTPException(422, "Provide between 2 and 4 ids to compare.")

    key = _cache_key(compare_type, ids)
    cached = _CACHE.get(key)
    now = time.monotonic()
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    raw_items: list[dict[str, Any]] = []
    for token in ids:
        if compare_type == "mf":
            raw_items.append(_mf_item(repo, token))
        else:
            raw_items.append(_pms_item(repo, token))

    start = _common_start([i.get("_inception_ts") for i in raw_items])
    benchmark_nav: pd.Series | None = None
    benchmark_name = "Category median"
    meta_source = raw_items[0].get("_source", "derived")
    if compare_type == "mf":
        m = load_metrics()
        first_code = raw_items[0]["id"]
        sub = m[m["scheme_code"] == str(first_code)]
        if not sub.empty:
            cat_key = str(sub.iloc[0]["cat"])
            benchmark_nav = category_median_series(m, cat_key, min_funds=3)
            benchmark_name = f"Category median ({cat_key})"

    items: list[dict[str, Any]] = []
    for raw in raw_items:
        if compare_type == "mf":
            series = _rebase_series(raw["_nav"], start)
        else:
            series = _pms_series_from_history(raw.get("_history") or [], start)
        items.append({
            "id": raw["id"],
            "name": raw["name"],
            "category": raw.get("category"),
            "amc_or_manager": raw.get("amc_or_manager"),
            "inception": raw.get("inception"),
            "metrics": raw["metrics"],
            "series": series,
        })

    bench_series: list[list[Any]] = []
    if compare_type == "mf" and benchmark_nav is not None and len(benchmark_nav) > 1:
        bench_series = _rebase_series(benchmark_nav, start)

    payload = {
        "type": compare_type,
        "items": items,
        "benchmark": {"name": benchmark_name, "series": bench_series},
        "meta": {"fetched_at": datetime.now(UTC).isoformat(), "source": meta_source},
    }
    _CACHE[key] = (now, payload)
    return payload
