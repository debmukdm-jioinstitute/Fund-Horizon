from __future__ import annotations
"""JSON-safe conversion: numpy scalars -> python, NaN/inf -> None."""

import math
from typing import Any

try:
    import numpy as np
    _NP_GENERIC: tuple[type, ...] = (np.generic,)
except ImportError:
    _NP_GENERIC = ()


def clean(o: Any) -> Any:
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if _NP_GENERIC and isinstance(o, _NP_GENERIC):
        o = o.item()
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    return o


def plan_payload(
    plan_id: str,
    result: dict,
    *,
    created_at: str | None = None,
    expires_at: str | None = None,
) -> dict:
    """Public plan envelope: engine result plus retention metadata."""
    payload = {"id": plan_id, **result}
    if created_at is not None:
        payload["created_at"] = created_at
    if expires_at is not None:
        payload["expires_at"] = expires_at
    return payload
