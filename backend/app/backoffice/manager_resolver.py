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
import re
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


_DATE_CACHE: dict[str, str | None] = {}


def _clean_date_str(t: str) -> str:
    return re.sub(r"(\d+)(?:st|nd|rd|th)\b", r"\1", t)


def _iso(text: str | None) -> str | None:
    """Best-effort date from AMFI wording ('Managing Since March 26, 2014', '26/03/2014', '2014-03-26T..'); None if unreadable."""
    if not text:
        return None
    raw = str(text).strip()
    if raw in _DATE_CACHE:
        return _DATE_CACHE[raw]
    t = _clean_date_str(raw.replace("Managing Since", "").replace("Since", "").strip())
    m1 = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m1:
        res = f"{m1.group(1)}-{int(m1.group(2)):02d}-{int(m1.group(3)):02d}"
        _DATE_CACHE[raw] = res
        return res
    m2 = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", t)
    if m2:
        res = f"{m2.group(3)}-{int(m2.group(2)):02d}-{int(m2.group(1)):02d}"
        _DATE_CACHE[raw] = res
        return res
    d = pd.to_datetime(t, dayfirst=True, errors="coerce")
    res = None if pd.isna(d) else d.date().isoformat()
    _DATE_CACHE[raw] = res
    return res


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


def _name_key(name: str | None) -> str:
    """Manager name key: lowercase, spaces collapsed, common honorific titles removed."""
    return re.sub(r"\s+", " ", re.sub(r"^(mr|mrs|ms|dr)\.?\s+", "", (name or "").strip(), flags=re.I)).lower()


def _name_matches(n1: str | None, n2: str | None) -> bool:
    """Check if two manager names match (allowing honorifics, initials, or multi-manager substring)."""
    k1 = _name_key(n1)
    k2 = _name_key(n2)
    if not k1 or not k2:
        return False
    if k1 == k2 or k1 in k2 or k2 in k1:
        return True
    parts1 = set(k1.split())
    parts2 = set(k2.split())
    return len(parts1 & parts2) >= 2


def _parse_scheme_master_dates(n_raw: str, d_raw: str) -> dict[str, str]:
    res: dict[str, str] = {}
    if not d_raw:
        return res
    d_raw = _clean_date_str(d_raw)

    for m in re.finditer(r"([A-Za-z\s.]+?)\s*\((?:Since\s*)?([^)]+)\)", d_raw):
        k = _name_key(m.group(1))
        dt = _iso(m.group(2))
        if k and dt:
            res[k] = dt

    fm_names = dict(re.findall(r"(?:FM\s*(\d+)[\s:-]*)(.*?)(?=(?:FM\s*\d+|$))", n_raw, flags=re.I))
    fm_dates = dict(re.findall(r"(?:FM\s*(\d+)[\s:-]*)(.*?)(?=(?:FM\s*\d+|$))", d_raw, flags=re.I))
    for idx, raw_n in fm_names.items():
        k = _name_key(raw_n.strip(" ,;-"))
        dt = _iso(fm_dates.get(idx, "").strip(" ,;-"))
        if k and dt:
            res[k] = dt

    for part in re.split(r"[,;]\s*|\s+(?=Mr\.|Ms\.|Mrs\.)", d_raw):
        m = re.match(r"^(.*?)\s*-\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4}|[A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{2}-\d{2})$", part.strip())
        if m:
            k = _name_key(m.group(1))
            dt = _iso(m.group(2))
            if k and dt:
                res[k] = dt

    if not res and n_raw and d_raw:
        ns = [x.strip() for x in re.split(r"[,;]\s*", n_raw) if x.strip()]
        ds = [x.strip() for x in re.split(r"[,;]\s*", d_raw) if x.strip()]
        if len(ns) == len(ds):
            for nv, dv in zip(ns, ds):
                k = _name_key(nv)
                dt = _iso(dv)
                if k and dt:
                    res[k] = dt
        elif len(ns) >= 1 and len(ds) == 1:
            k = _name_key(ns[0])
            dt = _iso(ds[0])
            if k and dt:
                res[k] = dt
    return res


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
        if r["record_type"] != "manager_scheme_map" or r["manager_id"] not in names:
            continue
        code = r["amfi_scheme_code"]
        start = _iso(r.get("start_date_managing")) or _iso(r.get("start_date_as_stated"))
        if code not in out:
            out[code] = {"manager_name": names[r["manager_id"]], "manager_start": start, "source": "amfi_snapshot", "provenance": "AMFI/SEBI static reference snapshot"}
        elif not out[code].get("manager_start") and start:
            out[code] = {"manager_name": names[r["manager_id"]], "manager_start": start, "source": "amfi_snapshot", "provenance": "AMFI/SEBI static reference snapshot"}

    for r in rows:
        if r.get("record_type") != "scheme_master":
            continue
        code = (r.get("amfi_scheme_code") or "").strip()
        if not code:
            continue
        d_raw = r.get("ssd_fund_manager_from_dates_raw") or ""
        n_raw = r.get("ssd_fund_manager_names_raw") or ""
        if not d_raw:
            continue
        dates_map = _parse_scheme_master_dates(n_raw, d_raw)
        if code in out and not out[code].get("manager_start"):
            if dates_map:
                mk = _name_key(out[code].get("manager_name"))
                if mk in dates_map:
                    out[code]["manager_start"] = dates_map[mk]
                elif len(dates_map) == 1:
                    out[code]["manager_start"] = next(iter(dates_map.values()))
            if not out[code].get("manager_start"):
                first_d_str = _clean_date_str(re.split(r"[,;]\s*", d_raw)[0].strip())
                dt = _iso(first_d_str)
                if dt:
                    out[code]["manager_start"] = dt
        elif code not in out and dates_map:
            first_n = next(iter(dates_map.keys()))
            first_d = dates_map[first_n]
            out[code] = {"manager_name": first_n, "manager_start": first_d, "source": "amfi_snapshot", "provenance": "AMFI/SEBI static reference snapshot"}

    return out


def _fund_key(name: str) -> str:
    """Normalize fund name to core fund key (stripping plan types, dividend/idcw/bonus options)."""
    k = name_key(name)
    return re.sub(r"(?:idcw|dividend|bonus|payout|reinvestment)+", "", k)


def resolve(universe: pd.DataFrame, stored: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """{scheme_code: row} for every scheme in `universe` (columns code, amc, name) that any source can place."""
    layers = [stored, _seed(), _cached(), _amfi()]
    out: dict[str, dict[str, Any]] = {}
    for code in universe["code"].astype(str):
        for layer in layers:
            if code in layer:
                out[code] = dict(layer[code])
                break
        if code in out and not out[code].get("manager_start"):
            m_name = out[code].get("manager_name")
            if m_name:
                for layer in layers:
                    ext = layer.get(code)
                    if ext and ext.get("manager_start") and _name_matches(ext.get("manager_name"), m_name):
                        out[code]["manager_start"] = ext["manager_start"]
                        out[code]["provenance"] = f"{out[code].get('provenance', '')} + start:{ext.get('source')}".strip()
                        break
            if not out[code].get("manager_start") and out[code].get("source") == "seed":
                for layer in [_cached(), _amfi()]:
                    ext = layer.get(code)
                    if ext and ext.get("manager_start"):
                        out[code]["manager_start"] = ext["manager_start"]
                        out[code]["provenance"] = f"{out[code].get('provenance', '')} + start:{ext.get('source')}".strip()
                        break
    # Plan sibling: a fund's Direct and Regular plans share a manager and start date.
    by_fund_start: dict[tuple[str, str], str] = {}
    by_fund_any: dict[tuple[str, str], str] = {}
    keys = {str(c): (str(a), _fund_key(str(n))) for c, a, n in zip(universe["code"], universe["amc"], universe["name"])}
    for code, k in keys.items():
        if code in out:
            by_fund_any.setdefault(k, code)
            if out[code].get("manager_start"):
                by_fund_start.setdefault(k, code)
    for code, k in keys.items():
        if code in out and not out[code].get("manager_start") and k in by_fund_start:
            src = by_fund_start[k]
            if _name_matches(out[code].get("manager_name"), out[src].get("manager_name")):
                out[code]["manager_start"] = out[src]["manager_start"]
        elif code not in out and k[1]:
            src = by_fund_start.get(k) or by_fund_any.get(k)
            if src:
                src_source = out[src].get("source")
                out[code] = {**out[src], "source": f"sibling:{src}", "provenance": f"same fund, other plan ({src_source})"}
    return out


def sync_managers(repo: Any) -> int:
    """Insert managers for schemes the table lacks and fill missing start dates on matching names.

    Existing rows (staff edits included) are never overwritten except to fill a null start date from a
    higher-trust layer (seed, cache, AMFI) when the manager name matches and source is not manual_import.
    Returns rows added.
    """
    from app.backoffice import mf_screener

    stored = repo.list_mf_managers()
    higher_layers = [_seed(), _cached(), _amfi()]
    updates = []
    for code, row in stored.items():
        start = row.get("manager_start")
        if (not start or pd.isna(start)) and row.get("source") != "manual_import":
            m_name = row.get("manager_name")
            if not m_name:
                continue
            for layer in higher_layers:
                ext = layer.get(str(code))
                if ext and ext.get("manager_start") and _name_matches(ext.get("manager_name"), m_name):
                    updates.append({
                        "scheme_code": code,
                        "manager_start": ext["manager_start"],
                        "source": ext.get("source"),
                        "provenance": ext.get("provenance"),
                    })
                    row["manager_start"] = ext["manager_start"]
                    row["source"] = ext.get("source")
                    row["provenance"] = ext.get("provenance")
                    break

    if updates and hasattr(repo, "update_mf_manager_start"):
        repo.update_mf_manager_start(updates)

    base = mf_screener._base_frame()
    resolved = resolve(base, stored)
    new = [{"scheme_code": c, **{k: v for k, v in row.items() if k != "scheme_code"}} for c, row in resolved.items() if c not in stored]
    added = repo.upsert_mf_managers(new) if new else 0
    logger.info("manager sync: %d stored (%d start-filled), %d added, %d of %d schemes covered",
                len(stored), len(updates), added, len(stored) + added, len(base))
    return added
