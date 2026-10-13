# Fund Horizon — Data Sources & Primary Adapter Registry

## 1. Primary Sources & Capabilities Matrix

Fund Horizon operates under a strict **₹0 incremental spend** constraint for data feeds. Where direct exchange/official automated feeds are restricted by terms, CAPTCHAs, or licensing fees, the system enters an honest capability state (`ready`, `needs_key`, `manual_only`, `unavailable`, `blocked`, `schema_error`) with verified CSV/XLSX import templates rather than fabricating data.

| Coverage Domain | Primary Source / Official Reference | Supported Frequency | Availability State | Free Key Required? | Terms & Permitted Usage Notes |
|---|---|---|---|---|---|
| **Indian MF Latest NAV** | [AMFI Portal](https://portal.amfiindia.com/spages/NAVAll.txt) | Daily (Nightly bulk) | `ready` | No | Public daily publication text file. 8-column header (`Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date;Plan;Option`). Downloaded once per publication cycle. |
| **MF NAV History** | [MFapi](https://api.mfapi.in/mf/) | Nightly incremental | `ready` | No | Free AMFI-derived candidate. Bounded cache on watched/held schemes. Evaluates latest overlapping date/value against AMFI; flags divergence (>0.05%). |
| **Currency Reference Rates** | [ECB Daily XML](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) | Daily (European fixing) | `ready` | No | Official ECB daily eurofxref XML. EUR base. Cross-rate conversion: USD/INR = INR_per_EUR / USD_per_EUR; EUR/USD = USD_per_EUR; GBP/USD = USD_per_EUR / GBP_per_EUR; USD/JPY = JPY_per_EUR / USD_per_EUR. Reference rates, not executable bid/ask quotes. |
| **US Volatility (VIX)** | [Cboe Historical Data](https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv) | Daily closes | `ready` | No | Official Cboe daily closes history (`DATE,OPEN,HIGH,LOW,CLOSE`). Fetched after market close. |
| **US Yields & Macro** | [FRED API](https://fred.stlouisfed.org/docs/api/fred/) | Daily / Monthly | `needs_key` (falls back gracefully) | Yes (Free key) | Documented public API. Candidate series: `DGS10`, `DGS2`, `DGS30`, `DTWEXBGS`. When `FRED_API_KEY` is omitted, system enters `needs_key` state and returns cached/manual data. |
| **Broad Dollar Proxy** | [FRED Series DTWEXBGS](https://fred.stlouisfed.org/series/DTWEXBGS) | Daily | `needs_key` / `ready` | Yes (Free key) | **Trade Weighted U.S. Dollar Index**. Labeled explicitly as a broad dollar proxy; never renamed or conflated with ICE DXY. |
| **Licensed DXY** | [ICE Benchmark Administration](https://www.ice.com/fixed-income-data-services/index-solutions/currency-indices) | Realtime / EOD | `unavailable` | Proprietary License | No verified legal zero-spend live feed exists for ICE DXY. Accepts authorized file import or provider connector if licensed. |
| **India G-Sec Yields** | [FBIL](https://www.fbil.org.in/) / RBI Releases | Daily valuation benchmarks | `ready` / `manual_only` | No | Pricing benchmarks for 10Y (IN10Y) and 2Y (IN2Y) government securities. |
| **Indian Index Derivatives & PCR** | [NSE Derivative Reports](https://www.nseindia.com/all-reports-derivatives) | EOD / Snapshot | `manual_only` | No | Unauthenticated option-chain scraper endpoints (e.g. `/api/option-chain-indices`) frequently return HTTP 404 or block without authenticated session cookies. Validated EOD CSV import is supported out-of-the-box. |
| **FII / DII Institutional Flows** | [NSE FII/DII Reports](https://www.nseindia.com/reports/fii-dii) | Daily reported/provisional | `ready` / `manual_only` | No | Daily reported/provisional cash-market combined figures in ₹ Crore. Preserves provisional vs final status. |
| **PMS Strategy Returns & AUM** | [APMI Performance Portal](https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu) | Monthly disclosures | `manual_only` | No | Strategy-level disclosures published monthly. Direct CSV/XLSX import supported with provider, approach, AUM, and return horizon mappings. |
| **Issuer Corporate Fundamentals** | Official BSE/NSE filings | Quarterly / Annual | `manual_only` | No | Normalized revenue, EBITDA, PAT, debt/equity, and mutual fund look-through coverage. |

---

## 2. Verified Reachability Probes (Execution Environment)

Single unauthenticated GET probes performed during system verification:
- **AMFI Portal `NAVAll.txt`**: HTTP 200 OK (`text/plain`, 8-column normalized layout including explicit `Plan` and `Option` fields).
- **MFapi Scheme Latest (`/mf/119551/latest`)**: HTTP 200 OK (JSON with scheme metadata and date-value records).
- **ECB Eurofxref XML (`eurofxref-daily.xml`)**: HTTP 200 OK (XML with EUR base quotes).
- **Cboe VIX History (`VIX_History.csv`)**: HTTP 200 OK (CSV with chronological daily closes).
- **NSE Option Chain Unauthenticated Probe**: HTTP 404 (confirms unauthenticated scraper cannot be relied upon in production; manual/authorized EOD import pathway is required).

---

## 3. Manual Import CSV Schemas & Templates

The backoffice includes a two-stage manual import pipeline: **Template Download → Preview & Validation → Atomic Commit with Rollback**. Formula injection defense strips or escapes leading `=`, `+`, `-`, `@`, `\t`, `\r`.

### A. PMS Strategy Disclosures (`pms_strategies`)
```csv
provider_name,strategy_name,investment_approach,aum_crore,return_1m_pct,return_1y_pct,return_3y_cagr_pct,benchmark_name,report_month
ASK Investment Managers,ASK Indian Entrepreneur Portfolio,Equity,4250.5,1.8,24.5,18.2,NIFTY 500 TRI,2026-09
WhiteOak Capital,Pioneers Equity PMS,Equity,1820.0,-0.4,19.8,16.5,BSE 500 TRI,2026-09
```

### B. Option Chain & PCR Contracts (`option_chain`)
```csv
underlying,expiry_date,strike_price,option_type,oi,volume,implied_volatility,underlying_price
NIFTY,2026-10-29,25000,CE,125000,45000,14.2,25150.0
NIFTY,2026-10-29,25000,PE,145000,62000,15.1,25150.0
NIFTY,2026-10-29,25100,CE,98000,38000,14.5,25150.0
NIFTY,2026-10-29,25100,PE,112000,51000,15.4,25150.0
```

### C. FII / DII Institutional Flows (`flows`)
```csv
report_date,category,segment,buy_crore,sell_crore,net_crore,provisional
2026-10-09,FII/FPI,Cash,11250.4,9850.2,1400.2,false
2026-10-09,DII,Cash,8940.1,7120.5,1819.6,false
```

### D. Issuer Corporate Fundamentals (`fundamentals`)
```csv
symbol,company_name,fiscal_period,reporting_scope,revenue_crore,ebitda_crore,ebitda_margin_pct,pat_crore,net_debt_crore,debt_equity_ratio,mf_lookthrough_weight_pct,filing_id
INFY,Infosys Limited,Q1 FY27,Consolidated,39315.0,9820.0,25.0,6370.0,-14500.0,0.00,4.8,BSE_CORP_20260718
TCS,Tata Consultancy Services,Q1 FY27,Consolidated,62613.0,16500.0,26.3,12100.0,-18200.0,0.00,5.2,BSE_CORP_20260712
```
