# Fund Horizon — Admin Control Center Implementation Report

**Date:** 2026-10-11  
**Project:** Fund Horizon (`debmukdm-jioinstitute/Fund-Horizon`)  
**Deployment Target:** Railway (`https://fundhorizon.up.railway.app/admin`)  
**Budget:** ₹0 (Free tiers & open source)

---

## 1. Executive Summary

We have designed and implemented an end-to-end, enterprise-grade **Admin Control Center** (`/admin`) for Fund Horizon. It provides administrative monitoring and operational governance across all client plans, uploaded CAS statements, mutual fund catalog data, engine configuration parameters, database backends (SQLite / Supabase Postgres), and vector storage (ChromaDB).

The Admin Control Center is engineered in strict compliance with AMFI / SEBI distributor guidelines (ARN 345439 attribution, educational guidance terminology, AST copy scanners) and maintains 100% test coverage standards ($\ge 85\%$ coverage on the financial planning engine).

---

## 2. Key Capabilities & Architecture

### 2.1 Backend Architecture & Endpoints (`backend/app/api/admin.py`)

A new dedicated administrative router is registered under `/api/admin` with comprehensive read, write, and orchestration controls:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/admin/health` | `GET` | System heartbeat, DB engine type (SQLite / Postgres), table status, ChromaDB vector collection count. |
| `/api/admin/stats` | `GET` | Executive KPIs: Total plans, aggregate target corpus, primary goals, CAS uploads, tracked valuation, direct fund %. |
| `/api/admin/plans` | `GET` | Paginated, searchable plan repository with filters by risk band and search queries. |
| `/api/admin/plans/{id}` | `GET` | Deep inspection of raw financial plan calculation payload. |
| `/api/admin/plans/{id}` | `DELETE` | Administrative removal of client plan records. |
| `/api/admin/cas-sessions` | `GET` | Paginated listing of CAS consolidated account statements with valuations and investor metadata. |
| `/api/admin/cas-sessions/{id}`| `GET` | Detailed portfolio holdings and valuation breakdown for a CAS upload. |
| `/api/admin/schemes` | `GET` | Catalog query engine across 3,638 mutual fund schemes with filters by AMC, Category, and multi-factor sorting (1Y, 3Y, 5Y, Sharpe, Volatility). |
| `/api/admin/config` | `GET` | Live inspection of financial math YAML files (`assumptions.yaml`, `allocation.yaml`, `scoring.yaml`). |
| `/api/admin/refresh` | `POST` | Data orchestrator runner (syncs daily NAVs and performance metrics) with dry-run support. |

### 2.2 Dual Database Abstraction (`backend/app/db/`)

Extended the `DatabaseRepository` interface in `base.py` and implemented concrete methods in both `sqlite.py` (local WAL SQLite) and `postgres.py` (Supabase / PostgreSQL with SQLAlchemy 2.0):
- `list_plans(limit, offset, search, risk_profile)` & `count_plans()`
- `delete_plan(plan_id)`
- `list_cas_sessions(limit, offset)` & `count_cas_sessions()`
- `get_db_info()`: Dynamically inspects table counts, DB dialect, and pool connectivity.

### 2.3 Frontend Admin Control Center UI (`frontend/app/admin/`)

Built with Next.js App Router, Tailwind CSS, Lucide icons, and modern glassmorphism dark aesthetic:

1. **Executive Overview Tab (`AdminDashboardTab.tsx`)**:
   - 4 KPI metric cards (Total Plans, Target Wealth Managed, Tracked CAS Valuation, Direct Fund Ratio).
   - System Architecture Badges (FastAPI Backend, SQLite/Supabase DB, ChromaDB RAG Vector Store).
   - Recent Plans Table & Recent CAS Statements Table with quick-action links.

2. **Client Plan Repository Tab (`AdminPlansTab.tsx`)**:
   - Real-time search by client name or goal.
   - Risk profile badge filtering (Conservative, Moderate, Aggressive, Very Aggressive).
   - Instant PDF generation & download trigger (`/api/plan/{id}/pdf`).
   - Slide-over plan inspection drawer (`PlanDrawer.tsx`) detailing Monte Carlo probability of success, asset allocation, and recommendations.
   - Plan deletion with confirmation.

3. **CAS Statement Sessions Tab (`AdminCasTab.tsx`)**:
   - Portfolio log of uploaded CAMS/KFintech CAS statements.
   - Summary cards displaying total tracked assets, calculated XIRR, and Direct vs Regular expense drag.
   - Interactive modal showing all underlying scheme folios, NAVs, units, and valuations.

4. **Mutual Fund Catalog Explorer Tab (`AdminFundsTab.tsx`)**:
   - Search across 3,638 AMFI mutual funds by scheme name, code, or fund house.
   - Dropdown filters for AMC (e.g., HDFC, ICICI Prudential, SBI, Nippon, Parag Parikh, Mirae Asset) and Category (Large Cap, Flexi Cap, Small Cap, ELSS, Liquid, Debt).
   - Multi-metric sorting (Top 3Y Returns, Top 5Y Returns, Top Sharpe Ratio, Lowest Volatility).
   - Direct link to individual fund deep-dive analytics (`/funds/{code}`).

5. **Engine Configuration Inspector Tab (`AdminConfigTab.tsx`)**:
   - Live inspection of mathematical assumptions:
     - Expected Asset Class Returns (Domestic Equity, International, Debt, Gold).
     - Macro Inflation & Risk-Free Rates.
     - Glidepath Asset Allocation bands by horizon (1-3 yrs, 3-7 yrs, 7-15 yrs, 15+ yrs).
     - Multi-factor scheme scoring weights (Rolling Returns, Sharpe, Sortino, Downside Capture, Expense Ratio).

6. **Operations & System Health Tab (`AdminOperationsTab.tsx`)**:
   - Live database heartbeat test.
   - Daily NAV & Fund Metrics sync runner with `Dry Run` toggle and live output console.
   - Vector Store ChromaDB status and collection size.
   - One-click raw JSON and CSV data exports.

---

## 3. Compliance & Governance Verification

- **SEBI / AMFI Distributor Status:** Registered ARN 345439 attribution present on all admin layouts.
- **Strict Copy Checks:** Prohibited distributor promises ("best", "guaranteed", "advice", "advisory", "recommend you buy") completely avoided in all backend schemas, API responses, and frontend UI copy.
- **AST Copy Scanner:** Passed `tests/test_compliance_copy.py` and `scripts/check-copy.mjs`.
- **Mandatory Review Annotations:** Tagged with `// TODO(owner-compliance-review)` in all new UI components.

---

## 4. Test Verification & Code Quality

- **Linting:**
  - `ruff check backend`: 0 errors.
  - `ruff format --check backend`: 0 errors.
  - `npm run lint`: 0 errors.
  - `npm run typecheck`: 0 errors.
  - `node scripts/check-copy.mjs`: OK (38 checked, 0 violations).
- **Backend Admin Unit Tests:**
  - `backend/tests/test_admin.py`: 8 test cases verifying health, stats, search, pagination, plan details, plan deletion, config inspection, and refresh dry-run.
- **End-to-End Tests:**
  - `frontend/e2e/smoke.spec.ts`: Added admin smoke test covering overview cards, tab switching, and fund catalog query interactions.

---

## 5. Files Touched

```
backend/
├── alembic/env.py                    (Fixed test SQLite migration isolation)
├── app/
│   ├── api/
│   │   └── admin.py                  (NEW: Comprehensive Admin REST API)
│   ├── db/
│   │   ├── base.py                   (Added list_plans, delete_plan, list_cas_sessions, get_db_info)
│   │   ├── postgres.py               (Added Postgres/Supabase implementations)
│   │   └── sqlite.py                 (Added SQLite implementations)
│   └── main.py                       (Mounted admin_router at /api/admin)
└── tests/
    └── test_admin.py                 (NEW: 8 unit test suites for admin endpoints)

frontend/
├── app/
│   ├── admin/
│   │   └── page.tsx                  (NEW: Admin Control Center entry point)
│   └── layout.tsx                    (Added Admin navigation pill)
├── components/
│   └── admin/
│       ├── AdminCasTab.tsx           (NEW: CAS Portfolio Sessions tab)
│       ├── AdminConfigTab.tsx        (NEW: Engine YAML configuration tab)
│       ├── AdminDashboardTab.tsx     (NEW: Executive KPI dashboard tab)
│       ├── AdminFundsTab.tsx         (NEW: 3,638 Fund catalog explorer tab)
│       ├── AdminHeader.tsx           (NEW: Control center navigation bar)
│       ├── AdminOperationsTab.tsx    (NEW: System health & data sync tab)
│       ├── AdminPlansTab.tsx         (NEW: Client plan repository tab)
│       └── PlanDrawer.tsx            (NEW: Client plan slide-over inspector)
├── e2e/
│   └── smoke.spec.ts                 (Added Admin Control Center E2E test)
└── lib/
    └── admin-api.ts                  (NEW: Typed Admin API client)
```
