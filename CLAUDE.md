# Fund Horizon: project rules

## Typography: Google Sans only (no exceptions)

The ONLY typeface anywhere in this project is **Google Sans**. This applies to the whole website, the backoffice,
charts, form controls, generated PDFs and matplotlib images. Never add, suggest or fall back to another font.

How it is wired (keep it that way):

- **Web:** `@fontsource-variable/google-sans` is imported once in `frontend/app/layout.tsx` (self-hosted, CSP-safe).
  `frontend/tailwind.config.ts` maps `font-sans`, `font-display`, `font-mono` and `font-serif` to Google Sans, and
  `frontend/app/globals.css` has a global `*, *::before, *::after { font-family: var(--font-google-sans) !important }` lock.
  Monospace-looking numbers use `tabular-nums`, not a different family.
- **PDFs and charts:** `backend/app/report/fonts.py` registers the static TTFs in `backend/app/report/fonts/`
  (rebuild with `backend/scripts/build_google_sans_ttf.py`). Use `BODY_FONT` / `BOLD_FONT` from that module; never name
  Helvetica, DejaVu or any other font.
- **Do not:** use `next/font`, `@font-face`, font CDNs, other `@fontsource-*` packages, `fontFamily`/`font-family`
  values other than `var(--font-google-sans)`, or the system/monospace/serif keywords.
- **Enforcement:** `frontend/scripts/check-fonts.mjs` runs in `npm run lint`, in `npm run build` (so a deploy fails),
  and in `make lint`. `frontend/e2e/fonts.spec.ts` checks the computed font of every element on the main pages, and
  `backend/tests/test_report.py::test_pdf_and_charts_use_google_sans_only` checks the fonts embedded in generated PDFs.
  Any new page, component, chart or document must pass these checks before it is considered done.

Note: the variable font ships weights 400-700, so `font-light` renders as 400 and `font-extrabold`/`font-black` as 700.

## Forms: official publisher forms only (no lookalikes)

Operations forms (CAMS, KFintech/Karvy, PMS) are the publishers' own PDFs, listed in `data/official_forms.json`
(rebuilt and link-checked by `backend/scripts/build_official_forms.py`). Entries, ticks and signatures are drawn
onto the original PDF (`frontend/components/operations/PdfFormFiller.tsx`, `backend/app/report/pdf_fill.py`).
Never generate a form that imitates an RTA/AMC/PMS form or invents a form code, and never label a generated
document "official". If no official PDF exists for a need, link the publisher's page instead.

Refreshing the AMC forms: `make forms` (harvests each fund house's own forms page with a visible Chrome, then rebuilds
and link-checks `data/official_forms.json`). Run it on a dev machine; headless Chrome is blocked by several AMC sites,
so there is no CI job. To add a fund house: add its forms page to `AMCS` in `scripts/harvest_amc_forms.mjs`, to
`AMC_PAGES` in `backend/scripts/build_official_forms.py`, and to `AMC_ORDER` in `frontend/app/backoffice/operations/page.tsx`.
Never bypass or solve a CAPTCHA or bot check: for a gated site (Kotak) run the harvester with a human at the window, or
list only the fund house's forms page as a link.

## API deploys: build in GitHub Actions, not on the EC2 box

`.github/workflows/deploy-api.yml` builds `deploy/api.Dockerfile` in GitHub Actions (layer cache), pushes it to GHCR
(`ghcr.io/debmukdm-jioinstitute/fund-horizon-api:<sha>`), then runs `deploy/redeploy.sh` on the instance through SSM. The instance
only `docker pull`s and does the health-gated blue/green swap. Nothing is built or installed on EC2, and the old 5-minute
build timer is retired (`redeploy.sh` removes it). Keep the zero-downtime swap and auto-rollback; never add a hotfix path
that skips the health check. Details: `docs/DEPLOY.md`.

## Code style: ponytail (smallest complete change)

Solve the whole problem with the least new code. Reuse existing helpers, then stdlib, then installed packages; never add a
dependency for a few lines. No unasked abstractions, wrappers or options; deletion beats addition. Non-trivial logic gets
a small test or self-check. Never cut security, trust-boundary validation or error handling. A shortcut with a known limit
gets a one-line comment: `shortcut: <limit>, <when to upgrade>`. End replies with what was skipped or not checked.

## Tables: 100 rows by default

Every paginated table, list or "Rows" selector loads **100 rows** by default (`DEFAULT_PAGE_SIZE` in `frontend/lib/pagination.ts`);
users may still pick a smaller size. Any new table or list must use that constant, never its own number, and the Rows
dropdown must include 100.

## Core product: PMS and mutual funds come first (never regress them)

PMS and mutual funds (screener, quartiles, FH Recommended, valuation, portfolio screening) are the product. Everything else is
secondary and must never disturb them.

- Before touching anything on those paths, read the code it feeds; after pushing, **verify on the live site yourself** (live API
  counts via `https://api.fundhorizon.website/health/core`, then the page) and report the real numbers. Never leave the user to
  hunt for bugs.
- Never let a new or partial data month replace a complete one (the 1-row APMI month that hid ~1,850 PMS strategies). Readers pick
  the newest *complete* month; writers refuse a partial scrape.
- Every core change ships with a test. A deploy whose `/health/core` counts fall below the floors in `deploy-api.yml` fails CI.
- Do not bundle unrelated work into core pushes, and do not push without the user's yes.
