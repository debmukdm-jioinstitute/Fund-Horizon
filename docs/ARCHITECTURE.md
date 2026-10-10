# Architecture and decisions (ADR)

## Shape
```
Next.js 14 (App Router, TS, Tailwind, Recharts)  --HTTP/JSON-->  FastAPI (Pydantic v2)
                                                                    |
                                  pure engine (backend/app/engine) -+- SQLite (plans by UUID)
                                  config yaml/json/py (backend/app/config)
                                  dataset CSVs loaded once at startup (pandas)
                                  PDF: ReportLab + matplotlib (backend/app/report)
```
- **Engine is pure**: every number comes from functions in `backend/app/engine/` that take plain
  inputs and return dicts. No network, no LLM, no randomness except the seeded Monte Carlo.
- **Pipeline** (`engine/pipeline.py`): profile -> per-goal plan (allocation, SIP, Monte Carlo) ->
  goal-weighted portfolio allocation -> fund shortlist -> stress test.
- **Config over code**: assumptions (`assumptions.yaml`), allocation tables (`allocation.yaml`),
  scoring weights (`scoring.yaml`), questionnaire (`questionnaire.json`) and all compliance copy
  (`disclosures.py`) can be edited without touching logic.
- **Persistence**: `POST /api/plans` stores request + result in SQLite with a random UUID. No auth.
  `GET /api/plans/{id}?step_up=` recomputes from the stored request (not persisted) so the UI toggle
  works without creating new plans.

## Decisions where the spec was ambiguous (conservative option chosen)
1. **Freed equity goes to debt and liquid, not gold.** The spec says redistribute to debt/gold/liquid
   in the band's proportions. In the Aggressive band (debt 7 / gold 6 / liquid 2) that puts 28% gold in
   a 4-year goal. `freed_equity_targets` in `allocation.yaml` defaults to `[debt, liquid]`; add `gold`
   to restore the literal behaviour.
2. **Goals under 3 years** hold 50% liquid fund + 50% short-duration fund (the spec's "liquid/money
   market" is implemented as liquid). Money-market funds remain in the dataset for later use.
3. **Retirement goal amount**: `target_amount_today` is the *yearly spending wanted in retirement, in
   today's rupees*. 0 means "assume 70% of current household expenses" (`spend_ratio_if_unspecified`).
   The corpus is the PV at the post-retirement return of an inflation-growing annuity-due.
4. **Monthly rate** = (1+annual)^(1/12) - 1 for planning (never higher than annual/12). The spec's
   textbook check (12% p.a. = 1% a month) is tested directly on `sip_fv`.
5. **Success probability looks like ~50% for a fully funded goal.** SIPs are sized at the assumed
   (central) return, so a fully funded plan reaches its target in about half of simulated paths. The UI
   and PDF always show the SIP needed for ~80% success next to it.
6. **Gold funds** have no clean AMFI category; they are identified by scheme name (`\bgold\b`). Exchange
   traded gold units are flagged `needs_demat` and excluded from the shortlist; gold FoFs are used.
7. **Category normaliser** merges "Ultra Short", "Short Term" and "Short Duration" into
   `short_duration`, and old/new SEBI labels into one key (e.g. both "Equity Scheme - Large Cap Fund"
   and "Equity Schemes - Large Cap Fund" -> `large_cap`). A test asserts every allocator category has
   at least 5 eligible schemes.
8. **Interval funds** are excluded along with close-ended ones (only "Open Ended" structure passes).
9. **Merging small positions**: a fund under 5% (or the smallest when more than 8) is merged into the
   nearest category in `merge_prefer` (e.g. small cap -> mid cap), not simply the largest fund.
10. **Stress test uses month-end NAVs** (the only history in the dataset). The Feb-Mar 2020 fall is
    measured from the Jan-2020 month-end, so intra-month lows are missed. Funds lacking history in a
    month use the median monthly return of their category and are flagged as substituted.
11. **Emergency-fund top-up is shown separately**; it is not deducted from the surplus available to
    goal SIPs. Goals are funded from the full surplus in priority order (priority, then shorter horizon).
12. **Questionnaire**: Q5 has four options scored 1, 2, 4, 5 (as specified, no 3); Q9 option scores are
    1, 5, 1, 2 in the listed order.
13. **No Direct plans anywhere in the shortlist** (they are in the dataset only for a later
    cost-comparison feature).
14. **Python**: pinned to 3.13 in the venv (`uv venv --python 3.13`); the code also runs on 3.11+.

## Extension points (`# EXTENSION:` comments)
AUM / TER filters and scoring (`data/loader.py`, `engine/funds.py`), a chat layer on top of
`/api/plans`, CAS import, and authentication (`db/sqlite.py` user_id column).
