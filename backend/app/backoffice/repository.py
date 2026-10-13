"""Backoffice repository for persistence, querying, and auditing."""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from app.backoffice.db import ensure_backoffice_schema
from app.db import sqlite as _sqlite


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class BackofficeRepository:
    """Repository handling all backoffice queries and transactions."""

    def __init__(self) -> None:
        ensure_backoffice_schema()

    def _conn(self):
        ensure_backoffice_schema()
        return _sqlite.get_default_connection()

    # --- Sources & Health ---

    def list_sources(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute("SELECT * FROM source_registry ORDER BY name ASC").fetchall()
            return [dict(r) for r in rows]
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
                    inst_id = obs.instrument_id if hasattr(obs, "instrument_id") else obs["instrument_id"]
                    observed_at = obs.observed_at if hasattr(obs, "observed_at") else obs["observed_at"]
                    val_num = obs.value_numeric if hasattr(obs, "value_numeric") else obs.get("value_numeric")
                    val_txt = obs.value_text if hasattr(obs, "value_text") else obs.get("value_text")
                    freq = getattr(obs, "frequency", "daily")
                    vintage = getattr(obs, "vintage", "initial")
                    prov = getattr(obs, "provenance", "automated")
                    flags = getattr(obs, "quality_flags", "ok")

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
