"""Batch-level reconciliation: cross-file checks (duplicates, dates, provider mapping, transfers, month-on-month)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.backoffice.valuation import config as cfg
from app.backoffice.valuation.validation import Check


def _d(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def check_provider_mapping(file_id: str, filename: str, assigned: str, source: str, detected: str | None) -> Check:
    if detected and detected != assigned:
        return Check("provider_mapping", "error", "failed", f"'{filename}' is assigned to {assigned} ({source}) but its content "
                     f"matches {detected}.", file_id)
    return Check("provider_mapping", "info", "passed", f"'{filename}' provider {assigned} ({source}).", file_id)


def check_duplicate_statements(files: list[dict], others: list[dict]) -> list[Check]:
    """files/others: {file_id, filename, provider, account_no, statement_date, batch_id?}. Identity = provider + account + statement date
    (never the file name). Same identity twice in the batch, or already sitting in another open batch for this client-month."""
    out: list[Check] = []
    seen: dict[tuple, dict] = {}
    for f in files:
        if not f.get("account_no") or not f.get("statement_date"):
            continue
        key = (f["provider"], f["account_no"], f["statement_date"])
        if key in seen:
            out.append(Check("duplicate_statement", "error", "failed", f"'{f['filename']}' repeats {f['provider']} account {f['account_no']} "
                             f"dated {f['statement_date']} already in '{seen[key]['filename']}'.", f["file_id"]))
        seen[key] = f
    other_keys = {(o["provider"], o["account_no"], o["statement_date"]): o for o in others if o.get("account_no")}
    for key, f in seen.items():
        if key in other_keys:
            out.append(Check("duplicate_statement", "error", "failed", f"{key[0]} account {key[1]} dated {key[2]} is already in another "
                             f"open valuation batch for this client and month.", f["file_id"]))
    if not out:
        out.append(Check("duplicate_statement", "info", "passed", "No repeated provider/account/date statements.", ""))
    return out


def check_dates(batch_month: str, valuation_date: str, accounts: list[dict]) -> list[Check]:
    out: list[Check] = []
    vd = _d(valuation_date)
    dates = []
    for a in accounts:
        sd = _d(a.get("valuation_date") or a.get("statement_date"))
        if not sd or not vd:
            continue
        dates.append(sd)
        subj = f"{a['provider']}:{a.get('account_no')}"
        gap = abs((sd - vd).days)
        if sd.strftime("%Y-%m") != batch_month and gap > cfg.DATE_GAP_DAYS:
            out.append(Check("statement_period", "error", "failed", f"{subj} is dated {sd}, outside reporting month {batch_month}.", subj))
        elif gap > cfg.DATE_GAP_DAYS:
            out.append(Check("valuation_date_gap", "warning", "failed", f"{subj} is valued on {sd}, {gap} days from the requested "
                             f"valuation date {vd}.", subj, float(0), float(gap), float(gap)))
        elif sd != vd:
            out.append(Check("valuation_date_gap", "info", "passed", f"{subj} valued on {sd} (requested {vd}); shown as reported.", subj))
    if len(set(dates)) > 1:
        spread = (max(dates) - min(dates)).days
        sev, st = ("warning", "failed") if spread > cfg.DATE_GAP_DAYS else ("info", "passed")
        out.append(Check("valuation_dates_differ", sev, st, f"Providers report different valuation dates ({', '.join(str(d) for d in sorted(set(dates)))}); "
                         "the report shows each provider's own date.", "", None, float(spread), None))
    return out


def pair_transfers(flows: list[dict]) -> tuple[set[str], list[Check]]:
    """Transfers (switch/transfer in/out) are internal only when a matching opposite transfer exists (same amount, +-1 day).
    Returns ids of paired flows (to be marked non-external) and a check per unpaired transfer."""
    ins = [f for f in flows if f["kind"] == "transfer_in"]
    outs = [f for f in flows if f["kind"] == "transfer_out"]
    paired: set[str] = set()
    for o in outs:
        for i in ins:
            if i["id"] in paired or o["id"] in paired:
                continue
            if abs(Decimal(str(i["amount"])) - Decimal(str(o["amount"]))) <= Decimal(str(cfg.ABS_TOL)) and \
               abs((_d(i["flow_date"]) - _d(o["flow_date"])).days) <= 1:
                paired.update((i["id"], o["id"]))
    checks = [Check("unpaired_transfer", "error", "failed", f"{f['kind'].replace('_', ' ')} of {f['amount']:,.2f} on {f['flow_date']} "
                    f"({f.get('description') or ''}) has no matching opposite transfer; confirm whether it is an external flow.", f["id"],
                    None, f["amount"], None) for f in flows if f["kind"] in ("transfer_in", "transfer_out") and f["id"] not in paired]
    if paired:
        checks.append(Check("transfers_paired", "info", "passed", f"{len(paired) // 2} internal transfer pair(s) excluded from external flows.", ""))
    return paired, checks


def check_month_on_month(current_total: Decimal, net_external: Decimal, prev: dict[str, Any] | None,
                         current_accounts: list[dict]) -> list[Check]:
    if not prev:
        return [Check("mom_history", "info", "passed", "No earlier approved snapshot: month-on-month comparison unavailable.", "")]
    out: list[Check] = []
    pv = Decimal(str(prev["total_value"]))
    unexplained = current_total - pv - net_external
    if pv > 0:
        ratio = abs(unexplained) / pv
        out.append(Check("mom_unexplained", "warning" if ratio > Decimal(str(cfg.MOM_THRESHOLD)) else "info",
                         "failed" if ratio > Decimal(str(cfg.MOM_THRESHOLD)) else "passed",
                         f"Change vs {prev['report_month']} not explained by external flows is {float(ratio) * 100:.1f}% of opening value "
                         f"(threshold {cfg.MOM_THRESHOLD * 100:.0f}%); market movement may explain it.", "",
                         float(pv + net_external), float(current_total), round(float(unexplained), 2)))
    cur = {(a["provider"], a.get("account_no")) for a in current_accounts}
    for pa in prev.get("accounts", []):
        if (pa["provider"], pa.get("account_no")) not in cur and (pa.get("closing_value") or 0) > 0:
            out.append(Check("account_missing", "warning", "failed", f"{pa['provider']} account {pa.get('account_no')} was valued at "
                             f"{pa['closing_value']:,.2f} in {prev['report_month']} but has no statement this month.", f"{pa['provider']}:{pa.get('account_no')}",
                             pa["closing_value"], 0.0, -pa["closing_value"]))
    return out


def check_flow_completeness(accounts: list[dict]) -> list[Check]:
    bad = [f"{a['provider']}:{a.get('account_no')}" for a in accounts if not a.get("flows_complete")]
    if bad:
        return [Check("flows_incomplete", "info", "failed", "Cash-flow history is not confirmed complete for " + ", ".join(bad) +
                      "; since-inception XIRR is shown as unavailable.", "")]
    return [Check("flows_complete", "info", "passed", "Cash-flow history confirmed complete for every account.", "")]
