from __future__ import annotations
"""AI fund picks for a plan (FH Recommended funds only) and the client's own reallocation of them.

Like the other plan endpoints, access is by the plan id. The AI runs once per plan; the result is stored, so
reloading never calls the model again. The client's edits overwrite the stored picks.
"""

import json
from datetime import UTC, datetime

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.ai import picks as ai_picks
from app.api.customer_portal import staff_only
from app.db import sqlite
from app.db.sqlite import get_default_connection

router = APIRouter(tags=["plan-picks"])

_DDL = """CREATE TABLE IF NOT EXISTS plan_ai_picks (
    plan_id TEXT PRIMARY KEY, body TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"""


class PickIn(BaseModel):
    scheme_code: str
    weight_pct: float


class PicksIn(BaseModel):
    picks: list[PickIn]


def _plan(plan_id: str) -> dict:
    row = sqlite.get_plan(plan_id)
    if not row:
        raise HTTPException(404, "Plan not found or expired.")
    return row["result"]


def _view(body: dict, edited: bool) -> dict:
    cands = {c["scheme_code"]: c for c in ai_picks.candidates()}
    funds = [{**cands[p["scheme_code"]], **p} for p in body["picks"] if p["scheme_code"] in cands]
    return {**body, "picks": funds, "edited": edited, "candidates": list(cands.values())}


@router.get("/api/plans/{plan_id}/ai-picks")
def get_ai_picks(plan_id: str):
    plan = _plan(plan_id)
    conn = get_default_connection()
    try:
        conn.execute(_DDL)
        row = conn.execute("SELECT body, edited FROM plan_ai_picks WHERE plan_id = ?", (plan_id,)).fetchone()
        if row:
            return _view(json.loads(row[0]), bool(row[1]))
        body = ai_picks.generate(plan, conn)
        with conn:
            conn.execute("INSERT OR IGNORE INTO plan_ai_picks (plan_id, body, edited, updated_at) VALUES (?, ?, 0, ?)",
                         (plan_id, json.dumps(body), datetime.now(UTC).isoformat()))
        return _view(body, False)
    finally:
        conn.close()


@router.put("/api/plans/{plan_id}/ai-picks")
def save_ai_picks(plan_id: str, body: PicksIn):
    _plan(plan_id)
    try:
        clean = ai_picks.validate_weights([p.model_dump() for p in body.picks], {c["scheme_code"] for c in ai_picks.candidates()})
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    conn = get_default_connection()
    try:
        conn.execute(_DDL)
        row = conn.execute("SELECT body FROM plan_ai_picks WHERE plan_id = ?", (plan_id,)).fetchone()
        saved = json.loads(row[0]) if row else {"market_note": "", "ai_generated": False, "notice": ""}
        old = {p["scheme_code"]: p.get("reason", "") for p in saved.get("picks", [])}
        cands = {c["scheme_code"]: c for c in ai_picks.candidates()}
        saved["picks"] = [{"scheme_code": p["scheme_code"], "weight_pct": p["weight_pct"],
                           "reason": old.get(p["scheme_code"]) or ai_picks._template_reason(cands[p["scheme_code"]])} for p in clean]
        with conn:
            conn.execute("INSERT OR REPLACE INTO plan_ai_picks (plan_id, body, edited, updated_at) VALUES (?, ?, 1, ?)",
                         (plan_id, json.dumps(saved), datetime.now(UTC).isoformat()))
        return _view(saved, True)
    finally:
        conn.close()


class PreviewIn(BaseModel):
    band: str
    equity: float
    debt: float
    gold: float
    liquid: float


_PREVIEW_CACHE: dict[str, dict] = {}


@router.post("/api/staff/ai-picks")
def preview_ai_picks(body: PreviewIn, _: Annotated[dict, Depends(staff_only)]):
    """Picks for a risk profile that has no saved plan (Risk Profiling Studio). Nothing is stored; repeats are cached."""
    key = body.model_dump_json()
    if key not in _PREVIEW_CACHE:
        conn = get_default_connection()
        try:
            plan = {"profile": {"band": body.band}, "data_asof": None,
                    "allocation": {"by_asset_class": {"equity": body.equity, "debt": body.debt, "gold": body.gold, "liquid": body.liquid}}}
            _PREVIEW_CACHE[key] = ai_picks.generate(plan, conn)
        finally:
            conn.close()
    return _view(_PREVIEW_CACHE[key], False)
