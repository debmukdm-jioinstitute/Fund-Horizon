"""Monthly holdings ingest: AMC portfolio disclosures -> data/mf_holdings/.

Usage (from the repo root, or from backend/ — paths resolve to the repo):
    python backend/scripts/ingest_holdings.py [--amc motilal] [--year 2026 --month 9]
    python backend/scripts/ingest_holdings.py --dry-run [--limit 3]

Defaults to the previous month (disclosures are due by the 10th, so the
monthly scheduled run lands on the 15th). Public sources only, rate
limited; a wall for one fund is recorded in the report, never worked
around. Exits non-zero when zero schemes were matched, so a broken
source fails the scheduled job loudly instead of shipping an empty
snapshot. On success the snapshot is written and a coverage report is
printed; committing it is the caller's job (see
.github/workflows/holdings-refresh.yml).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

# Add backend directory to sys.path so app imports work cleanly
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.backoffice.holdings_ingest import (  # noqa: E402
    previous_month,
    run_motilal_ingest,
    write_snapshot,
)

AMC_SLUGS = {"motilal": "motilal_oswal"}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_dataset_rows(dataset_csv: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    with dataset_csv.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = (row.get("scheme_code") or "").strip()
            name = (row.get("scheme_name") or "").strip()
            if code and name:
                rows.append((code, name))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest AMC monthly portfolio holdings")
    parser.add_argument("--amc", default="motilal", choices=sorted(AMC_SLUGS),
                        help="AMC adapter (only motilal has a proven parser in this pass)")
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--month", type=int, default=None)
    parser.add_argument("--dataset", default=None, help="Dataset CSV (default: repo data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv)")
    parser.add_argument("--out-dir", default=None, help="Snapshot dir (default: repo data/mf_holdings)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and parse, but write nothing")
    parser.add_argument("--limit", type=int, default=None, help="Only ingest the first N fund pages (testing)")
    parser.add_argument("--no-sleep", action="store_true", help="Skip the between-request sleep (testing only)")
    args = parser.parse_args()

    root = repo_root()
    dataset_csv = Path(args.dataset) if args.dataset else root / "data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv"
    out_dir = Path(args.out_dir) if args.out_dir else root / "data/mf_holdings"
    year, month = args.year, args.month
    if (year is None) != (month is None):
        parser.error("--year and --month must be given together")
    if year is None or month is None:
        today = datetime.now(UTC)
        year, month = previous_month(today.year, today.month)

    dataset_rows = load_dataset_rows(dataset_csv)
    print(f"Dataset rows: {len(dataset_rows)}; target month: {year}-{month:02d}", flush=True)
    result = run_motilal_ingest(
        dataset_rows=dataset_rows, year=year, month=month,
        sleep_seconds=0.0 if args.no_sleep else 0.3, limit=args.limit,
    )
    report = result["report"]
    print(json.dumps({k: v for k, v in report.items() if k != "matched_schemes"}, indent=1)[:4000])
    print(f"Matched schemes: {report['matched_scheme_count']}; rows: {report['rows']}")
    if report["unmatched_disclosures"]:
        print("Unmatched disclosures (no exact dataset match, skipped):")
        for name in report["unmatched_disclosures"]:
            print(f"  - {name}")
    if report["failed_pages"]:
        print("Failed pages:")
        for item in report["failed_pages"]:
            print(f"  - {item['page']}: {item['error']}")
    if report["warnings"]:
        print("Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")
    if report["matched_scheme_count"] == 0:
        print("ERROR: zero schemes matched; not writing a snapshot.")
        return 1
    if args.dry_run:
        print("Dry run: snapshot not written.")
        return 0
    schemes_meta: list[dict[str, Any]] = []
    for matched in report["matched_schemes"]:
        for code in matched["scheme_codes"]:
            schemes_meta.append({
                "scheme_code": code, "scheme_name": matched["scheme_name"],
                "amc": report["amc"], "as_of": matched["as_of"], "source_url": matched["source_url"],
            })
    existing = None
    manifest_path = out_dir / "manifest.json"
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text())
        except ValueError:
            existing = None
    manifest = write_snapshot(
        out_dir, AMC_SLUGS[args.amc], result["rows"], schemes_meta,
        generated_at=datetime.now(UTC).isoformat(), existing_manifest=existing,
    )
    print(f"Wrote snapshot: {manifest['files']} ({len(manifest['schemes'])} scheme codes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
