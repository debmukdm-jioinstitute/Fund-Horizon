"""Backoffice repository for persistence, querying, and auditing."""
from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime
from collections.abc import Collection
from typing import Any

from app.backoffice.db import ensure_backoffice_schema
from app.backoffice.providers.amfi_ter import base_key as mf_base_key
from app.db import sqlite as _sqlite


_LIVE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS factsheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    period TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    size_bytes INTEGER,
    sha256 TEXT,
    archived_path TEXT,
    first_seen_at TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    UNIQUE (source_key, period)
);
CREATE INDEX IF NOT EXISTS ix_factsheets_source ON factsheets(source_key, period DESC);
CREATE TABLE IF NOT EXISTS mf_schemes (
    scheme_code TEXT PRIMARY KEY,
    scheme_name TEXT NOT NULL,
    amc TEXT,
    category TEXT,
    plan TEXT,
    scheme_option TEXT,
    isin TEXT,
    isin_reinvest TEXT,
    latest_nav REAL,
    nav_date TEXT,
    base_key TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mf_schemes_name ON mf_schemes(scheme_name);
CREATE INDEX IF NOT EXISTS ix_mf_schemes_plan ON mf_schemes(plan);
CREATE INDEX IF NOT EXISTS ix_mf_schemes_amc ON mf_schemes(amc);
CREATE INDEX IF NOT EXISTS ix_mf_schemes_category ON mf_schemes(category);
CREATE INDEX IF NOT EXISTS ix_mf_schemes_nav_date ON mf_schemes(nav_date);
CREATE TABLE IF NOT EXISTS mf_ter (
    base_key TEXT PRIMARY KEY,
    scheme_name TEXT NOT NULL,
    regular_ter_pct REAL,
    direct_ter_pct REAL,
    as_of TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pms_providers (
    apmi_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pms_apmi_strategies (
    provider TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    strategy_type TEXT NOT NULL,
    service_type TEXT NOT NULL,
    as_on TEXT NOT NULL,
    ia_id TEXT,
    aum_crore REAL,
    return_1m REAL, return_3m REAL, return_6m REAL, return_9m REAL, return_1y REAL,
    return_2y REAL, return_3y REAL, return_4y REAL, return_5y REAL, return_since_inception REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, strategy_name, strategy_type, service_type, as_on)
);
CREATE INDEX IF NOT EXISTS ix_pms_apmi_as_on ON pms_apmi_strategies(as_on);
CREATE TABLE IF NOT EXISTS pms_strategy_details (
    ia_id TEXT PRIMARY KEY,
    detail_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    summary TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_news_published ON news_items(published_at);
"""
_LIVE_TABLES_READY: set[str] = set()


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class BackofficeRepository:
    """Repository handling all backoffice queries and transactions."""

    # MF facet lists (AMCs, categories, plan counts) change only when the AMFI
    # feed refreshes, so cache them briefly to avoid 3 heavy scans per request.
    _MF_FACETS_TTL_SECONDS = 3600.0

    def __init__(self) -> None:
        ensure_backoffice_schema()
        self._mf_facets_cache: dict[str, Any] | None = None
        self._mf_facets_cached_at: float = 0.0

    def _conn(self):
        ensure_backoffice_schema()
        conn = _sqlite.get_default_connection()
        key = str(_sqlite.get_default_db_path())
        if key not in _LIVE_TABLES_READY:
            # Tables added after the 0005 migration are created lazily so existing volumes need no migration.
            with conn:
                for stmt in _LIVE_TABLES_SQL.strip().split(";"):
                    if stmt.strip():
                        conn.execute(stmt)
                cols = {r["name"] for r in conn.execute("PRAGMA table_info(mf_schemes)").fetchall()}
                if "base_key" not in cols:
                    conn.execute("ALTER TABLE mf_schemes ADD COLUMN base_key TEXT")
                if "scheme_option" not in cols:
                    conn.execute("ALTER TABLE mf_schemes ADD COLUMN scheme_option TEXT")
                if "isin_reinvest" not in cols:
                    conn.execute("ALTER TABLE mf_schemes ADD COLUMN isin_reinvest TEXT")
            _LIVE_TABLES_READY.add(key)
        return conn

    # --- Sources & Health ---

    def list_sources(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = [dict(r) for r in conn.execute("SELECT * FROM source_registry ORDER BY name ASC").fetchall()]
            for r in rows:
                # "ready" is only earned by a successful run; a seeded default must not read as verified.
                if r.get("health_status") == "ready" and not r.get("last_success_at"):
                    r["health_status"] = "pending"
            return rows
        finally:
            conn.close()

    def get_source(self, source_id: str) -> dict[str, Any] | None:
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM source_registry WHERE id = ?", (source_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def update_source_health(
        self,
        source_id: str,
        status: str,
        error_message: str | None = None,
        success: bool = True,
    ) -> None:
        conn = self._conn()
        now = _utcnow()
        try:
            with conn:
                if success:
                    conn.execute(
                        """
                        UPDATE source_registry
                        SET health_status = ?, last_attempt_at = ?, last_success_at = ?, error_message = NULL, updated_at = ?
                        WHERE id = ?
                        """,
                        (status, now, now, now, source_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE source_registry
                        SET health_status = ?, last_attempt_at = ?, error_message = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (status, now, error_message, now, source_id),
                    )
        finally:
            conn.close()

    # --- Observations & Market Series ---

    def upsert_observations(self, observations: list[Any]) -> int:
        if not observations:
            return 0
        conn = self._conn()
        count = 0
        now = _utcnow()
        try:
            with conn:
                for obs in observations:
                    # Collectors pass either NormalizedObservation objects or plain dicts (NSE); read both the same way.
                    def field(name: str, default: Any = None, _o: Any = obs) -> Any:
                        return _o.get(name, default) if isinstance(_o, dict) else getattr(_o, name, default)

                    inst_id, observed_at = field("instrument_id"), field("observed_at")
                    val_num, val_txt = field("value_numeric"), field("value_text")
                    freq = field("frequency", "daily")
                    vintage = field("vintage", "initial")
                    prov = field("provenance", "automated")
                    flags = field("quality_flags", "ok")

                    conn.execute(
                        """
                        INSERT INTO observations (
                            instrument_id, observed_at, fetched_at, value_numeric, value_text,
                            frequency, vintage, provenance, quality_flags
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(instrument_id, observed_at, vintage, provenance) DO UPDATE SET
                            value_numeric=excluded.value_numeric,
                            value_text=excluded.value_text,
                            fetched_at=excluded.fetched_at,
                            quality_flags=excluded.quality_flags
                        """,
                        (inst_id, observed_at, now, val_num, val_txt, freq, vintage, prov, flags),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    def get_latest_observation(self, instrument_id: str) -> dict[str, Any] | None:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM observations WHERE instrument_id = ? ORDER BY observed_at DESC LIMIT 1",
                (instrument_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_observations_series(
        self,
        instrument_id: str,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            query = "SELECT * FROM observations WHERE instrument_id = ?"
            params: list[Any] = [instrument_id]
            if start_date:
                query += " AND observed_at >= ?"
                params.append(start_date)
            if end_date:
                query += " AND observed_at <= ?"
                params.append(end_date)
            query += " ORDER BY observed_at ASC LIMIT ?"
            params.append(limit)

            rows = conn.execute(query, tuple(params)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- Instruments ---

    def list_instruments(self, asset_class: str | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            if asset_class:
                rows = conn.execute("SELECT * FROM instrument_registry WHERE asset_class = ? ORDER BY symbol ASC", (asset_class,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM instrument_registry ORDER BY symbol ASC").fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- Option Snapshots & Contracts ---

    def save_option_snapshot(
        self,
        snapshot: dict[str, Any],
        contracts: list[dict[str, Any]],
    ) -> str:
        snap_id = snapshot.get("id") or _new_id()
        now = _utcnow()
        conn = self._conn()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO option_snapshots (
                        id, exchange, underlying_symbol, underlying_price,
                        snapshot_timestamp, fetched_at, source, pcr_oi, pcr_volume,
                        total_call_oi, total_put_oi, total_call_volume, total_put_volume
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snap_id,
                        snapshot.get("exchange", "NSE"),
                        snapshot.get("underlying_symbol", "NIFTY"),
                        snapshot.get("underlying_price"),
                        snapshot.get("snapshot_timestamp", now),
                        now,
                        snapshot.get("source", "manual_import"),
                        snapshot.get("pcr_oi"),
                        snapshot.get("pcr_volume"),
                        snapshot.get("total_call_oi"),
                        snapshot.get("total_put_oi"),
                        snapshot.get("total_call_volume"),
                        snapshot.get("total_put_volume"),
                    ),
                )
                for c in contracts:
                    c_id = c.get("id") or _new_id()
                    conn.execute(
                        """
                        INSERT INTO option_contracts (
                            id, snapshot_id, exchange, underlying_symbol, expiry_date,
                            strike_price, option_type, contract_id, lot_size,
                            last_price, oi, oi_change, volume, implied_vol
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            c_id,
                            snap_id,
                            c.get("exchange", "NSE"),
                            c.get("underlying_symbol", "NIFTY"),
                            c.get("expiry_date"),
                            c.get("strike_price"),
                            c.get("option_type"),
                            c.get("contract_id"),
                            c.get("lot_size", 1),
                            c.get("last_price"),
                            c.get("oi", 0),
                            c.get("oi_change", 0),
                            c.get("volume", 0),
                            c.get("implied_vol"),
                        ),
                    )
            return snap_id
        finally:
            conn.close()

    def get_latest_option_snapshot(self, underlying: str = "NIFTY") -> dict[str, Any] | None:
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM option_snapshots WHERE underlying_symbol = ? ORDER BY snapshot_timestamp DESC LIMIT 1",
                (underlying,),
            ).fetchone()
            if not row:
                return None
            snap = dict(row)
            c_rows = conn.execute(
                "SELECT * FROM option_contracts WHERE snapshot_id = ? ORDER BY strike_price ASC",
                (snap["id"],),
            ).fetchall()
            snap["contracts"] = [dict(r) for r in c_rows]
            return snap
        finally:
            conn.close()

    # --- Institutional Flows ---

    def upsert_flows(self, flow_records: list[dict[str, Any]]) -> int:
        conn = self._conn()
        now = _utcnow()
        count = 0
        try:
            with conn:
                for f in flow_records:
                    f_id = f.get("id") or _new_id()
                    conn.execute(
                        """
                        INSERT INTO flows (
                            id, source_id, report_date, category, segment,
                            gross_buy, gross_sell, net, unit, status, vintage, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            f_id,
                            f.get("source_id", "SRC_NSE_FNO"),
                            f["report_date"],
                            f["category"],
                            f.get("segment", "equity_cash"),
                            float(f["gross_buy"]),
                            float(f["gross_sell"]),
                            float(f["net"]),
                            f.get("unit", "inr_crore"),
                            f.get("status", "provisional"),
                            f.get("vintage", "initial"),
                            now,
                        ),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    def replace_flows(self, flow_records: list[dict[str, Any]]) -> int:
        """Idempotent flow upsert keyed on (report_date, category, segment): re-fetching a session overwrites it."""
        if not flow_records:
            return 0
        conn = self._conn()
        try:
            with conn:
                for f in flow_records:
                    conn.execute(
                        "DELETE FROM flows WHERE report_date = ? AND category = ? AND segment = ?",
                        (f["report_date"], f["category"], f.get("segment", "equity_cash")),
                    )
            return self.upsert_flows(flow_records)
        finally:
            conn.close()

    def list_flows(self, start_date: str | None = None, end_date: str | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            query = "SELECT * FROM flows"
            params: list[Any] = []
            if start_date and end_date:
                query += " WHERE report_date BETWEEN ? AND ?"
                params = [start_date, end_date]
            query += " ORDER BY report_date DESC LIMIT 100"
            rows = conn.execute(query, tuple(params)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def prune_option_snapshots(self, underlying: str, keep: int = 3) -> None:
        """Keep only the newest ``keep`` snapshots per underlying so live polling cannot grow the DB unbounded."""
        conn = self._conn()
        try:
            with conn:
                old = conn.execute(
                    "SELECT id FROM option_snapshots WHERE underlying_symbol = ? ORDER BY snapshot_timestamp DESC LIMIT -1 OFFSET ?",
                    (underlying, keep),
                ).fetchall()
                for row in old:
                    conn.execute("DELETE FROM option_contracts WHERE snapshot_id = ?", (row["id"],))
                    conn.execute("DELETE FROM option_snapshots WHERE id = ?", (row["id"],))
        finally:
            conn.close()

    def option_snapshot_age_seconds(self, underlying: str) -> float | None:
        """Seconds since the newest snapshot was fetched, or None when none exists."""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT fetched_at FROM option_snapshots WHERE underlying_symbol = ? ORDER BY fetched_at DESC LIMIT 1",
                (underlying,),
            ).fetchone()
        finally:
            conn.close()
        if not row or not row["fetched_at"]:
            return None
        try:
            return (datetime.now(UTC) - datetime.fromisoformat(row["fetched_at"])).total_seconds()
        except ValueError:
            return None

    # --- Mutual fund schemes (AMFI) ---

    def replace_mf_schemes(self, schemes: list[dict[str, Any]]) -> int:
        if not schemes:
            return 0
        now = _utcnow()
        conn = self._conn()
        try:
            with conn:
                conn.executemany(
                    """
                    INSERT INTO mf_schemes (scheme_code, scheme_name, amc, category, plan, scheme_option, isin, isin_reinvest, latest_nav, nav_date, base_key, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(scheme_code) DO UPDATE SET
                        scheme_name=excluded.scheme_name, amc=excluded.amc, category=excluded.category,
                        plan=excluded.plan, scheme_option=excluded.scheme_option, isin=excluded.isin,
                        isin_reinvest=excluded.isin_reinvest, latest_nav=excluded.latest_nav,
                        nav_date=excluded.nav_date, base_key=excluded.base_key, updated_at=excluded.updated_at
                    """,
                    [
                        (
                            s["scheme_code"], s["scheme_name"], s.get("amc"), s.get("category"), s.get("plan"),
                            s.get("option") or s.get("scheme_option"), s.get("isin"), s.get("isin_reinvest"),
                            s.get("latest_nav"), s.get("latest_nav_date") or s.get("nav_date"),
                            mf_base_key(s["scheme_name"]), now,
                        )
                        for s in schemes
                    ],
                )
            # New AMFI data invalidates the cached facet lists.
            self._mf_facets_cache = None
            return len(schemes)
        finally:
            conn.close()

    def _mf_where(
        self, search: str | None, amc: str | None, category: str | None, plan: str | None,
        codes: Collection[str] | None = None,
    ) -> tuple[str, list[Any]]:
        clauses, params = [], []  # type: list[str], list[Any]
        if codes is not None:
            clauses.append(f"s.scheme_code IN ({','.join('?' for _ in codes)})")
            params += list(codes)
        if search:
            like = f"%{search.strip()}%"
            clauses.append(
                "(s.scheme_name LIKE ? OR s.scheme_code LIKE ? OR s.amc LIKE ? OR s.isin LIKE ? OR IFNULL(s.isin_reinvest,'') LIKE ?)"
            )
            params += [like, like, like, like, like]
        if amc:
            clauses.append("s.amc = ?")
            params.append(amc)
        if category:
            clauses.append("s.category = ?")
            params.append(category)
        if plan:
            clauses.append("s.plan = ?")
            params.append(plan)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return where, params

    def search_mf_schemes(
        self,
        search: str | None,
        amc: str | None,
        category: str | None,
        limit: int,
        offset: int,
        plan: str | None = None,
        codes: Collection[str] | None = None,
    ) -> list[dict[str, Any]]:
        where, params = self._mf_where(search, amc, category, plan, codes)
        conn = self._conn()
        try:
            rows = conn.execute(
                f"""
                SELECT s.*,
                       s.scheme_option AS "option",
                       s.nav_date AS latest_nav_date,
                       CASE WHEN s.plan = 'Direct' THEN t.direct_ter_pct ELSE t.regular_ter_pct END AS ter_pct,
                       t.as_of AS ter_as_of
                FROM mf_schemes s LEFT JOIN mf_ter t ON t.base_key = s.base_key
                {where} ORDER BY s.scheme_name LIMIT ? OFFSET ?
                """,
                (*params, limit, offset),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def count_mf_schemes(
        self, search: str | None, amc: str | None, category: str | None, plan: str | None = None,
        codes: Collection[str] | None = None,
    ) -> int:
        where, params = self._mf_where(search, amc, category, plan, codes)
        conn = self._conn()
        try:
            row = conn.execute(f"SELECT COUNT(*) AS n FROM mf_schemes s {where}", params).fetchone()
            return int(row["n"] if row else 0)
        finally:
            conn.close()

    def mf_scheme_facets(self) -> dict[str, Any]:
        now = time.monotonic()
        if (
            self._mf_facets_cache is not None
            and (now - self._mf_facets_cached_at) < self._MF_FACETS_TTL_SECONDS
        ):
            return self._mf_facets_cache
        conn = self._conn()
        try:
            amcs = [
                r["amc"]
                for r in conn.execute(
                    "SELECT DISTINCT amc FROM mf_schemes WHERE amc IS NOT NULL AND TRIM(amc) != '' ORDER BY amc"
                ).fetchall()
            ]
            categories = [
                r["category"]
                for r in conn.execute(
                    "SELECT DISTINCT category FROM mf_schemes WHERE category IS NOT NULL AND TRIM(category) != '' ORDER BY category"
                ).fetchall()
            ]
            as_of_row = conn.execute("SELECT MAX(nav_date) AS m FROM mf_schemes").fetchone()
            plan_counts: dict[str, int] = {}
            for r in conn.execute("SELECT plan, COUNT(*) AS n FROM mf_schemes GROUP BY plan").fetchall():
                key = r["plan"] if r["plan"] else "Unclassified"
                plan_counts[key] = int(r["n"])
            result = {
                "amcs": amcs,
                "categories": categories,
                "as_of": as_of_row["m"] if as_of_row else None,
                "plan_counts": plan_counts,
            }
            self._mf_facets_cache = result
            self._mf_facets_cached_at = now
            return result
        finally:
            conn.close()

    def mf_identical_nav_pairs(self, limit: int = 50) -> list[dict[str, Any]]:
        """Growth/IDCW pairs (same base_key + plan) whose latest NAVs are identical.

        Identical NAVs are suspicious after any IDCW payout (the IDCW NAV should
        drop on distribution). Returns up to `limit` pairs for data QA.
        """
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT g.scheme_code AS growth_code, g.scheme_name AS growth_name,
                       d.scheme_code AS idcw_code, d.scheme_name AS idcw_name,
                       g.latest_nav AS nav, g.nav_date AS nav_date, g.amc AS amc
                FROM mf_schemes g
                JOIN mf_schemes d
                  ON d.base_key = g.base_key
                 AND IFNULL(d.plan, '') = IFNULL(g.plan, '')
                 AND d.scheme_code != g.scheme_code
                WHERE g.scheme_option = 'Growth'
                  AND d.scheme_option IN ('IDCW', 'Dividend')
                  AND g.latest_nav IS NOT NULL
                  AND g.latest_nav = d.latest_nav
                  AND g.latest_nav > 0
                ORDER BY g.scheme_name
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def replace_mf_ter(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        now = _utcnow()
        conn = self._conn()
        try:
            with conn:
                conn.executemany(
                    """
                    INSERT INTO mf_ter (base_key, scheme_name, regular_ter_pct, direct_ter_pct, as_of, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(base_key) DO UPDATE SET
                        scheme_name=excluded.scheme_name, regular_ter_pct=excluded.regular_ter_pct,
                        direct_ter_pct=excluded.direct_ter_pct, as_of=excluded.as_of, updated_at=excluded.updated_at
                    """,
                    [(r["base_key"], r["scheme_name"], r["regular_ter_pct"], r["direct_ter_pct"], r["as_of"], now) for r in rows],
                )
            return len(rows)
        finally:
            conn.close()

    # --- PMS industry universe (APMI) ---

    _PMS_RETURN_COLS = (
        "return_1m", "return_3m", "return_6m", "return_9m", "return_1y",
        "return_2y", "return_3y", "return_4y", "return_5y", "return_since_inception",
    )

    def replace_pms_universe(self, as_on: str, providers: list[dict[str, Any]], strategies: list[dict[str, Any]]) -> int:
        """Replace the provider list and that month's strategy rows (older months are kept as history)."""
        now = _utcnow()
        cols = self._PMS_RETURN_COLS
        conn = self._conn()
        try:
            with conn:
                conn.execute("DELETE FROM pms_providers")
                conn.executemany(
                    "INSERT INTO pms_providers (apmi_id, name, updated_at) VALUES (?, ?, ?)",
                    [(p["apmi_id"], p["name"], now) for p in providers],
                )
                conn.execute("DELETE FROM pms_apmi_strategies WHERE as_on = ?", (as_on,))
                conn.executemany(
                    f"""
                    INSERT OR REPLACE INTO pms_apmi_strategies
                    (provider, strategy_name, strategy_type, service_type, as_on, ia_id, aum_crore, {", ".join(cols)}, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, {", ".join("?" for _ in cols)}, ?)
                    """,
                    [
                        (
                            s["provider"], s["strategy_name"], s["strategy_type"], s["service_type"], as_on,
                            s.get("ia_id"), s.get("aum_crore"), *(s.get(c) for c in cols), now,
                        )
                        for s in strategies
                    ],
                )
            return len(strategies)
        finally:
            conn.close()

    def pms_as_on_months(self) -> set[str]:
        conn = self._conn()
        try:
            return {r[0] for r in conn.execute("SELECT DISTINCT as_on FROM pms_apmi_strategies").fetchall()}
        finally:
            conn.close()

    # --- Factsheets ---

    def upsert_factsheet(self, source_key: str, f: Any) -> bool:
        """Insert a newly seen factsheet (True) or just refresh verified_at on a known one (False)."""
        now = _utcnow()
        conn = self._conn()
        try:
            with conn:
                cur = conn.execute("UPDATE factsheets SET verified_at = ?, url = ? WHERE source_key = ? AND period = ?", (now, f.url, source_key, f.period))
                if cur.rowcount:
                    return False
                conn.execute(
                    "INSERT INTO factsheets (source_key, period, title, url, size_bytes, sha256, archived_path, first_seen_at, verified_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (source_key, f.period, f.title, f.url, f.size_bytes, f.sha256, f.archived_path, now, now),
                )
                return True
        finally:
            conn.close()

    def factsheet_periods(self, source_key: str) -> set[str]:
        conn = self._conn()
        try:
            return {r[0] for r in conn.execute("SELECT period FROM factsheets WHERE source_key = ?", (source_key,)).fetchall()}
        finally:
            conn.close()

    def list_factsheets(self, source_key: str) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute("SELECT * FROM factsheets WHERE source_key = ? ORDER BY period DESC", (source_key,)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_factsheet(self, factsheet_id: int) -> dict[str, Any] | None:
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM factsheets WHERE id = ?", (factsheet_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def latest_pms_as_on(self) -> str | None:
        conn = self._conn()
        try:
            row = conn.execute("SELECT MAX(as_on) AS m FROM pms_apmi_strategies").fetchone()
            return row["m"] if row and row["m"] else None
        finally:
            conn.close()

    def list_pms_cached_benchmarks(self) -> dict[str, str]:
        """ia_id -> benchmark name from cached APMI strategy pages (only where a source name exists)."""
        conn = self._conn()
        try:
            rows = conn.execute("SELECT ia_id, detail_json FROM pms_strategy_details").fetchall()
        finally:
            conn.close()
        out: dict[str, str] = {}
        for row in rows:
            try:
                detail = json.loads(row["detail_json"])
            except (TypeError, ValueError):
                continue
            benchmark = (detail.get("benchmark") or "").strip() if isinstance(detail, dict) else ""
            if benchmark and benchmark.upper() not in {"NA", "N/A", "NIL", "-"}:
                out[str(row["ia_id"])] = benchmark
        return out

    def list_pms_universe_strategies(self, as_on: str | None = None) -> list[dict[str, Any]]:
        as_on = as_on or self.latest_pms_as_on()
        if not as_on:
            return []
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM pms_apmi_strategies WHERE as_on = ? ORDER BY aum_crore IS NULL, aum_crore DESC", (as_on,)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def list_pms_providers(self, as_on: str | None = None) -> list[dict[str, Any]]:
        """Every APMI provider with strategy count and total AUM for ``as_on`` (zero when it reported nothing)."""
        as_on = as_on or self.latest_pms_as_on() or ""
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT p.apmi_id, p.name,
                       COUNT(s.strategy_name) AS strategy_count,
                       COALESCE(SUM(s.aum_crore), 0) AS total_aum_crore,
                       GROUP_CONCAT(DISTINCT s.strategy_type) AS strategy_types
                FROM pms_providers p
                LEFT JOIN pms_apmi_strategies s ON s.provider = p.name AND s.as_on = ?
                GROUP BY p.apmi_id, p.name
                ORDER BY total_aum_crore DESC, p.name ASC
                """,
                (as_on,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_pms_strategy_detail_cache(self, ia_id: str) -> tuple[dict[str, Any], float] | None:
        """Cached APMI strategy-page facts and their age in seconds."""
        conn = self._conn()
        try:
            row = conn.execute("SELECT detail_json, fetched_at FROM pms_strategy_details WHERE ia_id = ?", (ia_id,)).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        try:
            age = (datetime.now(UTC) - datetime.fromisoformat(row["fetched_at"])).total_seconds()
            return json.loads(row["detail_json"]), age
        except (ValueError, TypeError):
            return None

    def put_pms_strategy_detail_cache(self, ia_id: str, detail: dict[str, Any]) -> None:
        conn = self._conn()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO pms_strategy_details (ia_id, detail_json, fetched_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(ia_id) DO UPDATE SET detail_json=excluded.detail_json, fetched_at=excluded.fetched_at",
                    (ia_id, json.dumps(detail), _utcnow()),
                )
        finally:
            conn.close()

    def list_pms_strategy_history(self, ia_id: str) -> list[dict[str, Any]]:
        """Every stored monthly row for a strategy, newest first."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM pms_apmi_strategies WHERE ia_id = ? ORDER BY as_on DESC, aum_crore DESC", (ia_id,)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def list_provider_strategies(self, provider: str, as_on: str, exclude_ia_id: str | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM pms_apmi_strategies WHERE provider = ? AND as_on = ? AND COALESCE(ia_id,'') != ? "
                "ORDER BY aum_crore IS NULL, aum_crore DESC",
                (provider, as_on, exclude_ia_id or ""),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- News (RSS) ---

    def upsert_news(self, items: list[dict[str, Any]], keep: int = 600) -> int:
        if not items:
            return 0
        now = _utcnow()
        conn = self._conn()
        try:
            with conn:
                conn.executemany(
                    """
                    INSERT INTO news_items (id, source_id, source_name, category, title, link, summary, published_at, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, fetched_at=excluded.fetched_at
                    """,
                    [
                        (i["id"], i["source_id"], i["source_name"], i["category"], i["title"], i["link"], i.get("summary"), i.get("published_at"), now)
                        for i in items
                    ],
                )
                conn.execute(
                    "DELETE FROM news_items WHERE id NOT IN (SELECT id FROM news_items ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?)",
                    (keep,),
                )
            return len(items)
        finally:
            conn.close()

    def list_news(self, limit: int = 40, category: str | None = None, source_id: str | None = None) -> list[dict[str, Any]]:
        clauses, params = [], []  # type: list[str], list[Any]
        if category:
            clauses.append("category = ?")
            params.append(category)
        if source_id:
            clauses.append("source_id = ?")
            params.append(source_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        conn = self._conn()
        try:
            rows = conn.execute(
                f"SELECT * FROM news_items {where} ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?",
                (*params, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- PMS Strategy Observations ---

    def list_pms_strategies(self, provider: str | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            if provider:
                rows = conn.execute(
                    "SELECT * FROM pms_strategy_observations WHERE provider = ? ORDER BY strategy_name ASC",
                    (provider,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM pms_strategy_observations ORDER BY report_month DESC, provider ASC",
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def upsert_pms_strategies(self, strategies: list[dict[str, Any]]) -> int:
        conn = self._conn()
        now = _utcnow()
        count = 0
        try:
            with conn:
                for s in strategies:
                    s_id = s.get("id") or _new_id()
                    conn.execute(
                        """
                        INSERT INTO pms_strategy_observations (
                            id, provider, strategy_name, approach, category,
                            report_month, aum_crore, return_1m, return_3m, return_6m,
                            return_1y, cagr_3y, cagr_5y, benchmark_name, benchmark_return_1y,
                            source, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            s_id,
                            s["provider"],
                            s["strategy_name"],
                            s.get("approach"),
                            s.get("category"),
                            s["report_month"],
                            s.get("aum_crore"),
                            s.get("return_1m"),
                            s.get("return_3m"),
                            s.get("return_6m"),
                            s.get("return_1y"),
                            s.get("cagr_3y"),
                            s.get("cagr_5y"),
                            s.get("benchmark_name"),
                            s.get("benchmark_return_1y"),
                            s.get("source", "APMI"),
                            now,
                        ),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    # --- Client PMS Portfolio Records ---

    def list_pms_accounts(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute("SELECT * FROM pms_accounts ORDER BY created_at DESC").fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_pms_account_tracker(self, account_id: str) -> dict[str, Any] | None:
        conn = self._conn()
        try:
            acc_row = conn.execute("SELECT * FROM pms_accounts WHERE id = ?", (account_id,)).fetchone()
            if not acc_row:
                return None
            acc = dict(acc_row)

            # Positions
            pos_rows = conn.execute(
                "SELECT * FROM portfolio_positions WHERE account_id = ? ORDER BY valuation_date DESC, market_value_paise DESC",
                (account_id,),
            ).fetchall()
            acc["positions"] = [dict(r) for r in pos_rows]

            # Cash flows
            flow_rows = conn.execute(
                "SELECT * FROM portfolio_cashflows WHERE account_id = ? ORDER BY flow_date ASC",
                (account_id,),
            ).fetchall()
            acc["cashflows"] = [dict(r) for r in flow_rows]

            # Valuations
            val_rows = conn.execute(
                "SELECT * FROM portfolio_valuations WHERE account_id = ? ORDER BY valuation_date DESC",
                (account_id,),
            ).fetchall()
            acc["valuations"] = [dict(r) for r in val_rows]

            return acc
        finally:
            conn.close()

    def add_portfolio_positions(self, positions: list[dict[str, Any]]) -> int:
        conn = self._conn()
        now = _utcnow()
        count = 0
        try:
            with conn:
                for p in positions:
                    p_id = p.get("id") or _new_id()
                    conn.execute(
                        """
                        INSERT INTO portfolio_positions (
                            id, account_id, valuation_date, security_type, symbol_or_isin,
                            security_name, quantity, cost_price_paise, market_price_paise,
                            market_value_paise, weight_pct, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            p_id,
                            p["account_id"],
                            p["valuation_date"],
                            p.get("security_type", "equity"),
                            p["symbol_or_isin"],
                            p["security_name"],
                            float(p["quantity"]),
                            int(p.get("cost_price_paise") or 0),
                            int(p.get("market_price_paise") or 0),
                            int(p["market_value_paise"]),
                            p.get("weight_pct"),
                            now,
                        ),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    def add_portfolio_cashflows(self, flows: list[dict[str, Any]]) -> int:
        conn = self._conn()
        now = _utcnow()
        count = 0
        try:
            with conn:
                for f in flows:
                    f_id = f.get("id") or _new_id()
                    conn.execute(
                        """
                        INSERT INTO portfolio_cashflows (
                            id, account_id, flow_date, flow_type, amount_paise, description, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            f_id,
                            f["account_id"],
                            f["flow_date"],
                            f.get("flow_type", "contribution"),
                            int(f["amount_paise"]),
                            f.get("description"),
                            now,
                        ),
                    )
                    count += 1
            return count
        finally:
            conn.close()

    # --- Watchlists & Research Notes ---

    def list_watchlists(self, staff_id: str) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute("SELECT * FROM watchlists WHERE staff_id = ? ORDER BY created_at DESC", (staff_id,)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def add_watchlist_item(self, staff_id: str, name: str, item_type: str, item_id: str) -> dict[str, Any]:
        conn = self._conn()
        wid = _new_id()
        now = _utcnow()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO watchlists (id, staff_id, name, item_type, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (wid, staff_id, name, item_type, item_id, now),
                )
            return {"id": wid, "staff_id": staff_id, "name": name, "item_type": item_type, "item_id": item_id, "created_at": now}
        finally:
            conn.close()

    def delete_watchlist_item(self, item_id: str, staff_id: str) -> bool:
        conn = self._conn()
        try:
            with conn:
                cur = conn.execute("DELETE FROM watchlists WHERE id = ? AND staff_id = ?", (item_id, staff_id))
                return cur.rowcount > 0
        finally:
            conn.close()

    def list_research_notes(self, entity_type: str | None = None, entity_id: str | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            query = "SELECT * FROM research_notes"
            params: list[Any] = []
            if entity_type and entity_id:
                query += " WHERE entity_type = ? AND entity_id = ?"
                params = [entity_type, entity_id]
            query += " ORDER BY updated_at DESC"
            rows = conn.execute(query, tuple(params)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def add_research_note(self, staff_id: str, entity_type: str, entity_id: str, title: str, content: str, tags: str | None = None) -> dict[str, Any]:
        conn = self._conn()
        nid = _new_id()
        now = _utcnow()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO research_notes (id, staff_id, entity_type, entity_id, title, content, tags, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (nid, staff_id, entity_type, entity_id, title, content, tags, now, now),
                )
            return {
                "id": nid, "staff_id": staff_id, "entity_type": entity_type,
                "entity_id": entity_id, "title": title, "content": content,
                "tags": tags, "created_at": now, "updated_at": now
            }
        finally:
            conn.close()

    # --- Staff ---

    def list_staff(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT id, name, email, mobile, role, status, is_staff FROM customers "
                "WHERE is_staff = 1 OR role IN ('admin','analyst','rm','operations','read_only') ORDER BY name ASC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- Audit Events ---

    def log_audit(self, staff_id: str | None, action: str, target_type: str, target_id: str | None = None, details: dict[str, Any] | None = None, ip_address: str | None = None) -> None:
        conn = self._conn()
        now = _utcnow()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO audit_events (id, staff_id, action, target_type, target_id, details_json, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (_new_id(), staff_id, action, target_type, target_id, json.dumps(details or {}), ip_address, now),
                )
        finally:
            conn.close()

    def list_audit_events(self, limit: int = 50) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
