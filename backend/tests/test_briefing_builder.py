"""Tests for the daily stored briefing (no network: everything reads a throwaway sqlite DB)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.backoffice.analytics import briefing_builder as bb
from app.backoffice.repository import BackofficeRepository

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture()
def repo(tmp_path, monkeypatch):
    monkeypatch.setenv("FH_DB_PATH", str(tmp_path / "briefing-test.db"))
    return BackofficeRepository()


def _seed_market(repo: BackofficeRepository) -> None:
    repo.upsert_observations(
        [
            {"instrument_id": "INDEX:IN:NIFTY50", "observed_at": "2026-10-13T10:00:00+00:00", "value_numeric": 25000.0},
            {"instrument_id": "INDEX:IN:NIFTY50", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 25400.0},
            {"instrument_id": "YIELD:IN:10Y", "observed_at": "2026-10-13T10:00:00+00:00", "value_numeric": 6.80},
            {"instrument_id": "YIELD:IN:10Y", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 6.95},
            {"instrument_id": "YIELD:IN:2Y", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 6.40},
            {"instrument_id": "YIELD:US:10Y", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 4.10},
            {"instrument_id": "FX:USDINR", "observed_at": "2026-10-13T10:00:00+00:00", "value_numeric": 88.00},
            {"instrument_id": "FX:USDINR", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 88.60},
            {"instrument_id": "VOL:IN:INDIAVIX", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 22.5},
        ]
    )
    repo.upsert_flows(
        [
            {"report_date": "2026-10-13", "category": "FII", "segment": "equity_cash",
             "gross_buy": 1.0, "gross_sell": 1.0, "net": -500.0},
            {"report_date": "2026-10-13", "category": "DII", "segment": "equity_cash",
             "gross_buy": 1.0, "gross_sell": 1.0, "net": 900.0},
            {"report_date": "2026-10-14", "category": "FII", "segment": "equity_cash",
             "gross_buy": 1.0, "gross_sell": 1.0, "net": -1200.0},
            {"report_date": "2026-10-14", "category": "DII", "segment": "equity_cash",
             "gross_buy": 1.0, "gross_sell": 1.0, "net": 1500.0},
        ]
    )


# ---------------------------------------------------------------------------
# Change / direction helpers
# ---------------------------------------------------------------------------

def test_calc_change_basic():
    change, pct, direction = bb.calc_change(110.0, 100.0)
    assert change == pytest.approx(10.0)
    assert pct == pytest.approx(10.0)
    assert direction == "up"


def test_calc_change_down_and_flat():
    assert bb.calc_change(90.0, 100.0)[2] == "down"
    assert bb.calc_change(100.0, 100.0) == (0.0, 0.0, "flat")


def test_calc_change_none_propagates_never_nan():
    # Missing data must not become 0 or NaN.
    for new, old in ((None, 100.0), (100.0, None), (None, None), (100.0, 0.0)):
        change, pct, direction = bb.calc_change(new, old)
        assert change is None and pct is None and direction == "flat"


# ---------------------------------------------------------------------------
# so_what rules
# ---------------------------------------------------------------------------

def test_so_what_rules_fire():
    metrics = {
        "in10y_move_bps": 12.0, "in2y_move_bps": 3.0, "slope_bps": 40.0,
        "vix": 22.5, "nifty_chg": -2.0, "usdinr_chg": 0.7,
        "fii_net": -1200.0, "dii_net": 1500.0, "spread_bps": 285.0,
    }
    assert "short-duration" in bb.apply_so_what("in10y_move_bps", metrics)
    assert "STP" in bb.apply_so_what("vix", metrics)
    assert "panic redemptions" in bb.apply_so_what("nifty_chg", metrics)
    assert "Rupee weaker" in bb.apply_so_what("usdinr_chg", metrics)
    assert "domestic flows" in bb.apply_so_what("fii_dii", metrics)
    assert "carry supportive" in bb.apply_so_what("spread_bps", metrics)


def test_so_what_rules_quiet_when_calm():
    metrics = {
        "in10y_move_bps": 2.0, "in2y_move_bps": 1.0, "slope_bps": 40.0,
        "vix": 13.0, "nifty_chg": 0.2, "usdinr_chg": 0.1,
        "fii_net": 100.0, "dii_net": 200.0, "spread_bps": 200.0,
    }
    assert bb.apply_so_what("vix", metrics) is None
    assert bb.apply_so_what("nifty_chg", metrics) is None
    # FII buying still fires a (descriptive) rule.
    assert bb.apply_so_what("fii_dii", metrics) is not None


def test_so_what_copy_is_compliant():
    from app.config import disclosures as d

    banned = d.BANNED_WORDS
    for rule in bb.SO_WHAT_RULES:
        lowered = rule["text"].lower()
        for word in banned:
            assert word not in lowered, (word, rule["text"])
    assert 10 <= len(bb.SO_WHAT_RULES) <= 14


# ---------------------------------------------------------------------------
# IST date handling
# ---------------------------------------------------------------------------

def test_ist_today_uses_kolkata():
    assert bb.ist_today() == datetime.now(IST).date().isoformat()


def test_to_ist_iso_converts_utc():
    iso = bb.to_ist_iso("2026-10-14T02:30:00+00:00")
    assert iso is not None
    assert iso.endswith("+05:30")
    # 02:30 UTC is 08:00 IST the same calendar day.
    assert iso.startswith("2026-10-14T08:00")


def test_brief_date_is_kolkata_calendar_day():
    # 00:30 IST is still the same IST date (not UTC's previous day).
    assert bb.ist_date_of("2026-10-13T19:00:00+00:00") == "2026-10-14"


# ---------------------------------------------------------------------------
# Full payload build + contract shape
# ---------------------------------------------------------------------------

def test_payload_contract_shape(repo):
    _seed_market(repo)
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    assert payload["brief_date"] == "2026-10-14"
    assert payload["version"] == 1
    assert payload["generated_at"].endswith("+05:30")
    keys = [s["key"] for s in payload["sections"]]
    assert keys == [k for k, _ in bb.SECTION_ORDER]
    for section in payload["sections"]:
        assert isinstance(section["items"], list)
        assert "note" in section
        for item in section["items"]:
            for field in ("text", "value", "change", "change_pct", "direction",
                          "so_what", "as_of", "source", "source_url"):
                assert field in item, field
            assert item["direction"] in ("up", "down", "flat")
    for f in payload["freshness"]:
        assert {"source", "last_ok", "age_hours", "stale"} <= set(f)


def test_market_pulse_items_have_provenance_and_rules(repo):
    _seed_market(repo)
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    assert len(pulse["items"]) <= 8
    nifty = next(i for i in pulse["items"] if i["text"].startswith("NIFTY 50"))
    assert nifty["change_pct"] == pytest.approx(1.6)
    assert nifty["direction"] == "up"
    assert nifty["as_of"].endswith("+05:30")
    assert nifty["source"]  # provenance present
    vix = next(i for i in pulse["items"] if i["text"].startswith("India VIX"))
    assert vix["so_what"] and "STP" in vix["so_what"]
    fii = next(i for i in pulse["items"] if "Institutional flows" in i["text"])
    assert "FII net -1,200 Cr" in fii["text"] and "DII net +1,500 Cr" in fii["text"]
    assert fii["so_what"] and "domestic flows" in fii["so_what"]
    # Same-date spread: 6.95 - 4.10 = 285 bps.
    spread = next(i for i in pulse["items"] if "India-US 10Y spread" in i["text"])
    assert "+285 bps" in spread["text"]


def test_empty_database_degrades_without_500(repo):
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    assert payload["brief_date"] == "2026-10-14"
    assert len(payload["sections"]) == 8
    for section in payload["sections"]:
        assert isinstance(section["items"], list)  # empty is fine, never an error


# ---------------------------------------------------------------------------
# Fund movers vs previous briefing (idempotency anchor)
# ---------------------------------------------------------------------------

def _seed_schemes(repo: BackofficeRepository, navs: dict[str, float], nav_date: str = "2026-10-14") -> None:
    codes = list(bb.FH_RECOMMENDED_MF_CODES)[:12]
    assert codes, "marked-pick list must be non-empty for the movers test"
    schemes = []
    for i, code in enumerate(codes):
        schemes.append({
            "scheme_code": code,
            "scheme_name": f"Test Fund {i} - Regular Plan - Growth",
            "amc": "Test AMC",
            "category": "Open Ended Schemes ( Equity Scheme )",
            "plan": "Regular",
            "option": "Growth",
            "isin": f"INF000{i:04d}010",
            "latest_nav": navs.get(code, 100.0 + i),
            "nav_date": nav_date,
        })
    repo.replace_mf_schemes(schemes)


def test_fund_movers_change_vs_previous_briefing(repo):
    _seed_market(repo)
    codes = list(bb.FH_RECOMMENDED_MF_CODES)[:12]
    navs_day1 = {c: 100.0 for c in codes}
    _seed_schemes(repo, navs_day1, nav_date="2026-10-13")
    bb.build_daily_briefing(repo, "2026-10-13")

    navs_day2 = {c: (105.0 if i < 6 else 95.0) for i, c in enumerate(codes)}
    _seed_schemes(repo, navs_day2, nav_date="2026-10-14")
    bb.build_daily_briefing(repo, "2026-10-14")

    payload = repo.get_briefing_by_date("2026-10-14")["payload"]
    movers = next(s for s in payload["sections"] if s["key"] == "fund_movers")
    assert len(movers["items"]) == 10
    top = movers["items"][0]
    assert top["change_pct"] == pytest.approx(5.0)
    assert top["direction"] == "up"
    assert "vs" in top["text"] and "median" in top["text"]  # category-median gap
    assert "Marked pick" in (movers["note"] or "")


def test_upsert_idempotent_identical_payload(repo):
    _seed_market(repo)
    _seed_schemes(repo, {})
    first = bb.build_daily_briefing(repo, "2026-10-14")
    second = bb.build_daily_briefing(repo, "2026-10-14")
    assert first == second == {"ok": True, "brief_date": "2026-10-14"}
    assert repo.list_briefing_dates() == ["2026-10-14"]
    # Rebuilding the same date must not consume the row as "previous": payload identical.
    a = repo.get_briefing_by_date("2026-10-14")["payload"]
    bb.build_daily_briefing(repo, "2026-10-14")
    b = repo.get_briefing_by_date("2026-10-14")["payload"]
    a.pop("generated_at")
    b.pop("generated_at")
    assert a == b


def test_briefing_dates_newest_first(repo):
    _seed_market(repo)
    for d in ("2026-10-12", "2026-10-13", "2026-10-14"):
        bb.build_daily_briefing(repo, d)
    assert repo.list_briefing_dates() == ["2026-10-14", "2026-10-13", "2026-10-12"]


# ---------------------------------------------------------------------------
# Cost / manager / news / PMS / client sections
# ---------------------------------------------------------------------------

def test_ter_change_threshold(repo):
    _seed_market(repo)
    repo.replace_mf_ter([
        {"base_key": "k1", "scheme_name": "Fund A Regular Growth",
         "regular_ter_pct": 2.00, "direct_ter_pct": 1.00, "as_of": "2026-09-30"},
    ])
    bb.build_daily_briefing(repo, "2026-10-13")
    repo.replace_mf_ter([
        {"base_key": "k1", "scheme_name": "Fund A Regular Growth",
         "regular_ter_pct": 2.07, "direct_ter_pct": 1.00, "as_of": "2026-10-31"},
    ])
    bb.build_daily_briefing(repo, "2026-10-14")
    payload = repo.get_briefing_by_date("2026-10-14")["payload"]
    cost = next(s for s in payload["sections"] if s["key"] == "cost_manager_changes")
    ter_items = [i for i in cost["items"] if "TER" in i["text"]]
    assert len(ter_items) == 1
    assert "+7 bps" in ter_items[0]["text"]


def test_manager_data_not_loaded_note(repo):
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    cost = next(s for s in payload["sections"] if s["key"] == "cost_manager_changes")
    assert cost["note"] == "Manager data not loaded."


def test_news_section_links_and_dedupes(repo):
    now = datetime.now(UTC)
    repo.upsert_news([
        {"id": "n1", "source_id": "rbi_press", "source_name": "RBI Press Releases",
         "category": "regulator", "title": "RBI keeps repo rate unchanged",
         "link": "https://rbi.org.in/1", "published_at": (now - timedelta(hours=2)).isoformat()},
        {"id": "n2", "source_id": "et_markets", "source_name": "Economic Times Markets",
         "category": "markets", "title": "Nifty hits record high!",
         "link": "https://et.com/1", "published_at": (now - timedelta(hours=3)).isoformat()},
        {"id": "n3", "source_id": "mint_markets", "source_name": "Mint Markets",
         "category": "markets", "title": "Nifty hits record high",
         "link": "https://mint.com/1", "published_at": (now - timedelta(hours=4)).isoformat()},
        {"id": "n4", "source_id": "et_markets", "source_name": "Economic Times Markets",
         "category": "markets", "title": "Old headline from last week",
         "link": "https://et.com/old", "published_at": (now - timedelta(days=9)).isoformat()},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    news = next(s for s in payload["sections"] if s["key"] == "regulatory_news")
    titles = [i["text"] for i in news["items"]]
    assert "RBI keeps repo rate unchanged" in titles
    assert sum("record high" in t for t in titles) == 1  # deduped
    assert not any("last week" in t for t in titles)  # outside 24h
    rbi = next(i for i in news["items"] if i["text"].startswith("RBI"))
    assert rbi["link"] == "https://rbi.org.in/1"


def test_pms_no_new_month_note(repo):
    repo.replace_pms_universe(
        "2026-09-30", [{"apmi_id": "p1", "name": "Prov A"}],
        [{"provider": "Prov A", "strategy_name": "Strat 1", "strategy_type": "t1",
          "service_type": "s1", "as_on": "2026-09-30", "ia_id": "ia1",
          "aum_crore": 100.0, "return_1m": 2.5}],
    )
    bb.build_daily_briefing(repo, "2026-10-13")
    bb.build_daily_briefing(repo, "2026-10-14")
    payload = repo.get_briefing_by_date("2026-10-14")["payload"]
    pms = next(s for s in payload["sections"] if s["key"] == "pms")
    assert pms["items"] == []
    assert "no new month" in (pms["note"] or "").lower()


def test_client_book_not_linked_when_empty(repo):
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    client = next(s for s in payload["sections"] if s["key"] == "client_actions")
    assert client["items"] == []
    assert client["note"] == "Client book not linked."


def test_freshness_flags_stale_sources(repo):
    repo.update_source_health("SRC_AMFI", "ready", success=True)
    payload = bb.build_briefing_payload(repo, "2026-10-14")
    amfi = next(f for f in payload["freshness"] if f["source"] == "AMFI India NAV")
    assert amfi["stale"] is False
    assert amfi["age_hours"] is not None and amfi["age_hours"] < 1
    assert amfi["last_ok"].endswith("+05:30")
    # Sources that never succeeded count as stale.
    pending = [f for f in payload["freshness"] if f["last_ok"] is None]
    assert pending and all(f["stale"] for f in pending)
