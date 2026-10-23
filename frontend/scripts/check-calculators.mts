// Run: node scripts/check-calculators.mts  (Node 22+). Checks calculators against known figures.
import assert from "node:assert/strict";
import { CALCULATORS, calculate } from "../lib/calculators.ts";

const get = (id: string) => CALCULATORS.find((c) => c.id === id)!;
const hero = (id: string, v: Record<string, number>) => {
  const r = calculate(get(id), v);
  assert.ok(r.ok, JSON.stringify(r));
  return r.metrics[0].value;
};
const near = (a: number, b: number, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

// PrimeInvestor's published examples
near(hero("education", { cost: 1e6, years: 5, infl: 6, ret: 12 }), 16386, 1); // education page
near(hero("cagr", { start: 10000, end: 20000, years: 5 }), 14.87, 0.01); // CAGR page (doubling in 5y)
const term = calculate(get("term-insurance"), { age: 35, work: 20, house: 100000, own: 30000, other: 0, infl: 5, goal: 0, goalHave: 0, goalYears: 0, goalRet: 6, loans: 0, assets: 0 });
assert.ok(term.ok); near(term.metrics[1].value, 27.7e6, 0.1e6); // 8.4L/yr, 5%, 20y ≈ ₹2.77 cr

// sanity: SIP value with 0% return is plain sum; rebalance deltas net to the fresh money
near(hero("sip-value", { sip: 1000, years: 10, ret: 0 }), 120000);
const rb = calculate(get("rebalancing"), { cEq: 700, cDt: 300, cGd: 0, tEq: 60, tDt: 40, tGd: 0, fresh: 0, thr: 5 });
assert.ok(rb.ok && rb.table); near(rb.table.rows[0][5] as number, -100); near(rb.table.rows[1][5] as number, 100);
// SIP-to-target round trip: SIP from target should grow back to target
const t = hero("sip-to-target", { target: 5e6, existing: 0, years: 10, ret: 12 });
near(hero("sip-value", { sip: t, years: 10, ret: 12 }), 5e6, 1);

// validation: negative, missing, huge, bad cross-field
for (const c of CALCULATORS) {
  assert.equal(calculate(c, {}).ok, false, `${c.id}: empty input must fail`);
  const bad = Object.fromEntries(c.fields.map((f) => [f.key, f.max * 10]));
  assert.equal(calculate(c, bad).ok, false, `${c.id}: oversized must fail`);
  const neg = Object.fromEntries(c.fields.map((f) => [f.key, -1]));
  assert.equal(calculate(c, neg).ok, false, `${c.id}: negative must fail`);
}
assert.equal(calculate(get("rebalancing"), { cEq: 1, cDt: 1, cGd: 0, tEq: 50, tDt: 40, tGd: 0, fresh: 0, thr: 5 }).ok, false); // targets != 100
assert.equal(calculate(get("retirement"), { age: 50, retAge: 40, life: 85, exp: 1e4, existing: 0, infl: 6, pre: 12, post: 7 }).ok, false);
console.log(`ok — ${CALCULATORS.length} calculators checked`);
