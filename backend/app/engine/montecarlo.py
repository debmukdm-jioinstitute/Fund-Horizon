from __future__ import annotations
"""Vectorised Monte Carlo for goal success. Fixed seed => reproducible; common random numbers
across SIP levels => success probability is monotone non-decreasing in SIP.

Annual returns: correlated multivariate lognormal per asset class (equity, debt, gold, liquid)
by default, with optional historical bootstrap resampling.
For mean m and vol s of the simple return: sigma^2 = ln(1 + s^2/(1+m)^2), mu = ln(1+m) - sigma^2/2.
"""

import numpy as np

ASSETS = ["equity", "debt", "gold", "liquid"]


def _corr_matrix(c: dict) -> np.ndarray:
    m = np.eye(4)
    pairs = {("equity", "debt"): c["equity_debt"], ("equity", "gold"): c["equity_gold"],
             ("debt", "gold"): c["debt_gold"]}
    for (x, y), v in pairs.items():
        i, j = ASSETS.index(x), ASSETS.index(y)
        m[i, j] = m[j, i] = v
    return m


def draw_returns(
    years: int,
    mc: dict,
    method: str = "lognormal",
    historical_returns: np.ndarray | None = None,
) -> np.ndarray:
    """Simple annual returns, shape (sims, years, 4). Deterministic given mc['seed'].

    Supports 'lognormal' (default, theoretical calibrated distribution) or 'bootstrap'
    (resampling from historical return observations).
    """
    rng = np.random.default_rng(mc["seed"])

    if method == "bootstrap" and historical_returns is not None and len(historical_returns) >= 3:
        # Bootstrap: resample historical 4-asset annual returns with replacement
        idx = rng.choice(len(historical_returns), size=(mc["sims"], years), replace=True)
        return historical_returns[idx]

    # Default lognormal
    mean = np.array([mc["asset_mean"][a] for a in ASSETS])
    vol = np.array([mc["asset_vol"][a] for a in ASSETS])
    sig2 = np.log(1.0 + (vol / (1.0 + mean)) ** 2)
    mu = np.log(1.0 + mean) - sig2 / 2.0
    chol = np.linalg.cholesky(_corr_matrix(mc["correlations"]))
    z = rng.standard_normal((mc["sims"], years, 4)) @ chol.T
    return np.exp(mu + np.sqrt(sig2) * z) - 1.0


def simulate(
    mix_pct: dict[str, float],
    years: int,
    initial: float,
    sip: float,
    step_up: float,
    target: float,
    mc: dict,
    draws: np.ndarray | None = None,
    method: str = "lognormal",
    historical_returns: np.ndarray | None = None,
) -> dict:
    """Simulate a goal. Returns probability of reaching `target`, P10/P50/P90 end values and the
    year-by-year percentile fan (length years+1, including year 0)."""
    if draws is None:
        draws = draw_returns(years, mc, method=method, historical_returns=historical_returns)
    w = np.array([mix_pct.get(a, 0.0) for a in ASSETS]) / 100.0
    port = draws[:, :years, :] @ w                      # (sims, years)
    v = np.full(port.shape[0], float(initial))
    fan = [np.percentile(v, [10, 50, 90])]
    for y in range(years):
        r = port[:, y]
        rm = (1.0 + r) ** (1.0 / 12.0) - 1.0
        safe = np.where(np.abs(rm) < 1e-12, 1.0, rm)
        factor = np.where(np.abs(rm) < 1e-12, 12.0, (1.0 + rm) * r / safe)   # annuity-due, 12 pmts
        v = v * (1.0 + r) + sip * (1.0 + step_up) ** y * factor
        fan.append(np.percentile(v, [10, 50, 90]))
    p10, p50, p90 = np.percentile(v, [10, 50, 90])
    return {
        "success_prob": float(np.mean(v >= target)),
        "p10": float(p10), "p50": float(p50), "p90": float(p90),
        "fan": [{"year": i, "p10": float(f[0]), "p50": float(f[1]), "p90": float(f[2])}
                for i, f in enumerate(fan)],
    }


def sip_for_success(
    mix_pct: dict[str, float],
    years: int,
    initial: float,
    step_up: float,
    target: float,
    mc: dict,
    goal_prob: float | None = None,
    method: str = "lognormal",
    historical_returns: np.ndarray | None = None,
) -> int:
    """Smallest monthly SIP (rupees) with success >= goal_prob (default config), by bisection."""
    p = goal_prob if goal_prob is not None else mc["target_success"]
    draws = draw_returns(years, mc, method=method, historical_returns=historical_returns)

    def ok(s: float) -> bool:
        return simulate(mix_pct, years, initial, s, step_up, target, mc, draws)["success_prob"] >= p

    if ok(0.0):
        return 0
    lo, hi = 0.0, max(target / max(years * 12, 1), 1.0)
    for _ in range(60):
        if ok(hi):
            break
        lo, hi = hi, hi * 2.0
    else:
        return int(np.ceil(hi))
    while hi - lo > 1.0:
        mid = (lo + hi) / 2.0
        if ok(mid):
            hi = mid
        else:
            lo = mid
    return int(np.ceil(hi))
