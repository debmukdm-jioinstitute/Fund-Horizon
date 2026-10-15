"""AMFI/SEBI static MF reference snapshot: CSV loader (one table per record_type) and read API."""
from __future__ import annotations

import csv
import gzip
import io
import re
import sqlite3
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from app.api.auth import require_staff
from app.db import sqlite as _sqlite

router = APIRouter(prefix="/api/backoffice/mf-reference", tags=["mf-reference"])

PREFIX = "mfref_"
_IDX_COLS = ("amfi_scheme_code", "amc_id", "manager_id", "sebi_category", "sub_category")
_SEARCH_COLS = ("scheme_name", "amc_name", "full_name", "isin_growth_or_idcw_payout", "amfi_scheme_code", "benchmark_name_tri")
_TABLE_RE = re.compile(r"^[a-z_]+$")


def _tname(record_type: str) -> str:
    return PREFIX + record_type


def load_csv(path: str | Path, conn: sqlite3.Connection | None = None) -> dict[str, int]:
    """Replace all mfref_* tables from the consolidated CSV. Columns kept per type = those with any value."""
    own = conn is None
    conn = conn or _sqlite.get_default_connection()
    csv.field_size_limit(10**9)
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    by_type: dict[str, list[dict[str, str]]] = {}
    for r in rows:
        by_type.setdefault(r["record_type"].lower(), []).append(r)
    counts: dict[str, int] = {}
    with conn:
        for old in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?", (PREFIX + "%",)).fetchall():
            conn.execute(f'DROP TABLE "{old[0]}"')
        for rt, recs in by_type.items():
            if not _TABLE_RE.match(rt):
                continue
            cols = [c for c in recs[0] if c != "record_type" and any(r[c] for r in recs)]
            t = _tname(rt)
            conn.execute(f'CREATE TABLE "{t}" ({", ".join(f"{chr(34)}{c}{chr(34)} TEXT" for c in cols)})')
            conn.executemany(
                f'INSERT INTO "{t}" VALUES ({",".join("?" * len(cols))})',
                [tuple(r[c] or None for c in cols) for r in recs],
            )
            for c in cols:
                if c in _IDX_COLS:
                    conn.execute(f'CREATE INDEX "ix_{t}_{c}" ON "{t}"("{c}")')
            counts[rt] = len(recs)
    if own:
        conn.close()
    return counts


def _conn() -> sqlite3.Connection:
    return _sqlite.get_default_connection()


def _tables(conn: sqlite3.Connection) -> list[str]:
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name LIKE ? LIMIT 1", (PREFIX + "%",)).fetchone():
        if SNAPSHOT.exists():  # first request on a fresh/other DB: load the bundled snapshot
            load_csv(SNAPSHOT, conn)
    return [r[0][len(PREFIX):] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name", (PREFIX + "%",))]


def _need(conn: sqlite3.Connection, table: str) -> str:
    if table not in _tables(conn):
        raise HTTPException(404, f"Unknown reference table: {table}")
    return _tname(table)


def _cols(conn: sqlite3.Connection, t: str) -> list[str]:
    return [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')]


def _query(table: str, q: str | None, filters: dict[str, str], sort: str | None, order: str, limit: int, offset: int):
    conn = _conn()
    try:
        t = _need(conn, table)
        cols = _cols(conn, t)
        where, args = [], []
        for k, v in filters.items():
            if k in cols and v:
                where.append(f'"{k}" = ?')
                args.append(v)
        if q:
            sc = [c for c in _SEARCH_COLS if c in cols] or cols[:6]
            where.append("(" + " OR ".join(f'"{c}" LIKE ?' for c in sc) + ")")
            args += [f"%{q}%"] * len(sc)
        w = (" WHERE " + " AND ".join(where)) if where else ""
        order_sql = ""
        if sort in cols:
            order_sql = f' ORDER BY "{sort}" {"DESC" if order == "desc" else "ASC"}'
        total = conn.execute(f'SELECT COUNT(*) FROM "{t}"{w}', args).fetchone()[0]
        lim = f" LIMIT {int(limit)} OFFSET {int(offset)}" if limit else ""
        rows = [dict(r) for r in conn.execute(f'SELECT * FROM "{t}"{w}{order_sql}{lim}', args)]
        return cols, rows, total
    finally:
        conn.close()


@router.get("/summary")
def summary(staff: Annotated[dict, Depends(require_staff)]):
    conn = _conn()
    try:
        tables = _tables(conn)
        counts = {t: conn.execute(f'SELECT COUNT(*) FROM "{_tname(t)}"').fetchone()[0] for t in tables}
        out: dict[str, Any] = {"tables": counts, "loaded": bool(tables)}
        if "scheme_master" in tables:
            t = _tname("scheme_master")
            out["categories"] = [r[0] for r in conn.execute(f'SELECT DISTINCT sebi_category FROM "{t}" WHERE sebi_category IS NOT NULL ORDER BY 1')]
            out["plans"] = [r[0] for r in conn.execute(f'SELECT DISTINCT plan FROM "{t}" WHERE plan IS NOT NULL ORDER BY 1')]
        if "amc_master" in tables:
            out["amcs"] = [dict(r) for r in conn.execute(
                f'SELECT amc_id, amc_name FROM "{_tname("amc_master")}" ORDER BY amc_name')]
        if "readme" in tables:
            out["readme"] = [dict(r) for r in conn.execute(f'SELECT item, description FROM "{_tname("readme")}"')]
        return out
    finally:
        conn.close()


@router.get("/tables/{table}")
def table_rows(
    table: str,
    staff: Annotated[dict, Depends(require_staff)],
    q: str | None = None,
    sort: str | None = None,
    order: str = Query("asc", pattern="^(asc|desc)$"),
    amc_id: str | None = None,
    sebi_category: str | None = None,
    sub_category: str | None = None,
    plan: str | None = None,
    amfi_scheme_code: str | None = None,
    manager_id: str | None = None,
    format: str = Query("json", pattern="^(json|csv)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    filters = {"amc_id": amc_id, "sebi_category": sebi_category, "sub_category": sub_category, "plan": plan,
               "amfi_scheme_code": amfi_scheme_code, "manager_id": manager_id}
    filters = {k: v for k, v in filters.items() if v}
    if format == "csv":
        cols, rows, _ = _query(table, q, filters, sort, order, 0, 0)
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
        return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="mf_{table}.csv"'})
    cols, rows, total = _query(table, q, filters, sort, order, limit, offset)
    return {"columns": cols, "rows": rows, "total": total, "limit": limit, "offset": offset}


@router.get("/schemes/{scheme_code}")
def scheme_detail(scheme_code: str, staff: Annotated[dict, Depends(require_staff)]):
    conn = _conn()
    try:
        def rows(table: str, where: str, args: tuple) -> list[dict]:
            if table not in _tables(conn):
                return []
            return [dict(r) for r in conn.execute(f'SELECT * FROM "{_tname(table)}" WHERE {where}', args)]

        sch = rows("scheme_master", "amfi_scheme_code = ?", (scheme_code,))
        if not sch:
            raise HTTPException(404, "Scheme not found in reference snapshot")
        s = sch[0]
        amc = rows("amc_master", "amc_id = ?", (s.get("amc_id"),))
        maps = rows("manager_scheme_map", "amfi_scheme_code = ?", (scheme_code,))
        mgrs = []
        for m in maps:
            fm = rows("fund_manager_master", "manager_id = ?", (m["manager_id"],))
            mgrs.append({**m, **({"full_name": fm[0].get("full_name"), "designation": fm[0].get("designation")} if fm else {})})
        bench = rows("benchmark_master", "scheme_codes_using_it LIKE ?", (f"%{scheme_code}%",))
        bench = [b for b in bench if scheme_code in (b.get("scheme_codes_using_it") or "").split(";")]
        cat = rows("category_definitions", "sebi_category = ? AND sub_category = ?", (s.get("sebi_category"), s.get("sub_category")))
        return {
            "scheme": s, "amc": amc[0] if amc else None, "managers": mgrs, "benchmarks": bench,
            "category": cat[0] if cat else None,
            "manager_changes": rows("manager_history_changes", "amfi_scheme_code = ?", (scheme_code,)),
            "provenance": rows("field_provenance", "amfi_scheme_code = ?", (scheme_code,)),
        }
    finally:
        conn.close()


@router.get("/managers/{manager_id}")
def manager_detail(manager_id: str, staff: Annotated[dict, Depends(require_staff)]):
    conn = _conn()
    try:
        _need(conn, "fund_manager_master")
        m = conn.execute(f'SELECT * FROM "{_tname("fund_manager_master")}" WHERE manager_id = ?', (manager_id,)).fetchone()
        if not m:
            raise HTTPException(404, "Manager not found")
        schemes = [dict(r) for r in conn.execute(
            f'SELECT s.amfi_scheme_code, s.scheme_name, s.plan, s.sebi_category, mp.role_as_stated, mp.start_date_as_stated '
            f'FROM "{_tname("manager_scheme_map")}" mp JOIN "{_tname("scheme_master")}" s USING (amfi_scheme_code) '
            f'WHERE mp.manager_id = ? ORDER BY s.scheme_name', (manager_id,))]
        return {"manager": dict(m), "schemes": schemes}
    finally:
        conn.close()


SNAPSHOT = Path(__file__).resolve().parents[3] / "data" / "India_MF_Static_Reference_Consolidated.csv.gz"


def ensure_loaded() -> None:
    """Load the bundled snapshot when the DB has no reference tables yet (fresh deploy)."""
    conn = _conn()
    try:
        _tables(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    import sys

    print(load_csv(sys.argv[1] if len(sys.argv) > 1 else SNAPSHOT))
