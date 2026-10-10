# Fund Horizon: Indian Mutual Fund RAG Dataset

Data as of **2026-10-09** (last business day; most schemes' latest NAV). Liquid and overnight funds also publish weekend-dated NAVs, so a few schemes show latest NAV dates of 2026-10-10 or 2026-10-11. Built 2026-10-10.

## What is in the zip

| Path | Contents | Use in RAG |
|---|---|---|
| `schemes_md/` | One Markdown file per scheme (3,638 files): returns, risk, rolling returns, calendar-year returns, data-quality banner | Main chunks (one file = one chunk, ~700 tokens) |
| `categories/` | One page per SEBI category: median stats and a 3-year-CAGR ranking of all clean schemes | "Best fund in category X", comparisons |
| `amcs/` | One page per AMC: all its schemes with headline returns | "Show me HDFC funds" |
| `all_schemes_metrics.csv` | Every metric for every scheme, one row each | Tool / SQL / pandas queries |
| `category_summary.csv` | Category medians (clean schemes only) | Benchmarks vs category |
| `schemes_json/` | Same as markdown, structured | Programmatic use, metadata filters |
| `nav_monthly/` | Month-end NAV per scheme (`{scheme_code}.csv`) | Charts, custom calculations |
| `all_schemes_master.csv` | Full AMFI master (14,372 rows incl. IDCW, closed-ended) | Scheme lookup, ISIN mapping |
| `amfi_navall_raw.txt` | Raw AMFI file as downloaded | Audit trail |
| `fetch_failures.csv` | Schemes with no usable NAV history | Audit |
| `build_dataset.py` | Full pipeline to refresh the data | Re-run daily or weekly |
| `ingest_example.py` | ChromaDB + bge-small ingestion and query example | Starter |

## Scope

- **Plans/options:** Regular **and** Direct plans, **Growth option only** (Fund Horizon sells Regular plans; Direct is included for the regular-vs-direct comparison).
- **Universe:** open-ended, close-ended and interval schemes listed in AMFI's NAV file with a usable NAV history.
- **Not included** (not in AMFI's NAV feed; needs separate sources): AUM, expense ratio (TER), exit load, portfolio holdings, fund manager, benchmark index, riskometer, factsheets and scheme documents. Add these from AMC factsheets or AMFI monthly data before using the dataset for recommendations.
- **Fund Horizon's own client or "branch" performance** is private data and is not part of this dataset. `categories/` provides category-level performance instead.

## Method

- Source: AMFI `NAVAll.txt` (scheme master, latest NAV) and mfapi.in (full NAV history per scheme).
- Trailing returns: absolute for periods up to 1 year, annualised CAGR above 1 year. Measured to the scheme's latest NAV, from the NAV on or before the start date.
- Rolling returns: monthly sampling, 1, 3 and 5-year CAGR windows (min, median, max, % positive).
- Risk (3-year daily returns): annualised volatility, Sharpe and Sortino (risk-free rate assumed **6.5%**), maximum drawdown.
- Returns are **NAV-based, pre-tax** and, for Growth options, already net of expenses. They are not XIRR/SIP returns.

## Data-quality flags (`data_quality` column and top-of-file banner)

| Flag | Meaning | In rankings? |
|---|---|---|
| `ok` | Clean history | Yes |
| `split_adjusted` | Single-day jumps at integer ratios (>=5x, e.g. liquid-fund face-value changes) were spliced so history is continuous | Yes |
| `nav_shock` | Unexplained single-day jump over 30% (possible credit event or data error) | No |
| `segregated_portfolio` | Side-pocket units | No |
| `inactive_or_stale` | No NAV for over 7 days before the as-of date; metrics not computed | No |
| `flat_nav` | NAV essentially constant; risk ratios meaningless | No |

Filter retrieval on `data_quality in (ok, split_adjusted)` for any recommendation-style question.

## Known limitations

- **Sharpe/Sortino for liquid and overnight funds** are unstable (tiny volatility, and a fixed 6.5% risk-free rate). Do not rank those categories on Sharpe.
- **Duplicate scheme names** exist in AMFI's data (different codes, same name, e.g. segregated or legacy classes). Always cite `scheme_code`.
- A few schemes carry a `REVIEW FLAG` for 1-year returns above +100%. Verify these against the AMC factsheet before quoting.
- Splits in the 2 to 4x range are deliberately **not** auto-adjusted, because they are too easily genuine crashes or recoveries; such cases fall under `nav_shock`.
- Past performance may or may not be sustained. This is descriptive data, not investment advice. Under SEBI rules a mutual fund distributor should present such data as product information, not as advisory recommendations; confirm wording with the firm's compliance contact.

## Refresh

```
pip install pandas numpy
python build_dataset.py OUT_DIR --include-direct --workers 16   # ~5 minutes
```
