"""Validation, reconciliation, performance and consolidation against hand-computed reference figures."""
import copy
from decimal import Decimal

import pytest
from scipy.optimize import brentq

from app.backoffice.valuation import consolidation, performance, reconciliation, validation
from app.backoffice.valuation.providers import ADAPTERS
from tests import valuation_fixtures as fx


def _codes(checks, status="failed", sev=None):
    return {c.code for c in checks if c.status == status and (sev is None or c.severity == sev)}


def _pa():
    return ADAPTERS["proaffluence"].extract("pa.pdf", fx.proaffluence_pdf())


# ---------------- validation
def test_clean_statements_validate_and_cash_basis_is_detected():
    checks, basis, closing = validation.validate_statement(_pa())
    assert basis == "holdings_plus_cash" and closing == Decimal("445000.00")          # cash added only because the total proves it
    assert not _codes(checks, sev="error")
    _, basis, closing = validation.validate_statement(ADAPTERS["fundsindia"].extract("fi.xlsx", fx.fundsindia_xlsx()))
    assert basis == "holdings_only" and closing == Decimal("561092.10")


def test_cash_already_inside_total_is_not_double_counted():
    st = _pa()
    st.totals["total_value"] = 420_000.00                    # provider total equals holdings: cash already included
    _, basis, closing = validation.validate_statement(st)
    assert basis == "holdings_only" and closing == Decimal("420000.00")


def test_total_mismatch_is_a_blocking_error_with_difference():
    st = _pa()
    st.totals["total_value"] = 450_000.00
    checks, basis, _ = validation.validate_statement(st)
    c = next(c for c in checks if c.code == "total_value" and c.status == "failed")
    assert basis == "mismatch" and c.severity == "error" and c.difference == -5000.00 and c.expected == 450000.0


def test_cash_without_total_is_blocking_and_tolerance_is_configurable(monkeypatch):
    st = _pa()
    st.totals.pop("total_value")
    assert "cash_treatment_unverified" in _codes(validation.validate_statement(st)[0], sev="error")
    st = _pa()
    st.totals["total_value"] = 445_000.80                     # 80 paise: inside the default Rs 1 tolerance
    assert not _codes(validation.validate_statement(st)[0], sev="error")
    monkeypatch.setattr(validation.cfg, "ABS_TOL", 0.1)
    monkeypatch.setattr(validation.cfg, "REL_TOL", 0.0)
    assert "total_value" in _codes(validation.validate_statement(st)[0], sev="error")


def test_missing_fields_duplicate_rows_and_qty_price_inconsistency():
    st = _pa()
    st.holdings.append(copy.copy(st.holdings[0]))             # exact duplicate row
    st.holdings[1].price = 9999.0                             # qty x price != market value
    st.holdings[1].market_value = None
    checks, _, _ = validation.validate_statement(st)
    assert {"duplicate_row", "missing_required_field"} <= _codes(checks, sev="error")
    st = _pa()
    st.holdings[0].price = 2700.0
    assert "qty_price_mismatch" in _codes(validation.validate_statement(st)[0], sev="error")


def test_missing_statement_date_and_unreadable_file_block():
    st = _pa()
    st.statement_date = None
    assert "missing_statement_date" in _codes(validation.validate_statement(st)[0], sev="error")
    scanned = ADAPTERS["stallion"].extract("s.pdf", fx.image_only_pdf())
    assert "file_unreadable" in _codes(validation.validate_statement(scanned)[0], sev="error")


def test_printed_total_vs_extracted_rows():
    st = ADAPTERS["fundsindia"].extract("fi.xlsx", fx.fundsindia_xlsx())
    st.totals["table_total_value"] = 570_092.10   # 9,000 off: beyond Rs 1 and 0.05%
    assert "table_total" in _codes(validation.validate_statement(st)[0], sev="error")


# ---------------- reconciliation
def test_duplicate_statement_identity_ignores_filenames():
    f = lambda fid, name: {"file_id": fid, "filename": name, "provider": "stallion", "account_no": "ST-1", "statement_date": "2026-10-29"}
    assert "duplicate_statement" in _codes(reconciliation.check_duplicate_statements([f("1", "a.xlsx"), f("2", "b.xlsx")], []))
    same_name_other_account = [f("1", "s.xlsx"), {**f("2", "s.xlsx"), "account_no": "ST-2"}]
    assert not _codes(reconciliation.check_duplicate_statements(same_name_other_account, []))
    assert "duplicate_statement" in _codes(reconciliation.check_duplicate_statements(
        [f("1", "a.xlsx")], [{"provider": "stallion", "account_no": "ST-1", "statement_date": "2026-10-29"}]))


def test_provider_mapping_and_dates():
    assert reconciliation.check_provider_mapping("f", "a.xlsx", "stallion", "manual", "proaffluence").status == "failed"
    assert reconciliation.check_provider_mapping("f", "a.xlsx", "stallion", "manual", None).status == "passed"
    accts = [{"provider": "a", "account_no": "1", "valuation_date": "2026-10-31"}, {"provider": "b", "account_no": "2", "valuation_date": "2026-10-20"},
             {"provider": "c", "account_no": "3", "valuation_date": "2026-09-30"}]
    codes = _codes(reconciliation.check_dates("2026-10", "2026-10-31", accts))
    assert {"valuation_date_gap", "valuation_dates_differ", "statement_period"} <= codes


def test_internal_transfers_are_paired_and_unpaired_ones_block():
    fl = [{"id": "1", "kind": "transfer_out", "amount": 5000.0, "flow_date": "2026-10-10"},
          {"id": "2", "kind": "transfer_in", "amount": 5000.0, "flow_date": "2026-10-11"},
          {"id": "3", "kind": "transfer_in", "amount": 777.0, "flow_date": "2026-10-12"}]
    paired, checks = reconciliation.pair_transfers(fl)
    assert paired == {"1", "2"} and _codes(checks, sev="error") == {"unpaired_transfer"}


def test_month_on_month_check():
    prev = {"report_month": "2026-09", "total_value": 1_000_000.0, "accounts": [{"provider": "stallion", "account_no": "X", "closing_value": 1000.0}]}
    cs = reconciliation.check_month_on_month(Decimal("1500000"), Decimal("100000"), prev, [])
    assert _codes(cs) == {"mom_unexplained", "account_missing"}
    ok = reconciliation.check_month_on_month(Decimal("1120000"), Decimal("100000"), prev, [{"provider": "stallion", "account_no": "X"}])
    assert not _codes(ok)                                                               # 2% market move: within threshold


# ---------------- performance (independent reference solutions)
def test_xirr_single_flow_closed_form():
    acc = [{"key": "a", "closing_value": 110_000.0, "valuation_date": "2026-10-31", "flows_complete": True}]
    fl = [{"account_key": "a", "kind": "deposit", "amount": 100_000.0, "flow_date": "2025-10-31", "external": 1}]
    r = performance.xirr(acc, fl)
    assert r["value"] == pytest.approx(((1.1) ** (365.25 / 365) - 1) * 100, abs=1e-3)


def test_consolidated_xirr_uses_combined_flows_not_an_average():
    accs = [{"key": "a", "closing_value": 130_000.0, "valuation_date": "2026-01-01", "flows_complete": True},
            {"key": "b", "closing_value": 52_000.0, "valuation_date": "2026-01-01", "flows_complete": True}]
    fl = [{"account_key": "a", "kind": "deposit", "amount": 100_000.0, "flow_date": "2025-01-01", "external": 1},
          {"account_key": "b", "kind": "deposit", "amount": 50_000.0, "flow_date": "2025-07-01", "external": 1}]
    got = performance.xirr(accs, fl)["value"]
    t0, t1, t2 = 0.0, 181 / 365.25, 365 / 365.25                                        # 2025-07-01 is day 181
    npv = lambda r: -100_000 / (1 + r) ** t0 - 50_000 / (1 + r) ** t1 + 182_000 / (1 + r) ** t2
    assert got == pytest.approx(brentq(npv, -0.5, 2) * 100, abs=1e-3)
    each = [performance.xirr([a], [f for f in fl if f["account_key"] == a["key"]])["value"] for a in accs]
    assert abs(got - sum(each) / 2) > 0.5                                               # demonstrably not the average


def test_internal_transfers_and_fees_are_not_external_flows():
    fl = [{"kind": "deposit", "amount": 100.0, "flow_date": "2026-10-02", "external": 1}, {"kind": "transfer_in", "amount": 50.0, "flow_date": "2026-10-03", "external": 0},
          {"kind": "fee", "amount": 5.0, "flow_date": "2026-10-04", "external": 1}, {"kind": "withdrawal", "amount": 20.0, "flow_date": "2026-10-05", "external": 1}]
    assert performance.external_flows(fl) == [("2026-10-02", 100.0), ("2026-10-05", -20.0)]


def test_xirr_unavailable_when_history_incomplete_and_dates_use_own_valuation_date():
    acc = [{"key": "a", "closing_value": 1.0, "valuation_date": "2026-10-31", "flows_complete": False}]
    r = performance.xirr(acc, [])
    assert r["value"] is None and "not confirmed complete" in r["reason"]


def test_modified_dietz_reference():
    acc = [{"key": "a", "provider": "p", "account_no": "1", "closing_value": 115_000.0, "valuation_date": "2026-10-31", "opening_value": 100_000.0,
            "period_start": "2026-10-01", "flows_complete": False}]
    fl = [{"account_key": "a", "kind": "deposit", "amount": 10_000.0, "flow_date": "2026-10-16", "external": 1}]
    r = performance.dietz(acc, fl, [])
    # weight = (30-15)/30 = 0.5 -> (115000-100000-10000)/(100000+5000)
    assert r["value"] == pytest.approx(5000 / 105000 * 100, abs=1e-3)
    acc[0]["opening_value"] = None
    assert performance.dietz(acc, fl, [])["value"] is None


def test_dietz_uses_prior_snapshot_opening_and_refuses_mixed_windows():
    a = {"key": "p:1", "provider": "p", "account_no": "1", "closing_value": 110.0, "valuation_date": "2026-10-31", "flows_complete": False}
    prev = [{"provider": "p", "account_no": "1", "closing_value": 100.0, "valuation_date": "2026-09-30"}]
    assert performance.dietz([a], [], prev)["value"] == pytest.approx(10.0, abs=1e-6)
    b = {**a, "key": "q:1", "provider": "q", "valuation_date": "2026-10-29", "opening_value": 5.0, "period_start": "2026-10-01"}
    assert "different" in performance.dietz([a, b], [], prev)["reason"]


def test_cagr_requires_history_and_no_flows():
    acc = [{"closing_value": 121.0, "valuation_date": "2026-10-31"}]
    prev = {"valuation_date": "2024-10-31", "total_value": 100.0}
    r = performance.cagr(acc, [], prev)
    assert r["value"] == pytest.approx(10.0, abs=0.05)                                  # 100 -> 121 over 2 years
    assert performance.cagr(acc, [{"kind": "deposit", "flow_date": "2026-01-01", "external": 1}], prev)["value"] is None
    assert performance.cagr(acc, [], {"valuation_date": "2026-10-01", "total_value": 100.0})["value"] is None


# ---------------- consolidation against hand-computed totals
def _rows():
    sts = {"fundsindia": ADAPTERS["fundsindia"].extract("fi.xlsx", fx.fundsindia_xlsx()), "proaffluence": _pa(),
           "stallion": ADAPTERS["stallion"].extract("st.xlsx", fx.stallion_xlsx())}
    accounts, holdings, flows, files = [], [], [], []
    for pid, st in sts.items():
        _, basis, _ = validation.validate_statement(st)
        fid = f"file-{pid}"
        files.append({"id": fid, "filename": st.filename, "sha256": "0" * 64, "provider": pid, "statement_date": st.statement_date, "adapter_version": "t"})
        nos = list(dict.fromkeys([h.account_no for h in st.holdings]))
        for no in nos:
            aid = f"{pid}-{no}"
            mv = sum(h.market_value for h in st.holdings if h.account_no == no)
            cash = st.totals.get("cash_balance") or 0
            accounts.append({"id": aid, "provider": pid, "account_no": no, "asset_class": st.asset_class, "valuation_date": st.statement_date,
                             "statement_date": st.statement_date, "period_start": st.period_start, "provider_total_invested": st.totals.get("total_invested"),
                             "opening_value": st.totals.get("opening_value"), "realised_gain": None, "unrealised_gain": None, "income": None,
                             "flows_complete": 0, "value_basis": basis, "closing_value": mv + (cash if basis == "holdings_plus_cash" else 0),
                             "source_file_id": fid})
            holdings += [{**vars(h), "account_id": aid, "provider": pid, "source_file_id": fid} for h in st.holdings if h.account_no == no]
            if no == st.account_no:
                flows += [{"id": f"{aid}-{i}", "account_id": aid, "flow_date": f.flow_date, "kind": f.kind, "amount": f.amount, "external": 1}
                          for i, f in enumerate(st.flows)]
    return accounts, holdings, flows, files


def test_consolidated_totals_match_manual_reference():
    accounts, holdings, flows, files = _rows()
    batch = {"client_id": "c", "report_month": "2026-10", "valuation_date": "2026-10-31", "revision_no": 1}
    p = consolidation.consolidate(batch, accounts, holdings, flows, files, None, {})
    t = p["totals"]
    assert t["total_value"] == pytest.approx(fx.FI["value"] + fx.PA["total"] + fx.ST["total"])      # 1,321,092.10
    assert t["invested"] == pytest.approx(fx.FI["invested"] + fx.PA["invested"] + fx.ST["invested"])  # 1,075,030.00
    assert t["gain"] == pytest.approx(246_062.10) and t["absolute_return_pct"] == pytest.approx(246062.10 / 1075030 * 100, abs=1e-3)
    assert sum(a["pct"] for a in p["allocation"]) == pytest.approx(100.0, abs=0.01)
    assert {c["asset_type"] for c in p["allocation"]} == {"mutual_fund", "equity", "other", "cash"}
    assert next(c for c in p["allocation"] if c["asset_type"] == "cash")["value"] == 40_000.00        # 25,000 + 15,000
    assert {c["provider"]: c["value"] for c in p["provider_contribution"]} == {"fundsindia": 561092.10, "proaffluence": 445000.0, "stallion": 315000.0}
    assert t["unrealised_gain"] is None and "unrealised_gain" in p["unavailable"] or t["unrealised_gain"] is not None
    assert p["performance"]["consolidated"]["xirr"]["value"] is None                                 # flows not confirmed complete
    assert len(p["accounts"]) == 5 and p["month_on_month"] is None


def test_same_security_in_two_accounts_is_never_merged():
    accounts, holdings, flows, files = _rows()
    batch = {"client_id": "c", "report_month": "2026-10", "valuation_date": "2026-10-31", "revision_no": 1}
    p = consolidation.consolidate(batch, accounts, holdings, flows, files, None, {})
    rel = [h for h in p["holdings"] if h["isin"] == fx.ISIN_REL]
    assert len(rel) == 2 and {h["provider"] for h in rel} == {"proaffluence", "stallion"}


def test_missing_invested_makes_consolidated_gain_unavailable_not_zero():
    accounts, holdings, flows, files = _rows()
    next(a for a in accounts if a["provider"] == "stallion")["provider_total_invested"] = None
    p = consolidation.consolidate({"client_id": "c", "report_month": "2026-10", "valuation_date": "2026-10-31", "revision_no": 1},
                                  accounts, holdings, flows, files, None, {})
    assert p["totals"]["invested"] is None and p["totals"]["gain"] is None and "stallion" in p["unavailable"]["invested"]


def test_month_on_month_in_payload():
    accounts, holdings, flows, files = _rows()
    batch = {"client_id": "c", "report_month": "2026-10", "valuation_date": "2026-10-31", "revision_no": 1}
    first = consolidation.consolidate(batch, accounts, holdings, flows, files, None, {})
    first["report_month"], first["valuation_date"] = "2026-09", "2026-09-30"
    first["totals"]["total_value"] = 1_200_000.00
    second = consolidation.consolidate(batch, accounts, holdings, flows, files, first, {})
    mom = second["month_on_month"]
    assert mom["change"] == pytest.approx(121_092.10) and mom["net_external_flows"] == pytest.approx(100_000 + 200_000 - 20_000)
