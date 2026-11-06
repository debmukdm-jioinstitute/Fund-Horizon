# Monthly portfolio valuation (Operations > Monthly valuation)

Consolidates one client's monthly statements (FundsIndia MF, ProAffluence PMS, Stallion PMS) into a reconciled,
approved, immutable snapshot and one consolidated PDF per client-month. No new dependency, service or paid API.

## Where things live

| Layer | Path | Notes |
|---|---|---|
| Models (`val_*` tables) | `backend/app/backoffice/valuation/models.py` | SQLAlchemy on the existing `Base`; Float money (rupees), Decimal arithmetic in calculations |
| Migration | `backend/alembic/versions/0013_monthly_valuation.py` | additive only; `down_revision = lead_sr_no_0012` |
| Readers / table mapping | `.../valuation/ingestion.py` | pypdf text layer, pandas/openpyxl for Excel, header-driven columns; **no OCR** |
| Provider adapters | `.../valuation/providers/{fundsindia,proaffluence,stallion}.py` | identification markers, asset class, provider checks |
| Detection | `.../valuation/detection.py` | content markers; ties or no match => manual selection |
| Normalisation | `.../valuation/normalizer.py` | asset type, ISIN checksum, rounding; never fills a missing value |
| Statement validation | `.../valuation/validation.py` | totals, cash treatment, qty x price, duplicates, required fields |
| Batch reconciliation | `.../valuation/reconciliation.py` | duplicate statements, provider mapping, dates, transfers, month-on-month |
| Performance | `.../valuation/performance.py` | reuses `analytics/pms_math.py` (XIRR, Modified Dietz, CAGR) |
| Consolidation | `.../valuation/consolidation.py` | builds the snapshot payload (the only source of report figures) |
| Workflow + DB | `.../valuation/service.py` | transactions, approval gate, snapshots, report versions, audit |
| PDF | `.../valuation/report.py` | ReportLab + existing donut chart, Google Sans; layout only, no maths |
| API | `backend/app/api/valuation.py` | registered in `app/main.py` |
| Frontend | `frontend/app/backoffice/operations/valuation/**`, `frontend/components/valuation/ui.tsx`, `frontend/lib/valuationApi.ts` | linked from the Operations launcher |
| Tests | `backend/tests/test_valuation_*.py`, `backend/tests/valuation_fixtures.py` | synthetic statements, hand-computed references |

Reused, not duplicated: `pms_math` (XIRR/Dietz/CAGR), `app.report.fonts/charts/fmt`, `DISCLOSURE_LINES`, CRM auth
(`crm_user`, `_scope`, `_visible_customer`), `verify_csrf`, the Alembic conventions and the SQLite file.

## Rules the code enforces

* Cash is added to a provider valuation only when the provider's own total proves it is separate from the holdings.
  Cash with no provider total blocks approval (`cash_treatment_unverified`).
* Accounts are never merged; securities are matched by account + ISIN (name only within an account when ISIN is absent).
* Consolidated XIRR = combined dated external flows + each account's closing value at its **own** valuation date.
  Provider XIRRs are never averaged. Needs every account's flow history confirmed complete (admin attestation with reason).
* Internal transfers: a transfer in/out pair (same amount, within one day) is excluded from external flows; an unpaired
  transfer blocks approval until a reviewer confirms it.
* Modified Dietz: only when every account has an opening value, one period start and one valuation date.
  CAGR: only for >= 90 days with no external flows. Otherwise the metric is "Not available" with the reason.
* Missing source values stay NULL. Nothing is derived into a stored field.
* Approval needs: validation run after the last change, and no failed error-severity check. Errors are overridden only by an
  admin (the account's stored role, not the CRM's staff-to-admin mapping) with a reason (10+ chars); unreadable/scanned files cannot be overridden (remove or replace them).
* Approved snapshots, report versions and the audit log are append-only (SQLite triggers + service rules). A correction is a
  new revision batch (`revises_batch_id`); the earlier snapshot, every report version and the audit trail remain.
* Uploaded files are stored content-addressed (SHA-256) under `<dir of FH_DB_PATH>/valuation_private` (override `FH_VAL_STORE`),
  mode 0700/0600, outside any static or web root, and only reachable through authenticated endpoints.
* Duplicates: identical bytes (SHA-256) are refused within the batch and against other open batches of the client-month;
  separately, the same provider + account + statement date twice is a blocking `duplicate_statement`. File names are never used.
* PDF passwords are used in memory for that request only and never stored or logged.

Tolerances (env, defaults): `FH_VAL_ABS_TOL=1.00` rupee, `FH_VAL_REL_TOL=0.0005`, `FH_VAL_ROW_TOL=0.5`,
`FH_VAL_ROW_REL_TOL=0.002`, `FH_VAL_MOM_THRESHOLD=0.15`, `FH_VAL_DATE_GAP_DAYS=3`.

## API (all under `/api/backoffice/valuation`, CRM auth, client-level scope on every route)

| Method | Path | Purpose |
|---|---|---|
| GET | `/providers` | adapters and whether each is verified on real statements |
| GET | `/batches?client_id=&month=` | dashboard list (RMs see their book only) |
| POST | `/batches` | create batch (client, month, valuation date, optional `revises_batch_id`) |
| GET | `/batches/{id}` , `/batches/{id}/preview` | files, accounts, extracted records, provider totals, warnings |
| POST | `/batches/{id}/files` | multipart upload (many files; optional `provider`, `password`) |
| PATCH | `/files/{id}/provider` | manual provider correction |
| DELETE | `/files/{id}` | remove a file from an open batch |
| POST | `/batches/{id}/process` | extract (optional `passwords` map) |
| GET | `/batches/{id}/reconciliation` | latest run: passed / failed / warnings / differences |
| POST | `/batches/{id}/validate` | (re)run validation + reconciliation |
| POST | `/checks/{id}/resolve` | resolve a warning or override an error (reason required) |
| POST | `/accounts/{id}/attest-flows` | admin confirms cash-flow history is complete |
| GET | `/batches/{id}/consolidated` | consolidated figures (live preview, or the snapshot once approved) |
| POST | `/batches/{id}/approve` | approve, write snapshot, optionally generate PDF v1 |
| GET | `/snapshots/{id}` | approved snapshot payload |
| POST | `/snapshots/{id}/report` | generate another report version |
| GET | `/reports/{version_id}/download` | PDF (`Cache-Control: private, no-store`) |
| GET | `/clients/{client_id}/history` | approved snapshots + report versions |

## Migration and rollback

* Upgrade: `alembic upgrade head` (the API container already runs this on start). It only creates missing `val_*` tables and
  six `trg_val_*` triggers; it never alters or drops existing tables. The same DDL is also applied lazily at first use, so
  start-up order cannot break the feature.
* Verified locally on an empty database: upgrade, downgrade -1, upgrade.
* Rollback of code: redeploy the previous image. The new tables are ignored by old code; nothing else changes.
* Rollback of schema: `alembic downgrade -1` drops only `val_*` tables and refuses if approved snapshots exist, unless
  `FH_VAL_ALLOW_DROP=1` (take a backup first). Prefer leaving the tables in place.
* Back up before first production use: `cp fund_horizon.db fund_horizon.db.pre-valuation` and keep the previous image tag.

## Real-statement coverage (added 2026-11-06)

Read from two real demo statements (tests: `backend/tests/test_valuation_real_statements.py`, skipped unless `FH_REAL_STATEMENTS` or ~/Downloads holds them; never commit client files):

* **FundsIndia "Portfolio Valuation Report - Folio Wise"** (`valuation/layouts.py::folio_wise_mf`): 23 rows, folio, invested, units, NAV, value, per-row XIRR.
  Rows sum to the Grand Total (value within 2 paise, invested exact); printed absolute return and units x NAV are re-checked per row.
* **Distributor "Summary Report" bundle** (`valuation/bundle.py`): split by page into one statement per section: MF summary, each PMS factsheet
  (Stallion, InCred...), direct-equity page. The dashboard page is kept as provider-reported context. The original bundle stays in the store (audit `bundle_uploaded`).
* **PMS factsheet** (`layouts.enrich_pms`): invested = contribution - withdrawal; contribution - withdrawal + profit must equal value (else an error).
  Provider IRR since inception is stored as *reported*, not computed. Equity vs cash comes from the factsheet's sector table; nothing else is guessed.
* **XIRR**: computed by Fund Horizon only from dated external flows (existing engine). These statements carry none, so the report shows the
  providers' own printed XIRR/IRR with source, labelled "printed by provider". The distributor dashboard total is cross-checked against the bundle's statements; a gap is shown (demo: 2.67%).
* **Factsheets** (`valuation/factsheets.py`): each MF line is matched to an AMFI scheme only when name words and NAV agree (NAV fixes Regular/Direct); data points
  are from the AMFI-sourced dataset with as-on date; NAV is compared with AMFI only when AMFI's NAV date is the statement's NAV date. AMC factsheet pages are cut from the
  AMC's own PDF (registry `providers/factsheets.py`; needs the registry populated on the server) and appended as Annexure D pages. Unmatched lines show no data.
* **Email / repository**: `POST /reports/{id}/email` (CRM address, opt-out respected, confirm=true, audited); `GET /clients/{id}/files`, `GET /files/{id}/download`;
  MCP tools `valuation_email_report`, `valuation_client_files`. Every stored file is mirrored to R2 (`valuation/<key>`) when R2 is configured.
* Adapters are still `verified = False` until the manual checklist below is done by a person.

## Provider coverage and known limitations (read before relying on any figure)

**No adapter is verified on real statements.** No representative real FundsIndia, ProAffluence or Stallion statement was
available, so all three are tested only on synthetic fixtures (`verified = False`; the UI and each preview say so).
Each adapter finds columns by header words and totals by label words; it does not assume fixed positions. Consequences:

* A header or label wording not in the synonym lists is not read. The file then shows "manual review" or a validation failure
  rather than guessed values. Extend `COLUMN_PATTERNS` / `LABELS` / `FLOW_WORDS` in `ingestion.py` after seeing real samples.
* PDF tables: one text line per row; a row wrapped over several lines, or whose figure count differs from the header, is skipped
  and reported. Multi-column header cells split across lines are not joined.
* PMS "invested" is taken from a labelled "invested/investment" line and may be net or gross capital depending on the PMS;
  confirm the definition on a real statement before using absolute return. If absent, invested/gain are shown Not available.
* PMS holdings get an asset type only from an Equity/Debt/... section heading, an asset-class column or an INF ISIN;
  otherwise "Unclassified". Allocation therefore needs real-sample tuning.
* FundsIndia accounts are folios. A transaction table without a folio column is attached to the statement-level client code,
  which then appears as an extra account with no holdings (invested/gain show Not available until the layout is tuned on a real statement).
* Cash-flow classification is keyword-based; unclassified rows raise a warning and the account's flow history is not
  treated as complete. Flow completeness is never inferred: an admin must attest it.
* Scanned/image PDFs are flagged for manual review (no OCR is used). Password-protected PDFs need the password at process time.
* Excel formulas are read as cached values; Excel files with several holdings tables per sheet use the last header seen.
* Float storage for money (rupees, 2 dp); calculations use Decimal. Report amounts are shown with paise.
* Source files and generated PDFs live on the server disk; the existing R2/SQLite backup copies the database only. Approved
  snapshots (all report figures) are in the database, but copy `valuation_private/` (EBS snapshot or rsync) to keep source files.
* Not built: editing extracted rows in the UI (correct by re-uploading / revision), Playwright e2e for the new pages, email of
  the report.

## Manual verification of a provider with real statements (per provider, before saying "supported")

1. Take one real statement (PDF and, if offered, Excel) for a test client; do not commit it to the repo.
2. Create a valuation for that client/month, upload, and open Statements > "Show extracted records".
3. Compare against the source, line by line: every holding (name, ISIN, quantity, price, value), the provider total, cash,
   statement date, account/folio number, and every cash flow. Check "Source" page/row points to the right place.
4. Run validation: it must pass with no override. A discrepancy means an adapter gap, not a data issue to override.
5. Check Consolidated: total equals the provider's own total; asset classes are right.
6. Repeat with a month-end statement from a second month to see month-on-month, and with an unusual one (closed account,
   zero-balance, many pages). Only then set `verified = True` for that adapter, add the (anonymised) layout as a fixture and a test.

## Deployment

1. Merge to the default branch; CI/auto-deploy builds `deploy/api.Dockerfile` as today (no new files outside `backend/app`,
   `backend/alembic`). Batch with other backend changes (build on EC2 takes 18-26 min).
2. The new container runs `alembic upgrade head` then starts; the existing health-gated blue/green swap and auto-rollback apply.
3. Ensure the data volume is writable (`/srv/data`): `valuation_private/` is created on first upload. Optionally set `FH_VAL_STORE`.
4. Frontend: standard Next.js deploy; the new routes are under `/backoffice/operations/valuation` so existing page-permission
   lists are unchanged (staff allowed `/backoffice/operations` can open them).
5. Smoke test on production with a **test client** only: create batch, upload a synthetic file, validate, do not approve.

## Added 2026-11-06 (bug-fix pass)

* **Client identity check** (`reconciliation.check_client_identity`): at validation, PDF text is searched for the CRM client's name (spelling slips tolerated). No file names the client = blocking error (admin override with reason); one odd file = warning. Skipped when the CRM name cannot be resolved or a file has no readable text.
* **Dated cash flows for XIRR**: `POST /accounts/{id}/flows` (`date`, `deposit|withdrawal`, `amount`, `reason`) and a paste box on the Reconciliation tab. Adding flows clears the account's completeness attestation; XIRR appears after validation + admin attestation, as before.
* **Month-end pack**: `GET /reports/{version}/pack` = ZIP of the report PDF (factsheet annexure included) + every original statement of that batch. `POST /reports/{version}/email` takes `include_sources` (attachments capped at 20 MB).
* **Paperwork Processing** now splits a distributor Summary Report bundle (same splitter as here): MF summary, each PMS factsheet, direct equity; the dashboard's printed portfolio XIRR (and combined PMS XIRR) are used and labelled printed, never averaged. Files that name different clients raise a warning.
