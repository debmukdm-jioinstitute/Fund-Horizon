# Task for Muse: fill mutual-fund holdings gap (Fund Horizon)

Repo root: `Fund-Horizon` (Next.js frontend + FastAPI backend). Work on `main`; push to main auto-deploys. Do not touch any file outside the list below.

## Goal

Add portfolio holdings and sector allocation for debt, liquid and index fund codes that have none.
About 1,280 of 3,661 fund codes are uncovered; 2,378 are covered.

## Files you own

- `backend/app/backoffice/holdings_amc.py` (SEBI-format AMC workbook parser, link discovery, `ingest_amc`)
- `backend/scripts/ingest_holdings_amc.py`
- `backend/tests/test_holdings_amc.py`
- `data/mf_holdings/*` (`manifest.json` plus chunked CSVs; write only through the existing ingest code)

Do not edit `backend/app/backoffice/manager_resolver.py`, `collect_amc_managers.py` or `data/mf_manager_cache/` (another agent owns them).

## Step 1: fix UTI

UTI per-fund files parse, but the weights do not add up, so they were left out.

1. Run the parser on one UTI file and print the sum of weights per fund.
2. Find the cause (likely candidates: a net-assets or cash row counted as a holding, a percent column read as a fraction, or a sub-total row).
3. Fix it in `holdings_amc.py`. Keep a fund only if its weights sum to 95-105%. Never rescale weights to force a pass.
4. Add a test with a small fixture that fails before the fix and passes after.

## Step 2: uncovered AMCs

Order of work: UTI, then HSBC, then Zerodha (their linked files were not per-fund holdings; find the right file or skip), then any other AMC with missing fund codes.

Find which codes lack holdings:

```bash
cd backend && uv run python - <<'PY'
import json
m = json.load(open("../data/mf_holdings/manifest.json"))
print(list(m)[:5], len(m))
PY
```

Run the ingest:

```bash
uv run --with xlrd python backend/scripts/ingest_holdings_amc.py --all
```

Matching rule: exact AMFI scheme name via `normalize_scheme_name`. If a name is ambiguous or unmatched, skip that fund. Never fuzzy-match.

## Hard rules (do not break)

- No bypassing bot checks, CAPTCHAs, 403/406 walls or `robots.txt`. HDFC, Canara Robeco, WhiteOak, Helios, Edelweiss and Kotak are walled: leave them alone.
- Only public files from AMC sites or AMFI. No logins, no scraping behind auth.
- Do not invent or estimate holdings. A fund with no verified file stays uncovered.
- Never commit `backend/uv.lock` (produced by `uv run`; `git checkout backend/uv.lock` before committing).
- No new fonts, no frontend changes.

## Done means

1. `cd backend && uv run python -m pytest tests/test_holdings_amc.py tests/test_mf_research_holdings.py -q` passes.
2. Report: covered fund codes before and after (before: 2,378), and a list of AMCs still uncovered with the reason.
3. `git status` shows only the files you own plus `data/mf_holdings/*`.
4. Commit message: `feat(mf): holdings for <AMCs>`, then `git pull --rebase origin main && git push origin main`.
5. Do not run a deploy by hand. Push triggers it (web about 2 minutes, API about 20 minutes).

## Report format (reply with this)

```
before: <n> codes   after: <n> codes
added AMCs: <list>
skipped (reason): <list>
tests: <pass/fail>
commit: <sha>
```
