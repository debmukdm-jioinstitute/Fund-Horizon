import test from "node:test";
import assert from "node:assert/strict";
import { rebalance, adjustedReturn, fundPcts, nudges, ASSET_KEYS } from "./allocEngine.mjs";

const MOD = { equity: 50, debt: 33, gold: 10, liquid: 7 };
const CONS = { equity: 15, debt: 65, gold: 5, liquid: 15 };
const AGG = { equity: 85, debt: 7, gold: 6, liquid: 2 };
const sum = (a) => ASSET_KEYS.reduce((s, k) => s + a[k], 0);
const fmt = (n) => `Rs ${n}`;

test("no exclusion leaves the style mix untouched", () => {
  assert.deepEqual(rebalance("moderate", MOD, [], 10, "education").alloc, MOD);
});

test("result is whole percents summing to 100 for every single and double exclusion", () => {
  for (const [style, base] of [["conservative", CONS], ["moderate", MOD], ["aggressive", AGG]]) {
    for (const years of [1, 3, 7, 15]) {
      for (let mask = 1; mask < 15; mask++) {
        const ex = ASSET_KEYS.filter((_, i) => mask & (1 << i));
        const { alloc } = rebalance(style, base, ex, years, "education");
        assert.equal(sum(alloc), 100, `${style} ${years}y ${ex}`);
        ex.forEach((k) => assert.equal(alloc[k], 0));
        ASSET_KEYS.forEach((k) => assert.ok(Number.isInteger(alloc[k]) && alloc[k] >= 0));
      }
    }
  }
});

test("moderate customer unticks debt on a long goal: money goes mostly to equity, within the style limit", () => {
  const { alloc } = rebalance("moderate", MOD, ["debt"], 15, "marriage");
  assert.ok(alloc.equity > 50 && alloc.equity <= 65 + 1);
  assert.ok(alloc.gold > 10 || alloc.liquid > 7);
});

test("short horizon: freed money never goes to equity while other classes have room", () => {
  const { alloc } = rebalance("moderate", MOD, ["debt"], 2, "car");
  assert.equal(alloc.equity, 50);
  assert.ok(alloc.liquid > 7);
});

test("emergency fund never gains equity when debt is unticked", () => {
  const { alloc } = rebalance("conservative", CONS, ["debt"], 1, "emergency");
  assert.equal(alloc.equity, 15);
});

test("aggressive customer unticks equity: weight lands on debt, gold and liquid, limits relaxed only if forced", () => {
  const r = rebalance("aggressive", AGG, ["equity"], 10, "education");
  assert.equal(r.alloc.equity, 0);
  assert.equal(sum(r.alloc), 100);
  assert.equal(r.relaxed, true); // 85 points cannot fit under the aggressive caps of the other three classes
});

test("only one class left: everything goes there and the engine flags it", () => {
  const r = rebalance("moderate", MOD, ["equity", "gold", "liquid"], 10, "education");
  assert.deepEqual(r.alloc, { equity: 0, debt: 100, gold: 0, liquid: 0 });
  assert.equal(r.relaxed, true);
});

test("assumed return moves with equity weight and is unchanged for the baseline mix", () => {
  assert.equal(adjustedReturn(10.5, MOD, MOD), 10.5);
  assert.ok(adjustedReturn(10.5, MOD, { equity: 20, debt: 63, gold: 10, liquid: 7 }) < 10.5);
  assert.ok(adjustedReturn(10.5, MOD, { equity: 70, debt: 13, gold: 10, liquid: 7 }) > 10.5);
});

test("fund shares: multi-asset funds absorb a lower equity weight and total stays 100", () => {
  const funds = [{ category: "Large Cap", pct: 30 }, { category: "Flexi Cap", pct: 30 }, { category: "Large & Mid Cap", pct: 25 }, { category: "Multi Asset", pct: 15 }];
  const { pcts } = fundPcts(funds, MOD, { equity: 30, debt: 43, gold: 14, liquid: 13 });
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100);
  assert.ok(pcts[3] > 15 && pcts[0] < 30);
  assert.equal(fundPcts(funds, MOD, { ...MOD, equity: 0, debt: 83 }).note, "none");
  assert.deepEqual(fundPcts(funds, MOD, MOD).pcts, [30, 30, 25, 15]);
});

const ctx = (over) => ({ style: "moderate", styleName: "Moderate", baseAlloc: MOD, alloc: MOD, excluded: [], moved: {}, relaxed: false, years: 10, goalId: "education", goalName: "Child Education", baseRet: 10.5, ret: 10.5, sip: 10000, baseSip: 10000, fmt, ...over });

test("nudges: matching profile gives one calm note", () => {
  const n = nudges(ctx({}));
  assert.equal(n.length, 1);
  assert.equal(n[0].level, "info");
});

test("nudges: equity on a short goal is an alert and sorts first", () => {
  const n = nudges(ctx({ years: 2, goalId: "car", goalName: "Buy a Car" }));
  assert.equal(n[0].level, "alert");
  assert.match(n[0].text, /only 2 years away/);
});

test("nudges: unticking debt reports the move and the SIP impact", () => {
  const n = nudges(ctx({ excluded: ["debt"], alloc: { equity: 62, debt: 0, gold: 20, liquid: 18 }, moved: { equity: 12, gold: 10, liquid: 11 }, ret: 11.4, sip: 9200 }));
  assert.ok(n.some((x) => /Debt unticked/.test(x.text)));
  assert.ok(n.some((x) => /rises|falls/.test(x.text) && /bigger swings/.test(x.text)));
});

test("nudges: single remaining asset and zero equity for chosen aggressive style", () => {
  const a = nudges(ctx({ style: "aggressive", styleName: "Aggressive", excluded: ["equity", "gold", "liquid"], alloc: { equity: 0, debt: 100, gold: 0, liquid: 0 } }));
  assert.ok(a.some((x) => x.level === "alert" && /diversification/.test(x.text)));
  assert.ok(a.some((x) => /equity is now 0%/.test(x.text)));
});
