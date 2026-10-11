# Fund Horizon Planner

Customer profiling, risk-based allocation, an illustrative fund shortlist and a goal-by-goal SIP plan,
with a PDF report. FastAPI + Next.js. All numbers come from deterministic Python in
`backend/app/engine/`; there is no LLM and no network call at runtime.

Fund Horizon (ARN 345439) distributes Regular plans only. All user-facing wording and the disclosures
are in `backend/app/config/disclosures.py` and carry `TODO(owner-compliance-review)` markers.

The plan view shows:
- **Simple / Detailed allocation** — the nine fund categories can be viewed as four buckets
  (equity, debt, gold, liquid); Simple is the suggested default, Detailed shows every category.
- **Cover plans worth researching** — when the "What to do first" card shows a term or health
  cover gap, an illustrative shortlist of researched insurance plans appears in the Risk profile
  section, with one plan marked for comparison first (curated October 2026; not a recommendation).
- **Fund-by-fund comparison** — every shortlisted fund carries its next three ranked
  alternatives in the same category, shown side by side with the marked pick.

## Setup (about 10 minutes)
Requirements: Python 3.11+ (3.13 used here), [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
make setup     # creates backend/.venv, installs deps, npm install, installs Playwright Chromium
make dev       # API on http://localhost:8000, web on http://localhost:3000
make test      # backend tests (coverage floor 85%) + Playwright smoke test
make lint      # ruff, eslint, tsc, banned-wording scan
```

Optional: copy `backend/.env.example` to `backend/.env` (CORS origins, DB path, data dir) and set
`NEXT_PUBLIC_API_URL` for the frontend if the API is not on `localhost:8000`. Public site links
(sitemap, robots, Open Graph) use `NEXT_PUBLIC_SITE_URL` (default `https://fundhorizon.up.railway.app`).

## Layout
```
backend/app/{api,engine,data,config,report,db}   backend/tests (golden persona files in tests/golden)
frontend/                                        Next.js 14 app router, Recharts
data/fundhorizon_mf_rag_dataset/                 metrics CSV + month-end NAVs (as of 2026-10-09)
docs/                                            ARCHITECTURE, ASSUMPTIONS, VERIFICATION
```

## Change assumptions
Edit `backend/app/config/assumptions.yaml` (returns, inflation, emergency fund, insurance, Monte Carlo,
rebalancing), `allocation.yaml` (band tables, glide path, category split, fund-count rules),
`scoring.yaml` (ranking weights) or `questionnaire.json`, then restart the API. See
`docs/ASSUMPTIONS.md` for every default and its rationale. A single plan can override values through
`assumption_overrides` in the `POST /api/plans` body.

## Refresh the data
The dataset was built by `data/fundhorizon_mf_rag_dataset/build_dataset.py` (AMFI NAVAll + mfapi.in):

```bash
pip install pandas numpy
python data/fundhorizon_mf_rag_dataset/build_dataset.py /tmp/fh_new --include-direct --workers 16
```
Replace `all_schemes_metrics.csv`, `category_summary.csv` and `nav_monthly/` with the new output, update
`data_asof` in `assumptions.yaml`, then run `make test`. Golden persona files will change; regenerate with
`cd backend && .venv/bin/python -m tests.make_golden` after reviewing the new outputs.

## API
`GET /healthz` · `GET /api/questionnaire` · `GET /api/meta` · `POST /api/plans` ·
`GET /api/plans/{id}` (optional `?step_up=0.05`) · `GET /api/plans/{id}/report.pdf` ·
`GET /api/funds/{scheme_code}`. Validation errors return 422 with a readable message.

## Out of scope
Chat/LLM features, authentication, payments or orders, KYC, CAS upload, tax optimisation, international
funds, Direct-plan recommendations, deployment config. Extension points are marked `# EXTENSION:`.

## Database & Persistence
By default, Fund Horizon uses local SQLite (`plans.db`). For persistent multi-instance or serverless deployments, PostgreSQL is supported via SQLAlchemy 2.0 with connection pooling (e.g. Supabase or Neon free tiers):

1. Set `DATABASE_URL` in environment (e.g., in `backend/.env` or deployment variables):
   - **Supabase (Transaction Pooler port 6543):**
     `DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
   - **Neon Serverless PostgreSQL:**
     `DATABASE_URL=postgresql://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require`
2. Run database migrations:
   ```bash
   cd backend && .venv/bin/alembic upgrade head
   ```
3. Daily data synchronization:
   ```bash
   cd backend && .venv/bin/python scripts/refresh_data.py
   ```

## Deploy (Railway)
Two services built from the repo root with the Dockerfiles in `deploy/`:
`api` (`RAILWAY_DOCKERFILE_PATH=deploy/api.Dockerfile`, volume at `/data`, `FH_DB_PATH=/data/plans.db` or `DATABASE_URL=<postgres connection string>`,
`FH_CORS_ORIGINS=https://fundhorizon.up.railway.app`) and `web` (`deploy/web.Dockerfile`,
`NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL` set to the api URL; `NEXT_PUBLIC_SITE_URL` defaults to
`https://fundhorizon.up.railway.app` for sitemap / robots / Open Graph). `NEXT_PUBLIC_*` values are
baked in at build time. Railway auto-deploys from `main`.

