"""Fund Horizon MCP server (Model Context Protocol, streamable HTTP, JSON responses) at ``POST /mcp``.

Design rules, in order of importance:
1. **Truth.** Every tool calls the same internal API endpoints the backoffice uses, with the caller's own identity, so numbers,
   permissions and "as on" dates are exactly what the website shows. Nothing is recomputed, defaulted or invented here.
2. **No silent cuts.** Oversized results are trimmed with an explicit ``_truncated`` notice (shown / total / how to page).
3. **Full control, deliberate writes.** ``api_catalog`` + ``api_call`` reach every API operation (read, create, update, delete: CRM,
   holdings, valuation, PMS, mutual funds, ...) with the caller's own permissions, including operations added in the future.
   Updates, deletes and irreversible actions need ``confirm=true`` and are written to an audit log with the before-state.
   Credentials (login, tokens, staff accounts) are never reachable.
4. **Own tokens.** Staff create a personal token (a long-lived session the staff member can revoke) at /backoffice/mcp.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import os
import re
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pathlib import Path
import zipfile
from pydantic import BaseModel, Field

from app.api.auth import get_current_customer, require_staff
from app.db import sqlite
from app.mcp_oauth import _db as _oauth_db, resource_metadata_url

logger = logging.getLogger("fh.mcp")
router = APIRouter(tags=["mcp"])

SERVER_INFO = {"name": "fund-horizon", "title": "Fund Horizon", "version": "1.0.0"}
PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
MAX_CHARS = 60_000          # one tool result as text
MAX_BINARY = 8_000_000      # one returned/accepted file
IST = ZoneInfo("Asia/Kolkata")

INSTRUCTIONS = """Fund Horizon is a PMS (portfolio management services) and mutual fund research and operations platform.
Rules for answering with this server:
- Report only figures returned by tools. Quote the as-on / as-of date that came with them. Never estimate, fill gaps or recall numbers from memory.
- If a value is null or a cell is empty, say it is not available and give the reason the tool returned (fund too new, not published by AMFI/APMI/Advisorkhoj, etc.).
- Advisorkhoj publishes no Direct-plan quartiles; Regular-plan only.
- Tool results marked _truncated are partial: say so, and page with limit/offset or narrow the filter before drawing conclusions.
- You have full read/write/update/delete control through the named tools and, for anything else, api_catalog (find the operation) + api_call (run it). You act with this user's own permissions.
- Before any create, update or delete: say exactly what will change and show the current values (read them first). Only after the user clearly agrees, call with confirm=true. Never confirm on your own.
- Approving a valuation is irreversible; ask twice if unsure. Deletions are recorded with the old values in the audit log (mcp_audit_log).
- This is research data, not investment advice."""


# --------------------------------------------------------------------------- tool catalogue
def _t(name, description, props=None, required=(), *, method="GET", path="", query=(), body=(), write=False, binary=False):
    schema = {"type": "object", "properties": props or {}, "required": list(required), "additionalProperties": False}
    return {"name": name, "description": description, "inputSchema": schema, "method": method, "path": path,
            "query": tuple(query), "body": tuple(body), "write": write, "binary": binary}


S = {"type": "string"}
I = {"type": "integer"}
B = {"type": "boolean"}
LIM = {"type": "integer", "minimum": 1, "maximum": 200, "description": "Rows to return (max 200)."}
OFF = {"type": "integer", "minimum": 0, "description": "Rows to skip (paging)."}
CODE = {"type": "string", "description": "AMFI scheme code, e.g. 108466."}
FILE = {"type": "string", "description": "File content, base64 encoded."}

TOOLS: list[dict[str, Any]] = [
    # ---- discovery & integrity
    _t("search", "Search funds, PMS strategies, managers, forms, households and modules by name.",
       {"q": {**S, "minLength": 2}, "scope": {**S, "description": "all (default) or a scope from list_search_scopes."}}, ["q"],
       path="/api/backoffice/search", query=("q", "scope")),
    _t("list_search_scopes", "Scopes accepted by search.", path="/api/backoffice/search/scopes"),
    _t("market_overview", "Overview dashboard data: indices, flows, headline market numbers with their as-of dates.",
       path="/api/backoffice/overview"),
    _t("data_health", "Freshness and status of every data source (AMFI, APMI, Advisorkhoj, NAV, TER...). Call this to state how current the data is.",
       path="/api/backoffice/data-health"),
    _t("daily_briefing", "The daily market briefing for an IST date (latest if omitted).", {"date": {**S, "description": "YYYY-MM-DD"}},
       path="/api/backoffice/briefing", query=("date",)),
    _t("recommended_lists", "Fund Horizon recommended mutual funds (scheme code -> name) and PMS strategies (ia_id -> name).",
       path="/api/backoffice/recommended"),
    # ---- mutual funds
    _t("mf_screener",
       "Screen mutual funds with the FH score, returns, risk, capture ratios and quartiles. Same engine as /backoffice/mutual-funds. "
       "category/plan are lists (plan: Direct, Regular). f entries are 'metric:min:max' range filters in percent. "
       "Response has a total; page with limit/offset.",
       {"category": {"type": "array", "items": S, "description": "Canonical category keys e.g. flexi_cap, multi_cap, large_cap."},
        "plan": {"type": "array", "items": {"type": "string", "enum": ["Direct", "Regular"]}},
        "search": S, "sort": {**S, "description": "Sort key, default score."}, "order": {"type": "string", "enum": ["asc", "desc"]},
        "f": {"type": "array", "items": S}, "recommended": {**B, "description": "Only FH Recommended funds."},
        "amc": {"type": "array", "items": S}, "manager": S, "quartile": {"type": "array", "items": I},
        "quartile_period": {"type": "string", "enum": ["1y", "2y", "3y", "5y"]}, "limit": LIM, "offset": OFF},
       path="/api/backoffice/mutual-funds/screener",
       query=("category", "plan", "search", "sort", "order", "f", "recommended", "amc", "manager", "quartile", "quartile_period", "limit", "offset")),
    _t("mf_research_detail", "Full research profile of one mutual fund: returns, risk ratios, holdings, manager, FH score inputs.",
       {"scheme_code": CODE}, ["scheme_code"], path="/api/backoffice/mutual-funds/{scheme_code}/research-detail"),
    _t("mf_performance", "NAV history and period performance of one mutual fund.", {"scheme_code": CODE}, ["scheme_code"],
       path="/api/backoffice/mutual-funds/{scheme_code}/performance"),
    _t("mf_peers", "Category peers of one mutual fund.", {"scheme_code": CODE, "limit": {"type": "integer", "minimum": 1, "maximum": 20}},
       ["scheme_code"], path="/api/backoffice/mutual-funds/{scheme_code}/peers", query=("limit",)),
    _t("mf_manager", "Fund manager(s) of one mutual fund.", {"scheme_code": CODE}, ["scheme_code"],
       path="/api/backoffice/mutual-funds/{scheme_code}/manager"),
    _t("mf_fh_score_breakdown", "How the FH score of one fund was built: pillars, flags and data coverage.", {"code": CODE}, ["code"],
       path="/api/backoffice/mutual-funds/{code}/fh-score-breakdown"),
    _t("mf_fh_methodology", "The FH score methodology.", path="/api/backoffice/mutual-funds/fh-score/methodology"),
    _t("mf_quartile_ranking", "Advisorkhoj quartile ranking of a category over a period (Regular plan only).",
       {"category": {**S, "description": "Advisorkhoj label, e.g. 'Equity: Flexi Cap'."}, "period": S, "plan": {"type": "string", "enum": ["Regular", "Direct"]}},
       path="/api/backoffice/mutual-funds/quartile-ranking", query=("category", "period", "plan")),
    _t("mf_quartile_annual", "Calendar-year quartile ranks (2016..YTD) of a category (Regular plan only). Empty cells mean not launched / part year / not published.",
       {"category": S, "plan": {"type": "string", "enum": ["Regular", "Direct"]}}, path="/api/backoffice/mutual-funds/quartile-annual",
       query=("category", "plan")),
    _t("mf_managers_directory", "Directory of mutual fund managers with tenure and funds managed.", {"search": S, "limit": LIM, "offset": OFF},
       path="/api/backoffice/mutual-funds/managers", query=("search", "limit", "offset")),
    _t("mf_overlap", "Portfolio overlap between two mutual funds.", {"code_a": CODE, "code_b": CODE}, ["code_a", "code_b"],
       path="/api/backoffice/mutual-funds/portfolio-overlap", query=("code_a", "code_b")),
    _t("compare", "Side-by-side comparison of 2-4 mutual funds (type=mf, scheme codes) or PMS strategies (type=pms, ia_ids).",
       {"type": {"type": "string", "enum": ["mf", "pms"]}, "ids": {**S, "description": "Comma-separated ids, 2 to 4."}}, ["type", "ids"],
       path="/api/backoffice/compare", query=("type", "ids")),
    # ---- PMS
    _t("pms_providers", "PMS providers (APMI) with strategy counts and AUM for the latest complete month.", path="/api/backoffice/pms/providers"),
    _t("pms_strategy_detail", "One PMS strategy: APMI returns history, fees, manager, inception, benchmark, FH score.", {"ia_id": {**S, "description": "APMI strategy id."}},
       ["ia_id"], path="/api/backoffice/pms/strategies/{ia_id}"),
    _t("pms_matrix", "The FH Recommended PMS matrix (returns vs benchmark by period).", path="/api/backoffice/pms/matrix"),
    _t("pms_accounts", "Client PMS accounts the caller can see.", path="/api/backoffice/pms/accounts"),
    _t("pms_account_tracker", "XIRR, cash flows and high-water-mark fee tracker for one PMS account.", {"account_id": S}, ["account_id"],
       path="/api/backoffice/pms/accounts/{account_id}/tracker"),
    # ---- risk profiling & screening of client statements
    _t("risk_questionnaire", "The risk profiling questionnaire.", path="/api/backoffice/risk-profiling/questionnaire"),
    _t("risk_evaluate", "Evaluate a risk profile. body = the answers object exactly as returned by risk_questionnaire expects.",
       {"body": {"type": "object"}}, ["body"], method="POST", path="/api/backoffice/risk-profiling/evaluate", body=("body",)),
    # ---- CRM (read + additive writes)
    _t("crm_households", "List households the caller can see.", {"limit": LIM}, path="/api/crm/households", query=("limit",)),
    _t("crm_household", "One household with members.", {"household_id": S}, ["household_id"], path="/api/crm/households/{household_id}"),
    _t("crm_create_household", "WRITE: create a household. Confirm the name with the user first.", {"name": S, "notes": S}, ["name"],
       method="POST", path="/api/crm/households", body=("name", "notes"), write=True),
    _t("crm_create_client", "WRITE: add a client (person) to a household. Returns the client with customer_id, needed to start a valuation.",
       {"household_id": S, "name": S, "email": S, "mobile": S, "dob": {**S, "description": "YYYY-MM-DD"}, "relation": S},
       ["household_id", "name"], method="POST", path="/api/crm/contacts", body=("household_id", "name", "email", "mobile", "dob", "relation"), write=True),
    # ---- monthly valuation (consolidated reports)
    _t("valuation_providers", "Statement providers supported by monthly valuation (FundsIndia, ProAffluence, Stallion).", path="/api/backoffice/valuation/providers"),
    _t("valuation_batches", "List monthly valuation batches.", {"limit": LIM}, path="/api/backoffice/valuation/batches", query=("limit",)),
    _t("valuation_create_batch", "WRITE: start a monthly valuation batch for a client (customer_id from crm_create_client or crm_household).",
       {"client_id": S, "report_month": {**S, "description": "YYYY-MM"}, "valuation_date": {**S, "description": "YYYY-MM-DD inside the month"}},
       ["client_id", "report_month", "valuation_date"], method="POST", path="/api/backoffice/valuation/batches",
       body=("client_id", "report_month", "valuation_date"), write=True),
    _t("valuation_process", "WRITE: extract holdings from the uploaded statements of a batch. passwords maps file id to PDF password when needed.",
       {"batch_id": S, "passwords": {"type": "object"}}, ["batch_id"], method="POST", path="/api/backoffice/valuation/batches/{batch_id}/process",
       body=("passwords",), write=True),
    _t("valuation_preview", "Detected files, providers, status and warnings of a batch.", {"batch_id": S}, ["batch_id"],
       path="/api/backoffice/valuation/batches/{batch_id}/preview"),
    _t("valuation_reconciliation", "Reconciliation of a batch against provider totals.", {"batch_id": S}, ["batch_id"],
       path="/api/backoffice/valuation/batches/{batch_id}/reconciliation"),
    _t("valuation_validate", "WRITE: run validation checks on a batch (blocking errors must be zero to approve).", {"batch_id": S}, ["batch_id"],
       method="POST", path="/api/backoffice/valuation/batches/{batch_id}/validate", write=True),
    _t("valuation_consolidated", "Consolidated totals and holdings across all providers of a batch.", {"batch_id": S}, ["batch_id"],
       path="/api/backoffice/valuation/batches/{batch_id}/consolidated"),
    _t("valuation_approve", "WRITE, IMMUTABLE: approve a validated batch, freeze its snapshot and generate the consolidated PDF report. "
       "Requires confirm=true after the user has reviewed the consolidated totals.",
       {"batch_id": S, "confirm": B}, ["batch_id", "confirm"], method="POST", path="/api/backoffice/valuation/batches/{batch_id}/approve",
       body=(), write=True),
    _t("valuation_report_pdf", "Download a generated consolidated valuation report (PDF) by report version id.", {"version_id": S}, ["version_id"],
       path="/api/backoffice/valuation/reports/{version_id}/download", binary=True),
    _t("valuation_client_history", "Approved valuation history of a client.", {"client_id": S}, ["client_id"],
       path="/api/backoffice/valuation/clients/{client_id}/history"),
    # ---- operations / forms
    _t("official_forms", "Catalogue of official CAMS / KFintech / AMC / PMS forms (title, url, kind).", path="/api/backoffice/operations/official-forms"),
    _t("filings_register", "Register of forms filled and filed.", path="/api/backoffice/operations/filings"),
]
BY_NAME = {t["name"]: t for t in TOOLS}

# Tools that need code, not just a route
CUSTOM = [
    {"name": "pms_strategies",
     "description": "List/filter PMS strategies from APMI (latest complete month): search, approach, provider, recommended_only, sort, paging. "
                    "Returns total, as_on and the requested page; never the whole universe at once.",
     "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
         "search": S, "provider": S, "approach": {**S, "description": "e.g. Equity, Debt, Multi Asset (matches strategy type/approach)."},
         "recommended_only": B, "sort": {"type": "string", "enum": ["aum_crore", "return_1m", "return_1y", "return_3y", "return_5y", "fh_score", "strategy_name"]},
         "order": {"type": "string", "enum": ["asc", "desc"]}, "limit": LIM, "offset": OFF}}, "write": False},
    {"name": "form_fields",
     "description": "List the fillable fields (name, type, page, position) of an official form from official_forms (url). Use before form_fill.",
     "inputSchema": {"type": "object", "additionalProperties": False, "required": ["url"], "properties": {"url": {**S, "description": "A PDF url from official_forms."}}}, "write": False},
    {"name": "form_fill",
     "description": "WRITE: fill an official form and return the PDF. values maps a field name (from form_fields) to text, or true/false for checkboxes. "
                    "Set log_filing=true to also record it in the filings register and the household timeline. Show the user the values before filing.",
     "inputSchema": {"type": "object", "additionalProperties": False, "required": ["url", "values"], "properties": {
         "url": S, "values": {"type": "object"}, "filename": S, "log_filing": B, "form_title": S, "household_id": S, "client_name": S, "folio": S}},
     "write": True},
    {"name": "portfolio_screen",
     "description": "Read a client's portfolio statement (PDF, Excel, CSV, Word, HTML, image, text) and match every holding to the FH-scored fund universe. "
                    "file_base64 is the file content. Holdings that cannot be identified are listed, never guessed.",
     "inputSchema": {"type": "object", "additionalProperties": False, "required": ["filename", "file_base64"], "properties": {
         "filename": S, "file_base64": FILE, "password": {**S, "description": "Only for encrypted PDFs."}}}, "write": False},
    {"name": "valuation_upload",
     "description": "WRITE: attach statements (PDF/XLSX/XLS/CSV) to a valuation batch, then call valuation_process. Providers are auto-detected.",
     "inputSchema": {"type": "object", "additionalProperties": False, "required": ["batch_id", "files"], "properties": {
         "batch_id": S, "files": {"type": "array", "items": {"type": "object", "required": ["filename", "file_base64"],
                                                              "properties": {"filename": S, "file_base64": FILE}}}}}, "write": True},
]
ALL_TOOLS = [{k: v for k, v in t.items() if k in ("name", "description", "inputSchema")} for t in TOOLS + CUSTOM]
WRITE_TOOLS = {t["name"] for t in TOOLS + CUSTOM if t["write"]}


# --------------------------------------------------------------------------- results
def _stamp() -> str:
    return datetime.now(IST).strftime("%d-%m-%Y %H:%M IST")


def _shrink(data: Any, limit: int = MAX_CHARS) -> tuple[Any, dict | None]:
    """Trim the largest list until the JSON fits; report exactly what was cut."""
    if len(json.dumps(data, default=str)) <= limit:
        return data, None
    lists: list[tuple[Any, Any]] = []

    def find(node: Any, depth: int = 0) -> None:
        if depth > 3:
            return
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, list) and len(v) > 1:
                    lists.append((node, k))
                elif isinstance(v, (dict, list)):
                    find(v, depth + 1)

    if isinstance(data, list):
        wrap = {"items": data}
        data = wrap
    find(data)
    if not lists:
        return {"_unfittable": "result too large; narrow the request"}, {"reason": "single object over the size limit"}
    note = {}
    for holder, key in lists:
        total = len(holder[key])
        while len(json.dumps(data, default=str)) > limit and len(holder[key]) > 1:
            holder[key] = holder[key][: max(1, len(holder[key]) // 2)]
        if len(holder[key]) < total:
            note[key] = {"shown": len(holder[key]), "total": total}
    return data, {"trimmed_lists": note, "hint": "Use limit/offset or narrower filters to see the rest; do not treat the shown rows as complete."}


def _ok(endpoint: str, data: Any, *, extra_content: list | None = None) -> dict:
    data, cut = _shrink(data)
    env: dict[str, Any] = {"source": "Fund Horizon API", "endpoint": endpoint, "retrieved_at": _stamp(), "data": data}
    if cut:
        env["_truncated"] = cut
    return {"content": [{"type": "text", "text": json.dumps(env, default=str, ensure_ascii=False)}, *(extra_content or [])], "isError": False}


def _err(msg: str) -> dict:
    return {"content": [{"type": "text", "text": msg}], "isError": True}


def _from_response(endpoint: str, r: httpx.Response, name: str) -> dict:
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail", r.text)
        except Exception:  # noqa: BLE001
            detail = r.text[:500]
        return _err(f"{name} failed ({r.status_code}): {detail}")
    ctype = r.headers.get("content-type", "")
    if "json" in ctype:
        return _ok(endpoint, r.json())
    if len(r.content) > MAX_BINARY:
        return _err("The file is larger than 8 MB.")
    cd = r.headers.get("content-disposition", "")
    fname = (re.search(r'filename="?([^";]+)', cd) or [None, f"{name}.pdf"])[1]
    res = {"type": "resource", "resource": {"uri": f"fund-horizon://files/{quote(fname)}", "mimeType": ctype.split(";")[0] or "application/octet-stream",
                                            "blob": base64.b64encode(r.content).decode()}}
    meta = {"file": fname, "bytes": len(r.content), "filing_id": r.headers.get("x-filing-id")}
    return _ok(endpoint, meta, extra_content=[res])


# --------------------------------------------------------------------------- execution
def _client(request: Request, token: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=request.app), base_url="http://fund-horizon.internal",
                             headers={"Authorization": f"Bearer {token}"}, timeout=120.0)


def _decode(b64: str) -> bytes:
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("file_base64 is not valid base64") from exc
    if len(raw) > MAX_BINARY:
        raise ValueError("file is larger than 8 MB")
    return raw


async def _run_route(c: httpx.AsyncClient, tool: dict, args: dict) -> dict:
    path = tool["path"]
    for m in re.findall(r"{(\w+)}", path):
        if not args.get(m):
            return _err(f"Missing required argument: {m}")
        path = path.replace("{" + m + "}", quote(str(args[m]), safe=""))
    if tool["name"] == "valuation_approve":
        if args.get("confirm") is not True:
            return _err("Approval is immutable. Show the user the consolidated totals and call again with confirm=true once they agree.")
        resp = await c.post(path, json={"generate_report": True})
        return _from_response(path, resp, tool["name"])
    params: list[tuple[str, str]] = []
    for k in tool["query"]:
        v = args.get(k)
        if v is None or v == "":
            continue
        for item in (v if isinstance(v, list) else [v]):
            params.append((k, str(item).lower() if isinstance(item, bool) else str(item)))
    if tool["method"] == "GET":
        resp = await c.get(path, params=params)
    else:
        body = {k: args[k] for k in tool["body"] if k in args and args[k] is not None}
        if tool["body"] == ("body",):
            body = args["body"]
        resp = await c.post(path, json=body)
    return _from_response(path, resp, tool["name"])


async def _pms_strategies(c: httpx.AsyncClient, a: dict) -> dict:
    r = await c.get("/api/backoffice/pms/strategies", params={"provider": a["provider"]} if a.get("provider") else None)
    if r.status_code >= 400:
        return _from_response("/api/backoffice/pms/strategies", r, "pms_strategies")
    j = r.json()
    rows: list[dict] = j.get("data", [])
    rec = (await c.get("/api/backoffice/recommended")).json().get("pms", {})
    for s in rows:
        s["is_fh_recommended"] = bool(s.get("is_fh_recommended") or str(s.get("ia_id")) in rec)
    q = (a.get("search") or "").lower()
    if q:
        rows = [s for s in rows if q in f"{s.get('strategy_name', '')} {s.get('provider', '')}".lower()]
    ap = (a.get("approach") or "").lower()
    if ap:
        rows = [s for s in rows if ap in f"{s.get('strategy_type', '')} {s.get('investment_approach', '')}".lower()]
    if a.get("recommended_only"):
        rows = [s for s in rows if s["is_fh_recommended"]]
    key, rev = a.get("sort") or "aum_crore", (a.get("order") or "desc") == "desc"
    have = sorted((s for s in rows if s.get(key) is not None), key=lambda s: s[key], reverse=rev)
    rows = have + [s for s in rows if s.get(key) is None]  # empty values last, never dropped
    off, lim = int(a.get("offset") or 0), min(int(a.get("limit") or 50), 200)
    return _ok("/api/backoffice/pms/strategies", {"as_on": j.get("as_on"), "source": j.get("source"), "freshness": j.get("freshness"),
                                                   "total": len(rows), "offset": off, "limit": lim, "strategies": rows[off: off + lim]})


def _widgets(pdf: bytes) -> list[dict]:
    from pypdf import PdfReader

    from app.report.pdf_fill import _full_name

    out: list[dict] = []
    rd = PdfReader(io.BytesIO(pdf))
    for n, page in enumerate(rd.pages):
        crop = page.cropbox
        for a in page.get("/Annots") or []:
            o = a.get_object()
            if o.get("/Subtype") != "/Widget":
                continue
            ft = o.get("/FT") or (o.get("/Parent").get_object().get("/FT") if o.get("/Parent") else None)
            x0, y0, x1, y1 = (float(v) for v in o["/Rect"])
            out.append({"name": _full_name(o), "type": {"/Btn": "checkbox", "/Tx": "text", "/Ch": "choice", "/Sig": "signature"}.get(str(ft), "other"),
                        "page": n, "x": round(x0 - float(crop.left), 1), "y": round(float(crop.top) - y1, 1),
                        "w": round(x1 - x0, 1), "h": round(y1 - y0, 1), "tooltip": str(o.get("/TU") or "")})
    return out


async def _form_pdf(c: httpx.AsyncClient, url: str) -> bytes | dict:
    r = await c.get("/api/backoffice/operations/official-forms/pdf", params={"url": url})
    if r.status_code >= 400:
        return _from_response("official-forms/pdf", r, "form")
    return r.content


async def _form_fields(c: httpx.AsyncClient, a: dict) -> dict:
    pdf = await _form_pdf(c, a["url"])
    if isinstance(pdf, dict):
        return pdf
    w = _widgets(pdf)
    note = None if w else "This PDF has no fillable fields. It can only be filled by placing text at coordinates; ask the user to use the Operations form editor."
    return _ok("form_fields", {"url": a["url"], "field_count": len(w), "fields": w, "note": note})


async def _form_fill(c: httpx.AsyncClient, a: dict) -> dict:
    pdf = await _form_pdf(c, a["url"])
    if isinstance(pdf, dict):
        return pdf
    fields = {f["name"]: f for f in _widgets(pdf)}
    unknown = [k for k in a["values"] if k not in fields]
    if unknown:
        return _err(f"Unknown field names (use form_fields first): {unknown[:20]}")
    edits = []
    for name, val in a["values"].items():
        f = fields[name]
        base = {"page": f["page"], "x": f["x"], "y": f["y"], "w": f["w"], "h": f["h"]}
        if f["type"] == "checkbox":
            if val is True or str(val).lower() in ("true", "yes", "on", "1"):
                edits.append({**base, "type": "check"})
        else:
            edits.append({**base, "type": "field", "text": str(val)})
    data = {"edits": json.dumps(edits), "drop_fields": json.dumps(list(a["values"])), "url": a["url"],
            "filename": a.get("filename") or "filled-form", "log_filing": str(bool(a.get("log_filing"))).lower(),
            "form_title": a.get("form_title") or "", "household_id": a.get("household_id") or "", "client_name": a.get("client_name") or "",
            "folio": a.get("folio") or ""}
    r = await c.post("/api/backoffice/operations/pdf-fill", data={k: v for k, v in data.items() if v != ""})
    return _from_response("operations/pdf-fill", r, "form_fill")


async def _portfolio_screen(c: httpx.AsyncClient, a: dict) -> dict:
    raw = _decode(a["file_base64"])
    r = await c.post("/api/backoffice/mutual-funds/portfolio-screen", files={"file": (a["filename"], raw, "application/octet-stream")},
                     data={"password": a.get("password", "")})
    return _from_response("mutual-funds/portfolio-screen", r, "portfolio_screen")


async def _valuation_upload(c: httpx.AsyncClient, a: dict) -> dict:
    files = [("files", (f["filename"], _decode(f["file_base64"]), "application/octet-stream")) for f in a["files"]]
    r = await c.post(f"/api/backoffice/valuation/batches/{quote(a['batch_id'], safe='')}/files", files=files)
    return _from_response("valuation/files", r, "valuation_upload")


CUSTOM_RUN = {"pms_strategies": _pms_strategies, "form_fields": _form_fields, "form_fill": _form_fill,
              "portfolio_screen": _portfolio_screen, "valuation_upload": _valuation_upload}


# --------------------------------------------------------------------------- generic gateway: every API operation
DENY_PREFIXES = ("/api/mcp", "/api/auth", "/mcp", "/docs", "/redoc", "/openapi", "/health", "/api/backoffice/staff")  # credentials and access control
CONFIRM_METHODS = {"PUT", "PATCH", "DELETE"}
CONFIRM_WORDS = ("approve", "discard", "remove", "delete", "purge", "reset", "revoke", "archive", "provision")
_OPS: dict[int, list[dict]] = {}


def _schema_props(spec: dict, schema: dict | None) -> dict:
    if not schema:
        return {}
    if "$ref" in schema:
        schema = spec.get("components", {}).get("schemas", {}).get(schema["$ref"].split("/")[-1], {})
    req = set(schema.get("required", []))
    return {k: {"type": v.get("type") or ("ref" if "$ref" in v else "any"), "required": k in req,
                **({"description": v["description"]} if v.get("description") else {})} for k, v in (schema.get("properties") or {}).items()}


def _operations(app) -> list[dict]:
    key = id(app)
    if key not in _OPS:
        spec = app.openapi()
        ops = []
        for path, item in spec["paths"].items():
            if path.startswith(DENY_PREFIXES):
                continue
            for method, op in item.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                content = (op.get("requestBody") or {}).get("content", {})
                ctype = next(iter(content), None)
                ops.append({
                    "method": method.upper(), "path": path, "summary": op.get("summary") or op.get("operationId", ""),
                    "description": (op.get("description") or "").strip()[:300], "tags": op.get("tags", []),
                    "params": [{"name": p["name"], "in": p["in"], "required": p.get("required", False)} for p in op.get("parameters", [])],
                    "body": _schema_props(spec, content.get(ctype, {}).get("schema")) if ctype else None,
                    "body_type": "multipart" if ctype and "multipart" in ctype else ("json" if ctype else None),
                    "rx": re.compile("^" + "".join("[^/]+" if x.startswith("{") else re.escape(x) for x in re.split(r"(\{[^}]+\})", path)) + "$"),
                })
        _OPS[key] = ops
    return _OPS[key]


def _public(op: dict) -> dict:
    return {k: v for k, v in op.items() if k != "rx" and v not in (None, [], {}, "")}


async def _api_catalog(request: Request, a: dict) -> dict:
    ops = _operations(request.app)
    q = (a.get("search") or "").lower()
    method = (a.get("method") or "").upper()
    out = [o for o in ops if (not method or o["method"] == method)
           and (not q or q in f"{o['path']} {o['summary']} {' '.join(o['tags'])} {o['description']}".lower())]
    lim, off = min(int(a.get("limit") or 40), 100), int(a.get("offset") or 0)
    return _ok("api_catalog", {"total": len(out), "offset": off, "operations": [_public(o) for o in out[off: off + lim]],
                               "how_to_use": "Call api_call with method, the concrete path (fill {params}), query/json/form/files as listed. "
                                             "PUT/PATCH/DELETE and approve/discard/remove actions need confirm=true after the user agrees."})


def _audit(user_id: str, method: str, path: str, status: int | None, args: Any, before: Any) -> None:
    try:
        conn = _db()
        conn.execute("""CREATE TABLE IF NOT EXISTS mcp_audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, customer_id TEXT NOT NULL,
                        method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER, args_json TEXT, before_json TEXT)""")
        with conn:
            conn.execute("INSERT INTO mcp_audit VALUES (?,?,?,?,?,?,?,?)",
                         (secrets.token_hex(8), datetime.now(UTC).isoformat(), user_id, method, path, status,
                          json.dumps(args, default=str)[:4000], json.dumps(before, default=str)[:20000] if before is not None else None))
        conn.close()
    except Exception:  # noqa: BLE001 - never let the log break the action's reply, but say so loudly
        logger.exception("mcp audit write failed for %s %s", method, path)


async def _api_call(c: httpx.AsyncClient, request: Request, staff: dict, a: dict) -> dict:
    method, path = str(a.get("method", "")).upper(), str(a.get("path", ""))
    if not path.startswith("/api/") or path.startswith(DENY_PREFIXES) or ".." in path:
        return _err("That path is not available through Claude (login, tokens and staff accounts are managed in Fund Horizon itself).")
    ops = _operations(request.app)
    op = next((o for o in ops if o["method"] == method and o["rx"].match(path)), None)
    if not op:
        return _err(f"No {method} operation at {path}. Use api_catalog to find the exact method and path.")
    write = method != "GET"
    risky = method in CONFIRM_METHODS or any(w in path.lower() for w in CONFIRM_WORDS)
    if risky and a.get("confirm") is not True:
        return _err(f"{method} {path} changes or removes data. Tell the user what will change (read the current values first), "
                    "and call again with confirm=true only after they clearly agree.")
    before = None
    if method in CONFIRM_METHODS and any(o["method"] == "GET" and o["rx"].match(path) for o in ops):
        g = await c.get(path)
        before = g.json() if g.status_code == 200 and "json" in g.headers.get("content-type", "") else None
    params = [(k, str(i).lower() if isinstance(i, bool) else str(i)) for k, v in (a.get("query") or {}).items() if v is not None
              for i in (v if isinstance(v, list) else [v])]
    kw: dict[str, Any] = {"params": params}
    if a.get("files") or a.get("form"):
        kw["data"] = {k: str(v) for k, v in (a.get("form") or {}).items()}
        kw["files"] = [(f["field"], (f["filename"], _decode(f["file_base64"]), "application/octet-stream")) for f in (a.get("files") or [])] or None
    elif a.get("json") is not None:
        kw["json"] = a["json"]
    resp = await c.request(method, path, **kw)
    if write:
        _audit(staff["id"], method, path, resp.status_code, {"query": a.get("query"), "json": a.get("json"), "form": a.get("form")}, before)
    return _from_response(path, resp, "api_call")


async def _audit_log(request: Request, staff: dict, a: dict) -> dict:
    conn = _db()
    try:
        rows = conn.execute("SELECT at, method, path, status, args_json, before_json FROM mcp_audit WHERE customer_id = ? ORDER BY at DESC LIMIT ?",
                            (staff["id"], min(int(a.get("limit") or 50), 200))).fetchall()
    except sqlite3.OperationalError:
        rows = []
    conn.close()
    return _ok("mcp_audit_log", {"entries": [dict(r) for r in rows], "note": "before_json holds the values as they were before an update or delete."})


CUSTOM.extend([
    {"name": "api_catalog",
     "description": "Find any Fund Horizon API operation (read, create, update, delete) by keyword: CRM, holdings, valuation, PMS, mutual funds, forms, reports. "
                    "Returns method, path, parameters and body fields. Always use this to discover an operation before api_call.",
     "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
         "search": {**S, "description": "e.g. holding, household, valuation, sip, pms"}, "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
         "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": OFF}}, "write": False},
    {"name": "api_call",
     "description": "Run any Fund Horizon API operation as the signed-in user (their permissions apply). GET reads. POST creates. PUT/PATCH update. DELETE removes. "
                    "Updates, deletes and approve/discard/remove-style actions need confirm=true, which you may set only after the user has clearly agreed "
                    "to the exact change. The previous values of updated/deleted records are saved to the audit log. Use api_catalog first.",
     "inputSchema": {"type": "object", "additionalProperties": False, "required": ["method", "path"], "properties": {
         "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]}, "path": {**S, "description": "Concrete path, e.g. /api/crm/holdings/abc123"},
         "query": {"type": "object"}, "json": {"description": "JSON body"}, "form": {"type": "object", "description": "Form fields for multipart operations"},
         "files": {"type": "array", "items": {"type": "object", "required": ["field", "filename", "file_base64"], "properties": {"field": S, "filename": S, "file_base64": FILE}}},
         "confirm": {**B, "description": "true only after explicit user agreement"}}}, "write": True},
    {"name": "mcp_audit_log",
     "description": "The caller's own recent changes made through Claude, with the values as they were before each update or delete.",
     "inputSchema": {"type": "object", "additionalProperties": False, "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 200}}}, "write": False},
])
ALL_TOOLS = [{k: v for k, v in t.items() if k in ("name", "description", "inputSchema")} for t in TOOLS + CUSTOM]
WRITE_TOOLS = {t["name"] for t in TOOLS + CUSTOM if t["write"]}


async def call_tool(request: Request, token: str, staff: dict, name: str, args: dict) -> dict:
    tool = BY_NAME.get(name)
    if not tool and name not in CUSTOM_RUN and name not in ("api_catalog", "api_call", "mcp_audit_log"):
        return _err(f"Unknown tool: {name}")
    logger.info("mcp tool=%s user=%s write=%s args=%s", name, staff.get("id"), name in WRITE_TOOLS, sorted(args))
    try:
        async with _client(request, token) as c:
            if name == "api_catalog":
                return await _api_catalog(request, args)
            if name == "api_call":
                return await _api_call(c, request, staff, args)
            if name == "mcp_audit_log":
                return await _audit_log(request, staff, args)
            if name in CUSTOM_RUN:
                return await CUSTOM_RUN[name](c, args)
            return await _run_route(c, tool, args)
    except KeyError as exc:
        return _err(f"Missing required argument: {exc.args[0]}")
    except ValueError as exc:
        return _err(str(exc))
    except Exception:  # noqa: BLE001
        logger.exception("mcp tool failed: %s", name)
        return _err(f"{name} failed unexpectedly. Nothing was changed unless the result above says so.")


# --------------------------------------------------------------------------- JSON-RPC endpoint
def _rpc_error(id_: Any, code: int, msg: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": msg}}


async def _handle(request: Request, token: str, staff: dict, msg: dict) -> dict | None:
    id_, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if id_ is None:  # notification
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        return {"jsonrpc": "2.0", "id": id_, "result": {
            "protocolVersion": asked if asked in PROTOCOLS else PROTOCOLS[0],
            "capabilities": {"tools": {"listChanged": False}}, "serverInfo": SERVER_INFO, "instructions": INSTRUCTIONS}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": id_, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": id_, "result": {"tools": ALL_TOOLS}}
    if method == "tools/call":
        name = params.get("name")
        if not isinstance(name, str):
            return _rpc_error(id_, -32602, "tools/call needs a tool name")
        return {"jsonrpc": "2.0", "id": id_, "result": await call_tool(request, token, staff, name, params.get("arguments") or {})}
    return _rpc_error(id_, -32601, f"Method not found: {method}")


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h[:7].lower() == "bearer " else None


@router.post("/mcp")
async def mcp_endpoint(request: Request):
    token = _bearer(request)
    challenge = {"WWW-Authenticate": f'Bearer realm="Fund Horizon MCP", resource_metadata="{resource_metadata_url()}"'}  # OAuth discovery for web/mobile
    unauth = JSONResponse({"error": "Sign in through OAuth, or send 'Authorization: Bearer <token>' (token from /backoffice/mcp)."}, status_code=401,
                          headers=challenge)
    if not token:
        return unauth
    try:
        staff = require_staff(get_current_customer(request))
    except HTTPException as exc:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code if exc.status_code in (401, 403) else 401,
                            headers=challenge)
    _touch(token)
    if int(request.headers.get("content-length") or 0) > 3 * MAX_BINARY:
        return JSONResponse(_rpc_error(None, -32600, "Request is larger than the 24 MB limit"), status_code=413)
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse(_rpc_error(None, -32700, "Parse error"), status_code=400)
    batch = payload if isinstance(payload, list) else [payload]
    out = [r for r in [await _handle(request, token, staff, m) for m in batch if isinstance(m, dict)] if r is not None]
    if not out:
        return Response(status_code=202)
    return JSONResponse(out if isinstance(payload, list) else out[0])


@router.get("/mcp")
def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


# --------------------------------------------------------------------------- personal tokens
def _db() -> sqlite3.Connection:
    conn = sqlite.get_default_connection()
    conn.execute("""CREATE TABLE IF NOT EXISTS mcp_tokens (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, label TEXT NOT NULL, token_sha256 TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT)""")
    return conn


def _touch(token: str) -> None:
    try:
        conn = _db()
        with conn:
            conn.execute("UPDATE mcp_tokens SET last_used_at = ? WHERE token_sha256 = ?",
                         (datetime.now(UTC).isoformat(), hashlib.sha256(token.encode()).hexdigest()))
        conn.close()
    except Exception:  # noqa: BLE001 - usage stamp is best effort
        pass


class TokenCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)
    days: int = Field(90, ge=1, le=180)


@router.post("/api/mcp/tokens", status_code=201)
def create_token(body: TokenCreate, staff: Annotated[dict, Depends(require_staff)]):
    raw = "fhm_" + secrets.token_urlsafe(32)
    sha = hashlib.sha256(raw.encode()).hexdigest()
    now = datetime.now(UTC)
    exp = (now + timedelta(days=body.days)).isoformat()
    tid = secrets.token_hex(8)
    sqlite.create_auth_session(staff["id"], sha, exp)
    conn = _db()
    with conn:
        conn.execute("INSERT INTO mcp_tokens (id, customer_id, label, token_sha256, created_at, expires_at) VALUES (?,?,?,?,?,?)",
                     (tid, staff["id"], body.label.strip(), sha, now.isoformat(), exp))
    conn.close()
    return {"id": tid, "label": body.label.strip(), "token": raw, "expires_at": exp,
            "note": "Copy the token now. It is shown once and cannot be recovered."}


@router.get("/api/mcp/tokens")
def list_tokens(staff: Annotated[dict, Depends(require_staff)]):
    conn = _db()
    rows = conn.execute("SELECT id, label, created_at, expires_at, last_used_at FROM mcp_tokens WHERE customer_id = ? ORDER BY created_at DESC",
                        (staff["id"],)).fetchall()
    conn.close()
    return {"data": [dict(r) for r in rows], "tools": len(ALL_TOOLS)}


@router.delete("/api/mcp/tokens/{token_id}", status_code=204)
def revoke_token(token_id: str, staff: Annotated[dict, Depends(require_staff)]):
    conn = _db()
    row = conn.execute("SELECT token_sha256 FROM mcp_tokens WHERE id = ? AND customer_id = ?", (token_id, staff["id"])).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Token not found.")
    sqlite.delete_auth_session(row["token_sha256"])
    with conn:
        conn.execute("DELETE FROM mcp_tokens WHERE id = ?", (token_id,))
    conn.close()
    o = _oauth_db()
    with o:
        o.execute("DELETE FROM mcp_oauth_refresh WHERE token_id = ?", (token_id,))  # a revoked phone must not refresh itself back in
    o.close()
    return Response(status_code=204)


# --------------------------------------------------------------------------- one-click Claude Desktop connector
MAX_TOKENS_PER_USER = 25


def _new_token(staff: dict, label: str, days: int) -> tuple[str, str, str]:
    conn = _db()
    n = conn.execute("SELECT COUNT(*) FROM mcp_tokens WHERE customer_id = ?", (staff["id"],)).fetchone()[0]
    if n >= MAX_TOKENS_PER_USER:
        conn.close()
        raise HTTPException(409, "You have 25 connection tokens. Revoke some you no longer use, then try again.")
    raw = "fhm_" + secrets.token_urlsafe(32)
    sha = hashlib.sha256(raw.encode()).hexdigest()
    now = datetime.now(UTC)
    exp = (now + timedelta(days=days)).isoformat()
    tid = secrets.token_hex(8)
    sqlite.create_auth_session(staff["id"], sha, exp)
    with conn:
        conn.execute("INSERT INTO mcp_tokens (id, customer_id, label, token_sha256, created_at, expires_at) VALUES (?,?,?,?,?,?)",
                     (tid, staff["id"], label.strip()[:60], sha, now.isoformat(), exp))
    conn.close()
    return tid, raw, exp


def build_connector(server_url: str, token: str, who: str) -> bytes:
    """A .mcpb file: Claude Desktop installs it on double-click. The token is baked in, so the person pastes nothing."""
    manifest = {
        "manifest_version": "0.2", "name": "fund-horizon", "display_name": "Fund Horizon", "version": "1.0.0",
        "description": f"Fund Horizon PMS, mutual fund, valuation and forms tools inside Claude. Made for {who}.",
        "author": {"name": "Fund Horizon"},
        "server": {"type": "node", "entry_point": "server/index.js",
                   "mcp_config": {"command": "node", "args": ["${__dirname}/server/index.js"],
                                  "env": {"FH_URL": server_url, "FH_TOKEN": token}}},
        "tools_generated": True,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        z.writestr("server/index.js", (Path(__file__).parent / "mcp_assets" / "server.js").read_text())
    return buf.getvalue()


class ConnectorRequest(BaseModel):
    days: int = Field(90, ge=1, le=180)


@router.post("/api/mcp/connector")
def download_connector(staff: Annotated[dict, Depends(require_staff)], body: ConnectorRequest | None = None):
    """Create a token and return the personalised one-click connector (.mcpb)."""
    days = (body.days if body else 90)
    who = staff.get("name") or "Fund Horizon staff"
    _, raw, _ = _new_token(staff, "Claude Desktop (one-click)", days)
    server_url = os.environ.get("FH_MCP_URL", "https://api.fundhorizon.website/mcp")  # fixed, never taken from the request
    return Response(build_connector(server_url, raw, who), media_type="application/octet-stream",
                    headers={"Content-Disposition": 'attachment; filename="Fund-Horizon-for-Claude.mcpb"', "Cache-Control": "no-store"})
