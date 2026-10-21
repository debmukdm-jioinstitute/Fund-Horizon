from __future__ import annotations
"""Band allocation, goal glide path and category mapping. All pure; config in allocation.yaml.

Allocations are dicts of canonical category key -> percent (sum = 100).
"""

from app.config import load_allocation


def band_by_name(name: str) -> dict:
    for b in load_allocation()["bands"]:
        if b["name"] == name:
            return b
    raise KeyError(name)


def equity_cap(years: float) -> float:
    """Horizon cap on equity %: <3y 0; 3-5y 30; 5-7y 50; 7-10y 70; >=10y none."""
    for row in load_allocation()["horizon_equity_cap"]:
        if years < row["lt_years"]:
            return float(row["cap"])
    return 100.0


def asset_mix_for_goal(band_name: str, years: float) -> dict[str, float]:
    """Equity/debt/gold/liquid % for a goal.

    equity = min(band equity, horizon cap); the cut equity goes to the classes in
    `freed_equity_targets` (default debt/liquid) in the band's own proportions. Goals < 3y: equity 0, gold 0, 50% liquid / 50% debt (short duration).
    """
    b = band_by_name(band_name)
    cfg = load_allocation()
    if years < 3:
        s = cfg["short_goal_split"]
        return {"equity": 0.0, "debt": float(s["short_duration"]), "gold": 0.0, "liquid": float(s["liquid"])}
    eq = min(float(b["equity"]), equity_cap(years))
    freed = b["equity"] - eq
    targets = cfg["freed_equity_targets"]
    rest = sum(b[t] for t in targets)
    mix = {"equity": eq, "debt": float(b["debt"]), "gold": float(b["gold"]), "liquid": float(b["liquid"])}
    for t in targets:
        mix[t] += freed * b[t] / rest
    return mix


def goal_allocation(band_name: str, years: float) -> dict[str, float]:
    """Category-level allocation (%) for a goal of the given horizon."""
    cfg = load_allocation()
    mix = asset_mix_for_goal(band_name, years)
    out: dict[str, float] = {}
    if years < 3:
        s = cfg["short_goal_split"]
        out[cfg["liquid_category"]] = float(s["liquid"])
        out["short_duration"] = float(s["short_duration"])
        return out
    for cat, pct in cfg["equity_split"][band_name].items():
        if pct:
            out[cat] = mix["equity"] * pct / 100.0
    for cat, pct in cfg["debt_split"].items():
        out[cat] = out.get(cat, 0.0) + mix["debt"] * pct / 100.0
    if mix["gold"]:
        out[cfg["gold_category"]] = mix["gold"]
    if mix["liquid"]:
        out[cfg["liquid_category"]] = out.get(cfg["liquid_category"], 0.0) + mix["liquid"]
    return {k: v for k, v in out.items() if v > 0}


def to_asset_classes(cat_alloc: dict[str, float]) -> dict[str, float]:
    """Collapse a category allocation to equity/debt/gold/liquid %."""
    amap = load_allocation()["asset_class"]
    out = {"equity": 0.0, "debt": 0.0, "gold": 0.0, "liquid": 0.0}
    for cat, pct in cat_alloc.items():
        out[amap[cat]] += pct
    return out


def weighted_allocation(items: list[tuple[dict[str, float], float]]) -> dict[str, float]:
    """Weighted average of category allocations; weights need not be normalised."""
    total = sum(w for _, w in items)
    out: dict[str, float] = {}
    if total <= 0:
        raise ValueError("Total weight must be positive")
    for alloc, w in items:
        for cat, pct in alloc.items():
            out[cat] = out.get(cat, 0.0) + pct * w / total
    return out
