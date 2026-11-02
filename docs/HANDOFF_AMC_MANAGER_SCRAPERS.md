# Handoff: fill fund manager start dates from each fund house's own site

For the agent executing this (Antigravity). Read all of it before touching code. Work in the repo root
`Fund-Horizon/` (GitHub `debmukdm-jioinstitute/Fund-Horizon`, branch `main`). Report back with the final commit hash,
what ran, what you could not verify. Do not claim anything is live until you have checked the deploy runs listed in section 9.

## 1. Goal

The FH score (0-100) has a "fund manager and history" filter worth 20 points. It needs, per scheme, the current manager's
name and the date they started. Today about 2,931 of 3,661 schemes have a manager name, but only about 1,180 have a start
date, so manager tenure is unknown for roughly two thirds of funds and their scores stay partial.

Deliverable: a per-AMC collector that reads each fund house's own public pages or factsheets, extracts
(scheme, manager name, manager start date), and writes them into the manager cache so the existing resolver picks them up.
Start with the biggest AMCs (section 6), then widen.

Success measure (run before and after, see section 7): number of schemes with a non-null `manager_start`
in the resolved map. Target: at least 2,500 of 3,661, and never lower than the current figure.

## 2. What already exists (do not rebuild)

| Piece | Path | Role |
|---|---|---|
| Manager resolver | `backend/app/backoffice/manager_resolver.py` | Merges sources into table `mf_managers`. Order: stored rows, seed CSV, **cache CSVs**, AMFI snapshot, plan sibling. Never overwrites existing rows. |
| Cache drop folder | `data/mf_manager_cache/*.csv` (+ README.md) | **Your output goes here.** Columns: `scheme_code, manager_name, manager_start, source, url, fetched_at`. |
| Seed | `data/mf_managers_seed.csv` | 957 hand seeded rows. |
| AMFI snapshot | `data/India_MF_Static_Reference_Consolidated.csv.gz` | Gives names for about 2,274 schemes, start dates for few. |
| Per-AMC parser pattern to copy | `backend/app/backoffice/holdings_amc.py`, `holdings_ingest.py`, `scripts/ingest_holdings_amc.py` | Existing per-AMC download and parse code, monthly workflow `.github/workflows/holdings-refresh.yml`. |
| Factsheet links | `data/factsheet_links/`, `backend/app/backoffice/providers/factsheets.py` | Per-AMC factsheet URLs already collected. |
| Scheme universe | `backend/app/backoffice/mf_screener.py` (`_base_frame()`: columns `code, name, amc, plan, cat, isin`) | The 3,661 schemes you must match to. |
| Score engine | `backend/app/backoffice/fh_score.py` | Consumes `manager_tenure_years`. No change needed. |
| Sync entry point | `manager_resolver.sync_managers(repo)` | Runs at API startup and in the nightly screening job (`screening/jobs.py` `seed_managers`). |

Flow: your CSV -> `data/mf_manager_cache/` -> `sync_managers` adds rows for schemes that have no manager row yet ->
screener frame -> FH score. Important: `sync_managers` only inserts schemes absent from `mf_managers`. Schemes that already
have a name but no start date will NOT be updated by your CSV. Section 5 task B fixes that. Do it.

## 3. Rules you must follow (from `CLAUDE.md`, memory and the owner)

- Fonts: Google Sans only. No new fonts. `frontend/scripts/check-fonts.mjs` runs in lint and build. This task is backend only, so you should not touch the frontend.
- Compliance: respect each site's `robots.txt` (use `urllib.robotparser`, UA `FundHorizon-Backoffice/1.0 (internal-research)`). Never solve or bypass a CAPTCHA or bot check. Never call an API a robots.txt disallows (Groww `/v1/api/*` is disallowed). If an AMC site blocks you, skip it, list it in the report, move on. Do not scrape Moneycontrol, Google Finance or Groww APIs.
- Never invent data. Unknown start date stays empty. Do not guess from names. Do not copy a date from another fund unless the resolver's plan-sibling rule does it.
- Dates are shown DD-MM-YYYY on the site but store ISO `YYYY-MM-DD` in CSVs. Times IST.
- Never push `backend/uv.lock`, `.DS_Store`, or other people's files. Stage only files you changed, by name. Never `git add -A`.
- Never skip hooks or force push. Commit message ends with the line `Co-Authored-By: claude-flow <ruv@ruv.net>`.
- API deploys take about 25-30 minutes (image is built on the EC2 box). Batch backend changes into ONE push where you can.
- Do not ask the owner to deploy anything by hand. Pushing to `main` deploys.

## 4. Environment

```bash
cd Fund-Horizon/backend
.venv/bin/python -m pytest -q tests/test_manager_resolver.py   # must pass before you start
```

Use `backend/.venv/bin/python` (system python lacks `pypfopt`). Existing deps include `httpx`, `beautifulsoup4`, `pandas`.
Do not add a dependency for a few lines. PDF factsheets: check what `holdings_amc.py` already uses before adding anything.

## 5. Tasks

### A. Collector script (new): `backend/scripts/collect_amc_managers.py`

- One function per AMC, registered in a dict `AMC_COLLECTORS: dict[str, Callable]`, each returning a list of
  `{scheme_name, plan (optional), manager_name, manager_start (ISO or None), url}`. Copy the structure of `holdings_amc.py`.
- Match each result to an AMFI `scheme_code` using the screener frame, not by guessing: same `amc`, `fund_quartile.name_key()`
  equality on the scheme name (it strips plan and option words), and plan if the source states it. If a name matches
  several codes (Regular and Direct), emit one CSV row per code. Unmatched names go to a report list, never to the CSV.
- Output one file per AMC: `data/mf_manager_cache/<amc_slug>.csv` with the exact columns in section 2, `source` =
  `amc_site:<amc_slug>`, `fetched_at` = today ISO date, `url` = the page the value came from.
- Politeness: 1 request per second per host, timeout 30 s, retries 2, cache raw HTML/PDF under a git-ignored temp folder.
- Dry-run flag `--dry-run` prints counts and a sample, writes nothing. Flag `--amc <slug>` runs one AMC.
- Exit non-zero if an AMC that returned data before now returns zero rows (layout change), so a workflow can alert.

### B. Let start dates fill existing name-only rows (edit `manager_resolver.py`)

In `sync_managers`, also update a stored row when ALL hold: its `manager_start` is null, its `source` is not `manual_import`
(never touch staff edits), and a higher-trust layer (seed, cache, AMFI) has the SAME manager name (compare with `_name_key`
lowercase, titles removed) with a non-null start. Update only `manager_start`, `source`, `provenance`. Needs a small repository
method (`backend/app/backoffice/repository.py`, next to `upsert_mf_managers`) that updates by `scheme_code` without clobbering other
fields. Add tests in `backend/tests/test_manager_resolver.py` for: fills missing start on same name; does not change when names differ;
never touches `manual_import`; does not overwrite an existing start.

### C. Scheduled refresh (new workflow): `.github/workflows/amc-managers-refresh.yml`

Model it on `.github/workflows/holdings-refresh.yml` (monthly cron, `workflow_dispatch`, commits changed CSVs to `main`
with the same bot approach that file uses). Run `backend/scripts/collect_amc_managers.py`. Fail the job if the
non-null start count drops. Do not enable a schedule tighter than monthly.

### D. Docs

Update `data/mf_manager_cache/README.md` with the AMC source names and how to run the script. Add a short section to
`CLAUDE.md` only if you add a rule others must follow. Keep it to a few lines.

## 6. AMC order (largest first; stop at the point of diminishing returns)

SBI, ICICI Prudential, HDFC, Nippon India, Kotak, Aditya Birla Sun Life, UTI, Axis, DSP, Mirae Asset, Tata, Bandhan,
Franklin Templeton, Invesco, Motilal Oswal, PPFAS (Parag Parikh), Quant, HSBC, Edelweiss, Canara Robeco, Sundaram, WhiteOak,
Helios, Navi, Groww. For each, first look for a manager page or the monthly factsheet PDF on the AMC's own site (see
`data/factsheet_links/` for the URLs already found). Prefer an HTML page over a PDF. Skip any AMC whose site needs a CAPTCHA
(Kotak was noted as gated: link the page only, do not bypass).

## 7. Measure before and after

```bash
cd Fund-Horizon/backend
.venv/bin/python - <<'E'
import warnings; warnings.filterwarnings("ignore")
from app.backoffice import mf_screener as m, manager_resolver as r
base = m._base_frame()
res = r.resolve(base, {})
print("covered", len(res), "with start", sum(1 for v in res.values() if v["manager_start"]), "of", len(base))
E
```

Record the numbers before your change and after. Include them in the report.

## 8. Tests (all must pass; do not mark anything done on a failing or skipped test)

```bash
cd Fund-Horizon/backend
.venv/bin/python -m pytest -q tests/test_manager_resolver.py tests/test_fh_score.py tests/test_backoffice_mf_screener.py
.venv/bin/python -m pytest -q tests/test_backoffice_api.py          # about 70 s
```

Add unit tests for each AMC parser using a saved small HTML/PDF fixture in `backend/tests/fixtures/` (no live network in
tests). Add one test that the name matcher maps a Regular and a Direct plan to two codes and refuses an ambiguous name.
Run the full backend suite once before pushing: `.venv/bin/python -m pytest -q` (several minutes; run it in the background
and read the result, do not interrupt it).

## 9. Ship and verify

1. `git status` and stage only your files by path. Commit with a clear message ending with the Co-Authored-By line above.
2. `git pull --rebase --autostash` then `git push origin main`.
3. Web deploy (only if you touched `frontend/`): `gh run list --workflow deploy-web.yml --limit 3`, about 2 minutes.
4. API deploy: `gh run list --workflow deploy-api.yml --limit 3`. It takes 25-30 minutes and a newer push can CANCEL an
   older run. Make one push, then wait for that run to finish with conclusion `success`. If it is cancelled by someone
   else's merge, check that a later run containing your commit succeeded.
5. Verify live: unauthenticated `curl -s -o /dev/null -w "%{http_code}" https://api.fundhorizon.website/api/backoffice/mutual-funds/fh-score/methodology`
   must be `401` (not 404/502). You cannot log in as staff, so do not claim you saw the screener. Say what you could and could not check.
6. After the deploy, the next API start runs `sync_managers`. The owner then hard-refreshes `/backoffice/mutual-funds`.

## 10. Pitfalls already hit

- The scored screener frame is cached for 5 minutes in `backend/app/api/backoffice.py` (`_fh_frame`). New manager rows show after the cache expires or the API restarts. Do not "fix" that.
- `backend/app/backoffice/screening/jobs.py` `seed_managers` now calls `sync_managers`. Keep it.
- Plan siblings share a manager: the resolver copies Regular to Direct and back by `name_key`. Do not duplicate that logic in your collector.
- The test database is separate; `FH_BACKOFFICE_COLLECTORS=false` in tests, so startup sync does not run there. Do not enable it.
- Pandas warns on `dayfirst`; harmless. Do not suppress globally.
- The working tree usually has other people's uncommitted edits (`backend/uv.lock`, docs). Leave them.

## 11. Report format (send back to the owner)

1. Commit hash(es) and the run URLs for each deploy with their conclusion.
2. Coverage numbers before and after (section 7).
3. Table: AMC, rows collected, rows matched to codes, rows unmatched, status (ok / blocked / skipped and why).
4. Tests run and the exact results. Anything not run, say so.
5. What you could not verify live, and any risk.

## 12. Out of scope

Scoring formulas, frontend UI, the fund detail page, broker APIs (Kite, Upstox, Dhan carry no manager data), paid vendor
feeds (Value Research, Morningstar), scraping Moneycontrol, Google Finance or Groww. Do not change the FH score weights or thresholds.
