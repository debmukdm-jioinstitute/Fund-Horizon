// Plain-English methodology for every field in the consolidated client report PDF.
// explain() takes the text boxes of one rendered PDF page plus the hovered box, finds the column header above it and the
// row label beside it, and returns what that cell means, how it is worked out and where the data comes from.

export type Box = { s: string; x: number; y: number; w: number; h: number }; // y grows downwards
type Cells = Record<string, number>;
type Rule = { id: string; re: RegExp; t: string; how: string; src: string; col?: boolean; calc?: (c: Cells, tot: Cells) => string | null };
export type Explained = { title: string; how: string; src: string; row?: string; value: string; calc?: string };

const f = (n: number, d = 2) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const STMT = "Your uploaded statements (CAS, valuation or transaction reports).";
const NAV = "Units from the statement; NAV from the AMFI month-end / latest published NAV.";

// col: true = a column header or KPI label (numbers below it are explained by it). First matching rule wins.
const RULES: Rule[] = [
  // ---- KPI banner, summary and holdings columns
  { id: "invested", col: true, re: /^total invested/i, t: "Total invested (A + B)", how: "All money put in = fresh investments (A) + dividends reinvested (B).", src: STMT,
    calc: (c) => (c.investments != null && c.div_reinv != null ? `${f(c.investments)} + ${f(c.div_reinv)} = ${f(c.investments + c.div_reinv)}` : null) },
  { id: "investments", col: true, re: /^investments \(/i, t: "Investments (A)", how: "Money paid in through purchases, SIPs and switch-ins, less switch-outs.", src: STMT },
  { id: "div_reinv", col: true, re: /^div\. ?reinv/i, t: "Dividend reinvested (B)", how: "Dividends that were used to buy more units instead of being paid out.", src: STMT },
  { id: "div_payout", col: true, re: /^(div\. ?payout|div\.$|payout$)/i, t: "Dividend payout", how: "Dividends paid to your bank account. Not included in the invested amount.", src: STMT },
  { id: "invested", col: true, re: /^invested( amount)?\b/i, t: "Invested amount", how: "Total money put in: purchases, SIPs and switch-ins, plus dividends reinvested.", src: STMT },
  { id: "value", col: true, re: /^(current (market|value)|portfolio value)/i, t: "Current market value", how: "Units held × latest NAV. For PMS and shares, the provider's own value on the statement date is used.", src: NAV,
    calc: (c) => {
      if (c.units == null || c.nav == null) return null;
      const p = c.units * c.nav;
      return `${f(c.units, 3)} units × ₹${f(c.nav, 4)} = ₹${f(p)}` + (c.value && Math.abs(p - c.value) / c.value > 0.000001 ? " (the printed value uses the unrounded NAV)" : "");
    } },
  { id: "gain", col: true, re: /^(unrealised gain|gain \/|profit \/)/i, t: "Gain / (loss)", how: "Current value − money invested. For PMS, money already withdrawn is added back.", src: "Calculated from the two figures above.",
    calc: (c) => (c.value != null && c.invested != null ? `${f(c.value)} − ${f(c.invested)} = ${f(c.value - c.invested)}` : null) },
  { id: "abs", col: true, re: /^(absolute return|abs\. ?ret)/i, t: "Absolute return", how: "(Current value ÷ Invested − 1) × 100. It ignores how long the money stayed invested.", src: "Calculated from the invested amount and current value.",
    calc: (c) => (c.value != null && c.invested ? `(${f(c.value)} ÷ ${f(c.invested)} − 1) × 100 = ${f((c.value / c.invested - 1) * 100)}%` : null) },
  { id: "xirr", col: true, re: /^(annualised return|ann\. ?ret|xirr)/i, t: "XIRR (yearly return)", how: "The yearly rate at which every dated investment and withdrawal grows to today's value. Same method as Excel's XIRR, so the date of each rupee counts. Where a provider prints its own XIRR (marked †), that figure is shown.", src: "Dated transactions in your statements, with today's value as the end point." },
  { id: "hold", col: true, re: /^holdings & timeframe/i, t: "Holdings & timeframe", how: "Number of schemes in the report and the days from the first investment to the valuation date.", src: STMT },
  { id: "holdings", col: true, re: /^holdings$/i, t: "Holdings", how: "Count of schemes or accounts in that asset class.", src: STMT },
  { id: "weight", col: true, re: /^weight/i, t: "Weight", how: "This holding's current value ÷ total portfolio value × 100.", src: "Calculated from current market values.",
    calc: (c, t) => (c.value != null && t.value ? `${f(c.value)} ÷ ${f(t.value)} × 100 = ${f((c.value / t.value) * 100)}%` : null) },
  { id: "units", col: true, re: /^units/i, t: "Units / quantity", how: "Units held on the valuation date. Where a statement gives none, units are rebuilt from dated transactions and NAV.", src: STMT },
  { id: "nav", col: true, re: /^(current nav|nav \(|current$)/i, t: "Current NAV", how: "Price of one unit on the latest published date.", src: "AMFI published NAV." },
  { id: "period", col: true, re: /^investment period/i, t: "Investment period & timeframe", how: "From the first purchase date to the valuation date, shown in years and days.", src: STMT },
  { id: "folio", col: true, re: /^folio/i, t: "Folio / account", how: "The folio or account number on the statement.", src: STMT },
  { id: "name", col: true, re: /^(scheme \/ security|scheme$|fund$)/i, t: "Scheme / security", how: "Name exactly as printed on the statement.", src: STMT },
  { id: "sno", col: true, re: /^s\. ?no/i, t: "Serial number", how: "Running count of rows in this table.", src: "Report order." },
  { id: "asset", col: true, re: /^asset class/i, t: "Asset class", how: "Mutual funds, PMS or stocks, grouped from the type of each holding.", src: STMT },
  { id: "withdrawn", col: true, re: /^withdraw/i, t: "Withdrawn", how: "Money taken out of the account (redemptions and withdrawals).", src: STMT },
  { id: "contribution", col: true, re: /^contribution/i, t: "Contribution", how: "Money you put into the PMS account.", src: "The PMS provider's statement." },
  { id: "provider", col: true, re: /^(provider|strategy)/i, t: "Provider / strategy", how: "The PMS house and the strategy or account name.", src: "The PMS provider's statement." },
  { id: "inception", col: true, re: /^inception$/i, t: "Inception", how: "Date the account or scheme started.", src: STMT },
  { id: "valueon", col: true, re: /^value as on$/i, t: "Value as on", how: "Date the provider's value was struck.", src: "The PMS provider's statement." },
  { id: "pirr", col: true, re: /^provider irr/i, t: "Provider IRR", how: "Yearly return reported by the PMS provider. Not recalculated by Fund Horizon.", src: "The PMS provider's statement." },
  // ---- Financial-year tables
  { id: "fytitle", re: /^(summary|xirr|asset allocation movement)\s*:?$/i, t: "Financial-year table", how: "Year-by-year (April to March) view built from your dated transactions and AMFI month-end NAVs. A '-' means that history is not in the uploaded statements. Nothing is estimated.", src: STMT },
  { id: "fy", col: true, re: /^financial year/i, t: "Financial year", how: "Indian financial year, 1 April to 31 March.", src: "Calendar." },
  { id: "fyvalue", col: true, re: /^value as on 31/i, t: "Value as on 31 March", how: "Units held at that date × AMFI NAV of that date, added across all holdings. The last row is as on the report date.", src: NAV },
  { id: "fynew", col: true, re: /^new investments/i, t: "New investments", how: "Money invested in that year minus money withdrawn, from dated transactions.", src: STMT },
  { id: "net", re: /^net investment/i, t: "Net investment", how: "Sum of new investments across all years.", src: "Calculated from the column above." },
  { id: "since", re: /^since inception/i, t: "Since inception", how: "XIRR from the first investment to the valuation date.", src: "Dated transactions in your statements." },
  { id: "fyrow", re: /^FY \d{4}-\d{2}/, t: "Financial year row", how: "One April–March year. XIRR for a year uses the value on the previous 31 March as the opening amount.", src: STMT },
  { id: "cls", col: true, re: /^(portfolio|mf|pms|stock)$/i, t: "XIRR by asset class", how: "XIRR of just that part of the portfolio for the year. Portfolio = everything together.", src: STMT },
  { id: "dist", col: true, re: /^(debt|equity|other)$/i, t: "Allocation split", how: "Share of portfolio value in that bucket at year end. Debt, equity and other add up to 100%.", src: "Fund category of each holding." },
  { id: "hdrbox", re: /^(group head|family member|category\s*:|inception date|from period|to period)/i, t: "Report header", how: "Who the report covers and the date range used for the year tables.", src: STMT },
  { id: "dagger", re: /†/, t: "† Provider-reported", how: "This figure is as reported in the uploaded provider dashboard. Figures without † are calculated from the statements.", src: "PMS / stock provider dashboard." },
  // ---- Allocation, flows
  { id: "schemes", col: true, re: /^schemes$/i, t: "Schemes", how: "Number of schemes in that group.", src: STMT },
  { id: "inflow", col: true, re: /^category \/ gross inflow/i, t: "Gross inflow by month", how: "Money invested in each category in that month, before any withdrawals.", src: "Dated purchase and SIP lines." },
  { id: "total", col: true, re: /^total \(/i, t: "Total", how: "Row or column total.", src: "Calculated from the cells shown." },
  // ---- Benchmark
  { id: "yourret", col: true, re: /^your return/i, t: "Your return", how: "Same-instalment XIRR of the fund: the yearly return on your actual dated investments.", src: STMT },
  { id: "nifty", col: true, re: /^nifty (50|500|midcap|smallcap)/i, t: "Nifty index return", how: "The yearly return you would have earned by investing the same amounts on the same dates in this index (total-return version where marked TRI). * marks the primary comparison for that fund.", src: "NSE index history; same dates and amounts as your instalments." },
  { id: "sebi", col: true, re: /^official sebi/i, t: "Official SEBI benchmark", how: "The benchmark index the fund is officially measured against under SEBI categorisation rules.", src: "Scheme's SEBI-declared benchmark." },
  { id: "beaten", col: true, re: /^indices beaten/i, t: "Indices beaten", how: "How many of the four Nifty indices your return is higher than.", src: "Compared across the four columns." },
  // ---- Risk
  { id: "cagr3", col: true, re: /^3y cagr/i, t: "3-year CAGR", how: "Compound yearly growth of the NAV over the last 3 years: (NAV now ÷ NAV 3 years ago)^(1/3) − 1.", src: "AMFI daily NAV history." },
  { id: "up", col: true, re: /^up capture/i, t: "Up capture (3Y)", how: "How much of the benchmark's gains the fund captured in months the benchmark rose. Above 100% is better.", src: "Monthly fund and benchmark returns over 3 years." },
  { id: "down", col: true, re: /^down capture/i, t: "Down capture (3Y)", how: "How much of the benchmark's losses the fund took in months the benchmark fell. Below 100% is better.", src: "Monthly fund and benchmark returns over 3 years." },
  { id: "ratio", col: true, re: /^capture ratio/i, t: "Capture ratio", how: "Up capture ÷ down capture. Above 1 means the fund gains more than it loses relative to its benchmark.", src: "Calculated from the two capture figures.",
    calc: (c) => (c.up != null && c.down ? `${f(c.up, 0)}% ÷ ${f(c.down, 0)}% = ${f(c.up / c.down)}` : null) },
  { id: "fall3", col: true, re: /^max fall \(3y\)/i, t: "Maximum fall (3 years)", how: "Biggest drop from a peak NAV to the following low in the last 3 years.", src: "AMFI daily NAV history." },
  { id: "fallall", col: true, re: /^max fall \(all\)/i, t: "Maximum fall (full history)", how: "Biggest peak-to-low drop since the fund launched.", src: "AMFI daily NAV history." },
  { id: "score", col: true, re: /^fh score/i, t: "FH score", how: "Fund Horizon's 0–100 score. It ranks the fund within its category on return, risk, consistency and cost, using only published data.", src: "Fund Horizon scoring engine on AMFI data." },
  { id: "signal", col: true, re: /^fh signal/i, t: "FH signal", how: "Buy / Hold / Review label derived from the FH score and data checks. Research view, not advice. 'Excluded' means data was too thin to score.", src: "Fund Horizon scoring engine." },
  { id: "navdate", col: true, re: /^live nav date/i, t: "Live NAV date", how: "Date of the latest NAV used for this fund's risk figures.", src: "AMFI." },
  { id: "cat", col: true, re: /^category$/i, t: "Category", how: "SEBI category of the scheme.", src: "AMFI scheme classification." },
  // ---- Stress
  { id: "scn", col: true, re: /^market stress scenario/i, t: "Market stress scenario", how: "A past market fall replayed on your holdings.", src: "Each fund's own fall during that window." },
  { id: "cov", col: true, re: /^covered$/i, t: "Covered", how: "Share of your portfolio that has history for this scenario. The rest is left out, not guessed.", src: "Fund history availability." },
  { id: "impact", col: true, re: /^est\. impact \(₹\)/i, t: "Estimated impact (₹)", how: "Each covered holding's value × that fund's fall in the scenario, added up.", src: "Fund NAV history in the scenario window." },
  { id: "impactp", col: true, re: /^impact \(%\)/i, t: "Impact (%)", how: "Estimated impact ÷ covered portfolio value × 100.", src: "Calculated from the column to the left." },
  // ---- Page header, section headings
  { id: "meta", re: /^valuation date:/i, t: "Valuation date, inception, timeframe", how: "Valuation date = the date the values are struck. Inception = date of the earliest transaction found. Timeframe = inception to valuation date, in years and days.", src: STMT },
  { id: "arn", re: /^(ARN:|AMFI registered|generated:)/i, t: "Distributor details", how: "Fund Horizon's AMFI registration number and contact, and the time this PDF was generated (IST).", src: "Fund Horizon." },
  { id: "h1", re: /^1\. consolidated portfolio/i, t: "Section 1: holdings table", how: "One row per scheme or account. Totals are the sum of the rows; return columns are recalculated on the totals.", src: STMT },
  { id: "h1b", re: /^1b\./i, t: "Section 1B: graphs", how: "Charts drawn from the same figures as the tables: category value vs invested, allocation, return vs the four Nifty indices, cash-flow trend.", src: "Figures in this report." },
  { id: "h2", re: /^2[A-D]?\. /i, t: "Section 2: allocation and flows", how: "Groups holdings by asset class and category. Weight = group value ÷ portfolio value. Flows are dated investments grouped by month or period.", src: STMT },
  { id: "h3", re: /^3\. /i, t: "Section 3: Nifty benchmark comparison", how: "Replays your exact instalment dates and amounts into four Nifty indices and compares the yearly returns.", src: "NSE index history and your dated transactions." },
  { id: "h4", re: /^4\. /i, t: "Section 4: quality and risk", how: "Return, capture ratios and maximum fall for each fund with enough NAV history, plus the Fund Horizon score.", src: "AMFI NAV history." },
  { id: "h5", re: /^5\. /i, t: "Section 5: stress test", how: "Replays past market falls on your current holdings and lists plain-English observations.", src: "Each fund's own fall in those windows." },
  { id: "hfy", re: /^financial-year summary/i, t: "Financial-year summary", how: "Year-by-year (April to March) value, new investments, XIRR and debt/equity split.", src: STMT },
  { id: "hps", re: /^(portfolio summary|pms accounts)/i, t: "Summary by asset class", how: "Totals for mutual funds, PMS and stocks, with XIRR since inception. Data gaps are listed, never filled with estimates.", src: STMT },
  // ---- Totals
  { id: "note", re: /^(value as on 31\/03 =|data gaps|note|\d+\. )/i, t: "Note", how: "Plain-language note on how the figures above were built and where history is missing. Nothing is estimated: a gap stays a gap.", src: "This report." },
  { id: "foot", re: /^fund horizon \(arn/i, t: "Page footer", how: "Distributor name, registration number and the time this PDF was generated (IST).", src: "Fund Horizon." },
  { id: "gt", re: /^grand total$/i, t: "Grand total", how: "Sum of every holding above. Weight is 100%; return columns are recalculated on the totals.", src: "Calculated from the rows above." },
  { id: "tot", re: /^total$/i, t: "Total", how: "Sum of the rows above.", src: "Calculated from the rows above." },
];

const num = (s: string) => { const neg = /^\(.*\)$/.test(s.trim()); const n = parseFloat(s.replace(/[₹,%\s()]/g, "")); return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null; };
const match = (s: string) => RULES.find((r) => r.re.test(s.trim()));
const cx = (b: Box) => b.x + b.w / 2;
const sameRow = (a: Box, b: Box) => Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.max(a.h, b.h) * 0.6;

// nearest column header above `b` whose horizontal span lines up with it
function header(items: Box[], b: Box): Rule | undefined {
  let best: { r: Rule; dy: number } | undefined;
  for (const it of items) {
    if (it === b || it.y + it.h > b.y + 1) continue;
    const r = match(it.s);
    if (!r?.col || Math.abs(cx(it) - cx(b)) > Math.max(it.w, b.w) / 2 + 14) continue;
    const dy = b.y - it.y + 3 * Math.abs(cx(it) - cx(b)); // nearest above, but the one centred over the column wins
    if (!best || dy < best.dy) best = { r, dy };
  }
  return best?.r;
}

export function explain(items: Box[], hit: Box): Explained | null {
  const own = match(hit.s);
  const row = items.filter((i) => i !== hit && sameRow(i, hit) && i.x < hit.x && /[A-Za-z]/.test(i.s) && !/^[+\-−]?₹?[\d,.]+%?(\s*p\.a\.)?$/.test(i.s)).sort((a, b) => a.x - b.x)[0]?.s;
  if (own && (own.col || !/^[\d.,\-₹%\s()]+$/.test(hit.s))) {
    return { title: own.t, how: own.how, src: own.src, value: hit.s };
  }
  if (!/^[+\-−]?₹?[\d,.]+%?(\s*p\.a\.)?$|^[-–]$|^\d+ schemes/.test(hit.s)) return null; // only values get a column explanation
  const col = header(items, hit);
  if (!col) return own ? { title: own.t, how: own.how, src: own.src, value: hit.s } : null;
  const rowCells = (at: Box): Cells => {
    const c: Cells = {};
    for (const it of items) {
      if (!sameRow(it, at)) continue;
      const h = it === hit ? col : header(items, it);
      const n = num(it.s);
      if (h && n != null && c[h.id] == null) c[h.id] = n;
    }
    return c;
  };
  const totalBox = items.find((i) => /^grand total$/i.test(i.s));
  return { title: col.t, how: col.how, src: col.src, value: hit.s, row, calc: col.calc?.(rowCells(hit), totalBox ? rowCells(totalBox) : {}) ?? undefined };
}
