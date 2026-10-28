from __future__ import annotations
"""Fund manager coverage: merge every compliant source into the mf_managers table, never overwriting a staff edit.

Order of trust (first hit wins per scheme):
  1. rows already in mf_managers (manual import or an earlier sync)      source as stored
  2. data/mf_managers_seed.csv                                           source "seed"
  3. data/mf_manager_cache/*.csv  (cached pulls from other sites)         source from the file's own column
  4. AMFI/SEBI reference snapshot (manager_scheme_map)                    source "amfi_snapshot"
  5. plan sibling: the same fund's other plan (Direct <-> Regular)        source "sibling:<code>"

Every stored row keeps its source, provenance and sync time, so the cache stays auditable. Nothing here scrapes a site:
sites whose robots.txt or terms forbid it (Groww's API) or whose pages carry no manager text (Advisorkhoj, checked) are
not fetched; their data can still be dropped into data/mf_manager_cache/ as CSV (scheme_code, manager_name,
manager_start, source, url, fetched_at) and is picked up on the next sync.
"""

import csv
import gzip
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from app.backoffice.fund_quartile import name_key
from app.data.loader import data_dir

logger = logging.getLogger("backoffice.manager_resolver")
_DATA = data_dir().parent
CACHE_DIR = _DATA / "mf_manager_cache"
SEED = _DATA / "mf_managers_seed.csv"
SNAPSHOT = _DATA / "India_MF_Static_Reference_Consolidated.csv.gz"


def _iso(text: str | None) -> str | None:
    """Best-effort date from AMFI wording ('Managing Since March 26, 2014', '26/03/2014', '2014-03-26T..'); None if unreadable."""
    if not text:
        return None
    t = str(text).replace("Managing Since", "").replace("Since", "").strip()
    d = pd.to_datetime(t, dayfirst=True, errors="coerce")
    return None if pd.isna(d) else d.date().isoformat()


def _read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    except OSError:
        return []


def _seed() -> dict[str, dict[str, Any]]:
    return {
        r["scheme_code"].strip(): {"manager_name": r["manager_name"].strip(), "manager_start": _iso(r.get("manager_start")), "source": "seed", "provenance": SEED.name}
        for r in _read_csv(SEED) if r.get("scheme_code") and r.get("manager_name")
    }


def _cached() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(CACHE_DIR.glob("*.csv")) if CACHE_DIR.exists() else []:
        for r in _read_csv(path):
            code, name = (r.get("scheme_code") or "").strip(), (r.get("manager_name") or "").strip()
            if code and name and code not in out:
                out[code] = {"manager_name": name, "manager_start": _iso(r.get("manager_start")), "source": r.get("source") or path.stem,
                             "provenance": f"{path.name} {r.get('url') or ''} fetched {r.get('fetched_at') or 'unknown'}".strip()}
    return out


@lru_cache(maxsize=1)
def _amfi() -> dict[str, dict[str, Any]]:
    if not SNAPSHOT.exists():
        return {}
    csv.field_size_limit(10**9)
    with gzip.open(SNAPSHOT, "rt", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    names = {r["manager_id"]: r["full_name"] for r in rows if r["record_type"] == "fund_manager_master" and r.get("full_name")}
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r["record_type"] != "manager_scheme_map" or r["manager_id"] not in names or r["amfi_scheme_code"] in out:
            continue
        start = _iso(r.get("start_date_managing")) or _iso(r.get("start_date_as_stated"))
        out[r["amfi_scheme_code"]] = {"manager_name": names[r["manager_id"]], "manager_start": start, "source": "amfi_snapshot", "provenance": "AMFI/SEBI static reference snapshot"}
    return out


def resolve(universe: pd.DataFrame, stored: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """{scheme_code: row} for every scheme in `universe` (columns code, amc, name) that any source can place."""
    layers = [stored, _seed(), _cached(), _amfi()]
    out: dict[str, dict[str, Any]] = {}
    for code in universe["code"].astype(str):
        for layer in layers:
            if code in layer:
                out[code] = layer[code]
                break
    # Plan sibling: a fund's Direct and Regular plans share a manager and start date.
    by_fund: dict[tuple[str, str], str] = {}
    keys = {str(c): (str(a), name_key(str(n))) for c, a, n in zip(universe["code"], universe["amc"], universe["name"])}
    for code, k in keys.items():
        if code in out:
            by_fund.setdefault(k, code)
    for code, k in keys.items():
        if code not in out and k in by_fund and k[1]:
            src = by_fund[k]
            out[code] = {**out[src], "source": f"sibling:{src}", "provenance": f"same fund, other plan ({out[src].get('source')})"}
    return out


def sync_managers(repo: Any) -> int:
    """Insert managers for schemes the table lacks. Existing rows (staff edits included) are never touched. Returns rows added."""
    from app.backoffice import mf_screener

    stored = repo.list_mf_managers()
    base = mf_screener._base_frame()
    resolved = resolve(base, stored)
    new = [{"scheme_code": c, **{k: v for k, v in row.items() if k != "scheme_code"}} for c, row in resolved.items() if c not in stored]
    added = repo.upsert_mf_managers(new) if new else 0
    logger.info("manager sync: %d stored, %d added, %d of %d schemes covered", len(stored), added, len(stored) + added, len(base))
    return added
