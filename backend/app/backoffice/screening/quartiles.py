"""Quartile ranking and cascade resolution for mutual fund schemes."""
from __future__ import annotations

import math

import pandas as pd


def rank_to_quartile(rank: float, n: int) -> int:
    """Map a 1-based rank (ties averaged) to quartile 1..4."""
    if n < 1:
        return 4
    # rank ranges from 1 to n.
    # rank - 1 ranges from 0 to n - 1.
    val = (rank - 1.0) / float(n) * 4.0
    q = int(val) + 1
    return min(4, max(1, q))


def compute_category_quartiles(
    scheme_returns: dict[str, float | None],
    min_peers: int = 8,
) -> dict[str, int | None]:
    """Rank schemes descending by return and compute quartiles 1..4.

    If valid peer count < min_peers, returns None for all schemes (unavailable).
    """
    valid = {k: v for k, v in scheme_returns.items() if v is not None and not math.isnan(v)}
    n = len(valid)
    if n < min_peers:
        return {k: None for k in scheme_returns}

    s = pd.Series(valid)
    # rank descending so largest return gets rank 1
    ranks = s.rank(ascending=False, method="average")
    out: dict[str, int | None] = {}
    for k in scheme_returns:
        if k in ranks:
            out[k] = rank_to_quartile(float(ranks[k]), n)
        else:
            out[k] = None
    return out


def resolve_quartile_cascade(
    scheme_code: str,
    computed_q: int | None,
    external_q: int | None = None,
    external_source: str | None = None,
) -> tuple[int | None, str]:
    """Quartile cascade: external (Advisorkhoj / manual) -> computed -> unavailable."""
    if external_q is not None and 1 <= external_q <= 4:
        source = external_source or "advisorkhoj"
        return external_q, source
    if computed_q is not None:
        return computed_q, "computed_nav"
    return None, "unavailable"
