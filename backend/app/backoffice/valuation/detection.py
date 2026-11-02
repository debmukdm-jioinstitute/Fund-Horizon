"""Provider detection from file content (and file name as a weak extra hint). Ambiguity -> None (manual selection)."""
from __future__ import annotations

from app.backoffice.valuation import ingestion as ing
from app.backoffice.valuation.config import DETECT_MIN_SCORE
from app.backoffice.valuation.providers import ADAPTERS


def opening_text(filename: str, data: bytes, password: str = "") -> str:
    kind = ing.kind_of(filename, data)
    if kind == "pdf":
        return "\n".join(ing.read_pdf_pages(data, password)[:2])
    rows = next(iter(ing.read_sheets(filename, data).values()), [])
    return "\n".join(ing.sheet_lines(rows[:60]))


def scores(text: str, filename: str) -> dict[str, int]:
    return {pid: a.score(text, filename) for pid, a in ADAPTERS.items()}


def detect(filename: str, data: bytes, password: str = "") -> tuple[str | None, str]:
    """(provider_id | None, note). PDF password errors propagate as ExtractionError."""
    text = opening_text(filename, data, password)
    sc = scores(text, filename)
    ranked = sorted(sc.items(), key=lambda kv: -kv[1])
    (best, bs), (_, second) = ranked[0], ranked[1]
    if bs >= DETECT_MIN_SCORE and bs > second:
        return best, f"matched markers (score {bs})"
    if bs >= DETECT_MIN_SCORE:
        return None, f"ambiguous between providers ({', '.join(f'{k}={v}' for k, v in ranked[:3])}); select manually"
    return None, "no provider marker found; select manually"
