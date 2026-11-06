"""Fund factsheet data and official AMC factsheet pages for the mutual funds in a valuation.

Authenticity rules: a statement line is attached to an AMFI scheme only when its name tokens AND its NAV agree with exactly one
scheme (the NAV also fixes Regular vs Direct); otherwise it is reported as not matched and nothing is shown for it. Data points
come from Fund Horizon's AMFI-sourced dataset with their as-on date. AMC factsheet pages are cut from the AMC's own PDF (registry in
``providers.factsheets``); a candidate counts only if the server returned a real PDF. No figure here is estimated."""
from __future__ import annotations

import hashlib
import io
import re
import time
from datetime import date, datetime, timedelta
from typing import Any

_ABBR = {"pru": "prudential", "fin": "financial", "serv": "services", "res": "resources", "mgmt": "management", "inf": "infrastructure"}
_NOISE = {"fund", "reg", "g", "plan", "regular", "growth", "direct", "option", "and", "of", "the", "dir"}
NAV_TOL = 0.002           # statement NAV vs AMFI NAV on the same date: 0.2% (rounding of a 2-4 dp NAV)
FETCH_BUDGET_S = 40       # total time allowed for downloading AMC factsheets while building one report
MAX_NAV_AGE_DAYS = 5      # AMFI date vs statement date for a NAV comparison to be meaningful
DATA_POINTS = ("latest_nav", "latest_nav_date", "category", "aum_cr", "first_nav_date", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "cagr_3y", "cagr_5y",
               "cagr_10y", "cagr_since_inception", "vol_3y", "sharpe_3y", "max_drawdown_3y", "beta_3y", "alpha_3y")
PCT_POINTS = ("ret_", "cagr_", "vol_", "max_drawdown_", "alpha_")   # stored as fractions in the dataset; sent as percent


def tokens(name: str) -> list[str]:
    s = re.sub(r"\b(mid|multi|small|large|flexi)cap\b", r"\1 cap", name.lower().replace("&", " and "))
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return [w for w in (_ABBR.get(w, w) for w in s.split()) if w not in _NOISE]


def _pt(k: str, v: Any) -> Any:
    if v is None or v != v:
        return None
    return round(v * 100, 4) if k.startswith(PCT_POINTS) else v


def _d(s: Any) -> date | None:
    for f in ("%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(s), f).date()
        except ValueError:
            pass
    return None


def match_scheme(name: str, nav: float | None, statement_date: str | None, df, default_plan: str | None = None) -> tuple[dict | None, str]:
    """-> (dataset row | None, how). ``how`` is the evidence ('name+NAV') or the reason nothing was matched."""
    want = set(tokens(name))
    if not want:
        return None, "empty name"
    cand = df[df["tok"].map(lambda t: want <= t)]
    plan = "Regular" if re.search(r"(?i)\breg(ular)?\b", name) else "Direct" if re.search(r"(?i)\bdir(ect)?\b", name) else default_plan
    if plan and (c2 := cand[cand["plan"] == plan]).size:  # the statement states its plan, or was issued by a distributor (Regular only)
        cand = c2
    if cand.empty:
        return None, "no AMFI scheme contains every word of the statement name"
    how = "name"
    sd = _d(statement_date)
    if nav and sd and len(cand) > 1:
        fresh = cand[cand["latest_nav_date"].map(lambda x: (d := _d(x)) is not None and 0 <= (sd - d).days <= MAX_NAV_AGE_DAYS)]
        near = fresh[(fresh["latest_nav"] - nav).abs() <= NAV_TOL * nav]
        if len(near):
            cand, how = near, "name+NAV"
    if len(cand) > 1:
        extra = cand["tok"].map(lambda t: len(t - want))
        cand = cand[extra == extra.min()]
    if len(cand) != 1:
        return None, f"ambiguous: {len(cand)} AMFI schemes fit ({', '.join(cand['scheme_name'].head(3))})"
    return cand.iloc[0].to_dict(), how


def _prev_business_day(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() > 4:
        d -= timedelta(days=1)
    return d


def nav_check(nav: float | None, sd: date | None, latest: tuple[Any, float]) -> dict:
    """Statement NAV vs the dataset's latest AMFI NAV. A statement printed on day D carries the previous business day's NAV. Comparable only when the AMFI NAV date is exactly that previous business day (D's own NAV may be newer than the printed one); otherwise say why not."""
    day = _d(latest[0])
    if not nav or not sd or not day:
        return {"ok": None, "reason": "statement NAV/date or AMFI NAV date missing"}
    if day != _prev_business_day(sd):
        return {"ok": None, "reason": f"AMFI NAV is dated {day:%d-%b-%Y}, not the statement's NAV date"}
    diff = abs(latest[1] - nav) / nav
    return {"statement_nav": nav, "amfi_nav": latest[1], "amfi_date": f"{day:%d-%b-%Y}", "ok": diff <= NAV_TOL, "difference_pct": round(diff * 100, 4)}


def _frame():
    from app.data.loader import load_metrics

    df = load_metrics()
    df = df[df["option"] == "Growth"].copy()
    df["tok"] = df["scheme_name"].map(lambda n: frozenset(tokens(n)))
    return df


def fund_sheets(holdings: list[dict], statement_dates: dict[str, str | None], regular_only: set[str] | frozenset[str] = frozenset()) -> list[dict]:
    """One entry per mutual fund line in the valuation. ``holdings``: consolidated holding dicts. ``regular_only``: providers whose
    statements say they come from an AMFI-registered distributor (ARN): distributors can only sell Regular plans."""
    df = _frame()
    out = []
    for h in holdings:
        if h["asset_type"] != "mutual_fund":
            continue
        row, how = match_scheme(h["security_name"], h.get("price"), statement_dates.get(h["provider"]), df,
                                "Regular" if h["provider"] in regular_only else None)
        e: dict[str, Any] = {"security_name": h["security_name"], "provider": h["provider"], "account_no": h["account_no"],
                             "statement_nav": h.get("price"), "matched": row is not None, "match": how}
        if row:
            e.update(scheme_code=str(row["scheme_code"]), scheme_name=row["scheme_name"], amc=row["amc"], plan=row["plan"],
                     isin=row.get("isin_growth_or_payout"), source="AMFI NAV history via Fund Horizon dataset",
                     data={k: _pt(k, row.get(k)) for k in DATA_POINTS})
            e["nav_check"] = nav_check(h.get("price"), _d(statement_dates.get(h["provider"])), (row["latest_nav_date"], row["latest_nav"]))
        out.append(e)
    return out


# ------------------------------------------------------------------ AMC factsheet PDFs
def _fetch(url: str) -> bytes | None:
    import httpx

    try:
        r = httpx.get(url, timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 FundHorizon"})
    except httpx.HTTPError:
        return None
    ok = r.status_code == 200 and r.content[:5] == b"%PDF-" and len(r.content) < 80 * 2**20
    return r.content if ok else None


def amc_factsheet(amc: str, report_month: str, repo=None) -> dict | None:
    """Newest registry entry for the AMC not later than the report month, with the PDF bytes if they can be had."""
    from app.backoffice.providers.factsheets import SOURCE_BY_AMC
    from app.backoffice.repository import BackofficeRepository

    key = SOURCE_BY_AMC.get(amc)
    if not key:
        return None
    for r in (repo or BackofficeRepository()).list_factsheets(key):
        if r["period"][:7] > report_month:
            continue
        data = None
        if r.get("archived_path"):
            try:
                with open(r["archived_path"], "rb") as fh:
                    data = fh.read()
            except OSError:
                data = None
        data = data if data and data[:5] == b"%PDF-" else _fetch(r["url"])
        return {"source_key": key, "period": r["period"], "title": r["title"], "url": r["url"], "data": data,
                "sha256": hashlib.sha256(data).hexdigest() if data else None}
    return None


def page_heads(pdf: bytes) -> list[set[str]]:
    from pypdf import PdfReader

    return [set(tokens(" ".join((p.extract_text() or "").split("\n")[:6]))) for p in PdfReader(io.BytesIO(pdf)).pages]


def fund_pages(heads: list[set[str]], scheme_name: str) -> list[int]:
    """Pages of an AMC factsheet where the scheme is the subject: its distinctive name words all appear in the page's opening lines."""
    want = set(tokens(scheme_name))
    return [i for i, h in enumerate(heads) if want <= h]


def attach_pages(sheets: list[dict], report_month: str, repo=None) -> tuple[bytes | None, list[dict]]:
    """-> (merged PDF of the matched fund pages | None, evidence list). Evidence names every document and what was or was not found."""
    from pypdf import PdfReader, PdfWriter

    w, evidence, cache, heads = PdfWriter(), [], {}, {}
    deadline = time.monotonic() + FETCH_BUDGET_S                      # the report request must not outlive the tunnel timeout
    for e in sheets:
        if not e["matched"]:
            continue
        if e["amc"] not in cache:
            cache[e["amc"]] = amc_factsheet(e["amc"], report_month, repo) if time.monotonic() < deadline else "late"
        fs = cache[e["amc"]]
        if fs == "late":
            evidence.append({"scheme": e["scheme_name"], "amc": e["amc"], "status": "skipped: download time budget used up", "pages": 0})
            continue
        ev = {"scheme": e["scheme_name"], "amc": e["amc"], "status": "no official factsheet in registry", "pages": 0}
        if fs and not fs["data"]:
            ev.update(status="registry entry found but the PDF could not be downloaded", period=fs["period"], url=fs["url"])
        elif fs:
            if fs["sha256"] not in heads:
                heads[fs["sha256"]] = page_heads(fs["data"])
            pages = fund_pages(heads[fs["sha256"]], e["scheme_name"])
            rd = PdfReader(io.BytesIO(fs["data"]))
            for i in pages:
                w.add_page(rd.pages[i])
            ev.update(status="attached" if pages else "factsheet found but no page for this scheme could be identified",
                      period=fs["period"], url=fs["url"], sha256=fs["sha256"], pages=len(pages))
        evidence.append(ev)
    if not len(w.pages):
        return None, evidence
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue(), evidence
