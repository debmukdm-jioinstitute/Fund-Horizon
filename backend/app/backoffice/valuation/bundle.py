"""Distributor 'summary report' PDFs bundle several statements (dashboard, MF summary, one factsheet per PMS, direct equity).
Split them by page so each section is validated, reconciled and stored as its own statement. Pages with no start marker
continue the previous section. Dashboard figures are provider-reported XIRRs, kept as context (``dashboard``), not a statement."""
from __future__ import annotations

import io
import re

from app.backoffice.valuation import ingestion as ing
from app.backoffice.valuation import layouts

_START = [  # (kind, regex on the page's opening text)
    ("dashboard", re.compile(r"FY ANNUAL - DASHBOARD")),
    ("mf", re.compile(r"MF Summary Report")),
    ("pms", re.compile(r"(?is)^\s*[^\n]*(?:Private Limited|Limited|LLP)[^\n]*\n\s*As of \d")),
    ("direct", re.compile(r"Script Name\s+Quantity\s+Avg Unit\s*Cost|Client Name[\s\S]{0,200}Script Name")),
]


def split(data: bytes, password: str = "") -> tuple[list[dict], dict]:
    """-> (sections, dashboard). sections: {kind, label, provider, pages, data}. Empty list = not a bundle."""
    if ing.kind_of("x.pdf", data) != "pdf":
        return [], {}
    plain = ing.read_pdf_pages(data, password, "plain")
    kinds = []
    for t in plain:
        head = t[:400]
        kinds.append(next((k for k, rx in _START if rx.search(head)), None))
    if sum(k is not None for k in kinds) < 2:
        return [], {}
    secs: list[dict] = []
    for i, k in enumerate(kinds):
        if k is None and secs:
            secs[-1]["pages"].append(i)
        elif k:
            secs.append({"kind": k, "pages": [i]})
        else:                                   # leading unmarked page: no section to join, keep it visible
            secs.append({"kind": "unknown", "pages": [i]})
    dash = layouts.dashboard([plain[p] for s in secs if s["kind"] == "dashboard" for p in s["pages"]])
    out = []
    for s in secs:
        if s["kind"] == "dashboard":
            continue
        txt = "\n".join(plain[p] for p in s["pages"])
        if s["kind"] == "pms":
            strat = (layouts.pms_summary([txt]).get("strategy") or "PMS").title()
            s["provider"], s["label"] = ("stallion" if re.search(r"(?i)stallion", txt[:300]) else "proaffluence"), strat
        else:
            s["provider"], s["label"] = "proaffluence", {"mf": "MF summary", "direct": "Direct equity"}.get(s["kind"], "Unrecognised pages")
        s["data"] = _slice(data, s["pages"], password)
        out.append(s)
    return out, dash


def _slice(data: bytes, pages: list[int], password: str) -> bytes:
    from pypdf import PdfReader, PdfWriter

    rd = PdfReader(io.BytesIO(data))
    if rd.is_encrypted:
        rd.decrypt(password or "")
    w = PdfWriter()
    for i in pages:
        w.add_page(rd.pages[i])
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()
