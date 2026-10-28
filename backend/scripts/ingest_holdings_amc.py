"""Ingest AMC monthly portfolio disclosures (found via Advisorkhoj's AMC pages) into data/mf_holdings/.

    python backend/scripts/ingest_holdings_amc.py --amc "SBI Mutual Fund" --amc "Axis Mutual Fund"
    python backend/scripts/ingest_holdings_amc.py --all

Public AMC files only, rate limited; a wall or unparsable file is reported and the AMC is skipped, never worked around.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import subprocess
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.backoffice.holdings_amc import amc_slug, ingest_amc, list_amcs  # noqa: E402
from app.backoffice.holdings_ingest import write_snapshot  # noqa: E402
from app.data.loader import load_metrics  # noqa: E402

UA = "Mozilla/5.0 FundHorizonHoldingsIngest/1.0 (monthly public disclosure ingest)"
OUT = Path(__file__).resolve().parents[2] / "data" / "mf_holdings"


def fetch(url: str) -> bytes:
    time.sleep(0.5)
    # curl uses the OS trust store: some AMC hosts chain to roots Python's bundled CAs lack. Verification stays on.
    r = subprocess.run(["curl", "-sSLf", "-m", "300", "-A", UA, url], capture_output=True)
    if r.returncode:
        raise OSError(f"curl {r.returncode}: {r.stderr.decode()[:160]}")
    return r.stdout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--amc", action="append", default=[])
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    amcs = list_amcs(fetch) if a.all else a.amc
    df = load_metrics()
    dataset = list(zip(df["scheme_code"].astype(str), df["scheme_name"]))
    manifest_path = OUT / "manifest.json"
    ok = 0
    for name in amcs:
        res = ingest_amc(fetch, name, dataset)
        r = res["report"]
        print(f"{name}: sheets={r['sheets']} matched={len(r['matched'])} unmatched={len(r['unmatched'])} "
              f"bad_weight={len(r['bad_weight'])} error={r['error']}")
        if not res["rows"]:
            continue
        existing = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
        slug = amc_slug(name)
        old = max((m.get("as_of") or "" for m in (existing or {}).get("schemes", {}).values() if m.get("amc_slug") == slug), default="")
        new = max((m.get("as_of") or "" for m in res["schemes_meta"]), default="")
        if old and new and new < old:  # Advisorkhoj sometimes links an older file than the one already ingested
            print(f"  keeping {old} data for {name}; the newest link found was only {new}")
            continue
        write_snapshot(OUT, amc_slug(name), res["rows"], res["schemes_meta"], datetime.now(UTC).isoformat(), existing)
        ok += 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
