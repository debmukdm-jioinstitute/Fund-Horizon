<div align="center">

# Fund Horizon Planner

**Profile a customer, suggest a risk-based allocation, shortlist funds, and plan every goal. Then look inside any fund, read a CAS, and hand over a PDF.**

[**Live site**](https://fundhorizon.website) ·
[Docs](docs/) ·
[Assumptions](docs/ASSUMPTIONS.md) ·
[System architecture](#system-architecture-end-to-end) ·
[Design decisions](docs/ARCHITECTURE.md) ·
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
[What you get](#what-you-get) · [**System architecture**](#system-architecture-end-to-end) ·
[Plan engine](#how-the-plan-engine-fits-together) ·
[The plan pipeline](#the-plan-pipeline) · [Risk profile](#risk-profile-final--the-lower-score) ·
[Allocation and glide path](#allocation-and-the-glide-path) · [Fund shortlist](#fund-shortlist-filter-first-rank-second) ·
[Goals and Monte Carlo](#goal-planning-and-monte-carlo) · [Stress test](#stress-test-on-past-data) · [Tax planning](#smart-tax-planning) ·
[Beyond the plan](#beyond-the-plan) · [Quick start](#quick-start) · [Configure](#configure-assumptions) ·
[Database](#database-and-persistence) · [API](#api) · [Deploy](#12-deploying-and-operating) · [Quality](#quality-and-compliance) ·
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

## System architecture (end to end)

> This section explains the **whole running system**: what each piece is, where it lives, how the pieces talk to
> each other, how data gets in, and how code gets from GitHub to the live website. You do not need to know the code.
> Start with the picture, then read the table that explains each box.

### 1. The big picture

```mermaid
flowchart TB
    subgraph People["People"]
        CUST["Customers<br/>(plan, CRM view, chat)"]
        STAFF["Staff and admins<br/>(back office)"]
        QR["Visitors who scan a QR code<br/>(crossword, lead form)"]
    end

    subgraph CF["Cloudflare (free plan)"]
        DNS["DNS for fundhorizon.website"]
        WORKER["Web app<br/>Cloudflare Worker<br/>Next.js 14"]
        TUNNEL["Cloudflare Tunnel<br/>api.fundhorizon.website"]
    end

    subgraph AWS["AWS EC2 server (Mumbai)"]
        CFD["cloudflared<br/>(tunnel agent)"]
        API["API container<br/>FastAPI + Python"]
        DB[("SQLite database<br/>plans.db")]
        COBALT["cobalt container<br/>media download engine"]
        BK["Daily backup<br/>(cron, keeps 7 days)"]
    end

    subgraph GH["GitHub"]
        REPO["Code and data<br/>repository"]
        ACT["GitHub Actions<br/>scheduled data bots"]
    end

    subgraph EXT["Outside data and services"]
        AMFI["AMFI + mfapi.in<br/>fund NAVs"]
        MKT["NSE, FRED, ECB, Cboe, US Treasury,<br/>APMI, news RSS"]
        FS["Fund house websites<br/>factsheets, manager profiles"]
        OAI["OpenAI<br/>Responses API"]
    end

    GD["GoDaddy<br/>(domain registrar)"]

    CUST --> DNS
    STAFF --> DNS
    QR --> DNS
    GD -. "nameservers point to Cloudflare" .-> DNS
    DNS --> WORKER
    DNS --> TUNNEL
    WORKER -- "/api calls" --> TUNNEL
    TUNNEL --> CFD
    CFD --> API
    API --> DB
    API --> COBALT
    API --> OAI
    API -- "daily NAVs, live feeds" --> AMFI
    API -- "collector loop" --> MKT
    BK --> DB
    ACT --> AMFI
    ACT --> FS
    ACT -- "commit refreshed data" --> REPO
    REPO -- "docker build (redeploy)" --> API
    REPO -- "npm build and wrangler deploy" --> WORKER
```

**In one paragraph.** A visitor types `fundhorizon.website`. GoDaddy only *sold* the name; Cloudflare runs its DNS. Cloudflare
serves the **web app** (a Next.js site running as a Cloudflare Worker). Whenever the page needs data, it calls
`/api/...`, which Cloudflare forwards through a **tunnel** to a small **AWS server**. On that server a **Docker
container** runs the **Python API**, which reads and writes one **SQLite** file. Separately, **GitHub Actions** robots
refresh fund data on a schedule and commit it back to GitHub, and the API picks that data up whenever it is redeployed.

### 2. Every component in one table

| # | Component | What it is, in plain words | Where it runs | Built with | Code location |
|---|---|---|---|---|---|
| 1 | **Domain registrar** | The shop where the name `fundhorizon.website` was bought. Only holds ownership and the nameserver setting. | GoDaddy | n/a | n/a |
| 2 | **DNS** | The phone book: turns the name into the right server. | Cloudflare | Cloudflare DNS | n/a (dashboard) |
| 3 | **Web app** | Everything users see: landing page, plan wizard, customer area, staff back office. | Cloudflare Worker `fund-horizon-web` | Next.js 14, TypeScript, Tailwind, OpenNext | [`frontend/`](frontend) |
| 4 | **Cloudflare Tunnel** | A private pipe from Cloudflare to the server, so the server needs no open web port. | Cloudflare edge to the `cloudflared` service on EC2 | cloudflared | n/a (dashboard + service) |
| 5 | **API** | The brain: sign-in, plans, CRM, AI picks, PDFs, downloads, data feeds. | Docker container `fh-api` on EC2 | Python 3.12, FastAPI, Pydantic v2 | [`backend/app/`](backend/app) |
| 6 | **Database** | One file holding every account, plan, lead, chat message and market observation. | `/home/ubuntu/fhdata/plans.db` on EC2 | SQLite | [`backend/app/db/`](backend/app/db) |
| 7 | **cobalt** | Open-source engine behind the Download Content box. Not reachable from the internet. | Docker container `cobalt` on EC2 | Node.js (AGPL-3.0, unmodified) | [`deploy/redeploy.sh`](deploy/redeploy.sh) |
| 8 | **Server** | The one computer that runs 5, 6, 7 and the tunnel agent. | AWS EC2 `fund-horizon-api`, Mumbai | Ubuntu 24.04, Docker | [`deploy/`](deploy) |
| 9 | **Data bots** | Scheduled robots that download fund data and commit it to GitHub. | GitHub Actions | Python, Playwright | [`.github/workflows/`](.github/workflows) |
| 10 | **Fund dataset** | NAV history and metrics for about 3,600 schemes, shipped inside the API image. | In the repo, baked into the image | CSV files | [`data/`](data) |
| 11 | **AI layer** | Picks funds, writes plain-English explanations. Never does the maths. | Inside the API, calls OpenAI | OpenAI Responses API | [`backend/app/ai/`](backend/app/ai) |
| 12 | **Source code** | The single source of truth for everything above. | GitHub | git | this repository |

### 3. How a click travels (request path)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant E as Cloudflare edge
    participant W as Web app (Worker)
    participant T as Tunnel
    participant A as API container (EC2)
    participant D as SQLite file

    B->>E: GET https://fundhorizon.website/plan/123
    E->>W: run the Next.js app
    W-->>B: HTML and JavaScript
    B->>E: POST /api/auth/login (same website, so same origin)
    E->>W: Worker matches the /api/* rewrite
    W->>T: forwards to https://api.fundhorizon.website
    T->>A: through cloudflared to 127.0.0.1:8000
    A->>D: look up the account, check the password hash
    D-->>A: account row
    A-->>W: 200 plus Set-Cookie fh_session (HttpOnly, Secure)
    W-->>B: response and cookie
    Note over B,A: Every later call carries the cookie. The API only stores a hash of the session token.
```

Why the web app forwards `/api/*` itself: the browser then only ever talks to `fundhorizon.website`, so the login cookie
is first-party and no cross-site rules get in the way.

### 4. Domain and DNS

```mermaid
flowchart LR
    GD["GoDaddy<br/>owns the name"] -- "nameservers changed to<br/>damon / meilani .ns.cloudflare.com" --> CFZ["Cloudflare DNS zone"]
    CFZ -- "fundhorizon.website<br/>www.fundhorizon.website<br/>(Worker custom domains)" --> WK["Web app Worker"]
    CFZ -- "api.fundhorizon.website<br/>CNAME to the tunnel" --> TN["Cloudflare Tunnel"]
    TN --> EC["EC2: cloudflared then API"]
```

- `fundhorizon.website` and `www` are **Worker custom domains**, declared in [`frontend/wrangler.jsonc`](frontend/wrangler.jsonc).
- `api.fundhorizon.website` is a proxied CNAME to the tunnel; the tunnel's routing rule (`api.fundhorizon.website` to
  `http://127.0.0.1:8000`) is stored in Cloudflare.
- The old `fund-horizon-web.fundhorizon.workers.dev` address still works and is allowed by the API's CORS list.

### 5. The web app (frontend)

Next.js 14 (App Router). It is built into a Cloudflare Worker with **OpenNext** (`npm run cf:build`), so pages render on
Cloudflare's edge. All fonts are Google Sans (enforced by `npm run lint`); all user-facing wording passes a compliance check
(`frontend/scripts/check-copy.mjs`).

```mermaid
flowchart TB
    L["/  Landing page<br/>Customer box and Admin box"]
    L --> CU["Customer area<br/>/account/*"]
    L --> AD["Admin login<br/>/login"]
    AD --> BO["Back office<br/>/backoffice/*"]
    L --> PUB["Public tools<br/>plan wizard, CAS, tax, fund pages,<br/>crossword, lead form, risk profile link"]
    CU --> PL["My plans"]
    CU --> CRM["My CRM (read only)"]
    CU --> CH["Messages (chat with staff)"]
    PUB --> PV["Plan results /plan/id<br/>AI fund picks and backtest"]
    BO --> OPS["Operations<br/>form filling, download content"]
    BO --> RP["Risk profiling studio"]
    BO --> CRMB["CRM, chats, research, data health ..."]
```

| Area | Routes (under `frontend/app/`) | What it does |
|---|---|---|
| **Landing** | `/` | Two boxes: **Customer** (log in or create account) and **Admin** (goes to `/login`). Signed-in users are sent straight to their area. |
| **Customer area** | `/account/plans`, `/account/crm`, `/account/messages` | Their saved plans, a read-only view of their household, holdings, SIPs and service requests, and chat with the team. |
| **Plan and tools** | `/plan/new`, `/plan/[id]`, `/portal/[id]/*`, `/tax`, `/cas`, `/funds/*`, `/learn/*` | Five-minute plan wizard, results (allocation, shortlist, stress test, goals, tax, **AI fund picks with Edit and a backtest**), CAS statement reader, tax planner, fund detail, compare and Q&A, the Academy. |
| **Lead capture** | `/crossword`, `/lead`, `/risk-profile?ref=...` | Pages reached by QR code or a shared link. They post to the public lead endpoints and the lead lands in the CRM. |
| **Back office (staff)** | `/backoffice/*` | Overview, **Operations** (form filling, Download Content), **Risk profiling studio**, **CRM** (households, contacts, leads, opportunities, cases), **Customer chats**, mutual funds, PMS, derivatives, macro, micro, flows, impact, research, briefings, data health, Academy admin, settings. |
| **Admin tools** | `/admin` | Admin control centre (plans, CAS sessions, customers, config). |

Code layout:

| Folder | Holds |
|---|---|
| [`frontend/app/`](frontend/app) | One folder per route (`page.tsx`), plus `layout.tsx` (fonts, auth provider, theme). |
| [`frontend/components/`](frontend/components) | Reusable UI: `AuthContext` (who is signed in), `AiPicks`, `ChatThread`, `Results` (plan sections), `backoffice/*`, `operations/*` (PDF form filler, signature pad), `crm/*`, `academy/*`, `charts`. |
| [`frontend/lib/`](frontend/lib) | `api.ts` and the `crm*Api.ts` files (every call to the API), `types.ts`, formatting helpers, profiling questionnaire, recommended-fund list. |
| [`frontend/wrangler.jsonc`](frontend/wrangler.jsonc) | Worker name, custom domains, API address. |
| [`frontend/next.config.mjs`](frontend/next.config.mjs) | Security headers (CSP) and the `/api/*` rewrite to the API. |

### 6. The API (backend)

One FastAPI app, `backend/app/main.py`, which wires every router, the security middleware, and two background loops
(daily database backup and the market-data collector loop).

```mermaid
flowchart LR
    M["main.py<br/>app factory, CORS, rate limits,<br/>security headers, background loops"]
    M --> RT["api/ routers<br/>(HTTP endpoints)"]
    RT --> EN["engine/<br/>pure maths"]
    RT --> DBL["db/ and repo_crm_*<br/>read and write SQLite"]
    RT --> AIL["ai/<br/>picks, backtest, explain"]
    RT --> RPT["report/<br/>PDFs and charts"]
    RT --> BOF["backoffice/<br/>collectors, screening, briefings"]
    EN --> CFG["config/<br/>assumptions, allocation, scoring, tax rules,<br/>questionnaire, disclosures"]
    EN --> DS["data/<br/>dataset loader (CSV in memory)"]
    AIL --> DS
    AIL --> OAI(("OpenAI"))
    AIL --> MFA(("mfapi.in"))
    BOF --> FEEDS(("market feeds"))
    DBL --> SQ[("SQLite")]
    BOF --> SQ
    RT -. "cobalt" .-> CB(("download engine"))
```

**Routers (`backend/app/api/`)** (the doors into the API):

| File | Purpose |
|---|---|
| `routes.py` | Public plan API: create a plan, fetch it (with step-up and tax switches), PDF, fund detail, compare, CAS upload, tax, RAG Q&A, AI explain. |
| `portal.py` | Plan dashboard, health, analytics, partial update (recompute in place). |
| `plan_picks.py` | **AI fund picks**: generate once per plan, save the client's edited split, staff preview, backtest. |
| `auth.py` | Sign-up, login, logout, session cookie, roles, CSRF check, read-only **guest** login. |
| `customer_portal.py` | A customer's own CRM view, and **chat** (customer side and staff inbox). |
| `crm_core.py`, `crm_extras.py`, `crm_phase3.py`, `crm_products.py`, `crm_reports.py` | The CRM: households, contacts, leads (including the public `crossword`/`lead` endpoints), opportunities, cases, KYC, holdings, SIPs, campaigns, commissions, reports, CSV import. |
| `crm_auth.py` | Who may see which CRM rows (admin, relationship manager, compliance read-only). |
| `backoffice.py` | Staff data APIs: markets, funds, PMS, derivatives, macro, briefings, screening, **risk-profiling report PDF**, **operations filings register**, recommended-funds list. |
| `download.py` | **Download Content**: staff-only proxy to the cobalt container. |
| `learn.py` | The Academy: lessons, quizzes, flashcards, XP, leaderboard. |
| `admin.py`, `rm.py` | Admin control centre, relationship-manager helpers. |

**Engine and support packages:**

| Package | Purpose |
|---|---|
| [`engine/`](backend/app/engine) | The maths, as pure functions: `profiling` (risk score), `allocation`, `funds` (shortlist), `planning` and `montecarlo` (goals), `stress`, `tax*`, `insurance*`, `cas` (statement reader), `pipeline` (runs them in order), `portal` (recompute and analytics). |
| [`ai/`](backend/app/ai) | `picks.py` (fund picks), `backtest.py` (past performance of a split), `explain.py` (plain-English explanations), `guardrails.py` (banned wording, number checks, PII scrub), `client.py` (OpenAI and fallback providers). |
| [`report/`](backend/app/report) | PDFs with ReportLab and charts with matplotlib: plan report, risk-profile report, insurance doc, form filler. Fonts are Google Sans only. |
| [`backoffice/`](backend/app/backoffice) | The market-data side: `collectors.py` (scheduler), `providers/` (one file per feed), `analytics/` (briefing, derivatives, yields, PMS maths), `screening/` (fund screener), `fh_recommended.py` (the FH Recommended list), `mf_reference.py` (reference data). |
| [`db/`](backend/app/db) and `repo_crm_*.py` | Database access: SQLite (live), plus PostgreSQL and Cloudflare D1 adapters kept for other setups. Alembic migrations in `backend/alembic/`. |
| [`models/`](backend/app/models) | CRM and Academy table definitions (SQLAlchemy). |
| [`config/`](backend/app/config) | Editable rules: `assumptions.yaml`, `allocation.yaml`, `scoring.yaml`, `questionnaire.json`, tax rules and catalog, `ai.yaml`, and `disclosures.py` (all compliance wording). |
| [`data/`](backend/app/data) | Loads the fund dataset (CSV) once at start-up; Academy and insurance content. |
| [`rag/`](backend/app/rag) | Fund Q&A over the dataset (ChromaDB, off by default). |
| [`storage/`](backend/app/storage) and `backup.py` | Optional R2 file storage and the daily SQLite backup. |
| [`cli/bootstrap_admin.py`](backend/app/cli/bootstrap_admin.py) | Command to create or promote a staff account. |

### 7. How data gets in (GitHub, GitHub Actions, live feeds)

There are **three separate ways** data enters the system. Keeping them apart is the key to understanding it.

```mermaid
flowchart TB
    subgraph A["Way 1: GitHub Actions bots (scheduled, results stored in the repo)"]
        W1["Daily Data Refresh<br/>weekdays 00:00 IST"]
        W2["Factsheet Links (browser)<br/>daily 08:00 IST"]
        W3["Fund Manager Profiles<br/>Sundays 08:30 IST"]
    end
    subgraph SRC["Public sources"]
        AM["AMFI NAV file + mfapi.in<br/>every scheme's NAV history"]
        FH["Fund house websites<br/>(Chromium via Playwright)"]
        MP["Manager profile pages"]
    end
    REPO[("GitHub repository<br/>main branch<br/>data/ folder")]
    W1 --> AM
    W2 --> FH
    W3 --> MP
    W1 -- "all_schemes_metrics.csv<br/>category_summary.csv<br/>nav_monthly/*.csv" --> REPO
    W2 -- "factsheet_links/browser.json" --> REPO
    W3 -- "mf_manager_profiles.json" --> REPO
    REPO -- "docker build<br/>(redeploy.sh)" --> IMG["API image<br/>dataset baked in"]
    IMG --> RUN["Running API<br/>loads the CSVs into memory at start-up"]

    subgraph B["Way 2: the API's own collector loop (runs inside the container, writes to SQLite)"]
        CL["collectors.py<br/>wakes every 60 s,<br/>runs each source when due"]
    end
    CL -- "NSE, ECB, Cboe, Treasury, FRED,<br/>AMFI, APMI, RSS, India yields,<br/>factsheets, screening" --> RUN
    RUN --> SQ[("SQLite: observations,<br/>briefings, news, screening")]

    subgraph C["Way 3: live look-ups at the moment a user asks"]
        BT["Backtest of a fund split<br/>daily NAVs from mfapi.in<br/>cached for the day"]
    end
    RUN --> BT
```

**Way 1: GitHub Actions bots.** The workflow files are in [`.github/workflows/`](.github/workflows). Each runs on a schedule on GitHub's
own computers (free), does its job, and **commits the result back to `main`** as the user `fh-data-bot`. Nothing here touches
the live server directly.

| Workflow | Schedule (UTC) | Does | Writes (committed to `main`) |
|---|---|---|---|
| **Daily Data Refresh** (`daily-refresh.yml`) | `30 18 * * 1-5` (00:00 IST, Mon-Fri) | Rebuilds returns for every scheme from the AMFI file and mfapi.in; refuses to overwrite if the new file has under 90% of the old rows; then runs `backend/scripts/refresh_data.py` | `data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv`, `category_summary.csv`, `nav_monthly/*.csv` |
| **Factsheet Links (browser)** (`factsheets-browser.yml`) | `30 2 * * *` (08:00 IST daily) | Opens fund-house websites in headless Chromium and collects factsheet download links | `data/factsheet_links/browser.json` |
| **Fund Manager Profiles** (`manager-profiles.yml`) | `0 3 * * 0` (08:30 IST Sundays) | Refreshes fund manager profile data | `data/mf_manager_profiles.json` |
| **Heavy Jobs (D1 / R2)** (`heavy-jobs.yml`) | `0 2 * * *` | Left over from the old Cloudflare-only design. **Not part of the live system.** | none that matter |

All four can also be started by hand (**Actions** tab, then **Run workflow**).

> **Important to know.** A bot commit updates the *repository*. The running API holds a **copy of the dataset baked into its Docker
> image**, so fresh bot data reaches the live site the next time the API is **redeployed** (section 12). Live NAVs for the backtest
> are the exception: they are fetched from mfapi.in at request time (Way 3).

**Way 2: the collector loop.** Inside the API container, `backoffice/collectors.py` checks every 60 seconds which sources are due,
fetches them, and stores the numbers in SQLite. The back-office pages (Overview, Macro, Micro, Derivatives, Flows, Briefings,
Data health) read from there.

| Source id | Feed | Runs every |
|---|---|---|
| `SRC_NSE_FNO` | NSE index levels, India VIX, option chains and flows | 5 min |
| `SRC_RSS` | News headlines | 10 min |
| `SRC_IN_YIELDS` | India government bond yields | 30 min |
| `SRC_ECB`, `SRC_CBOE`, `SRC_TREASURY`, `SRC_FRED` | ECB rates, Cboe volatility, US Treasury yields, FRED series (FRED needs `FRED_API_KEY`) | 1 hour |
| `SRC_AMFI`, `SRC_FACTSHEETS` | AMFI scheme master and NAV, factsheet source list | 6 hours |
| `SRC_APMI` | PMS universe | 12 hours |
| `SRC_AMFI_TER`, `SRC_SCREENING` | Expense ratios, fund screening funnel | 24 hours |

After a failure a source retries soon instead of waiting its full interval. Each run is logged in `collector_runs`
and shown on the Data health page.

**Way 3: live look-ups.** The **backtest** under the AI fund picks calls `api.mfapi.in/mf/<code>` for each chosen fund
(in parallel), keeps the result in memory for the day, and falls back to the monthly files shipped in the image if mfapi.in is down.

### 8. The database

One SQLite file, `plans.db`, on the server's disk (mounted into the API container as `/dbdata/plans.db`).

| Group | Tables (examples) | Written by |
|---|---|---|
| **Accounts and sessions** | `customers` (role, is_staff, password hash), `sessions` (only a hash of the token) | `api/auth.py` |
| **Plans** | `plans` (stored request and result, by random UUID), `plan_ai_picks` (AI picks and the client's edits), `cas_sessions` | `routes.py`, `plan_picks.py` |
| **CRM** | `households`, `household_members`, `contacts`, `leads`, `opportunities`, `activities`, `cases`, `holdings`, `sip_schedules`, `kyc_records`, `mandates`, `consents`, `campaigns`, `commissions`, `rm_teams`, `crm_list_views`, `audit_log` | `crm_*.py` |
| **Chat** | `chat_messages` (one thread per customer) | `customer_portal.py` |
| **Operations** | `operations_filings` (the filings register) | `backoffice.py` |
| **Market data** | `observations`, `instrument_registry`, `source_registry`, `collector_runs`, `briefings`, `news_items`, `option_*`, `flows`, `pms_*`, `mf_*`, `screening_*`, `mfref_*` | `backoffice/` collectors |
| **Academy** | `learn_progress`, `quiz_attempts`, `card_reviews`, `xp_events`, `badges`, `learn_prefs` | `learn.py` |

- **Migrations.** Alembic (`backend/alembic/`) creates and changes tables. The container refuses to start if migrations fail.
- **Backups.** A cron job on the server runs daily and keeps the last 7 copies in `/home/ubuntu/backups` (same disk). The API also writes its own
  daily backup file inside the container. **Neither is off-server today.** Copying backups to Cloudflare R2 or S3 is the recommended next step.
- **Other database back ends** (PostgreSQL, Cloudflare D1) exist in `backend/app/db/` for other setups but are **not used** in production.

### 9. The AI layer

The AI never calculates. Python computes every number; the AI only chooses among funds Fund Horizon has already approved and
writes short wording, and everything it says is checked.

```mermaid
flowchart LR
    P["Finished plan or risk profile<br/>band + asset allocation"] --> SL["Shortlist<br/>top 2 funds per category<br/>from the FH Recommended list"]
    MK["Market snapshot<br/>latest daily briefing"] --> PR
    SL --> PR["Compact prompt<br/>about 500 tokens"]
    PR --> OA["OpenAI Responses API<br/>low reasoning effort"]
    OA --> VAL{"Validate"}
    VAL -- "codes on the FH list,<br/>weights total 100,<br/>no digits or banned words" --> OK["AI picks"]
    VAL -- "any check fails<br/>or no answer" --> RULE["Fixed rule picks<br/>(highest 3Y Sharpe per category)"]
    OK --> ST[("Stored in plan_ai_picks<br/>(AI runs once per plan)")]
    RULE --> ST
    ST --> UI["Plan page or Risk profiling studio<br/>weights, reasons, Edit"]
    UI -- "client edits weights" --> SAVE["Saved after server re-check:<br/>only FH funds, total 100"]
    UI --> BT["Backtest (daily NAVs)"]
    BT --> UI
    UI --> PDF["PDF report<br/>picks table + backtest"]
```

- **Funds can only come from the FH Recommended list** (`backend/app/backoffice/fh_recommended.py`, editable in the back office).
  Anything else is rejected server-side, even if the browser asks for it.
- **Token saving:** the AI sees about 11 of 31 candidate funds as short number rows, answers in short arrays, runs at low reasoning effort,
  and results are cached by risk band and allocation. A typical call is about 800 tokens in total.
- **Backtest** (`ai/backtest.py`): holds the chosen funds at their weights, rebalanced each day, using daily NAVs. A fund that did not exist yet is left out
  of the early period and the others are rescaled, so history reaches back to the oldest fund. It reports 1, 3, 5 and 10 year annualised return, whole-window return, volatility,
  maximum drawdown and worst 12 months. Past data only.
- **Explanation layer** (`ai/explain.py`, `guardrails.py`): optional plain-English summaries; every number in the text must exist in the engine's output, and banned
  wording (such as "best", "guaranteed", "advice") is blocked. It is off unless enabled (`FH_AI_ENABLED`).
- **Key and model:** `OPENAI_API_KEY` is stored only on the server (`/home/ubuntu/fh.env`), never in Git. `FH_OPENAI_MODEL` (default `gpt-6-luna`) and
  `FH_OPENAI_EFFORT` (default `low`) can change the model and effort.

### 10. Key journeys, step by step

**A. A customer creates an account, builds a plan and gets AI picks**

```mermaid
sequenceDiagram
    autonumber
    participant C as Customer
    participant W as Web app
    participant A as API
    participant D as SQLite
    participant O as OpenAI
    participant M as mfapi.in
    C->>W: Landing page: Create account
    W->>A: POST /api/auth/signup
    A->>D: insert customer (password hashed)
    A-->>C: session cookie, go to /account/plans
    C->>W: New plan: answers the wizard
    W->>A: POST /api/plans
    A->>A: engine: profile, allocation, goals, shortlist, stress test
    A->>D: store plan (UUID)
    C->>W: open /plan/UUID
    W->>A: GET /api/plans/UUID/ai-picks
    A->>O: compact prompt (first time only)
    O-->>A: picks as JSON
    A->>A: validate against the FH Recommended list
    A->>D: store plan_ai_picks
    A->>M: daily NAVs for the backtest
    A-->>C: picks, reasons, backtest
    C->>W: Edit, change weights, Save
    W->>A: PUT /api/plans/UUID/ai-picks
    A->>A: check FH funds only, total 100
    A->>D: save the edited split
```

**B. A QR code scan becomes a lead in the CRM**

```mermaid
flowchart LR
    Q["Printed QR code"] --> P["/crossword or /lead page"]
    P -- "POST /api/crm/public/crossword<br/>or /public/lead" --> A["API<br/>validated"]
    A --> L[("leads table<br/>source = qr_code or crossword")]
    L --> CRM["Back office CRM, Leads"]
    CRM --> X["Export CSV or Excel,<br/>assign to a relationship manager"]
```

**C. Staff prepare a risk profile and a PDF**

```mermaid
flowchart LR
    S["Staff: Risk profiling studio"] --> F["Client details + 10 questions"]
    F --> SC["Live score in the browser<br/>capacity vs tolerance, lower one wins"]
    SC --> AL["Target allocation:<br/>equity, debt, gold, liquid"]
    AL --> GP["Get AI fund picks, then Edit"]
    GP --> PDF["Download PDF<br/>POST /api/backoffice/risk-profiling/report.pdf"]
    PDF --> OUT["Page 1: profile and allocation<br/>Page 2: AI picks and backtest<br/>Page 3: questionnaire and sign-off"]
    F -. "share link" .-> CL["Client link /risk-profile?ref=..."]
    CL --> CRMW["Lead, account and suitability record created"]
```

**D. Customer and staff chat**

```mermaid
flowchart LR
    CU["Customer: Messages tab"] -- "POST /api/me/messages" --> T[("chat_messages<br/>one thread per customer")]
    T -- "GET /api/staff/chats (unread count)" --> ST["Staff: Customer chats"]
    ST -- "POST /api/staff/chats/customer_id" --> T
    T -- "refresh every 8 s" --> CU
```

The guest login cannot open the staff inbox.

**E. Operations: form filling and Download Content**

```mermaid
flowchart TB
    OP["Back office: Operations"] --> FF["Form filling box"]
    OP --> DL["Download Content box"]
    FF --> T1["Start a task, Forms library,<br/>Filings register, upload your own PDF"]
    T1 --> PF["Official AMC / CAMS / KFintech PDF<br/>filled and signed in the browser<br/>(PdfFormFiller)"]
    PF --> FR[("operations_filings")]
    DL --> LK["Paste a link"]
    LK --> AP["API: POST /api/staff/download<br/>(staff only)"]
    AP --> CB["cobalt container<br/>(private network)"]
    CB --> FILE["File streamed back through<br/>/api/staff/download/file"]
```

### 11. Security and access

| Topic | How it works |
|---|---|
| **Sessions** | HttpOnly, Secure cookie `fh_session`; the database keeps only a SHA-256 hash of the token. Passwords use PBKDF2-HMAC-SHA256 (600,000 rounds). |
| **Roles** | `customer`, and staff roles `admin`, `analyst`, `rm`, `operations`, `read_only`, `compliance`. CRM rows are scoped (RMs see their team; admin and compliance see all; compliance is read-only). |
| **Guest login** | A passwordless **read-only** staff session, switched on by `FH_GUEST_LOGIN`. Any write is refused; it cannot use staff chat. **It exposes staff data to anyone with the link, so turn it off for real use.** |
| **Public sign-up** | Allowed because `FH_INTERNAL_ONLY=false` on the server. |
| **Protection** | Rate limits on sign-in and on plan creation and recompute (public lead forms are validated); CSRF check on cookie-authenticated writes; CORS allow-list (`FH_CORS_ORIGINS`); strict security headers and a Content-Security-Policy. |
| **Plan links** | A plan is reachable by its random UUID (no login). Treat plan links like private links. |
| **Secrets** | Never in Git. `OPENAI_API_KEY` in `/home/ubuntu/fh.env` (permissions 600). The tunnel token lives in the `cloudflared` service on the server. |
| **Server access** | AWS **Session Manager** (browser terminal, no open ports needed). SSH is limited to one IP address in the AWS security group. No web port is open: all traffic comes through the tunnel. |
| **Compliance guardrails** | Wording is centralised in `config/disclosures.py`; the build blocks words like "best", "guaranteed", "advice", "advisory"; the AI cannot invent numbers. Output is illustrative only. |

### 12. Deploying and operating

There is **no automatic deploy**. Pushing to `main` updates GitHub only. Two deliberate manual steps put code live.

```mermaid
flowchart LR
    DEV["Developer pushes to main"] --> GHB["GitHub main"]
    GHB --> WEBD["Web: from frontend/<br/>npm run cf:build<br/>npx opennextjs-cloudflare deploy"]
    WEBD --> CFW["Cloudflare Worker updated"]
    GHB --> APID["API: in AWS Session Manager run<br/>curl .../deploy/redeploy.sh | sudo -iu ubuntu bash"]
    APID --> EC["On EC2: git clone, docker build,<br/>replace container fh-api"]
```

**Deploy the web app** (from `frontend/`, on a machine logged in to Cloudflare with `wrangler`):

```bash
export NEXT_PUBLIC_SITE_URL=https://fundhorizon.website
npm run cf:build
npx opennextjs-cloudflare deploy
```

The API address is baked in at build time (`https://api.fundhorizon.website`, set in `frontend/package.json` and `frontend/wrangler.jsonc`).

**Deploy the API** (AWS console, then Systems Manager, **Session Manager**, pick `fund-horizon-api`, **Start session**, then paste):

```bash
curl -sL https://raw.githubusercontent.com/debmukdm-jioinstitute/Fund-Horizon/main/deploy/redeploy.sh | sudo -iu ubuntu bash
```

> Always keep `sudo -iu ubuntu`. Session Manager logs in as `ssm-user`, which cannot read `/home/ubuntu`; without it the script silently rebuilds the old copy.

The script clones the latest `main`, builds the image from [`deploy/api.Dockerfile`](deploy/api.Dockerfile) (this is where fresh bot data is picked up), and restarts the
container with these settings:

| Setting | Value | Meaning |
|---|---|---|
| `FH_DB_PATH` | `/dbdata/plans.db` | Where the database file is (mounted from `/home/ubuntu/fhdata`). |
| `FH_COOKIE_SECURE` | `true` | Cookies only over HTTPS. |
| `FH_GUEST_LOGIN` | `1` | Enables the read-only guest button. |
| `FH_INTERNAL_ONLY` | `false` | Allows public customer sign-up. |
| `FH_SEED_CRM` | `false` | Never insert demo CRM data. |
| `FH_COBALT_URL` | `http://cobalt:9000` | The download engine, on the private Docker network `fhnet`. |
| `FH_CORS_ORIGINS` | the website domains | Which sites may call the API. |
| `OPENAI_API_KEY` | from `fh.env` | Enables the AI picks. |
| defaults in the image | `FH_BACKOFFICE_COLLECTORS=true`, `FH_AI_ENABLED=false`, `FH_RATE_LIMIT=true`, `FH_REQUIRE_PRODUCTION_MIGRATIONS=true` | See the Dockerfile. |

**Health check:** `https://api.fundhorizon.website/health` returns `{"ok":true,...}`.

**On the server, things that run by themselves:** `docker` (containers `fh-api` and `cobalt`, both restart automatically), the `cloudflared` service (the tunnel), and a daily
backup cron job.

### 13. Retired and unused parts (kept so nothing is lost)

| Item | Status |
|---|---|
| **Railway** (old host) | Retired. `deploy/web.Dockerfile` and the "Deploy (Railway)" notes were for it. |
| **Cloudflare Python Worker API** (`backend/src/entry.py`, `backend/app/worker_app.py`, `backend/wrangler.jsonc`) and the Worker `fund-horizon-api` | An earlier attempt to run the API on Cloudflare's free plan. It only covers part of the routes and is **not used**. |
| **Cloudflare D1 and R2** | D1 holds an old snapshot; R2 bucket `fund-horizon-files` exists. Neither is read by the live API. |
| **`heavy-jobs.yml`** | Belongs to that Worker design. |
| **Internal-network option** (`deploy/compose.internal.yml`, nginx) | An alternative for hosting inside an office network; not in use. |

### 14. Quality gates

| Check | Command | Covers |
|---|---|---|
| Backend tests | `make test` (pytest) | Engine, API, AI picks and backtest, PDFs (including fonts), chat, downloads, compliance wording. |
| Font and wording lint | `npm run lint` in `frontend/` | Google Sans only; no banned compliance words in the UI. The build also runs the font check. |
| End to end | Playwright (`frontend/e2e/`) | Wizard, plan view, PDF download, fonts. |

### 15. Glossary (for non-engineers)

| Term | Meaning |
|---|---|
| **API** | The server program that answers the website's questions ("save this plan", "list my leads"). |
| **Worker** | A small program Cloudflare runs close to the user. Here it runs the website. |
| **Tunnel** | A private, outbound-only connection from the server to Cloudflare, so the server needs no public door. |
| **EC2** | A rented computer from Amazon Web Services. |
| **Docker container** | A sealed box holding a program and everything it needs, so it runs the same everywhere. |
| **SQLite** | A database that is one ordinary file. |
| **GitHub Actions** | Robots on GitHub that run scripts on a schedule. |
| **CORS / CSRF** | Browser safety rules that stop other websites from using your login. |
| **NAV** | Net Asset Value: a mutual fund's price per unit. |
| **Backtest** | Replaying a fund mix over past prices to see how it would have behaved. Not a forecast. |
| **FH Recommended list** | The funds Fund Horizon has approved; AI picks come only from it. |
| **Session Manager** | AWS's browser-based terminal for the server. |

---

## How the plan engine fits together

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
robots, Open Graph) use `NEXT_PUBLIC_SITE_URL` (default `https://fundhorizon.website`).

```text
backend/app/{api,engine,data,config,report,db,ai,rag}   FastAPI app, pure engine, config, PDF, storage, AI, retrieval
backend/tests/                                          tests; golden persona files in tests/golden
backend/{alembic,scripts}/                              migrations, data refresh
frontend/                                               Next.js 14 (App Router), Tailwind, Recharts
data/fundhorizon_mf_rag_dataset/                        metrics CSV + month-end NAVs (as of 2026-10-09)
deploy/                                                 Dockerfiles and the server redeploy script
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

## Deploy

The live site runs on **Cloudflare (web) and AWS EC2 (API)**; Railway is retired. The full, current procedure is in
[System architecture, section 12](#12-deploying-and-operating).

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
