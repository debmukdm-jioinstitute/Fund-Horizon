"""Workflow service: the only module that talks to the database. All writes are transactional (one ``scope()`` = one commit).
Approved snapshots, report versions and the audit log are append-only (also enforced by SQLite triggers)."""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

from app.backoffice.valuation import config as cfg
from app.backoffice.valuation import consolidation, detection, ingestion, reconciliation, validation
from app.backoffice.valuation import models as m
from app.backoffice.valuation.canonical import ExtractedStatement, ExtractionError, FlowRec, HoldingRec
from app.backoffice.valuation.providers import ADAPTERS
from app.db import sqlite

OPEN = ("draft", "processed", "reconciled")
_ENGINES: dict[str, Any] = {}


class ServiceError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def engine():
    path = str(sqlite.db_path())
    if path not in _ENGINES:
        eng = create_engine(f"sqlite:///{path}", connect_args={"timeout": 30})

        @event.listens_for(eng, "connect")
        def _fk(dbapi, _):  # noqa: ANN001
            dbapi.execute("PRAGMA foreign_keys=ON")

        m.ensure_schema(eng)
        _ENGINES[path] = eng
    return _ENGINES[path]


@contextmanager
def scope() -> Iterator[Session]:
    with Session(engine()) as s:
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise


def row(o) -> dict[str, Any]:
    return {c.name: getattr(o, c.name) for c in o.__table__.columns}


def audit(s: Session, actor: str, action: str, batch: m.ValBatch | None = None, detail: Any = None, client_id: str | None = None) -> None:
    s.add(m.ValAuditLog(batch_id=batch.id if batch else None, client_id=batch.client_id if batch else client_id, actor_id=actor,
                        action=action, detail=json.dumps(detail, default=str) if detail is not None else None))


def _batch(s: Session, batch_id: str) -> m.ValBatch:
    b = s.get(m.ValBatch, batch_id)
    if not b:
        raise ServiceError(404, "Valuation batch not found.")
    return b


def _editable(b: m.ValBatch) -> None:
    if b.status not in OPEN:
        raise ServiceError(409, f"Batch is {b.status} and can no longer be changed; create a revision instead.")


def batch_client(batch_id: str) -> str:
    """Client id of a batch (for the API's access check before anything else is read)."""
    with scope() as s:
        return _batch(s, batch_id).client_id


def file_batch(file_id: str) -> str:
    with scope() as s:
        f = s.get(m.ValSourceFile, file_id)
        if not f:
            raise ServiceError(404, "File not found.")
        return f.batch_id


def check_batch(check_id: str) -> str:
    with scope() as s:
        c = s.get(m.ValReconciliation, check_id)
        if not c:
            raise ServiceError(404, "Check not found.")
        return c.batch_id


def snapshot_client(snapshot_id: str) -> str:
    with scope() as s:
        sn = s.get(m.ValSnapshot, snapshot_id)
        if not sn:
            raise ServiceError(404, "Snapshot not found.")
        return sn.client_id


def report_client(version_id: str) -> str:
    with scope() as s:
        r = s.get(m.ValReportVersion, version_id)
        if not r:
            raise ServiceError(404, "Report version not found.")
        return r.client_id


# ------------------------------------------------------------------ batches
def create_batch(client_id: str, report_month: str, valuation_date: str, actor: str, revises: str | None = None) -> dict:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", report_month or ""):
        raise ServiceError(422, "report_month must be YYYY-MM.")
    try:
        vd = date.fromisoformat(valuation_date)
    except (TypeError, ValueError):
        raise ServiceError(422, "valuation_date must be YYYY-MM-DD.") from None
    if vd.strftime("%Y-%m") != report_month:
        raise ServiceError(422, "valuation_date must fall within the reporting month.")
    with scope() as s:
        open_b = s.scalar(select(m.ValBatch).where(m.ValBatch.client_id == client_id, m.ValBatch.report_month == report_month,
                                                   m.ValBatch.status.in_(OPEN)))
        if open_b:
            raise ServiceError(409, f"An open valuation batch already exists for this client and month ({open_b.id}).")
        approved = s.scalar(select(func.max(m.ValBatch.revision_no)).where(
            m.ValBatch.client_id == client_id, m.ValBatch.report_month == report_month, m.ValBatch.status == "approved"))
        rev = 1
        if approved:
            if not revises:
                raise ServiceError(409, "An approved valuation exists for this month; create a revision (revises_batch_id) to correct it.")
            base = _batch(s, revises)
            if base.client_id != client_id or base.report_month != report_month or base.status != "approved":
                raise ServiceError(422, "revises_batch_id must be an approved batch of the same client and month.")
            rev = approved + 1
        elif revises:
            raise ServiceError(422, "Nothing approved to revise.")
        b = m.ValBatch(client_id=client_id, report_month=report_month, valuation_date=valuation_date, created_by=actor,
                       revision_no=rev, revises_batch_id=revises)
        s.add(b)
        s.flush()
        audit(s, actor, "batch_created", b, {"revision_no": rev})
        return row(b)


# ------------------------------------------------------------------ files
def add_file(batch_id: str, filename: str, data: bytes, actor: str, provider: str | None = None, password: str = "") -> dict:
    if not data:
        raise ServiceError(422, f"{filename}: file is empty.")
    if len(data) > cfg.MAX_BYTES:
        raise ServiceError(413, f"{filename}: larger than {cfg.MAX_BYTES // 2**20} MB.")
    if provider and provider not in ADAPTERS:
        raise ServiceError(422, f"Unknown provider '{provider}'.")
    digest = ingestion.sha256(data)
    note, status, detected = None, "uploaded", None
    try:
        ingestion.kind_of(filename, data)
        detected, note = detection.detect(filename, data, password)
    except ExtractionError as e:
        if e.code == "unsupported_file":
            raise ServiceError(415, e.args[0]) from None
        status, note = "manual_review", e.args[0]
    with scope() as s:
        b = _batch(s, batch_id)
        _editable(b)
        if s.scalar(select(func.count()).select_from(m.ValSourceFile).where(
                m.ValSourceFile.batch_id == batch_id, m.ValSourceFile.status != "removed")) >= cfg.MAX_FILES:
            raise ServiceError(422, f"At most {cfg.MAX_FILES} files per batch.")
        dup = s.scalar(select(m.ValSourceFile).join(m.ValBatch, m.ValBatch.id == m.ValSourceFile.batch_id).where(
            m.ValSourceFile.sha256 == digest, m.ValSourceFile.client_id == b.client_id, m.ValSourceFile.status != "removed",
            (m.ValSourceFile.batch_id == batch_id) | (m.ValBatch.status.in_(OPEN) & (m.ValBatch.report_month == b.report_month))))
        if dup:
            raise ServiceError(409, f"Duplicate upload: identical content to '{dup.filename}' (same SHA-256).")
        key = f"{digest[:2]}/{digest}.bin"
        path = cfg.private_dir() / key
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(data)
            path.chmod(0o600)
        f = m.ValSourceFile(batch_id=batch_id, client_id=b.client_id, filename=re.sub(r"[^\w.\- ()]", "_", filename)[:200], sha256=digest,
                            size_bytes=len(data), storage_key=key, provider=provider or detected,
                            provider_source="manual" if provider else "detected", detect_note=note, status=status)
        s.add(f)
        b.status = "draft"
        s.flush()
        audit(s, actor, "file_added", b, {"file": f.filename, "sha256": digest, "provider": f.provider, "source": f.provider_source})
        return row(f)


def set_provider(file_id: str, provider: str, actor: str) -> dict:
    if provider not in ADAPTERS:
        raise ServiceError(422, f"Unknown provider '{provider}'.")
    with scope() as s:
        f = s.get(m.ValSourceFile, file_id)
        if not f:
            raise ServiceError(404, "File not found.")
        b = _batch(s, f.batch_id)
        _editable(b)
        f.provider, f.provider_source, f.status = provider, "manual", "uploaded"
        b.status = "draft"
        audit(s, actor, "provider_set", b, {"file": f.filename, "provider": provider})
        return row(f)


def remove_file(file_id: str, actor: str) -> None:
    with scope() as s:
        f = s.get(m.ValSourceFile, file_id)
        if not f:
            raise ServiceError(404, "File not found.")
        b = _batch(s, f.batch_id)
        _editable(b)
        _clear_extraction(s, f.id)
        f.status = "removed"
        b.status = "draft"
        audit(s, actor, "file_removed", b, {"file": f.filename})


# ------------------------------------------------------------------ manual corrections (open batches only)
HOLDING_FIELDS = ("security_name", "isin", "asset_type", "quantity", "avg_cost", "invested_amount", "price", "market_value",
                  "unrealised_gain", "realised_gain", "income")
_NUMERIC = {"quantity", "avg_cost", "invested_amount", "price", "market_value", "unrealised_gain", "realised_gain", "income"}


def _clean_fields(fields: dict) -> dict:
    out = {}
    for k, v in fields.items():
        if k not in HOLDING_FIELDS:
            raise ServiceError(422, f"Unknown holding field '{k}'.")
        if k in _NUMERIC and v is not None:
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise ServiceError(422, f"'{k}' must be a number.") from None
        if k == "asset_type" and v not in ("mutual_fund", "equity", "debt", "cash", "other"):
            raise ServiceError(422, "asset_type must be mutual_fund, equity, debt, cash or other.")
        if k == "security_name" and not str(v or "").strip():
            raise ServiceError(422, "security_name cannot be empty.")
        out[k] = v
    return out


def list_holdings(batch_id: str) -> list[dict]:
    """Every extracted/edited holding of a batch with its id (needed to correct or remove one)."""
    with scope() as s:
        _batch(s, batch_id)
        return [row(h) for h in s.scalars(select(m.ValHolding).where(m.ValHolding.batch_id == batch_id).order_by(m.ValHolding.account_id, m.ValHolding.source_row))]


def holding_batch(holding_id: str) -> str:
    with scope() as s:
        h = s.get(m.ValHolding, holding_id)
        if not h:
            raise ServiceError(404, "Holding not found.")
        return h.batch_id


def account_batch(account_id: str) -> str:
    with scope() as s:
        a = s.get(m.ValAccount, account_id)
        if not a:
            raise ServiceError(404, "Account not found.")
        return a.batch_id


def edit_holding(holding_id: str, fields: dict, reason: str, actor: str) -> dict:
    """Correct a holding. The before/after values and the reason go to the audit log; the batch must be validated again."""
    fields = _clean_fields(fields)
    with scope() as s:
        h = s.get(m.ValHolding, holding_id)
        if not h:
            raise ServiceError(404, "Holding not found.")
        b = _batch(s, h.batch_id)
        _editable(b)
        before = {k: getattr(h, k) for k in fields}
        for k, v in fields.items():
            setattr(h, k, v)
        h.validation_status = "warning"  # edited by hand: flagged until reviewed
        b.status = "processed"
        audit(s, actor, "holding_edited", b, {"holding": h.id, "security": h.security_name, "before": before, "after": fields, "reason": reason})
        return row(h)


def add_holding(account_id: str, fields: dict, reason: str, actor: str) -> dict:
    fields = _clean_fields(fields)
    if not fields.get("security_name"):
        raise ServiceError(422, "security_name is required.")
    with scope() as s:
        a = s.get(m.ValAccount, account_id)
        if not a:
            raise ServiceError(404, "Account not found.")
        b = _batch(s, a.batch_id)
        _editable(b)
        h = m.ValHolding(batch_id=b.id, account_id=a.id, source_file_id=a.source_file_id, provider=a.provider,
                         asset_type=fields.pop("asset_type", "other"), validation_status="warning", source_page="manual", **fields)
        s.add(h)
        s.flush()
        b.status = "processed"
        audit(s, actor, "holding_added", b, {"holding": h.id, "account": a.id, "values": row(h), "reason": reason})
        return row(h)


def remove_holding(holding_id: str, reason: str, actor: str) -> dict:
    with scope() as s:
        h = s.get(m.ValHolding, holding_id)
        if not h:
            raise ServiceError(404, "Holding not found.")
        b = _batch(s, h.batch_id)
        _editable(b)
        gone = row(h)
        s.delete(h)
        b.status = "processed"
        audit(s, actor, "holding_removed", b, {"holding": gone, "reason": reason})
        return gone


def discard_batch(batch_id: str, reason: str, actor: str) -> dict:
    """Withdraw an unapproved batch. It is marked rejected and kept in the audit trail; approved snapshots are never touched."""
    with scope() as s:
        b = _batch(s, batch_id)
        _editable(b)
        b.status = "rejected"
        audit(s, actor, "batch_discarded", b, {"reason": reason})
        return row(b)


# ------------------------------------------------------------------ extraction
def _clear_extraction(s: Session, file_id: str) -> None:
    for t in (m.ValHolding, m.ValCashflow, m.ValAccount):
        for o in s.scalars(select(t).where(t.source_file_id == file_id)).all():
            s.delete(o)
    s.flush()


def _store_extraction(s: Session, f: m.ValSourceFile, st: ExtractedStatement) -> None:
    _clear_extraction(s, f.id)
    f.statement_date, f.adapter_version = st.statement_date, st.adapter_version
    f.warnings_json, f.errors_json = json.dumps(st.warnings), json.dumps(st.errors)
    f.totals_json = json.dumps({"totals": st.totals, "meta": {
        "account_no": st.account_no, "period_start": st.period_start, "valuation_date": st.valuation_date,
        "flows_complete": st.flows_complete, "asset_class": st.asset_class}})
    f.status = "manual_review" if st.needs_manual_review else ("failed" if st.errors and not st.holdings and not st.flows else "extracted")
    if st.needs_manual_review:
        return
    # accounts = those holdings/flows belong to; the statement-level id only stands in when nothing else identifies an account
    nos = list(dict.fromkeys([h.account_no for h in st.holdings] + [fl.account_no for fl in st.flows])) or [st.account_no]
    primary = st.account_no if st.account_no in nos else nos[0]
    accts: dict[str | None, m.ValAccount] = {}
    for no in nos:
        is_primary, single = no == primary, len(nos) == 1
        t = st.totals
        a = m.ValAccount(batch_id=f.batch_id, source_file_id=f.id, provider=st.provider, account_no=no, asset_class=st.asset_class,
                         valuation_date=st.valuation_date, statement_date=st.statement_date, period_start=st.period_start,
                         cash_balance=t.get("cash_balance") if is_primary else None,
                         provider_total_value=t.get("total_value") if single else None,
                         provider_total_invested=t.get("total_invested") if is_primary and st.asset_class == "pms" else None,
                         opening_value=t.get("opening_value") if is_primary else None,
                         realised_gain=t.get("realised_gain") if single else None, unrealised_gain=t.get("unrealised_gain") if single else None,
                         income=t.get("income") if single else None, fees=t.get("fees") if single else None,
                         flows_complete=int(st.flows_complete))
        s.add(a)
        accts[no] = a
    s.flush()
    for h in st.holdings:
        s.add(m.ValHolding(batch_id=f.batch_id, account_id=accts[h.account_no].id, source_file_id=f.id, provider=st.provider,
                           asset_type=h.asset_type, security_name=h.security_name[:255], isin=h.isin, quantity=h.quantity, avg_cost=h.avg_cost,
                           invested_amount=h.invested_amount, price=h.price, market_value=h.market_value, unrealised_gain=h.unrealised_gain,
                           realised_gain=h.realised_gain, income=h.income, source_page=h.source_page, source_row=h.source_row,
                           validation_status=h.validation_status))
    for fl in st.flows:
        s.add(m.ValCashflow(batch_id=f.batch_id, account_id=accts[fl.account_no].id, source_file_id=f.id, flow_date=fl.flow_date, kind=fl.kind,
                            amount=fl.amount, external=1, description=fl.description, source_page=fl.source_page, source_row=fl.source_row))


def process(batch_id: str, actor: str, passwords: dict[str, str] | None = None) -> dict:
    passwords = passwords or {}
    with scope() as s:
        b = _batch(s, batch_id)
        _editable(b)
        files = s.scalars(select(m.ValSourceFile).where(m.ValSourceFile.batch_id == batch_id, m.ValSourceFile.status != "removed")).all()
        if not files:
            raise ServiceError(422, "Upload at least one statement first.")
        for f in files:
            data = (cfg.private_dir() / f.storage_key).read_bytes()
            if not f.provider:
                f.status, f.errors_json = "manual_review", json.dumps(["Provider not detected: select it manually."])
                _clear_extraction(s, f.id)
                continue
            try:
                st = ADAPTERS[f.provider].extract(f.filename, data, passwords.get(f.id, ""))
            except ExtractionError as e:
                st = ExtractedStatement(provider=f.provider, asset_class=ADAPTERS[f.provider].asset_class, filename=f.filename,
                                        adapter_version=ADAPTERS[f.provider].version, errors=[e.args[0]], needs_manual_review=True)
            except Exception as e:  # an adapter bug must flag the file, never silently drop it or 500 the batch
                st = ExtractedStatement(provider=f.provider, asset_class=ADAPTERS[f.provider].asset_class, filename=f.filename,
                                        adapter_version=ADAPTERS[f.provider].version, needs_manual_review=True,
                                        errors=[f"Extraction failed unexpectedly ({type(e).__name__}); flagged for manual review."])
            _store_extraction(s, f, st)
        b.status = "processed"
        audit(s, actor, "batch_processed", b, {"files": len(files)})
    return preview(batch_id)


# ------------------------------------------------------------------ preview
def preview(batch_id: str) -> dict:
    with scope() as s:
        b = _batch(s, batch_id)
        out = []
        for f in s.scalars(select(m.ValSourceFile).where(m.ValSourceFile.batch_id == batch_id).order_by(m.ValSourceFile.created_at)).all():
            if f.status == "removed":
                continue
            meta = json.loads(f.totals_json) if f.totals_json else {"totals": {}, "meta": {}}
            ad = ADAPTERS.get(f.provider or "")
            out.append({
                **{k: getattr(f, k) for k in ("id", "filename", "sha256", "size_bytes", "provider", "provider_source", "detect_note", "status",
                                              "statement_date", "adapter_version")},
                "provider_label": ad.label if ad else None, "adapter_verified": bool(ad and ad.verified), "totals": meta["totals"], "meta": meta["meta"],
                "warnings": json.loads(f.warnings_json or "[]"), "errors": json.loads(f.errors_json or "[]"),
                "accounts": [row(a) for a in s.scalars(select(m.ValAccount).where(m.ValAccount.source_file_id == f.id))],
                "holdings": [row(h) for h in s.scalars(select(m.ValHolding).where(m.ValHolding.source_file_id == f.id))],
                "cashflows": [row(c) for c in s.scalars(select(m.ValCashflow).where(m.ValCashflow.source_file_id == f.id))],
            })
        return {"batch": row(b), "files": out}


# ------------------------------------------------------------------ validation + reconciliation
def _statement(s: Session, f: m.ValSourceFile) -> ExtractedStatement:
    meta = json.loads(f.totals_json or '{"totals":{},"meta":{}}')
    mt = meta["meta"]
    st = ExtractedStatement(provider=f.provider or "", asset_class=mt.get("asset_class", "pms"), filename=f.filename, adapter_version=f.adapter_version or "",
                            statement_date=f.statement_date, valuation_date=mt.get("valuation_date"), period_start=mt.get("period_start"),
                            account_no=mt.get("account_no"), totals=meta["totals"], warnings=json.loads(f.warnings_json or "[]"),
                            errors=json.loads(f.errors_json or "[]"), needs_manual_review=f.status in ("manual_review", "failed"),
                            flows_complete=bool(mt.get("flows_complete")))
    accounts = {a.id: a for a in s.scalars(select(m.ValAccount).where(m.ValAccount.source_file_id == f.id))}
    for h in s.scalars(select(m.ValHolding).where(m.ValHolding.source_file_id == f.id).order_by(m.ValHolding.source_row)):
        st.holdings.append(HoldingRec(security_name=h.security_name, asset_type=h.asset_type, isin=h.isin, account_no=accounts[h.account_id].account_no,
                                      quantity=h.quantity, avg_cost=h.avg_cost, invested_amount=h.invested_amount, price=h.price,
                                      market_value=h.market_value, unrealised_gain=h.unrealised_gain, realised_gain=h.realised_gain,
                                      income=h.income, source_page=h.source_page, source_row=h.source_row))
    for c in s.scalars(select(m.ValCashflow).where(m.ValCashflow.source_file_id == f.id)):
        st.flows.append(FlowRec(flow_date=c.flow_date, kind=c.kind, amount=c.amount, description=c.description,
                                account_no=accounts[c.account_id].account_no))
    return st


def previous_snapshot(s: Session, client_id: str, report_month: str) -> dict | None:
    sn = s.scalar(select(m.ValSnapshot).where(m.ValSnapshot.client_id == client_id, m.ValSnapshot.report_month < report_month)
                  .order_by(m.ValSnapshot.report_month.desc(), m.ValSnapshot.revision_no.desc()))
    if not sn:
        return None
    p = json.loads(sn.payload_json)
    p["snapshot_id"], p["total_value"] = sn.id, sn.total_value
    return p


def reconcile(batch_id: str, actor: str) -> dict:
    with scope() as s:
        b = _batch(s, batch_id)
        _editable(b)
        if b.status == "draft":
            raise ServiceError(409, "Process the statements before running validation.")
        files = s.scalars(select(m.ValSourceFile).where(m.ValSourceFile.batch_id == batch_id, m.ValSourceFile.status != "removed")).all()
        checks: list[validation.Check] = []
        file_ctx: list[dict] = []
        for f in files:
            if not f.provider:
                checks.append(validation.Check("file_unreadable", "error", "failed", f"'{f.filename}': provider not assigned.", f.id))
                continue
            st = _statement(s, f)
            cs, basis, _closing = validation.validate_statement(st)
            for c in cs:
                c.subject = c.subject or f.id
                if c.subject == st.filename:
                    c.subject = f.id
            checks += cs
            checks.append(reconciliation.check_provider_mapping(f.id, f.filename, f.provider, f.provider_source, _detected(f)))
            accts = list(s.scalars(select(m.ValAccount).where(m.ValAccount.source_file_id == f.id)))
            primary = next((a for a in accts if a.account_no == st.account_no), accts[0] if accts else None)
            cash = Decimal(str(st.totals.get("cash_balance") or 0))
            for a in accts:
                mv = sum((Decimal(str(h.market_value or 0)) for h in s.scalars(select(m.ValHolding).where(m.ValHolding.account_id == a.id))), Decimal(0))
                a.value_basis = basis
                a.closing_value = float(mv + (cash if basis == "holdings_plus_cash" and a is primary else 0))
            for a in accts:
                file_ctx.append({"file_id": f.id, "filename": f.filename, "provider": f.provider, "account_no": a.account_no,
                                 "statement_date": f.statement_date})
        s.flush()
        accounts = [row(a) for a in s.scalars(select(m.ValAccount).where(m.ValAccount.batch_id == batch_id))]
        others = []
        for o in s.scalars(select(m.ValSourceFile).join(m.ValBatch, m.ValBatch.id == m.ValSourceFile.batch_id).where(
                m.ValBatch.client_id == b.client_id, m.ValBatch.report_month == b.report_month, m.ValBatch.id != b.id,
                m.ValBatch.status.in_(OPEN), m.ValSourceFile.status == "extracted")):
            for a in s.scalars(select(m.ValAccount).where(m.ValAccount.source_file_id == o.id)):
                others.append({"provider": a.provider, "account_no": a.account_no, "statement_date": o.statement_date})
        checks += reconciliation.check_duplicate_statements(file_ctx, others)
        checks += reconciliation.check_dates(b.report_month, b.valuation_date, accounts)
        flows = [row(c) for c in s.scalars(select(m.ValCashflow).where(m.ValCashflow.batch_id == batch_id))]
        paired, tcs = reconciliation.pair_transfers(flows)
        checks += tcs
        for c in s.scalars(select(m.ValCashflow).where(m.ValCashflow.batch_id == batch_id)):
            if c.kind in ("transfer_in", "transfer_out"):
                c.external = 0 if c.id in paired else 1
        s.flush()
        flows = [row(c) for c in s.scalars(select(m.ValCashflow).where(m.ValCashflow.batch_id == batch_id))]
        total = sum((Decimal(str(a["closing_value"] or 0)) for a in accounts), Decimal(0))
        from app.backoffice.valuation.performance import external_flows
        net = sum((Decimal(str(x)) for _d, x in external_flows(flows)), Decimal(0))
        prev = previous_snapshot(s, b.client_id, b.report_month)
        checks += reconciliation.check_month_on_month(total, net, prev, accounts)
        checks += reconciliation.check_flow_completeness(accounts)

        last = s.scalar(select(func.max(m.ValReconciliation.run_no)).where(m.ValReconciliation.batch_id == batch_id)) or 0
        carried = {(r.check_code, r.subject, r.fingerprint): r for r in s.scalars(select(m.ValReconciliation).where(
            m.ValReconciliation.batch_id == batch_id, m.ValReconciliation.run_no == last, m.ValReconciliation.status.in_(("resolved", "overridden"))))}
        for c in checks:
            fp = c.fingerprint()
            prior = carried.get((c.code, c.subject, fp)) if c.status == "failed" else None
            s.add(m.ValReconciliation(batch_id=batch_id, check_code=c.code, subject=c.subject, severity=c.severity,
                                      status=prior.status if prior else c.status, expected=c.expected, actual=c.actual, difference=c.difference,
                                      message=c.message[:500], fingerprint=fp, run_no=last + 1,
                                      resolution_reason=prior.resolution_reason if prior else None,
                                      resolved_by=prior.resolved_by if prior else None, resolved_at=prior.resolved_at if prior else None))
        b.status = "reconciled"
        audit(s, actor, "validation_run", b, {"run_no": last + 1, "checks": len(checks)})
    return reconciliation_report(batch_id)


def _detected(f: m.ValSourceFile) -> str | None:
    try:
        data = (cfg.private_dir() / f.storage_key).read_bytes()
        return detection.detect(f.filename, data)[0]
    except ExtractionError:
        return None  # password-protected: cannot re-detect, nothing to contradict


def reconciliation_report(batch_id: str) -> dict:
    with scope() as s:
        b = _batch(s, batch_id)
        last = s.scalar(select(func.max(m.ValReconciliation.run_no)).where(m.ValReconciliation.batch_id == batch_id))
        rows = [row(r) for r in s.scalars(select(m.ValReconciliation).where(
            m.ValReconciliation.batch_id == batch_id, m.ValReconciliation.run_no == last))] if last else []
        names = {f.id: f.filename for f in s.scalars(select(m.ValSourceFile).where(m.ValSourceFile.batch_id == batch_id))}
        for r in rows:
            r["subject_label"] = names.get(r["subject"], r["subject"])
            r["overridable"] = r["severity"] == "error" and r["check_code"] not in validation.NON_OVERRIDABLE
        blocking = [r for r in rows if r["severity"] == "error" and r["status"] == "failed"]
        return {"batch": row(b), "run_no": last, "summary": {
            "passed": sum(r["status"] == "passed" for r in rows), "failed_errors": len(blocking),
            "warnings": sum(r["severity"] == "warning" and r["status"] == "failed" for r in rows),
            "resolved": sum(r["status"] in ("resolved", "overridden") for r in rows),
            "can_approve": bool(last) and not blocking and b.status == "reconciled"}, "checks": rows}


def resolve_check(check_id: str, action: str, reason: str, actor: str, role: str) -> dict:
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise ServiceError(422, "A reason of at least 10 characters is required.")
    if action not in ("resolved", "overridden"):
        raise ServiceError(422, "action must be 'resolved' or 'overridden'.")
    with scope() as s:
        c = s.get(m.ValReconciliation, check_id)
        if not c:
            raise ServiceError(404, "Check not found.")
        b = _batch(s, c.batch_id)
        _editable(b)
        last = s.scalar(select(func.max(m.ValReconciliation.run_no)).where(m.ValReconciliation.batch_id == c.batch_id))
        if c.run_no != last or c.status != "failed" or c.severity == "info":
            raise ServiceError(409, "Only a failed warning/error from the latest validation run can be resolved.")
        if c.severity == "error":
            if c.check_code in validation.NON_OVERRIDABLE:
                raise ServiceError(422, "This failure cannot be overridden: remove or replace the file.")
            if role != "admin":
                raise ServiceError(403, "Only an administrator can override a material discrepancy.")
            action = "overridden"
        c.status, c.resolution_reason, c.resolved_by = action, reason[:500], actor
        c.resolved_at = m.now()
        audit(s, actor, f"check_{action}", b, {"check": c.check_code, "subject": c.subject, "difference": c.difference, "reason": reason})
        return row(c)


def attest_flows_complete(account_id: str, reason: str, actor: str, role: str) -> dict:
    if role != "admin":
        raise ServiceError(403, "Only an administrator can confirm cash-flow completeness.")
    if len((reason or "").strip()) < 10:
        raise ServiceError(422, "A reason of at least 10 characters is required.")
    with scope() as s:
        a = s.get(m.ValAccount, account_id)
        if not a:
            raise ServiceError(404, "Account not found.")
        b = _batch(s, a.batch_id)
        _editable(b)
        a.flows_complete, a.flows_attested_by = 1, actor
        b.status = "processed"
        audit(s, actor, "flows_attested_complete", b, {"account": a.account_no, "provider": a.provider, "reason": reason})
        return row(a)


# ------------------------------------------------------------------ approval, snapshots, reports
def _snapshot_payload(s: Session, b: m.ValBatch) -> dict:
    accounts = [row(a) for a in s.scalars(select(m.ValAccount).where(m.ValAccount.batch_id == b.id).order_by(m.ValAccount.provider, m.ValAccount.account_no))]
    holdings = [row(h) for h in s.scalars(select(m.ValHolding).where(m.ValHolding.batch_id == b.id).order_by(m.ValHolding.provider, m.ValHolding.source_row))]
    flows = [row(c) for c in s.scalars(select(m.ValCashflow).where(m.ValCashflow.batch_id == b.id).order_by(m.ValCashflow.flow_date))]
    files = [row(f) for f in s.scalars(select(m.ValSourceFile).where(m.ValSourceFile.batch_id == b.id, m.ValSourceFile.status != "removed"))]
    rep = reconciliation_report_in(s, b)
    return consolidation.consolidate(row(b), accounts, holdings, flows, files, previous_snapshot(s, b.client_id, b.report_month), rep)


def reconciliation_report_in(s: Session, b: m.ValBatch) -> dict:
    last = s.scalar(select(func.max(m.ValReconciliation.run_no)).where(m.ValReconciliation.batch_id == b.id))
    rows = list(s.scalars(select(m.ValReconciliation).where(m.ValReconciliation.batch_id == b.id, m.ValReconciliation.run_no == last))) if last else []
    return {"run_no": last, "passed": sum(r.status == "passed" for r in rows),
            "warnings_open": sum(r.severity == "warning" and r.status == "failed" for r in rows),
            "resolutions": [{"check": r.check_code, "subject": r.subject, "status": r.status, "difference": r.difference, "reason": r.resolution_reason,
                             "by": r.resolved_by, "at": r.resolved_at, "message": r.message} for r in rows if r.status in ("resolved", "overridden")],
            "info_failed": [r.message for r in rows if r.severity == "info" and r.status == "failed"]}


def consolidated_preview(batch_id: str) -> dict:
    with scope() as s:
        b = _batch(s, batch_id)
        if b.status == "approved":
            sn = s.scalar(select(m.ValSnapshot).where(m.ValSnapshot.batch_id == b.id))
            return json.loads(sn.payload_json)
        if b.status != "reconciled":
            raise ServiceError(409, "Run validation before viewing the consolidated portfolio.")
        return _snapshot_payload(s, b)


def approve(batch_id: str, actor: str) -> dict:
    with scope() as s:
        b = _batch(s, batch_id)
        if b.status == "approved":
            raise ServiceError(409, "Batch is already approved.")
        if b.status != "reconciled":
            raise ServiceError(409, "Run validation after the latest change before approving.")
        rep = reconciliation_report(batch_id)
        if not rep["summary"]["can_approve"]:
            raise ServiceError(409, f"{rep['summary']['failed_errors']} unresolved material discrepancy(ies) block approval.")
        if s.scalar(select(func.count()).select_from(m.ValAccount).where(m.ValAccount.batch_id == b.id)) == 0:
            raise ServiceError(409, "No accounts extracted.")
        payload = _snapshot_payload(s, b)
        body = json.dumps(payload, sort_keys=True, default=str)
        sn = m.ValSnapshot(batch_id=b.id, client_id=b.client_id, report_month=b.report_month, revision_no=b.revision_no,
                           valuation_date=b.valuation_date, total_value=payload["totals"]["total_value"], payload_json=body,
                           payload_sha256=hashlib.sha256(body.encode()).hexdigest(), approved_by=actor)
        s.add(sn)
        b.status, b.approved_by, b.approved_at = "approved", actor, m.now()
        s.flush()
        audit(s, actor, "batch_approved", b, {"snapshot_id": sn.id, "revision_no": b.revision_no, "sha256": sn.payload_sha256,
                                              "overrides": [r for r in payload["reconciliation"]["resolutions"]]})
        return {"snapshot_id": sn.id, "batch_id": b.id, "revision_no": b.revision_no, "payload_sha256": sn.payload_sha256}


def get_snapshot(snapshot_id: str) -> dict:
    with scope() as s:
        sn = s.get(m.ValSnapshot, snapshot_id)
        if not sn:
            raise ServiceError(404, "Snapshot not found.")
        return {**row(sn), "payload": json.loads(sn.payload_json), "payload_json": None}


def generate_report(snapshot_id: str, actor: str, client_name: str) -> dict:
    from app.backoffice.valuation import report

    with scope() as s:
        sn = s.get(m.ValSnapshot, snapshot_id)
        if not sn:
            raise ServiceError(404, "Snapshot not found.")
        n = (s.scalar(select(func.max(m.ValReportVersion.version_no)).where(
            m.ValReportVersion.client_id == sn.client_id, m.ValReportVersion.report_month == sn.report_month)) or 0) + 1
        pdf = report.build_pdf(json.loads(sn.payload_json), client_name=client_name, version_no=n)
        digest = hashlib.sha256(pdf).hexdigest()
        key = f"reports/{sn.client_id}/{sn.report_month}-v{n}-{digest[:12]}.pdf"
        path = cfg.private_dir() / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(pdf)
        path.chmod(0o600)
        rv = m.ValReportVersion(snapshot_id=sn.id, client_id=sn.client_id, report_month=sn.report_month, version_no=n, storage_key=key,
                                pdf_sha256=digest, size_bytes=len(pdf), generated_by=actor)
        s.add(rv)
        s.flush()
        audit(s, actor, "report_generated", None, {"report_version_id": rv.id, "version_no": n, "snapshot_id": sn.id}, client_id=sn.client_id)
        return row(rv)


def report_bytes(version_id: str) -> tuple[bytes, dict]:
    with scope() as s:
        rv = s.get(m.ValReportVersion, version_id)
        if not rv:
            raise ServiceError(404, "Report version not found.")
        data = (cfg.private_dir() / rv.storage_key).read_bytes()
        if hashlib.sha256(data).hexdigest() != rv.pdf_sha256:
            raise ServiceError(500, "Stored report failed its integrity check.")
        return data, row(rv)


# ------------------------------------------------------------------ listings
def history(client_id: str) -> list[dict]:
    with scope() as s:
        out = []
        for sn in s.scalars(select(m.ValSnapshot).where(m.ValSnapshot.client_id == client_id)
                            .order_by(m.ValSnapshot.report_month.desc(), m.ValSnapshot.revision_no.desc())):
            out.append({"snapshot_id": sn.id, "batch_id": sn.batch_id, "report_month": sn.report_month, "revision_no": sn.revision_no,
                        "valuation_date": sn.valuation_date, "total_value": sn.total_value, "approved_at": sn.created_at,
                        "payload_sha256": sn.payload_sha256,
                        "reports": [row(r) for r in s.scalars(select(m.ValReportVersion).where(m.ValReportVersion.snapshot_id == sn.id)
                                                              .order_by(m.ValReportVersion.version_no.desc()))]})
        # "latest" is the highest revision of each month; earlier revisions stay listed
        seen = set()
        for o in out:
            o["is_latest_revision"] = o["report_month"] not in seen
            seen.add(o["report_month"])
        return out


def list_batches(client_ids: set[str] | None, client_id: str | None = None, month: str | None = None) -> list[dict]:
    """client_ids None = unscoped (admin/compliance)."""
    with scope() as s:
        q = select(m.ValBatch).order_by(m.ValBatch.created_at.desc()).limit(300)
        if client_id:
            q = q.where(m.ValBatch.client_id == client_id)
        if month:
            q = q.where(m.ValBatch.report_month == month)
        if client_ids is not None:
            q = q.where(m.ValBatch.client_id.in_(client_ids or {""}))
        out = []
        for b in s.scalars(q):
            provs = sorted({f.provider for f in s.scalars(select(m.ValSourceFile).where(m.ValSourceFile.batch_id == b.id, m.ValSourceFile.status != "removed")) if f.provider})
            rec = reconciliation_report_in(s, b)
            sn = s.scalar(select(m.ValSnapshot).where(m.ValSnapshot.batch_id == b.id))
            rv = s.scalar(select(func.max(m.ValReportVersion.version_no)).where(m.ValReportVersion.snapshot_id == sn.id)) if sn else None
            blocking = s.scalar(select(func.count()).select_from(m.ValReconciliation).where(
                m.ValReconciliation.batch_id == b.id, m.ValReconciliation.run_no == rec["run_no"], m.ValReconciliation.severity == "error",
                m.ValReconciliation.status == "failed")) if rec["run_no"] else None
            out.append({**row(b), "providers": provs, "reconciliation_status": ("not_run" if not rec["run_no"] else "blocked" if blocking else
                        "warnings" if rec["warnings_open"] else "clean"), "blocking_checks": blocking, "snapshot_id": sn.id if sn else None,
                        "report_status": "not_generated" if not rv else f"v{rv}"})
        return out
