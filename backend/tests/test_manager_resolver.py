import pandas as pd

from app.backoffice import manager_resolver as mr

UNI = pd.DataFrame({
    "code": ["1", "2", "3", "4", "5"],
    "amc": ["A", "A", "A", "B", "B"],
    "name": ["Alpha Fund - Regular Plan - Growth", "Alpha Fund - Direct Plan - Growth", "Beta Fund - Regular Plan - Growth",
             "Gamma Fund - Regular Plan - Growth", "Delta Fund - Regular Plan - Growth"],
})


def _no_sources(monkeypatch, seed=None, cached=None, amfi=None):
    monkeypatch.setattr(mr, "_seed", lambda: seed or {})
    monkeypatch.setattr(mr, "_cached", lambda: cached or {})
    monkeypatch.setattr(mr, "_amfi", lambda: amfi or {})


def _row(name, source="x", start=None):
    return {"manager_name": name, "manager_start": start, "source": source, "provenance": ""}


def test_iso_parses_amfi_wordings():
    assert mr._iso("Managing Since March 26, 2014") == "2014-03-26"
    assert mr._iso("26/03/2014") == "2014-03-26"
    assert mr._iso("2014-03-26T00:00:00.000") == "2014-03-26"
    assert mr._iso("not a date") is None and mr._iso("") is None


def test_priority_stored_over_seed_over_cache_over_amfi(monkeypatch):
    _no_sources(monkeypatch, seed={"3": _row("Seed")}, cached={"3": _row("Cache"), "4": _row("Cache4")}, amfi={"3": _row("Amfi"), "4": _row("Amfi4"), "5": _row("Amfi5")})
    out = mr.resolve(UNI, {"5": _row("Manual")})
    assert out["3"]["manager_name"] == "Seed" and out["4"]["manager_name"] == "Cache4" and out["5"]["manager_name"] == "Manual"


def test_plan_sibling_inherits_manager_and_start(monkeypatch):
    _no_sources(monkeypatch, amfi={"1": _row("Jane", "amfi_snapshot", "2020-01-01")})
    out = mr.resolve(UNI, {})
    assert out["2"]["manager_name"] == "Jane" and out["2"]["manager_start"] == "2020-01-01" and out["2"]["source"] == "sibling:1"
    assert "3" not in out and "4" not in out  # different funds are never guessed


def test_cache_csv_dir_is_read(monkeypatch, tmp_path):
    (tmp_path / "moneycontrol.csv").write_text("scheme_code,manager_name,manager_start,source,url,fetched_at\n4,Ravi,2019-05-01,moneycontrol,http://x,2026-10-28\n")
    monkeypatch.setattr(mr, "CACHE_DIR", tmp_path)
    got = mr._cached()["4"]
    assert got["manager_name"] == "Ravi" and got["source"] == "moneycontrol" and "2026-10-28" in got["provenance"]


class FakeRepo:
    def __init__(self, stored):
        self.stored, self.upserts, self.updates = stored, [], []

    def list_mf_managers(self):
        return self.stored

    def upsert_mf_managers(self, rows):
        self.upserts = rows
        return len(rows)

    def update_mf_manager_start(self, rows):
        self.updates.extend(rows)
        return len(rows)


def test_sync_never_overwrites_existing_rows(monkeypatch):
    from app.backoffice import mf_screener

    _no_sources(monkeypatch, seed={"1": _row("Seed"), "3": _row("Seed3")})
    monkeypatch.setattr(mf_screener, "_base_frame", lambda: UNI)
    repo = FakeRepo({"1": _row("Staff edit", "manual_import")})
    assert mr.sync_managers(repo) == 2  # code 3 from seed, code 2 as sibling of 1
    assert {r["scheme_code"] for r in repo.upserts} == {"2", "3"}
    assert next(r for r in repo.upserts if r["scheme_code"] == "2")["manager_name"] == "Staff edit"


def test_sync_fills_missing_start_on_same_name(monkeypatch):
    from app.backoffice import mf_screener

    _no_sources(monkeypatch, cached={"1": _row("Ravi Kumar", "amc_site:sbi", "2021-04-01")})
    monkeypatch.setattr(mf_screener, "_base_frame", lambda: UNI)
    repo = FakeRepo({"1": _row("Mr. Ravi Kumar", "amfi_snapshot", None)})
    mr.sync_managers(repo)
    assert len(repo.updates) == 1
    assert repo.updates[0]["scheme_code"] == "1"
    assert repo.updates[0]["manager_start"] == "2021-04-01"
    assert repo.updates[0]["source"] == "amc_site:sbi"
    assert repo.stored["1"]["manager_start"] == "2021-04-01"


def test_sync_does_not_change_when_names_differ(monkeypatch):
    from app.backoffice import mf_screener

    _no_sources(monkeypatch, cached={"1": _row("Sanjay Doshi", "amc_site:sbi", "2021-04-01")})
    monkeypatch.setattr(mf_screener, "_base_frame", lambda: UNI)
    repo = FakeRepo({"1": _row("Ravi Kumar", "amfi_snapshot", None)})
    mr.sync_managers(repo)
    assert len(repo.updates) == 0
    assert repo.stored["1"]["manager_start"] is None


def test_sync_never_touches_manual_import(monkeypatch):
    from app.backoffice import mf_screener

    _no_sources(monkeypatch, cached={"1": _row("Ravi Kumar", "amc_site:sbi", "2021-04-01")})
    monkeypatch.setattr(mf_screener, "_base_frame", lambda: UNI)
    repo = FakeRepo({"1": _row("Ravi Kumar", "manual_import", None)})
    mr.sync_managers(repo)
    assert len(repo.updates) == 0
    assert repo.stored["1"]["manager_start"] is None


def test_sync_does_not_overwrite_existing_start(monkeypatch):
    from app.backoffice import mf_screener

    _no_sources(monkeypatch, cached={"1": _row("Ravi Kumar", "amc_site:sbi", "2021-04-01")})
    monkeypatch.setattr(mf_screener, "_base_frame", lambda: UNI)
    repo = FakeRepo({"1": _row("Ravi Kumar", "amfi_snapshot", "2018-01-01")})
    mr.sync_managers(repo)
    assert len(repo.updates) == 0
    assert repo.stored["1"]["manager_start"] == "2018-01-01"
