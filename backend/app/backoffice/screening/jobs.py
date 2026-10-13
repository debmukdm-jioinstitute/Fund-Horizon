"""Nightly and on-demand screening refresh job."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import numpy as np
import pandas as pd

from app.backoffice.db import _utcnow
from app.backoffice.providers.amfi_ter import base_key as mf_base_key
from app.backoffice.repository import BackofficeRepository
from app.backoffice.screening.quartiles import (
    compute_category_quartiles,
    resolve_quartile_cascade,
)
from app.backoffice.screening.ratios import compute_scheme_metrics
from app.data.loader import eligible_funds, load_nav
from app.engine import analytics as an

logger = logging.getLogger("backoffice.screening.jobs")


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
    nav_cache: dict[str, pd.Series] = {}
    for code in df_s0["scheme_code"]:
        try:
            s = load_nav(str(code))
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

    for cat, codes in cat_peers.items():
        cat_returns_2y[cat] = {}
        if len(codes) >= 3:
            # Build category median returns series
            rets_df = pd.concat({c: nav_cache[c].pct_change() for c in codes}, axis=1)
            med_rets = rets_df.median(axis=1).dropna()
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

    # Compute quartiles per category
    cat_computed_q: dict[str, dict[str, int | None]] = {}
    for cat in cats:
        cat_computed_q[cat] = compute_category_quartiles(cat_returns_2y.get(cat, {}), min_peers=8)

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

        provenance = {
            "updated_at": now_str,
            "rf": rf,
            "rf_source": rf_source,
            "benchmark_source": b_src,
            "quartile_source": q_source,
            "cat_median_ter": cat_median_ters.get(cat),
        }
        m_row["provenance_json"] = json.dumps(provenance)
        screening_rows.append(m_row)

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
