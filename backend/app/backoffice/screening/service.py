"""Service layer for fund screening: metrics retrieval, funnel runs, presets, and exports."""
from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from app.backoffice.providers.manual import sanitize_cell
from app.backoffice.repository import BackofficeRepository
from app.backoffice.screening.funnel import apply_funnel
from app.config import load_screening


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class ScreeningService:
    """Orchestrates screening queries, funnel runs, and export generation."""

    def __init__(self, repo: BackofficeRepository | None = None) -> None:
        self.repo = repo or BackofficeRepository()
        self.cfg = load_screening()

    def get_screening_metrics(
        self,
        cat: str | None = None,
        amc: str | None = None,
        q_search: str | None = None,
        columns: list[str] | None = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        """Fetch precomputed metrics from mf_screening_metrics table with facets."""
        conn = self.repo._conn()
        try:
            query = "SELECT * FROM mf_screening_metrics WHERE 1=1"
            params: list[Any] = []
            if cat:
                query += " AND cat = ?"
                params.append(cat)
            if amc:
                query += " AND amc = ?"
                params.append(amc)
            if q_search:
                query += " AND (scheme_name LIKE ? OR scheme_code LIKE ?)"
                params.extend([f"%{q_search}%", f"%{q_search}%"])
            if as_of:
                query += " AND as_of = ?"
                params.append(as_of)

            query += " ORDER BY cat ASC, scheme_name ASC"
            rows = [dict(r) for r in conn.execute(query, params).fetchall()]

            # Fetch distinct facets from entire screening metrics table
            all_cats = [r["cat"] for r in conn.execute("SELECT DISTINCT cat FROM mf_screening_metrics ORDER BY cat").fetchall() if r["cat"]]
            all_amcs = [r["amc"] for r in conn.execute("SELECT DISTINCT amc FROM mf_screening_metrics ORDER BY amc").fetchall() if r["amc"]]

            max_as_of = rows[0]["as_of"] if rows else None
            rf_val = 0.065
            rf_src = "assumptions_fixed"
            if rows:
                try:
                    prov = json.loads(rows[0].get("provenance_json") or "{}")
                    rf_val = prov.get("rf", 0.065)
                    rf_src = prov.get("rf_source", "assumptions_fixed")
                except Exception:
                    pass

            return {
                "as_of": max_as_of,
                "rf": rf_val,
                "rf_source": rf_src,
                "benchmark_policy": "category_median",
                "ratios": self.cfg.get("ratios", []),
                "rows": rows,
                "facets": {"amcs": all_amcs, "cats": all_cats},
                "total": len(rows),
            }
        finally:
            conn.close()

    def run_screening(
        self,
        staff_id: str,
        preset_id: str | None = None,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute screening funnel on S0 universe and attach PMS matches."""
        conn = self.repo._conn()
        try:
            if preset_id and not filters:
                p_row = conn.execute(
                    "SELECT filters_json FROM screening_presets WHERE id = ? AND staff_id = ?",
                    (preset_id, staff_id),
                ).fetchone()
                if p_row:
                    filters = json.loads(p_row["filters_json"])

            filters = filters or {}

            # Load S0 metrics
            rows = [dict(r) for r in conn.execute("SELECT * FROM mf_screening_metrics").fetchall()]

            # Extract category median TERs
            cat_median_ters: dict[str, float] = {}
            for r in rows:
                cat = r["cat"]
                if cat not in cat_median_ters:
                    try:
                        prov = json.loads(r.get("provenance_json") or "{}")
                        if prov.get("cat_median_ter") is not None:
                            cat_median_ters[cat] = float(prov["cat_median_ter"])
                    except Exception:
                        pass

            # If not in provenance, calculate dynamically from rows
            if not cat_median_ters:
                cat_ters: dict[str, list[float]] = {}
                for r in rows:
                    if r.get("expense_ratio") is not None:
                        cat_ters.setdefault(r["cat"], []).append(float(r["expense_ratio"]))
                for cat, ters in cat_ters.items():
                    sorted_ters = sorted(ters)
                    mid = len(sorted_ters) // 2
                    cat_median_ters[cat] = (sorted_ters[mid] if len(sorted_ters) % 2 != 0 else (sorted_ters[mid - 1] + sorted_ters[mid]) / 2.0)

            # Apply funnel
            res = apply_funnel(rows, filters=filters, cat_median_ters=cat_median_ters)

            # Match PMS manager names
            pms_strategies = conn.execute(
                "SELECT ia_id, strategy_name, provider FROM pms_apmi_strategies"
            ).fetchall()
            pms_map: dict[str, dict[str, Any]] = {}
            for ps in pms_strategies:
                name_key = ps["strategy_name"].strip().lower()
                pms_map[name_key] = {
                    "ia_id": ps["ia_id"],
                    "strategy_name": ps["strategy_name"],
                    "fund_manager": ps["provider"],
                }

            for r in res["action"]:
                mgr = (r.get("manager_name") or "").strip().lower()
                r["pms_link"] = pms_map.get(mgr)

            for r in res["retain"]:
                mgr = (r.get("manager_name") or "").strip().lower()
                r["pms_link"] = pms_map.get(mgr)

            run_id = f"run_{_new_id()}"
            now = _utcnow()
            conn.execute(
                """
                INSERT INTO screening_runs (id, staff_id, preset_id, filters_json, stage_counts_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    staff_id,
                    preset_id,
                    json.dumps(filters),
                    json.dumps(res["counts"]),
                    now,
                ),
            )

            as_of_val = rows[0]["as_of"] if rows else datetime.now(UTC).strftime("%Y-%m-%d")

            return {
                "data": {
                    "run_id": run_id,
                    "as_of": as_of_val,
                    "counts": res["counts"],
                    "action": res["action"],
                    "retain": res["retain"],
                },
                "availability": "ready" if rows else "unavailable",
                "freshness": "current" if rows else "stale",
                "method_version": "1.0.0",
            }
        finally:
            conn.close()

    def get_screening_run(self, run_id: str, staff_id: str) -> dict[str, Any] | None:
        """Fetch saved screening run details."""
        conn = self.repo._conn()
        try:
            row = conn.execute(
                "SELECT * FROM screening_runs WHERE id = ? AND staff_id = ?",
                (run_id, staff_id),
            ).fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "staff_id": row["staff_id"],
                "preset_id": row["preset_id"],
                "filters": json.loads(row["filters_json"]),
                "counts": json.loads(row["stage_counts_json"]),
                "created_at": row["created_at"],
            }
        finally:
            conn.close()

    def get_screening_fund(self, scheme_code: str) -> dict[str, Any] | None:
        """Fetch single scheme row with manager, notes, and PMS matches."""
        conn = self.repo._conn()
        try:
            row = conn.execute(
                "SELECT * FROM mf_screening_metrics WHERE scheme_code = ?",
                (scheme_code,),
            ).fetchone()
            if not row:
                return None
            data = dict(row)

            # Manager details
            mgr = conn.execute(
                "SELECT * FROM mf_managers WHERE scheme_code = ?",
                (scheme_code,),
            ).fetchone()
            data["manager"] = dict(mgr) if mgr else None

            # PMS matches
            mgr_name = data.get("manager_name") or ""
            pms_matches = []
            if mgr_name:
                pms_rows = conn.execute(
                    "SELECT ia_id, strategy_name, provider, aum_crore, return_1y, return_3y FROM pms_apmi_strategies WHERE strategy_name LIKE ? OR provider LIKE ?",
                    (f"%{mgr_name}%", f"%{mgr_name}%"),
                ).fetchall()
                pms_matches = [dict(pr) for pr in pms_rows]
            data["pms_matches"] = pms_matches

            # Recent analyst notes
            notes = conn.execute(
                "SELECT * FROM research_notes WHERE entity_type = 'scheme' AND entity_id = ? ORDER BY created_at DESC LIMIT 5",
                (scheme_code,),
            ).fetchall()
            data["notes"] = [dict(n) for n in notes]

            return data
        finally:
            conn.close()

    def list_presets(self, staff_id: str) -> list[dict[str, Any]]:
        """List presets belonging to staff member."""
        conn = self.repo._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM screening_presets WHERE staff_id = ? ORDER BY updated_at DESC",
                (staff_id,),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "filters": json.loads(r["filters_json"]),
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                }
                for r in rows
            ]
        finally:
            conn.close()

    def save_preset(self, staff_id: str, name: str, filters: dict[str, Any]) -> dict[str, Any]:
        """Create or update a preset."""
        preset_id = _new_id()
        now = _utcnow()
        conn = self.repo._conn()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO screening_presets (id, staff_id, name, filters_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (preset_id, staff_id, name.strip(), json.dumps(filters), now, now),
                )
            return {"id": preset_id, "name": name, "filters": filters, "created_at": now, "updated_at": now}
        finally:
            conn.close()

    def delete_preset(self, staff_id: str, preset_id: str) -> bool:
        """Delete a preset scoped to staff member."""
        conn = self.repo._conn()
        try:
            with conn:
                res = conn.execute(
                    "DELETE FROM screening_presets WHERE id = ? AND staff_id = ?",
                    (preset_id, staff_id),
                )
                return res.rowcount > 0
        finally:
            conn.close()

    def export_csv(
        self,
        staff_id: str,
        run_id: str,
        include_retain: bool = False,
    ) -> str:
        """Generate formula-sanitized CSV export for a run."""
        conn = self.repo._conn()
        try:
            run_row = conn.execute(
                "SELECT filters_json FROM screening_runs WHERE id = ? AND staff_id = ?",
                (run_id, staff_id),
            ).fetchone()
            filters = json.loads(run_row["filters_json"]) if run_row else {}

            # Re-run funnel to obtain exact action (and retain) rows
            run_res = self.run_screening(staff_id, filters=filters)
            rows = list(run_res["data"]["action"])
            if include_retain:
                rows.extend(run_res["data"]["retain"])

            selected_cols = filters.get("columns", ["sharpe", "sortino", "up_capture", "down_capture", "expense_ratio"])
            identity_cols = ["scheme_code", "scheme_name", "cat", "amc", "manager_name", "manager_tenure_years", "quartile_2y", "expense_ratio"]

            headers = list(identity_cols)
            for c in selected_cols:
                if c not in headers:
                    headers.append(c)
            headers.extend(["ret_1y", "cagr_3y", "cagr_5y", "cagr_si", "quartile_source", "action_status"])

            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(headers)

            for r in rows:
                row_vals = [sanitize_cell(r.get(h, "")) for h in headers]
                writer.writerow(row_vals)

            return output.getvalue()
        finally:
            conn.close()
