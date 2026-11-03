"""Staff Trade desk API: NSE cash day-trading pipeline (paper by default)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.auth import require_staff, verify_csrf
from app.backoffice.meta import with_meta
from app.backoffice.trade import TradeError, _SERVICE

router = APIRouter(prefix="/api/backoffice/trade", tags=["trade"])


def _staff_id(staff: dict) -> str:
    return str(staff.get("id") or staff.get("customer_id") or "")


def _err(exc: TradeError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


class ConfigPatch(BaseModel):
    budget: float | None = None
    cash_buffer_pct: float | None = None
    max_position_pct: float | None = None
    max_order_inr: float | None = None
    min_order_inr: float | None = None
    max_loss_per_trade_inr: float | None = None
    max_daily_loss_inr: float | None = None
    max_trades_per_day: int | None = None
    max_orders_per_day: int | None = None
    min_reward_risk: float | None = None
    no_entries_before: str | None = None
    no_entries_after: str | None = None
    flat_by: str | None = None
    paper: bool | None = True
    blocked: list[str] | None = None
    asm_gsm: list[str] | None = None
    at_circuit: list[str] | None = None
    intraday_only: bool | None = None
    friction_pct: float | None = None


class BarsBody(BaseModel):
    symbol: str
    chart: dict[str, Any]
    bars_60d: list[dict[str, Any]] | None = None


class ScanBody(BaseModel):
    symbols: list[str] | None = None
    universe: str = "nifty50"
    now: str | None = None
    at: str | None = None
    or_minutes: int = 15
    live: bool = False
    min_price: float = 50
    min_volume: int = 100_000


class EntryBody(BaseModel):
    symbol: str
    setup: str = "orb"
    or_minutes: int = 15
    level: float | None = None
    now: str | None = None
    min_volume_x: float | None = None


class PlanBody(BaseModel):
    symbol: str | None = None
    entry_price: float | None = None
    date: str | None = None
    setup: str | None = None
    stop: str = "or-mid"
    target: str = "1R"
    or_high: float | None = None
    or_low: float | None = None
    entry_time: str | None = None
    entry_bar: int | None = None
    flat_by: str | None = None
    opening_range: dict[str, Any] | None = None


class TimeMachineBody(BaseModel):
    replays: int = Field(2000, ge=100, le=20_000)
    seed: int = 19
    until: str | None = None


class SizeBody(BaseModel):
    limit: float | None = None
    price: float | None = None


class ApproveBody(BaseModel):
    index: int = Field(1, ge=1)
    reply: str


class FillBody(BaseModel):
    index: int = Field(1, ge=1)
    price: float | None = None


class FlattenBody(BaseModel):
    symbol: str
    price: float


class AlertsBody(BaseModel):
    rules: list[dict[str, Any]]


class NewsBody(BaseModel):
    items: list[dict[str, Any]]
    moves: dict[str, dict[str, Any]] | None = None


@router.get("")
def trade_desk(staff: Annotated[dict, Depends(require_staff)]):
    """Full Trade desk snapshot for the signed-in staff member."""
    data = _SERVICE.desk(_staff_id(staff))
    return with_meta({"data": data}, "nse", data.get("session", {}).get("now"))


@router.patch("/config")
def trade_config(
    body: ConfigPatch,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    data = _SERVICE.update_config(_staff_id(staff), body.model_dump(exclude_none=True))
    return {"success": True, "data": data}


@router.get("/universe")
def trade_universe(
    staff: Annotated[dict, Depends(require_staff)],
    kind: str = Query("nifty50"),
):
    return _SERVICE.get_universe(kind)


@router.post("/bars")
def trade_inject_bars(
    body: BarsBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    """Inject offline / fixture chart bars (and optional 60d pool for Time Machine)."""
    verify_csrf(request)
    try:
        return _SERVICE.inject_bars(_staff_id(staff), body.symbol, body.chart, body.bars_60d)
    except TradeError as e:
        raise _err(e) from e


@router.post("/scan/daily")
def trade_scan_daily(
    body: ScanBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.scan_daily(
            _staff_id(staff),
            symbols=body.symbols,
            universe=body.universe,
            now=body.now,
            live=body.live,
            min_price=body.min_price,
            min_volume=body.min_volume,
        )
    except TradeError as e:
        raise _err(e) from e


@router.post("/scan/orb")
def trade_scan_orb(
    body: ScanBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.scan_orb(
            _staff_id(staff),
            symbols=body.symbols,
            universe=body.universe,
            now=body.now,
            at=body.at,
            or_minutes=body.or_minutes,
            live=body.live,
            min_price=body.min_price,
        )
    except TradeError as e:
        raise _err(e) from e


@router.post("/entry")
def trade_entry(
    body: EntryBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.check_entry(
            _staff_id(staff),
            body.symbol,
            setup=body.setup,
            or_minutes=body.or_minutes,
            level=body.level,
            now=body.now,
            min_volume_x=body.min_volume_x,
        )
    except TradeError as e:
        raise _err(e) from e


@router.post("/plan")
def trade_plan(
    body: PlanBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.make_plan(_staff_id(staff), body.model_dump(exclude_none=True))
    except TradeError as e:
        raise _err(e) from e


@router.post("/timemachine")
def trade_timemachine(
    body: TimeMachineBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.run_timemachine(
            _staff_id(staff), replays=body.replays, seed=body.seed, until=body.until
        )
    except TradeError as e:
        raise _err(e) from e


@router.post("/size")
def trade_size(
    body: SizeBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.size_order(_staff_id(staff), limit=body.limit, price=body.price)
    except TradeError as e:
        raise _err(e) from e


@router.post("/risk")
def trade_risk(
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
    now: str | None = None,
):
    verify_csrf(request)
    try:
        return _SERVICE.check_risk(_staff_id(staff), now=now)
    except TradeError as e:
        raise _err(e) from e


@router.get("/tickets")
def trade_tickets(staff: Annotated[dict, Depends(require_staff)]):
    return _SERVICE.tickets(_staff_id(staff))


@router.post("/approve")
def trade_approve(
    body: ApproveBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return _SERVICE.approve(_staff_id(staff), body.index, body.reply)


@router.post("/fill")
def trade_fill(
    body: FillBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return _SERVICE.fill(_staff_id(staff), body.index, body.price)


@router.post("/flatten")
def trade_flatten(
    body: FlattenBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    try:
        return _SERVICE.flatten(_staff_id(staff), body.symbol, body.price)
    except TradeError as e:
        raise _err(e) from e


@router.put("/alerts")
def trade_set_alerts(
    body: AlertsBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return _SERVICE.set_alerts(_staff_id(staff), body.rules)


@router.post("/alerts/check")
def trade_check_alerts(
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
    now: str | None = None,
):
    verify_csrf(request)
    return _SERVICE.check_alerts(_staff_id(staff), now=now)


@router.post("/news")
def trade_news(
    body: NewsBody,
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return _SERVICE.ingest_news(_staff_id(staff), body.items, body.moves)


@router.post("/reset")
def trade_reset(
    request: Request,
    staff: Annotated[dict, Depends(require_staff)],
):
    verify_csrf(request)
    return {"success": True, "data": _SERVICE.reset(_staff_id(staff))}
