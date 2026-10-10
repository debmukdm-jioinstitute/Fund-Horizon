# Phase 1 Report: Fix Live-App Issues

**Date:** 2026-10-10  
**Status:** Completed and Verified  
**Coverage:** 97.68% on `app/engine` (floor 85%)  
**Tests:** 401 Pytest passed, 4 Playwright E2E passed  
**Linters:** Ruff, ESLint, TypeScript `tsc --noEmit`, banned-wording scans all pass cleanly  

---

## 1. What Changed

1. **Favicon & Metadata Routes (Web):**
   - Added `frontend/app/icon.tsx`: Dynamic branded 32x32 favicon rendered via Next.js `ImageResponse` (navy background `#0B2545` with teal accent `#13A89E`).
   - Added `frontend/app/robots.ts`: Standard crawler directives allowing `/` and disallowing `/api/`, pointing to `sitemap.xml`.
   - Added `frontend/app/sitemap.ts`: XML sitemap with entries for `/` and `/plan/new`.
   - Updated `frontend/app/layout.tsx`: Added `metadataBase`, Open Graph (`og:title`, `og:description`, `og:siteName`, `og:url`, `locale`), and Twitter card (`summary_large_image`) metadata.

2. **Real 404 for Unknown Plans (Web):**
   - Added `frontend/app/not-found.tsx`: Compliant 404 page ("Plan not found", "Start a new plan").
   - Added `getPlanServer` in `frontend/lib/api.ts` to perform server-side fetching and return `null` on 404.
   - Refactored `frontend/app/plan/[id]/page.tsx` into an async Server Component that invokes `notFound()` when the requested plan ID does not exist, ensuring Next.js responds with an authentic HTTP 404 status.
   - Extracted client interactivity into `frontend/app/plan/[id]/PlanView.tsx` with full support for the annual SIP step-up toggle and PDF download.

3. **Deduplicated Disclosures on Home Page (Web):**
   - Removed the duplicate `<section className="card" aria-labelledby="note">` block from `frontend/app/page.tsx`.
   - Disclosures are now exclusively rendered by the global `Footer` component, eliminating redundant disclosure text on `/`.

4. **Web Security Headers & Rewrite (Web):**
   - Configured `frontend/next.config.mjs` with:
     - `poweredByHeader: false` (removes `X-Powered-By: Next.js`)
     - `X-Frame-Options: DENY`
     - `X-Content-Type-Options: nosniff`
     - `Referrer-Policy: strict-origin-when-cross-origin`
     - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
     - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
     - `Content-Security-Policy`: restrictive policy compatible with Recharts dynamic SVGs and Next.js hydration.
     - `rewrites()`: rewrites `/api/:path*` to `API_INTERNAL_URL` (or `NEXT_PUBLIC_API_URL` / `http://localhost:8000`) so the browser can utilize single-origin requests.

5. **API Security Headers & Docs Toggle (API):**
   - In `backend/app/main.py`, added an HTTP middleware applying standard security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy`.
   - Added support for the `FH_ENABLE_DOCS` environment variable (defaults to `true`; setting `false` disables `/docs`, `/redoc`, and `/openapi.json`).

6. **Descriptive Ineligible / Direct Plan Messaging (API):**
   - Updated `GET /api/funds/{scheme_code}` in `backend/app/api/routes.py`:
     - If the requested scheme is a Direct plan, searches for its Regular equivalent by name mapping and returns:  
       `"Direct plans are not offered; see Regular equivalent <code/name> (<scheme_name>)"`  
       or `"Direct plans are not offered; Fund Horizon distributes Regular plans only."`
     - If the scheme has data quality issues or non-open-ended structure, returns a specific ineligibility message instead of a generic "Scheme not found".
     - Non-existent scheme codes return `404 "Scheme not found"`.

---

## 2. Files Touched

- **Added:**
  - `frontend/app/icon.tsx`
  - `frontend/app/robots.ts`
  - `frontend/app/sitemap.ts`
  - `frontend/app/not-found.tsx`
  - `frontend/app/plan/[id]/PlanView.tsx`
- **Modified:**
  - `frontend/app/layout.tsx`
  - `frontend/app/page.tsx`
  - `frontend/app/plan/[id]/page.tsx`
  - `frontend/lib/api.ts`
  - `frontend/next.config.mjs`
  - `frontend/e2e/smoke.spec.ts`
  - `backend/app/main.py`
  - `backend/app/api/routes.py`
  - `backend/tests/test_api.py`
  - `.gitignore`

---

## 3. Test & Verification Results

### Backend (`make test` & `make lint`):
- `ruff check app tests`: **All checks passed**
- `test_compliance_copy.py`: **2 passed** (No banned words; mandatory disclosures present)
- `pytest`: **401 passed** (including new tests for security headers, docs toggle, and fund detail direct/ineligible messaging)
- **Engine Coverage:** **97.68%** (Floor: 85.0%)

### Frontend (`make test` & `make lint`):
- `npm run lint`: **0 warnings, 0 errors**
- `npx tsc --noEmit`: **0 errors**
- `node scripts/check-copy.mjs`: **ok**
- `npx playwright test`: **4 passed**:
  1. `complete the wizard and download the PDF` (6.6s)
  2. `unknown plan renders real 404 page` (921ms)
  3. `home page renders exactly one disclosure block in the footer` (470ms)
  4. `security headers are present on responses` (449ms)

---

## 4. Open Questions & Notes

1. **CSP Deployment on Railway:** The Content Security Policy in `next.config.mjs` allows `self`, `http://localhost:8000`, and `https://api-production-f3147.up.railway.app` in `connect-src`. When using custom domains or other endpoints in production, `API_INTERNAL_URL` / rewrite ensures `/api/*` works seamlessly on `'self'`.
2. **Ready for Phase 2:** Foundation is fully verified; ready to proceed to Phase 2 (Analytics engine: CAGR, rolling returns, SIP XIRR, capture ratios, overlap proxy, PyPortfolioOpt, and analytics endpoints).
