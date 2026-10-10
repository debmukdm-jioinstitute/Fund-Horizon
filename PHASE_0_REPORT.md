# Phase 0 Audit Report: Fund Horizon Planner

**Date:** 2026-10-10  
**Repo:** `debmukdm-jioinstitute/Fund-Horizon`  
**Working Directory:** `/Users/debabrata/.gemini/antigravity-ide/scratch/Fund-Horizon`  
**Current Baseline Test Status:** 398 passed in backend pytest (97.68% coverage on `app/engine`), 1 passed in Playwright E2E.  
**Current Baseline Lint Status:** `make lint` clean (Ruff, ESLint, TypeScript `tsc --noEmit`, banned-wording scan).

---

## 1. Extension Hooks (`# EXTENSION:` markers)

Grep across the codebase identified the following explicit extension markers and architected hook points:

1. **`backend/app/engine/funds.py:5`**
   ```python
   # EXTENSION: add AUM / TER metrics to scoring.yaml and `_metric_series` once the data has them.
   ```
   *Usage:* Hook for adding expense ratios (TER) and fund size (AUM) into category scoring composites and candidate selection.

2. **`backend/app/data/loader.py:37`**
   ```python
   # EXTENSION: add AUM / TER filters here once those columns exist in the dataset.
   ```
   *Usage:* Hook for filtering eligible fund candidate pools by minimum AUM thresholds or maximum TER limits.

3. **`backend/app/db/sqlite.py:3`**
   ```python
   # EXTENSION: add a user_id column once authentication exists.
   ```
   *Usage:* Hook for multi-tenant / user authentication and session binding when moving to persistent databases in Phase 6.

4. **`docs/ARCHITECTURE.md:58-61`**
   Explicitly registers four extension vectors:
   - AUM / TER filters and scoring (`data/loader.py`, `engine/funds.py`).
   - Chat layer on top of `/api/plans` (Phase 5).
   - CAS import (Phase 3).
   - Authentication & user storage (`db/sqlite.py`).

---

## 2. Baseline Test & Coverage Metrics

- **Backend Pytest Coverage (`app/engine`):**
  - Floor requirement: **85.0%**
  - Actual baseline: **97.68%** (561 statements, 13 missed)
  - Detail by module:
    - `app/engine/__init__.py`: 100% (0 / 0)
    - `app/engine/allocation.py`: 97% (58 / 60)
    - `app/engine/finmath.py`: 94% (51 / 54)
    - `app/engine/funds.py`: 95% (109 / 115)
    - `app/engine/insurance.py`: 100% (13 / 13)
    - `app/engine/montecarlo.py`: 96% (52 / 54)
    - `app/engine/pipeline.py`: 100% (23 / 23)
    - `app/engine/planning.py`: 100% (94 / 94)
    - `app/engine/profiling.py`: 100% (104 / 104)
    - `app/engine/stress.py`: 100% (44 / 44)
  - Pytest total: **398 passed** (with 14 benign deprecation/resource warnings).
- **Frontend Playwright E2E:**
  - `e2e/smoke.spec.ts`: **1 passed** (Full wizard flow, validation, consent, results page, step-up toggle, PDF download > 20KB).
- **Linters:**
  - `ruff check app tests`: **All checks passed**.
  - `eslint`: **0 warnings, 0 errors**.
  - `tsc --noEmit`: **0 errors**.
  - `check-copy.mjs` & `test_compliance_copy.py`: **Pass (no banned words)**.

---

## 3. Function & Feature Mapping vs Phase Requirements

| Phase & Feature | Status | Existing Artifacts & Code | Gap / Required Work |
|---|---|---|---|
| **P1: Web Favicon, Robots, Sitemap, OG** | Missing | `frontend/app/layout.tsx` has basic title/description. | Missing `app/icon.tsx` (favicon), `app/robots.ts`, `app/sitemap.ts`, Open Graph / Twitter metadata. |
| **P1: Real 404 for unknown plan** | Partial | `frontend/app/plan/[id]/page.tsx` catches 404 from API but renders an error card returning HTTP 200. | Missing `app/not-found.tsx`; call Next.js `notFound()` on 404 response so browser gets HTTP 404. |
| **P1: Deduplicate Home Disclosures** | Partial | `app/page.tsx` renders `<section className="card" aria-labelledby="note">` with disclosures; `components/Footer.tsx` repeats them. | Remove the duplicate section in `app/page.tsx`; retain single footer source. |
| **P1: Security Headers & poweredBy** | Missing | `next.config.mjs` is empty `{}`. `backend/app/main.py` has CORS only. | Add `poweredByHeader: false` and CSP/HSTS/X-Frame-Options/nosniff in `next.config.mjs`. Add security headers middleware in `main.py`. |
| **P1: API Direct plan clarity** | Partial | `routes.py:fund_detail` returns generic 404 "Scheme not found" for Direct or excluded plans. | Look up code in master/metrics: return informative message (e.g., `"Direct plans are not offered; see Regular equivalent X"`). Add `FH_ENABLE_DOCS` flag. |
| **P1: Next.js API Rewrite** | Missing | None. | Add optional Next.js rewrite `/api/*` to `API_INTERNAL_URL`. |
| **P2: CAGR, Trailing & Rolling Returns** | Partial | `build_dataset.py` has `trailing()` and `rolling_stats()`. Values exist in `all_schemes_metrics.csv`. | Port/refactor into pure functions in `backend/app/engine/analytics.py` on NAV series (`data/loader.py`). Verify against CSV within tolerance. |
| **P2: SIP XIRR, Vol, Sharpe, Sortino, Drawdown** | Partial | `finmath.py` has `sip_fv`; `build_dataset.py` has 3Y vol, Sharpe, Sortino, max DD. | Implement SIP XIRR (via `scipy.optimize.brentq` / newton), annualized vol, Sharpe & Sortino (rf=6.5% from assumptions), max DD and recovery duration. |
| **P2: Downside / Upside capture** | Partial | `stress.py` has `category_median_series()`. | Implement upside/downside capture ratio of fund returns vs category median series over 3Y/5Y. |
| **P2: Category Fund Scoring** | Partial | `engine/funds.py:score_pool()` scores on `scoring.yaml`. | Extend `scoring.yaml` and `funds.py` with consistency (rolling % positive, dispersion), downside capture, drawdown, risk-adjusted returns; exclude invalid data quality; skip Sharpe for liquid/overnight. |
| **P2: Correlation Matrix Overlap Proxy** | Partial | Asset correlations exist in `assumptions.yaml`. | Pairwise correlation matrix on monthly NAV returns for shortlisted funds. Flag pairs > threshold with "return-correlation overlap, not holdings overlap" label. |
| **P2: Monte Carlo Goal Probability & Bootstrap** | Partial | `engine/montecarlo.py` has `simulate()` and `sip_for_success()`. | Add per-goal target success probability override; add historical return bootstrap mode without altering golden persona outputs. |
| **P2: PyPortfolioOpt Alternative Weights** | Missing | None. | Add optional mean-variance (max-Sharpe, min-vol) and HRP helper as illustrative alternative weights view. |
| **P2: Analytics Endpoints & UI** | Missing | Only `GET /api/funds/{code}` exists. | Add `/api/funds/{code}/analytics`, `/api/funds/compare`, `/api/categories/{cat}/ranking`, `/api/portfolio/analyze`. Add frontend fund detail and comparison pages. |
| **P3: CAS Upload & Analysis** | Missing | Explicitly marked out-of-scope in MVP. | Implement `POST /api/cas/upload` (in-memory `casparser`, ISIN matching, folio XIRR, asset breakdown, plan comparison). Privacy copy in `disclosures.py`. |
| **P4: RAG Dataset Docs Generation** | Partial | `build_dataset.py` has formatting functions; source dataset zip exists in Downloads. `schemes_md/`, `categories/`, `amcs/`, `schemes_json/`, `ingest_example.py` absent from repo. | Add offline doc generator `generate_docs.py` reading existing CSVs and `nav_monthly/` without network calls. |
| **P4: ChromaDB + BGE-Small RAG** | Missing | Ingestion example exists in dataset zip, not in app. | Add `backend/app/rag/` (ChromaDB + fastembed / bge-small-en-v1.5, metadata filters, deterministic template fallback). |
| **P5: LiteLLM Explanation Layer** | Missing | Hardcoded templates only in `funds.py:explain_fund()`. | Build `backend/app/ai/` with LiteLLM, `config/ai.yaml`, provider fallback (Groq -> Gemini -> OpenRouter -> Ollama), numerical fidelity guardrails, compliance filtering. |
| **P6: PostgreSQL & Database Repository** | Partial | SQLite implementation only in `backend/app/db/sqlite.py`. | Introduce `Repository` protocol; add PostgreSQL implementation (SQLAlchemy 2); Alembic migrations; cron refresh workflow. |
| **P7: Hardening, API v1, Rate Limits, a11y** | Partial | Single unversioned API routes; no rate limiting; e2e smoke test has no axe a11y check. | `/v1` route aliases, SlowAPI rate limiting, Cache-Control headers, axe-core Playwright checks, final verification. |

---

## 4. Proposed Modules and File Structure

### Phase 1
- `frontend/app/icon.tsx`: Dynamic SVG/JSX favicon.
- `frontend/app/robots.ts`: Next.js robots configuration.
- `frontend/app/sitemap.ts`: Next.js sitemap configuration.
- `frontend/app/not-found.tsx`: Real 404 page.
- `frontend/app/plan/[id]/page.tsx`: Invoke `notFound()` on 404 API response.
- `frontend/app/page.tsx`: Remove duplicate disclosure section.
- `frontend/next.config.mjs`: `poweredByHeader: false`, CSP, HSTS, security headers, internal API rewrite.
- `backend/app/main.py`: Security headers middleware + `FH_ENABLE_DOCS` switch.
- `backend/app/api/routes.py`: Enhanced `fund_detail` error messages for Direct and ineligible schemes.
- `backend/tests/test_api.py`: Tests for security headers, docs toggle, and fund 404 messaging.
- `frontend/e2e/smoke.spec.ts`: Playwright checks for 404 page and single disclosure block.

### Phase 2
- `backend/app/engine/analytics.py`: Pure math functions (CAGR, rolling, XIRR, vol, Sharpe, Sortino, drawdowns, capture ratios, return correlation, PyPortfolioOpt wrapper).
- `backend/app/engine/montecarlo.py`: Extend with per-goal success target and historical bootstrap.
- `backend/app/engine/funds.py`: Extend composite scoring with consistency and downside metrics.
- `backend/app/config/analytics.yaml`: Assumptions and tunables for analytics and correlation thresholds.
- `backend/app/schemas.py`: Schemas for analytics, compare, rankings, and portfolio analysis.
- `backend/app/api/routes.py`: `/api/funds/{code}/analytics`, `/api/funds/compare`, `/api/categories/{cat}/ranking`, `/api/portfolio/analyze`.
- `frontend/app/funds/[code]/page.tsx`: Fund analytics page.
- `frontend/app/funds/compare/page.tsx`: Multi-fund comparison page.
- `backend/tests/test_analytics.py`: Unit tests for all pure math functions.

### Phase 3
- `backend/app/engine/cas.py`: In-memory CAS parsing (`casparser`), ISIN reconciliation, folio XIRR, category breakdown.
- `backend/app/api/routes.py`: `POST /api/cas/upload`.
- `backend/app/config/disclosures.py`: CAS privacy and consent copy.
- `backend/tests/fixtures/synthetic_cas.pdf`: Redacted synthetic CAS fixture.
- `backend/tests/test_cas.py`: Unit and API tests.
- `frontend/components/CasUpload.tsx`: Upload wizard step and holdings reconciliation table.

### Phase 4
- `data/fundhorizon_mf_rag_dataset/generate_docs.py`: Offline doc generator.
- `backend/app/rag/store.py`: ChromaDB persistent client wrapper.
- `backend/app/rag/embedder.py`: Fastembed/BGE-small embedding handler.
- `backend/app/rag/retriever.py`: Filtered semantic search.
- `backend/app/rag/pipeline.py`: RAG response builder with deterministic fallback templates.
- `backend/tests/test_rag.py`: Indexing and retrieval test suite.

### Phase 5
- `backend/app/config/ai.yaml`: Models, providers, fallback order, rate limits.
- `backend/app/ai/client.py`: LiteLLM wrapper with provider fallback.
- `backend/app/ai/guardrails.py`: Numerical consistency validator and compliance word scanner.
- `backend/app/ai/service.py`: Explanation service (plan, fund, CAS, RAG).
- `backend/tests/test_ai.py`: Mocked LiteLLM unit tests.
- `frontend/components/AiExplainer.tsx`: User-facing explanation panels with AI labels.

### Phase 6
- `backend/app/db/base.py`: Repository interface Protocol.
- `backend/app/db/sqlite.py`: SQLite implementation.
- `backend/app/db/postgres.py`: PostgreSQL implementation with SQLAlchemy 2.
- `backend/alembic/`: Database migrations.
- `.github/workflows/daily-refresh.yml`: Scheduled GitHub Actions workflow for data refresh.

### Phase 7
- `backend/app/api/v1/`: Versioned API namespace.
- `backend/app/core/rate_limit.py`: SlowAPI rate limiting.
- Documentation updates in `docs/ARCHITECTURE.md`, `docs/ASSUMPTIONS.md`, `docs/VERIFICATION.md`, `README.md`.

---

## 5. Open Questions for Review

1. **Workspace Location:** The project was cloned into `/Users/debabrata/.gemini/antigravity-ide/scratch/Fund-Horizon`. Recommendation: set this subdirectory as the active workspace.
2. **Next.js API Rewrite:** Should the Next.js rewrite `/api/*` to `API_INTERNAL_URL` be enabled by default in Phase 1, or kept optional behind an env flag?
3. **CSP Strictness for Recharts/Next:** Recharts and Next.js inline styles/scripts require `'unsafe-inline'` or a nonce in `style-src` / `script-src` during development and hydration. We propose standard restrictive CSP with `style-src 'self' 'unsafe-inline'`.
4. **PyPortfolioOpt Dependency:** PyPortfolioOpt has dependencies on cvxpy and scipy. Should it be included in the default dependencies or placed under an optional extra (e.g., `.[analytics]`)?
