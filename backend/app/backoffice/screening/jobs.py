from __future__ import annotations
"""Nightly and on-demand screening refresh job."""

import csv
import json
import logging
import time
from typing import Any

import numpy as np
import pandas as pd

from app.backoffice.db import _utcnow
from app.backoffice.providers.amfi_ter import base_key as mf_base_key
from app.backoffice.repository import BackofficeRepository
from app.backoffice.mf_research_v2 import calendar_year_returns
from app.backoffice.screening.quartiles import (
    compute_category_quartiles,
    resolve_quartile_cascade,
)
from app.backoffice.screening.ratios import compute_consistency_metrics, compute_scheme_metrics
from app.config import load_screening
from app.data.loader import data_dir, eligible_funds, load_nav
from app.engine import analytics as an

logger = logging.getLogger("backoffice.screening.jobs")


def with_live_tail(s: pd.Series, last_nav_date: Any, today: pd.Timestamp) -> pd.Series:
    """nav_monthly labels the running month with its month-end date, so a fund's freshest NAV sits in the future.

    Dropping it made ``as_of`` lag by up to a month and every screening item read "stale". Relabel that point with
    the fund's real last NAV date instead; fall back to dropping it when that date is missing or not newer.
    """
    past = s[s.index <= today]
    if len(past) == len(s):
        return s
    last = pd.to_datetime(last_nav_date, errors="coerce")
    if pd.isna(last) or last > today or (not past.empty and last <= past.index[-1]):
        return past
    return pd.concat([past, pd.Series([s.iloc[-1]], index=[last.normalize()])])


# metric -> minimum history (years) a scheme needs before the metric must exist
COVERAGE_MIN_HISTORY = {
    "ret_1y": 1.05, "cagr_3y": 3.1, "cagr_5y": 5.1, "cagr_si": 1.05,
    "sharpe": 3.1, "sortino": 3.1, "up_capture": 3.1, "down_capture": 3.1, "quartile_2y": 3.1,
}
COVERAGE_FLOOR = 0.90


def check_coverage(rows: list[dict[str, Any]], equity_cats: set[str]) -> dict[str, float]:
    """Log per-field coverage over equity schemes with enough history; raise if any field is under the floor."""
    eq = [r for r in rows if r["cat"] in equity_cats]
    cov: dict[str, float] = {}
    for field, min_years in COVERAGE_MIN_HISTORY.items():
        elig = [r for r in eq if (r.get("history_years") or 0) >= min_years]
        if elig:
            cov[field] = sum(r.get(field) is not None for r in elig) / len(elig)
    for field, c in cov.items():
        logger.info("screening coverage %-12s %5.1f%%", field, c * 100)
    bad = {f: round(c * 100, 1) for f, c in cov.items() if c < COVERAGE_FLOOR}
    if bad:
        raise RuntimeError(f"Screening coverage below {COVERAGE_FLOOR:.0%} for equity: {bad}")
    return cov


def seed_managers(repo: BackofficeRepository) -> int:
    """Load data/mf_managers_seed.csv (scheme_code, manager_name, manager_start) when the table is empty."""
    seed = data_dir().parent / "mf_managers_seed.csv"
    if not seed.exists() or repo.list_mf_managers():
        return 0
    with seed.open(newline="") as f:
        rows = [
            {"scheme_code": r["scheme_code"].strip(), "manager_name": r["manager_name"].strip(),
             "manager_start": (r.get("manager_start") or "").strip() or None, "source": "seed", "provenance": seed.name}
            for r in csv.DictReader(f) if r.get("scheme_code") and r.get("manager_name")
        ]
    return repo.upsert_mf_managers(rows) if rows else 0


def refresh_screening(repo: BackofficeRepository | None = None) -> dict[str, Any]:
    """Execute complete screening metrics rebuild for S0 universe.

    1. Loads eligible funds (S0).
    2. Loads managers, TERs, and external quartiles.
    3. Computes category medians and benchmarks.
    4. Computes all ratios and returns for each scheme.
    5. Resolves quartiles via cascade.
    6. Persists to mf_screening_metrics table and updates collector runs.
    """
    start_time = time.time()
    repo = repo or BackofficeRepository()
    now_str = _utcnow()

    # 1. S0 Universe
    df_s0 = eligible_funds()
    if df_s0.empty:
        logger.warning("No eligible funds found for screening universe")
        return {"success": False, "records": 0, "error": "Empty S0 universe"}

    seeded = seed_managers(repo)
    if seeded:
        logger.info("Seeded %d fund managers from data/mf_managers_seed.csv", seeded)

    conn = repo._conn()
    try:
        # Load TERs
        ter_rows = conn.execute("SELECT base_key, regular_ter_pct FROM mf_ter").fetchall()
        ter_map = {r["base_key"]: r["regular_ter_pct"] for r in ter_rows if r["regular_ter_pct"] is not None}

        # Load managers
        mgr_rows = conn.execute("SELECT * FROM mf_managers").fetchall()
        mgr_map = {r["scheme_code"]: dict(r) for r in mgr_rows}

        # Load external quartiles (2Y)
        ext_q_rows = conn.execute(
            "SELECT * FROM mf_quartile_external WHERE window_years = 2 ORDER BY as_of DESC"
        ).fetchall()
        ext_q_map: dict[str, dict[str, Any]] = {}
        for r in ext_q_rows:
            code = r["scheme_code"]
            if code not in ext_q_map:
                ext_q_map[code] = dict(r)

        # Load Risk-Free rate from live 3M observation if available
        rf_obs = conn.execute(
            """
            SELECT value_numeric FROM observations
            WHERE instrument_id = 'YIELD:IN:3M'
            ORDER BY observed_at DESC LIMIT 1
            """
        ).fetchone()
        if rf_obs and rf_obs["value_numeric"] is not None and rf_obs["value_numeric"] > 0:
            rf = float(rf_obs["value_numeric"]) / 100.0
            rf_source = "live_3m"
        else:
            rf = 0.065
            rf_source = "assumptions_fixed"

    finally:
        conn.close()

    # Cache fund NAV series
    last_nav_map = dict(zip(df_s0["scheme_code"].astype(str), df_s0["last_nav_date"]))
    nav_cache: dict[str, pd.Series] = {}
    for code in df_s0["scheme_code"]:
        try:
            s = load_nav(str(code))
            s = with_live_tail(s, last_nav_map.get(str(code)), pd.Timestamp.now().normalize())
            if not s.empty and len(s) >= 2:
                nav_cache[str(code)] = s
        except Exception:
            pass

    # Group by canonical category
    cats = df_s0["cat"].unique()
    cat_peers: dict[str, list[str]] = {}
    for cat in cats:
        codes = [str(c) for c in df_s0.loc[df_s0["cat"] == cat, "scheme_code"] if str(c) in nav_cache]
        cat_peers[cat] = codes

    # Category benchmarks and returns
    cat_benchmarks: dict[str, pd.Series] = {}
    cat_bench_sources: dict[str, str] = {}
    cat_returns_2y: dict[str, dict[str, float | None]] = {}
    # MF Research V2 precompute inputs: median monthly returns per category
    # (for rolling/calendar consistency) and peer calendar-year returns.
    cat_med_returns: dict[str, pd.Series] = {}
    cat_peer_cal: dict[str, dict[int, dict[str, float]]] = {}

    for cat, codes in cat_peers.items():
        cat_returns_2y[cat] = {}
        if len(codes) >= 3:
            # Build category median returns series
            rets_df = pd.concat({c: nav_cache[c].pct_change() for c in codes}, axis=1)
            med_rets = rets_df.median(axis=1).dropna()
            cat_med_returns[cat] = med_rets
            # Convert to pseudo-NAV series for compounding calculations
            bench_series = pd.Series(100.0 * np.cumprod(1.0 + med_rets), index=med_rets.index)
            cat_benchmarks[cat] = bench_series
            cat_bench_sources[cat] = "category_median"
        else:
            cat_benchmarks[cat] = pd.Series(dtype=float)
            cat_bench_sources[cat] = "none"

        for c in codes:
            s = nav_cache[c]
            r2y = an.trailing_return(s, years=2)
            cat_returns_2y[cat][c] = r2y

        # Peer calendar-year returns for this category (from the same cache,
        # never a per-fund file load at request time).
        peer_cal: dict[int, dict[str, float]] = {}
        for c in codes:
            for year, ret in calendar_year_returns(nav_cache[c]).items():
                peer_cal.setdefault(year, {})[c] = ret
        cat_peer_cal[cat] = peer_cal

    # Compute quartiles per category
    cat_computed_q: dict[str, dict[str, int | None]] = {}
    for cat in cats:
        cat_computed_q[cat] = compute_category_quartiles(cat_returns_2y.get(cat, {}), min_peers=8)
    # MF Research V2: computed quartiles for the other research periods too,
    # stored in provenance so the funnel can honour a research preset's
    # quartile period instead of silently falling back to 2Y.
    cat_quartiles_by_period: dict[str, dict[str, dict[str, int | None]]] = {}
    for period, years in (("1y", 1), ("3y", 3), ("5y", 5)):
        cat_quartiles_by_period[period] = {}
        for cat in cats:
            rets = {c: an.trailing_return(nav_cache[c], years=years) for c in cat_peers.get(cat, [])}
            cat_quartiles_by_period[period][cat] = compute_category_quartiles(rets, min_peers=8)

    # Compute scheme preliminary metrics to get category averages (1Y, 3Y, 5Y, SI) and median TER
    cat_metrics_acc: dict[str, dict[str, list[float]]] = {
        cat: {"1y": [], "3y": [], "5y": [], "si": [], "ter": []} for cat in cats
    }

    fund_ter_assigned: dict[str, float | None] = {}
    for _, row in df_s0.iterrows():
        code = str(row["scheme_code"])
        name = str(row["scheme_name"])
        cat = str(row["cat"])
        bkey = row.get("base_key") or mf_base_key(name)
        ter_val = ter_map.get(bkey)
        fund_ter_assigned[code] = ter_val
        if ter_val is not None:
            cat_metrics_acc[cat]["ter"].append(ter_val)

        if code in nav_cache:
            s = nav_cache[code]
            r1 = an.trailing_return(s, years=1)
            r3 = an.trailing_return(s, years=3)
            r5 = an.trailing_return(s, years=5)
            rsi = an.cagr(s)
            if r1 is not None:
                cat_metrics_acc[cat]["1y"].append(r1)
            if r3 is not None:
                cat_metrics_acc[cat]["3y"].append(r3)
            if r5 is not None:
                cat_metrics_acc[cat]["5y"].append(r5)
            if rsi is not None:
                cat_metrics_acc[cat]["si"].append(rsi)

    # Compute category medians
    cat_summary_medians: dict[str, dict[str, float | None]] = {}
    cat_median_ters: dict[str, float | None] = {}
    for cat, data in cat_metrics_acc.items():
        cat_summary_medians[cat] = {
            "1y": float(np.median(data["1y"])) if data["1y"] else None,
            "3y": float(np.median(data["3y"])) if data["3y"] else None,
            "5y": float(np.median(data["5y"])) if data["5y"] else None,
            "si": float(np.median(data["si"])) if data["si"] else None,
        }
        cat_median_ters[cat] = float(np.median(data["ter"])) if data["ter"] else None

    # Compute complete rows
    screening_rows: list[dict[str, Any]] = []
    for _, row in df_s0.iterrows():
        code = str(row["scheme_code"])
        if code not in nav_cache:
            continue
        cat = str(row["cat"])
        s_nav = nav_cache[code]
        bench_nav = cat_benchmarks.get(cat)
        b_src = cat_bench_sources.get(cat, "category_median")

        m_info = mgr_map.get(code)
        ter_val = fund_ter_assigned.get(code)
        first_date = row.get("first_nav_date")

        m_row = compute_scheme_metrics(
            scheme_code=code,
            fund_nav=s_nav,
            cat=cat,
            amc=row.get("amc"),
            scheme_name=str(row["scheme_name"]),
            bench_nav=bench_nav,
            rf=rf,
            manager_info=m_info,
            expense_ratio=ter_val,
            first_nav_date=first_date,
            cat_medians_dict=cat_summary_medians.get(cat),
            benchmark_source=b_src,
            rf_source=rf_source,
        )
        if not m_row:
            continue

        # Cascade quartile
        c_q = cat_computed_q.get(cat, {}).get(code)
        ext_q_info = ext_q_map.get(code)
        ext_q = ext_q_info.get("quartile") if ext_q_info else None
        ext_src = ext_q_info.get("source") if ext_q_info else None
        final_q, q_source = resolve_quartile_cascade(code, c_q, ext_q, ext_src)
        m_row["quartile_2y"] = final_q
        m_row["quartile_source"] = q_source

        # MF Research V2 precompute: consistency metrics, quartile periods,
        # capture spread and category-median TER gap, all from the NAV cache
        # above. Stored in provenance_json (existing TEXT column) so no
        # database migration is needed on existing volumes.
        try:
            consistency = compute_consistency_metrics(
                s_nav, cat_med_returns.get(cat), cat_peer_cal.get(cat, {}), code
            )
        except Exception:
            consistency = {}
        up_c, down_c = m_row.get("up_capture"), m_row.get("down_capture")
        med_ter = cat_median_ters.get(cat)
        provenance = {
            "updated_at": now_str,
            "rf": rf,
            "rf_source": rf_source,
            "benchmark_source": b_src,
            "quartile_source": q_source,
            "cat_median_ter": med_ter,
            "roll_consistency": m_row.get("roll_consistency"),
            "consistency": consistency,
            "quartiles": {
                period: cat_quartiles_by_period[period].get(cat, {}).get(code)
                for period in ("1y", "3y", "5y")
            },
            "capture_spread": (float(up_c) - float(down_c)) if up_c is not None and down_c is not None else None,
            "ter_gap_cat_pp": (float(ter_val) - float(med_ter)) if ter_val is not None and med_ter is not None else None,
        }
        m_row["provenance_json"] = json.dumps(provenance)
        screening_rows.append(m_row)

    # Fail before publishing: a half-computed table must not replace the last good one.
    check_coverage(screening_rows, set(load_screening().get("equity_categories", [])))

    # Persist to mf_screening_metrics
    conn = repo._conn()
    try:
        with conn:
            conn.execute("DELETE FROM mf_screening_metrics")
            for r in screening_rows:
                conn.execute(
                    """
                    INSERT INTO mf_screening_metrics (
                        scheme_code, as_of, cat, amc, scheme_name,
                        manager_name, manager_tenure_years, tenure_ratio,
                        alpha, beta, std_dev, r_squared, information_ratio, tracking_error, treynor,
                        sharpe, sortino, up_capture, down_capture, max_drawdown, expense_ratio,
                        ret_1y, cagr_3y, cagr_5y, cagr_si, bench_1y, bench_3y, bench_5y, bench_si,
                        cat_avg_1y, cat_avg_3y, cat_avg_5y, cat_avg_si,
                        quartile_2y, quartile_source, rf_source, benchmark_source,
                        history_years, quality_flags, provenance_json
                    ) VALUES (
                        ?, ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?
                    )
                    """,
                    (
                        r["scheme_code"], r["as_of"], r["cat"], r["amc"], r["scheme_name"],
                        r["manager_name"], r["manager_tenure_years"], r["tenure_ratio"],
                        r["alpha"], r["beta"], r["std_dev"], r["r_squared"], r["information_ratio"], r["tracking_error"], r["treynor"],
                        r["sharpe"], r["sortino"], r["up_capture"], r["down_capture"], r["max_drawdown"], r["expense_ratio"],
                        r["ret_1y"], r["cagr_3y"], r["cagr_5y"], r["cagr_si"], r["bench_1y"], r["bench_3y"], r["bench_5y"], r["bench_si"],
                        r["cat_avg_1y"], r["cat_avg_3y"], r["cat_avg_5y"], r["cat_avg_si"],
                        r["quartile_2y"], r["quartile_source"], r["rf_source"], r["benchmark_source"],
                        r["history_years"], r["quality_flags"], r["provenance_json"]
                    ),
                )

            # Record run in collector_runs
            dur_ms = int((time.time() - start_time) * 1000)
            conn.execute(
                """
                INSERT INTO collector_runs (
                    id, source_id, status, records_ingested, error_message, duration_ms, started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"run_{int(time.time())}",
                    "SRC_SCREENING",
                    "ready",
                    len(screening_rows),
                    None,
                    dur_ms,
                    now_str,
                    _utcnow(),
                ),
            )
            # Update source_registry
            conn.execute(
                """
                UPDATE source_registry
                SET health_status = 'ready', last_attempt_at = ?, last_success_at = ?, updated_at = ?
                WHERE id = 'SRC_SCREENING'
                """,
                (now_str, now_str, now_str),
            )
    finally:
        conn.close()

    logger.info(
        "Screening metrics refreshed: %d schemes computed in %.2fs",
        len(screening_rows),
        time.time() - start_time,
    )
    return {
        "success": True,
        "records": len(screening_rows),
        "duration_ms": int((time.time() - start_time) * 1000),
        "as_of": screening_rows[0]["as_of"] if screening_rows else None,
    }
