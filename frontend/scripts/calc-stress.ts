// Stress test for every backoffice calculator: recorded outputs of the original advisor tool, invariants, boundaries and fuzzing.
// Run: npx tsx scripts/calc-stress.ts   (exits non-zero on any failure)
import { CALCULATORS, calculate, type Calculator, type Metric } from "../lib/calculators";
import { assetAllocation, CII, PPF_RATE } from "../lib/calculators-more";

let fails = 0, checks = 0;
const eq = (name: string, got: unknown, want: unknown, tol = 0) => {
  checks++;
  const ok = typeof got === "number" && typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
  if (!ok) { fails++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
};
const by = (id: string) => CALCULATORS.find((c) => c.id === id) as Calculator;
const run = (id: string, v: Record<string, number>) => {
  const r = calculate(by(id), v);
  if (!r.ok) throw new Error(`${id}: ${r.errors.join("; ")}`);
  return r;
};
const m = (id: string, v: Record<string, number>, label: string): number => {
  const x = run(id, v).metrics.find((k: Metric) => k.label === label);
  if (!x) throw new Error(`${id}: no metric "${label}"`);
  return x.value;
};

// ---- recorded originals (mutualfundtools.com, 2026-11-05)
eq("compounding yearly", m("compounding", { p: 100000, r: 12, t: 10, n: 1 }, "Maturity amount"), 310585);
eq("future cost", m("inflation-cost", { cost: 100000, infl: 6, y: 10 }, "Cost after inflation"), 179085);
eq("lumpsum", m("lumpsum", { a: 100000, r: 12, y: 10 }, "Value at the end"), 310585);
eq("lumpsum target", m("lumpsum-target", { t: 1000000, r: 12, y: 10 }, "Invest today"), 321974);
eq("emi years", m("emi", { p: 2500000, r: 12.5, y: 20, m: 0 }, "Monthly EMI"), 28404);
eq("emi years interest", m("emi", { p: 2500000, r: 12.5, y: 20, m: 0 }, "Total interest"), 4316960);
eq("emi months", m("emi", { p: 1000000, r: 10, y: 3, m: 0 }, "Monthly EMI"), 32267);
eq("emi months total", m("emi", { p: 1000000, r: 10, y: 3, m: 0 }, "Total payment"), 1161612);
eq("hlv", m("human-life-value", { a: 2500000, g: 10, loan: 0, y: 10 }, "Life cover needed"), 39843562);
eq("hlv loan", m("human-life-value", { a: 1000000, g: 5, loan: 500000, y: 5 }, "Life cover needed"), 6025631);
eq("cii gain", m("cii", { py: 2012, pc: 200000, sy: 2016, sp: 500000, tax: 20 }, "Long-term capital gain"), 236000);
eq("cii tax", m("cii", { py: 2012, pc: 200000, sy: 2016, sp: 500000, tax: 20 }, "Tax"), 47200);
eq("cii 2001-2024", m("cii", { py: 2001, pc: 100000, sy: 2024, sp: 900000, tax: 20 }, "Long-term capital gain"), 537000);
eq("cii loss has no tax", m("cii", { py: 2016, pc: 500000, sy: 2016, sp: 400000, tax: 20 }, "Tax"), 0);
eq("rd 7%", m("rd", { m: 10000, r: 7, y: 5 }, "Maturity value"), 719327);
eq("rd 8.5%", m("rd", { m: 5000, r: 8.5, y: 3 }, "Maturity value"), 205464);
eq("goal sip", m("goal-setting", { d: 10000000, y: 30, infl: 8, r: 12, sv: 0 }, "Monthly SIP needed"), 32661);
eq("goal target", m("goal-setting", { d: 10000000, y: 30, infl: 8, r: 12, sv: 0 }, "Goal after inflation"), 100626569);
eq("goal sip with savings", m("goal-setting", { d: 5000000, y: 20, infl: 6, r: 10, sv: 100000 }, "Monthly SIP needed"), 21220);
eq("goal savings fv", m("goal-setting", { d: 5000000, y: 20, infl: 6, r: 10, sv: 100000 }, "Existing savings grow to"), 672750);
eq("nps corpus", m("nps", { c: 10000, age: 35, ret: 60, r: 10, ann: 40, ar: 6 }, "Corpus at retirement"), 12431596);
eq("nps lumpsum", m("nps", { c: 10000, age: 35, ret: 60, r: 10, ann: 40, ar: 6 }, "Lumpsum withdrawal"), 7458958);
eq("nps annuity", m("nps", { c: 10000, age: 35, ret: 60, r: 10, ann: 40, ar: 6 }, "Annuity corpus"), 4972638);
eq("networth", m("networth", { eq: 500000, fi: 200000, cash: 300000, prop: 200000, gold: 200000, oa: 200000, hl: 50000, pl: 250000, it: 200000, bills: 500000, cc: 200000, ol: 20000 }, "Net worth"), 380000);
// spending less: the original is within 0.02% of this closed form (its own rounding differs by a few rupees)
eq("spend less", m("spend-less", { age: 25, ret: 60, r: 12, tax: 7, infl: 5, house: 500000, emi: 30000, car: 300000, eat: 25000, life: 25000, hol: 10000, tr: 10000, cc: 30000, pl: 20000, shop: 10000 }, "Worth at retirement (today's money)"), 7060651, 7060651 * 0.0002);
// PPF recorded rows (variable deposits of 1,00,000 a year from 2020)
{
  const r = run("ppf", { start: 2020, a: 100000, n: 7 });
  const t = (r as { table?: { rows: (string | number)[][] } }).table!.rows;
  eq("ppf 2020 interest", t[0][4], 7300); eq("ppf 2021 closing", t[1][5], 222018); eq("ppf 2026 closing", t[6][5], 929984);
  eq("ppf 2022 loan", t[2][6], 26825); eq("ppf 2026 withdrawal", t[6][7], 238234); eq("ppf no early withdrawal", t[5][7], 0);
}
// asset allocation grid (recorded): risk/horizon/mid-small -> debt, mid&small, large
for (const [risk, hz, ms, debt, mid, large] of [[1, 1, 1, 70, 0, 30], [1, 10, 1, 60, 5, 35], [1, 10, 2, 60, 0, 40], [3, 10, 1, 50, 10, 40], [3, 10, 2, 50, 0, 50], [4, 10, 2, 45, 2, 53], [5, 10, 2, 40, 5, 55], [5, 1, 1, 50, 10, 40], [3, 2, 1, 55, 8, 37], [5, 2, 2, 45, 3, 52]] as const) {
  const a = assetAllocation(risk, hz, ms === 1);
  eq(`alloc ${risk}/${hz}/${ms} debt`, a.debt, debt); eq(`alloc ${risk}/${hz}/${ms} mid`, a.midSmall, mid); eq(`alloc ${risk}/${hz}/${ms} large`, a.largeCap, large);
  eq(`alloc ${risk}/${hz}/${ms} adds to 100`, a.debt + a.equity, 100); eq(`alloc ${risk}/${hz}/${ms} equity split`, a.midSmall + a.largeCap, a.equity);
}
for (const r of [1, 2, 3, 4, 5]) for (const h of [1, 2, 3, 10]) for (const ms of [true, false]) {
  const a = assetAllocation(r, h, ms);
  eq(`alloc debt split ${r}/${h}/${ms}`, a.fmp + a.ltf + a.cash, a.debt);
}
// tables
eq("cii 2012", CII[2012], 200); eq("cii 2024", CII[2024], 363); eq("ppf 2020", PPF_RATE[2020], 7.3); eq("ppf covers 1980-2026", Object.keys(PPF_RATE).length, 47);

// ---- every calculator: defaults, boundaries, fuzz; never throws, never NaN/Infinity, errors are clean
let seed = 1234567; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
for (const c of CALCULATORS) {
  const defaults: Record<string, number> = {};
  for (const f of c.fields) if (f.def !== undefined) defaults[f.key] = f.def;
  const d0 = calculate(c, defaults);
  checks++;
  if (!d0.ok && c.fields.every((f) => f.def !== undefined || f.optional)) { fails++; console.error(`FAIL ${c.id}: default inputs do not run: ${d0.errors.join("; ")}`); }
  const attempts: Record<string, number>[] = [defaults];
  for (const f of c.fields) { attempts.push({ ...defaults, [f.key]: f.min }, { ...defaults, [f.key]: f.max }, { ...defaults, [f.key]: f.max + 1 }, { ...defaults, [f.key]: -1 }, { ...defaults, [f.key]: NaN }); }
  for (let i = 0; i < 300; i++) { const v: Record<string, number> = {}; for (const f of c.fields) v[f.key] = Math.round((f.min + rnd() * (Math.min(f.max, 1e8) - f.min)) / (f.step ?? 1)) * (f.step ?? 1); attempts.push(v); }
  let okCount = 0;
  for (const v of attempts) {
    checks++;
    try {
      const r = calculate(c, v);
      if (r.ok) {
        okCount++;
        for (const x of r.metrics) if (x.kind !== "text" && !Number.isFinite(x.value)) throw new Error(`non-finite metric ${x.label}`);
        for (const row of r.table?.rows ?? []) for (const cell of row) if (typeof cell === "number" && !Number.isFinite(cell)) throw new Error("non-finite table cell");
      } else if (!r.errors.length || r.errors.some((e) => /NaN|undefined|Infinity/.test(e))) throw new Error(`unclear error ${JSON.stringify(r.errors)}`);
    } catch (e) { fails++; console.error(`FAIL ${c.id} ${JSON.stringify(v)}: ${(e as Error).message}`); }
  }
  checks++;
  if (okCount < (c.id === "rebalancing" ? 0 : 20)) { fails++; console.error(`FAIL ${c.id}: only ${okCount} inputs ran (calculator rejects almost everything)`); } // rebalancing needs targets that add to 100
}

// ---- invariants
const lump = (r: number) => m("lumpsum", { a: 100000, r, y: 10 }, "Value at the end");
for (let r = 0; r < 20; r++) eq(`lumpsum monotone ${r}`, lump(r + 1) > lump(r) ? 1 : 0, 1);
for (const n of [1, 2, 4, 12]) eq(`more compounding is never lower (n=${n})`, m("compounding", { p: 1e5, r: 10, t: 5, n }, "Maturity amount") >= m("compounding", { p: 1e5, r: 10, t: 5, n: 1 }, "Maturity amount") ? 1 : 0, 1);
eq("lumpsum target round trip", m("lumpsum", { a: m("lumpsum-target", { t: 1e6, r: 9, y: 7 }, "Invest today"), r: 9, y: 7 }, "Value at the end") >= 1e6 - 1 ? 1 : 0, 1);
eq("emi zero rate", m("emi", { p: 120000, r: 0, y: 1, m: 0 }, "Monthly EMI"), 10000);
eq("emi last balance is zero", ((run("emi", { p: 500000, r: 9, y: 5, m: 0 }) as { table: { rows: number[][] } }).table.rows.at(-1) as number[])[3], 0);
eq("emi years + months", m("emi", { p: 100000, r: 10, y: 0, m: 6 }, "Monthly EMI") > 0 ? 1 : 0, 1);
eq("goal already covered", m("goal-setting", { d: 1e5, y: 5, infl: 0, r: 10, sv: 1e6 }, "Monthly SIP needed"), 0);

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
