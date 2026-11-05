// More backoffice calculators, reverse-engineered from the advisor tool's calculator suite and checked against its outputs
// (frontend/scripts/calc-stress.ts replays recorded originals plus edge cases). Pure functions only.
// Conventions (the original's): SIP / goal / NPS / NPS-style schemes invest at the START of each month and the monthly rate is
// the effective one, (1 + annual rate)^(1/12) - 1. Lump sums and inflation compound annually. Rupee figures are rounded as the original does.
import type { Calculator, Field, Failure } from "./calculators";

const MAX = 1e12;
const err = (...errors: string[]): Failure => ({ ok: false, errors });
const amt = (key: string, label: string, o: Partial<Field> = {}): Field => ({ key, label, unit: "₹", min: 0, max: MAX, step: 1, ...o });
const yrs = (key: string, label: string, max = 60, o: Partial<Field> = {}): Field => ({ key, label, unit: "years", min: 1, max, step: 1, ...o });
const pct = (key: string, label: string, def: number, max = 50, o: Partial<Field> = {}): Field => ({ key, label, unit: "%", min: 0, max, step: 0.1, def, ...o });

export const monthlyRate = (r: number) => (1 + r / 100) ** (1 / 12) - 1;
/** Future value of 1 invested at the start of each month for n months at annual rate r (%). */
export const sipDue = (r: number, n: number) => { const i = monthlyRate(r); return i === 0 ? n : (((1 + i) ** n - 1) / i) * (1 + i); };
const growing = (a: number, g: number, n: number) => (g === 0 ? a * n : (a * ((1 + g / 100) ** n - 1)) / (g / 100));
const rup = (n: number) => Math.round(n);

// Cost Inflation Index, base 2001-02 = 100 (CBDT notifications). Key = first year of the financial year.
export const CII: Record<number, number> = { 2001: 100, 2002: 105, 2003: 109, 2004: 113, 2005: 117, 2006: 122, 2007: 129, 2008: 137, 2009: 148, 2010: 167, 2011: 184, 2012: 200,
  2013: 220, 2014: 240, 2015: 254, 2016: 264, 2017: 272, 2018: 280, 2019: 289, 2020: 301, 2021: 317, 2022: 331, 2023: 348, 2024: 363, 2025: 376, 2026: 384 };

// PPF interest rate by calendar year (as the original blends the quarterly notifications), 1980 onwards.
export const PPF_RATE: Record<number, number> = { 1980: 8, 1981: 8.5, 1982: 8.5, 1983: 9, 1984: 9.5, 1985: 10, 1986: 12, 1987: 12, 1988: 12, 1989: 12, 1990: 12, 1991: 12, 1992: 12,
  1993: 12, 1994: 12, 1995: 12, 1996: 12, 1997: 12, 1998: 12, 1999: 12, 2000: 11, 2001: 9.5, 2002: 9, 2003: 8, 2004: 8, 2005: 8, 2006: 8, 2007: 8, 2008: 8, 2009: 8, 2010: 8,
  2011: 8.6, 2012: 8.8, 2013: 8.7, 2014: 8.7, 2015: 8.7, 2016: 8.225, 2017: 7.875, 2018: 7.6, 2019: 8, 2020: 7.3, 2021: 7.1, 2022: 7.1, 2023: 7.1, 2024: 7.1, 2025: 7.1, 2026: 7.1 };

// Asset allocation by [risk 1-5], per horizon band: [debt, fmp debt, long-term fixed, cash/liquid, mid & small cap, large cap]; equity = 100 - debt.
// Horizon 1 year / 2 years / 3+ years. "No mid/small" moves the mid & small-cap share (up to 10 points) into large cap.
const ALLOC: Record<1 | 2 | 3, number[][]> = {
  1: [[70, 30, 35, 5, 0, 30], [65, 27, 33, 5, 3, 32], [60, 25, 30, 5, 5, 35], [55, 23, 27, 5, 7, 38], [50, 20, 25, 5, 10, 40]],
  2: [[65, 27, 33, 5, 3, 32], [60, 24, 31, 5, 6, 34], [55, 22, 28, 5, 8, 37], [50, 20, 25, 5, 10, 40], [45, 17, 23, 5, 13, 42]],
  3: [[60, 25, 30, 5, 5, 35], [55, 22, 28, 5, 8, 37], [50, 20, 25, 5, 10, 40], [45, 18, 22, 5, 12, 43], [40, 15, 20, 5, 15, 45]],
};
export function assetAllocation(risk: number, horizon: number, midSmall: boolean) {
  const [debt, fmp, ltf, cash, ms, lc] = ALLOC[horizon <= 1 ? 1 : horizon <= 2 ? 2 : 3][risk - 1];
  const moved = midSmall ? 0 : Math.min(ms, 10);
  return { debt, equity: 100 - debt, fmp, ltf, cash, midSmall: ms - moved, largeCap: lc + moved };
}

// ---------------------------------------------------------------- growth
const compounding: Calculator = {
  id: "compounding", category: "Returns & allocation", title: "Compounding", blurb: "Interest and corpus on a lump sum compounded yearly, half-yearly, quarterly or monthly.",
  fields: [amt("p", "Principal", { min: 1 }), pct("r", "Interest rate", 12), yrs("t", "Period", 100), { key: "n", label: "Compounds per year", unit: "", min: 1, max: 12, step: 1, def: 1, hint: "1 yearly · 2 half-yearly · 4 quarterly · 12 monthly" }],
  precheck: (raw) => (raw.n !== undefined && ![1, 2, 4, 12].includes(raw.n) ? ["Compounds per year: use 1, 2, 4 or 12."] : []),
  run: (v) => {
    const fv = (y: number) => v.p * (1 + v.r / 100 / v.n) ** (v.n * y);
    const rows = Array.from({ length: Math.min(Math.ceil(v.t), 60) }, (_, k) => [k + 1, rup(fv(k + 1))]);
    return { ok: true, metrics: [{ label: "Maturity amount", value: rup(fv(v.t)), kind: "inr", hero: true }, { label: "Interest earned", value: rup(fv(v.t)) - v.p, kind: "inr" }, { label: "Principal", value: v.p, kind: "inr" }],
      steps: ["Maturity = principal × (1 + rate ÷ n)^(n × years), where n is the compounds per year."], table: { cols: ["Year", "Value at year end"], rows, money: [1] } };
  },
};

const futureValueInflation: Calculator = {
  id: "inflation-cost", category: "Goal planning", title: "Future cost with inflation", blurb: "What something that costs ₹X today will cost after some years of inflation.",
  fields: [amt("cost", "Cost today", { min: 1 }), pct("infl", "Inflation", 6, 30), yrs("y", "Years", 100)],
  run: (v) => {
    const rows = Array.from({ length: Math.min(v.y, 60) }, (_, k) => [k + 1, rup(v.cost * (1 + v.infl / 100) ** (k + 1))]);
    const fv = rup(v.cost * (1 + v.infl / 100) ** v.y);
    return { ok: true, metrics: [{ label: "Cost after inflation", value: fv, kind: "inr", hero: true }, { label: "Increase", value: fv - v.cost, kind: "inr" }],
      steps: ["Future cost = cost today × (1 + inflation)^years."], table: { cols: ["Year", "Cost"], rows, money: [1] } };
  },
};

const lumpsum: Calculator = {
  id: "lumpsum", category: "SIP & investing", title: "Lumpsum value", blurb: "What a one-time investment grows to at an assumed return.",
  fields: [amt("a", "Lumpsum amount", { min: 1 }), pct("r", "Expected return", 12), yrs("y", "Years", 100)],
  run: (v) => {
    const fv = v.a * (1 + v.r / 100) ** v.y;
    const rows = Array.from({ length: Math.min(Math.ceil(v.y), 60) }, (_, k) => [k + 1, rup(v.a * (1 + v.r / 100) ** (k + 1))]);
    return { ok: true, metrics: [{ label: "Value at the end", value: rup(fv), kind: "inr", hero: true }, { label: "Gain", value: rup(fv) - v.a, kind: "inr" }, { label: "Invested", value: v.a, kind: "inr" }],
      steps: ["Value = amount × (1 + return)^years, compounded annually."], table: { cols: ["Year", "Value at year end"], rows, money: [1] } };
  },
};

const lumpsumTarget: Calculator = {
  id: "lumpsum-target", category: "Goal planning", title: "Lumpsum needed for a target", blurb: "One-time amount to invest today to reach a target.",
  fields: [amt("t", "Target amount", { min: 1 }), pct("r", "Expected return", 12), yrs("y", "Years", 100)],
  run: (v) => {
    const need = Math.ceil(round6(v.t / (1 + v.r / 100) ** v.y));
    return { ok: true, metrics: [{ label: "Invest today", value: need, kind: "inr", hero: true }, { label: "Growth to target", value: v.t - need, kind: "inr" }],
      steps: ["Lumpsum = target ÷ (1 + return)^years, rounded up to the next rupee."] };
  },
};
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const lumpsumSip: Calculator = {
  id: "lumpsum-plus-sip", category: "SIP & investing", title: "Lumpsum + SIP", blurb: "Corpus when a one-time amount and a monthly SIP run together.",
  fields: [amt("l", "Lumpsum amount", { min: 0 }), pct("lr", "Lumpsum return", 12), amt("s", "Monthly SIP", { min: 0 }), pct("sr", "SIP return", 12), yrs("y", "Years", 60)],
  precheck: (raw) => ((raw.l ?? 0) <= 0 && (raw.s ?? 0) <= 0 ? ["Enter a lumpsum, a SIP, or both."] : []),
  run: (v) => {
    const lf = v.l * (1 + v.lr / 100) ** v.y, sf = v.s * sipDue(v.sr, v.y * 12), inv = v.l + v.s * v.y * 12;
    return { ok: true, metrics: [{ label: "Total corpus", value: rup(lf + sf), kind: "inr", hero: true }, { label: "From the lumpsum", value: rup(lf), kind: "inr" }, { label: "From the SIP", value: rup(sf), kind: "inr" },
      { label: "Total invested", value: inv, kind: "inr" }, { label: "Gain", value: rup(lf + sf - inv), kind: "inr" }],
      steps: ["Lumpsum grows annually; the SIP is invested at the start of each month at the effective monthly rate."] };
  },
};

const impact: Calculator = {
  id: "impact-1pct", category: "SIP & investing", title: "Impact of 1% return", blurb: "How the SIP corpus changes with every extra 1% of return, from 0% to 15%.",
  fields: [amt("s", "Monthly SIP", { min: 1 }), yrs("y", "Years", 50)],
  run: (v) => {
    const rows: (string | number)[][] = [];
    let prev = 0;
    for (let r = 0; r <= 15; r++) {
      const c = rup(v.s * sipDue(r, v.y * 12));
      rows.push([`${r}%`, c, r === 0 ? "-" : `${(((c - prev) / prev) * 100).toFixed(2)}%`, r === 0 ? "-" : c - prev]);
      prev = c;
    }
    const gain = (rows[12][1] as number) - (rows[11][1] as number);
    return { ok: true, metrics: [{ label: "Total invested", value: v.s * v.y * 12, kind: "inr" }, { label: "Extra corpus from 11% to 12% (example step)", value: gain, kind: "inr", hero: true }],
      steps: ["Each row is the SIP corpus at that annual return; the last two columns show the change from the row above."], table: { cols: ["Annual return", "Corpus", "Change %", "Change (₹)"], rows, money: [1, 3] } };
  },
};

// ---------------------------------------------------------------- loans and deposits
const emi: Calculator = {
  id: "emi", category: "Loans & deposits", title: "EMI", blurb: "Monthly instalment, total interest and the year-wise schedule of a loan.",
  fields: [amt("p", "Loan amount", { min: 1 }), pct("r", "Interest rate", 9, 40), yrs("y", "Tenure (years)", 40, { min: 0, def: 20 }), { key: "m", label: "Extra months", unit: "months", min: 0, max: 11, step: 1, def: 0, optional: true }],
  precheck: (raw) => ((raw.y ?? 0) * 12 + (raw.m ?? 0) < 1 ? ["Tenure: enter at least 1 month."] : []),
  run: (v) => {
    const n = v.y * 12 + v.m, i = v.r / 1200;
    const emiExact = i === 0 ? v.p / n : (v.p * i * (1 + i) ** n) / ((1 + i) ** n - 1);
    const e = rup(emiExact), total = e * n; // the original reports total = rounded EMI × months
    let bal = v.p;
    const rows: (string | number)[][] = [];
    let yp = 0, yi = 0;
    for (let k = 1; k <= n; k++) {
      const interest = bal * i, principal = emiExact - interest;
      bal = Math.max(0, bal - principal); yp += principal; yi += interest;
      if (k % 12 === 0 || k === n) { rows.push([Math.ceil(k / 12), rup(yp), rup(yi), rup(bal)]); yp = 0; yi = 0; }
    }
    return { ok: true, metrics: [{ label: "Monthly EMI", value: e, kind: "inr", hero: true }, { label: "Total interest", value: total - v.p, kind: "inr" }, { label: "Total payment", value: total, kind: "inr" }],
      steps: ["EMI = P × i × (1 + i)^n ÷ ((1 + i)^n − 1), where i is the annual rate ÷ 12 and n the months."], table: { cols: ["Year", "Principal paid", "Interest paid", "Balance"], rows, money: [1, 2, 3] } };
  },
};

const depositMaturity = (m: number, r: number, y: number, q: number) => { let s = 0; for (let k = 0; k < y * 12; k++) s += m * (1 + r / 100 / q) ** ((q * (y * 12 - k)) / 12); return s; };
const rd: Calculator = {
  id: "rd", category: "Loans & deposits", title: "Recurring deposit (RD)", blurb: "Maturity of a monthly recurring deposit, interest compounded quarterly.",
  fields: [amt("m", "Monthly deposit", { min: 1 }), pct("r", "Interest rate", 7, 20), yrs("y", "Years", 30)],
  run: (v) => {
    const mat = Math.floor(depositMaturity(v.m, v.r, v.y, 4)), inv = v.m * v.y * 12; // the original truncates the maturity
    return { ok: true, metrics: [{ label: "Maturity value", value: mat, kind: "inr", hero: true }, { label: "Interest earned", value: mat - inv, kind: "inr" }, { label: "Total deposited", value: inv, kind: "inr" }],
      steps: ["Each deposit earns interest compounded quarterly until maturity: deposit × (1 + rate ÷ 4)^(4 × years left)."] };
  },
};

const fd: Calculator = {
  id: "fd", category: "Loans & deposits", title: "Fixed deposit (FD)", blurb: "Maturity of a one-time fixed deposit.",
  fields: [amt("p", "Deposit", { min: 1 }), pct("r", "Interest rate", 7, 20), yrs("y", "Years", 30), { key: "n", label: "Compounds per year", unit: "", min: 1, max: 12, step: 1, def: 4, hint: "4 = quarterly (most banks)" }],
  precheck: (raw) => (raw.n !== undefined && ![1, 2, 4, 12].includes(raw.n) ? ["Compounds per year: use 1, 2, 4 or 12."] : []),
  run: (v) => {
    const mat = rup(v.p * (1 + v.r / 100 / v.n) ** (v.n * v.y));
    return { ok: true, metrics: [{ label: "Maturity value", value: mat, kind: "inr", hero: true }, { label: "Interest earned", value: mat - v.p, kind: "inr" }], steps: ["Maturity = deposit × (1 + rate ÷ n)^(n × years)."] };
  },
};

const ppf: Calculator = {
  id: "ppf", category: "Loans & deposits", title: "PPF", blurb: "Year-wise Public Provident Fund balance with the notified rate of each year, loan and withdrawal limits.",
  fields: [{ key: "start", label: "Account opening year", unit: "", min: 1980, max: 2026, step: 1, def: 2011 }, amt("a", "Yearly deposit", { min: 500, max: 150000, def: 150000, hint: "₹500 to ₹1,50,000 a year" }), yrs("n", "Years of deposits", 50, { def: 15 })],
  precheck: (raw) => ((raw.start ?? 0) + (raw.n ?? 0) - 1 > 2026 ? ["Deposit years run past 2026, the last year with a notified rate."] : (raw.start ?? 9999) < 2011 && (raw.a ?? 0) > 70000 ? ["Before 2011 the yearly limit was ₹70,000."] : []),
  run: (v) => {
    let bal = 0;
    const closes: number[] = [];
    const rows: (string | number)[][] = [];
    for (let k = 0; k < v.n; k++) {
      const year = v.start + k, rate = PPF_RATE[year] ?? 7.1;
      const open = bal, interest = (open + v.a) * (rate / 100);
      bal = open + v.a + interest; closes.push(bal);
      const loan = k >= 2 ? 0.25 * closes[k - 2] : 0, wd = k >= 6 ? 0.5 * closes[k - 3] : 0; // loan from year 3, withdrawal from year 7
      rows.push([year, `${rate}%`, rup(open), rup(v.a), rup(interest), rup(bal), rup(loan), rup(wd)]);
    }
    return { ok: true, metrics: [{ label: "Balance at the end", value: rup(bal), kind: "inr", hero: true }, { label: "Total deposited", value: v.a * v.n, kind: "inr" }, { label: "Interest earned", value: rup(bal - v.a * v.n), kind: "inr" }],
      notes: ["Deposits are assumed made in April, so each year earns interest on opening balance plus that year's deposit.", "PPF has a 15-year lock-in, extendable in blocks of 5 years."],
      steps: ["Interest = (opening balance + deposit) × that year's rate.", "Loan limit = 25% of the balance two years back (from year 3). Partial withdrawal = 50% of the balance at the end of year 4 before (from year 7)."],
      table: { cols: ["Year", "Rate", "Opening", "Deposit", "Interest", "Closing", "Loan limit", "Withdrawal limit"], rows, money: [2, 3, 4, 5, 6, 7] } };
  },
};

// ---------------------------------------------------------------- goals and protection
const goalSetting: Calculator = {
  id: "goal-setting", category: "Goal planning", title: "Goal setting", blurb: "Monthly SIP needed for a dream amount after inflation, net of what you already have saved.",
  fields: [amt("d", "Goal amount (today's money)", { min: 1 }), yrs("y", "Years to the goal", 60), pct("infl", "Inflation", 8, 30), pct("r", "Expected return", 12), amt("sv", "Existing savings", { def: 0, optional: true })],
  run: (v) => {
    const target = rup(v.d * (1 + v.infl / 100) ** v.y), svFv = rup(v.sv * (1 + v.r / 100) ** v.y), need = target - svFv;
    const sip = need <= 0 ? 0 : rup(need / sipDue(v.r, v.y * 12)), inv = sip * v.y * 12;
    return { ok: true, metrics: [{ label: "Monthly SIP needed", value: sip, kind: "inr", hero: true }, { label: "Goal after inflation", value: target, kind: "inr" }, { label: "Existing savings grow to", value: svFv, kind: "inr" },
      { label: "Still to build", value: Math.max(0, need), kind: "inr" }, { label: "Total invested", value: inv, kind: "inr" }, { label: "Earnings", value: Math.max(0, need) - inv, kind: "inr" }],
      notes: need <= 0 ? ["Existing savings already cover the goal at this return."] : undefined,
      steps: ["Goal after inflation = amount × (1 + inflation)^years.", "Existing savings grow at the expected return; the gap is met by a monthly SIP at the start of each month."] };
  },
};

const hlv: Calculator = {
  id: "human-life-value", category: "Protection", title: "Human life value", blurb: "Life cover from the income your family would lose over the working years left, plus loans.",
  fields: [amt("a", "Annual income or expense to protect", { min: 1 }), pct("g", "Expected yearly increase", 10, 30), amt("loan", "Outstanding loans", { def: 0, optional: true }), yrs("y", "Years to protect", 60)],
  run: (v) => {
    const cum = rup(growing(v.a, v.g, v.y));
    return { ok: true, metrics: [{ label: "Life cover needed", value: cum + v.loan, kind: "inr", hero: true }, { label: "Income over the period", value: cum, kind: "inr" }, { label: "Loans", value: v.loan, kind: "inr" }],
      steps: ["Income over the period = sum of each year's income, growing at the expected yearly increase.", "Cover = that sum + outstanding loans."] };
  },
};

const cii: Calculator = {
  id: "cii", category: "Tax", title: "Capital gain with Cost Inflation Index", blurb: "Indexed cost of an asset and the long-term gain and tax on it.",
  fields: [{ key: "py", label: "Purchase year (financial year starts)", unit: "", min: 2001, max: 2026, step: 1, def: 2012, hint: "2012 means FY 2012-13. Bought earlier? Use the value on 1 April 2001 and 2001." }, amt("pc", "Purchase cost", { min: 1 }),
    { key: "sy", label: "Sale year (financial year starts)", unit: "", min: 2001, max: 2026, step: 1, def: 2025 }, amt("sp", "Sale value", { min: 0 }), pct("tax", "Tax rate on the gain", 20, 50)],
  precheck: (raw) => ((raw.sy ?? 0) < (raw.py ?? 0) ? ["Sale year cannot be before the purchase year."] : []),
  run: (v) => {
    const cp = CII[v.py], cs = CII[v.sy];
    if (!cp || !cs) return err("The Cost Inflation Index is available for financial years 2001-02 to 2026-27.");
    const indexed = rup((v.pc * cs) / cp), gain = v.sp - indexed, tax = Math.max(0, rup(gain * (v.tax / 100)));
    return { ok: true, metrics: [{ label: gain >= 0 ? "Long-term capital gain" : "Long-term capital loss", value: gain, kind: "inr", hero: true }, { label: "Indexed cost", value: indexed, kind: "inr" }, { label: "Tax", value: tax, kind: "inr" },
      { label: `Index in ${v.py}-${String(v.py + 1).slice(2)} → ${v.sy}-${String(v.sy + 1).slice(2)}`, value: 0, kind: "text", text: `${cp} → ${cs}` }],
      notes: [...(gain < 0 ? ["A loss: no tax, and it can be set off against other long-term gains."] : []), "Indexation applies only to assets and cases where the law still allows it (for example property bought before 23 July 2024, at the taxpayer's option). Check the rule for your asset."],
      steps: ["Indexed cost = purchase cost × index in the sale year ÷ index in the purchase year.", "Gain = sale value − indexed cost; tax = gain × tax rate (nil on a loss)."] };
  },
};

const networth: Calculator = {
  id: "networth", category: "Planning", title: "Net worth", blurb: "Assets minus liabilities.",
  fields: [amt("eq", "Shares and equity funds", { def: 0, optional: true }), amt("fi", "Fixed income", { def: 0, optional: true }), amt("cash", "Cash and bank", { def: 0, optional: true }), amt("prop", "Property", { def: 0, optional: true }),
    amt("gold", "Gold", { def: 0, optional: true }), amt("oa", "Other assets", { def: 0, optional: true }), amt("hl", "Home loan", { def: 0, optional: true }), amt("pl", "Personal and other loans", { def: 0, optional: true }),
    amt("it", "Income tax due", { def: 0, optional: true }), amt("bills", "Outstanding bills", { def: 0, optional: true }), amt("cc", "Credit card dues", { def: 0, optional: true }), amt("ol", "Other liabilities", { def: 0, optional: true })],
  run: (v) => {
    const assets = v.eq + v.fi + v.cash + v.prop + v.gold + v.oa, liab = v.hl + v.pl + v.it + v.bills + v.cc + v.ol;
    return { ok: true, metrics: [{ label: "Net worth", value: assets - liab, kind: "inr", hero: true }, { label: "Total assets", value: assets, kind: "inr" }, { label: "Total liabilities", value: liab, kind: "inr" }],
      notes: assets - liab < 0 ? ["Liabilities exceed assets."] : undefined, steps: ["Net worth = total assets − total liabilities."] };
  },
};

const nps: Calculator = {
  id: "nps", category: "Goal planning", title: "NPS", blurb: "NPS corpus at retirement, the lumpsum you can withdraw and the monthly pension from the annuity.",
  fields: [amt("c", "Monthly contribution", { min: 1 }), { key: "age", label: "Current age", unit: "age", min: 18, max: 70, step: 1, def: 35 }, { key: "ret", label: "Retirement age", unit: "age", min: 40, max: 75, step: 1, def: 60 },
    pct("r", "Expected return till retirement", 10), pct("ann", "Share used to buy an annuity", 40, 100), pct("ar", "Annuity rate", 6, 20)],
  precheck: (raw) => [...((raw.ret ?? 0) <= (raw.age ?? 0) ? ["Retirement age must be above current age."] : []), ...((raw.ann ?? 40) < 40 ? ["At least 40% of the corpus must go into an annuity."] : [])],
  run: (v) => {
    const n = (v.ret - v.age) * 12, wealth = rup(v.c * sipDue(v.r, n)), annuity = rup((wealth * v.ann) / 100), lump = wealth - annuity;
    const pension = rup((annuity * v.ar) / 1200);
    return { ok: true, metrics: [{ label: "Corpus at retirement", value: wealth, kind: "inr", hero: true }, { label: "Lumpsum withdrawal", value: lump, kind: "inr" }, { label: "Annuity corpus", value: annuity, kind: "inr" },
      { label: "Monthly pension", value: pension, kind: "inr" }, { label: "Total contributed", value: v.c * n, kind: "inr" }],
      notes: ["Pension here = annuity corpus × annuity rate ÷ 12 (the corpus is preserved). Real annuity quotes depend on the annuity plan chosen."],
      steps: ["Corpus: monthly contribution at the start of each month at the effective monthly return.", "At least 40% buys an annuity; the rest can be withdrawn."] };
  },
};

const spendingLess: Calculator = {
  id: "spend-less", category: "Planning", title: "Save more by spending less", blurb: "What a one-time saving today is worth at retirement after tax and inflation.",
  fields: [{ key: "age", label: "Current age", unit: "age", min: 18, max: 70, step: 1, def: 25 }, { key: "ret", label: "Retirement age", unit: "age", min: 30, max: 80, step: 1, def: 60 }, pct("r", "Savings return", 12), pct("tax", "Tax rate on returns", 7, 50), pct("infl", "Inflation", 5, 30),
    amt("house", "Buy a cheaper house or flat", { def: 0, optional: true }), amt("emi", "Smaller home loan EMI", { def: 0, optional: true }), amt("car", "Skip a new car", { def: 0, optional: true }), amt("eat", "Eat out less", { def: 25000, optional: true }),
    amt("life", "Lifestyle spending", { def: 25000, optional: true }), amt("hol", "Fewer holidays", { def: 0, optional: true }), amt("tr", "Transport", { def: 0, optional: true }), amt("cc", "Credit card interest", { def: 0, optional: true }),
    amt("pl", "Personal loan", { def: 0, optional: true }), amt("shop", "Shopping", { def: 0, optional: true })],
  precheck: (raw) => ((raw.ret ?? 0) <= (raw.age ?? 0) ? ["Retirement age must be above current age."] : (raw.house ?? 0) + (raw.emi ?? 0) + (raw.car ?? 0) + (raw.eat ?? 0) + (raw.life ?? 0) + (raw.hol ?? 0) + (raw.tr ?? 0) + (raw.cc ?? 0) + (raw.pl ?? 0) + (raw.shop ?? 0) <= 0 ? ["Enter at least one amount you could save."] : []),
  run: (v) => {
    const saved = v.house + v.emi + v.car + v.eat + v.life + v.hol + v.tr + v.cc + v.pl + v.shop, y = v.ret - v.age;
    const grown = saved * (1 + (v.r * (1 - v.tax / 100)) / 100) ** y, real = grown / (1 + v.infl / 100) ** y;
    return { ok: true, metrics: [{ label: "Worth at retirement (today's money)", value: rup(real), kind: "inr", hero: true }, { label: "Total saved", value: saved, kind: "inr" }, { label: "Worth at retirement (nominal)", value: rup(grown), kind: "inr" }, { label: "Years invested", value: y, kind: "years" }],
      notes: ["As in the original tool, each amount is treated as a one-time saving invested today."],
      steps: ["Return after tax = return × (1 − tax rate).", "Nominal value = saved × (1 + return after tax)^years; today's money = nominal ÷ (1 + inflation)^years."] };
  },
};

const assetAlloc: Calculator = {
  id: "asset-allocation", category: "Returns & allocation", title: "Asset allocation", blurb: "Suggested debt / equity mix by risk profile and horizon.",
  fields: [{ key: "risk", label: "Risk profile (1 lowest, 5 highest)", unit: "", min: 1, max: 5, step: 1, def: 3 }, yrs("y", "Investment horizon (years)", 60, { def: 10 }), { key: "ms", label: "Include mid and small caps? (1 yes, 2 no)", unit: "", min: 1, max: 2, step: 1, def: 1 }],
  run: (v) => {
    const a = assetAllocation(v.risk, v.y, v.ms === 1);
    return { ok: true, metrics: [{ label: "Debt", value: a.debt, kind: "pct", hero: true }, { label: "Equity", value: a.equity, kind: "pct", hero: true }],
      steps: ["Shorter horizons hold less equity (1 year: −10 points, 2 years: −5).", "Choosing no mid and small caps moves up to 10 points of that bucket into large caps."],
      table: { cols: ["Bucket", "Share (%)"], rows: [["Debt: FMP / short-term debt", a.fmp], ["Debt: long-term fixed income", a.ltf], ["Debt: cash and liquid", a.cash], ["Equity: large cap", a.largeCap], ["Equity: mid and small cap", a.midSmall]] } };
  },
};

// ---------------------------------------------------------------- planners (FH models: the original does not publish its formulas)
const homeLoanSip: Calculator = {
  id: "home-loan-vs-sip", category: "Loans & deposits", title: "Home loan vs SIP", blurb: "Extra monthly SIP running alongside a home loan: corpus built against the interest paid.",
  fields: [amt("p", "Loan amount", { min: 1 }), pct("r", "Loan interest rate", 9, 30), yrs("y", "Loan tenure (years)", 40, { def: 20 }), amt("s", "Monthly SIP alongside", { min: 1, def: 10000 }), pct("sr", "SIP return", 12)],
  run: (v) => {
    const n = v.y * 12, i = v.r / 1200, emiV = i === 0 ? v.p / n : (v.p * i * (1 + i) ** n) / ((1 + i) ** n - 1), interest = emiV * n - v.p, corpus = v.s * sipDue(v.sr, n);
    return { ok: true, metrics: [{ label: "SIP corpus at loan end", value: rup(corpus), kind: "inr", hero: true }, { label: "Total interest on the loan", value: rup(interest), kind: "inr" }, { label: "Corpus minus interest", value: rup(corpus - interest), kind: "inr" }, { label: "Monthly EMI", value: rup(emiV), kind: "inr" }],
      notes: ["Planning model: the SIP is on top of the EMI and the loan runs its normal tenure. SIP returns are not guaranteed."], steps: ["EMI from the standard formula; SIP at the start of each month at the effective monthly return."] };
  },
};

const composite: Calculator = {
  id: "composite-goals", category: "Goal planning", title: "Composite goal planner", blurb: "Monthly SIP for several goals at once: education, wealth, a dream, retirement and marriage.",
  fields: [pct("infl", "Inflation", 6, 30), pct("r", "Expected return", 12), amt("edu", "Education cost today", { def: 2500000, optional: true }), yrs("eduY", "Years to education", 40, { def: 10, optional: true }), amt("wel", "Wealth goal today", { def: 0, optional: true }), yrs("welY", "Years to wealth goal", 60, { def: 20, optional: true }),
    amt("dream", "Dream expense today", { def: 0, optional: true }), yrs("dreamY", "Years to the dream", 60, { def: 10, optional: true }), amt("ret", "Retirement need today", { def: 0, optional: true }), yrs("retY", "Years to retirement", 60, { def: 25, optional: true }),
    amt("mrg", "Marriage cost today", { def: 0, optional: true }), yrs("mrgY", "Years to marriage", 40, { def: 15, optional: true })],
  precheck: (raw) => ((raw.edu ?? 0) + (raw.wel ?? 0) + (raw.dream ?? 0) + (raw.ret ?? 0) + (raw.mrg ?? 0) <= 0 ? ["Enter at least one goal amount."] : []),
  run: (v) => {
    const goals: [string, number, number][] = [["Education", v.edu, v.eduY], ["Wealth", v.wel, v.welY], ["Dream", v.dream, v.dreamY], ["Retirement", v.ret, v.retY], ["Marriage", v.mrg, v.mrgY]];
    const rows = goals.filter((g) => g[1] > 0).map(([name, today, y]) => {
      const t = today * (1 + v.infl / 100) ** y; return [name, rup(today), y, rup(t), rup(t / sipDue(v.r, y * 12))];
    });
    const total = rows.reduce((s, r) => s + (r[4] as number), 0);
    return { ok: true, metrics: [{ label: "Total monthly SIP", value: total, kind: "inr", hero: true }], steps: ["Each goal grows with inflation to its date; its SIP is the future cost ÷ the SIP growth factor at the expected return."],
      notes: ["Planning model: every goal gets its own SIP at the same expected return."], table: { cols: ["Goal", "Cost today", "Years", "Cost then", "Monthly SIP"], rows, money: [1, 3, 4] } };
  },
};

export const MORE: Calculator[] = [compounding, futureValueInflation, lumpsum, lumpsumTarget, lumpsumSip, impact, emi, rd, fd, ppf, goalSetting, hlv, cii, networth, nps, spendingLess, assetAlloc, homeLoanSip, composite];
