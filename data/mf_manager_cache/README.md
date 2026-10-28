# AMC Fund Manager Cache (`data/mf_manager_cache/`)

This directory contains per-AMC fund manager and tenure disclosure data collected directly from public factsheets and official scheme disclosures.

## File Format

Each `<amc_slug>.csv` file contains the following columns:

| Column | Type | Description |
|---|---|---|
| `scheme_code` | int / str | AMFI scheme code matching `mf_screener._base_frame()` |
| `manager_name` | str | Lead fund manager name |
| `manager_start` | str | ISO 8601 start date (`YYYY-MM-DD`) when tenure began |
| `source` | str | Provenance identifier, e.g. `amc_site:hdfc` |
| `url` | str | Public factsheet or disclosure URL |
| `fetched_at` | str | Fetch date (`YYYY-MM-DD`) |

## Resolution Order & Precedence

When `manager_resolver.resolve()` or `sync_managers()` runs, sources are resolved in the following layer order:

1. **`stored`**: Staff manual edits and existing database rows (manual imports are never overwritten).
2. **`_cached`**: Fresh AMC factsheet disclosures in `data/mf_manager_cache/*.csv`.
3. **`_seed`**: Base seed entries in `data/mf_managers_seed.csv` (start dates can be enriched from lower layers if missing).
4. **`_amfi`**: Consolidated static reference snapshot (`India_MF_Static_Reference_Consolidated.csv.gz`).
5. **Sibling Propagation**: Sibling plans (Direct, Regular, IDCW options) inherit the lead manager and start date from their verified fund sibling.

## Covered AMCs

The collection script `backend/scripts/collect_amc_managers.py` supports:
- `icici_prudential` (ICICI Prudential Mutual Fund)
- `hdfc` (HDFC Mutual Fund)
- `sbi` (SBI Mutual Fund)
- `aditya_birla_sun_life` (Aditya Birla Sun Life Mutual Fund)
- `nippon_india` (Nippon India Mutual Fund)
- `bandhan` (Bandhan Mutual Fund)
- `tata` (Tata Mutual Fund)
- `invesco` (Invesco Mutual Fund)
- `dsp` (DSP Mutual Fund)
- `ppfas` (PPFAS Mutual Fund)
- `mirae` (Mirae Asset Mutual Fund)
- `quant` (quant Mutual Fund)
- `baroda_bnp` (Baroda BNP Paribas Mutual Fund)
- `union` (Union Mutual Fund)
- `motilal` (Motilal Oswal Mutual Fund)
- `axis` (Axis Mutual Fund)
- `lic` (LIC Mutual Fund)
- `zerodha` (Zerodha Mutual Fund)
- `quantum` (Quantum Mutual Fund)
- `samco` (Samco Mutual Fund)
- `franklin_templeton` (Franklin Templeton Mutual Fund)
- `groww` (Groww Mutual Fund)
- `pgim` (PGIM India Mutual Fund)
- `shriram` (Shriram Mutual Fund)
- `360_one` (360 ONE Mutual Fund)

### Skipped AMCs (Compliance & Access Rules)
- **Canara Robeco**: Skipped due to robots.txt disallowing `/wp-content/uploads/` on `www.canararobeco.com`.
- **Kotak Mahindra**: Factsheet gated behind Akamai anti-bot HTML gate. Per policy, anti-bot mechanisms are respected and never bypassed.
- **WhiteOak Capital**: Public factsheet link returned 0 bytes / empty content.

## How to Run

```bash
# Run single AMC
PYTHONPATH=backend python backend/scripts/collect_amc_managers.py --amc hdfc

# Dry run (test extraction without writing CSVs)
PYTHONPATH=backend python backend/scripts/collect_amc_managers.py --dry-run

# Run full collection
PYTHONPATH=backend python backend/scripts/collect_amc_managers.py
```

## Automated Refresh

The GitHub Actions workflow `.github/workflows/amc-managers-refresh.yml` executes on the 1st of each month (and via manual `workflow_dispatch`). It runs collection, verifies the quality threshold (`with_start >= 2500`), and commits changes via `fh-data-bot`.
