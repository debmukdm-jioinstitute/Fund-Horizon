"""Scheduled TRI population for MF Research (see index_tri.py).

Fetches ONLY the NSE TRI indices actually used by the category map
(``NSE_TRI_BY_CATEGORY`` values, deduplicated — currently 7 indices, not
the whole NSE universe), one at a time with a sleep between indices, over
a trailing window (default 5 years, so the 3Y vs-index window is always
covered). Daily points are resampled to month-end points before storage
(see ``index_tri.to_month_end_points``): the fund series is month-end
labelled, and beta / tracking error align on exact common dates.

Storage has two stages, because the production mf_benchmark_nav SQLite
lives on the EC2 host and a GitHub Actions job cannot write it:
1. This script always writes the committed seed file
   ``data/mf_benchmark_tri.json`` (unless --dry-run). The monthly
   workflow commits it, the API deploy picks it up, and the API
   upserts it into mf_benchmark_nav on first use for an index
   (``backoffice._ensure_benchmark_seed``).
2. With --write-db (run on the API host itself, FH_DB_PATH honoured),
   it also upserts directly into mf_benchmark_nav. The upsert replaces
   an instrument's rows in one transaction, so a re-run is idempotent
   and a half-download never replaces a good series.

Exits non-zero when zero indices were fetched — in particular while
the NSE endpoint is login-walled (observed 2026-10-28), so the job
fails loudly instead of shipping an empty seed. It never substitutes a
price-return series for a TRI series.

Usage:
    python backend/scripts/refresh_tri.py [--years 5] [--dry-run] [--write-db]
    python backend/scripts/refresh_tri.py --indices "NIFTY 500" "NIFTY 100"
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

# Add backend directory to sys.path so app imports work cleanly
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.backoffice import index_tri  # noqa: E402

RATE_LIMIT_SLEEP_SECONDS = 2.0
DEFAULT_YEARS = 5


def fmt_nse(d: date) -> str:
    """NSE date format: 01-Jan-2020."""
    return d.strftime("%d-%b-%Y")


def run_refresh(
    fetcher=None,
    years: int = DEFAULT_YEARS,
    index_names: list[str] | None = None,
    sleep_seconds: float = RATE_LIMIT_SLEEP_SECONDS,
    today: date | None = None,
) -> dict:
    """Fetch + month-end-resample the mapped TRI indices.

    ``fetcher`` defaults to ``index_tri.fetch_tri``; tests inject a fake.
    Returns ``{"indices": {iid: {index_name, points}}, "failed": [...]}``.
    """
    fetcher = fetcher or index_tri.fetch_tri
    today = today or date.today()
    end = today
    start = today - timedelta(days=365 * years)
    names = index_names if index_names is not None else sorted(set(index_tri.NSE_TRI_BY_CATEGORY.values()))
    out: dict[str, dict] = {}
    failed: list[dict] = []
    for i, name in enumerate(names):
        if i > 0 and sleep_seconds:
            time.sleep(sleep_seconds)
        try:
            raw = fetcher(name, fmt_nse(start), fmt_nse(end))
            points = index_tri.to_month_end_points(raw)
            if not points:
                raise ValueError(f"No month-end points for {name}")
            out[index_tri.instrument_id_for(name)] = {"index_name": name, "points": points}
            print(f"  {name}: {len(raw)} daily -> {len(points)} month-end points", flush=True)
        except Exception as exc:  # per-index failure must not kill the rest
            failed.append({"index": name, "error": f"{type(exc).__name__}: {exc}"[:300]})
            print(f"  {name}: FAILED ({type(exc).__name__})", flush=True)
    return {"indices": out, "failed": failed}


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh NSE TRI series (seed file + optional DB write)")
    parser.add_argument("--years", type=int, default=DEFAULT_YEARS)
    parser.add_argument("--indices", nargs="*", default=None, help="Subset of NSE TRI index names (default: all mapped indices)")
    parser.add_argument("--seed", default=None, help="Seed file path (default: repo data/mf_benchmark_tri.json)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch only; write nothing")
    parser.add_argument("--write-db", action="store_true", help="Also upsert into mf_benchmark_nav (run on the API host)")
    parser.add_argument("--no-sleep", action="store_true", help="Skip the between-index sleep (testing only)")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    seed_path = Path(args.seed) if args.seed else root / "data/mf_benchmark_tri.json"
    result = run_refresh(
        years=args.years, index_names=args.indices,
        sleep_seconds=0.0 if args.no_sleep else RATE_LIMIT_SLEEP_SECONDS,
    )
    print(f"Fetched {len(result['indices'])} index series; failed: {len(result['failed'])}")
    for item in result["failed"]:
        print(f"  FAILED {item['index']}: {item['error']}")
    if not result["indices"]:
        print("ERROR: zero TRI series fetched; not writing a seed or DB rows.")
        return 1
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    seed = {"generated_at": datetime.now(UTC).isoformat(), "indices": result["indices"]}
    seed_path.parent.mkdir(parents=True, exist_ok=True)
    seed_path.write_text(json.dumps(seed, indent=1, sort_keys=True))
    print(f"Wrote seed: {seed_path} ({sum(len(v['points']) for v in result['indices'].values())} month-end points)")
    if args.write_db:
        from app.backoffice.repository import BackofficeRepository

        repo = BackofficeRepository()
        for iid, series in result["indices"].items():
            n = repo.upsert_benchmark_nav(iid, series["points"])
            print(f"  DB upsert {iid}: {n} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
