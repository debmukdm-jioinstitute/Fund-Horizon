"""Backfill past monthly APMI PMS snapshots so strategy history has more than one point.

Usage:
    python backend/scripts/backfill_apmi_history.py [--months 36]
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.backoffice.collectors import _REPO
from app.backoffice.providers import apmi

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill_apmi_history")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=36)
    args = ap.parse_args()
    for as_on in apmi.candidate_months(count=args.months):
        snap = apmi.fetch_snapshot([as_on])
        if snap is None:
            logger.warning("%s: APMI has no data, skipped", as_on)
            continue
        n = _REPO.replace_pms_universe(snap.as_on, snap.providers, snap.strategies)
        logger.info("%s: stored %d strategies", as_on, n)


if __name__ == "__main__":
    main()
