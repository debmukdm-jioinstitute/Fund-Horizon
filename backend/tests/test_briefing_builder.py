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
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
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
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
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
    assert len(movers["items"]) == 8  # top 4 + bottom 4 (advisor ≤8 cap)
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
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    amfi = next(f for f in payload["freshness"] if f["source"] == "AMFI India NAV")
    assert amfi["stale"] is False
    assert amfi["age_hours"] is not None and amfi["age_hours"] < 1
    assert amfi["last_ok"].endswith("+05:30")
    # A source is stale when its age exceeds 2× its refresh interval.
    assert amfi["interval_hours"] == 6.0
    assert amfi["stale_after_hours"] == 12.0
    # Sources that never succeeded count as stale.
    pending = [f for f in payload["freshness"] if f["last_ok"] is None]
    assert pending and all(f["stale"] for f in pending)


# Fixed clock matching generated_at="2026-10-14T18:00:00+05:30": news items must be built relative to the brief,
# not the wall clock, or they land in its future and are (correctly) dropped.
GEN_AT = datetime(2026, 10, 14, 12, 30, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Fix Round 2
# ---------------------------------------------------------------------------

def test_pan_masked_in_regulatory_text(repo):
    now = GEN_AT
    repo.upsert_news([
        {"id": "p1", "source_id": "sebi", "source_name": "SEBI",
         "category": "regulator",
         "title": "SEBI circular on mutual fund disclosure; PAN ABCDE1234F redacted",
         "link": "https://sebi.gov.in/1", "published_at": (now - timedelta(hours=1)).isoformat()},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    news = next(s for s in payload["sections"] if s["key"] == "regulatory_news")
    texts = [i["text"] for i in news["items"]]
    assert texts, "regulatory item should survive"
    assert "XXXXX1234X" in texts[0]
    assert "ABCDE1234F" not in " ".join(texts)
    assert bb.mask_pan("pan abcde1234f here") == "pan XXXXX1234X here"


def test_future_items_excluded(repo):
    repo.upsert_observations([
        {"instrument_id": "INDEX:IN:NIFTY50", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 25000.0},
        {"instrument_id": "INDEX:IN:NIFTY50", "observed_at": "2026-10-15T10:00:00+00:00", "value_numeric": 99999.0},
    ])
    now = GEN_AT
    repo.upsert_news([
        {"id": "f1", "source_id": "rbi_press", "source_name": "RBI Press Releases",
         "category": "regulator", "title": "News from tomorrow",
         "link": "https://rbi.org.in/f", "published_at": (now + timedelta(hours=5)).isoformat()},
    ])
    repo.upsert_flows([
        {"report_date": "2026-10-14", "category": "FII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": -100.0},
        {"report_date": "2026-10-15", "category": "FII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": -99999.0},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    blob = str(payload["sections"])
    assert "99999" not in blob  # no future observation value leaks in
    assert "-99999" not in blob  # no future flow value leaks in
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    nifty = next(i for i in pulse["items"] if i["text"].startswith("NIFTY 50"))
    assert nifty["value"] == "25,000.00"
    news = next(s for s in payload["sections"] if s["key"] == "regulatory_news")
    assert not any("tomorrow" in i["text"] for i in news["items"])


def test_rss_rfc2822_parsed_as_real_timezone():
    # RFC 2822 with a real offset converts to IST correctly.
    iso = bb.to_ist_iso("Wed, 14 Oct 2026 10:00:00 +0000")
    assert iso is not None and iso.startswith("2026-10-14T15:30") and iso.endswith("+05:30")
    iso = bb.to_ist_iso("Wed, 14 Oct 2026 10:00:00 +0530")
    assert iso is not None and iso.startswith("2026-10-14T10:00") and iso.endswith("+05:30")


def test_pms_implausible_returns_rejected_and_flagged(repo):
    repo.replace_pms_universe(
        "2026-09-30", [{"apmi_id": "p1", "name": "Prov A"}],
        [
            {"provider": "Prov A", "strategy_name": "Sane Strat", "strategy_type": "t1",
             "service_type": "s1", "as_on": "2026-09-30", "ia_id": "ia1",
             "aum_crore": 100.0, "return_1m": 2.5},
            {"provider": "Prov A", "strategy_name": "Ametra FactorShields", "strategy_type": "t1",
             "service_type": "s1", "as_on": "2026-09-30", "ia_id": "ia2",
             "aum_crore": 50.0, "return_1m": -101.08},
            {"provider": "Prov A", "strategy_name": "Too Good", "strategy_type": "t1",
             "service_type": "s1", "as_on": "2026-09-30", "ia_id": "ia3",
             "aum_crore": 50.0, "return_1m": 150.0},
        ],
    )
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pms = next(s for s in payload["sections"] if s["key"] == "pms")
    texts = [i["text"] for i in pms["items"]]
    assert not any("FactorShields" in t for t in texts)
    assert not any("Too Good" in t for t in texts)
    assert any("Sane Strat" in t for t in texts)
    # Flagged in data health.
    flags = payload["data_health"]
    assert len(flags) == 2
    assert {f["strategy"] for f in flags} == {"Ametra FactorShields", "Too Good"}
    assert all(f["kind"] == "rejected_pms_return" for f in flags)
    assert all("|1M return| > 100%" in f["reason"] for f in flags)
    # Rejected strategy named in the PMS note.
    assert "rejected" in (pms["note"] or "").lower()


def test_pms_benchmark_column_hidden_when_none_on_file(repo):
    repo.replace_pms_universe(
        "2026-09-30", [{"apmi_id": "p1", "name": "Prov A"}],
        [{"provider": "Prov A", "strategy_name": "Strat 1", "strategy_type": "t1",
          "service_type": "s1", "as_on": "2026-09-30", "ia_id": "ia1",
          "aum_crore": 100.0, "return_1m": 2.5}],
    )
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pms = next(s for s in payload["sections"] if s["key"] == "pms")
    assert pms["items"], "expected PMS items"
    assert all(i["benchmark"] is None for i in pms["items"])
    assert not any("not on file" in i["text"] for i in pms["items"])
    assert pms.get("benchmarks_hidden") is True


def test_regulatory_duplicate_collapse_by_title_and_entity(repo):
    now = GEN_AT
    repo.upsert_news([
        {"id": "d1", "source_id": "sebi", "source_name": "SEBI",
         "category": "regulator", "title": "SEBI issues circular on mutual fund TER disclosure",
         "link": "https://sebi.gov.in/a", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "d2", "source_id": "sebi", "source_name": "SEBI",
         "category": "regulator", "title": "SEBI issues circular on mutual fund TER disclosure!",
         "link": "https://sebi.gov.in/b", "published_at": (now - timedelta(hours=2)).isoformat()},
        {"id": "d3", "source_id": "rbi_press", "source_name": "RBI Press Releases",
         "category": "regulator", "title": "SEBI issues circular on mutual fund TER disclosure",
         "link": "https://rbi.org.in/c", "published_at": (now - timedelta(hours=3)).isoformat()},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    news = next(s for s in payload["sections"] if s["key"] == "regulatory_news")
    titles = [i["text"] for i in news["items"]]
    assert sum("TER disclosure" in t for t in titles) == 1


def test_regulatory_notice_filtering(repo):
    now = GEN_AT
    repo.upsert_news([
        {"id": "x1", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Attachment order against XYZ Ltd for recovery of dues",
         "link": "https://sebi.gov.in/x1", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "x2", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Demand notice issued to ABC Broking in adjudication proceedings",
         "link": "https://sebi.gov.in/x2", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "x3", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Recovery proceedings against a mutual fund distributor for mis-selling",
         "link": "https://sebi.gov.in/x3", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "x4", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Circular: framework for portfolio managers' fee disclosure",
         "link": "https://sebi.gov.in/x4", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "x5", "source_id": "rbi_press", "source_name": "RBI Press Releases", "category": "regulator",
         "title": "RBI keeps repo rate unchanged at 5.5%",
         "link": "https://rbi.org.in/x5", "published_at": (now - timedelta(hours=1)).isoformat()},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    news = next(s for s in payload["sections"] if s["key"] == "regulatory_news")
    titles = [i["text"] for i in news["items"]]
    assert not any("Attachment order" in t for t in titles)  # SEBI notice, not MF/PMS
    assert not any("Demand notice" in t for t in titles)  # adjudication appeal, not MF/PMS
    assert any("mutual fund distributor" in t for t in titles)  # notice about intermediaries: kept
    assert any("portfolio managers" in t for t in titles)  # circular: kept
    assert any("repo rate" in t for t in titles)  # RBI policy: kept
    assert len(news["items"]) <= 8


def test_regulatory_text_trimmed_at_sentence_boundary():
    long_title = ("SEBI has issued a new circular on disclosure norms for mutual funds. "
                  "The circular requires AMCs to publish scheme-level TER every month. "
                  "It also mandates portfolio disclosures twice a month for all schemes. "
                  "Industry participants must comply within ninety days of issuance.")
    trimmed = bb.trim_sentence(long_title, limit=160)
    assert len(trimmed) <= 161
    assert trimmed.endswith("…")
    # Never cut mid-sentence: the text ends at a full stop.
    assert trimmed[:-1].rstrip().endswith(".")
    assert "…" not in trimmed[:-1]
    # Short text passes through untouched.
    assert bb.trim_sentence("RBI keeps repo rate unchanged.") == "RBI keeps repo rate unchanged."


def test_single_india_10y_value_single_source(repo):
    repo.upsert_observations([
        {"instrument_id": "YIELD:IN:10Y", "observed_at": "2026-10-13T10:00:00+00:00", "value_numeric": 6.80},
        {"instrument_id": "YIELD:IN:10Y", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 6.95},
        {"instrument_id": "YIELD:IN:2Y", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 6.40},
        {"instrument_id": "YIELD:US:10Y", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 4.10},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    curve = next(i for i in pulse["items"] if i["text"].startswith("India 10Y"))
    spread = next(i for i in pulse["items"] if "India-US 10Y spread" in i["text"])
    # One 10Y value, same source and date on both rows; spread reuses it.
    assert "6.95%" in curve["text"] and "as of 2026-10-14" in curve["text"]
    assert "6.80%" not in curve["text"] and "6.80%" not in spread["text"]
    assert "as of 2026-10-14" in spread["text"]
    assert "India 6.95%" in spread["text"]  # same 10Y figure as the curve row
    assert "+285 bps" in spread["text"]
    assert curve["source"] == "India G-Sec Yields (FBIL / india_yields)"
    assert "AMFI" not in (curve["source"] or "")


def test_fii_dii_mtd_lines(repo):
    repo.upsert_flows([
        {"report_date": "2026-10-01", "category": "FII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": 100.0},
        {"report_date": "2026-10-01", "category": "DII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": 200.0},
        {"report_date": "2026-10-14", "category": "FII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": -1200.0},
        {"report_date": "2026-10-14", "category": "DII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": 1500.0},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    fii = next(i for i in pulse["items"] if "Institutional flows" in i["text"])
    assert "FII net -1,200 Cr" in fii["text"] and "DII net +1,500 Cr" in fii["text"]
    # MTD = Oct 1 + Oct 14 rows: FII -1100, DII +1700.
    assert "MTD: FII net -1,100 Cr" in fii["text"]
    assert "DII net +1,700 Cr" in fii["text"]


def test_advisor_sections_capped_at_eight(repo):
    _seed_market(repo)
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    for key in ("client_actions", "fund_movers", "cost_manager_changes", "regulatory_news", "market_pulse"):
        section = next(s for s in payload["sections"] if s["key"] == key)
        assert len(section["items"]) <= 8, key


def test_items_carry_as_of_and_source_link(repo):
    _seed_market(repo)
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    for section in payload["sections"]:
        if section["key"] == "data_freshness":
            continue
        for item in section["items"]:
            assert item["as_of"], (section["key"], item["text"][:40])
            assert item["source"], (section["key"], item["text"][:40])


def test_date_only_as_of_has_no_fake_midnight(repo):
    repo.upsert_flows([
        {"report_date": "2026-10-14", "category": "FII", "segment": "equity_cash",
         "gross_buy": 1.0, "gross_sell": 1.0, "net": -100.0},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    fii = next(i for i in pulse["items"] if "Institutional flows" in i["text"])
    assert fii["as_of"] == "2026-10-14"  # date-only, no fake 00:00 IST


def test_screening_source_dead_link_backfilled(repo):
    # The seeded SRC_SCREENING row used to point at a 404. Existing volumes
    # must be migrated to the live route by the idempotent seed path.
    from app.backoffice import db as backoffice_db

    conn = repo._conn()
    try:
        conn.execute(
            "UPDATE source_registry SET official_docs_url = 'https://fundhorizon.in/internal/screening' "
            "WHERE id = 'SRC_SCREENING'"
        )
        with conn:
            backoffice_db._seed_default_registries(conn)
        row = conn.execute(
            "SELECT official_docs_url FROM source_registry WHERE id = 'SRC_SCREENING'"
        ).fetchone()
        assert row["official_docs_url"] == "https://fundhorizon.in/backoffice/research?tab=screening"
        assert "internal/screening" not in row["official_docs_url"]
    finally:
        conn.close()


def test_no_dead_screening_links_anywhere():
    # Both backend occurrences of the dead link must be gone.
    from pathlib import Path

    app_dir = Path(__file__).resolve().parents[1] / "app"
    hits = [
        str(p) for p in app_dir.rglob("*.py")
        if "fundhorizon.in/internal/screening" in p.read_text()
    ]
    assert hits == []


def test_fx_stale_flagged_after_one_trading_day(repo):
    repo.upsert_observations([
        {"instrument_id": "FX:USDINR", "observed_at": "2026-10-09T10:00:00+00:00", "value_numeric": 88.00},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    fx = next(i for i in pulse["items"] if i["text"].startswith("USD/INR"))
    assert fx["stale"] is True  # 2026-10-09 (Fri) -> 2026-10-14 (Wed): 3 trading days
    repo.upsert_observations([
        {"instrument_id": "FX:USDINR", "observed_at": "2026-10-14T10:00:00+00:00", "value_numeric": 88.60},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    pulse = next(s for s in payload["sections"] if s["key"] == "market_pulse")
    fx = next(i for i in pulse["items"] if i["text"].startswith("USD/INR"))
    assert fx["stale"] is False


def test_unrelated_enforcement_and_pr_noise_filtered_from_briefing(repo):
    now = GEN_AT
    repo.upsert_news([
        {"id": "u1", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Release Order for RC No.3965 of 2021-Ram Kishore Taparia in the matter of Cosboard Industries Ltd",
         "link": "https://sebi.gov.in/u1", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "u2", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Confirmatory order in the matter of Rajesh Exports Limited",
         "link": "https://sebi.gov.in/u2", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "u3", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Completion of RC No. 8924 of 2025 issued against Yuvika Tradewing LLP in the matter of Cressanda",
         "link": "https://sebi.gov.in/u3", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "u4", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Order in the matter of Capital Stroke Investment Services Pvt. Ltd.",
         "link": "https://sebi.gov.in/u4", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "u5", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "Prohibitory Order no. 1575/2026 issued against Venkatachari Suresh in the matter of Securekloud",
         "link": "https://sebi.gov.in/u5", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "u6", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "SEBI Teams win at IOSCO TechSprint 2026 on Investor Education",
         "link": "https://sebi.gov.in/u6", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "u7", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "SEBI PolicyTwin Prototype Wins First Place at the Hackathon",
         "link": "https://sebi.gov.in/u7", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "k1", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "SEBI Master Circular for Mutual Funds on risk-o-meter disclosures",
         "link": "https://sebi.gov.in/k1", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "k2", "source_id": "sebi", "source_name": "SEBI", "category": "regulator",
         "title": "SEBI consultation paper on easing norms for Portfolio Managers",
         "link": "https://sebi.gov.in/k2", "published_at": (now - timedelta(hours=1)).isoformat()},
        {"id": "k3", "source_id": "rbi_press", "source_name": "RBI Press Releases", "category": "regulator",
         "title": "RBI Monetary Policy Committee keeps repo rate at 6.50%",
         "link": "https://rbi.org.in/k3", "published_at": (now - timedelta(hours=1)).isoformat()},
    ])
    payload = bb.build_briefing_payload(repo, "2026-10-14", generated_at="2026-10-14T18:00:00+05:30")
    news = next(s for s in payload["sections"] if s["key"] == "regulatory_news")
    titles = [i["text"] for i in news["items"]]
    assert not any("Release Order" in t for t in titles)
    assert not any("Confirmatory order" in t for t in titles)
    assert not any("Completion of RC" in t for t in titles)
    assert not any("Capital Stroke" in t for t in titles)
    assert not any("Prohibitory Order" in t for t in titles)
    assert not any("TechSprint" in t for t in titles)
    assert not any("Hackathon" in t for t in titles)
    assert any("Master Circular for Mutual Funds" in t for t in titles)
    assert any("Portfolio Managers" in t for t in titles)
    assert any("repo rate" in t for t in titles)
