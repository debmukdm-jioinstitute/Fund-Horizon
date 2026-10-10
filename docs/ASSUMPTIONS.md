# Assumptions for owner review

All values live in `backend/app/config/assumptions.yaml` unless noted. Changing a file takes effect on
the next API restart. A single plan can also override any value via `assumption_overrides` in the
`POST /api/plans` body.

## Returns and inflation
| Assumption | Default | Rationale |
|---|---|---|
| Expected return: equity / debt / gold / liquid | 11% / 6.5% / 7.5% / 6% | Planning returns below the simulation means, so SIPs are not sized on optimistic numbers. |
| Goal inflation: education / marriage / home, vehicle, travel, retirement, other | 9% / 7% / 6% | Education costs have outrun CPI; marriage costs sit between. |
| Post-retirement return | 6.5% | Debt-like portfolio in retirement. |
| Life expectancy | 85 | Conservative planning age. |
| Retirement spending if not entered | 70% of current household expenses | Typical drop once EMIs and saving stop. |

## Monte Carlo (5,000 paths, seed 20261009)
| Asset | Mean | Volatility |
|---|---|---|
| Equity | 12% | 17% |
| Debt | 6.5% | 2.5% |
| Gold | 8% | 14% |
| Liquid | 6% | 0.5% |

Correlations: equity-debt 0.10, equity-gold 0.05, debt-gold 0.10, liquid uncorrelated. Annual returns are
correlated lognormal; the portfolio is rebalanced each year; SIPs are annuity-due, monthly. Target
success level for the "SIP for ~80% chance" figure: 80%.

## Emergency fund and insurance
| Assumption | Default |
|---|---|
| Emergency fund | 6 months of (expenses + EMI); 9 months for freelance / variable income |
| Share of surplus used to close the gap | 50% |
| Term cover | Human-life-value: PV of 70% of annual income (30% personal share) to retirement, at max(2%, 6.5% - 6%), less (investments + liquid - liabilities); floored at 0, capped at 25x income. 15x and 20x shown for reference. |
| Health cover target | Rs 10 lakh; +Rs 5 lakh if age > 40 or 3+ dependents |

## Risk model (code, with weights/bands in `engine/profiling.py` and `allocation.yaml`)
- Capacity (0-100): age 20%, income stability 15%, dependents 10%, savings rate 15%, emergency fund
  15%, net worth multiple 10%, debt burden 10%, insurance 5%. Bounds are lower-inclusive,
  upper-exclusive (tested).
- Tolerance (0-100): mean of ten questionnaire scores, rescaled. Final = min(capacity, tolerance).
- Mismatch note if the two differ by more than 25 points. Emergency fund < 3 months caps the band at
  Moderate; dependents with no term cover adds "Insurance first".

## Allocation
| Band | Equity | Debt | Gold | Liquid |
|---|---|---|---|---|
| Conservative | 15 | 65 | 5 | 15 |
| Moderately Conservative | 30 | 52 | 8 | 10 |
| Moderate | 50 | 33 | 10 | 7 |
| Moderately Aggressive | 70 | 18 | 8 | 4 |
| Aggressive | 85 | 7 | 6 | 2 |

Horizon cap on equity: under 3 years 0%, 3-5 years 30%, 5-7 years 50%, 7-10 years 70%, 10+ no cap.
Equity split large/flexi/mid/small by band and the debt split 40/30/30 are in `allocation.yaml`.

## Fund selection
- Eligible: Regular plan, Growth option, data quality ok / split_adjusted, open-ended, last NAV within 10
  days of 2026-10-09, not exchange-traded gold.
- History: 5+ years for equity categories, 3+ years for debt, gold and liquid.
- Score = percentile-rank composite (`scoring.yaml`); liquid / short-duration funds use a return and
  volatility composite, never Sharpe. Maximum 8 funds, at most 2 per AMC, positions under 5% merged.

## Rebalancing and tax
Annual review; rebalance when an asset class drifts more than 5 percentage points; direct new SIPs to the
under-weight class first. Tax optimisation is out of scope (info card only).
