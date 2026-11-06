from __future__ import annotations
"""Backoffice > Mutual funds > Investment proposal (lumpsum, SIP, STP, SWP, lumpsum + SIP): suggest a split, build the full proposal, download it as PDF."""

import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me
from app.backoffice import investment_proposal as ip

router = APIRouter(prefix="/api/backoffice/investment-proposal", tags=["investment-proposal"])


class Suggest(BaseModel):
    mode: str = Field(default="lumpsum", pattern="^(" + "|".join(ip.MODES) + ")$")
    amount: float = Field(default=0, ge=0, le=1e11)
    sip: float = Field(default=0, ge=0, le=1e9)
    years: float = Field(gt=0, le=50)
    risk: str
    plan: str = Field(default="Regular", pattern="^(Regular|Direct)$")


class Row(BaseModel):
    code: str = Field(pattern=r"^\d{4,8}$")
    amount: float = Field(default=0, ge=0, le=1e11)
    sip: float = Field(default=0, ge=0, le=1e9)
    exp_ret: float = Field(ge=-50, le=100)


class Build(BaseModel):
    years: float = Field(gt=0, le=50)
    rows: list[Row] = Field(min_length=1, max_length=30)
    amount: float | None = Field(default=None, gt=0, le=1e11)
    client: str = Field(default="", max_length=120)
    risk: str = Field(default="", max_length=40)
    purpose: str = Field(default="", max_length=300)
    cover: bool = True
    mode: str = Field(default="lumpsum", pattern="^(" + "|".join(ip.MODES) + ")$")
    sip: float | None = Field(default=None, ge=0, le=1e9)
    withdraw: float = Field(default=0, ge=0, le=1e11)
    source: str | None = Field(default=None, pattern=r"^\d{4,8}$")


def _inputs():
    from app.api.backoffice import _fh_frame, _holdings_snapshot
    return _fh_frame(), _holdings_snapshot()


def _run(fn):
    try:
        return fn()
    except ip.ProposalError as e:
        raise HTTPException(422, str(e)) from None


@router.get("/options")
def options(me: Me):
    return {"risks": ip.RISKS, "min_amount": ip.MIN_AMOUNT, "min_sip": ip.MIN_SIP, "modes": ip.MODES}


@router.post("/suggest")
def suggest(b: Suggest, me: Me):
    frame, _ = _inputs()
    rows = _run(lambda: ip.suggest(frame, b.amount, b.years, b.risk, b.plan, b.mode, b.sip))
    return {"rows": rows, "source": _run(lambda: ip.source_fund(frame, b.plan)) if b.mode == "stp" else None}


@router.get("/scheme/{code}")
def scheme(code: str, me: Me):
    if not re.fullmatch(r"\d{4,8}", code):
        raise HTTPException(422, "Scheme code must be 4 to 8 digits.")
    frame, _ = _inputs()
    return _run(lambda: ip.lookup(frame, code))


def _build(b: Build) -> dict:
    frame, snap = _inputs()
    return _run(lambda: ip.build(frame, snap, b.years, [r.model_dump() for r in b.rows], b.amount, b.mode, b.sip, b.withdraw, b.source))


@router.post("/result")
def result(b: Build, me: Me):
    return _build(b)


@router.post("/pdf")
def pdf(b: Build, me: Me):
    from app.report.investment_proposal import build_pdf
    name = re.sub(r"[^\w.\- ]", "_", f"Investment Proposal - {b.client or 'Client'}")[:100] + ".pdf"
    ascii_name = name.encode("ascii", "replace").decode().replace("?", "_")  # header values must be latin-1; keep the real name in filename*
    return Response(build_pdf(_build(b), b.client, b.risk, b.purpose, b.cover), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"})
