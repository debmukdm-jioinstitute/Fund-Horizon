"""Holdings snapshot loader for MF Research.

The snapshot is a set of committed CSVs under ``data/mf_holdings/`` plus a
``manifest.json`` naming them (see ``backend/scripts/ingest_holdings.py``,
which builds them from AMC monthly portfolio disclosures). The backend
reads them at request time — the same pattern as the manager seed CSV and
the manager-profiles JSON — so a refreshed snapshot ships with the normal
code deploy and no database write is needed on the request path.

Snapshot CSV columns (one row per holding, per scheme code):
``scheme_code, holding_name, isin, sector, weight_pct, instrument_type``.
``instrument_type`` is ``equity`` / ``debt`` / ``mf_units`` / ``cash`` /
``other`` as published in the disclosure's own section headings. Sector
is the disclosure's own Industry column, never inferred from a name.
Cash rows (TREPS, net receivables) carry an empty sector and land in the
aggregation's "Unclassified" share, exactly as the published sector
summary does.

A scheme's Regular and Direct plan rows share one portfolio, so the
ingester writes the same holdings under both scheme codes; the loader
does not guess that mapping itself.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

_MANIFEST_CACHE: dict[str, Any] = {}


def holdings_dir(data_dir: Path | None = None) -> Path:
    """Directory holding the snapshot CSVs and manifest.

    The committed snapshot lives at ``data/mf_holdings/`` (a sibling of
    the dataset directory), NOT inside the dataset directory: the
    loader's ``data_dir()`` points at ``data/fundhorizon_mf_rag_dataset``,
    so appending ``mf_holdings`` to it would look in the wrong place.
    An explicit ``data_dir`` (tests, CLI) keeps the old meaning: the
    snapshot sits directly under it.
    """
    if data_dir is not None:
        return Path(data_dir) / "mf_holdings"
    from app.data.loader import data_dir as _data_dir

    base = _data_dir()
    if base.name == "fundhorizon_mf_rag_dataset":
        base = base.parent
    return base / "mf_holdings"


def _read_manifest(directory: Path) -> dict[str, Any] | None:
    manifest_path = directory / "manifest.json"
    try:
        raw = manifest_path.read_text()
    except OSError:
        return None
    try:
        manifest = json.loads(raw)
    except ValueError:
        return None
    return manifest if isinstance(manifest, dict) else None


def load_snapshot(data_dir: Path | None = None) -> dict[str, Any]:
    """Load the holdings snapshot.

    Returns ``{"schemes": {code: {...}}, "sectors": [...], "as_of": str|None,
    "amcs": [...], "generated_at": str|None}``. Empty schemes (with the
    manifest's reason when present) when no snapshot is on file, so
    callers always render the honest unavailable state instead of failing.
    Results are cached per manifest mtime; pass a fresh ``data_dir`` in
    tests and call :func:`clear_snapshot_cache` between cases.
    """
    directory = holdings_dir(data_dir)
    manifest = _read_manifest(directory)
    if manifest is None:
        return {"schemes": {}, "sectors": [], "as_of": None, "amcs": [],
                "generated_at": None, "reason": "No portfolio holdings snapshot on file."}
    cache_key = str(directory)
    mtime = None
    try:
        mtime = (directory / "manifest.json").stat().st_mtime
    except OSError:
        pass
    cached = _MANIFEST_CACHE.get(cache_key)
    if cached is not None and cached.get("mtime") == mtime:
        return cached["snapshot"]
    schemes: dict[str, Any] = {}
    meta = manifest.get("schemes") or {}
    for entry in manifest.get("files") or []:
        path = directory / str(entry)
        try:
            handle = path.open(newline="", encoding="utf-8")
        except OSError:
            continue
        with handle:
            for row in csv.DictReader(handle):
                code = (row.get("scheme_code") or "").strip()
                if not code:
                    continue
                if path.name.startswith("advisorkhoj_") and (meta.get(code) or {}).get("amc_slug") != "advisorkhoj":
                    continue  # a full AMC disclosure now owns this fund; the equity-only fallback rows are stale
                try:
                    weight = float(row.get("weight_pct") or "")
                except (TypeError, ValueError):
                    continue
                holding = {
                    "name": (row.get("holding_name") or "").strip(),
                    "isin": (row.get("isin") or "").strip() or None,
                    "sector": (row.get("sector") or "").strip() or None,
                    "weight_pct": round(weight, 2),
                    "instrument_type": (row.get("instrument_type") or "other").strip() or "other",
                }
                if holding["instrument_type"] != "equity":
                    holding["sector"] = None  # debt rows carry a credit rating (CRISIL AAA...) in that column, not an industry
                schemes.setdefault(code, {"holdings": []})["holdings"].append(holding)
    canon = _sector_canon({h["sector"] for sc in schemes.values() for h in sc["holdings"] if h.get("sector")})
    for sc in schemes.values():
        for h in sc["holdings"]:
            if h.get("sector"):
                h["sector"] = canon[h["sector"]]
    sectors: set[str] = set()
    amcs: set[str] = set()
    as_of_values: set[str] = set()
    for code, scheme in schemes.items():
        info = meta.get(code) or {}
        scheme["scheme_name"] = info.get("scheme_name")
        scheme["amc"] = info.get("amc")
        scheme["as_of"] = info.get("as_of")
        scheme["source_url"] = info.get("source_url")
        scheme["coverage_pct"] = info.get("coverage_pct")  # set when only part of the NAV is listed (equity-only sources)
        scheme["note"] = info.get("note")
        scheme["holdings"].sort(key=lambda h: -(h["weight_pct"] or 0))
        if info.get("amc"):
            amcs.add(str(info["amc"]))
        if info.get("as_of"):
            as_of_values.add(str(info["as_of"]))
        for h in scheme["holdings"]:
            if h.get("sector"):
                sectors.add(str(h["sector"]))
    snapshot = {
        "schemes": schemes,
        "sectors": sorted(sectors),
        "as_of": max(as_of_values) if as_of_values else manifest.get("as_of"),
        "amcs": sorted(amcs),
        "generated_at": manifest.get("generated_at"),
    }
    _MANIFEST_CACHE[cache_key] = {"mtime": mtime, "snapshot": snapshot}
    return snapshot


def _sector_key(s: str) -> str:
    return "".join(ch for ch in s.lower().replace("&", "and") if ch.isalnum())


def _sector_canon(labels: set[str]) -> dict[str, str]:
    """AMCs spell the same industry differently ("&" vs "and", truncated labels): map each to one display label.

    Same label after folding "&"/punctuation/case -> most common spelling's longest form; a label that is only a
    truncated prefix of exactly one longer label (>= 12 chars) joins that label. Nothing else is merged.
    """
    groups: dict[str, list[str]] = {}
    for lab in sorted(labels):
        groups.setdefault(_sector_key(lab), []).append(lab)
    keys = sorted(groups)
    target = {k: k for k in keys}
    for k in keys:
        longer = [o for o in keys if o != k and o.startswith(k) and len(k) >= 12]
        if len(longer) == 1:
            target[k] = longer[0]
    display = {k: max(v, key=lambda x: (not x.isupper(), "and" in x.lower(), len(x))) for k, v in groups.items()}
    return {lab: display[target[k]] for k, labs in groups.items() for lab in labs}


def clear_snapshot_cache() -> None:
    """Test helper: drop the cached snapshot so a rewritten fixture reloads."""
    _MANIFEST_CACHE.clear()


def holdings_for_scheme(snapshot: dict[str, Any], scheme_code: str) -> dict[str, Any] | None:
    """One scheme's snapshot entry, or None when the scheme is not covered."""
    entry = (snapshot.get("schemes") or {}).get(str(scheme_code))
    return entry


def schemes_with_sector(snapshot: dict[str, Any], sector: str) -> set[str]:
    """Scheme codes holding at least one non-cash row in ``sector``."""
    wanted = (sector or "").strip().lower()
    out: set[str] = set()
    for code, scheme in (snapshot.get("schemes") or {}).items():
        for h in scheme.get("holdings") or []:
            if h.get("instrument_type") == "cash":
                continue
            if (h.get("sector") or "").strip().lower() == wanted and (h.get("weight_pct") or 0) > 0:
                out.add(code)
                break
    return out


def overlap_holdings(snapshot: dict[str, Any], scheme_code: str) -> list[dict[str, Any]]:
    """Holdings usable for fund-vs-fund overlap: cash rows excluded, since
    every fund holds TREPS / net receivables and sharing them is not a
    real portfolio overlap."""
    entry = holdings_for_scheme(snapshot, scheme_code)
    if not entry:
        return []
    return [h for h in entry.get("holdings") or [] if h.get("instrument_type") != "cash"]


# ---------------------------------------------------------------------------
# Scheme-name matching (ingester side, kept here so tests cover one place)
# ---------------------------------------------------------------------------

_PLAN_SUFFIXES = (
    " - direct plan - growth", " - regular plan - growth",
    " - direct plan - idcw", " - regular plan - idcw",
    " - direct plan", " - regular plan",
    " - growth option", " - idcw option", " - dividend option",
)


def normalize_scheme_name(name: str | None) -> str:
    """Lowercase, punctuation- and space-free scheme name for matching.

    Only normalisation: no fuzzy matching, no guessing. Two names match
    only when their normalised forms are identical. Spaces are removed
    (not just collapsed) so "Flexicap" and "Flexi Cap" — the same scheme
    spelled with and without a space in different sources — match, while
    any other wording difference still fails to match.
    """
    if not name:
        return ""
    key = name.strip().lower()
    for suffix in _PLAN_SUFFIXES:
        if key.endswith(suffix):
            key = key[: -len(suffix)]
            break
    key = key.replace("&", " and ")
    return "".join(ch for ch in key if ch.isalnum())


def portfolio_key(dataset_scheme_name: str) -> str:
    """Dataset scheme name minus its plan/option suffix: the key shared
    by a scheme's Regular and Direct rows (one portfolio)."""
    return normalize_scheme_name(dataset_scheme_name)


def match_disclosure_scheme(
    disclosure_name: str, dataset_names: list[str]
) -> list[str]:
    """Dataset scheme names (full rows, both plans) whose portfolio key
    exactly matches the disclosure scheme name. Empty when nothing
    matches exactly; callers must never fuzzy-match the remainder.
    Returns the matching dataset names, not codes — the ingester maps
    those to scheme codes from the dataset frame itself.
    """
    wanted = normalize_scheme_name(disclosure_name)
    if not wanted:
        return []
    return [n for n in dataset_names if portfolio_key(n) == wanted]
