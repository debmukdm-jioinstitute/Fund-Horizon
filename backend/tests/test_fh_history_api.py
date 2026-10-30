from __future__ import annotations

import pytest

from app.backoffice import fh_recommended
from tests.test_backoffice_compare import _create_staff, _login_staff

CODE = "102252"  # seeded FH list member


@pytest.fixture()
def isolated_list(tmp_path, monkeypatch):
    saved = dict(fh_recommended.FH_RECOMMENDED_MF_CODES)
    monkeypatch.setattr(fh_recommended, "OVERRIDES_FILE", tmp_path / "ov.json")
    yield
    fh_recommended.FH_RECOMMENDED_MF_CODES.clear()
    fh_recommended.FH_RECOMMENDED_MF_CODES.update(saved)


def test_recommended_update_requires_staff(client):
    client.cookies.clear()
    r = client.post("/api/backoffice/recommended", json={"kind": "mf", "id": CODE, "recommended": False, "reason": "x y z"})
    assert r.status_code in (401, 403)


def test_remove_needs_reason_keeps_history_and_readd_links_episode(client, isolated_list):
    _login_staff(client, _create_staff())
    url = "/api/backoffice/recommended"
    assert client.post(url, json={"kind": "mf", "id": CODE, "recommended": False}).status_code == 422
    assert CODE in fh_recommended.FH_RECOMMENDED_MF_CODES  # rejected change did not apply
    r = client.post(url, json={"kind": "mf", "id": CODE, "recommended": False, "reason": "Manager change", "effective_date": "2026-10-01"})
    assert r.status_code == 200 and r.json()["event"]["event_type"] == "Removed"
    assert CODE not in fh_recommended.FH_RECOMMENDED_MF_CODES
    r = client.post(url, json={"kind": "mf", "id": CODE, "recommended": True, "reason": "Thesis restored after review"})
    assert r.json()["event"]["event_type"] == "Re-added"
    hist = client.get(f"/api/backoffice/mutual-funds/{CODE}/fh-history").json()
    assert [e["event_type"] for e in hist["events"]] == ["Added", "Removed", "Re-added"]  # migration baseline, removal, re-add
    assert hist["episodes"][0]["origin"] == "migration" and hist["episodes"][0]["started_on"] is None
    assert hist["episodes"][1]["prev_episode_id"] == hist["episodes"][0]["id"]
    # outcome: migration baseline has no genuine date; the recorded episode is only days old, so no horizon is available
    o = client.get(f"/api/backoffice/mutual-funds/{CODE}/fh-outcome").json()
    assert all(not p["available"] for p in o["periods"].values())


def test_comparison_and_breakdown_modes(client):
    _login_staff(client, _create_staff())
    c = client.get(f"/api/backoffice/mutual-funds/{CODE}/fh-comparison").json()
    p3 = next(x for x in c["periods"] if x["period"] == "3y")
    assert {"fund", "benchmark", "category_average", "excess_vs_benchmark_pp", "excess_vs_category_pp"} <= set(p3)
    assert c["peer_universe"]["eligible"] >= 5 and "TRI" in c["benchmark_basis"]
    b = client.get(f"/api/backoffice/mutual-funds/{CODE}/fh-score-breakdown?mode=B").json()
    rows = next(f for f in b["filters"] if f["key"] == "ratios")["components"]
    assert b["scoring_mode"] == "B" and rows and all("text" in r and "max_points" in r for r in rows)
    assert client.get(f"/api/backoffice/mutual-funds/{CODE}/fh-score-breakdown?mode=Z").status_code == 422
