"""Daily data-refresh orchestrator for Fund Horizon.

Syncs mutual fund master directory and performance metrics into the
active database repository (SQLite or PostgreSQL), updates data_asof timestamps,
and regenerates static RAG markdown documents.

Usage:
    python backend/scripts/refresh_data.py [--dry-run] [--regenerate-docs]
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

# Add backend directory to sys.path so app imports work cleanly
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.data.loader import load_metrics
from app.db import get_repository

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("refresh_data")


def refresh_fund_database(dry_run: bool = False) -> tuple[int, int]:
    """Sync metrics and master data into the database repository."""
    logger.info("Loading metrics dataframe from CSV...")
    df = load_metrics()
    total_rows = len(df)
    logger.info(f"Loaded {total_rows} schemes from dataset.")

    funds_payload: list[dict] = []
    metrics_payload: list[dict] = []

    for _, row in df.iterrows():
        code = str(row.get("scheme_code", ""))
        if not code:
            continue

        fund_entry = {
            "scheme_code": code,
            "scheme_name": str(row.get("scheme_name", "")),
            "amc": str(row.get("amc", "")),
            "category": str(row.get("category", "")),
            "plan": str(row.get("plan", "Regular")),
            "option": str(row.get("option", "Growth")),
            "isin": str(row.get("isin", "")) if row.get("isin") else None,
            "latest_nav": float(row["latest_nav"]) if row.get("latest_nav") is not None and not str(row["latest_nav"]).lower() == "nan" else None,
            "latest_nav_date": str(row.get("latest_nav_date", "")) if row.get("latest_nav_date") else None,
            "data_quality": str(row.get("data_quality", "ok")),
        }
        funds_payload.append(fund_entry)

        def _get_float(key: str) -> float | None:
            val = row.get(key)
            if val is None or str(val).lower() == "nan":
                return None
            try:
                return float(val)
            except (ValueError, TypeError):
                return None

        metric_entry = {
            "scheme_code": code,
            "ret_1m": _get_float("ret_1m"),
            "ret_3m": _get_float("ret_3m"),
            "ret_6m": _get_float("ret_6m"),
            "ret_1y": _get_float("ret_1y"),
            "cagr_3y": _get_float("cagr_3y"),
            "cagr_5y": _get_float("cagr_5y"),
            "cagr_7y": _get_float("cagr_7y"),
            "cagr_10y": _get_float("cagr_10y"),
            "vol_3y": _get_float("vol_3y"),
            "sharpe_3y": _get_float("sharpe_3y"),
            "sortino_3y": _get_float("sortino_3y"),
            "max_drawdown_3y": _get_float("max_drawdown_3y"),
            "max_drawdown_all": _get_float("max_drawdown_all"),
            "data_asof": str(row.get("data_asof", "2026-10-09")),
        }
        metrics_payload.append(metric_entry)

    if dry_run:
        logger.info(f"[DRY RUN] Would upsert {len(funds_payload)} funds and {len(metrics_payload)} metrics records.")
        return len(funds_payload), len(metrics_payload)

    repo = get_repository()
    logger.info(f"Using repository: {repo.__class__.__name__}")

    logger.info(f"Upserting {len(funds_payload)} fund records...")
    t0 = time.time()
    n_funds = repo.upsert_funds(funds_payload)
    logger.info(f"Upserted {n_funds} funds in {time.time() - t0:.2f}s.")

    logger.info(f"Upserting {len(metrics_payload)} metric records...")
    t1 = time.time()
    n_metrics = repo.upsert_metrics(metrics_payload)
    logger.info(f"Upserted {n_metrics} metrics in {time.time() - t1:.2f}s.")

    return n_funds, n_metrics


def regenerate_docs() -> None:
    """Regenerate markdown & JSON scheme documents."""
    from scripts.generate_docs import generate_all_docs

    logger.info("Regenerating scheme markdown and RAG dataset...")
    generate_all_docs()
    logger.info("Scheme documentation regeneration complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Fund Horizon data refresh orchestrator")
    parser.add_argument("--dry-run", action="store_true", help="Simulate data sync without writing to database")
    parser.add_argument("--regenerate-docs", action="store_true", help="Regenerate static RAG markdown & JSON docs")
    args = parser.parse_args()

    logger.info("Starting daily data refresh...")
    funds_count, metrics_count = refresh_fund_database(dry_run=args.dry_run)
    logger.info(f"Database refresh finished: {funds_count} funds, {metrics_count} metrics.")

    if args.regenerate_docs:
        regenerate_docs()

    logger.info("Data refresh orchestrator finished successfully.")


if __name__ == "__main__":
    main()
