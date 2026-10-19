import gzip

from app.backoffice.mf_reference import _query, load_csv

CSV = (
    "record_type,amfi_scheme_code,scheme_name,amc_id,amc_name\n"
    "scheme_master,1,Alpha Fund,A1,\n"
    "AMC_Master,,,A1,Alpha AMC\n"
)


def test_load_and_query(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    f = tmp_path / "r.csv.gz"
    f.write_bytes(gzip.compress(CSV.encode()))
    assert load_csv(f) == {"scheme_master": 1, "amc_master": 1}
    cols, rows, total = _query("scheme_master", "alpha", {"amc_id": "A1"}, None, "asc", 10, 0)
    assert total == 1 and rows[0]["scheme_name"] == "Alpha Fund" and "amc_name" not in cols


def test_public_fund_reference_endpoint(client):
    """GET /api/funds/{code}/reference is public (no staff auth) and returns the full snapshot payload."""
    from app.backoffice import mf_reference

    mf_reference.ensure_loaded()  # bundled snapshot must be in the (fresh test) DB
    conn = mf_reference._conn()
    try:
        codes = [r[0] for r in conn.execute(
            f'SELECT amfi_scheme_code FROM "{mf_reference._tname("scheme_master")}" LIMIT 5')]
    finally:
        conn.close()
    assert codes, "bundled snapshot must contain schemes"
    for code in codes:
        r = client.get(f"/api/funds/{code}/reference")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scheme"]["amfi_scheme_code"] == code
        assert set(body) == {"scheme", "amc", "managers", "benchmarks", "category", "manager_changes", "provenance"}
    assert client.get("/api/funds/000000/reference").status_code == 404


def test_staff_scheme_endpoint_still_requires_auth(client):
    from app.backoffice.mf_reference import ensure_loaded

    ensure_loaded()
    assert client.get("/api/backoffice/mf-reference/summary").status_code == 401


def test_search_dedupes_per_period_rows(monkeypatch):
    from app.backoffice import search

    monkeypatch.setitem(search.PROVIDERS, "pms", ("PMS", lambda q, limit, viewer: [
        search._hit("pms", "pms", "174", "A", "x", "/h") for _ in range(3)]))
    assert len(search.run("ab", "pms", None)) == 1


def test_pms_manager_lookup_matches_firm_strategies(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api import backoffice as bo
    from app.api.auth import require_staff
    from app.main import create_app

    rows = [{"ia_id": "1", "provider": "PP", "strategy_name": "A"}, {"ia_id": "2", "provider": "PP", "strategy_name": "B"},
            {"ia_id": "3", "provider": "QQ", "strategy_name": "C"}]
    monkeypatch.setattr(bo._REPO, "list_pms_universe_strategies", lambda as_on=None: rows)
    monkeypatch.setattr(bo._REPO, "latest_pms_as_on", lambda: "x")
    mgr = {"1": "Mr. Amit  Jeswani", "2": "Someone Else"}
    monkeypatch.setattr(bo, "_pms_detail", lambda i: ({"fund_manager": mgr[i], "fund_manager_experience": "20 yrs"}, None))
    app = create_app()
    app.dependency_overrides[require_staff] = lambda: {"id": "t"}
    r = TestClient(app).get("/api/backoffice/pms/manager", params={"name": "amit jeswani", "provider": "PP"}).json()["data"]
    assert [s["ia_id"] for s in r["strategies"]] == ["1"] and r["experience"] == "20 yrs"


def test_lead_sr_no_ascending(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    from app import repo_crm_core as r

    repo = r.CrmRepository() if hasattr(r, "CrmRepository") else r.get_crm_repository()
    a = repo.create_lead(name="Aa Aa", email="a@x.com", mobile="9000000001")
    b = repo.create_lead(name="Bb Bb", email="b@x.com", mobile="9000000002")
    assert (a["sr_no"], b["sr_no"]) == (1, 2)
    assert [x["sr_no"] for x in repo.list_leads()] == [2, 1]


def test_lead_source_and_date_range_filters(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    from app import repo_crm_core as r

    repo = r.get_crm_repository()
    a = repo.create_lead(name="Aa Aa", mobile="9000000001", source="qr_code")
    repo.create_lead(name="Bb Bb", mobile="9000000002", source="website")
    today = r.today_ist()
    assert [x["id"] for x in repo.list_leads(sources=("qr_code",))] == [a["id"]]
    assert len(repo.list_leads(created_from=today, created_to=today)) == 2
    assert repo.list_leads(created_to="2000-01-01") == []
    assert r.ist_day_utc("2026-10-16") == "2026-10-15T18:30:00+00:00"


def test_lead_delete_keeps_snapshot_and_backup_rotates(tmp_path, monkeypatch):
    import json

    from sqlalchemy import select

    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app import backup, repo_crm_core as r
    from app.models.crm_core import AuditLogModel

    repo = r.get_crm_repository()
    lead = repo.create_lead(name="Keep Me", mobile="9000000009", source="website")
    assert repo.delete_lead(lead["id"], actor_id="admin")
    with r._session() as s:
        snap = s.scalars(select(AuditLogModel).where(AuditLogModel.entity_id == lead["id"], AuditLogModel.field == "_snapshot")).one()
        assert json.loads(snap.old)["lead"]["name"] == "Keep Me"
    first = backup.backup_sqlite()
    assert first and first.exists() and backup.backup_sqlite() is None  # one per day


def test_new_counts_since(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "t.db"))
    from app import repo_crm_core as r

    repo = r.get_crm_repository()
    repo.create_lead(name="Aa Aa", mobile="9000000001")
    assert repo.count_created_since({"leads": "2000-01-01T00:00:00Z", "cases": "2000-01-01T00:00:00Z", "nope": "x"}) == {"leads": 1, "cases": 0}
    assert repo.count_created_since({"leads": "2999-01-01T00:00:00Z"}) == {"leads": 0}
