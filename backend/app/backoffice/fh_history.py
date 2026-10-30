from __future__ import annotations
"""FH recommendation history: episodes, append-only events, immutable decision snapshots, then-vs-now and outcome reviews.

Four things are kept apart: list membership (episode/event), model assessment (score in the snapshot), review status and data status
(both inside the snapshot). Snapshots and events cannot be updated or deleted (SQLite triggers); a correction is a NEW snapshot
version that points at the one it supersedes. A "migration" snapshot is built from current data for funds that were listed before
history existed: it never carries an invented date, score or rationale.
"""

import hashlib
import json
import sqlite3
import uuid
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd

from app.db import sqlite as _sqlite

MODEL_VERSION = "fh-score-2"
EVENT_TYPES = ("Added", "Reviewed", "Updated", "Removed", "Re-added")
NEEDS_REASON = ("Added", "Removed", "Re-added")
SUGGESTED_REASONS = {
    "Added": ["Strong category-relative risk-adjusted metrics", "Consistent top-half category returns", "Stable fund management and process",
              "Client demand / mandate fit"],
    "Removed": ["Sustained underperformance vs benchmark and category", "Manager change", "Mandate or category change",
                "Merger or closure", "Risk metrics deteriorated", "Data no longer supports the thesis"],
    "Re-added": ["Thesis restored after review", "Metrics recovered vs category"],
}
BENCH_NOTE = ("Benchmark returns come from the passive index fund tracking the category benchmark (no TRI series is ingested); "
              "they lag the true total-return index slightly.")
_DDL = """
CREATE TABLE IF NOT EXISTS fh_reco_episode (id TEXT PRIMARY KEY, scheme_code TEXT NOT NULL, plan TEXT, started_on TEXT, ended_on TEXT,
  origin TEXT NOT NULL, prev_episode_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_fh_episode_code ON fh_reco_episode(scheme_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fh_episode_active ON fh_reco_episode(scheme_code) WHERE ended_on IS NULL;
CREATE TABLE IF NOT EXISTS fh_snapshot (id TEXT PRIMARY KEY, scheme_code TEXT NOT NULL, episode_id TEXT, kind TEXT NOT NULL,
  label TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, supersedes_id TEXT, captured_at TEXT NOT NULL, as_of TEXT,
  content_hash TEXT NOT NULL, model_version TEXT, config_hash TEXT, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_fh_snapshot_code ON fh_snapshot(scheme_code, captured_at);
CREATE TABLE IF NOT EXISTS fh_reco_event (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, scheme_code TEXT NOT NULL, plan TEXT,
  event_type TEXT NOT NULL, event_ts TEXT NOT NULL, effective_date TEXT, actor TEXT NOT NULL, reason TEXT, notes TEXT,
  prev_state TEXT, new_state TEXT, snapshot_id TEXT, model_version TEXT, config_hash TEXT);
CREATE INDEX IF NOT EXISTS ix_fh_event_code ON fh_reco_event(scheme_code, event_ts);
CREATE TABLE IF NOT EXISTS fh_thesis_note (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, review_date TEXT, actor TEXT NOT NULL,
  missed TEXT, future_selection TEXT, conclusion TEXT, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS fh_snapshot_no_update BEFORE UPDATE ON fh_snapshot BEGIN SELECT RAISE(ABORT, 'fh_snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS fh_snapshot_no_delete BEFORE DELETE ON fh_snapshot BEGIN SELECT RAISE(ABORT, 'fh_snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS fh_event_no_update BEFORE UPDATE ON fh_reco_event BEGIN SELECT RAISE(ABORT, 'fh_reco_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS fh_event_no_delete BEFORE DELETE ON fh_reco_event BEGIN SELECT RAISE(ABORT, 'fh_reco_event is append-only'); END;
"""
_READY: set[str] = set()


def _conn() -> sqlite3.Connection:
    conn = _sqlite.get_default_connection()
    key = str(_sqlite.get_default_db_path())
    if key not in _READY:
        with conn:
            for stmt in _DDL.split(";\n"):  # triggers contain no inner ';' followed by newline
                if stmt.strip():
                    conn.execute(stmt)
        _READY.add(key)
    return conn


IST = timezone(timedelta(hours=5, minutes=30))


def _now() -> str:
    return datetime.now(UTC).isoformat()


def today_ist() -> date:
    return datetime.now(IST).date()


def _v(x: Any) -> Any:
    """JSON-safe, NaN -> None."""
    if x is None:
        return None
    if isinstance(x, (np.floating, float)):
        return None if np.isnan(x) else round(float(x), 6)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, (list, tuple)):
        return [_v(i) for i in x]
    return x


def config_hash(cfg: dict) -> str:
    return hashlib.sha1(json.dumps(cfg, sort_keys=True, default=str).encode()).hexdigest()[:10]


# --- snapshot payload ---------------------------------------------------------------------------------------------------

_RET = {"1m": "ret_1m", "3m": "ret_3m", "1y": "ret_1y", "3y": "cagr_3y", "5y": "cagr_5y"}


def period_comparison(r: pd.Series, bench: dict[str, float | None]) -> list[dict]:
    """Fund vs benchmark and fund vs category average, kept as two separate comparisons. Excess is a simple return difference
    in percentage points, never called alpha (Jensen alpha is a separate, imported figure)."""
    out = []
    for label, col in _RET.items():
        fund, cat = _v(r.get(col)), _v(r.get(f"{col}_cat"))
        b = bench.get(col)
        out.append({
            "period": label, "fund": fund, "benchmark": b, "category_average": cat,
            "excess_vs_benchmark_pp": None if fund is None or b is None else round(fund - b, 3),
            "excess_vs_category_pp": None if fund is None or cat is None else round(fund - cat, 3),
            "return_basis": "absolute" if label in ("1m", "3m") else ("absolute (1Y)" if label == "1y" else "annualised (CAGR)"),
        })
    return out


def _bench_returns(df: pd.DataFrame, r: pd.Series) -> dict[str, float | None]:
    from app.backoffice.mf_screener import BENCHMARK_PROXY

    code = BENCHMARK_PROXY.get(r["cat"])
    row = df[df["code"] == code]
    return {col: (_v(row.iloc[0][col]) if len(row) else None) for col in _RET.values()}


def build_payload(df: pd.DataFrame, code: str, cfg: dict, note: str = "") -> dict:
    """Everything the system knew about a fund now, from the scored frame. Pure; stores nothing."""
    from app.backoffice import fh_catscore, fh_score
    from app.backoffice.mf_screener import BENCHMARK_PROXY, BENCHMARKS

    hit = df[df["code"] == str(code)]
    if hit.empty:
        raise KeyError(f"unknown scheme {code}")
    r = hit.iloc[0]
    eligible, why = fh_catscore.peer_eligibility(df)
    grp = (df["cat"] == r["cat"]) & (df["plan"] == r["plan"])
    excl = why[grp & ~eligible].value_counts().to_dict()
    ex = fh_score.explain_row(r, cfg)
    risk = {}
    for m in fh_catscore.METRICS:
        for y in fh_catscore.PERIODS:
            risk[f"{m}_{y}y"] = {k: _v(r.get(f"fhc_{m}_{y}{s}")) for k, s in (("value", ""), ("category_average", "_avg"), ("peers", "_n"), ("percentile", "_pct"))} \
                if f"fhc_{m}_{y}" in r else {"value": _v(r.get(fh_catscore.METRICS[m][0].format(y)))}
    return {
        "identity": {"scheme_code": str(code), "name": r["name"], "plan": r["plan"], "category": r["cat"], "isin": _v(r.get("isin")),
                     "benchmark": BENCHMARKS.get(r["cat"], "Scheme's tracked index"), "benchmark_proxy_scheme": BENCHMARK_PROXY.get(r["cat"])},
        "manager": {"name": _v(r.get("manager_name")), "start": _v(r.get("manager_start")), "tenure_years": _v(r.get("manager_tenure_years"))},
        "returns": period_comparison(r, _bench_returns(df, r)),
        "risk_metrics": risk,
        "jensen_alpha_3y": {"value": _v(r.get("alpha_3y")), "basis": "vs category+plan median daily return, not an index"},
        "model": {"score": _v(r["fh_score"]), "rating": _v(r["fh_rating"]), "signal": r["fh_signal"], "coverage": _v(r["fh_coverage"]),
                  "scoring_mode": cfg["ratios"].get("mode", "legacy"), "filters": [{k: _v(f[k]) for k in ("key", "weight", "points", "coverage", "status")} for f in ex["filters"]],
                  "penalty_total": ex["penalty_total"], "adjustment": ex["adjustment"], "flags": [f["code"] for f in ex["flags"]]},
        "metric_breakdown": next((f["components"] for f in ex["filters"] if f["key"] == "ratios"), []),
        "status": {"data": _v(r.get("fh_data_status")), "data_text": _v(r.get("fh_data_reason")), "review": _v(r.get("fh_review_status"))},
        "peer_universe": {"id": f"{r['cat']}|{r['plan']}", "eligible": int((grp & eligible).sum()), "excluded": excl,
                          "policy": "same category and plan; open-ended; clean NAV; one row per ISIN; equal-weight mean includes the subject fund"},
        "sources": [{"name": "NAV, returns, Sharpe, Sortino, drawdown", "source": "AMFI + mfapi.in via all_schemes_metrics.csv"},
                    {"name": "Capture ratios", "source": "Advisorkhoj (committed JSON)"}, {"name": "Benchmark", "source": BENCH_NOTE}],
        "methodology": {"model_version": MODEL_VERSION, "catscore_version": fh_catscore.VERSION, "config_hash": config_hash(cfg),
                        "ratio_metrics": fh_catscore.METHODOLOGY},
        "timestamps": {"observation": _v(r.get("nav_date")), "publication": None, "publication_note": "Source publication time is not recorded.",
                       "retrieval": _now()},
        "analyst_note": note,
    }


def _hash(payload: dict) -> str:
    p = {k: v for k, v in payload.items() if k not in ("timestamps", "analyst_note")}  # re-capture of unchanged data must dedupe
    return hashlib.sha1(json.dumps(p, sort_keys=True, default=str).encode()).hexdigest()


def _store_snapshot(conn, code: str, episode_id: str | None, kind: str, label: str, payload: dict, supersedes: str | None = None) -> str:
    h = _hash(payload)
    last = conn.execute("SELECT id, content_hash, version FROM fh_snapshot WHERE scheme_code=? AND kind=? AND episode_id IS ? ORDER BY captured_at DESC, rowid DESC LIMIT 1",
                        (code, kind, episode_id)).fetchone()
    if last and last["content_hash"] == h and not supersedes and kind == "scheduled":
        return last["id"]  # idempotent: nothing changed since the last scheduled snapshot
    sid = uuid.uuid4().hex
    version = (last["version"] + 1) if (supersedes and last) else 1
    conn.execute("INSERT INTO fh_snapshot(id,scheme_code,episode_id,kind,label,version,supersedes_id,captured_at,as_of,content_hash,model_version,config_hash,payload)"
                 " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (sid, code, episode_id, kind, label, version, supersedes, _now(), payload["timestamps"]["observation"], h,
                  MODEL_VERSION, payload["methodology"]["config_hash"], json.dumps(payload, default=str)))
    return sid


# --- episodes and events ------------------------------------------------------------------------------------------------

def active_episode(conn, code: str):
    return conn.execute("SELECT * FROM fh_reco_episode WHERE scheme_code=? AND ended_on IS NULL ORDER BY created_at DESC LIMIT 1", (code,)).fetchone()


def record_event(df: pd.DataFrame, cfg: dict, code: str, event_type: str, actor: str, reason: str = "", notes: str = "",
                 effective_date: str | None = None) -> dict:
    """Append one recommendation event with a linked snapshot. Raises ValueError on a rule violation (nothing is written)."""
    code = str(code)
    if event_type not in EVENT_TYPES:
        raise ValueError(f"event_type must be one of {EVENT_TYPES}")
    reason = (reason or "").strip()
    if event_type in NEEDS_REASON and len(reason) < 3:
        raise ValueError(f"A reason is required for {event_type}.")
    conn = _conn()
    ep = active_episode(conn, code)
    eff = effective_date or today_ist().isoformat()
    try:
        date.fromisoformat(eff)
    except ValueError:
        raise ValueError("effective_date must be YYYY-MM-DD") from None
    prev = conn.execute("SELECT * FROM fh_reco_episode WHERE scheme_code=? AND ended_on IS NOT NULL ORDER BY ended_on DESC, created_at DESC LIMIT 1", (code,)).fetchone()
    if event_type in ("Added", "Re-added"):
        if ep:
            raise ValueError("Fund is already on the FH list.")
        event_type = "Re-added" if prev else "Added"
    elif not ep:
        raise ValueError(f"{event_type} needs an active recommendation; the fund is not on the FH list.")
    payload = build_payload(df, code, cfg, note=f"{reason} {notes}".strip())
    with conn:
        if event_type in ("Added", "Re-added"):
            eid = uuid.uuid4().hex
            try:  # the unique active-episode index makes a concurrent double add fail here
                conn.execute("INSERT INTO fh_reco_episode VALUES(?,?,?,?,?,?,?,?)",
                             (eid, code, payload["identity"]["plan"], eff, None, "recorded", prev["id"] if prev else None, _now()))
            except sqlite3.IntegrityError:
                raise ValueError("Fund is already on the FH list.") from None
        else:
            eid = ep["id"]
        if event_type == "Removed" and conn.execute("UPDATE fh_reco_episode SET ended_on=? WHERE id=? AND ended_on IS NULL", (eff, eid)).rowcount != 1:
            raise ValueError("Fund was already removed.")
        sid = _store_snapshot(conn, code, eid, event_type.lower(), "recorded", payload)
        ev = uuid.uuid4().hex
        conn.execute("INSERT INTO fh_reco_event VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (ev, eid, code, payload["identity"]["plan"], event_type, _now(), eff, actor, reason, notes,
                      "listed" if ep else "not_listed", "not_listed" if event_type == "Removed" else "listed", sid, MODEL_VERSION,
                      payload["methodology"]["config_hash"]))
    return {"event_id": ev, "episode_id": eid, "snapshot_id": sid, "event_type": event_type}


def migrate_listed(df: pd.DataFrame, cfg: dict, codes: dict[str, str], actor: str = "system:migration") -> list[str]:
    """One-off, idempotent: funds on the list with no history get a clearly labelled baseline from current data."""
    conn, done = _conn(), []
    for code in codes:
        if conn.execute("SELECT 1 FROM fh_reco_episode WHERE scheme_code=?", (code,)).fetchone() or df[df["code"] == code].empty:
            continue
        payload = build_payload(df, code, cfg, note="Migration baseline built from current data. Original recommendation date, score and rationale are unknown.")
        try:
            with conn:
                eid = uuid.uuid4().hex
                conn.execute("INSERT INTO fh_reco_episode VALUES(?,?,?,?,?,?,?,?)", (eid, code, payload["identity"]["plan"], None, None, "migration", None, _now()))
                sid = _store_snapshot(conn, code, eid, "migration", "migration", payload)
                conn.execute("INSERT INTO fh_reco_event VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                             (uuid.uuid4().hex, eid, code, payload["identity"]["plan"], "Added", _now(), None, actor,
                              "Pre-existing FH list member", "Migration baseline: original date and rationale not recorded.", "unknown", "listed", sid,
                              MODEL_VERSION, payload["methodology"]["config_hash"]))
        except sqlite3.IntegrityError:
            continue  # another worker migrated it first
        done.append(code)
    return done


def scheduled_snapshots(df: pd.DataFrame, cfg: dict) -> dict[str, int]:
    """Snapshot every active episode; unchanged data stores nothing. Safe to run as often as the refresh runs."""
    conn = _conn()
    n_new = n_same = 0
    for ep in conn.execute("SELECT * FROM fh_reco_episode WHERE ended_on IS NULL").fetchall():
        if df[df["code"] == ep["scheme_code"]].empty:
            continue
        before = conn.execute("SELECT COUNT(*) c FROM fh_snapshot WHERE scheme_code=?", (ep["scheme_code"],)).fetchone()["c"]
        with conn:
            _store_snapshot(conn, ep["scheme_code"], ep["id"], "scheduled", "recorded", build_payload(df, ep["scheme_code"], cfg))
        after = conn.execute("SELECT COUNT(*) c FROM fh_snapshot WHERE scheme_code=?", (ep["scheme_code"],)).fetchone()["c"]
        n_new += after - before
        n_same += int(after == before)
    return {"stored": n_new, "unchanged": n_same}


def correct_snapshot(snapshot_id: str, actor: str, reason: str, patch: dict) -> str:
    """Corrections never edit: they create version n+1 that points at the snapshot it supersedes, with an audit event."""
    if len((reason or "").strip()) < 3:
        raise ValueError("A reason is required for a correction.")
    conn = _conn()
    old = conn.execute("SELECT * FROM fh_snapshot WHERE id=?", (snapshot_id,)).fetchone()
    if not old:
        raise KeyError(snapshot_id)
    payload = {**json.loads(old["payload"]), **patch}
    payload["analyst_note"] = f"Correction by {actor}: {reason}"
    with conn:
        sid = uuid.uuid4().hex
        ver = conn.execute("SELECT MAX(version) m FROM fh_snapshot WHERE scheme_code=? AND episode_id IS ?", (old["scheme_code"], old["episode_id"])).fetchone()["m"] + 1
        conn.execute("INSERT INTO fh_snapshot(id,scheme_code,episode_id,kind,label,version,supersedes_id,captured_at,as_of,content_hash,model_version,config_hash,payload)"
                     " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (sid, old["scheme_code"], old["episode_id"], "correction", old["label"], ver, snapshot_id, _now(), old["as_of"], _hash(payload),
                      old["model_version"], old["config_hash"], json.dumps(payload, default=str)))
        if old["episode_id"]:
            conn.execute("INSERT INTO fh_reco_event VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (uuid.uuid4().hex, old["episode_id"], old["scheme_code"], None, "Updated", _now(), None, actor, reason,
                          f"Snapshot {snapshot_id[:8]} corrected as version {ver}", "listed", "listed", sid, old["model_version"], old["config_hash"]))
    return sid


def history(code: str) -> dict:
    conn = _conn()
    eps = [dict(r) for r in conn.execute("SELECT * FROM fh_reco_episode WHERE scheme_code=? ORDER BY created_at", (code,))]
    evs = [dict(r) for r in conn.execute("SELECT * FROM fh_reco_event WHERE scheme_code=? ORDER BY event_ts", (code,))]
    snaps = [dict(r) for r in conn.execute("SELECT id,episode_id,kind,label,version,supersedes_id,captured_at,as_of,model_version,config_hash FROM fh_snapshot WHERE scheme_code=? ORDER BY captured_at", (code,))]
    return {"episodes": eps, "events": evs, "snapshots": snaps}


def snapshot(snapshot_id: str) -> dict | None:
    r = _conn().execute("SELECT * FROM fh_snapshot WHERE id=?", (snapshot_id,)).fetchone()
    return None if not r else {**{k: r[k] for k in r.keys() if k != "payload"}, "payload": json.loads(r["payload"])}


def snapshot_as_of(code: str, on: str) -> dict:
    """Question A: what did we know then? Latest REAL snapshot taken by the end of that day (IST); never reconstructed."""
    d = date.fromisoformat(on)
    cutoff = datetime(d.year, d.month, d.day, tzinfo=IST) + timedelta(days=1)
    r = _conn().execute("SELECT * FROM fh_snapshot WHERE scheme_code=? AND captured_at<? ORDER BY captured_at DESC, rowid DESC LIMIT 1",
                        (code, cutoff.astimezone(UTC).isoformat())).fetchone()
    if not r:
        return {"available": False, "message": f"No snapshot exists on or before {d.isoformat()}. Nothing is reconstructed here."}
    taken = datetime.fromisoformat(r["captured_at"]).astimezone(IST).date()
    return {"available": True, "snapshot_date": taken.isoformat(), "age_days": (d - taken).days, "label": r["label"], "kind": r["kind"],
            "snapshot_id": r["id"], "payload": json.loads(r["payload"])}


def add_thesis_note(episode_id: str, actor: str, review_date: str | None, missed: str, future: str, conclusion: str) -> str:
    nid = uuid.uuid4().hex
    conn = _conn()
    with conn:
        conn.execute("INSERT INTO fh_thesis_note VALUES(?,?,?,?,?,?,?,?)", (nid, episode_id, review_date, actor, missed, future, conclusion, _now()))
    return nid


# --- then vs now --------------------------------------------------------------------------------------------------------

def _diff(a, b):
    return None if a is None or b is None else round(b - a, 4)


def then_vs_now(then: dict, now: dict) -> dict:
    """Two snapshot payloads side by side. Quantitative changes come from numbers; qualitative events only from recorded facts, and no
    cause is inferred (a manager change is listed as an event, never as the reason for a metric move)."""
    def ret(p, period, k):
        return next((x[k] for x in p["returns"] if x["period"] == period), None)

    def rm(p, key):
        return (p["risk_metrics"].get(key) or {}).get("value")

    rows = [
        {"dimension": "Model score", "then": then["model"]["score"], "now": now["model"]["score"], "change": _diff(then["model"]["score"], now["model"]["score"]),
         "note": f"{then['methodology']['model_version']}/{then['model']['scoring_mode']} then; {now['methodology']['model_version']}/{now['model']['scoring_mode']} now"},
        {"dimension": "Data coverage", "then": then["model"]["coverage"], "now": now["model"]["coverage"], "change": _diff(then["model"]["coverage"], now["model"]["coverage"])},
    ]
    for per in ("1y", "3y", "5y"):
        for k, lab in (("excess_vs_benchmark_pp", "Excess vs benchmark"), ("excess_vs_category_pp", "Excess vs category")):
            a, b = ret(then, per, k), ret(now, per, k)
            rows.append({"dimension": f"{lab} {per} (pp)", "then": a, "now": b, "change": _diff(a, b)})
    for m in ("sharpe", "sortino", "treynor", "beta", "cap_up", "cap_down"):
        a, b = rm(then, f"{m}_3y"), rm(now, f"{m}_3y")
        rows.append({"dimension": f"{m.replace('_', ' ').title()} 3Y", "then": a, "now": b, "change": _diff(a, b)})
    rows.append({"dimension": "Fund manager", "then": then["manager"]["name"], "now": now["manager"]["name"],
                 "change": None if then["manager"]["name"] == now["manager"]["name"] else "changed"})
    quant = [r for r in rows if isinstance(r["change"], (int, float)) and r["change"] != 0]
    events = []
    if then["manager"]["name"] and now["manager"]["name"] and then["manager"]["name"] != now["manager"]["name"]:
        events.append({"type": "manager_change", "status": "verified event (from manager records)", "detail": f"{then['manager']['name']} -> {now['manager']['name']}",
                       "explanation": "Possible explanation only; this comparison does not show the change caused any metric move."})
    if then["identity"]["category"] != now["identity"]["category"]:
        events.append({"type": "category_change", "status": "verified event (from category mapping)", "detail": f"{then['identity']['category']} -> {now['identity']['category']}"})
    return {"rows": rows, "quantitative_changes": quant, "qualitative_events": events,
            "missing_evidence": ["Mandate changes, mergers and renamings are not tracked in the data; absence here is not evidence they did not happen."],
            "peer_universe": {"then": then["peer_universe"], "now": now["peer_universe"]}}


# --- outcomes -----------------------------------------------------------------------------------------------------------

_PERIODS = {"1m": 1, "3m": 3, "6m": 6, "12m": 12, "3y": 36, "5y": 60}


def _window_return(s: pd.Series, start: pd.Timestamp, end: pd.Timestamp) -> dict | None:
    """Return between the observations at-or-before start and end (month-end NAV series; actual dates are reported)."""
    a, b = s[s.index <= start], s[s.index <= end]
    if a.empty or b.empty or b.index[-1] <= a.index[-1]:
        return None
    ra = float(b.iloc[-1] / a.iloc[-1] - 1)
    yrs = (b.index[-1] - a.index[-1]).days / 365.25
    ann = ra if yrs <= 1 else (1 + ra) ** (1 / yrs) - 1
    return {"return_pct": round(ann * 100, 3), "basis": "absolute" if yrs <= 1 else "annualised", "start_obs": a.index[-1].date().isoformat(), "end_obs": b.index[-1].date().isoformat()}


def nav_series(code: str) -> pd.Series:
    from app.backoffice.screening.jobs import with_live_tail
    from app.data.loader import load_metrics, load_nav

    m = load_metrics()
    row = m[m["scheme_code"] == str(code)]
    s = load_nav(str(code))
    return with_live_tail(s, row.iloc[0]["last_nav_date"], pd.Timestamp.today().normalize()) if len(row) else s


def category_peers(df: pd.DataFrame, code: str) -> list[str]:
    from app.backoffice import fh_catscore

    r = df[df["code"] == code].iloc[0]
    ok, _ = fh_catscore.peer_eligibility(df)
    return df[(df["cat"] == r["cat"]) & (df["plan"] == r["plan"]) & ok]["code"].tolist()


def outcome(df: pd.DataFrame, code: str, start: str, end: str | None = None, removed_on: str | None = None,
            periods: list[str] | None = None, series=nav_series) -> dict:
    """Question B: performance after a genuine recommendation date. Retrospective: category = today's peers (survivors, current mapping)."""
    from app.backoffice.mf_screener import BENCHMARK_PROXY

    s0 = pd.Timestamp(start)
    s_end = pd.Timestamp(end) if end else series(code).index[-1]
    last_active = pd.Timestamp(removed_on) if removed_on else None
    r = df[df["code"] == code].iloc[0]
    bench_code = BENCHMARK_PROXY.get(r["cat"])
    peers = [c for c in category_peers(df, code)]

    def block(a: pd.Timestamp, b: pd.Timestamp) -> dict:
        f = _window_return(series(code), a, b)
        bm = _window_return(series(bench_code), a, b) if bench_code else None
        pr = [x for x in (_window_return(series(c), a, b) for c in peers if c != code) if x]
        # Category value is only comparable when every window uses the same actual observation dates as the fund.
        pr = [x["return_pct"] for x in pr if f and x["start_obs"] == f["start_obs"] and x["end_obs"] == f["end_obs"]]
        cat = round(float(np.mean(pr + ([f["return_pct"]] if f else []))), 3) if f and len(pr) >= 4 else None
        return {"fund": f, "benchmark": bm, "category_average_pct": cat, "category_peers_used": len(pr) + (1 if cat is not None else 0),
                "excess_vs_benchmark_pp": round(f["return_pct"] - bm["return_pct"], 3) if f and bm and f["start_obs"] == bm["start_obs"] and f["end_obs"] == bm["end_obs"] else None,
                "excess_vs_category_pp": round(f["return_pct"] - cat, 3) if f and cat is not None else None}

    out: dict[str, Any] = {"recommendation_start": s0.date().isoformat(), "evaluated_to": s_end.date().isoformat(), "periods": {}, "limitations": [
        BENCH_NOTE, "NAV is month-end, so windows snap to the observation at or before each date; actual dates are shown.",
        "Category average uses today's peer set and category mapping (survivorship bias; no point-in-time membership is stored). Retrospective, not reconstructed history.",
        "Drawdown and risk changes are not computed here; compare snapshots in Then vs Now instead."]}
    for label in (periods or list(_PERIODS)):
        end_p = s0 + pd.DateOffset(months=_PERIODS[label])
        if end_p > s_end:
            out["periods"][label] = {"available": False, "reason": f"Only {round((s_end - s0).days / 365.25, 2)}y have elapsed; {label} not yet reached."}
            continue
        d = {"available": True, "window_end": end_p.date().isoformat()}
        if last_active is not None and last_active < end_p:
            d["while_recommended"] = block(s0, last_active)
            d["after_removal"] = {**block(last_active, end_p), "note": "FH was no longer recommending the fund in this window."}
        else:
            d["while_recommended"] = block(s0, end_p)
        out["periods"][label] = d
    out["since_recommendation"] = {"while_recommended": block(s0, min(s_end, last_active) if last_active is not None else s_end)}
    if last_active is not None and last_active < s_end:
        out["since_recommendation"]["after_removal"] = block(last_active, s_end)
    return out


def reconstructed_returns(df: pd.DataFrame, code: str, as_of: str, series=nav_series) -> dict:
    """Question C. Only returns can be rebuilt from stored NAV; score and risk metrics cannot (no point-in-time inputs)."""
    a = pd.Timestamp(as_of)
    s = series(code)
    rows = {}
    for label, mths in (("1y", 12), ("3y", 36), ("5y", 60)):
        w = _window_return(s, a - pd.DateOffset(months=mths), a)
        rows[label] = w or {"available": False}
    return {"label": "Reconstructed analysis (retrospective, not an FH recommendation record)", "as_of": a.date().isoformat(), "trailing_returns": rows,
            "model_score": {"available": False, "reason": "Point-in-time category membership, capture ratios, manager history and the scoring inputs of that date are not stored, so no score is reconstructed."}}
