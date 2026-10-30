# FH scoring, category comparison and recommendation history

## Baseline (as found)
`backend/app/backoffice/fh_score.py`: five filters (history 20, quartile 20, risk ratios 25, outperformance 20, excess 15; drawdown optional),
absolute-threshold ratios (capture >1.0, Sortino >1.5, Sharpe >1.0, per 1/3/5Y), failure penalties, consistency adjustment, 0-100 score,
stars, Buy/Hold/Sell. Reproduce: `backend/scripts/fh_scoring_compare.py` (writes `data/fh_scoring_baseline_legacy.json` and
`docs/FH_SCORING_COMPARISON.md`). Legacy stays the **default** (`ratios.mode = "legacy"`).

## What is computed where
Computed internally from NAV (`data/fundhorizon_mf_rag_dataset/build_dataset.py`): returns, volatility, Sharpe, Sortino (rf 6.5%), drawdown.
Beta, alpha and Treynor are computed there too but **against the category+plan median daily return, not an index**, so they are peer-relative
and are informational only. Capture ratios are imported from Advisorkhoj. Benchmark returns use the passive index fund tracking each category
benchmark (no TRI series). Category averages are internal equal-weight means.

## Category-relative scoring (`fh_catscore.py`, version `catscore-1`)
- Peer universe: same category and plan (Direct vs Regular), open-ended, clean NAV, one row per ISIN; exclusion reason kept. Growth only in
  this dataset, so IDCW cannot double-count. The mean **includes** the subject fund. Minimum peers is configurable (`catscore.min_peers`, 5);
  below it the metric is unscored (coverage drops), never scored as poor.
- Points: favourable mid-rank percentile (ties averaged), reversed for downside capture. Capture = average of up and down percentiles, and
  scores only when both exist. Capture is normalised to ratio (100% = 1.0); down capture <= 0 or capture > 300% is invalid, not rewarded.
- Mode A: percentile only. Mode B: A + bonus (`bonus_fraction` 0.15, capped at the component maximum) for Sharpe and Sortino above 1.0 only.
- Ratio-failure penalties are off in A/B (the percentile already penalises weak ratios; keeping both double-counts).
- Beta and Treynor: informational (no preferred direction defensible). Treynor needs |beta| >= 0.3.
- Missing weight is never redistributed.

## Decision needed before changing the default
Side-by-side (see `FH_SCORING_COMPARISON.md`): both new modes lift the average score by about 12 points and move 0 -> ~146 funds to Buy.
That is a level shift (percentiles give average funds about half the ratios points, the old thresholds gave them near zero), not better
selection. The 80-point recommend threshold and star bands were set for the legacy scale. Recalibrate them (or keep legacy) as a business call.

## Data status vs review status (`fh_data_status`, `fh_review_status`)
Machine-readable and separate from `fh_signal` (kept for compatibility): `complete`, `partial`, `insufficient_history`, `missing_series`,
`insufficient_peers`, `stale_or_bad_data`; review: `none`, `investment_review_required`, `data_incomplete`.
Edelweiss: **Edelweiss Multi Cap (152095)** has exactly 3.0 years of NAV (37 month-end points, from 2023-10-31). The metrics builder only
produces 3Y figures from 3.1 years, so Sharpe, Sortino, beta, capture and 3Y CAGR are empty. It is genuine short history at the boundary, not
an AMC, mapping or scraping failure; it resolves itself in about a month. Edelweiss Small Cap and Flexi Cap score normally (Sell, by score).

## Recommendation history (`fh_history.py`)
Episodes, append-only events (Added, Reviewed, Updated, Removed, Re-added; reason required for add/remove) and immutable snapshots
(SQLite triggers block UPDATE/DELETE; corrections are new versions). Funds already listed get a `migration` snapshot with no invented date,
score or rationale. Scheduled snapshots run inside the existing frame refresh (`_fh_refresh`) and store nothing when data is unchanged.
Views: snapshot as of a date (never reconstructed), then-vs-now, outcome after a genuine recorded date (while recommended vs after removal,
horizons not yet reached are unavailable), reconstructed trailing returns (labelled; no score is reconstructed).

## Known limits
Month-end NAV only, so outcome windows snap to the observation at or before each date. Category outcomes use today's peers (survivorship bias,
no point-in-time membership). No TRI series. Manager history is the single current record. Mandate changes and mergers are not tracked.
Auto-score-driven list changes (`apply_auto`) are not logged as events; none occur under legacy scoring. Basket simulation is not built.
