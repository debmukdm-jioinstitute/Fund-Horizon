"""Holdings ingestion: AMC monthly portfolio disclosures -> snapshot CSVs.

Only PUBLIC sources, never a login, never a paywall: every adapter stops
at a wall (HTTP error, bot block, login redirect) and reports the AMC as
not ingested instead of working around it. Parsers are per-AMC because
each fund house publishes its own format; a parser only accepts rows it
can read exactly (header match + numeric weight) and skips section and
subtotal rows, never guessing a holding, a weight or a sector.

Adapters in this pass:
- Motilal Oswal: per-scheme XLSX files linked from each scheme's public
  fund page (``portfolioUrl``), enumerated from the public sitemap.
  Layout: header row (Sr. No. / Name of the Instrument / ISIN /
  Industry / Quantity / Market Value / % to Net Assets), section rows
  ``(A)`` / ``(a)`` and subtotal rows. Sector is the disclosure's own
  Industry column.

NOT ingested in this pass (recorded in the run report, not silently
dropped):
- NSE TRI series: the NiftyIndices Backpage endpoint now redirects to a
  Sitefinity login page (observed 2026-10-28); see index_tri.py.
- HDFC: monthly-portfolio page returns Akamai 403 to automated fetches.
- All other AMCs: no parser has been proven against their format yet;
  their funds keep "Sector data unavailable" until one is.

The writer emits ``data/mf_holdings/manifest.json`` + chunked CSVs
(max ~120KB per file so the GitHub connector can carry them). A run
replaces the whole snapshot for its AMC only in the sense that the
manifest lists exactly the files the run wrote; other AMCs' files are
left untouched and stay listed.
"""

from __future__ import annotations

import calendar
import csv
import io
import json
import re
import time
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any, Callable

from app.backoffice.mf_holdings import normalize_scheme_name, portfolio_key

MOTILAL_BASE = "https://www.motilaloswalmf.com"
MOTILAL_SITEMAP = MOTILAL_BASE + "/sitemap.xml"
USER_AGENT = "Mozilla/5.0 FundHorizonHoldingsIngest/1.0 (monthly public disclosure ingest)"
REQUEST_SLEEP_SECONDS = 0.3
MAX_SNAPSHOT_FILE_BYTES = 120_000

_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
]

_DATE_RE = re.compile(
    r"MONTHLY PORTFOLIO STATEMENT AS ON\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})",
    re.IGNORECASE,
)
_SECTION_RE = re.compile(r"^\(([A-Za-z])\)$")
_PORTFOLIO_URL_RE = re.compile(
    r"/content/dam/motilal-mf/sheets/fund-csvs/(Month_End_Portfolio_[A-Za-z]+_\d{4})/([A-Za-z0-9]+\.xlsx)"
)
_FUND_PAGE_RE = re.compile(r"<loc>(https://www\.motilaloswalmf\.com/mutual-funds/[^<]+)</loc>")

_DEBT_KEYWORDS = (
    "debt", "debenture", "bond", "government securit", "treasury bill",
    "certificate of deposit", "commercial paper", "money market",
    "non convertible", "ncd", "g-sec",
)


def month_folder_name(year: int, month: int) -> str:
    """Motilal month folder, e.g. Month_End_Portfolio_September_2026."""
    return f"Month_End_Portfolio_{_MONTH_NAMES[month - 1]}_{year}"


def month_end_iso(year: int, month: int) -> str:
    """Last calendar day of the month, ISO format."""
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def previous_month(year: int, month: int) -> tuple[int, int]:
    """Previous calendar month (the month whose disclosure is due by the 10th)."""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _instrument_type(top_section: str, sub_section: str) -> str:
    sub = (sub_section or "").lower()
    if "treps" in sub or "reverse repo" in sub:
        return "cash"
    top = (top_section or "").lower()
    if "equity" in top:
        return "equity"
    if "mutual fund" in top:
        return "mf_units"
    if any(k in top for k in _DEBT_KEYWORDS):
        return "debt"
    return "other"


def parse_motilal_workbook(data: bytes, source_url: str) -> dict[str, Any]:
    """Parse one Motilal Oswal monthly-portfolio XLSX.

    Returns ``{"scheme_name", "as_of", "as_of_source", "holdings",
    "weight_sum", "warnings"}``. Raises ValueError when the header row
    or the scheme name cannot be found, so a changed format fails loudly
    instead of producing a half-parsed snapshot.
    """
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    header_idx = None
    for i, row in enumerate(rows[:30]):
        b = (row[1] if len(row) > 1 and isinstance(row[1], str) else "") or ""
        g = (row[6] if len(row) > 6 and isinstance(row[6], str) else "") or ""
        if b.strip() == "Name of the Instrument" and "% to Net Assets" in g:
            header_idx = i
            break
    if header_idx is None:
        raise ValueError(f"Motilal header row not found in {source_url}")
    scheme_name = None
    as_of = None
    for row in rows[:header_idx]:
        a = row[0] if row and isinstance(row[0], str) else ""
        # Active-fund sheets print the name in ALL CAPS and ETF sheets put
        # a descriptor on the second line of the same cell: match
        # case-insensitively and keep only the first line.
        first_line = a.strip().split("\n")[0].strip()
        lowered = first_line.lower()
        if (lowered.startswith("motilal oswal")
                and "asset management" not in lowered
                and "investment manager" not in lowered
                and lowered != "motilal oswal mutual fund"):
            scheme_name = first_line
        m = _DATE_RE.search(a)
        if m:
            try:
                month = _MONTH_NAMES.index(m.group(1).capitalize()) + 1
                as_of = date(int(m.group(3)), month, int(m.group(2))).isoformat()
            except ValueError:
                pass
    if scheme_name is None:
        raise ValueError(f"Motilal scheme name not found in {source_url}")
    holdings: list[dict[str, Any]] = []
    warnings: list[str] = []
    top_section = ""
    sub_section = ""
    for row in rows[header_idx + 1:]:
        if not row:
            continue
        a = row[0]
        b = (row[1] if len(row) > 1 and isinstance(row[1], str) else "") or ""
        if b.strip() == "GRAND TOTAL":
            break
        if isinstance(a, str):
            m = _SECTION_RE.match(a.strip())
            if m:
                if m.group(1).isupper():
                    top_section = b.strip()
                    sub_section = ""
                else:
                    sub_section = b.strip()
                continue
        if b.strip() in {"Sub Total", "Total"}:
            continue
        # Sr. No. is numeric for detail rows, but balance rows such as
        # "Net Receivables / (Payables)" carry no serial number — they
        # are real holdings rows (and, for arbitrage funds, most of the
        # NAV), so empty Sr. No. is accepted when the name and weight
        # are present. Digit strings are accepted the same way.
        sr_ok = (
            isinstance(a, (int, float))
            or (isinstance(a, str) and a.strip().isdigit())
            or a is None
        )
        if not sr_ok:
            continue
        weight = row[6] if len(row) > 6 else None
        if not isinstance(weight, (int, float)):
            continue
        name = b.strip()
        if not name:
            continue
        if name.lower().startswith("net receivables"):
            instrument = "cash"
        else:
            instrument = _instrument_type(top_section, sub_section)
        isin = row[2] if len(row) > 2 and isinstance(row[2], str) else None
        sector = row[3] if len(row) > 3 and isinstance(row[3], str) else None
        holdings.append({
            "name": name,
            "isin": (isin or "").strip() or None,
            "sector": (sector or "").strip() or None,
            "weight_pct": round(float(weight), 2),
            "instrument_type": instrument,
        })
    if not holdings:
        raise ValueError(f"No holding rows parsed from {source_url}")
    weight_sum = round(sum(h["weight_pct"] for h in holdings), 2)
    if not (95.0 <= weight_sum <= 105.0):
        warnings.append(f"weight sum {weight_sum} outside 95-105 for {scheme_name}")
    return {
        "scheme_name": scheme_name,
        "as_of": as_of,
        "as_of_source": "cell" if as_of else "folder",
        "holdings": holdings,
        "weight_sum": weight_sum,
        "warnings": warnings,
    }


def extract_motilal_portfolio_url(html: str, folder: str) -> str | None:
    """Full XLSX URL for ``folder`` from a Motilal scheme page, or None."""
    for found_folder, filename in _PORTFOLIO_URL_RE.findall(html):
        if found_folder == folder:
            return f"{MOTILAL_BASE}/content/dam/motilal-mf/sheets/fund-csvs/{folder}/{filename}"
    return None


def motilal_fund_pages(sitemap_xml: str) -> list[str]:
    """Scheme page URLs from the Motilal sitemap."""
    return _FUND_PAGE_RE.findall(sitemap_xml)


def default_fetcher(url: str) -> bytes:
    """Rate-limited public fetch (no login, no cookies beyond the default
    handler). Raises on HTTP errors so the caller records a wall, never
    a silent empty result."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise OSError(f"HTTP {resp.status} for {url}")
        return resp.read()


def run_motilal_ingest(
    fetcher: Callable[[str], bytes] = default_fetcher,
    dataset_rows: list[tuple[str, str]] | None = None,
    year: int | None = None,
    month: int | None = None,
    sleep_seconds: float = REQUEST_SLEEP_SECONDS,
    limit: int | None = None,
) -> dict[str, Any]:
    """Ingest Motilal Oswal month-end portfolios.

    ``dataset_rows`` is a list of (scheme_code, scheme_name) from the
    fund dataset; a disclosure maps to dataset codes only on an exact
    normalised portfolio-key match. Returns the snapshot rows plus a
    full run report (matched / unmatched / failed, never hidden).
    """
    today = date.today()
    if year is None or month is None:
        year, month = previous_month(today.year, today.month)
    folder = month_folder_name(year, month)
    fallback_as_of = month_end_iso(year, month)
    key_to_codes: dict[str, list[str]] = {}
    key_to_names: dict[str, list[str]] = {}
    for code, name in dataset_rows or []:
        key = portfolio_key(name)
        key_to_codes.setdefault(key, []).append(code)
        key_to_names.setdefault(key, []).append(name)
    report: dict[str, Any] = {
        "amc": "Motilal Oswal Mutual Fund", "folder": folder,
        "matched_schemes": [], "unmatched_disclosures": [], "failed_pages": [],
        "warnings": [], "rows": 0,
    }
    rows: list[dict[str, Any]] = []
    sitemap = fetcher(MOTILAL_SITEMAP).decode("utf-8", "ignore")
    pages = motilal_fund_pages(sitemap)
    if limit is not None:
        pages = pages[:limit]
    for page_url in pages:
        try:
            html = fetcher(page_url).decode("utf-8", "ignore")
        except Exception as exc:  # wall / outage for this page only
            report["failed_pages"].append({"page": page_url, "error": str(exc)[:200]})
            continue
        xlsx_url = extract_motilal_portfolio_url(html, folder)
        if xlsx_url is None:
            continue  # scheme has no disclosure for this month yet; not an error
        try:
            parsed = parse_motilal_workbook(fetcher(xlsx_url), xlsx_url)
        except Exception as exc:
            report["failed_pages"].append({"page": page_url, "error": str(exc)[:200]})
            continue
        key = normalize_scheme_name(parsed["scheme_name"])
        codes = key_to_codes.get(key)
        if not codes:
            report["unmatched_disclosures"].append(parsed["scheme_name"])
            continue
        as_of = parsed["as_of"] or fallback_as_of
        for code in codes:
            for h in parsed["holdings"]:
                rows.append({
                    "scheme_code": code, "holding_name": h["name"], "isin": h["isin"] or "",
                    "sector": h["sector"] or "", "weight_pct": h["weight_pct"],
                    "instrument_type": h["instrument_type"],
                })
        report["matched_schemes"].append({
            "scheme_name": parsed["scheme_name"], "scheme_codes": codes,
            "as_of": as_of, "as_of_source": parsed["as_of_source"] or ("cell" if parsed["as_of"] else "folder"),
            "source_url": xlsx_url, "holdings": len(parsed["holdings"]),
            "weight_sum": parsed["weight_sum"],
        })
        report["warnings"].extend(parsed["warnings"])
        if sleep_seconds:
            time.sleep(sleep_seconds)
    report["rows"] = len(rows)
    report["matched_scheme_count"] = len(report["matched_schemes"])
    return {"rows": rows, "report": report}


def write_snapshot(
    out_dir: Path, amc_slug: str, rows: list[dict[str, Any]],
    schemes_meta: list[dict[str, Any]], generated_at: str,
    existing_manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write chunked snapshot CSVs + a merged manifest.

    Other AMCs' entries in an existing manifest are preserved; this
    AMC's old files are replaced. Returns the new manifest.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {"generated_at": generated_at, "files": [], "schemes": {}}
    if existing_manifest:
        manifest["files"] = [f for f in existing_manifest.get("files", [])
                             if not str(f).startswith(f"{amc_slug}_")]
        manifest["schemes"] = dict(existing_manifest.get("schemes", {}))
        old_codes = {c for c, m in manifest["schemes"].items() if (m or {}).get("amc_slug") == amc_slug}
        manifest["schemes"] = {c: m for c, m in manifest["schemes"].items() if c not in old_codes}
        for stale in out_dir.glob(f"{amc_slug}_*.csv"):
            try:
                stale.unlink()
            except OSError:
                pass
    for meta in schemes_meta:
        manifest["schemes"][str(meta["scheme_code"])] = {
            "scheme_name": meta["scheme_name"], "amc": meta["amc"],
            "amc_slug": amc_slug, "as_of": meta["as_of"], "source_url": meta["source_url"],
        }
    # Chunk rows so no single file exceeds the connector-friendly size.
    header = ["scheme_code", "holding_name", "isin", "sector", "weight_pct", "instrument_type"]
    chunks: list[list[dict[str, Any]]] = [[]]
    current_bytes = 0
    for row in rows:
        line = ",".join("" if row.get(k) is None else str(row.get(k)) for k in header) + "\n"
        if chunks[-1] and current_bytes + len(line.encode("utf-8")) > MAX_SNAPSHOT_FILE_BYTES:
            chunks.append([])
            current_bytes = 0
        chunks[-1].append(row)
        current_bytes += len(line.encode("utf-8"))
    files: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        if not chunk:
            continue
        filename = f"{amc_slug}_{i}.csv"
        with (out_dir / filename).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=header)
            writer.writeheader()
            for row in chunk:
                writer.writerow({k: row.get(k, "") for k in header})
        files.append(filename)
    manifest["files"].extend(files)
    manifest["files"] = sorted(set(manifest["files"]))
    if manifest["schemes"]:
        manifest["as_of"] = max(str(m.get("as_of")) for m in manifest["schemes"].values() if m.get("as_of"))
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    return manifest
