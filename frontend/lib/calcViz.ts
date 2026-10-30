// Chart data for each calculator, derived from its inputs and result. Pure; shared by the live charts and the PNG/PDF export.
import { sipFactor, type Outcome, type Values } from "./calculators";

export interface Slice { name: string; value: number }
export interface Pt { x: number; a: number; b: number }
/** "stack": a = invested, b = gain (stacked bars). "area": a = balance (declining corpus). */
export interface Growth { kind: "stack" | "area"; title: string; names: [string, string]; pts: Pt[] }
export interface Bars { title: string; cats: string[]; names: [string, string]; a: number[]; b: number[]; unit?: "%" | "₹" }
export interface Viz { donutTitle?: string; donut?: Slice[]; growth?: Growth; bars?: Bars }

const grow = (p: number, r: number, y: number) => p * (1 + r / 100) ** y;
const pos = (n: number) => Math.max(n, 0);
const hero = (r: Outcome) => r.metrics[0].value;
const metric = (r: Outcome, label: string) => r.metrics.find((m) => m.label === label)?.value ?? 0;

/** Year-end points for a SIP of `sip` plus a lump sum `ex`, both at `ret`%. */
function accumulate(sip: number, ex: number, ret: number, years: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y <= years; y++) {
    const inv = sip * 12 * y + ex, val = sip * sipFactor(ret, y * 12) + grow(ex, ret, y);
    pts.push({ x: y, a: inv, b: pos(val - inv) });
  }
  return pts;
}
const stack = (title: string, pts: Pt[]): Growth => ({ kind: "stack", title, names: ["Invested", "Growth"], pts });

export function vizFor(id: string, v: Values, r: Outcome): Viz {
  const rows = r.table?.rows ?? [];
  switch (id) {
    case "sip-value": {
      const inv = v.sip * v.years * 12;
      return { donutTitle: "Where the value comes from", donut: [{ name: "Invested", value: inv }, { name: "Estimated gain", value: pos(hero(r) - inv) }], growth: stack("Year-by-year growth", accumulate(v.sip, 0, v.ret, v.years)) };
    }
    case "step-up-sip": {
      const sipInv = metric(r, "Total invested (SIPs)");
      return { donutTitle: "Where the value comes from", donut: [{ name: "SIPs invested", value: sipInv }, { name: "Existing investments", value: v.existing }, { name: "Estimated gain", value: pos(hero(r) - sipInv - v.existing) }],
        growth: stack("Year-by-year growth", [{ x: 0, a: v.existing, b: 0 }, ...rows.map((row) => ({ x: Number(row[0]), a: Number(row[2]) + v.existing, b: pos(Number(row[3]) - Number(row[2]) - v.existing) }))]) };
    }
    case "sip-to-target": {
      const sip = hero(r), inv = sip * v.years * 12, ex = metric(r, "Existing investments at target date");
      return { donutTitle: "How the target is built", donut: [{ name: "Existing grown", value: ex }, { name: "SIP invested", value: inv }, { name: "SIP gain", value: pos(metric(r, "Still to build via SIP") - inv) }], growth: stack("Path to the target", accumulate(sip, v.existing, v.ret, v.years)) };
    }
    case "financial-goal":
    case "education": {
      const sip = hero(r), inv = sip * v.years * 12;
      return { donutTitle: "How the goal is funded", donut: [{ name: "You invest", value: inv }, { name: "Market growth", value: pos(r.metrics[1].value - inv) }], growth: stack("Path to the goal", accumulate(sip, 0, v.ret, v.years)) };
    }
    case "retirement": {
      const toGo = v.retAge - v.age, sip = hero(r), inv = sip * toGo * 12, ex = metric(r, "Existing investments at retirement");
      return { donutTitle: "How the corpus is built", donut: [{ name: "Existing grown", value: ex }, { name: "SIP invested", value: inv }, { name: "SIP growth", value: pos(metric(r, "Corpus still to build") - inv) }], growth: stack("Path to retirement", accumulate(sip, v.existing, v.pre, toGo)) };
    }
    case "swp":
      return { growth: { kind: "area", title: "Corpus over time", names: ["Balance", ""], pts: [{ x: 0, a: v.corpus, b: 0 }, ...rows.map((row) => ({ x: Number(row[0]), a: Number(row[2]), b: 0 }))] } };
    case "swp-tax":
      return { donutTitle: "Tax vs balance", donut: [{ name: "Tax paid", value: metric(r, "Tax paid over that period") }, { name: "Balance left", value: metric(r, "Balance left") }],
        growth: { kind: "area", title: "Corpus over time", names: ["Balance", ""], pts: [{ x: 0, a: v.corpus, b: 0 }, ...rows.map((row) => ({ x: Number(row[0]), a: Number(row[3]), b: 0 }))] } };
    case "cagr": {
      const pts: Pt[] = [], n = Math.ceil(v.years);
      for (let y = 0; y <= n; y++) pts.push({ x: y, a: v.start, b: pos(v.start * (v.end / v.start) ** (Math.min(y, v.years) / v.years) - v.start) });
      return { donutTitle: "Initial vs gain", donut: [{ name: "Initial investment", value: v.start }, { name: "Gain", value: pos(v.end - v.start) }], growth: stack("Compounding path", pts) };
    }
    case "rebalancing": {
      const cur = [v.cEq, v.cDt, v.cGd], tot = cur[0] + cur[1] + cur[2];
      return { donutTitle: "Current allocation", donut: ["Equity", "Debt", "Gold"].map((name, k) => ({ name, value: cur[k] })),
        bars: { title: "Current vs target allocation (%)", cats: ["Equity", "Debt", "Gold"], names: ["Current", "Target"], a: cur.map((c) => (tot > 0 ? (c / tot) * 100 : 0)), b: [v.tEq, v.tDt, v.tGd] } };
    }
    case "term-insurance":
      return { donutTitle: "What the cover is made of", donut: [{ name: "Income replacement", value: metric(r, "Income replacement") }, { name: "Unfunded goals", value: metric(r, "Unfunded goals") }, { name: "Net debts", value: metric(r, "Net debts (loans − assets)") }] };
    case "pms-fees": {
      const fees = rows.map((row) => Number(row[3]) + Number(row[4]) + Number(row[7]));
      const perf = rows.map((row) => Number(row[6]));
      return { donutTitle: "Where the gross value went", donut: [{ name: "Value after fees", value: hero(r) }, { name: "Fixed fees and expenses", value: fees.reduce((a, b) => a + b, 0) }, { name: "Performance fees", value: perf.reduce((a, b) => a + b, 0) }],
        bars: { title: "Fees each year", cats: rows.map((row) => `Year ${row[0]}`), names: ["Fixed fee, expenses and GST", "Performance fee"], a: fees, b: perf, unit: "₹" } };
    }
    default:
      return {};
  }
}
