# Phase 2 Report: Analytics Engine & Fund Deep Pages

**Date:** 2026-10-10  
**Phase:** 2 — Analytics Engine & Fund Pages  
**Status:** Completed & Verified  

---

## 1. What Changed

### 1.1 Pure Python Analytics Engine (`backend/app/engine/analytics.py`)
- Implemented pure deterministic analytics functions with zero external API dependencies:
  - **Returns:** Annualized CAGR (`cagr`), trailing returns (`trailing_return`), rolling return series & summary distribution (`rolling_returns`, `rolling_return_stats`: min, median, max, % positive), SIP XIRR via SciPy `brentq`.
  - **Risk:** Annualized volatility (`annualized_volatility`), Sharpe ratio (`sharpe_ratio`, default $R_f = 6.5\%$), Sortino ratio (`sortino_ratio`), maximum peak-to-trough drawdown (`max_drawdown`), and recovery duration (`max_drawdown_duration`: peak, trough, recovery dates, recovery days).
  - **Market Capture:** Up-market and down-market capture ratios (`capture_ratios`) against category median benchmark series.
  - **Correlation & Overlap:** Pairwise return correlation matrix (`return_correlation_matrix`) flagging pairs with correlation $\ge 0.85$ with strict overlap proxy warning label: `"return-correlation overlap, not holdings overlap"`.
  - **Portfolio Optimization:** PyPortfolioOpt integration (`optimize_portfolio_weights`) computing illustrative Max Sharpe and Hierarchical Risk Parity (HRP) weightings with SciPy 1.18+ compatibility shim.

### 1.2 Monte Carlo Enhancements (`backend/app/engine/montecarlo.py`)
- Extended `simulate_sip()` to support historical bootstrap sampling (`draw="bootstrap"`) alongside parametric lognormal draws (`draw="lognormal"`).
- Added per-goal target success probability calculation (`sip_for_target_success`), retaining complete backward-compatibility with existing baseline persona tests (8 golden persona tests remain 100% stable).

### 1.3 Extended Category Ranking & Scoring (`backend/app/engine/funds.py`)
- Added `rank_category_funds()` to rank all clean eligible schemes in any canonical category based on consistency metrics (`roll3y_pct_positive`, `neg_roll3y_dispersion`, `sortino_3y`, `neg_downside_capture`).
- Safely handled synthetic data frames without `data_quality` columns during testing while enforcing clean data requirements for production pools.

### 1.4 API Endpoints (`backend/app/api/routes.py`)
- `GET /api/funds/{code}/analytics`: Deep analytics for any clean eligible scheme (CAGR, rolling distribution, risk metrics, drawdown recovery duration, up/down capture ratios).
- `GET /api/funds/compare?codes=...`: Side-by-side comparison of 2–8 schemes including return correlation matrix and overlap proxy warnings (positioned before parameterized scheme route to avoid Starlette route collision).
- `GET /api/categories/{cat}/ranking`: Ranked category list by past-performance composite score.
- `POST /api/portfolio/analyze`: Multi-holding portfolio analysis with correlation matrix and illustrative alternative weightings.
- Enforced AMFI ARN 345439 statutory disclaimers on all responses via `backend/app/config/disclosures.py`.

### 1.5 Frontend Deep Analytics & Comparison (`frontend`)
- **`app/funds/[code]/page.tsx`**: Dynamic scheme analytics page featuring:
  - Header with scheme name, category, AMC, Regular plan badge, and ARN 345439 attribution.
  - Returns strip (1Y, 3Y, 5Y CAGR, and 3Y SIP XIRR).
  - Responsive Recharts monthly NAV trend chart (`components/FundCharts.tsx`) with 1Y, 3Y, 5Y, and All-time horizon toggles.
  - Rolling returns consistency distribution cards (1Y, 3Y, 5Y: Min, Median, Max, % positive).
  - Risk & Volatility profile card (volatility, Sharpe, Sortino, max drawdown, recovery days).
  - Up-market and down-market capture bar chart vs category median benchmark.
  - Link to compare scheme with others.
- **`app/funds/compare/page.tsx` & `CompareView.tsx`**: Side-by-side comparison page supporting:
  - Multi-scheme metric matrix with automated highlighting of highest return, lowest volatility, highest Sharpe, and lowest drawdown.
  - Interactive scheme addition and removal (2 to 8 schemes).
  - Return correlation table with high correlation alert ($\ge 0.85$) and statutory warning notice (`"return-correlation overlap, not holdings overlap"`).
- **`components/Results.tsx`**:
  - Added "Deep Analytics →" link under each scheme in the plan shortlist table.
  - Added "Compare All Shortlisted Schemes →" button above the table for immediate multi-fund comparison.

---

## 2. Files Touched

| File | Status | Description |
|---|---|---|
| `backend/pyproject.toml` | Modified | Pinned `scipy` and `pyportfolioopt` dependencies |
| `backend/requirements.txt` | Modified | Pinned `scipy` and `pyportfolioopt` dependencies |
| `backend/app/config/analytics.yaml` | Created | Configuration parameters for analytics windows and defaults |
| `backend/app/config/__init__.py` | Modified | Loaded `analytics.yaml` via `load_analytics()` |
| `backend/app/config/disclosures.py` | Modified | Defined compliant statutory disclaimers for analytics, compare, rankings, and portfolio endpoints |
| `backend/app/config/scoring.yaml` | Modified | Added category ranking composite weights |
| `backend/app/engine/analytics.py` | Created | Pure financial math, rolling returns, ratios, correlation, and optimization |
| `backend/app/engine/funds.py` | Modified | Added `rank_category_funds()`, safe data-quality pool filtering |
| `backend/app/engine/montecarlo.py` | Modified | Added bootstrap historical sampling and `sip_for_target_success` |
| `backend/app/schemas.py` | Modified | Added `PortfolioHolding` and `PortfolioAnalyzeRequest` schemas |
| `backend/app/api/routes.py` | Modified | Added fund analytics, comparison, category ranking, and portfolio analyze routes |
| `backend/tests/test_analytics.py` | Created | 13 test cases verifying returns, SIP XIRR, drawdown, PyPortfolioOpt, and all new API routes |
| `frontend/lib/types.ts` | Modified | Added types for `FundDetail`, `FundAnalytics`, `RollingStats`, `CompareResponse`, `CorrelationMatrix` |
| `frontend/lib/api.ts` | Modified | Added client and server fetch functions for fund detail, analytics, and compare |
| `frontend/components/FundCharts.tsx` | Created | Recharts NAV history with range toggle, rolling distribution cards, and capture ratio bar chart |
| `frontend/app/funds/[code]/page.tsx` | Created | Deep fund analytics page with metadata and not-found handling |
| `frontend/app/funds/compare/page.tsx` | Created | Comparison page wrapper with query param parsing |
| `frontend/app/funds/compare/CompareView.tsx` | Created | Interactive side-by-side comparison table, scheme selector, and correlation matrix |
| `frontend/components/Results.tsx` | Modified | Linked shortlisted funds to deep analytics and multi-scheme comparison |
| `frontend/e2e/smoke.spec.ts` | Modified | Added E2E tests for fund deep analytics and fund comparison pages |

---

## 3. Test Results

### 3.1 Backend Test Suite (`pytest`)
- **Total Tests Passed:** 414 / 414
- **Engine Test Coverage:** **91.60%** (mandatory floor is 85%)
- **Golden Persona Stability:** 8 passed (all baseline plans 100% invariant)
- **Compliance Copy Scanner:** Passed (`test_compliance_copy.py` 2/2 passed)

### 3.2 Frontend Tests & Checks
- **Playwright E2E Tests:** 6 / 6 passed:
  1. `complete the wizard and download the PDF` (PASS)
  2. `unknown plan renders real 404 page` (PASS)
  3. `home page renders exactly one disclosure block in the footer` (PASS)
  4. `security headers are present on responses` (PASS)
  5. `fund analytics deep page renders metrics, rolling returns, and capture chart` (PASS)
  6. `fund comparison page renders side-by-side comparison and correlation matrix` (PASS)
- **Compliance Wording Scanner (`check-copy.mjs`):** Passed (`check-copy: ok`, 0 banned words found)
- **Linting (`ruff`, `next lint`, `tsc --noEmit`):** 0 warnings, 0 errors
- **Build (`next build`):** Compiled successfully, all static and dynamic routes verified

---

## 4. Open Questions & Notes for Review

1. **Category Benchmark Median Fallback:** When a category has fewer than 3 funds with 3-year history, `category_median_series` currently returns an empty series and capture ratios return `None`. Is this acceptable, or should we substitute a broader market benchmark (e.g. Nifty 50 TRI proxy)?
2. **PyPortfolioOpt Constraints:** In `/api/portfolio/analyze`, we set default min weight 2% and max weight 50% for alternative weight views. Should these weights be user-configurable in the UI in Phase 4?
3. **Phase 3 Readiness:** Ready to begin Phase 3 (CAS Upload & Analysis for existing portfolios). Stopping here to wait for your review as required by the operating instructions.
