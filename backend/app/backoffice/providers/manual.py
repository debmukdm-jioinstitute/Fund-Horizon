from __future__ import annotations
"""Manual Import Engine: Validation, Preview, Reconciliation, and Commit.

Supports:
- PMS strategies (APMI monthly returns)
- Client PMS portfolio holdings & cash flows
- Indian Index Option chains (NSE/BSE)
- FII / DII flows
- Issuer corporate fundamentals & filings

Features:
- In-memory parsing
- Formula injection defense (prevents Excel DDE/macro attacks)
- Row-level schema validation and error reporting
- Two-step preview and commit lifecycle
"""

import csv
import io
import logging
import re
from typing import Any

logger = logging.getLogger("backoffice.providers.manual")


def sanitize_cell(value: Any) -> Any:
    """Sanitize string values to defend against spreadsheet formula injection."""
    if isinstance(value, str):
        v = value.strip()
        if v.startswith(("=", "+", "-", "@", "\t", "\r")):
            try:
                float(v.replace(",", ""))  # plain signed numbers (e.g. net outflows "-1500") are safe
                return v
            except ValueError:
                return "'" + v
        return v
    return value


IMPORT_TEMPLATES: dict[str, dict[str, Any]] = {
    "pms_strategies": {
        "headers": [
            "Provider", "Strategy Name", "Approach", "Category", "Report Month",
            "AUM (Cr)", "Return 1M (%)", "Return 3M (%)", "Return 6M (%)", "Return 1Y (%)",
            "CAGR 3Y (%)", "CAGR 5Y (%)", "Benchmark Name", "Benchmark 1Y (%)"
        ],
        "example_row": [
            "ASK Investment Managers", "ASK Growth Strategy", "Equity", "Large & Mid Cap", "2026-09",
            "4500.50", "1.25", "4.80", "9.10", "18.50",
            "16.20", "15.80", "NIFTY 500", "17.10"
        ],
    },
    "pms_holdings": {
        "headers": [
            "Account ID", "Valuation Date", "Security Type", "Symbol/ISIN",
            "Security Name", "Quantity", "Cost Price", "Market Price", "Market Value"
        ],
        "example_row": [
            "pms_acc_001", "2026-10-09", "equity", "INE002A01018",
            "Reliance Industries Ltd", "250", "2850.00", "2980.50", "745125.00"
        ],
    },
    "pms_cashflows": {
        "headers": [
            "Account ID", "Flow Date", "Flow Type", "Amount", "Description"
        ],
        "example_row": [
            "pms_acc_001", "2026-01-15", "contribution", "-5000000.00", "Initial PMS funding"
        ],
    },
    "option_chain": {
        "headers": [
            "Exchange", "Underlying", "Underlying Price", "Timestamp", "Expiry Date",
            "Strike Price", "Option Type", "Lot Size", "Last Price", "OI", "OI Change", "Volume"
        ],
        "example_row": [
            "NSE", "NIFTY", "25150.00", "2026-10-09T15:30:00", "2026-10-29",
            "25200.00", "CE", "25", "145.50", "185000", "12500", "450000"
        ],
    },
    "fii_dii_flows": {
        "headers": [
            "Report Date", "Category", "Segment", "Gross Buy", "Gross Sell", "Net", "Unit", "Status"
        ],
        "example_row": [
            "2026-10-09", "FII", "equity_cash", "12500.50", "10250.25", "2250.25", "inr_crore", "final"
        ],
    },
    "issuer_fundamentals": {
        "headers": [
            "ISIN/Symbol", "Company Name", "Sector", "Fiscal Period",
            "Revenue (Cr)", "EBITDA (Cr)", "PAT (Cr)", "Total Debt (Cr)", "Cash (Cr)", "Scope"
        ],
        "example_row": [
            "INE002A01018", "Reliance Industries Ltd", "Oil & Gas / Retail", "FY26-Q1",
            "235000.00", "42000.00", "19500.00", "315000.00", "185000.00", "consolidated"
        ],
    },
    "mf_managers": {
        "headers": ["scheme_code", "manager_name", "manager_start", "source", "provenance"],
        "example_row": ["119551", "Chirag Setalvad", "2019-01-01", "manual_import", "factsheet"],
    },
    "quartile": {
        "headers": ["scheme_code", "sebi_category", "window_years", "quartile", "as_of", "source"],
        "example_row": ["119551", "mid_cap", "2", "1", "2026-10-09", "manual_import"],
    },
}


def get_template_csv(import_type: str) -> str:
    """Generate CSV string for the requested template."""
    tmpl = IMPORT_TEMPLATES.get(import_type)
    if not tmpl:
        raise ValueError(f"Unknown import type: {import_type}")
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(tmpl["headers"])
    writer.writerow(tmpl["example_row"])
    return out.getvalue()


class ManualImportValidator:
    """Validates raw CSV content against target schema and prepares preview."""

    @staticmethod
    def preview(import_type: str, csv_content: str, max_preview_rows: int = 20) -> dict[str, Any]:
        tmpl = IMPORT_TEMPLATES.get(import_type)
        if not tmpl:
            return {"valid": False, "error": f"Unsupported import type: {import_type}"}

        reader = csv.reader(io.StringIO(csv_content))
        rows = list(reader)
        if not rows:
            return {"valid": False, "error": "CSV file is empty"}

        header = [h.strip() for h in rows[0]]
        expected_headers = tmpl["headers"]

        # Validate header match (case-insensitive)
        header_map = {h.lower(): idx for idx, h in enumerate(header)}
        missing = [h for h in expected_headers if h.lower() not in header_map]
        if missing:
            return {
                "valid": False,
                "error": f"Missing required columns: {', '.join(missing)}",
                "expected_headers": expected_headers,
                "received_headers": header,
            }

        valid_rows: list[dict[str, Any]] = []
        error_rows: list[dict[str, Any]] = []

        for row_idx, r in enumerate(rows[1:], start=2):
            if not any(r):  # skip blank lines
                continue
            row_dict = {}
            for h in expected_headers:
                idx = header_map[h.lower()]
                val = r[idx].strip() if idx < len(r) else ""
                row_dict[h] = sanitize_cell(val)

            err = ManualImportValidator._validate_row(import_type, row_dict)
            if err:
                error_rows.append({"row_num": row_idx, "error": err, "data": row_dict})
            else:
                valid_rows.append(row_dict)

        return {
            "valid": len(error_rows) == 0,
            "import_type": import_type,
            "total_rows": len(rows) - 1,
            "valid_count": len(valid_rows),
            "error_count": len(error_rows),
            "preview_rows": valid_rows[:max_preview_rows],
            "errors": error_rows[:50],
        }

    @staticmethod
    def _validate_row(import_type: str, row: dict[str, Any]) -> str | None:
        try:
            if import_type == "pms_strategies":
                if not row.get("Provider") or not row.get("Strategy Name"):
                    return "Provider and Strategy Name are required"
                m = row.get("Report Month", "")
                if not re.match(r"^\d{4}-\d{2}$", m):
                    return f"Report Month must be YYYY-MM, got '{m}'"

            elif import_type == "pms_holdings":
                if not row.get("Account ID") or not row.get("Symbol/ISIN"):
                    return "Account ID and Symbol/ISIN are required"
                float(row.get("Quantity", 0))
                float(row.get("Market Value", 0))

            elif import_type == "pms_cashflows":
                if not row.get("Account ID"):
                    return "Account ID is required"
                float(row.get("Amount", 0))
                d = row.get("Flow Date", "")
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                    return f"Flow Date must be YYYY-MM-DD, got '{d}'"

            elif import_type == "option_chain":
                if not row.get("Underlying"):
                    return "Underlying symbol is required"
                float(row.get("Strike Price", 0))
                opt_type = row.get("Option Type", "").upper()
                if opt_type not in ("CE", "PE"):
                    return f"Option Type must be CE or PE, got '{opt_type}'"
                int(row.get("OI", 0))
                int(row.get("Volume", 0))

            elif import_type == "fii_dii_flows":
                cat = row.get("Category", "").upper()
                if cat not in ("FII", "DII", "FPI"):
                    return f"Category must be FII, DII, or FPI, got '{cat}'"
                float(row.get("Gross Buy", 0))
                float(row.get("Gross Sell", 0))
                float(row.get("Net", 0))

            elif import_type == "issuer_fundamentals":
                if not row.get("ISIN/Symbol"):
                    return "ISIN/Symbol is required"

            elif import_type == "mf_managers":
                if not row.get("scheme_code") or not row.get("manager_name"):
                    return "scheme_code and manager_name are required"
                start = row.get("manager_start")
                if start and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(start).strip()):
                    return f"manager_start must be YYYY-MM-DD, got '{start}'"

            elif import_type == "quartile":
                if not row.get("scheme_code"):
                    return "scheme_code is required"
                q = row.get("quartile")
                try:
                    q_int = int(q)
                    if not (1 <= q_int <= 4):
                        return f"quartile must be between 1 and 4, got '{q}'"
                except (ValueError, TypeError):
                    return f"quartile must be an integer (1-4), got '{q}'"
                as_of = row.get("as_of", "")
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(as_of).strip()):
                    return f"as_of must be YYYY-MM-DD, got '{as_of}'"

            return None
        except ValueError as e:
            return f"Invalid numeric field: {e}"
