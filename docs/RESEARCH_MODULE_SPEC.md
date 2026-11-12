# Fund Screening — implementation spec

Internal analyst funnel on `frontend/app/backoffice/research/page.tsx`. Keep Briefing + Notes. Add tab **Fund Screening** (same `terminal-btn` / `terminal-btn-accent` pattern as `frontend/app/backoffice/pms/page.tsx`). Google Sans only; numbers `tabular-nums`. Staff-only (`require_staff`). ₹0 incremental spend (`docs/BACKOFFICE_SOURCES.md`): no paid feeds; honest `availability` states; never fabricate.

**Product:** FundHorizon distributes **Regular** plans (legacy www.fundhorizon.in) and PMS in this app. Screening universe = MF Regular + Growth + Open Ended only. Direct is visible on the MF tracker, never in this action list.

**Non-goals:** public site, plan shortlist (`engine/funds.py`), live on-the-fly math in the browser, paid Advisorkhoj/Morningstar/NSE TRI licenses.

---

## 1. Funnel (sequential; each stage ⊆ previous)

| Stage | Pass rule (defaults in `backend/app/config/screening.yaml`) | Output bucket |
|---|---|---|
| S0 universe | Regular, Growth, Open Ended, `data_quality∈{ok,split_adjusted}`, NAV not stale (`assumptions.yaml stale_days`) | `universe` |
| S1 manager | Named current manager AND `manager_tenure_years ≥ min_tenure_years` (default 3). Unknown tenure → `insufficient`, not pass. | `s1` |
| S2 ratios | Multi-select columns + optional min/max per selected ratio. No bounds → all S1 rows pass; columns still change. | `s2` |
| S3 capture + quartile | `up_capture > 1` AND `down_capture < 1` (ratio units, 1=100%) over **2Y**. Quartile of 2Y return in SEBI `cat`: **Q1** shown, `retain_do_not_touch`, **excluded from action list**; **Q2+Q3** = `selected_for_review` (action); **Q4** dropped. Missing capture/quartile → `insufficient`. | `s3_action` / `s3_retain` |
| S4a other | `sortino ≥ 1` AND `sharpe ≥ 1` AND `tenure_ratio ≥ 1` (3Y window). | `s4a` |
| S4b display | Not a filter. Attach 1Y / 3Y / 5Y / SI vs benchmark and category average. Null if history short. | `s4b` |
| S4c TER | Regular TER (`mf_ter.regular_ter_pct`) ≤ category-median Regular TER. Missing TER → `insufficient`. | `final` = action list |

UI shows **counts per stage** (pass / insufficient / dropped) as a stepper. Action table = `final`. Q1 retain table is a second list on S3+, not mixed into CSV action export unless `include_retain=true`.

PMS is **not** a funnel row. S1 **reuses** PMS manager evidence when the MF manager name matches APMI / `frontend/lib/pms-managers.ts` (see §2).

---

## 2. Reuse vs gaps

There is **no** `/mutual-funds/{scheme_code}/performance`. Do not invent it.

| Need | Reuse | Gap |
|---|---|---|
| Scheme master + Regular TER | `GET /api/backoffice/mutual-funds/tracker`; `mf_schemes` ⋈ `mf_ter` in `backend/app/backoffice/repository.py`; collector `SRC_AMFI` + `SRC_AMFI_TER` (`providers/amfi.py`, `amfi_ter.py`) | — |
| NAV / existing ratios | Month-end `load_nav` (`data/loader.py` → `data/fundhorizon_mf_rag_dataset/nav_monthly/{code}.csv`); metrics CSV columns `ret_1y,cagr_3y,cagr_5y,cagr_since_inception,vol_3y,sharpe_3y,sortino_3y,max_drawdown_3y,history_years,first_nav_date`. Engine: `backend/app/engine/analytics.py` (`trailing_return`, `cagr`, `annualized_volatility`, `sharpe_ratio`, `sortino_ratio`, `max_drawdown`, `capture_ratios`). Public `GET /api/funds/{scheme_code}` and `/analytics` are **on-request** — screening must **not** call these per row. | alpha, beta, R², IR, TE, Treynor not implemented. Capture is **percent** (100=in line) vs category **median** (`engine/stress.py::category_median_series`), min 12 common periods. |
| Daily NAV | `MfapiProvider` `backend/app/backoffice/providers/mfapi.py` (`SRC_MFAPI` seeded in `backoffice/db.py`) | **Not in** `collectors.REFRESH_INTERVALS`. Nightly job should prefer month-end dataset; optional bounded mfapi backfill. |
| Category key | `backend/app/data/categories.py::normalise_category` | AMFI `mf_schemes.category` is raw; screening joins on canonical `cat`. |
| RF | `backend/app/config/analytics.yaml` `risk_free_rate: 0.065`; India 3M via `SRC_IN_YIELDS` `YIELD:IN:3M` | Wire: live 3M if `ready`, else 0.065. Tag `rf_source`. |
| TER Regular | `mf_ter.regular_ter_pct`, `amfi_ter.base_key` | Screening always Regular, never Direct column. |
| PMS manager | `GET /api/backoffice/pms/strategies`, `GET /api/backoffice/pms/strategies/{ia_id}` (`fund_manager`, `fund_manager_experience`, returns, AUM); `PmsManagerDrawer` + `frontend/lib/pms-managers.ts` (`normalizeManagerName`, `findManagerProfile`) | — |
| MF manager | AMFI NAV / metrics / `mf_schemes` have **no** manager. RAG README states factsheet-only. | New `mf_managers` + import `mf_managers` CSV + optional SID/factsheet parse if robots allow. Tenure from `manager_start` else unknown (do **not** use `first_nav_date` as tenure). |
| Quartiles | Nav copy on MF page mentions quartiles; **none in code**. | Advisorkhoj fetch + computed fallback (§4). |
| Saved views | `models.py` docstring lists `saved_views`; **no table**. Watchlists are item pins, not filter presets. | New `screening_presets`. |
| Envelope / CSRF | `BackofficeEnvelope`; mutations `verify_csrf`; client `boFetch` in `frontend/lib/backoffice.ts` (`credentials:include`, `sec-fetch-site:same-origin`) | New client fns only. |

---

## 3. Formulas

All math **server-side**, nightly. Frequency: **month-end** pct_change (`periods_per_year=12`) unless noted. Returns decimal unless UI `%`. Window: risk ratios **3Y**; capture + quartile **2Y**. Drop first return after a gap fill.

RF `r_f`: annual decimal. Periodic `r_f/12` only inside alpha/beta regressions.

Benchmark `R_b`: (1) category-median monthly return of Regular Growth peers in `cat` (`category_median_series`, `min_funds=3`); (2) optional imported index NAV if present in `mf_benchmark_nav`. Tag `benchmark_source=category_median|index:<id>|none`. No NSE/CRISIL TRI purchase.

Let `R_p`, `R_b` be aligned monthly returns. `CAGR_p` = `trailing_return(nav, years=W)`.

| Key | Formula | Reuse / new |
|---|---|---|
| `std_dev` | `σ = std(R_p)*√12` | `annualized_volatility` |
| `beta` | `cov(R_p,R_b)/var(R_b)`; null if `var<1e-12` or `<12` points | **new** in `engine/analytics.py` |
| `alpha` | Jensen annual: `CAGR_p - [r_f + beta*(CAGR_b - r_f)]` | **new** |
| `r_squared` | `corr(R_p,R_b)²` | **new** |
| `tracking_error` | `std(R_p-R_b)*√12` | **new** |
| `information_ratio` | `(CAGR_p-CAGR_b)/TE`; null if `TE<1e-4` | **new** |
| `treynor` | `(CAGR_p-r_f)/beta`; null if `β≈0` | **new** |
| `sharpe` | `(CAGR_p-r_f)/σ` | `sharpe_ratio` (existing Sortino uses **negative-return std**, not MAR; keep) |
| `sortino` | `(CAGR_p-r_f)/σ_down` | `sortino_ratio` |
| `up_capture`,`down_capture` | geometric capture; **store as ratio** `engine_pct/100` | wrap `capture_ratios` |
| `max_drawdown` | peak-to-trough, signed negative | `max_drawdown` |
| `expense_ratio` | Regular TER % | `mf_ter` |
| `tenure_ratio` | **ASSUME (confirm Q1):** `manager_tenure_days / window_days` with `window=3Y` (or fund age if younger). Pass `≥1` ⇒ manager covered the whole window. Null if no `manager_start`. Do not proxy with fund age. | **new** |

Existing capture returns `None` on opposite-sign compounded moves and `<3` up/down months — treat as insufficient, not 0.

---

## 4. Quartiles — source cascade (₹0)

Provenance per row: `quartile_source=advisorkhoj|computed_nav|manual_import|unavailable`.

1. **Advisorkhoj** `https://www.advisorkhoj.com`. `robots.txt` (2026-10-13): `Allow: /`; Disallow admin/download/ajax (`/getSearchResults`, `/download*`, `/admin`, …). Fetch **only** public HTML fund/category pages; never Disallow paths. UA `FundHorizon-Backoffice/1.0 (internal-research)`. Rate: `rate_budget` like `SRC_IN_YIELDS` (≤2 concurrent). If CAPTCHA, login wall, ToS prohibition, or unstable DOM → `availability=blocked`, skip. Parse 2Y category quartile if present. Cache 24h in `mf_quartile_external`. Re-check robots.txt each run; on `Disallow` for used paths → stop, keep cache, fall through.
2. Else **manual import** `quartile` CSV (`scheme_code,sebi_category,window_years,quartile,as_of,source`).
3. Else **compute**: 2Y `trailing_return` among S0 peers in same `cat` with `history_years≥2`. Rank descending (ties = average rank). `Q1=top 25% … Q4=bottom 25%`. `n<8` → `unavailable` (do not fake quartiles).

Category average returns: median of same peer set (not mean).

---

## 5. Backend

**New paths**

- `backend/app/config/screening.yaml` — thresholds, windows, ratio catalog, `min_tenure_years`
- `backend/app/config/sebi_benchmarks.yaml` — `cat → {name, instrument_id?}` (labels only until NAV imported)
- `backend/app/engine/analytics.py` — add `beta, jensen_alpha, r_squared, tracking_error, information_ratio, treynor` (pure; no IO)
- `backend/app/backoffice/screening/` — `ratios.py` (call engine), `quartiles.py`, `funnel.py`, `service.py`, `jobs.py`
- `backend/app/backoffice/providers/advisorkhoj.py` — `BaseProvider`; seed `SRC_ADVISORKHOJ`
- Alembic `backend/alembic/versions/0006_fund_screening.py` `revision=screening_0006` `down_revision=backoffice_0005`
- Mirror DDL in `repository.py` `_LIVE_TABLES_SQL` (existing live-table pattern)
- Register `SRC_SCREENING` + `SRC_ADVISORKHOJ` in `backoffice/db.py::_seed_default_registries`
- Collector: `REFRESH_INTERVALS["SRC_SCREENING"]=24*3600`; `jobs.refresh_screening()` after AMFI/TER
- Import template `mf_managers` + `quartile` in `providers/manual.py`
- Routes on existing `backend/app/api/backoffice.py` (do not add a public `/api/funds` dependency)

**Job `refresh_screening()` (UI never computes)**

1. S0 from `mf_schemes` + metrics + `normalise_category`.
2. Join `mf_managers`, `mf_ter`, optional `mf_quartile_external`.
3. For each scheme with `load_nav`: write `mf_screening_metrics` (all ratio keys, 1Y/3Y/5Y/SI vs bench & cat, provenance JSON).
4. Attempt Advisorkhoj; fill quartile; else compute.
5. `as_of=max(nav_date)`; `collector_runs` row; source health `ready|unavailable`.

**Tables** (SQLite-friendly; dates ISO):

```
mf_managers(scheme_code PK, manager_name, manager_start DATE NULL, source, provenance, updated_at)
mf_quartile_external(scheme_code, window_years, as_of, quartile INT, source, source_url, fetched_at, PK(scheme_code,window_years,as_of))
mf_benchmark_nav(instrument_id, date, nav, provenance, PK(instrument_id,date))
mf_screening_metrics(
  scheme_code PK, as_of, cat, amc, scheme_name,
  manager_name, manager_tenure_years, tenure_ratio,
  alpha, beta, std_dev, r_squared, information_ratio, tracking_error, treynor,
  sharpe, sortino, up_capture, down_capture, max_drawdown, expense_ratio,
  ret_1y, cagr_3y, cagr_5y, cagr_si, bench_1y, bench_3y, bench_5y, bench_si,
  cat_avg_1y, cat_avg_3y, cat_avg_5y, cat_avg_si,
  quartile_2y TINYINT NULL, quartile_source, rf_source, benchmark_source,
  history_years, quality_flags, provenance_json TEXT)
screening_presets(id PK, staff_id, name, filters_json, created_at, updated_at)
screening_runs(id PK, staff_id, preset_id NULL, filters_json, stage_counts_json, created_at)
```

**Ratio catalog** (S2 multi-select; these become columns + optional `{min,max}`):
`alpha, beta, std_dev, r_squared, information_ratio, tracking_error, treynor, sharpe, sortino, up_capture, down_capture, max_drawdown, expense_ratio`

**Endpoints** (all `Depends(require_staff)`; POST/DELETE `verify_csrf`)

`GET /api/backoffice/screening/metrics`

```
q: cat?, amc?, q_search?, columns=csv?, as_of?
→ MarketResponseEnvelope<{
    as_of, rf, rf_source, benchmark_policy,
    ratios: [{key,label,unit:"decimal"|"ratio"|"pct"|"years"}],
    rows: MfScreeningRow[],
    facets: {amcs, cats},
    total
  }>
```

`POST /api/backoffice/screening/run` body:

```
{
  "preset_id": "uuid|null",
  "filters": {
    "min_tenure_years": 3,
    "columns": ["sharpe","sortino","up_capture","down_capture","expense_ratio"],
    "bounds": {"sharpe":{"min":1},"sortino":{"min":1},"up_capture":{"min":1.0000001},"down_capture":{"max":0.999999},"expense_ratio":{"max":null}},
    "quartiles_action": [2,3],
    "include_retain": false
  }
}
```

Response:

```
{
  "data": {
    "run_id": "uuid",
    "as_of": "YYYY-MM-DD",
    "counts": {
      "universe": n, "s1": n, "s2": n,
      "s3_action": n, "s3_retain": n, "s3_dropped": n,
      "s4a": n, "final": n,
      "insufficient_by_stage": {"s1":n,"s3":n,"s4a":n,"s4c":n}
    },
    "action": [MfScreeningRow],
    "retain": [MfScreeningRow]
  },
  "availability":"ready","freshness":"current","method_version":"1.0.0"
}
```

`MfScreeningRow` = metrics row + `stage_flags: {s1,s2,s3,s4a,s4c}` + `action_status: review|retain|excluded|insufficient` + `pms_link: {ia_id,strategy_name,fund_manager}?` (name match only).

`GET /api/backoffice/screening/runs/{run_id}` — persist counts + id lists (not full snapshots).
`GET /api/backoffice/screening/funds/{scheme_code}` — one row + manager + PMS matches (`ia_id`s) + last notes (`research_notes` `entity_type=scheme`).
`GET/POST /api/backoffice/screening/presets` `DELETE .../presets/{id}` — `filters_json` as run body. Staff-scoped.
`GET /api/backoffice/screening/export/{run_id}.csv` — action rows; formula-injection sanitize (`manual.sanitize_cell`). Columns = selected ratios + identity + quartile + TER + provenance.

Funnel logic `funnel.apply(rows, filters) -> {counts, action, retain}` is pure; unit-test without HTTP.

---

## 6. Frontend

Keep briefing/notes. Page tabs: `briefing | notes | screening` (URL `?tab=screening`).

New:

- `frontend/components/backoffice/FundScreening.tsx` — loads `GET metrics` (cache), local filter state, `POST run` on “Apply funnel” (not on every keystroke).
- `ScreeningFunnel.tsx` — stepper with counts; click stage to preview that pass set (still from last run payload; backend may return `preview_stage` later — v1: client filters `stage_flags` on returned action+retain+optional `debug_rows` **do not send full universe**. v1 run response includes `action`+`retain` only; counts cover all stages. Optional `GET metrics` table is unfunnelled browse).
- `ScreeningFilters.tsx` — S1 tenure; S2 multi-select (`<select multiple>` or checkbox popover) + min/max inputs for selected keys; S3 capture mins/maxes (defaults up>1, down<1); quartile help text; S4a mins; S4c “≤ cat median TER” toggle. Cat/AMC search.
- `ScreeningTable.tsx` — reuse MF table classes from `mutual-funds/page.tsx`; `SignedValue` for signed %; Q1 badge `Retain`; Q2/Q3 `Review`; provenance chip.
- Drawer: extend `MutualFundDrawer` **or** `ScreeningFundDrawer.tsx` wrapping it — TER, manager, PMS link → existing `PmsStrategyDrawer`/`PmsManagerDrawer`, 1/3/5/SI vs bench/cat, capture, notes. Do not duplicate PMS UI.
- Preset save/load; CSV via export endpoint (not client-built).
- Empty/stale: if `SRC_SCREENING` not `ready`, banner like data-health (`availability`/`message`).

State: `tab`, `filters`, `selectedColumns`, `run`, `presetId`, `drawerScheme`. No ratio math in React.

`frontend/lib/backoffice.ts`: types + `getScreeningMetrics`, `runScreening`, `getScreeningFund`, `listScreeningPresets`, `saveScreeningPreset`, `deleteScreeningPreset`, `screeningExportUrl`.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| `history_years < 2` | No 2Y capture/quartile; S3 insufficient |
| `history_years < 3` | 3Y sharpe/sortino/alpha/IR null; S4a insufficient; still show 1Y |
| Isolated 1-month NAV hole | ffill 1 obs, `quality_flags` contains `nav_gap_filled` |
| ≥3 consecutive missing months | skip window, `nav_gap` |
| `<3` category peers | no median bench; beta/alpha/IR/TE/capture/Treynor null; `benchmark_source=none` |
| No manager_start | S1 insufficient; `tenure_ratio` null |
| Manager name matches ≥1 PMS | attach `pms_link`; do not auto-pass S1 |
| TER missing | S4c insufficient |
| Direct / IDCW / close-ended | excluded in S0 |
| Q1 | listed in `retain`, not `action`, not default CSV |
| Job partial failure | serve last `mf_screening_metrics`; `freshness=stale` |

---

## 8. Tests & acceptance

`backend/tests/test_screening_ratios.py` — each new formula vs fixture series; capture wrap 100→1.00; sharpe/sortino match existing `test_analytics.py` within 1e-6.
`backend/tests/test_screening_funnel.py` — S1 unknown drop; S3 Q1 not in action; Q4 dropped; S4c median TER; sequential ⊆.
`backend/tests/test_screening_quartiles.py` — 8-peer 2Y ranks → Q1..Q4; n=7 → unavailable; Advisorkhoj provider: robots Disallow short-circuit, no fetch.
`backend/tests/test_screening_api.py` — staff 401; run schema; CSV sanitize; preset CRUD isolation (copy `test_backoffice_api.py` login helper).
Frontend: existing `frontend/e2e/fonts.spec.ts` does not cover `/backoffice/*`; still no new font families. Manual/browser: tabs, funnel counts, drawer, CSV, preset.

**AC**

- Briefing + notes unchanged.
- Funnel counts match `funnel.apply` on precomputed rows.
- Action list = S4c pass only; Q1 visible as retain.
- Table columns = selected S2 keys; UI does not call `/api/funds/*/analytics` in a loop.
- Regular TER only; Direct never in `final`.
- Each metric has `*_source` / `provenance_json`.
- Nightly job; GET metrics is a table read.

---

## 9. Checklist (implement in order)

1. `screening.yaml` + alembic `0006` + live DDL + models.
2. Engine ratio helpers + unit tests.
3. `jobs.refresh_screening` from `load_nav` + TER + managers (empty OK) + computed quartiles; hook collector.
4. `funnel.py` + tests.
5. API + `boFetch` types.
6. `advisorkhoj.py` behind robots/health; fallback already works.
7. Manual imports `mf_managers`, `quartile`.
8. Research page tab + FundScreening UI (funnel, filters, table, CSV, presets).
9. Drawer reuse MutualFund + PMS manager drawers; name-match PMS.
10. AC tests; `make lint` / font check; no app fonts besides Google Sans.

---

## 10. Open questions (manager)

1. Confirm `tenure_ratio = manager_tenure / 3Y-window` (pass ≥1). Alternative: `/ fund_age`.
2. S1: drop unknown managers, or keep with flag?
3. S4c: ≤ category-median Regular TER, or absolute caps by asset class?
4. S4a thresholds 1.0/1.0 — intended?
5. Capture 2Y vs 3Y for Sharpe/Sortino (spec: 2Y capture, 3Y risk).
6. Q1 “retain, do not touch” = already on the recommended panel book? Any auto-watchlist?
7. Include PMS strategies as funnel rows later, or MF-only forever?
8. Legal OK to parse Advisorkhoj public HTML given robots `Allow: /`, or compute-only from day one?
9. RF: live IN 3M vs locked 6.5% (`analytics.yaml`)?
10. Should S2 default columns be the full 13 or a short set (Sharpe, Sortino, up/down, TER)?
