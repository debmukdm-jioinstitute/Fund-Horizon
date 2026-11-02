"""Shared adapter skeleton. A provider subclass declares identity (markers), asset class and its own validation; reading and
table mapping live in ingestion.py. Every adapter is ``verified = False`` until checked against REAL statements."""
from __future__ import annotations

import re
from typing import ClassVar

from app.backoffice.valuation import ingestion as ing
from app.backoffice.valuation.canonical import ExtractedStatement, ExtractionError
from app.backoffice.valuation.normalizer import finalize


class ProviderAdapter:
    id: ClassVar[str]
    label: ClassVar[str]
    asset_class: ClassVar[str]               # mutual_fund | pms
    default_asset_type: ClassVar[str | None] = None
    version: ClassVar[str] = "0.1.0-synthetic"
    verified: ClassVar[bool] = False         # True only after testing against representative real statements
    markers: ClassVar[list[tuple[str, int]]] = []  # (regex, weight)

    # ---- identification
    @classmethod
    def score(cls, text: str, filename: str = "") -> int:
        """Distinct marker hits in the statement's opening text; a marker in the file name counts too."""
        hay = text[:20000]
        s = 0
        for rx, w in cls.markers:
            if re.search(rx, hay, re.I) or re.search(rx, filename or "", re.I):
                s += w
        return s

    # ---- provider specific checks, overridden
    @classmethod
    def check(cls, st: ExtractedStatement) -> None:
        """Add provider-specific errors/warnings to ``st``."""

    # ---- extraction
    @classmethod
    def extract(cls, filename: str, data: bytes, password: str = "") -> ExtractedStatement:
        st = ExtractedStatement(provider=cls.id, asset_class=cls.asset_class, filename=filename, adapter_version=cls.version)
        kind = ing.kind_of(filename, data)
        holdings, hints, totals, flows = [], [], {}, []
        if not cls.verified:
            st.warnings.append(f"{cls.label} adapter has only been tested on synthetic samples; verify every figure against the source.")
        if kind == "pdf":
            pages = ing.read_pdf_pages(data, password)
            if ing.is_scanned(pages):
                st.needs_manual_review = True
                st.errors.append("No text layer found (scanned image?). OCR is deliberately not used for financial statements; "
                                 "request a digital statement or enter the figures manually.")
                return st
            holdings, tot, warns, hints = ing.holdings_from_text(pages)
            if not holdings and cls.asset_class == "mutual_fund":
                holdings, hints, warns2 = cls._mf_layout_fallback("\n".join(pages))
                warns += warns2
            totals.update(tot)
            st.warnings += warns
            lines = [ln for p in pages for ln in p.splitlines()]
            sc, meta, w = ing.scan_scalars(lines)
            totals.update({k: v for k, v in sc.items() if k not in totals})
            st.warnings += w
            for k in ("statement_date", "period_start", "account_no"):
                setattr(st, k, meta[k])
            cls._flows_from_text(st, lines)
        else:
            sheets = ing.read_sheets(filename, data)
            for name, rows in sheets.items():
                h, tot, warns, hh = ing.holdings_from_rows(rows, name)
                holdings += h
                hints += hh
                totals.update({k: v for k, v in tot.items() if k not in totals})
                st.warnings += warns
                f, w = ing.flows_from_rows(rows, name)
                flows += f
                st.warnings += w
                sc, meta, w = ing.scan_scalars(ing.sheet_lines(rows))
                st.warnings += w
                totals.update({k: v for k, v in sc.items() if k not in totals})
                for k in ("statement_date", "period_start", "account_no"):
                    if not getattr(st, k):
                        setattr(st, k, meta[k])
        st.holdings, st.flows, st.totals = holdings, flows or st.flows, totals
        if not holdings and not st.flows and not totals:
            st.needs_manual_review = True
            st.errors.append("No holdings, cash flows or totals could be identified; the layout may not be supported.")
        finalize(st, hints, cls.default_asset_type)
        cls.check(st)
        return st

    # ---- hooks
    @classmethod
    def _mf_layout_fallback(cls, text: str):
        """Reuse the existing units x NAV = value reader for CAS-like MF layouts without a recognisable header."""
        from app.backoffice.valuation.canonical import HoldingRec

        try:
            from app.backoffice.portfolio_screen import extract_from_layout_text

            rows, _ = extract_from_layout_text(text)
        except Exception as e:  # existing reader unavailable: say so, do not guess
            return [], [], [f"Layout fallback unavailable ({type(e).__name__})."]
        hs = [HoldingRec(security_name=r["raw_name"], isin=r.get("isin"), account_no=r.get("folio"), quantity=r.get("units"),
                         price=r.get("statement_nav"), market_value=r.get("statement_value"), source_page="text")
              for r in rows]
        return hs, [(h, "") for h in hs], ["Holdings read with the units x NAV fallback: invested amounts are not available."] if hs else []

    @classmethod
    def _flows_from_text(cls, st: ExtractedStatement, lines: list[str]) -> None:
        """Text transaction lines: '<date> <description> <amount>'. Unclassified lines are reported, not guessed."""
        rx = re.compile(r"^\s*(" + ing.DATE_RE + r")\s+(.+?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s*$")
        for n, ln in enumerate(lines, 1):
            m = rx.match(ln)
            if not m or re.search(r"\bIN[A-Z0-9]{10}\b", ln):
                continue
            dt, desc, amt = ing.parse_date(m.group(1)), m.group(2).strip(), ing.to_num(m.group(3))
            kind = ing.classify_flow(desc)
            if dt and amt:
                if kind:
                    from app.backoffice.valuation.canonical import FlowRec

                    st.flows.append(FlowRec(flow_date=dt, kind=kind, amount=round(abs(amt), 2), description=desc[:200], source_page="text", source_row=n))
                else:
                    st.warnings.append(f"line {n}: transaction '{desc[:40]}' not classified; flows may be incomplete.")


__all__ = ["ProviderAdapter", "ExtractionError"]
