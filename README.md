<div align="center">

# Fund Horizon Planner

**Profile a customer, suggest a risk-based allocation, shortlist funds, and plan every goal. Then look inside any fund, read a CAS, and hand over a PDF.**

[**Live site**](https://fundhorizon.up.railway.app) ·
[Docs](docs/) ·
[Assumptions](docs/ASSUMPTIONS.md) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Verification](docs/VERIFICATION.md)

![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Pydantic%20v2-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs&logoColor=white)
![Engine coverage floor](https://img.shields.io/badge/engine%20coverage%20floor-85%25-2ea44f)
![Numbers](https://img.shields.io/badge/numbers-deterministic%20Python-D93025)

<img src="docs/images/01-overview.png" alt="Hand-drawn illustration: three stacks of paper (income and spending, goals, ten risk answers) feed a small black character, who outputs a suggested allocation, a fund shortlist and a monthly SIP plan" width="860">

</div>

Built for **Fund Horizon**, an AMFI-registered mutual fund distributor (ARN 345439) that sells **Regular
plans only**. A customer answers about five minutes of questions and gets a plan they can read, question and
download. **Every number comes from deterministic Python** in [`backend/app/engine/`](backend/app/engine).
An optional language-model layer can *explain* a result in plain English, but it never calculates anything and
every number it writes is checked against the engine's output.

> **Illustrative only.** Output is an illustration based on assumed returns, not a recommendation or a
> guarantee. All user-facing wording lives in
> [`backend/app/config/disclosures.py`](backend/app/config/disclosures.py) and is marked
> `TODO(owner-compliance-review)` for sign-off.

---

## Contents
[What you get](#what-you-get) · [How it fits together](#how-it-fits-together) ·
[The plan pipeline](#the-plan-pipeline) · [Risk profile](#risk-profile-final--the-lower-score) ·
[Allocation and glide path](#allocation-and-the-glide-path) · [Fund shortlist](#fund-shortlist-filter-first-rank-second) ·
[Goals and Monte Carlo](#goal-planning-and-monte-carlo) · [Stress test](#stress-test-on-past-data) · [Tax planning](#smart-tax-planning) ·
[Beyond the plan](#beyond-the-plan) · [Quick start](#quick-start) · [Configure](#configure-assumptions) ·
[Database](#database-and-persistence) · [API](#api) · [Deploy](#deploy-railway) · [Quality](#quality-and-compliance) ·
[Credits](#credits)

---

## What you get

| Step | What the customer sees |
|---|---|
| **1. Profile** | Capacity (can they afford risk?) and comfort (can they stomach it?) scores. The lower one picks a band, with priority actions such as "Build emergency fund first". |
| **2. Allocate** | A suggested mix per goal (shorter goals hold less equity) and a goal-weighted portfolio mix. **Simple** view shows four buckets (equity, debt, gold, liquid); **Detailed** shows all nine categories. |
| **3. Shortlist** | An illustrative list of at most 8 Regular-plan funds ranked on past performance, each with a plain-English "why it ranked" and its next three ranked alternatives side by side. |
| **4. Stress test** | The suggested mix replayed on past NAVs, including the Feb-Mar 2020 fall. |
| **4b. Tax** | Old vs new regime for FY 2026-27, ranked saving ideas with on/off switches, an after-tax view of every goal, and a plain-English tax note on each shortlisted fund. |
| **5. Plan goals** | Future cost, SIP needed, funded or not, chance of success, and ways to close any gap. |
| **6. Safety net** | Emergency-fund target and gap, term and health cover gaps. When there is a gap, an illustrative shortlist of researched cover plans appears (curated October 2026; not a recommendation). |
| **7. PDF** | A branded report with the disclosures on every page. |

## How it fits together

```mermaid
flowchart LR
    subgraph Browser
      W["Next.js 14 app<br/>wizard, plan view, fund pages<br/>CAS upload, admin"]
    end
    subgraph API["FastAPI service"]
      R["routes + validation<br/>Pydantic v2"]
      E["engine/<br/>pure functions<br/>profile, allocate, plan, tax, analytics, CAS"]
      AI["ai/<br/>optional explanations<br/>LiteLLM + guardrails"]
      RAG["rag/<br/>fund Q&A<br/>ChromaDB"]
      P["report/<br/>ReportLab + matplotlib"]
      C["config/<br/>assumptions, allocation, scoring,<br/>tax rules + catalog, disclosures"]
    end
    D[("Dataset in memory<br/>3,638 schemes<br/>month-end NAVs")]
    S[("Plans, CAS sessions,<br/>scheme directory<br/>SQLite or PostgreSQL")]
    G["GitHub Action<br/>daily data refresh"]
    W -- "JSON over HTTPS" --> R
    R --> E
    R --> AI
    R --> RAG
    R --> P
    E --- C
    E --- D
    R --> S
    AI -. "reads engine output,<br/>checks every number" .-> E
    G --> S
    P -. "PDF" .-> W
```

The engine takes plain inputs and returns plain dictionaries. It never touches the network or the database, so
the same input always gives the same plan. The explanation layer sits *beside* it: it receives the engine's
output and may only rephrase it.

<p align="center">
<img src="docs/images/04-pure-engine.png" alt="Hand-drawn illustration: a small black character feeds a sheet into a box labelled pure functions and identical sheets come out every time; a speech bubble saying LLM maths is crossed out, with a note that an LLM may explain a result but never calculate it" width="760">
</p>

## The plan pipeline

```mermaid
flowchart LR
    A["Client + goals<br/>+ tax details<br/>+ 10 answers"] --> B["Profile<br/>capacity, comfort, band"]
    A --> T["Tax<br/>old vs new regime<br/>saving ideas, marginal rate"]
    T -- "after-tax switch,<br/>reinvested saving" --> C
    B --> C["Per-goal plan<br/>allocation by horizon<br/>future cost, SIP"]
    C --> D["Funding by priority<br/>surplus split across goals<br/>levers for any gap"]
    D --> E["Monte Carlo<br/>5,000 paths per goal"]
    C --> F["Portfolio mix<br/>weighted across goals"]
    F --> G["Fund shortlist<br/>filter, score, pick"]
    G --> H["Stress test<br/>on past NAVs"]
    T --> I
    E --> I(["Plan JSON<br/>+ PDF"])
    H --> I
    D --> I
```

```mermaid
sequenceDiagram
    autonumber
    actor U as Customer
    participant W as Web (Next.js)
    participant A as API (FastAPI)
    participant E as Engine
    participant DB as Database
    U->>W: Fill 5-step wizard, tick consent
    W->>A: POST /api/plans
    A->>A: Validate (age 18-80, 1-6 goals, 1-40 years)
    A->>E: build_full_plan(request, eligible funds)
    E-->>A: profile, allocation, funds, stress test, goals
    A->>DB: Save request + result under a random UUID
    A-->>W: Plan JSON
    W-->>U: Plan view
    U->>W: Toggle 5% yearly step-up
    W->>A: GET /api/plans/{id}?step_up=0.05
    A->>E: Recompute from the stored inputs
    A-->>W: Updated plan (not saved)
    U->>W: Flip Old regime, apply an idea, Show after tax
    W->>A: GET /api/plans/{id}?regime=old&apply=sec_80c&tax_view=post
    A->>E: Recompute with the tax switches
    A-->>W: Updated plan (not saved)
    U->>W: Ask for a plain-English explanation
    W->>A: POST /api/ai/explain/plan
    A-->>W: Explanation (numbers checked against the plan)
    U->>W: Download PDF report
    W->>A: GET /api/plans/{id}/report.pdf
    A-->>U: application/pdf
```

## Risk profile: final = the lower score

```mermaid
flowchart TD
    CAP["Capacity score 0-100<br/>age 20% · income stability 15% · dependents 10%<br/>savings rate 15% · emergency fund 15%<br/>net worth 10% · debt burden 10% · insurance 5%"]
    TOL["Comfort score 0-100<br/>10 questions, mean score rescaled"]
    CAP --> MIN{"final = min of the two"}
    TOL --> MIN
    MIN --> BAND["Band<br/>Conservative · Moderately Conservative · Moderate<br/>Moderately Aggressive · Aggressive"]
    MIN --> GAP{"gap above 25 points?"}
    GAP -- yes --> NOTE["Show which score is binding"]
    CAP --> EF{"emergency fund under 3 months?"}
    EF -- yes --> CAPMOD["Cap band at Moderate<br/>+ action: Build emergency fund first"]
    CAP --> INS{"dependents and no term cover?"}
    INS -- yes --> ACT["Action: Insurance first"]
```

<p align="center">
<img src="docs/images/02-take-the-lower.png" alt="Hand-drawn illustration: a tall bar for capacity 84 and a short bar for comfort 30; a red dashed line cuts the tall bar down to the short one, and a small black character points to the result, Moderately Conservative" width="760">
</p>

## Allocation and the glide path

Each band has a strategic mix. Each **goal** then caps its equity by how far away it is, and the freed money
moves to debt and liquid funds. A goal under three years holds no equity and no gold.

| Band | Equity | Debt | Gold | Liquid |
|---|---|---|---|---|
| Conservative | 15 | 65 | 5 | 15 |
| Moderately Conservative | 30 | 52 | 8 | 10 |
| Moderate | 50 | 33 | 10 | 7 |
| Moderately Aggressive | 70 | 18 | 8 | 4 |
| Aggressive | 85 | 7 | 6 | 2 |

| Goal years | Equity cap |
|---|---|
| 1–2 | 0% (50% liquid, 50% short duration) |
| 3–4 | 30% |
| 5–6 | 50% |
| 7–9 | 70% |
| 10 or more | none (the band's equity) |

<p align="center">
<img src="docs/images/03-glide-path.png" alt="Hand-drawn illustration: a staircase from ten years or more down to one to two years, with a balloon on each step shrinking from 85 percent to 0 percent equity" width="760">
</p>

## Fund shortlist: filter first, rank second

```mermaid
flowchart TD
    ALL["3,638 schemes in the dataset"] --> F1{"Regular plan,<br/>Growth option?"}
    F1 -- no --> X["Dropped (Direct plans are kept for a<br/>future cost comparison only)"]
    F1 -- yes --> F2{"Clean data?<br/>not segregated, stale,<br/>flat or shocked"}
    F2 -- no --> X
    F2 -- yes --> F3{"Open-ended, last NAV<br/>within 10 days?"}
    F3 -- no --> X
    F3 -- yes --> POOL["Eligible funds"]
    POOL --> CAT["Normalise old and new SEBI category names"]
    CAT --> H{"Enough history?<br/>5 yrs equity, 3 yrs other"}
    H -- no --> X
    H -- yes --> SC["Percentile-rank score inside the category<br/>growth: 5Y CAGR, rolling 3Y, Sharpe, drawdown<br/>income: 3Y CAGR, rolling 1Y, volatility"]
    SC --> PICK["Top 1 per category<br/>max 2 per AMC"]
    PICK --> MERGE["Merge positions under 5%<br/>cap at 8 funds"]
    MERGE --> OUT(["Illustrative shortlist<br/>+ next 3 alternatives per fund"])
```

<p align="center">
<img src="docs/images/06-shortlist-funnel.png" alt="Hand-drawn illustration: a cloud of eligible funds goes through a funnel; rejects (Direct, segregated, stale, demat-only) fall into a red box and the top picks come out the other side" width="760">
</p>

Liquid, overnight, money-market and short-duration funds are **never ranked on Sharpe**; it is unstable for
them. Funds are always keyed by `scheme_code` because scheme names repeat in AMFI data.

## Goal planning and Monte Carlo

- **Projections use editable assumptions**, not trailing returns: equity 11%, debt 6.5%, gold 7.5%,
  liquid 6%. Past data is used only to pick funds and to stress test.
- **Future cost** = today's cost grown at the goal's inflation (education 9%, marriage 7%, others 6%).
- **Retirement corpus** = present value of an inflation-growing annuity of yearly spending over the years
  to age 85.
- **Funding by priority.** If the SIPs needed exceed the monthly surplus, priority 1 goals are funded first;
  each shortfall gets recalculated levers: a longer horizon, a yearly step-up (5% or 10%), or a lower target.
- **Monte Carlo.** 5,000 seeded paths of correlated lognormal annual returns per goal give the chance of
  reaching the inflated goal, the P10 / P50 / P90 end values and the SIP needed for about 80% success.

**Funded is not the same as likely.** A goal sized at the planning return reaches its target on the central
path, so it shows roughly 50% success in the simulation. The plan view and PDF print the chance of success and
the SIP for about 80% next to the funded label. Planning figures are pre-tax; see
[`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) and the Monte Carlo limitations in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stress test on past data

<p align="center">
<img src="docs/images/05-stress-test.png" alt="Hand-drawn illustration: a line chart of a ten lakh rupee investment with a sharp dip circled in red at Feb to Mar 2020; a note says only month-end NAVs are used so intra-month lows are missed" width="760">
</p>

The suggested mix is replayed on month-end NAVs: the Feb-Mar 2020 fall, the worst peak-to-trough, and the worst
rolling 12 months. Funds without enough history borrow their category's median return and are flagged.

## Smart tax planning

The planner asks for your tax regime, income and bracket in two skippable wizard steps, then compares the old and
new regimes for FY 2026-27, ranks saving ideas by estimated rupees, and can size every goal on after-tax returns.
All of it is deterministic Python; the explainer may rephrase results but cannot change a number.

<p align="center">
<img src="docs/images/07-tax-fork.png" alt="Hand-drawn illustration: a small black character at a fork; the old regime sign lists 80C, NPS, 80D and HRA deductions with higher slab rates, the new regime sign says nil tax up to 12.75 lakh with fewer deductions and lower slab rates; the note says the code does the sums and you pick" width="760">
</p>

```mermaid
flowchart TD
    Q["Tax steps in the wizard<br/>regime, income or bracket,<br/>deductions, gains, preferences"] --> M{"Mode"}
    M -- "Work it out" --> R["Compare old vs new regime<br/>slabs, 87A rebate, surcharge, cess"]
    M -- "I know my bracket" --> B["Marginal rate from the bracket"]
    M -- "Skip" --> X["Tax features off"]
    R --> N["14 rules rank saving ideas<br/>80C, NPS, employer NPS, 80D, HRA,<br/>gain harvesting, FD vs funds, seniors"]
    B --> N
    N --> S["Switches<br/>Regime auto / old / new<br/>Apply an idea<br/>Show after tax<br/>Reinvest the tax I save"]
    S --> P["Plan recomputed<br/>(nothing stored)"]
```

| You get | How |
|---|---|
| **Regime comparison** | Tax, taxable income, deductions counted, break-even deductions, and whether using every old-regime limit would change the answer |
| **Saving ideas with switches** | Each idea shows its yearly saving, effort, lock-in and which regime it needs; **Apply** counts it in your tax and plan |
| **After-tax view** | Goals sized on returns after tax for their own horizon; a table shows the extra SIP needed |
| **Reinvest** | The monthly tax saved by applied ideas is added to your SIPs |
| **Every scheme explained** | `/learn` covers 24 options (PPF, EPF/VPF, NPS, ELSS, SSY, SCSS, NSC, FDs, bonds, insurance, equity, debt, gold and more): who it suits, lock-in, risk and how it is taxed |
| **Fund tax notes** | A tax chip on each shortlisted fund (equity-oriented, debt-oriented, 24-month rule, gold) |
| **Calculator** | `/tax` compares the regimes with no plan and nothing saved |

**Status of the rules:** compiled in October 2026 from public sources and **not yet reviewed by a chartered
accountant**; the UI, API and PDF say so. Sources, simplifications, the review checklist and the yearly update
steps are in [`docs/TAX_RULES.md`](docs/TAX_RULES.md). Scope is resident individuals.

## Beyond the plan

| Feature | Where | Notes |
|---|---|---|
| **Fund pages and analytics** | `/funds/[code]` | Deterministic analytics on each scheme's NAV series. |
| **Compare funds** | `/funds/compare` | Side-by-side metrics. |
| **Ask about any fund** | `/funds/ask` | Retrieval over a fund knowledge base (ChromaDB, `bge-small-en-v1.5` embeddings); answers are built from templates and live analytics. |
| **CAS upload and portfolio analysis** | `/cas` | CAMS / KFintech CAS PDFs are parsed **in memory**; the raw PDF and password are never written to disk or the database. |
| **Plain-English explanations** | "Explain" on plan, fund, CAS | Optional. A LiteLLM fallback chain (Groq, Gemini, OpenRouter, local Ollama, set in `config/ai.yaml`) rephrases engine output. Guardrails require every number to come from the payload, scan for banned wording, scrub personal data and append the disclosures. With no API keys configured the rest of the app still works. |
| **Admin Control Center** | `/admin` | Plan inspection, CAS session audit, scheme directory, assumptions view, data sync. The admin API **fails closed**: every call is refused until `FH_ADMIN_KEY` is set, and the admin page asks for the key. For local development only, `FH_ADMIN_OPEN=true` opens it. |
| **Daily data refresh** | `.github/workflows/daily-refresh.yml` | Weekdays 18:30 UTC (midnight IST) after AMFI publishes NAVs; `scripts/refresh_data.py` supports `--dry-run`. |

---

## Quick start

Needs Python 3.11+ (3.13 used), [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
make setup     # backend/.venv, Python deps, npm install, Playwright Chromium
make dev       # API on http://localhost:8000, web on http://localhost:3000
make test      # backend tests (engine coverage floor 85%) + Playwright end-to-end tests
make lint      # ruff, eslint, tsc, banned-wording scan
```

Optional: copy `backend/.env.example` to `backend/.env` (CORS origins, database, data dir, AI provider keys).
Set `NEXT_PUBLIC_API_URL` for the frontend if the API is not on `localhost:8000`. Public site links (sitemap,
robots, Open Graph) use `NEXT_PUBLIC_SITE_URL` (default `https://fundhorizon.up.railway.app`).

```text
backend/app/{api,engine,data,config,report,db,ai,rag}   FastAPI app, pure engine, config, PDF, storage, AI, retrieval
backend/tests/                                          tests; golden persona files in tests/golden
backend/{alembic,scripts}/                              migrations, data refresh
frontend/                                               Next.js 14 (App Router), Tailwind, Recharts
data/fundhorizon_mf_rag_dataset/                        metrics CSV + month-end NAVs (as of 2026-10-09)
deploy/                                                 Dockerfiles for Railway
docs/                                                   ARCHITECTURE, ASSUMPTIONS, VERIFICATION, images
PHASE_*_REPORT.md, ADMIN_PANEL_REPORT.md                what each build phase changed and how it was verified
```

## Configure assumptions

| File | Controls |
|---|---|
| `backend/app/config/assumptions.yaml` | returns, inflation, retirement, emergency fund, insurance, Monte Carlo, rebalancing |
| `backend/app/config/allocation.yaml` | band tables, horizon equity caps, category split, fund-count rules |
| `backend/app/config/scoring.yaml` | ranking weights |
| `backend/app/config/analytics.yaml` | fund analytics settings |
| `backend/app/config/tax_rules.yaml` | tax slabs, limits, capital gains, small-savings rates, sources, review status |
| `backend/app/config/tax_catalog.yaml` | the 24 explained options |
| `backend/app/config/mf_tax_classes.yaml` | how each fund category is taxed |
| `backend/app/config/ai.yaml` | explanation providers, guardrails, system prompt |
| `backend/app/config/questionnaire.json` | the ten risk questions |
| `backend/app/config/disclosures.py` | all compliance copy |

Restart the API after editing. A single plan can override values with `assumption_overrides` in the
`POST /api/plans` body. Every default and its rationale is in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).

**Refresh the data** (AMFI NAVAll + mfapi.in):

```bash
pip install pandas numpy
python data/fundhorizon_mf_rag_dataset/build_dataset.py /tmp/fh_new --include-direct --workers 16
```

Replace `all_schemes_metrics.csv`, `category_summary.csv` and `nav_monthly/`, update `data_asof` in
`assumptions.yaml`, run `make test`, review the new persona outputs, then regenerate the golden files with
`cd backend && .venv/bin/python -m tests.make_golden`.

## Database and persistence

```mermaid
flowchart LR
    API["API"] --> F{"DATABASE_URL set?"}
    F -- "no (default)" --> SQ[("SQLite<br/>plans.db / FH_DB_PATH")]
    F -- "postgresql://..." --> PG[("PostgreSQL via SQLAlchemy 2.0<br/>Supabase or Neon free tier")]
    PG --- AL["Alembic migrations"]
    JOB["scripts/refresh_data.py"] --> SQ
    JOB --> PG
```

By default plans live in local SQLite (`plans.db`). For persistent, multi-instance or serverless deployments
set `DATABASE_URL`:

- **Supabase** (transaction pooler, port 6543): `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
- **Neon**: `postgresql://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require`

```bash
cd backend && .venv/bin/alembic upgrade head          # create / update the schema
cd backend && .venv/bin/python scripts/refresh_data.py  # sync scheme directory and metrics
```

Plans **expire after `FH_PLAN_TTL_DAYS` (default 30)** and can be deleted by id.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | readiness |
| GET | `/api/questionnaire` | the ten questions |
| GET | `/api/meta` | disclosures, assumptions summary, data date, bands |
| POST | `/api/plans` | compute and save a plan, returns it with an `id` |
| GET | `/api/plans/{id}` | stored plan; `?step_up=`, `?regime=old`, `?tax_view=post`, `?apply=sec_80c,nps_1b`, `?reinvest=true` recompute without saving |
| DELETE | `/api/plans/{id}` | delete a plan |
| GET | `/api/plans/{id}/report.pdf` | client-ready PDF |
| GET | `/api/tax/rules` | the tax rules, sources and review status |
| GET | `/api/tax/catalog[/{id}]` | the explained options (`?q=` search, `?kind=` filter) |
| POST | `/api/tax/calc` | stateless tax calculator |
| GET | `/api/funds/{scheme_code}` | metrics and month-end NAV, with a tax note |
| GET | `/api/funds/{scheme_code}/analytics` | deterministic fund analytics |
| GET | `/api/funds/compare` | side-by-side comparison |
| GET | `/api/categories/{cat}/ranking` | ranking inside a category |
| POST | `/api/portfolio/analyze` | analyse a portfolio |
| POST | `/api/cas/upload` | parse a CAS PDF in memory |
| GET, POST | `/api/rag/ask` | ask about a fund |
| POST | `/api/rag/ingest` | build the knowledge base |
| POST | `/api/ai/explain/{plan,fund,cas,tax}` | optional plain-English explanation |
| — | `/api/admin/*` | admin control center (set `FH_ADMIN_KEY`) |

Validation errors return `422` with a readable message.

## Deploy (Railway)

```mermaid
flowchart LR
    U(("Customer")) --> WEB["web service<br/>deploy/web.Dockerfile<br/>Next.js"]
    WEB -- "NEXT_PUBLIC_API_URL<br/>(baked in at build)" --> API["api service<br/>deploy/api.Dockerfile<br/>uvicorn"]
    API --- DB[("Volume /data (SQLite)<br/>or DATABASE_URL (PostgreSQL)")]
    API --- IMG[("Dataset baked into the image")]
    GH["GitHub main"] -- "auto-deploy" --> WEB
    GH -- "auto-deploy" --> API
```

Two services built from the repo root with the Dockerfiles in `deploy/`:

| Service | Dockerfile | Variables |
|---|---|---|
| `api` | `deploy/api.Dockerfile` | `RAILWAY_DOCKERFILE_PATH`, `FH_DB_PATH=/data/plans.db` (volume at `/data`) **or** `DATABASE_URL`, `FH_CORS_ORIGINS=https://fundhorizon.up.railway.app`, `FH_ADMIN_KEY` (required to use `/admin`), optional AI provider keys |
| `web` | `deploy/web.Dockerfile` | `RAILWAY_DOCKERFILE_PATH`, `NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL` set to the api URL, `NEXT_PUBLIC_SITE_URL` |

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy `web` when they change. Railway auto-deploys from
`main`.

## Quality and compliance

| Check | What it covers |
|---|---|
| Backend tests | engine unit tests, API tests, persona golden files, PDF, compliance copy, AI guardrails, CAS, RAG, database |
| Engine coverage | floor of 85% enforced by `make test` |
| SIP anchors | ₹10,000 a month at 1% a month for 120 months = ₹23,00,387 (ordinary) and ₹23,23,391 (due) |
| Allocation | rows sum to 100 for every band and every horizon from 1 to 40 years |
| End to end | Playwright drives the wizard, the plan view and the PDF download |
| Tax maths | hand-computed cases: new regime nil at 12.75 L salaried, 97,500 at 15 L, surcharge marginal relief, old regime 10 L; persona numbers verified by hand |
| Wording | tests (including the tax YAML) and `frontend/scripts/check-copy.mjs` block "best", "guaranteed", "advice", "advisory" in code and UI copy |
| Privacy | no PAN, phone, email or address fields in the planner; first name and age only; consent checkbox; CAS files are never stored |

Per-phase results are in the `PHASE_*_REPORT.md` files and [`docs/VERIFICATION.md`](docs/VERIFICATION.md).
Decisions made where the brief was ambiguous are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Out of scope:** payments or orders, KYC, filing returns, tax for NRIs and HUFs, international funds, Direct-plan recommendations.
Extension points are marked `# EXTENSION:`.

## Credits

The hand-drawn illustrations (seven) in [`docs/images/`](docs/images) were drawn for this project in the style of
[**Ian Xiaohei Illustrations**](https://github.com/helloianneo/ian-xiaohei-illustrations) by Ian
([@helloianneo](https://github.com/helloianneo), MIT licence): white background, thin wobbly line, the small
black character "小黑" (Xiaohei), and sparse red, orange and blue notes. Xiaohei is part of Ian's visual
language; please keep this attribution if you reuse or adapt the images. The sources are
[`docs/illustrations/build.py`](docs/illustrations/build.py) (SVG) and
[`render.mjs`](docs/illustrations/render.mjs) (PNG).

Fund data: AMFI NAVAll and mfapi.in, as of 2026-10-09. Past performance may or may not be sustained.
