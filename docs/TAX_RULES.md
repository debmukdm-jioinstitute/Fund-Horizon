# Tax rules, sources and review checklist

Everything the tax engine uses lives in three files under `backend/app/config/`:

| File | What it holds |
|---|---|
| `tax_rules.yaml` | Slabs, rebate, surcharge, cess, deduction limits, capital gains rates, TDS thresholds, small-savings rates, section labels, sources |
| `mf_tax_classes.yaml` | How each canonical fund category is taxed (equity-oriented, debt-oriented, 24-month rule, gold, international) |
| `tax_catalog.yaml` | 24 savings and investment options explained in plain English, with their tax treatment |

**Status: compiled October 2026 from public sources. `verified: false`. Not reviewed by a chartered
accountant.** The API (`/api/tax/rules`), the UI and the PDF all say so. Flip `verified` to `true` only after a
CA signs off, and say who and when in the commit message.

Scope: resident individuals, FY 2026-27 (AY 2027-28). NRIs, HUFs, businesses, foreign income, AMT and set-off
of losses are out of scope and the UI says so.

## Figures and where they came from
| Item | Value used | Source |
|---|---|---|
| New regime slabs | 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, above 24L 30% | BusinessToday Budget 2026 summary (slabs unchanged by Budget 2026) |
| New regime standard deduction | 75,000 | same |
| 87A rebate, new regime | up to 60,000 if taxable income is 12L or less, with marginal relief above | same |
| Old regime slabs | under 60: 2.5/5/10L; 60-79: 3L exempt; 80+: 5L exempt; 5% / 20% / 30% | long-standing law; senior bands cross-checked with public explainers |
| Old regime standard deduction and rebate | 50,000; 12,500 if taxable income is 5L or less | public explainers |
| Cess | 4% | public explainers |
| Surcharge | new regime capped at 25%; old regime up to 37%; marginal relief applied | public explainers |
| 80C / 80CCD(1B) / 80D / 24(b) / 80TTA / 80TTB limits | 1.5L / 50k / 25k-50k self and 25k-50k parents (1L max) / 2L / 10k / 50k | public explainers |
| Employer NPS 80CCD(2) | 14% of basic + DA in the new regime; old regime 14% government, 10% others | public explainers; sources disagreed on whether private employers' 14% is mandatory, so the engine caps at the stated limit |
| Equity MF / listed shares | LTCG 12.5% above 1.25L a year after 12 months; STCG 20% | ICICI Prudential AMC "Snapshot of Mutual Funds Taxation 2026-27" (per Finance Act 2026) |
| Specified / debt MF (over 65% debt) | slab rate always for units bought on or after 1 Apr 2023 | same |
| Gold, silver, international FoF | 12.5% after 24 months, otherwise slab; gold and international ETFs after 12 months | same |
| Hybrid funds | 65% or more equity = equity rules; over 65% debt = specified; in between = 24-month rule | same |
| Small savings, Oct-Dec 2026 | PPF 7.1, NSC 7.7, SSY 8.2, SCSS 8.2, KVP 7.5, MIS 7.4, post-office TD 5y 7.5 | Business Today, 30 Sep 2026 notification |
| FD interest TDS threshold | 50,000 (1 lakh for seniors) | public explainers; marked for verification |

## Income-tax Act, 2025 section numbers
The new Act applies from 1 April 2026 and renumbers sections. Secondary sources disagree on several numbers,
so the UI shows the **legacy label** (80C, 80D ...) that customers and employers still use, and adds the new
number only where sources agree: 80C = Section 123, 80D = Section 126, NPS deductions = Section 124. The
`agreed` flag per label in `tax_rules.yaml` controls this. 24(b), 87A, 80TTB and HRA show the legacy label only.

## How the engine works
1. `tax_plan.inputs_from_profile` turns the customer's answers into yearly figures. If basic salary is blank it
   assumes 40% of gross. FD and savings interest is added to income (it is taxable) and also used for 80TTB.
2. `tax.regime_tax` computes slab tax, rebate (with marginal relief), surcharge (with marginal relief) and cess
   for each regime. `tax.compare_regimes` picks the cheaper one, finds the extra old-regime deductions needed to
   match it, and checks whether using every old-regime limit would change the answer.
3. `tax_nudges.build_nudges` runs 14 rules. Every rupee figure is the difference between two runs of
   `regime_tax` (for deductions) or a direct rate calculation (for capital gains). Nudges are ranked by
   estimated saving.
4. Switches (recomputed on the server, nothing stored): regime (auto, old, new), **Show after tax**, **Apply** per
   idea, and **Reinvest the tax I save**.
5. After-tax view: `tax.post_tax_returns` lowers each asset class's planning return for the goal's own horizon
   using a terminal-value method (equity 12.5% plus cess after 12 months; debt and liquid at the marginal slab
   rate; gold 12.5% after 24 months). The 1.25 lakh equity exemption is ignored, so equity is slightly
   understated. Simulation means move by the same amount, and the retirement corpus return moves by the debt
   change. Pre-tax stays the default.
6. Reinvest: the monthly tax saved by applied ideas is added to the non-emergency surplus before goals are
   funded.

## Known simplifications
- One rent figure for the whole year; HRA exemption uses the least-of-three rule only.
- Capital gains are taxed at special rates on top, without basic-exemption adjustment, and are the same in both
  regimes.
- No AMT, professional tax, state rules, set-off or carry-forward of losses, perquisite tax above 7.5 lakh of
  employer contributions (mentioned as a watch-out only).
- Debt-fund tax is computed at redemption, not accrued yearly. FD interest is taxed yearly as income.
- Capital-gain harvesting savings are shown as tax avoided later, not as this year's saving, and are not
  reinvested.
- Marginal rate is measured over the next 10,000 of income, so inside the rebate zone it can read as 0% or,
  just above 12 lakh in the new regime, very high.

## CA review checklist
- [ ] Slabs, rebate, surcharge and cess for both regimes (`tax_rules.yaml`)
- [ ] Standard deduction and the employees who can claim it (pensioners, family pension)
- [ ] 80C list, 80CCD(1B) / (2) caps, 80D tiers, 24(b), 80TTA / 80TTB, HRA formula
- [ ] Capital gains table and holding periods for every category in `mf_tax_classes.yaml`, especially hybrids,
      multi-asset, solution-oriented and fund-of-funds entries marked `check_factsheet`
- [ ] Each instrument in `tax_catalog.yaml` (tax in, growth, exit) and the small-savings rates
- [ ] Nudge wording in `engine/tax_nudges.py` and `frontend/components/TaxSection.tsx`
- [ ] Disclosure strings in `config/disclosures.py` (`TAX_*`, `POST_TAX_NOTE`)

## Updating each year
1. After the Union Budget, edit `tax_rules.yaml` (rates, limits, `fy`, `ay`, `as_of`, sources) and
   `mf_tax_classes.yaml` if capital gains rules changed.
2. Refresh small-savings rates each quarter and `tax_catalog.yaml` return notes.
3. Run `cd backend && .venv/bin/python -m pytest tests/test_tax*.py`. Hand-checked values in `test_tax.py` will fail
   if a rate moved; update them with new hand calculations, not by copying the new output.
4. Set `verified: false` until the CA has reviewed the change.
