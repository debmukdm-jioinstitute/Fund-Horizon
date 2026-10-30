// Backoffice calculators. Pure functions only; the UI in app/backoffice/operations/calculators renders them.
// Conventions (calibrated to PrimeInvestor's published examples, see docs on each calculator):
//  - SIPs invest at month-end, monthly rate = annual rate / 12 (education example: 10L, 5y, 6%, 12% -> 16,386/month).
//  - Lump sums and goal/inflation maths compound annually (CAGR 2x in 5y = 14.87%; term cover example 2.77 cr).

export type Values = Record<string, number>;
export interface Field {
  key: string; label: string; unit: "₹" | "%" | "years" | "age";
  min: number; max: number; step?: number; def?: number; optional?: boolean; hint?: string;
}
export interface Metric { label: string; value: number; kind: "inr" | "pct" | "years" | "text"; text?: string; hero?: boolean }
export interface Table { cols: string[]; rows: (string | number)[][]; money?: number[] }
export interface Outcome { ok: true; metrics: Metric[]; steps: string[]; notes?: string[]; table?: Table }
export interface Failure { ok: false; errors: string[] }
export type Result = Outcome | Failure;
export interface Preset { label: string; hint: string; vals: Values }
export interface Calculator {
  id: string; category: Category; title: string; blurb: string; fields: Field[];
  /** One-click starting points; every field stays editable afterwards. */
  presets?: Preset[];
  /** Extra checks on the raw form (blank optional fields are still undefined here). */
  precheck?: (raw: Partial<Record<string, number>>) => string[];
  run: (v: Values) => Result;
}
export type Category = "SIP & investing" | "Goal planning" | "Withdrawals" | "Returns & allocation" | "PMS" | "Protection";

const MAX_AMT = 1e12; // ₹1 lakh crore; above this float error and meaning both vanish
const err = (...errors: string[]): Failure => ({ ok: false, errors });
const amt = (key: string, label: string, o: Partial<Field> = {}): Field => ({ key, label, unit: "₹", min: 0, max: MAX_AMT, step: 1, ...o });
const yrs = (key: string, label: string, max = 60, o: Partial<Field> = {}): Field => ({ key, label, unit: "years", min: 1, max, step: 1, ...o });
const rate = (key: string, label: string, def: number, max = 30, o: Partial<Field> = {}): Field => ({ key, label, unit: "%", min: 0, max, step: 0.1, def, ...o });
const rets = (key = "ret", label = "Expected annual return") => rate(key, label, 12, 50, { hint: "Keep this realistic; very high returns mislead." });
const infl = (key = "infl", def = 6) => rate(key, "Expected inflation", def, 30);

/** Checks required/range per field. Returns error list; optional blanks are set to 0 by the caller. */
export function validate(fields: Field[], v: Partial<Record<string, number>>): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const x = v[f.key];
    if (x === undefined || Number.isNaN(x)) { if (!f.optional) out.push(`${f.label}: enter a value.`); continue; }
    if (!Number.isFinite(x)) out.push(`${f.label}: must be a finite number.`);
    else if (x < f.min) out.push(`${f.label}: must be at least ${f.min}${f.unit === "%" ? "%" : ""}.`);
    else if (x > f.max) out.push(`${f.label}: must be at most ${f.max.toLocaleString("en-IN")}${f.unit === "%" ? "%" : ""}.`);
  }
  return out;
}

// ---------------------------------------------------------------- maths
/** Future value of `p` invested at each month-end for n months at annual rate r (%). */
export const sipFactor = (r: number, n: number) => { const i = r / 1200; return i === 0 ? n : ((1 + i) ** n - 1) / i; };
const grow = (p: number, r: number, y: number) => p * (1 + r / 100) ** y; // annual compounding

/** Sum of a series starting at `a`, growing by g% each period, for n periods. */
const growing = (a: number, g: number, n: number) => (g === 0 ? a * n : (a * ((1 + g / 100) ** n - 1)) / (g / 100));

function targetSip(target: number, existing: number, years: number, r: number) {
  const gap = target - grow(existing, r, years);
  return { fvExisting: grow(existing, r, years), gap, sip: gap > 0 ? gap / sipFactor(r, years * 12) : 0 };
}

// ---------------------------------------------------------------- calculators
const sipValue: Calculator = {
  id: "sip-value", category: "SIP & investing", title: "SIP value", blurb: "What a monthly SIP grows to at an assumed return.",
  fields: [amt("sip", "Monthly SIP", { min: 1 }), yrs("years", "SIP duration"), rets()],
  run: (v) => {
    const n = v.years * 12, fv = v.sip * sipFactor(v.ret, n), inv = v.sip * n;
    return { ok: true, metrics: [{ label: "Future value", value: fv, kind: "inr", hero: true }, { label: "Total invested", value: inv, kind: "inr" }, { label: "Estimated gain", value: fv - inv, kind: "inr" }],
      steps: [`Months n = ${n}; monthly rate i = ${v.ret}% ÷ 12.`, "FV = SIP × [((1 + i)ⁿ − 1) ÷ i] — instalments at month-end.", "Gain = FV − (SIP × n)."] };
  },
};

const stepUpSip: Calculator = {
  id: "step-up-sip", category: "SIP & investing", title: "Step-up SIP", blurb: "SIP raised by a fixed % every year, plus any existing corpus.",
  fields: [amt("sip", "Starting monthly SIP", { min: 1 }), rate("step", "Annual step-up", 10, 100), amt("existing", "Existing investments", { def: 0, optional: true }), yrs("years", "SIP duration"), rets()],
  run: (v) => {
    const i = v.ret / 1200, rows: (string | number)[][] = [];
    let bal = 0, inv = 0;
    for (let y = 0; y < v.years; y++) {
      const sip = v.sip * (1 + v.step / 100) ** y;
      for (let m = 0; m < 12; m++) bal = bal * (1 + i) + sip;
      inv += sip * 12;
      rows.push([y + 1, sip, inv, bal + grow(v.existing, v.ret, y + 1)]);
    }
    const fvEx = grow(v.existing, v.ret, v.years), fv = bal + fvEx;
    return { ok: true, metrics: [{ label: "Future value", value: fv, kind: "inr", hero: true }, { label: "Total invested (SIPs)", value: inv, kind: "inr" }, { label: "Existing investments grown", value: fvEx, kind: "inr" }, { label: "Estimated gain", value: fv - inv - v.existing, kind: "inr" }],
      steps: ["SIP for year k = starting SIP × (1 + step-up)ᵏ⁻¹; flat within a year.", "Each month: balance = balance × (1 + r ÷ 12) + SIP.", "Existing investments compound annually at the same return."],
      table: { cols: ["Year", "Monthly SIP", "Invested so far", "Value at year end"], rows, money: [1, 2, 3] } };
  },
};

const sipToTarget: Calculator = {
  id: "sip-to-target", category: "SIP & investing", title: "SIP to reach a target", blurb: "Monthly SIP needed to build a fixed target amount.",
  fields: [amt("target", "Target amount", { min: 1 }), amt("existing", "Existing investments", { def: 0, optional: true }), yrs("years", "Years to target"), rets()],
  run: (v) => {
    const { fvExisting, gap, sip } = targetSip(v.target, v.existing, v.years, v.ret);
    const m: Metric[] = [{ label: "Monthly SIP needed", value: sip, kind: "inr", hero: true }, { label: "Existing investments at target date", value: fvExisting, kind: "inr" }, { label: "Still to build via SIP", value: Math.max(gap, 0), kind: "inr" }];
    return { ok: true, metrics: m, notes: gap <= 0 ? ["Existing investments already reach the target at this return — no SIP needed."] : undefined,
      steps: ["Existing grown = existing × (1 + r)ʸ.", "SIP = (target − existing grown) ÷ [((1 + i)ⁿ − 1) ÷ i], i = r ÷ 12, n = years × 12.", "A zero result means the existing corpus alone gets there."] };
  },
};

const financialGoal: Calculator = {
  id: "financial-goal", category: "Goal planning", title: "Financial goal", blurb: "Inflation-adjusted goal amount and the SIP to reach it.",
  fields: [amt("cost", "Goal cost in today's money", { min: 1 }), yrs("years", "Years to goal"), infl(), rets()],
  run: (v) => goalRun(v, "goal"),
};
const education: Calculator = {
  id: "education", category: "Goal planning", title: "Child education", blurb: "Future cost of a course and the monthly SIP to fund it.",
  fields: [amt("cost", "Course cost today", { min: 1 }), yrs("years", "Years until money is needed"), infl("infl", 8), rets()],
  run: (v) => goalRun(v, "education"),
};
function goalRun(v: Values, what: string): Result {
  const future = grow(v.cost, v.infl, v.years), sip = future / sipFactor(v.ret, v.years * 12);
  return { ok: true, metrics: [{ label: "Monthly investment needed", value: sip, kind: "inr", hero: true }, { label: `Inflation-adjusted ${what} cost`, value: future, kind: "inr" }, { label: "Total you invest", value: sip * v.years * 12, kind: "inr" }],
    steps: ["Future cost = cost today × (1 + inflation)ʸ.", "Monthly investment = future cost ÷ [((1 + i)ⁿ − 1) ÷ i], i = return ÷ 12.", what === "education" ? "Education inflation often runs above headline inflation; raise the rate if your course is costlier." : "Use goal-specific inflation if you know it."] };
}

const retirement: Calculator = {
  id: "retirement", category: "Goal planning", title: "Retirement", blurb: "Corpus needed at retirement and the monthly SIP to build it.",
  fields: [{ key: "age", label: "Current age", unit: "age", min: 18, max: 80, step: 1 }, { key: "retAge", label: "Retirement age", unit: "age", min: 19, max: 90, step: 1 }, { key: "life", label: "Expected life span", unit: "age", min: 20, max: 110, step: 1 },
    amt("exp", "Current monthly expenses", { min: 1, hint: "Exclude costs that end at retirement (e.g. EMI); add medical." }), amt("existing", "Existing retirement investments (today's value)", { def: 0, optional: true }),
    infl(), rate("pre", "Return before retirement", 12, 50), rate("post", "Return after retirement", 7, 50, { hint: "Post-retirement portfolios are mostly debt." })],
  run: (v) => {
    if (v.retAge <= v.age) return err("Retirement age must be greater than current age.");
    if (v.life <= v.retAge) return err("Expected life span must be greater than retirement age.");
    const toGo = v.retAge - v.age, span = v.life - v.retAge;
    const expRet = v.exp * (1 + v.infl / 100) ** toGo; // monthly expense on retirement day
    // withdrawals at the start of each retirement year, rising with inflation, discounted at the post-retirement return
    const q = (1 + v.infl / 100) / (1 + v.post / 100);
    const corpus = q === 1 ? expRet * 12 * span : expRet * 12 * (1 - q ** span) / (1 - q);
    const fvEx = grow(v.existing, v.pre, toGo), gap = corpus - fvEx, sip = gap > 0 ? gap / sipFactor(v.pre, toGo * 12) : 0;
    return { ok: true, metrics: [{ label: "Monthly investment needed", value: sip, kind: "inr", hero: true }, { label: "Monthly expense at retirement", value: expRet, kind: "inr" }, { label: "Total corpus needed", value: corpus, kind: "inr" },
      { label: "Existing investments at retirement", value: fvEx, kind: "inr" }, { label: "Corpus still to build", value: Math.max(gap, 0), kind: "inr" }, { label: "Years left to build", value: toGo, kind: "years" }],
      notes: gap <= 0 ? ["Existing investments already cover the corpus at these assumptions."] : undefined,
      steps: [`Expense at retirement = current × (1 + inflation)^${toGo}.`, `Corpus = PV of ${span} years of expenses (paid at the start of each year, rising with inflation) discounted at the post-retirement return.`, "Existing grown at the pre-retirement return; monthly SIP covers the gap."] };
  },
};

const swp: Calculator = {
  id: "swp", category: "Withdrawals", title: "SWP — how long will it last", blurb: "Years your corpus lasts under a monthly withdrawal that rises with inflation.",
  fields: [amt("corpus", "Corpus", { min: 1 }), rate("ret", "Expected return", 8, 50), rate("infl", "Expected inflation", 6, 30), amt("wd", "Monthly withdrawal (today)", { min: 1 })],
  run: (v) => {
    const i = v.ret / 1200, cap = 100 * 12;
    let bal = v.corpus, m = 0;
    const rows: (string | number)[][] = [];
    while (m < cap) {
      const w = v.wd * (1 + v.infl / 100) ** Math.floor(m / 12);
      if (bal < w) break; // cannot fund a full withdrawal
      bal = (bal - w) * (1 + i); m++; // withdraw at start of month, remainder earns the month's return
      if (m % 12 === 0) rows.push([m / 12, w, bal]);
    }
    const forever = m >= cap, years = m / 12;
    const first = v.wd, sustainable = v.corpus * i / (1 + i); // monthly yield with no inflation step
    return { ok: true, metrics: [{ label: "Corpus lasts", value: years, kind: "years", hero: true, text: forever ? "100+ years (effectively sustainable)" : undefined }, { label: "Balance left", value: bal, kind: "inr" }, { label: "Return-only monthly income (no drawdown)", value: sustainable, kind: "inr" }],
      notes: first > sustainable ? ["Withdrawal exceeds what the corpus earns, so capital is being drawn down."] : ["Withdrawal is within the corpus's monthly return, but inflation steps will eventually exceed it."],
      steps: ["Each month: withdraw, then balance × (1 + r ÷ 12).", "Withdrawal rises by the inflation rate at the start of every year.", "Stops when the balance cannot fund a full withdrawal (capped at 100 years)."],
      table: { cols: ["Year", "Monthly withdrawal", "Balance at year end"], rows: rows.slice(0, 60), money: [1, 2] } };
  },
};

const swpTax: Calculator = {
  id: "swp-tax", category: "Withdrawals", title: "SWP with tax", blurb: "How long your corpus lasts when withdrawals are taxed.",
  fields: [amt("corpus", "Corpus", { min: 1 }), amt("exp", "Annual expense (post-tax need)", { min: 1 }), rate("ret", "Expected return", 8, 50), rate("infl", "Expected inflation", 6, 30), rate("tax", "Tax rate on withdrawals", 10, 60, { hint: "Flat rate applied to the whole withdrawal, as a planning simplification." })],
  run: (v) => {
    if (v.tax >= 100) return err("Tax rate must be below 100%.");
    const rows: (string | number)[][] = [];
    let bal = v.corpus, y = 0, taxPaid = 0;
    while (y < 100) {
      const need = v.exp * (1 + v.infl / 100) ** y, gross = need / (1 - v.tax / 100);
      if (bal < gross) break;
      bal = (bal - gross) * (1 + v.ret / 100); y++; taxPaid += gross - need;
      if (y <= 60) rows.push([y, need, gross, bal]);
    }
    const forever = y >= 100;
    return { ok: true, metrics: [{ label: "Corpus lasts", value: y, kind: "years", hero: true, text: forever ? "100+ years (effectively sustainable)" : undefined }, { label: "Tax paid over that period", value: taxPaid, kind: "inr" }, { label: "Balance left", value: bal, kind: "inr" }],
      steps: ["Gross withdrawal = expense ÷ (1 − tax rate), so tax is met out of the withdrawal.", "Withdrawn at the start of each year; the remainder earns the annual return at year end.", "Expense rises with inflation every year. Real tax depends on fund type and gains; this uses one flat rate."],
      table: { cols: ["Year", "Expense need", "Gross withdrawal", "Balance at year end"], rows, money: [1, 2, 3] } };
  },
};

const cagr: Calculator = {
  id: "cagr", category: "Returns & allocation", title: "CAGR", blurb: "Compounded annual return on a one-time investment.",
  fields: [amt("start", "Initial investment", { min: 0.01, step: 0.01 }), amt("end", "Final value", { min: 0, step: 0.01 }), yrs("years", "Years invested", 100, { min: 0.01, step: 0.01 })],
  run: (v) => {
    const c = ((v.end / v.start) ** (1 / v.years) - 1) * 100;
    return { ok: true, metrics: [{ label: "CAGR", value: c, kind: "pct", hero: true }, { label: "Absolute return", value: (v.end / v.start - 1) * 100, kind: "pct" }, { label: "Gain / loss", value: v.end - v.start, kind: "inr" }],
      notes: [...(v.years < 1 ? ["CAGR is not meaningful for periods under one year."] : []), "One-time investments only — use XIRR for SIPs or multiple cash flows."],
      steps: ["CAGR = (final ÷ initial)^(1 ÷ years) − 1.", "Simple average (absolute return ÷ years) overstates compounding."] };
  },
};

const rebalancing: Calculator = {
  id: "rebalancing", category: "Returns & allocation", title: "Portfolio rebalancing", blurb: "How much to invest or redeem in equity, debt and gold.",
  fields: [amt("cEq", "Current equity"), amt("cDt", "Current debt"), amt("cGd", "Current gold", { def: 0, optional: true }),
    rate("tEq", "Target equity", 60, 100), rate("tDt", "Target debt", 30, 100), rate("tGd", "Target gold", 10, 100),
    amt("fresh", "Fresh investment", { def: 0, optional: true }), rate("thr", "Rebalance threshold (percentage points)", 5, 50)],
  run: (v) => {
    const tSum = v.tEq + v.tDt + v.tGd;
    if (Math.abs(tSum - 100) > 0.01) return err(`Target allocation must add to 100% (currently ${tSum.toFixed(2)}%).`);
    const cur = [v.cEq, v.cDt, v.cGd], tgt = [v.tEq, v.tDt, v.tGd], names = ["Equity", "Debt", "Gold"];
    const base = cur[0] + cur[1] + cur[2];
    if (base + v.fresh <= 0) return err("Enter current holdings or a fresh investment.");
    const total = base + v.fresh;
    const dev = cur.map((c, k) => (base > 0 ? (c / base) * 100 : 0) - tgt[k]);
    const maxDev = Math.max(...dev.map(Math.abs));
    const act = maxDev >= v.thr || (base === 0);
    const rows = names.map((n, k) => {
      const target = (total * tgt[k]) / 100, delta = target - cur[k];
      return [n, base > 0 ? `${((cur[k] / base) * 100).toFixed(1)}%` : "—", `${tgt[k]}%`, `${dev[k] >= 0 ? "▲" : "▼"} ${Math.abs(dev[k]).toFixed(1)}%`, act ? target : cur[k], act ? delta : 0];
    });
    const m: Metric[] = [{ label: "Largest deviation", value: maxDev, kind: "text", text: `${maxDev.toFixed(1)}%`, hero: true }];
    for (let k = 0; k < 3; k++) { const d = rows[k][5] as number; m.push({ label: names[k], value: d, kind: "text", text: d === 0 ? "No action" : `${d > 0 ? "Invest" : "Redeem"} ₹${Math.abs(Math.round(d)).toLocaleString("en-IN")}` }); }
    return { ok: true, metrics: m, notes: act ? ["Fresh money is applied to under-weight classes first; only the remainder needs redemptions."] : [`Largest deviation ${maxDev.toFixed(1)}% is under your ${v.thr}% threshold — no rebalancing needed.`],
      steps: ["Total after fresh money = current holdings + fresh investment.", "Target value = total × target %; action = target value − current value (positive = invest, negative = redeem).", "Actions apply only when any class drifts by at least the threshold."],
      table: { cols: ["Asset", "Current %", "Target %", "Deviation", "Value after", "Invest (+) / redeem (−)"], rows, money: [4, 5] } };
  },
};

const termInsurance: Calculator = {
  id: "term-insurance", category: "Protection", title: "Term insurance cover", blurb: "Cover needed to replace income, fund goals and clear debts.",
  fields: [{ key: "age", label: "Current age", unit: "age", min: 18, max: 65, step: 1 }, yrs("work", "Years to retirement", 50), amt("house", "Household expenses per month", { min: 1 }), amt("own", "Of which your own expenses per month", { def: 0, optional: true }),
    amt("other", "Monthly household expense met by others (e.g. spouse)", { def: 0, optional: true }), infl("infl", 5),
    amt("goal", "Unfunded goal: target amount (e.g. education)", { def: 0, optional: true }), amt("goalHave", "…already invested for it", { def: 0, optional: true }), yrs("goalYears", "…years until it is needed", 40, { min: 0, def: 0, optional: true }), rate("goalRet", "…conservative return on that investment", 6, 20, { optional: true }),
    amt("loans", "Outstanding loans", { def: 0, optional: true }), amt("assets", "Savings, PF and other assets available (excluding goal fund)", { def: 0, optional: true })],
  run: (v) => {
    if (v.age + v.work > 100) return err("Age plus years to retirement is unrealistically high.");
    const monthly = v.house - v.own - v.other;
    if (monthly <= 0) return err("Household expenses minus your own and others' share must be above zero — nothing to replace.");
    const annual = monthly * 12, income = growing(annual, v.infl, v.work);
    const goalGap = v.goal > 0 ? Math.max(v.goal - grow(v.goalHave, v.goalRet, v.goalYears), 0) : 0;
    const debt = Math.max(v.loans - v.assets, 0), cover = income + goalGap + debt;
    return { ok: true, metrics: [{ label: "Suggested term cover", value: cover, kind: "inr", hero: true }, { label: "Income replacement", value: income, kind: "inr" }, { label: "Unfunded goals", value: goalGap, kind: "inr" }, { label: "Net debts (loans − assets)", value: debt, kind: "inr" }, { label: "First-year family expense", value: annual, kind: "inr" }],
      notes: v.age + v.work > 65 ? ["Most insurers cap cover term at about age 65–70; check the policy term available."] : undefined,
      steps: ["Annual need = (household − your own − others') × 12, rising with inflation each year over the years to retirement.", "Income replacement = sum of those yearly needs.", "Unfunded goal = target − existing investment grown at the conservative return, never below zero.", "Net debts = loans − liquid assets, never below zero. Cover = sum of the three."] };
  },
};

// PMS fees. Convention matches the common published PMS fee illustration (checked against Geojit's calculator to the rupee):
//  - returns accrue evenly through the year, so the fixed fee is charged on the average of opening and closing value;
//  - other expenses are charged on the average of opening value and closing value after the fixed fee;
//  - performance fee = share × gain above the hurdle, where the hurdle compounds on the high-water mark
//    (initial investment in year 1), and the high-water mark is the highest value reached before performance fee;
//  - GST, when entered, is added on all fees and deducted from the portfolio.
export const PMS_MAX_YEARS = 10;
const PMS_DEFAULT_RETURNS = [12, -3, 18, 12, 12, 12, 12, 12, 12, 12];

export interface PmsYear { year: number; ret: number; open: number; fixed: number; other: number; hwm: number; perf: number; gst: number; fees: number; close: number }
/** Year-by-year PMS fee engine. Rates in percent. Pure. */
export function pmsFees(p: { invest: number; fixedPct: number; perfPct: number; hurdlePct: number; otherPct: number; gstPct: number; returns: number[] }): PmsYear[] {
  let nav = p.invest, hwm = p.invest;
  return p.returns.map((r, i) => {
    const open = nav, gross = open * (1 + r / 100);
    const fixed = (p.fixedPct / 100) * (open + gross) / 2;
    const afterFixed = gross - fixed;
    const other = (p.otherPct / 100) * (open + afterFixed) / 2;
    const pre = afterFixed - other;
    const perf = (p.perfPct / 100) * Math.max(0, pre - hwm * (1 + p.hurdlePct / 100));
    hwm = Math.max(hwm, pre);
    const gst = (p.gstPct / 100) * (fixed + other + perf);
    nav = pre - perf - gst;
    return { year: i + 1, ret: r, open, fixed, other, hwm, perf, gst, fees: fixed + other + perf + gst, close: nav };
  });
}

const pmsCalc: Calculator = {
  id: "pms-fees", category: "PMS", title: "PMS fees", blurb: "Fixed fee, performance fee above a hurdle, other expenses and the high-water mark, year by year.",
  presets: [
    { label: "Fixed fee only", hint: "3% fixed, no performance fee", vals: { fixedPct: 3, perfPct: 0, hurdlePct: 0 } },
    { label: "Fixed + performance (10% hurdle)", hint: "1% fixed + 20% of gains above 10%", vals: { fixedPct: 1, perfPct: 20, hurdlePct: 10 } },
    { label: "Fixed + performance (15% hurdle)", hint: "2% fixed + 20% of gains above 15%", vals: { fixedPct: 2, perfPct: 20, hurdlePct: 15 } },
  ],
  fields: [
    amt("invest", "Initial investment", { min: 1, def: 5000000, hint: "SEBI minimum for PMS is ₹50 lakh." }),
    rate("fixedPct", "Fixed (management) fee per year", 1, 10),
    rate("perfPct", "Performance fee share", 20, 50, { hint: "Share of gains above the hurdle. Use 0 for a fixed-fee plan." }),
    rate("hurdlePct", "Hurdle rate per year", 10, 50),
    rate("otherPct", "Other expenses per year", 0.2, 5, { step: 0.05, hint: "Custody, fund accounting and similar; commonly capped at 0.50%." }),
    rate("gstPct", "GST on fees", 0, 30, { optional: true, hint: "Leave 0 to show fees before GST (18% applies in practice)." }),
    yrs("years", "Period of investment", PMS_MAX_YEARS, { def: 6 }),
    ...PMS_DEFAULT_RETURNS.map((d, i) => ({ key: `r${i + 1}`, label: `Year ${i + 1} return`, unit: "%" as const, min: -100, max: 300, step: 0.1, def: d, optional: true,
      hint: i === 0 ? "Gross portfolio return before fees. Only the years within the period are used." : undefined })),
  ],
  precheck: (raw) => {
    const n = Math.round(raw.years ?? 0);
    return Array.from({ length: n }, (_, i) => `r${i + 1}`).filter((k) => raw[k] === undefined || Number.isNaN(raw[k])).map((k) => `Year ${k.slice(1)} return: enter a value.`);
  },
  run: (v) => {
    const n = Math.round(v.years);
    const returns = Array.from({ length: n }, (_, i) => v[`r${i + 1}`]);
    const rows = pmsFees({ invest: v.invest, fixedPct: v.fixedPct, perfPct: v.perfPct, hurdlePct: v.hurdlePct, otherPct: v.otherPct, gstPct: v.gstPct, returns });
    const last = rows[rows.length - 1];
    const grossEnd = returns.reduce((x, r) => x * (1 + r / 100), v.invest);
    const fees = rows.reduce((s, r) => s + r.fees, 0);
    const sum = (k: "fixed" | "other" | "perf" | "gst") => rows.reduce((s, r) => s + r[k], 0);
    const cagr = (end: number) => ((end / v.invest) ** (1 / n) - 1) * 100;
    const notes: string[] = [];
    if (v.invest < 5000000) notes.push("The amount is below SEBI's ₹50 lakh PMS minimum; the result is for illustration only.");
    if (v.otherPct > 0.5) notes.push("Other expenses above 0.50% are higher than PMS providers usually charge.");
    return { ok: true, notes,
      metrics: [
        { label: "Value after all fees", value: last.close, kind: "inr", hero: true },
        { label: "Total fees paid", value: fees, kind: "inr" },
        { label: "Value with no fees", value: grossEnd, kind: "inr" },
        { label: "Fixed fees", value: sum("fixed"), kind: "inr" },
        { label: "Performance fees", value: sum("perf"), kind: "inr" },
        { label: "Other expenses", value: sum("other"), kind: "inr" },
        ...(v.gstPct > 0 ? [{ label: "GST", value: sum("gst"), kind: "inr" as const }] : []),
        { label: "Yearly return after fees", value: cagr(last.close), kind: "pct" },
        { label: "Yearly return before fees", value: cagr(grossEnd), kind: "pct" },
      ],
      steps: [
        "Each year's gross value = opening value × (1 + that year's return). Returns are assumed to build up evenly through the year.",
        "Fixed fee = fixed fee % × average of opening and gross closing value.",
        "Other expenses = other expenses % × average of opening value and closing value after the fixed fee.",
        "Performance fee = performance share % × the amount by which value (after fixed fee and expenses) beats the hurdle. The hurdle is the high-water mark grown by the hurdle rate; in year 1 the high-water mark is the investment.",
        "The high-water mark then becomes the highest value reached so far before performance fee, so no performance fee is charged twice on the same gain.",
        "GST, when entered, is charged on all fees. Closing value = value after fixed fee and expenses − performance fee − GST, and becomes next year's opening value.",
        "Fees are shown as charged once a year. Real agreements may charge more often, on closing value, or with different hurdle rules; adjust the inputs to match the agreement.",
      ],
      table: { cols: ["Year", "Return", "Opening value", "Fixed fee", "Other expenses", "High-water mark", "Performance fee", "GST", "Total fees", "Closing value"],
        rows: rows.map((r) => [r.year, `${r.ret}%`, r.open, r.fixed, r.other, r.hwm, r.perf, r.gst, r.fees, r.close]), money: [2, 3, 4, 5, 6, 7, 8, 9] } };
  },
};

export const CALCULATORS: Calculator[] = [sipValue, stepUpSip, sipToTarget, financialGoal, education, retirement, swp, swpTax, cagr, rebalancing, pmsCalc, termInsurance];
export const CATEGORIES: Category[] = ["SIP & investing", "Goal planning", "Withdrawals", "Returns & allocation", "PMS", "Protection"];

/** Validates then runs. Blank optional fields count as 0 (or their default). */
export function calculate(c: Calculator, raw: Partial<Record<string, number>>): Result {
  const errors = [...validate(c.fields, raw), ...(c.precheck?.(raw) ?? [])];
  if (errors.length) return err(...errors);
  const v: Values = {};
  for (const f of c.fields) v[f.key] = raw[f.key] ?? 0;
  const r = c.run(v);
  if (r.ok && r.metrics.some((m) => m.kind !== "text" && !Number.isFinite(m.value))) return err("Result is out of range for these inputs. Try smaller numbers.");
  return r;
}
