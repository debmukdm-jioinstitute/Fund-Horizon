# Fund Horizon Backoffice Build Guide & Operational Checklist

## 1. Overview & Architecture
Fund Horizon internal backoffice platform for institutional research and operations.
- **Repository Branch**: `feat/internal-backoffice` (branched from `main` at `fcad3ab6c713981e00fb1ba962651bda56e701f5`).
- **Core Stacks**:
  - **Frontend**: Next.js 14 App Router, React 18, Tailwind CSS, Recharts. Same-origin `/api` rewrites, Secure HttpOnly SameSite=Lax session cookies, CSRF header enforcement, forwarded session cookies on SSR.
  - **Backend**: FastAPI, SQLAlchemy 2.0 (SQLite local default with WAL mode; PostgreSQL connection pooled production option), Alembic migrations.
  - **Runtime**: Single-worker supervised collector in lifespan, process-wide connection pooling and engine caching, zero paid AI/data dependencies.

---

## 2. Environment Configuration
Copy `.env.backoffice.example` to `.env` or set environment variables:
```bash
cp .env.backoffice.example .env
```
Key configuration parameters:
- `FH_INTERNAL_ONLY=true` — Fail-closed internal mode: disables public onboarding and redirects `/` to `/login` or `/backoffice`.
- `FH_COOKIE_SECURE=true` — Sets Secure flag on session cookies for HTTPS/production deployments.
- `FH_ADMIN_OPEN=false` — Enforces server-side authentication; no open browser admin bypass.
- `FH_ENABLE_DOCS=false` — Disables Swagger/OpenAPI docs in production to prevent metadata leakage.
- `FH_BACKOFFICE_COLLECTORS=true` — Activates supervised background collector loop in FastAPI lifespan.
- `FH_AI_ENABLED=false` — Zero paid LLM dependency; statistical/deterministic math templates used.
- `FH_REQUIRE_PRODUCTION_MIGRATIONS=true` — Fails container startup if pending Alembic migrations exist in production.
- `DATABASE_URL=` — Optional PostgreSQL connection string (Supabase/Neon/Self-hosted). Defaults to persistent SQLite `data/fund_horizon.db`.
- `FRED_API_KEY=` — Optional free St. Louis Fed registration key for US yields/macro series.

---

## 3. Operator Provisioning
Interactive CLI command to bootstrap or promote staff members without committed or default passwords:
```bash
cd backend
.venv/bin/python -m app.cli.bootstrap_admin --email admin@fundhorizon.internal --role admin --name "System Administrator"
```
The CLI uses `getpass` to securely prompt for the initial password, creates the staff account with `is_staff=1`, sets role `admin`, and hashes credentials with PBKDF2-HMAC-SHA256 (600,000 iterations).

---

## 4. Database Migrations
Run Alembic upgrade to bring schemas to head:
```bash
cd backend
.venv/bin/alembic upgrade head
```
Revisions:
- `0001_initial_schema`: Base tables (plans, funds, metrics, cas_sessions)
- `0002_customer_accounts`: Customer accounts and sessions
- `0003_crm_core`: CRM core (households, leads, opportunities, activities, cases)
- `0004_crm_products`: CRM products & compliance (insurance, FDs, PMS accounts, KYC, mandates)
- `0005_internal_backoffice`: Staff controls, source/instrument registries, observations, option snapshots & contracts, flows, portfolio positions/cashflows/valuations, PMS strategy observations, research notes, watchlists, audit events.

---

## 5. Build Checklist & Verification Gates
- [x] Baseline audit & branch initialization (`feat/internal-backoffice`).
- [x] Authentication lockdown: removed auto-promotion on `FH_ADMIN_EMAIL` match, enforced staff roles (`admin`, `analyst`, `rm`, `operations`, `read_only`), SameSite=Lax + Secure cookies, CSRF protection on mutations (`verify_csrf`).
- [x] Database engine pooling & schema caching (eliminated per-request schema DDL and connection pool re-creation in SQLite and PostgreSQL).
- [x] Normalized backoffice schemas & Alembic revision `0005_internal_backoffice`.
- [x] Atomic data collectors & adapters (AMFI 8-column header parser, ECB reference rates, Cboe VIX history, MFapi cache, FRED registered keyless fallback / needs_key).
- [x] Manual import engine (PMS strategies, client holdings & cash flows, option chains, FII/DII flows, corporate fundamentals) with preview, row validation, formula injection defense, and atomic rollback.
- [x] PMS tracker: Strategy research + Scoped client portfolio tracking (XIRR, Modified Dietz, HWM fee estimates).
- [x] Mutual Fund tracker: Daily AMFI NAV 8-column ingestion, scheme comparison, Direct/Regular plan distinctions, portfolio reconciliation.
- [x] Macro/Yields/Micro/Flows/Derivatives boards: 10Y-2Y curves, canonical 300 bps spread calculations (`(Y_a - Y_b) * 100`), PCR (OI/volume) with complete snapshot guarantees, cash-index N/A.
- [x] Explainable Impact Engine: continuous log returns, bps changes, aligned common dates (>=80% paired), duration shock `ΔP/P ≈ -modified_duration * Δyield_decimal` (+25 bps => +0.0025 yield decimal), deterministic briefing generator.
- [x] Calm, Google-inspired Backoffice UI at `/backoffice/*` with availability, frequency, and freshness badges across all cards.
- [x] Deployment profiles (`deploy/compose.internal.yml`, `deploy/nginx.internal.conf`, lean Docker target in `deploy/api.Dockerfile`, `.env.backoffice.example`).
- [x] Automated test suites (35 backoffice unit/integration tests, 17 auth tests, 706 engine tests) with 100% pass rate.
