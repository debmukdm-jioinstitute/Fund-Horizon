"""Forgiving CSV parsing for registrar (CAMS / KFin) and brokerage uploads: header aliases, Indian number
formats, and per-row errors instead of failing the whole file."""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

MAX_CSV_BYTES = 5_000_000
MAX_ROWS = 20_000


class CsvError(ValueError):
    pass


def _norm(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")


def read_csv(text: str, aliases: dict[str, tuple[str, ...]], required: tuple[str, ...]) -> list[tuple[int, dict[str, str]]]:
    """Rows as (line number, {canonical field: raw string}). Raises ``CsvError`` for an unusable file."""
    if len(text.encode("utf-8", "ignore")) > MAX_CSV_BYTES:
        raise CsvError(f"File is larger than {MAX_CSV_BYTES // 1_000_000} MB.")
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        header = next(reader)
    except StopIteration:
        raise CsvError("The file is empty.") from None
    norm = [_norm(h) for h in header]
    index: dict[str, int] = {}
    for canon, names in aliases.items():
        for n in (canon, *names):
            if n in norm:
                index[canon] = norm.index(n)
                break
    missing = [r for r in required if r not in index]
    if missing:
        raise CsvError("Missing column(s): " + ", ".join(missing) + ". Found: " + ", ".join(h.strip() for h in header if h.strip()))
    rows: list[tuple[int, dict[str, str]]] = []
    for n, raw in enumerate(reader, start=2):
        if not any(c.strip() for c in raw):
            continue
        if len(rows) >= MAX_ROWS:
            raise CsvError(f"Too many rows (limit {MAX_ROWS}).")
        rows.append((n, {k: raw[i].strip() for k, i in index.items() if i < len(raw)}))
    return rows


def parse_decimal(value: str | None) -> Decimal | None:
    """'1,23,456.78', '₹ 5,000', '(500.00)' -> Decimal; empty -> None; junk -> ValueError."""
    if value is None or not value.strip():
        return None
    v = value.strip().replace(",", "").replace("₹", "").replace("Rs.", "").replace("INR", "").strip()
    neg = v.startswith("(") and v.endswith(")")
    v = v.strip("()")
    try:
        d = Decimal(v)
    except InvalidOperation:
        raise ValueError(f"'{value}' is not a number") from None
    return -d if neg else d


def to_paise(value: Decimal) -> int:
    return int((value * 100).quantize(Decimal("1")))


_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%d-%B-%Y")


def parse_date(value: str) -> str:
    v = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"'{value}' is not a date (use YYYY-MM-DD or DD-MM-YYYY)")


def parse_month(value: str) -> str:
    """'2026-09', 'Sep-2026', 'September 2026', '01-09-2026' -> '2026-09'."""
    v = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}", v):
        date.fromisoformat(v + "-01")
        return v
    for fmt in ("%b-%Y", "%B-%Y", "%b %Y", "%B %Y", "%m/%Y", "%b-%y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    try:
        return parse_date(v)[:7]
    except ValueError:
        raise ValueError(f"'{value}' is not a month (use YYYY-MM or Sep-2026)") from None
