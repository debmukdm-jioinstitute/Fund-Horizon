# FH changes for review

## Recommendation
Adopt **Mode B** (category-relative scoring plus a small bonus for Sharpe/Sortino above 1.0). It is what was discussed: a fund below 1.0 still earns credit if it beats its category, and a fund above 1.0 gets a bounded extra. Do **not** switch it on yet. It is built and previewable, and the live score is still the old one until the 80-point Buy bar is re-set for the new scale (below).

## What changed
| Area | Before | Now |
|---|---|---|
| Risk metrics (Sharpe, Sortino, capture) | Fixed thresholds (1.0 / 1.5) | Ranked against category peers (same category, same plan). Old method still available |
| Benchmark vs category | Mixed | Shown separately per period: fund, benchmark, category average, excess vs each, peer count, date |
| Score explanation | Totals only | Each metric: fund value, category average, percentile, points of maximum, plain-English reason |
| "Need review" vs "Insufficient data" | One label | Separate: data complete / partial / insufficient history / missing series / too few peers / stale; and review required only for weak performance |
| Add / remove from FH list | Silent, no record | Reason required; full history kept; re-adding starts a new linked episode |
| History | None | Frozen snapshots at add, review, removal and on schedule; corrections are new versions |
| Review views | None | What we knew on a date; then vs now; performance after the recommendation date (while listed vs after removal) |
| Security | Anyone could change the FH list | Staff login required |

## Numbers (all 3,634 funds, same data)
| | Old | Mode A | Mode B |
|---|---|---|---|
| Average score | 21.7 | 34.1 | 34.2 |
| Buy signals | 0 | 146 | 148 |
| Funds whose signal changed | | 718 | 729 |

The score rises by about 12 points because ranking gives an average fund about half the risk-metric points, while the old thresholds gave it almost none. That is a change of scale, not better stock picking. Re-set the Buy bar (and star bands) on the new scale before switching, or we will simply mint Buys. Full per-fund table for the curated list: `FH_SCORING_COMPARISON.md`. No curated fund is removed automatically.

## Edelweiss "Insufficient data"
Edelweiss Multi Cap has exactly 3.0 years of history; the 3-year figures need 3.1. It is genuinely too young by about a month, not an AMC or data-feed fault. Edelweiss Small Cap and Flexi Cap are scored normally (low scores, not missing data).

## Limits to state upfront
- Benchmarks use the passive index fund tracking each benchmark, not the official TRI series.
- Beta and Treynor in our data are measured against the category median, not an index, so they are shown but not scored.
- Past outcomes use today's peer set (survivorship bias) and month-end NAVs. No past score is reconstructed.
- History starts now. Existing FH funds have a labelled baseline from today's data; their original date and reasons are unknown and not invented.
- Advisorkhoj category averages were not used; averages are computed in-house.
- Not built: model-portfolio simulation of the recommended list.

## Decisions needed
1. Approve Mode B as target scoring.
2. New Buy threshold and star bands for it.
3. Whether to buy/ingest TRI series for true benchmark comparison.
