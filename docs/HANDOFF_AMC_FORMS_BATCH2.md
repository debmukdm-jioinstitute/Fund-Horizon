# Handoff: AMC forms, batch 2 (finish the job, then push to main)

You are picking up work in `~/Downloads/Fund-Horizon` (GitHub `debmukdm-jioinstitute/Fund-Horizon`, branch `main`).
Batch 1 is done and pushed (commit `6ccd0779`). This file lists **only what is left**. Do every step in
"Tasks", run the checks in "Definition of done", then commit and **push to `main`**.

Owner's words: *"AMC-wise all forms in my website, properly segregated and managed. Focus first on the fund houses
FH recommends."* The entries must be the **publishers' own official forms**, never lookalikes.

---

## 0. Rules you must not break

1. **Official forms only.** Every entry links to a PDF (or the publisher's own page) hosted by the AMC/RTA. Never
   generate, redraw or invent a form, a form code or a "dummy" form. (See the "Forms" section of `CLAUDE.md`.)
2. **Google Sans is the only font** anywhere in the UI or generated PDFs (`CLAUDE.md`). `node frontend/scripts/check-fonts.mjs` must pass. Do not use `font-mono`, `font-family`, `next/font`.
3. **Never bypass a CAPTCHA or bot check.** If a site shows one (Kotak does), stop automating that page. Use the
   human-assisted mode described in Task 1d, or list the AMC's forms page as a link only.
4. **No login-walled scraping**, no credentials, no paid/third-party scraping services.
5. **Do not re-add the in-house form generator.** `FormEditorModal`, `operationsForms.ts`, `operations_doc.py` and
   `/operations/form-pdf` were deleted on purpose.
6. **Smallest change that fully solves each task.** No new dependencies unless a task says so. Do not touch files
   outside the ones named here.
7. Do not commit `*.db`, `/tmp` files, screenshots, `node_modules`, or `.next`.
8. `frontend/scripts/check-copy.mjs` already fails on `main` for unrelated reasons. Do not try to fix it and do
   not treat it as your regression.

---

## 1. What already exists (batch 1, do not redo)

| Piece | Path | Notes |
|---|---|---|
| Catalogue (single source of truth) | `data/official_forms.json` | 489 entries. Fields: `source` (`CAMS`/`KFintech`/`Stallion`/`AMC`), `amc` (only when `source=="AMC"`), `category`, `title`, `url`, `kind` (`PDF`/`Page`), `keywords`. |
| Raw AMC harvest | `data/amc_forms_raw.json` | `{ "<AMC>": [ {title, url, page} ] }`, written by the harvester. |
| Harvester (real browser) | `scripts/harvest_amc_forms.mjs` | Playwright with **system Chrome, headed** (headless is blocked by several AMC CDNs). Config object `AMCS`; options `FOLLOW`, `ITERATE_SELECT`; filters `FORMISH` / `NOT`. |
| Catalogue builder | `backend/scripts/build_official_forms.py` | Builds RTA entries (link-checked with curl), then merges `amc_forms_raw.json` using `AMC_PAGES`, `AMC_PDFS`, `CATEGORY_RULES`, `_pretty`. Writes `data/official_forms.json`. |
| API | `backend/app/api/backoffice.py` | `GET /api/backoffice/operations/official-forms` (catalogue), `GET /operations/official-forms/pdf?url=` (server-side proxy; only catalogue URLs; follows same-host redirects), `POST /operations/pdf-fill` (draws edits onto the PDF). |
| Universal search | `backend/app/backoffice/search.py` | Scope `forms` ("Official forms"); matches title, source, amc, category, keywords; "karvy" matches KFintech. |
| Page | `frontend/app/backoffice/operations/page.tsx` | Tabs All / CAMS / KFintech / Fund houses (AMC) / Stallion PMS, AMC chips (order in `AMC_ORDER`), category chips, search, per-row **Original** and **Fill & Sign**. |
| Editor | `frontend/components/operations/PdfFormFiller.tsx` | pdf.js render, detects real form fields, text/date/marks/signature/image/whiteout, undo/redo, download via `/operations/pdf-fill`. Works on AMC PDFs (tested on HSBC, KFintech, CAMS). |
| Tests | `backend/tests/test_universal_search.py`, `backend/tests/test_pdf_fill.py` | 7 tests pass. |

Current AMC coverage (entries per fund house, incl. the one "official forms page" entry each):

HSBC 89, Nippon India 87, Helios 71, HDFC 63, DSP 15, WhiteOak Capital 15, Mirae Asset 11, Edelweiss 7,
ICICI Prudential 2, Invesco India 2, Bandhan 1, Kotak 1.

FH-recommended fund houses (the "★ FH" picks, `backend/app/backoffice/fh_recommended.py`): WhiteOak Capital, HSBC,
Invesco India, Helios, Edelweiss, Mirae Asset, ICICI Prudential, Bandhan, DSP, plus Nippon India, HDFC, Kotak.

---

## 2. Local setup (macOS, already true on the owner's machine)

* Backend venv: `backend/.venv/bin/python` (has fastapi, pypdf, reportlab, pytest). Frontend: `frontend/node_modules`
  (Playwright is there). System Chrome: `/Applications/Google Chrome.app`.
* **Port 8000 is taken by another tool's server. Do not kill it.** Use 8010 (API) and 3100 (web) as below.
* Harvester needs a **visible** Chrome window. Run it from a normal terminal, not CI.

### Run the app against a scratch database (for visual checks)

```bash
cd ~/Downloads/Fund-Horizon/backend
export FH_DB_PATH=/tmp/fh_e2e.db DATABASE_URL= FH_BACKOFFICE_COLLECTORS=false FH_SEED_CRM=false
rm -f $FH_DB_PATH
.venv/bin/python - <<'E'
import hashlib, secrets
from datetime import UTC, datetime, timedelta
from app.db import sqlite
c = sqlite.create_customer(name="E2E Staff", email="e2e@fundhorizon.internal", mobile="9876543210",
                           password_hash="pbkdf2_sha256$test", role="analyst")
sqlite.update_customer(c["id"], {"is_staff": 1, "status": "active"})
tok = secrets.token_urlsafe(32)
sqlite.create_auth_session(c["id"], hashlib.sha256(tok.encode()).hexdigest(),
                           (datetime.now(UTC) + timedelta(days=30)).isoformat())
open("/tmp/fh_e2e_token", "w").write(tok)
E
nohup .venv/bin/uvicorn app.main:app --port 8010 > /tmp/fh_api.log 2>&1 &
cd ../frontend && API_INTERNAL_URL=http://127.0.0.1:8010 nohup npx next dev --port 3100 > /tmp/fh_web.log 2>&1 &
```

Open `http://localhost:3100/backoffice/operations` in Playwright with the cookie `fh_session` = contents of
`/tmp/fh_e2e_token` (domain `localhost`, path `/`):

```js
import { chromium } from "/Users/debabrata/Downloads/Fund-Horizon/frontend/node_modules/playwright/index.mjs";
import fs from "fs";
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
await ctx.addCookies([{ name: "fh_session", value: fs.readFileSync("/tmp/fh_e2e_token", "utf8").trim(), domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto("http://localhost:3100/backoffice/operations");
```

Stop the servers when finished: `pkill -f "uvicorn app.main:app --port 8010"; pkill -f "next dev --port 3100"`.

---

## 3. Tasks (do them in this order)

### Task 1. Fill the four thin FH fund houses (ICICI Prudential, Invesco India, Bandhan, Kotak)

Goal: each should list its **full set of official forms** (application, SIP/STP/SWP, nomination, bank
mandate/change of bank, KYC/CKYC/FATCA/UBO, transmission, minor to major, change of details, transactions/slips,
distributor forms), not 1 or 2 entries. Add what you find to `data/amc_forms_raw.json` through the harvester (preferred)
or, when a page cannot be automated, as explicit rows in `AMC_PDFS` in `backend/scripts/build_official_forms.py`
(`(amc, title, url)`), **only if you actually opened the PDF and confirmed it is the AMC's own form**.

**1a. ICICI Prudential**
* Page: `https://www.icicipruamc.com/media-center/downloads?currentTabFilter=Forms` (React/MUI). It shows a
  "Type of forms" filter with these options: Application Forms, Systematic Investments Forms, KYC and CKYC Forms,
  MF Utility Forms, Service Request Forms, Other Forms, Transmission Request Forms, Distributor Related Forms,
  SOP for reporting the demise of an investor, AMFI Best Practice Guidelines (BPG), Consent Form. Then an APPLY button.
* The document list appears **only after choosing options and pressing APPLY**, and the links are probably not plain
  `<a href>` (our harvester found 0 anchors). Known good file URL pattern: `https://www.icicipruamc.com/blob/downloads/<Category>/<File>.pdf`,
  e.g. `.../blob/downloads/Application-Forms/Common%20Application%20Form.pdf` (already in the catalogue).
* How: open the page headed with Playwright (`page.pause()` or `npx playwright codegen`), open the dropdown, tick each
  option, press APPLY, and watch the DOM/network (`page.on("response")`, `page.on("popup")`) to see how a document
  link is produced (button with `onclick`, `window.open`, or JSON from `apimf.icicipruamc.com`). Extend
  `scripts/harvest_amc_forms.mjs` with a small ICICI-specific block (like `ITERATE_SELECT`) that loops the options.
* Done when: ICICI has at least every form listed under Application, Systematic Investments, KYC/CKYC, Service
  Request, Transmission, Consent and Distributor categories in the catalogue.

**1b. Invesco India**
* Pages: `https://www.invescomutualfund.com/literature-forms/forms/application` (lists many scheme KIMs; only
  `invesco-common-application-form_v1.pdf` is a real form) and `https://www.invescomutualfund.com/literature-forms?category=forms`
  ("Application Forms" link), plus the Literature & Forms menu. Other known form file (from search, verify it opens):
  `https://invescomutualfund.com/docs/default-source/qick-form-pdf/invesco-common-non-financial-transaction-request-form_v10---final.pdf?sfvrsn=434f9ac2_0`.
  Forms live under `/docs/default-source/qick-form-pdf/` (note: that folder also holds scheme KIMs, so keep the
  `NOT` filter).
* How: find every Forms sub-page (Application, Service/Non-financial, SIP/STP/SWP, KYC, Nomination, Transmission,
  Distributor). Add their URLs to `AMCS["Invesco India"]`, and add a matching `FOLLOW` pattern if they are linked
  from the first page. Skip scheme KIMs.

**1c. Bandhan**
* Pages: `https://bandhanmutual.com/downloads/forms` and `https://bandhanmutual.com/downloads/forms/investors`
  (probably also `/distributors`). Note the domain is `bandhanmutual.com` (`bandhanmf.com` does not resolve).
* The forms are not plain anchors in the HTML. Open it headed, expand each section/accordion/tab, and find how the
  download is triggered (button with `data-*` URL, `window.open`, or a CMS/JSON call). Extend the harvester for it.
* Done when: Bandhan lists its application, SIP/STP/SWP, nomination, bank change, KYC, transmission and
  distributor forms.

**1d. Kotak** (bot-protected)
* Page: `https://www.kotakmf.com/Information/forms-and-downloads`. It has a dropdown with these 21 categories:
  Application Forms, SIP Forms, STP Forms, SWP Forms, Banking Forms, Nomination Forms, Minor Forms,
  Transaction Forms, Change Of Details Form, KYC Forms, MF Utility, Pledge Of Units, Other Forms,
  Third Party Payments, Empanelment Form, Change Of Bank Details Form for Brokerage, EUIN Declaration Form,
  Distributor Transfer Of Assets Form, NFO Switch Form, Change of broker Form, Transmission Forms.
  Choosing an option under automation redirects to a **Radware captcha** (`validate.perfdrive.com`).
* **Do not bypass or solve it with a tool.** Implement a **human-assisted mode**: add a flag, e.g.
  `node scripts/harvest_amc_forms.mjs --assist Kotak`, that opens the page in the headed Chrome, then for each
  category prints "Solve the captcha in the window if shown, then press Enter" (`readline`) before harvesting the
  links. The owner runs it once on their machine. Kotak document links are not `.pdf` URLs (e.g. `/documents/...`),
  so for Kotak accept anchors under `https://www.kotakmf.com/documents/` and file-like `/Files/` paths in addition to the
  normal `DOC` regex.
* If you are running unattended and cannot get a human, leave Kotak as the forms-page link (already present) and say
  so in your final report. Do not fake entries.

### Task 2. Complete the partial lists (DSP, Mirae Asset, Edelweiss) and verify the big four

* **DSP** (15 now). `https://www.dspim.com/downloads?category=Forms` has sub-categories selected by URL, e.g.
  `&sub_category=Service%20Forms%20for%20Distributors`, `&sub_category=Transmission%20Documents`, plus SIP/STP/SWP/IDCWTP,
  application, KYC, nomination, bank forms. Collect the sub-category names from the page and visit each URL. Files are
  at `https://www.dspim.com/downloads/<name>.pdf` and redirect (307) to `/media/pages/downloads/...` on the same host
  (the proxy already follows that).
* **Mirae Asset** (11 now, mostly per-scheme application forms). `https://www.miraeassetmf.co.in/downloads/forms`
  also has service forms (nomination/opt-out, change of bank, SIP, KYC, minor to major, etc. in
  `/docs/default-source/transaction-forms/` and similar folders). Related pages: `/update-your-nominee-details`,
  `/investor-hub/transmission-of-units`. Collect them. Drop per-scheme NFO application forms unless they are the
  only way to apply (keep `common-application-form*` and `common-transaction-form*`).
* **Edelweiss** (7 now). `https://www.edelweissmf.com/downloads/forms` (tabs/sections). Known: nomination
  `https://www.edelweissmf.com/Files/downloads/Forms/Service-Request-forms/Edelweiss_Nomination_Form.pdf`; common KIM + CAF under
  `/Files/downloads/Forms/KIM-&-Application-forms/`. Harvest every tab (service request, SIP, KYC, transmission,
  distributor).
* **Verify** HSBC, Nippon India, Helios, HDFC, WhiteOak look complete. One HSBC sub-page timed out during batch 1
  (`.../investor-resources/information-library`). Re-run `node scripts/harvest_amc_forms.mjs HSBC` and compare counts;
  also check each AMC's page by eye for forms the filters dropped (`FORMISH`/`NOT` in the harvester).

### Task 3. Clean the AMC entries

Review `data/official_forms.json` for `source == "AMC"`:
1. List every entry with `category == "Other forms"` and fix `CATEGORY_RULES` in `backend/scripts/build_official_forms.py`
   so they land in a real category, or drop them if they are not forms.
2. Remove non-forms that slipped through (brochures, leaflets, circulars, scheme documents). Prefer tightening the
   `NOT` regex in the harvester over hand-deleting rows.
3. **Editable vs printable duplicates**: when the same form exists as both ("... Editable" and a plain version),
   keep both only if they are genuinely different files; prefer showing the editable one first. Implement as a
   stable sort or a "(printable)" suffix in `_pretty`. Do not drop forms.
4. Titles: every title must read like a form name with the fund house present (the builder prefixes `"<AMC>: "`
   when missing). No raw slugs (`hsbc annexure 2 ...` is acceptable only if the AMC gives no better title).
5. Keep `Forms page` entries: one "official forms page" per AMC must always remain.

### Task 4. Link-check the AMC PDFs

Batch 1 trusted harvested links (they came from the AMC's own pages). Add a verification step to
`backend/scripts/build_official_forms.py` for `source == "AMC"` PDF entries:
* Fetch like the API proxy does (`backend/app/api/backoffice.py::_fetch_official_pdf`: Chrome User-Agent, Referer =
  the host's forms page, `Sec-Fetch-*` headers, follow same-host redirects, require `%PDF`). Run with a small thread
  pool, retry transient failures 2 times.
* **Drop** an entry only when it returns 404/410 or a non-PDF body after retries. Do **not** drop on 403/429/timeouts
  from known bot-protected hosts; keep and print them in a "unverified" list instead.
* Print totals: kept / dropped / unverified per AMC. Put those totals in the final report.

### Task 5. Logos on the fund-house chips (small UI polish)

`frontend/components/BrandLogo.tsx` exports `AmcLogo` (used on the fund lists, it shows the AMC logo or a monogram).
Use it on the AMC chips and on each fund-house section heading in `frontend/app/backoffice/operations/page.tsx`.
`AmcLogo` expects a fund house name such as `"HSBC Mutual Fund"`; map our short names (`"Mirae Asset"`,
`"Nippon India"`, `"Invesco India"`, ...) to the names `AmcLogo` knows (check how it resolves names; reuse its
mapping, do not add a new logo set). Keep chips compact.

### Task 6. Make refresh a one-liner and document it

* Add a `Makefile` target `forms:` that runs, in order, `node scripts/harvest_amc_forms.mjs` then
  `backend/.venv/bin/python backend/scripts/build_official_forms.py`.
* Add 6 to 10 lines to the "Forms" section of `CLAUDE.md` explaining: how to refresh (`make forms`, needs a visible
  Chrome on a dev machine because headless is blocked), how to add a fund house (add to `AMCS` in the harvester and
  to `AMC_PAGES` in the builder, and to `AMC_ORDER` in `operations/page.tsx`), and the captcha rule.
* A GitHub Actions workflow for this is **not** required (headless Chrome is blocked by several AMC sites). Do not add one.

### Task 7. Remaining fund houses (after Tasks 1 to 6 are finished and verified)

The owner wants all fund houses eventually. Using the same method, add the rest, in this order of priority:
SBI, Axis, Aditya Birla Sun Life, UTI, Tata, Franklin Templeton, Motilal Oswal, PPFAS (Parag Parikh), Quant,
Canara Robeco, Sundaram, Baroda BNP Paribas, LIC, Union, 360 ONE, JM Financial, ITI, Navi, Samco, Trust, Quantum,
Bajaj Finserv, Bank of India, Groww, Old Bridge, Zerodha, Shriram, NJ, Unifi, Mahindra Manulife.
The authoritative list of fund houses in our data is the `amc` column of
`data/fundhorizon_mf_rag_dataset/all_schemes_metrics.csv`. For each AMC: find its forms page (search the web), add it
to `AMCS` (harvester), `AMC_PAGES` (builder) and `AMC_ORDER` (page), harvest, review as in Task 3. Skip an AMC whose
forms page is captcha-gated (keep only its forms-page link) and list it in the final report. If time is short,
finish Tasks 1 to 6 and push first, then do Task 7 as a second push.

---

## 4. Definition of done (run all; all must pass)

```bash
# backend tests
cd ~/Downloads/Fund-Horizon/backend && .venv/bin/python -m pytest tests/test_universal_search.py tests/test_pdf_fill.py -q

# frontend: types, lint, font rule
cd ~/Downloads/Fund-Horizon/frontend && npx tsc --noEmit -p . \
  && npx eslint app/backoffice/operations components/operations lib/officialForms.ts \
  && node scripts/check-fonts.mjs

# catalogue sanity
cd ~/Downloads/Fund-Horizon && python3 - <<'E'
import json, collections
d = json.load(open("data/official_forms.json"))
assert len({f["url"] for f in d}) == len(d), "duplicate urls"
for f in d: assert {"source", "category", "title", "url", "kind"} <= f.keys(), f
assert all(f.get("amc") for f in d if f["source"] == "AMC")
print(len(d), collections.Counter(f["amc"] for f in d if f["source"] == "AMC"))
E
```

Also do a visual check (Section 2 setup): on `/backoffice/operations` open **Fund houses (AMC)**, confirm the
chip counts match the catalogue, pick two AMCs (one you fixed in Task 1 or 2), click **Fill & Sign** on a form, confirm
the PDF renders and **Download PDF** returns a file with your typed text on it. Take one screenshot for your report.

Also confirm: universal search (`/api/backoffice/search?q=icici nomination&scope=forms`) returns hits whose subtitle
starts with the fund house name.

---

## 5. Commit and push

1. `git status` must show only the files named in this document (catalogue JSON, raw JSON, harvester, builder, page,
   `officialForms.ts` if the schema changed, `Makefile`, `CLAUDE.md`, tests). No `.db`, no screenshots.
2. Commit message style (imperative, explain the why). Example:
   `Operations: complete ICICI, Invesco, Bandhan, Kotak forms; link-check and tidy AMC catalogue`
3. `git pull --rebase origin main` (other people push to `main`; resolve conflicts, never force-push), re-run the
   checks in Section 4 if the rebase changed anything, then `git push origin main`.
4. Do not leave the dev servers running.

## 6. Final report (reply to the owner, short)

* Forms per fund house before / after (table), and per-AMC counts kept / dropped / unverified from Task 4.
* Anything you could not do and why (for example Kotak without a human, captcha-gated AMCs, load-by-script pages).
* The commit hash that was pushed.
