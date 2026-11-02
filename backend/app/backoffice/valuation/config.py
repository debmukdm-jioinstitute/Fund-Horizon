"""Tolerances and limits. Override with env vars (FH_VAL_*) without a code change."""
from __future__ import annotations

import os
from pathlib import Path


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


ABS_TOL = _f("FH_VAL_ABS_TOL", 1.00)           # rupees: totals / cash differences at or below this pass
REL_TOL = _f("FH_VAL_REL_TOL", 0.0005)         # 0.05% of the larger figure also passes (rounding in provider reports)
ROW_TOL = _f("FH_VAL_ROW_TOL", 0.5)            # rupees: qty x price vs row value
ROW_REL_TOL = _f("FH_VAL_ROW_REL_TOL", 0.002)  # 0.2%: price shown rounded to 2-4 dp
MOM_THRESHOLD = _f("FH_VAL_MOM_THRESHOLD", 0.15)  # unexplained month-on-month move that raises a warning
DATE_GAP_DAYS = int(_f("FH_VAL_DATE_GAP_DAYS", 3))  # valuation-date spread across providers before a warning
MAX_FILES = 20
MAX_BYTES = 15 * 1024 * 1024
DETECT_MIN_SCORE = 2  # marker hits needed to auto-assign a provider


def private_dir() -> Path:
    """Server-side storage outside any web root: next to the SQLite file (the persistent /srv/data volume in Docker)."""
    from app.db import sqlite

    base = os.environ.get("FH_VAL_STORE") or str(sqlite.db_path().parent / "valuation_private")
    p = Path(base)
    p.mkdir(parents=True, exist_ok=True)
    try:
        p.chmod(0o700)
    except OSError:
        pass
    return p
