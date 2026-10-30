import sqlite3
import warnings

import pytest

from app.backoffice import fh_history as h
from app.backoffice import fh_score, mf_screener

warnings.filterwarnings("ignore")
CODE = "102252"  # HSBC Flexi Cap, Regular: a long-history fund present in the shipped dataset


@pytest.fixture(scope="module")
def frame():
    return mf_screener._scored({}, None)


@pytest.fixture()
def cfg():
    return fh_score.load_config()


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    h._READY.clear()


def test_reason_required_and_episode_lifecycle(frame, cfg):
    with pytest.raises(ValueError):
        h.record_event(frame, cfg, CODE, "Added", "ana", reason="")
    a = h.record_event(frame, cfg, CODE, "Added", "ana", reason="Consistent top-half category returns")
    assert a["event_type"] == "Added"
    with pytest.raises(ValueError):
        h.record_event(frame, cfg, CODE, "Added", "ana", reason="again")
    h.record_event(frame, cfg, CODE, "Reviewed", "ana")
    h.record_event(frame, cfg, CODE, "Removed", "ana", reason="Manager change", effective_date="2026-09-30")
    with pytest.raises(ValueError):
        h.record_event(frame, cfg, CODE, "Reviewed", "ana")  # not listed any more
    b = h.record_event(frame, cfg, CODE, "Added", "ana", reason="Thesis restored after review")
    assert b["event_type"] == "Re-added" and b["episode_id"] != a["episode_id"]
    hist = h.history(CODE)
    assert len(hist["episodes"]) == 2 and hist["episodes"][1]["prev_episode_id"] == a["episode_id"]
    assert hist["episodes"][0]["ended_on"] == "2026-09-30"
    assert [e["event_type"] for e in hist["events"]] == ["Added", "Reviewed", "Removed", "Re-added"]


def test_snapshots_and_events_are_immutable_and_corrections_are_new_versions(frame, cfg):
    a = h.record_event(frame, cfg, CODE, "Added", "ana", reason="Stable fund management and process")
    conn = h._conn()
    with pytest.raises(sqlite3.DatabaseError), conn:
        conn.execute("UPDATE fh_snapshot SET label='x' WHERE id=?", (a["snapshot_id"],))
    with pytest.raises(sqlite3.DatabaseError), conn:
        conn.execute("DELETE FROM fh_reco_event")
    new = h.correct_snapshot(a["snapshot_id"], "bob", "Wrong manager recorded", {"manager": {"name": "X", "start": None, "tenure_years": None}})
    old, cor = h.snapshot(a["snapshot_id"]), h.snapshot(new)
    assert old["payload"]["manager"]["name"] != "X" and cor["payload"]["manager"]["name"] == "X"
    assert cor["version"] == 2 and cor["supersedes_id"] == a["snapshot_id"]


def test_migration_snapshot_invents_nothing_and_is_idempotent(frame, cfg):
    assert h.migrate_listed(frame, cfg, {CODE: "x"}) == [CODE]
    assert h.migrate_listed(frame, cfg, {CODE: "x"}) == []
    ep = h.history(CODE)["episodes"][0]
    assert ep["origin"] == "migration" and ep["started_on"] is None
    assert h.history(CODE)["snapshots"][0]["label"] == "migration"


def test_scheduled_snapshot_dedupes_and_as_of_never_reconstructs(frame, cfg):
    assert h.snapshot_as_of(CODE, "2026-10-30")["available"] is False
    h.record_event(frame, cfg, CODE, "Added", "ana", reason="Client demand / mandate fit")
    assert h.scheduled_snapshots(frame, cfg)["stored"] == 1
    assert h.scheduled_snapshots(frame, cfg)["stored"] == 0  # unchanged data stores nothing
    got = h.snapshot_as_of(CODE, "2099-01-01")
    assert got["available"] and got["age_days"] > 0
    assert h.snapshot_as_of(CODE, "2000-01-01")["available"] is False


def test_then_vs_now_has_no_quant_change_for_identical_and_flags_manager_event(frame, cfg):
    p = h.build_payload(frame, CODE, cfg)
    same = h.then_vs_now(p, p)
    assert same["quantitative_changes"] == [] and same["qualitative_events"] == []
    q = {**p, "manager": {**p["manager"], "name": "Someone Else"}, "model": {**p["model"], "score": (p["model"]["score"] or 0) + 5}}
    d = h.then_vs_now({**p, "manager": {**p["manager"], "name": "A"}}, q)
    assert d["qualitative_events"][0]["type"] == "manager_change" and "Possible explanation only" in d["qualitative_events"][0]["explanation"]
    assert any(r["dimension"] == "Model score" and r["change"] == 5 for r in d["quantitative_changes"])


def test_outcome_does_not_show_horizons_not_yet_reached(frame):
    o = h.outcome(frame, CODE, "2025-12-31", periods=["3m", "5y"])
    assert o["periods"]["5y"]["available"] is False and "not yet reached" in o["periods"]["5y"]["reason"]
    assert o["periods"]["3m"]["available"] is True
    assert o["periods"]["3m"]["while_recommended"]["fund"]["start_obs"] <= "2025-12-31"


def test_outcome_splits_active_and_after_removal(frame):
    o = h.outcome(frame, CODE, "2024-12-31", removed_on="2025-06-30", periods=["12m"])
    p = o["periods"]["12m"]
    assert "after_removal" in p and "no longer recommending" in p["after_removal"]["note"]
    assert p["while_recommended"]["fund"]["end_obs"] <= "2025-06-30"


def test_concurrent_adds_create_one_active_episode(frame, cfg):
    import threading
    res = []

    def go():
        try:
            res.append(h.record_event(frame, cfg, CODE, "Added", "x", reason="race test"))
        except ValueError as e:
            res.append(e)

    ts = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(isinstance(r, dict) for r in res) == 1
    assert len([e for e in h.history(CODE)["episodes"] if e["ended_on"] is None]) == 1


def test_scheduled_snapshot_for_readded_episode_is_not_skipped_by_old_episode(frame, cfg):
    h.record_event(frame, cfg, CODE, "Added", "x", reason="first add")
    h.scheduled_snapshots(frame, cfg)
    h.record_event(frame, cfg, CODE, "Removed", "x", reason="Manager change")
    h.record_event(frame, cfg, CODE, "Added", "x", reason="Thesis restored")
    h.scheduled_snapshots(frame, cfg)
    eps = {e["id"] for e in h.history(CODE)["episodes"]}
    assert {s["episode_id"] for s in h.history(CODE)["snapshots"] if s["kind"] == "scheduled"} == eps


def test_as_of_uses_ist_day_and_rejects_impossible_dates(frame, cfg):
    h.record_event(frame, cfg, CODE, "Added", "x", reason="ist check")
    today = h.today_ist().isoformat()
    assert h.snapshot_as_of(CODE, today)["available"] and h.snapshot_as_of(CODE, today)["age_days"] == 0
    with pytest.raises(ValueError):
        h.snapshot_as_of(CODE, "2026-13-45")
