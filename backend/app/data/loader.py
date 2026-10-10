"""Dataset loader: loads metrics once, normalises categories, serves NAV series on demand."""
from __future__ import annotations

import os
from datetime import date
from functools import lru_cache
from pathlib import Path

import pandas as pd

from app.config import load_assumptions
from app.data.categories import needs_demat, normalise_category

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "fundhorizon_mf_rag_dataset"


def data_dir() -> Path:
    return Path(os.environ.get("FH_DATA_DIR", DEFAULT_DATA_DIR))


@lru_cache(maxsize=1)
def load_metrics() -> pd.DataFrame:
    """All schemes with canonical `cat` and `needs_demat` columns. Cached for process life."""
    df = pd.read_csv(data_dir() / "all_schemes_metrics.csv", dtype={"scheme_code": str})
    df["cat"] = [normalise_category(c, n) for c, n in zip(df["category"], df["scheme_name"])]
    df["needs_demat"] = [
        needs_demat(c, n) if k == "gold" else False
        for c, n, k in zip(df["category"], df["scheme_name"], df["cat"])
    ]
    return df


def eligible_funds(df: pd.DataFrame | None = None, asof: str | None = None) -> pd.DataFrame:
    """Funds eligible for any shortlist.

    Regular + Growth, clean data, open-ended, not stale (last NAV within stale_days of asof).
    # EXTENSION: add AUM / TER filters here once those columns exist in the dataset.
    """
    a = load_assumptions()
    base = load_metrics() if df is None else df
    asof_d = pd.Timestamp(asof or a["data_asof"])
    last = pd.to_datetime(base["last_nav_date"])
    ok = (
        (base["plan"] == "Regular")
        & (base["option"] == "Growth")
        & base["data_quality"].isin(["ok", "split_adjusted"])
        & (base["structure"] == "Open Ended")
        & (last >= asof_d - pd.Timedelta(days=a["stale_days"]))
    )
    return base[ok].copy()


def asof_date() -> date:
    return date.fromisoformat(load_assumptions()["data_asof"])


@lru_cache(maxsize=512)
def load_nav(scheme_code: str) -> pd.Series:
    """Month-end NAV series (index = Timestamp) for a scheme."""
    p = data_dir() / "nav_monthly" / f"{scheme_code}.csv"
    s = pd.read_csv(p, parse_dates=["date"]).set_index("date")["nav"].astype(float)
    return s.sort_index()
