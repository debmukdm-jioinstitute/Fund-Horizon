"""Sanity check: verify fund manager data pulls line up across sources.

Checks (run: python scripts/audit_fund_managers.py):
  1. MF reference snapshot referential integrity (managers, schemes, AMCs, benchmarks).
  2. data/mf_managers_seed.csv vs the AMFI/SEBI snapshot (name + start-date drift).
  3. data/mf_manager_profiles.json names vs the snapshot fund_manager_master.
  4. Coverage: schemes the snapshot maps to a manager but mf_managers has no row (fallback path).
  5. PMS (APMI) strategies and managers in the live database: provider/IA-id consistency,
     duplicate strategy rows, collector freshness and manager-profile cache coverage.
Exits 1 when any ERROR-level discrepancy is found; WARN/INFO are informational.

Live DB for check 5 defaults to backend/plans.db; override with --db PATH or FH_AUDIT_DB.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

LIVE_DB = os.environ.get("FH_DB_PATH") or os.environ.get("FH_AUDIT_DB")

TMP = Path(tempfile.mkdtemp(prefix="mfref_audit_")) / "audit.db"
os.environ.setdefault("FH_DB_PATH", str(TMP))

from app.backoffice.mf_reference import SNAPSHOT, load_csv, _tname  # noqa: E402
from app.db import sqlite as _sqlite  # noqa: E402

errors: list[str] = []
warns: list[str] = []
infos: list[str] = []


def key(name: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^(mr|mrs|ms|dr)\.?\s+", "", (name or "").strip(), flags=re.I)).lower()


def same_person(seed_name: str | None, snap_name: str | None) -> bool:
    """True when the two names are the same person allowing middle names/initials:
    token sets equal, or one a subset of the other (e.g. 'Kenneth Andrade' vs 'Kenneth Joseph Andrade')."""
    a, b = key(seed_name), key(snap_name)
    if a == b:
        return True
    ta, tb = set(a.split()), set(b.split())
    return bool(ta) and bool(tb) and (ta <= tb or tb <= ta)


_DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%B %d, %Y", "%b %d, %Y",
    "%d %B %Y", "%d %b %Y", "%d %B %Y", "%dth %B %Y", "%dst %B %Y", "%dnd %B %Y", "%drd %B %Y",
    "%d-%b-%Y", "%d-%b-%y", "%m/%d/%Y",
    "%B %d %Y", "%b %d %Y", "%d %B, %Y", "%d %b, %Y",
)


def norm_date(v: str | None) -> str | None:
    """ISO date for any of the snapshot's date spellings, else None (unparseable)."""
    s = (v or "").strip()
    if not s:
        return None
    s = re.sub(r"^(managing\s+since|managing\s+on|managing|since)\s+", "", s, flags=re.I)
    s = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", s, flags=re.I)
    s = re.sub(r"T\d{2}:\d{2}:\d{2}(\.\d+)?$", "", s)  # ISO timestamps in the SSD export
    s = re.sub(r"\s+", " ", s).strip()
    for cand in (s, s.replace(",", " ")):
        for fmt in _DATE_FORMATS:
            try:
                import datetime as _dt

                return _dt.datetime.strptime(cand, fmt).date().isoformat()
            except ValueError:
                continue
    return None


def audit_pms(path: Path) -> None:
    """Section 5: PMS (APMI) strategy rows and the manager profile path served by the store."""
    if not path.exists():
        infos.append(f"PMS: no database at {path} (skipped)")
        return
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"pms_providers", "pms_apmi_strategies"} <= tables:
            infos.append(f"PMS: {path.name} has no PMS tables yet (skipped)")
            return

        def q(sql: str) -> list[tuple]:
            return [tuple(r) for r in con.execute(sql)]

        strategies = q("SELECT COUNT(*) FROM pms_apmi_strategies")[0][0]
        providers = q("SELECT COUNT(*) FROM pms_providers")[0][0]
        latest = q("SELECT MAX(as_on) FROM pms_apmi_strategies")[0][0]
        if not strategies or not latest:
            warns.append("PMS: no APMI strategy rows stored; the PMS tracker has nothing to show")
            return
        latest_rows, latest_providers = q(
            f"SELECT COUNT(*), COUNT(DISTINCT provider) FROM pms_apmi_strategies WHERE as_on='{latest}'"
        )[0]
        infos.append(f"PMS: {strategies} APMI strategy rows, {providers} provider records; latest month {latest} "
                     f"({latest_rows} strategies from {latest_providers} providers)")

        blank = q("SELECT COUNT(*) FROM pms_apmi_strategies WHERE provider IS NULL OR TRIM(provider)='' "
                  "OR ia_id IS NULL OR TRIM(ia_id)=''")[0][0]
        if blank:
            errors.append(f"PMS: {blank} strategy rows have no provider or IA id (manager profile cannot resolve)")

        shared = q("SELECT ia_id, COUNT(DISTINCT provider) FROM pms_apmi_strategies "
                    "WHERE ia_id IS NOT NULL AND TRIM(ia_id)<>'' GROUP BY ia_id HAVING COUNT(DISTINCT provider)>1")
        if shared:
            errors.append(f"PMS: {len(shared)} IA ids map to more than one provider, e.g. "
                          f"{[(i, n) for i, n in shared[:3]]}")

        dupes = q("SELECT COUNT(*) FROM (SELECT 1 FROM pms_apmi_strategies "
                  "GROUP BY provider, strategy_name, as_on HAVING COUNT(*)>1)")[0][0]
        if dupes:
            errors.append(f"PMS: {dupes} duplicate provider/strategy/month rows (double-counted AUM and returns)")

        orphan_providers = q("SELECT COUNT(*) FROM pms_providers p WHERE NOT EXISTS "
                             "(SELECT 1 FROM pms_apmi_strategies s WHERE s.provider=p.name)")[0][0]
        if orphan_providers:
            infos.append(f"PMS: {orphan_providers} registered providers have no strategy rows in the store")

        if "pms_strategy_details" in tables:
            cached = q("SELECT COUNT(*) FROM pms_strategy_details")[0][0]
            if not cached:
                warns.append("PMS: manager profile cache (pms_strategy_details) is empty; every manager drawer "
                             "open is a live APMI fetch with no stored principal-officer snapshot")
            elif cached < latest_rows:
                warns.append(f"PMS: manager profile cache covers {cached} of {latest_rows} latest-month strategies")
    finally:
        con.close()


def _live_db_path(argv: list[str]) -> Path:
    if "--db" in argv and argv.index("--db") + 1 < len(argv):
        return Path(argv[argv.index("--db") + 1]).expanduser()
    return Path(LIVE_DB).expanduser() if LIVE_DB else ROOT / "backend" / "plans.db"


def main() -> int:
    counts = load_csv(SNAPSHOT)
    print("snapshot tables:", dict(sorted(counts.items())))
    conn = _sqlite.get_default_connection()
    try:
        def rows(t: str) -> list[dict]:
            return [dict(r) for r in conn.execute(f'SELECT * FROM "{_tname(t)}"')]

        schemes = rows("scheme_master")
        managers = rows("fund_manager_master")
        amcs = rows("amc_master")
        smap = rows("manager_scheme_map")
        changes = rows("manager_history_changes")

        # 1. referential integrity -------------------------------------------------
        scheme_codes = {str(s.get("amfi_scheme_code")) for s in schemes}
        amc_ids = {str(a.get("amc_id")) for a in amcs}
        mgr_ids = {str(m.get("manager_id")) for m in managers}

        dupes = len(schemes) - len(scheme_codes)
        if dupes:
            warns.append(f"scheme_master has {dupes} duplicate amfi_scheme_code rows")

        orph_map = [m for m in smap if str(m.get("manager_id")) not in mgr_ids]
        orph_map_scheme = [m for m in smap if str(m.get("amfi_scheme_code")) not in scheme_codes]
        if orph_map:
            errors.append(f"manager_scheme_map: {len(orph_map)} rows reference unknown manager_id "
                          f"(e.g. {orph_map[0].get('manager_id')})")
        if orph_map_scheme:
            errors.append(f"manager_scheme_map: {len(orph_map_scheme)} rows reference unknown amfi_scheme_code "
                          f"(e.g. {orph_map_scheme[0].get('amfi_scheme_code')})")

        orph_amc = [s for s in schemes if s.get("amc_id") and str(s["amc_id"]) not in amc_ids]
        if orph_amc:
            errors.append(f"scheme_master: {len(orph_amc)} rows reference unknown amc_id "
                          f"(e.g. {orph_amc[0].get('amc_id')} for {orph_amc[0].get('scheme_name')})")

        no_mgr = [c for c in changes if str(c.get("manager_id")) not in mgr_ids and c.get("manager_id")]
        no_mgr_scheme = [c for c in changes if c.get("amfi_scheme_code") and str(c["amfi_scheme_code"]) not in scheme_codes]
        if no_mgr_scheme:
            warns.append(f"manager_history_changes: {len(no_mgr_scheme)} rows reference unknown scheme codes")
        if no_mgr:
            warns.append(f"manager_history_changes: {len(no_mgr)} rows reference unknown manager_ids")

        # benchmarks referencing scheme codes
        bench = rows("benchmark_master")
        bad_bench = 0
        for b in bench:
            for code in (b.get("scheme_codes_using_it") or "").split(";"):
                code = code.strip()
                if code and code not in scheme_codes:
                    bad_bench += 1
                    break
        if bad_bench:
            warns.append(f"benchmark_master: {bad_bench} benchmarks list at least one unknown scheme code")

        # schemes with no manager at all
        mapped = {str(m.get("amfi_scheme_code")) for m in smap}
        unmapped = [s for s in schemes if str(s.get("amfi_scheme_code")) not in mapped]
        infos.append(f"{len(unmapped)} / {len(schemes)} snapshot schemes have no mapped fund manager "
                     f"({(len(unmapped)/max(len(schemes),1)):.0%})")
        infos.append(f"{len(managers)} fund managers, {len(smap)} scheme-manager assignments, {len(amcs)} AMCs")

        # 2. mf_managers seed vs snapshot ------------------------------------------
        seed_path = ROOT / "data" / "mf_managers_seed.csv"
        seed = list(csv.DictReader(seed_path.open(encoding="utf-8-sig")))
        map_by_scheme: dict[str, list[dict]] = {}
        for m in smap:
            map_by_scheme.setdefault(str(m.get("amfi_scheme_code")), []).append(m)
        mgr_by_id = {str(m.get("manager_id")): m for m in managers}

        seed_not_in_snapshot, seed_name_mismatch, seed_start_mismatch, seed_no_snapshot_mgr, unparsed = [], [], [], [], []
        for r in seed:
            code, name = r["scheme_code"], r["manager_name"]
            if code not in scheme_codes:
                seed_not_in_snapshot.append((code, name))
                continue
            snap_mgrs = [mgr_by_id.get(str(m.get("manager_id"))) for m in map_by_scheme.get(code, [])]
            snap_mgrs = [n for n in snap_mgrs if n]
            if not snap_mgrs:
                seed_no_snapshot_mgr.append((code, name))
                continue
            snap_keys = [key(n.get("full_name")) for n in snap_mgrs]
            seed_match = any(same_person(name, n.get("full_name")) for n in snap_mgrs)
            if key(name) not in snap_keys and not seed_match:
                seed_name_mismatch.append((code, name, [n.get("full_name") for n in snap_mgrs]))
                continue
            # compare start dates only on the map row whose manager matches the seed manager
            for m in map_by_scheme.get(code, []):
                fm = mgr_by_id.get(str(m.get("manager_id")))
                if not fm or not same_person(name, fm.get("full_name")):
                    continue
                sd, ss = norm_date(r.get("manager_start")), norm_date(m.get("start_date_as_stated"))
                if r.get("manager_start") and m.get("start_date_as_stated") and sd and ss and sd != ss:
                    seed_start_mismatch.append((code, name, r["manager_start"], m["start_date_as_stated"]))
                elif r.get("manager_start") and m.get("start_date_as_stated") and (not sd or not ss):
                    unparsed.append((code, name, r["manager_start"], m["start_date_as_stated"]))

        if seed_not_in_snapshot:
            # Is the scheme missing only from the snapshot, or gone everywhere (stale/retired code)?
            try:
                from app.data.loader import load_metrics

                live = {str(c) for c in load_metrics()["scheme_code"]}
            except Exception:  # noqa: BLE001 - metrics dataset optional for this audit
                live = set()
            snapshot_gap = [(c, n) for c, n in seed_not_in_snapshot if c in live]
            stale = [(c, n) for c, n in seed_not_in_snapshot if c not in live]
            if snapshot_gap:
                errors.append(f"mf_managers_seed: {len(snapshot_gap)} live scheme codes absent from the reference "
                              f"snapshot (snapshot coverage gap), e.g. {snapshot_gap[:5]}")
            if stale:
                warns.append(f"mf_managers_seed: {len(stale)} scheme codes in neither the snapshot nor the metrics "
                             f"dataset (stale/retired), e.g. {stale[:5]}")
        if seed_no_snapshot_mgr:
            warns.append(f"mf_managers_seed: {len(seed_no_snapshot_mgr)} schemes have no manager mapping in the "
                         f"snapshot (seed-only), e.g. {seed_no_snapshot_mgr[:3]}")
        if seed_name_mismatch:
            errors.append(f"mf_managers_seed vs snapshot: {len(seed_name_mismatch)} manager-name mismatches, e.g. "
                          + "; ".join(f"{c}: seed='{a}' snapshot={b}" for c, a, b in seed_name_mismatch[:5]))
        if seed_start_mismatch:
            warns.append(f"mf_managers_seed vs snapshot: {len(seed_start_mismatch)} manager start-date mismatches (same manager, different date), e.g. "
                         + "; ".join(f"{c}: seed={a} vs snap={b}" for c, _, a, b in seed_start_mismatch[:5]))
        if unparsed:
            warns.append(f"unparseable start dates skipped: {len(unparsed)}, e.g. {unparsed[:3]}")

        # 3. curated profiles vs master --------------------------------------------
        profiles = json.loads((ROOT / "data" / "mf_manager_profiles.json").read_text())
        master_keys = {key(m.get("full_name")) for m in managers} | {
            key(a) for p in profiles for a in p.get("aliases", [])}
        prof_orphan = [p["name"] for p in profiles if key(p["name"]) not in master_keys]
        if prof_orphan:
            warns.append(f"mf_manager_profiles: {len(prof_orphan)} profile names not found in fund_manager_master, "
                         f"e.g. {prof_orphan[:5]}")
        # masters without profile (info only)
        info_missing = sum(1 for m in managers if key(m.get("full_name")) not in
                           {key(p["name"]) for p in profiles} | {key(a) for p in profiles for a in p.get("aliases", [])})
        infos.append(f"curated manager profiles: {len(profiles)} ({info_missing} snapshot managers have no bio)")

        # 4. fallback coverage ------------------------------------------------------
        seed_codes = {r["scheme_code"] for r in seed}
        need_fallback = [str(m.get("amfi_scheme_code")) for m in smap
                         if str(m.get("amfi_scheme_code")) not in seed_codes]
        infos.append(f"{len(seed_codes)} schemes served from mf_managers; "
                     f"{len(set(need_fallback))} more rely on the AMFI snapshot fallback")
    finally:
        conn.close()

    # 5. PMS (APMI) strategies and managers from the live database -----------------
    audit_pms(_live_db_path(sys.argv[1:]))

    for m in infos:
        print(f"INFO  {m}")
    for m in warns:
        print(f"WARN  {m}")
    for m in errors:
        print(f"ERROR {m}")
    print(f"\n{len(errors)} error(s), {len(warns)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
