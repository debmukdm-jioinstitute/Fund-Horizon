"""Equity holdings from Advisorkhoj's common-stocks tool for funds no AMC file covered (blocked / JavaScript-only AMC sites).

    python backend/scripts/ingest_holdings_advisorkhoj.py

Run after ingest_holdings_amc.py: it skips every fund that already has a full disclosure and rewrites only its own
"advisorkhoj" snapshot files. Equity holdings only (the tool has no debt, cash or derivatives), so each fund carries the
share of NAV it covers. Public pages, rate limited, no login.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.backoffice import holdings_advisorkhoj as AK  # noqa: E402
from app.backoffice.holdings_amc import amc_slug  # noqa: E402
from app.backoffice.holdings_ingest import write_snapshot  # noqa: E402
from app.backoffice.mf_holdings import normalize_scheme_name  # noqa: E402
from app.data.loader import load_metrics  # noqa: E402

UA = "Mozilla/5.0 FundHorizonHoldingsIngest/1.0 (monthly public disclosure ingest)"
OUT = Path(__file__).resolve().parents[2] / "data" / "mf_holdings"
NOTE = "Equity holdings only, from Advisorkhoj (its tool has no debt, cash or derivatives); sector copied from other funds' disclosures of the same company."


def _curl(args: list[str]) -> bytes:
    time.sleep(0.6)
    r = subprocess.run(["curl", "-sSLf", "-m", "120", "-A", UA, *args], capture_output=True)  # OS trust store; verification stays on
    if r.returncode:
        raise OSError(f"curl {r.returncode}: {r.stderr.decode()[:160]}")
    return r.stdout


def get(url: str) -> bytes:
    return _curl([url])


def post(url: str, data: dict) -> bytes:
    return _curl(["-d", urlencode(data), url])


def main() -> int:
    spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("build_capture_ratio.py"))
    cap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cap)  # AK_CATS: our category key -> Advisorkhoj category names (equity and hybrid)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"schemes": {}}
    covered = {c for c, m in manifest["schemes"].items() if m.get("amc_slug") != "advisorkhoj"}
    from app.backoffice import mf_holdings

    snap = mf_holdings.load_snapshot()
    sectors = AK.sector_lookup({"schemes": {c: s for c, s in snap["schemes"].items() if c in covered}})
    df = load_metrics()
    by_key: dict[str, list[tuple[str, str, str]]] = {}
    for code, name, amc in zip(df["scheme_code"].astype(str), df["scheme_name"], df["amc"]):
        if code not in covered:
            by_key.setdefault(normalize_scheme_name(name), []).append((code, name, amc))
    first = date.today().replace(day=1)
    as_of = (first - timedelta(days=1)).isoformat()  # Advisorkhoj shows its latest loaded portfolio; no date on the page
    rows: list[dict] = []
    meta: list[dict] = []
    done: set[str] = set()
    for ak_cats in cap.AK_CATS.values():
        for category in ak_cats:
            targets = [n for n in AK.scheme_names(post, category) if normalize_scheme_name(n) in by_key and n not in done]
            for i in range(0, len(targets), AK.BATCH):
                batch = targets[i:i + AK.BATCH]
                if len(batch) < 2:
                    batch = batch + [n for n in AK.scheme_names(post, category) if n not in batch][:1]  # tool needs 2+ schemes
                try:
                    got = AK.fetch_batch(get, category, batch)
                except Exception as exc:
                    print(f"  {category}: batch failed ({str(exc)[:80]})")
                    continue
                for name, hs in got.items():
                    key = normalize_scheme_name(name)
                    if not hs or key not in by_key or name in done:
                        continue
                    done.add(name)
                    cov = round(sum(h["weight_pct"] for h in hs), 2)
                    for code, sname, amc in by_key[key]:
                        meta.append({"scheme_code": code, "scheme_name": name, "amc": amc, "as_of": as_of, "coverage_pct": cov, "note": NOTE,
                                     "source_url": "https://www.advisorkhoj.com/mutual-funds-research/common-stocks-across-mf-schemes"})
                        rows.extend({"scheme_code": code, "holding_name": h["name"], "isin": "",
                                     "sector": sectors.get(AK.company_key(h["name"]), ""), "weight_pct": h["weight_pct"],
                                     "instrument_type": "equity"} for h in hs)
            print(f"{category}: {len(targets)} uncovered schemes", flush=True)
    if not rows:
        print("nothing fetched")
        return 1
    write_snapshot(OUT, "advisorkhoj", rows, meta, datetime.now(UTC).isoformat(), manifest)
    print(f"advisorkhoj: {len(meta)} fund codes, {len(done)} schemes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
