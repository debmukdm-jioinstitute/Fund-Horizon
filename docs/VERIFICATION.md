# Verification (run on 2026-10-10, data as of 2026-10-09)

All numbers below were produced by the commands shown, not assumed.

## Automated checks
| Check | Command | Result |
|---|---|---|
| Backend tests | `cd backend && .venv/bin/python -m pytest tests --cov=app/engine --cov-fail-under=85` | **398 passed**, engine coverage **97.68%** (floor 85%) |
| Backend lint | `.venv/bin/ruff check app tests` | All checks passed |
| Frontend lint | `cd frontend && npm run lint` | No ESLint warnings or errors |
| Type check | `npx tsc --noEmit` | No errors |
| Banned-wording scan (frontend) | `node scripts/check-copy.mjs` | ok |
| Production build | `npm run build` | Compiled; 4 routes (`/`, `/plan/new`, `/plan/[id]`, `/_not-found`) |
| End-to-end | `npx playwright test` | **1 passed** (wizard with fixture persona, validation messages, consent, results page, step-up toggle, PDF download > 20 KB starting `%PDF`) |

Tests per file: allocation 217 (every band x horizon 1-40 years sums to 100), profiling 63, funds 26,
planning 15, categories 18, API 19, finmath 11, montecarlo 10, personas 8, report 6, stress 3,
compliance copy 2.

Required anchors confirmed: SIP of Rs 10,000 / month at 1% a month for 120 months = Rs 23,00,387
(ordinary) and Rs 23,23,391 (annuity due); the inverse returns Rs 10,000 within Rs 1.

Other checks: PDF built with sockets blocked (works offline); PDF is 7 pages for each persona (limit 6-9
in the test); no NaN/Infinity in API JSON; mobile width 375 px has no horizontal scroll; browser console
clean on the results page.

## Manual end-to-end
Both servers were run locally (`uvicorn` on 8000, `next dev` on 3000). The landing page, wizard and
results dashboard were opened in a browser; the results page rendered the profile, donut, shortlist,
stress chart, goal cards with fan charts and the step-up toggle. Edge inputs run through the pipeline
without errors: zero income (retired), zero expenses, six goals, a 40-year goal, a 1-year goal, negative
surplus, age 80.

## Persona outputs (golden files in `backend/tests/golden/`)

### Young, aggressive (26, salaried, no dependents)

- Capacity **87.75**, tolerance **90.0**, final **87.75** -> **Aggressive**. Priority actions: none. Mismatch note: no.
- Overall mix: equity 84.03%, debt 7.75%, gold 6.0%, liquid 2.22%; 6 funds.
- Stress: Feb-Mar 2020 -22.1%, worst peak-to-trough -22.1%, worst rolling 12m -19.7%.

| Goal | Years | Equity | Future cost | SIP needed | SIP funded | Status | Success (funded SIP) | SIP for 80% |
|---|---|---|---|---|---|---|---|---|
| Retirement | 34 | 85% | Rs 57,597,525 | Rs 17,046 | Rs 17,046 | funded | 49.6% | Rs 27,996 |
| Home down payment | 8 | 70% | Rs 3,984,620 | Rs 27,928 | Rs 27,928 | funded | 52.9% | Rs 32,566 |

### Mid-career with dependents (38, 3 dependents, EMIs)

- Capacity **69.75**, tolerance **57.5**, final **57.5** -> **Moderate**. Priority actions: none. Mismatch note: no.
- Overall mix: equity 49.88%, debt 33.1%, gold 10.0%, liquid 7.02%; 8 funds.
- Stress: Feb-Mar 2020 -13.9%, worst peak-to-trough -13.9%, worst rolling 12m -9.5%.

| Goal | Years | Equity | Future cost | SIP needed | SIP funded | Status | Success (funded SIP) | SIP for 80% |
|---|---|---|---|---|---|---|---|---|
| Child education | 12 | 50% | Rs 8,437,994 | Rs 33,712 | Rs 33,712 | funded | 54.1% | Rs 38,458 |
| Child marriage | 20 | 50% | Rs 7,739,369 | Rs 12,292 | Rs 0 | unfunded | 0.0% | Rs 14,653 |
| Retirement | 22 | 50% | Rs 64,404,462 | Rs 83,447 | Rs 41,288 | partially funded | 0.6% | Rs 100,934 |
| Family travel | 4 | 30% | Rs 504,991 | Rs 8,974 | Rs 0 | unfunded | 0.0% | Rs 9,415 |

### Near retirement (58, govt, two 2-year goals)

- Capacity **84.0**, tolerance **30.0**, final **30.0** -> **Moderately Conservative**. Priority actions: Insurance first. Mismatch note: yes.
- Overall mix: equity 0.0%, debt 50.0%, gold 0.0%, liquid 50.0%; 2 funds.
- Stress: Feb-Mar 2020 0.0%, worst peak-to-trough 0.0%, worst rolling 12m 3.6%.

| Goal | Years | Equity | Future cost | SIP needed | SIP funded | Status | Success (funded SIP) | SIP for 80% |
|---|---|---|---|---|---|---|---|---|
| Daughter wedding | 2 | 0% | Rs 2,862,250 | Rs 111,894 | Rs 110,000 | partially funded | 4.5% | Rs 112,822 |
| Retirement | 2 | 0% | Rs 15,619,035 | Rs 213,404 | Rs 0 | unfunded | 0.0% | Rs 220,549 |

### Low emergency fund (31, freelance, no cover)

- Capacity **53.75**, tolerance **97.5**, final **53.75** -> **Moderate**. Priority actions: Build emergency fund first, Insurance first. Mismatch note: yes.
- Overall mix: equity 49.62%, debt 33.13%, gold 9.92%, liquid 7.32%; 8 funds.
- Stress: Feb-Mar 2020 -13.8%, worst peak-to-trough -13.8%, worst rolling 12m -9.4%.

| Goal | Years | Equity | Future cost | SIP needed | SIP funded | Status | Success (funded SIP) | SIP for 80% |
|---|---|---|---|---|---|---|---|---|
| Emergency corpus | 2 | 0% | Rs 449,440 | Rs 17,570 | Rs 17,570 | funded | 49.4% | Rs 17,716 |
| Retirement | 29 | 50% | Rs 59,180,305 | Rs 39,214 | Rs 5,430 | partially funded | 0.0% | Rs 49,252 |

### Plausibility review
- The 58-year-old's two 2-year goals hold 0% equity and the whole shortlist is two debt/liquid funds. The
  tolerance (30) binds and a mismatch note is shown; "Insurance first" appears because there is a
  dependent and no term cover.
- The freelancer with Rs 50,000 of liquid assets gets "Build emergency fund first" and a 9-month target;
  the band stays at Moderate because the capacity score already puts them there.
- The mid-career persona's surplus (Rs 75,000) is fully used: priority-1 goals first (shorter horizon
  first), so child education is funded, retirement is partly funded and the two lower-priority goals are
  not funded yet. Levers are shown for each shortfall.
- Fully funded goals show about 50% success. This is expected: SIPs are sized at the planning return, so
  the central path just reaches the target. The 80%-success SIP is shown beside it.

## Known limitations
- Stress test uses month-end NAVs (see ARCHITECTURE.md, decision 10).
- No AUM or expense-ratio data, so the shortlist ranks on past performance only.
- Gold funds in the shortlist can show very high recent CAGR (a metal rally); that is a ranking input, not
  a forecast.
- SQLite file `backend/plans.db` is created on first plan; there is no cleanup job or authentication.
- Playwright smoke test needs both servers; `playwright.config.ts` starts them if they are not running.

## Tax engine (added 2026-10-11)
| Check | Command | Result |
|---|---|---|
| Backend tests | `cd backend && .venv/bin/python -m pytest tests -q` | **597 passed** (507 existing + 88 new tax tests: maths, nudges, pipeline, API, PDF, copy scan; +2 from a concurrent insurance commit) |
| Tax module coverage | `--cov=app/engine` | `tax.py` 99%, `tax_nudges.py` 98%, `tax_plan.py` 100% |
| Engine coverage overall | same | 84%: below the 85% floor because `engine/cas.py` is at 54% (already so before this work; the baseline was 80.8%) |
| Backend lint | `ruff check app tests` | passed |
| Frontend | `npm run lint`, `npx tsc --noEmit`, `node scripts/check-copy.mjs`, `npm run build` | all passed; new routes `/learn`, `/learn/[id]`, `/tax` |
| End to end | `npx playwright test` | **17 passed** (14 existing, 3 new: tax skip, `/learn`, `/tax`; the main flow now fills the tax steps and flips the plan's tax switches) |

Hand-checked tax values (see `backend/tests/test_tax.py`): new regime, salaried, 12.75 lakh = nil (taxable 12 lakh, rebate
60,000); 15 lakh = 97,500; 15.75 lakh = 1,09,200; 13 lakh = 26,000 (marginal relief); old regime 10 lakh = 1,06,600;
10 lakh with 1.5 lakh of 80C = 75,400; new regime 60 lakh = 15,52,980 (10% surcharge); surcharge 35,000 after marginal
relief on 10,95,000 of tax at 50.5 lakh.

Tax personas (`backend/tests/fixtures/tax_personas.json`):
- **Salaried, 20 lakh, old regime now:** old regime 3,11,064 vs new 2,04,880 (both verified by hand); the plan says
  "Switch to the new regime" and shows that even using every old-regime limit the old regime costs 54,080 more.
  Applying 80C + NPS in the old regime cuts tax by 34,320 a year (2,860 a month); after-tax sizing raises the
  retirement SIP from 49,439 to 63,261.
- **Retired, 66, 6 lakh pension + 4 lakh FD interest:** old regime 85,280 vs new regime nil; the plan points to the
  new regime and to Form 15H.

Also checked in the browser: the plan's Tax planning section, every switch, `/learn` (24 options), `/tax`, and the
375 px layout (no horizontal scroll on `/learn`, `/tax`, `/learn/[id]` or the plan page).

Limits: tax figures come from public secondary sources and are not CA-reviewed (`verified: false`); see
[TAX_RULES.md](TAX_RULES.md). The after-tax view ignores the 1.25 lakh equity exemption.
