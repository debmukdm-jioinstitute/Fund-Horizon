"""Backoffice > Monthly Valuation API. Thin HTTP layer: auth, client-level access control, CSRF, then app.backoffice.valuation.service.

Every endpoint resolves the batch/file/check/snapshot/report to its client and calls the CRM's own ``_visible_customer`` check
(admins/compliance unscoped, RMs limited to their book). Compliance accounts are read-only via ``crm_user``."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.api.auth import get_optional_customer, verify_csrf
from app.api.crm_core import Me, _scope, _visible_customer
from app.backoffice.valuation import service
from app.backoffice.valuation.providers import ADAPTERS
from app.repo_crm_core import get_crm_repository

router = APIRouter(prefix="/api/backoffice/valuation", tags=["valuation"])


def _reviewer_role(raw: dict | None) -> str:
    """The account's REAL role. ``crm_user`` maps every staff role outside admin/rm/compliance to ``admin`` for CRM scoping;
    overriding a material discrepancy must not inherit that, so it is checked against the stored role."""
    return "admin" if raw and raw.get("role") == "admin" else "other"


def _call(fn, *a, **k):
    try:
        return fn(*a, **k)
    except service.ServiceError as e:
        raise HTTPException(e.status, e.message) from None


def _client_of_batch(batch_id: str, me: dict, request: Request | None = None) -> str:
    if request is not None:
        verify_csrf(request)
    cid = _call(service.batch_client, batch_id)
    _visible_customer(cid, me)
    return cid


class BatchIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=36)
    report_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    valuation_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    revises_batch_id: str | None = None


class ProcessIn(BaseModel):
    passwords: dict[str, str] = Field(default_factory=dict, description="file id -> PDF password; used in memory only, never stored")


class ProviderIn(BaseModel):
    provider: str


class ResolveIn(BaseModel):
    action: str = Field(pattern="^(resolved|overridden)$")
    reason: str = Field(min_length=10, max_length=500)


class AttestIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


class HoldingEditIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500, description="Why the figure is being changed; kept in the audit log")
    security_name: str | None = None
    isin: str | None = None
    asset_type: str | None = None
    quantity: float | None = None
    avg_cost: float | None = None
    invested_amount: float | None = None
    price: float | None = None
    market_value: float | None = None
    unrealised_gain: float | None = None
    realised_gain: float | None = None
    income: float | None = None


class ReasonIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


class ApproveIn(BaseModel):
    generate_report: bool = True


@router.get("/providers")
def providers(me: Me):
    return {"data": [{"id": a.id, "label": a.label, "asset_class": a.asset_class, "verified_on_real_statements": a.verified,
                      "adapter_version": a.version} for a in ADAPTERS.values()]}


@router.get("/batches")
def list_batches(me: Me, client_id: str | None = None, month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$")):
    scope = _scope(me)
    if client_id:
        _visible_customer(client_id, me)
    rows = _call(service.list_batches, None if scope.admin else set(scope.customer_ids), client_id, month)
    names = get_crm_repository().customer_names({r["client_id"] for r in rows})
    return {"data": [{**r, "client_name": names.get(r["client_id"])} for r in rows], "count": len(rows)}


@router.post("/batches", status_code=201)
def create_batch(body: BatchIn, request: Request, me: Me):
    verify_csrf(request)
    _visible_customer(body.client_id, me)
    if body.revises_batch_id:
        _client_of_batch(body.revises_batch_id, me)
    return _call(service.create_batch, body.client_id, body.report_month, body.valuation_date, me["id"], body.revises_batch_id)


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str, me: Me):
    _client_of_batch(batch_id, me)
    return _call(service.preview, batch_id)


@router.post("/batches/{batch_id}/files", status_code=201)
async def upload(batch_id: str, request: Request, me: Me, files: Annotated[list[UploadFile], File()],
                 provider: Annotated[str | None, Form()] = None, password: Annotated[str, Form()] = ""):
    _client_of_batch(batch_id, me, request)
    if not files:
        raise HTTPException(422, "Upload at least one file.")
    out: list[dict[str, Any]] = []
    for f in files:
        data = await f.read()
        try:
            r = await run_in_threadpool(service.add_file, batch_id, f.filename or "statement", data, me["id"], provider or None, password)
            out.append({"ok": True, "file": r})
        except service.ServiceError as e:  # one bad file must not discard the rest of the upload
            out.append({"ok": False, "filename": f.filename, "status": e.status, "error": e.message})
    return {"results": out}


@router.patch("/files/{file_id}/provider")
def set_provider(file_id: str, body: ProviderIn, request: Request, me: Me):
    _client_of_batch(_call(service.file_batch, file_id), me, request)
    return _call(service.set_provider, file_id, body.provider, me["id"])


@router.delete("/files/{file_id}", status_code=204)
def remove_file(file_id: str, request: Request, me: Me):
    _client_of_batch(_call(service.file_batch, file_id), me, request)
    _call(service.remove_file, file_id, me["id"])
    return Response(status_code=204)


@router.post("/batches/{batch_id}/process")
def process(batch_id: str, body: ProcessIn, request: Request, me: Me):
    _client_of_batch(batch_id, me, request)
    return _call(service.process, batch_id, me["id"], body.passwords)


@router.get("/batches/{batch_id}/preview")
def preview(batch_id: str, me: Me):
    _client_of_batch(batch_id, me)
    return _call(service.preview, batch_id)


@router.get("/batches/{batch_id}/reconciliation")
def reconciliation(batch_id: str, me: Me):
    _client_of_batch(batch_id, me)
    return _call(service.reconciliation_report, batch_id)


@router.post("/batches/{batch_id}/validate")
def validate(batch_id: str, request: Request, me: Me):
    _client_of_batch(batch_id, me, request)
    return _call(service.reconcile, batch_id, me["id"])


@router.post("/checks/{check_id}/resolve")
def resolve(check_id: str, body: ResolveIn, request: Request, me: Me, raw: Annotated[dict | None, Depends(get_optional_customer)]):
    _client_of_batch(_call(service.check_batch, check_id), me, request)
    return _call(service.resolve_check, check_id, body.action, body.reason, me["id"], _reviewer_role(raw))


@router.post("/accounts/{account_id}/attest-flows")
def attest(account_id: str, body: AttestIn, request: Request, me: Me, raw: Annotated[dict | None, Depends(get_optional_customer)]):
    from app.backoffice.valuation import models as m

    with service.scope() as s:
        a = s.get(m.ValAccount, account_id)
        bid = a.batch_id if a else None
    if not bid:
        raise HTTPException(404, "Account not found.")
    _client_of_batch(bid, me, request)
    return _call(service.attest_flows_complete, account_id, body.reason, me["id"], _reviewer_role(raw))


@router.get("/batches/{batch_id}/consolidated")
def consolidated(batch_id: str, me: Me):
    _client_of_batch(batch_id, me)
    return _call(service.consolidated_preview, batch_id)


@router.post("/batches/{batch_id}/approve")
def approve(batch_id: str, body: ApproveIn, request: Request, me: Me):
    cid = _client_of_batch(batch_id, me, request)
    res = _call(service.approve, batch_id, me["id"])
    if body.generate_report:
        name = get_crm_repository().customer_names({cid}).get(cid, cid)
        res["report"] = _call(service.generate_report, res["snapshot_id"], me["id"], name)
    return res


@router.get("/snapshots/{snapshot_id}")
def snapshot(snapshot_id: str, me: Me):
    _visible_customer(_call(service.snapshot_client, snapshot_id), me)
    return _call(service.get_snapshot, snapshot_id)


@router.post("/snapshots/{snapshot_id}/report", status_code=201)
def generate(snapshot_id: str, request: Request, me: Me):
    verify_csrf(request)
    cid = _call(service.snapshot_client, snapshot_id)
    _visible_customer(cid, me)
    name = get_crm_repository().customer_names({cid}).get(cid, cid)
    return _call(service.generate_report, snapshot_id, me["id"], name)


@router.get("/reports/{version_id}/download")
def download(version_id: str, me: Me):
    _visible_customer(_call(service.report_client, version_id), me)
    data, rv = _call(service.report_bytes, version_id)
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="valuation-{rv["report_month"]}-v{rv["version_no"]}.pdf"', "Cache-Control": "private, no-store"})


@router.get("/clients/{client_id}/history")
def history(client_id: str, me: Me):
    _visible_customer(client_id, me)
    return {"data": _call(service.history, client_id)}


def _fields(body: HoldingEditIn) -> dict:
    return body.model_dump(exclude_unset=True, exclude={"reason"})


@router.patch("/holdings/{holding_id}")
def edit_holding(holding_id: str, body: HoldingEditIn, request: Request, me: Me):
    _client_of_batch(_call(service.holding_batch, holding_id), me, request)
    return _call(service.edit_holding, holding_id, _fields(body), body.reason, me["id"])


@router.delete("/holdings/{holding_id}")
def remove_holding(holding_id: str, body: ReasonIn, request: Request, me: Me):
    _client_of_batch(_call(service.holding_batch, holding_id), me, request)
    return _call(service.remove_holding, holding_id, body.reason, me["id"])


@router.post("/accounts/{account_id}/holdings", status_code=201)
def add_holding(account_id: str, body: HoldingEditIn, request: Request, me: Me):
    _client_of_batch(_call(service.account_batch, account_id), me, request)
    return _call(service.add_holding, account_id, _fields(body), body.reason, me["id"])


@router.delete("/batches/{batch_id}")
def discard_batch(batch_id: str, body: ReasonIn, request: Request, me: Me):
    _client_of_batch(batch_id, me, request)
    return _call(service.discard_batch, batch_id, body.reason, me["id"])


@router.get("/batches/{batch_id}/holdings")
def batch_holdings(batch_id: str, me: Me):
    _client_of_batch(batch_id, me)
    rows = _call(service.list_holdings, batch_id)
    return {"data": rows, "count": len(rows)}
