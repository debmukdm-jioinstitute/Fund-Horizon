// Asset-allocation rebalancing and nudges for the risk profiling tool. Pure functions: no DOM, no globals.
// Staff untick an asset class; the freed weight moves to the remaining classes in proportion to how well each
// suits the customer's chosen style, goal horizon and goal type, within per-style limits. Assumed returns are
// illustrations, not forecasts.

export const ASSET_KEYS = ["equity", "debt", "gold", "liquid"];
const LABEL = { equity: "Equity", debt: "Debt", gold: "Gold", liquid: "Liquid" };

// Long-run assumed returns per class (% a year), used only to MOVE a style's assumed return when its mix changes.
export const ASSET_RETURN = { equity: 12.5, debt: 7, gold: 8, liquid: 5.5 };

// Most weight a class may take from freed money, per style (a style's own baseline weights are never cut by this).
const CAPS = {
  conservative: { equity: 30, debt: 100, gold: 15, liquid: 35 },
  moderate: { equity: 65, debt: 70, gold: 20, liquid: 25 },
  aggressive: { equity: 95, debt: 40, gold: 15, liquid: 15 },
};
const EQUITY_LIMIT = { conservative: 30, moderate: 65, aggressive: 95 };

// How well each class suits absorbing freed money, before horizon and goal adjustments.
const AFFINITY = {
  conservative: { equity: 0.1, debt: 0.5, gold: 0.15, liquid: 0.25 },
  moderate: { equity: 0.35, debt: 0.35, gold: 0.15, liquid: 0.15 },
  aggressive: { equity: 0.6, debt: 0.15, gold: 0.15, liquid: 0.1 },
};

function affinity(style, years, goalId) {
  const a = { ...(AFFINITY[style] || AFFINITY.moderate) };
  if (years <= 3 || goalId === "emergency") { a.equity *= 0.2; a.liquid *= 2; a.debt *= 1.3; }
  else if (years >= 10) { a.equity *= 1.5; a.liquid *= 0.5; }
  if (goalId === "emergency") { a.equity = 0; a.liquid *= 2; }
  return a;
}

function largestRemainder(raw) {
  const floors = ASSET_KEYS.map((k) => Math.floor(raw[k]));
  let left = 100 - floors.reduce((x, y) => x + y, 0);
  const order = ASSET_KEYS.map((k, i) => ({ k, i, frac: raw[k] - Math.floor(raw[k]) })).sort((p, q) => q.frac - p.frac);
  const out = {};
  ASSET_KEYS.forEach((k, i) => { out[k] = floors[i]; });
  for (let n = 0; n < order.length && left > 0; n++, left--) out[order[n].k] += 1;
  return out;
}

/**
 * Move the weight of unticked classes onto the rest.
 * @returns {{alloc: Record<string, number>, relaxed: boolean, moved: Record<string, number>}} whole percents summing to 100;
 *   `moved` is what each kept class received; `relaxed` means the style's limits could not hold with so few classes left.
 */
export function rebalance(style, baseAlloc, excluded, years, goalId) {
  const kept = ASSET_KEYS.filter((k) => !excluded.includes(k));
  if (kept.length === 0 || excluded.length === 0) return { alloc: { ...baseAlloc }, relaxed: false, moved: {} };
  const raw = {};
  ASSET_KEYS.forEach((k) => { raw[k] = kept.includes(k) ? baseAlloc[k] : 0; });
  const freed = excluded.reduce((s, k) => s + baseAlloc[k], 0);
  const aff = affinity(style, years, goalId);
  const caps = CAPS[style] || CAPS.moderate;
  const shortHorizon = years <= 3 || goalId === "emergency";
  let relaxed = false;
  // Passes: within style caps; then past the caps (still no equity on a short goal); finally anything.
  const passes = [{ loose: false, noEq: shortHorizon }, { loose: true, noEq: shortHorizon }, { loose: true, noEq: false }];
  const room = (k, p) => (p.noEq && k === "equity" ? 0 : Math.max(0, (p.loose ? 100 : caps[k]) - raw[k]));
  const moved = {};
  let remaining = freed;
  for (const p of passes) {
    if (p.loose && remaining > 1e-9) relaxed = true;
    for (let guard = 0; guard < 20 && remaining > 1e-9; guard++) {
      const active = kept.filter((k) => room(k, p) > 1e-9 && (aff[k] > 0 || p.loose));
      const total = active.reduce((s, k) => s + (aff[k] || 0.01), 0);
      if (!active.length || total === 0) break;
      let given = 0;
      for (const k of active) {
        const add = Math.min(remaining * ((aff[k] || 0.01) / total), room(k, p));
        raw[k] += add; moved[k] = (moved[k] || 0) + add; given += add;
      }
      remaining -= given;
      if (given < 1e-9) break;
    }
  }
  if (remaining > 1e-9) { // nothing may take more (e.g. emergency fund with only equity left): give it to the first kept class
    raw[kept[0]] += remaining; moved[kept[0]] = (moved[kept[0]] || 0) + remaining; relaxed = true;
  }
  const alloc = largestRemainder(raw);
  const movedRounded = {};
  kept.forEach((k) => { const d = alloc[k] - baseAlloc[k]; if (d !== 0) movedRounded[k] = d; });
  return { alloc, relaxed, moved: movedRounded };
}

/** Assumed return of a changed mix: the style's own assumed return shifted by the change in blended asset-class return. */
export function adjustedReturn(styleRet, baseAlloc, alloc) {
  const blend = (a) => ASSET_KEYS.reduce((s, k) => s + (a[k] * ASSET_RETURN[k]) / 100, 0);
  return Math.round((styleRet + blend(alloc) - blend(baseAlloc)) * 10) / 10;
}

/** Fund SIP shares (whole percents summing to 100) after the equity weight changed. Multi Asset funds absorb the difference. */
export function fundPcts(funds, baseAlloc, alloc) {
  if (alloc.equity === 0) return { pcts: funds.map(() => 0), note: "none" };
  const same = baseAlloc.equity === alloc.equity;
  const isMulti = (f) => f.category === "Multi Asset";
  const baseEq = funds.filter((f) => !isMulti(f)).reduce((s, f) => s + f.pct, 0);
  if (same || baseAlloc.equity === 0 || !funds.some(isMulti)) {
    return { pcts: funds.map((f) => f.pct), note: !same && !funds.some(isMulti) ? "no-multi-asset" : "" };
  }
  const ratio = alloc.equity / baseAlloc.equity;
  const eqTotal = Math.max(0, Math.min(100, baseEq * ratio));
  const scale = baseEq ? eqTotal / baseEq : 0;
  const multiBase = 100 - baseEq;
  const raw = funds.map((f) => (isMulti(f) ? (f.pct / multiBase) * (100 - eqTotal) : f.pct * scale));
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((p, q) => q.frac - p.frac).slice(0, Math.max(0, left)).forEach((o) => { floors[o.i] += 1; });
  return { pcts: floors, note: "" };
}

/**
 * Plain-language nudges for the admin, ordered most serious first.
 * ctx: { style, styleName, baseAlloc, alloc, excluded, moved, relaxed, years, goalId, goalName, baseRet, ret, sip, baseSip, fmt, fundNote }
 */
export function nudges(ctx) {
  const out = [];
  const { style, styleName, alloc, baseAlloc, excluded, moved, relaxed, years, goalId, goalName, baseRet, ret, sip, baseSip, fmt } = ctx;
  const push = (level, text) => out.push({ level, text });
  const kept = ASSET_KEYS.filter((k) => !excluded.includes(k));
  const yrs = `${years} ${years === 1 ? "year" : "years"}`;
  const goal = goalName || "this goal";

  if (kept.length === 1) push("alert", `Only ${LABEL[kept[0]]} is left, so there is no diversification. One bad stretch in that single asset hits the whole plan.`);
  if (relaxed) push("warn", `With ${excluded.map((k) => LABEL[k]).join(" and ")} removed, ${styleName} limits could not all be kept. Review the split below before sharing the plan.`);
  if (years <= 3 && alloc.equity > 25) push("alert", `${goal} is only ${yrs} away but equity is ${alloc.equity}%. Equity can fall 20% or more in a year, and there may be no time to recover. Keep equity under 25% for goals this close.`);
  if (style === "aggressive" && years <= 3) push("alert", `The customer chose Aggressive but ${goal} is only ${yrs} away. This style fits goals 7+ years out; consider Moderate or Conservative.`);
  if (style === "conservative" && alloc.equity === 0 && baseAlloc.equity > 0 && years >= 7 && goalId !== "emergency") push("warn", `No equity for a ${yrs} goal. Inflation can quietly eat returns this low over that long. Some equity usually helps ${goal} reach its target.`);
  if (alloc.equity === 0 && style !== "conservative" && baseAlloc.equity > 0) push("warn", `The customer chose ${styleName}, which expects growth, but equity is now 0%. This no longer matches the profile they selected.`);
  if (alloc.equity > EQUITY_LIMIT[style]) push("warn", `Equity at ${alloc.equity}% is above the ${EQUITY_LIMIT[style]}% a ${styleName} customer is usually comfortable with.`);
  if (years >= 7 && alloc.equity < 30 && style !== "conservative" && goalId !== "emergency" && alloc.equity > 0) push("warn", `Equity is only ${alloc.equity}% for a ${yrs} goal. That is low for the time available; growth may fall short of the target.`);
  if (style === "conservative" && alloc.debt === 0) push("warn", `A Conservative customer with no debt has little cushion against market falls.`);
  const top = ASSET_KEYS.reduce((a, k) => (alloc[k] > alloc[a] ? k : a), "equity");
  if (kept.length > 1 && alloc[top] >= 70 && style !== "aggressive") push("warn", `${alloc[top]}% sits in ${LABEL[top]}. That is concentrated for a ${styleName} customer.`);
  if (alloc.gold > 20) push("warn", `Gold is ${alloc.gold}%. Gold earns no income and can stay flat for years; above about 20% is a big bet.`);
  if (alloc.liquid > 25 && years >= 3) push("warn", `${alloc.liquid}% in liquid funds will lag inflation over ${yrs}. Consider moving part of it to debt.`);
  if (ctx.fundNote === "none") push("info", "With no equity, the equity funds on the FH list are hidden. Invest this SIP in debt, gold and liquid funds, which are outside the FH Recommended List.");
  if (ctx.fundNote === "no-multi-asset") push("info", "This style's FH funds are all equity, so the SIP split between funds does not change. Hold the debt, gold and liquid portion in separate funds outside the list.");

  if (excluded.length) {
    const parts = ASSET_KEYS.filter((k) => moved[k]).map((k) => `${LABEL[k]} ${moved[k] > 0 ? "+" : ""}${moved[k]}`);
    push("info", `${excluded.map((k) => LABEL[k]).join(" and ")} unticked (was ${excluded.map((k) => `${baseAlloc[k]}%`).join(" and ")}). Rebalanced for ${styleName} and a ${years}-year horizon: ${parts.join(", ")} points.`);
    if (Math.abs(ret - baseRet) >= 0.2) {
      const diff = Math.round(Math.abs(sip - baseSip));
      push(ret < baseRet ? "warn" : "info",
        `Assumed return moves from ${baseRet}% to ${ret}% a year. The monthly SIP ${sip >= baseSip ? "rises" : "falls"} by ${fmt(diff)} to still reach the target${ret > baseRet ? ", but expect bigger swings" : ""}.`);
    }
  } else if (out.length === 0) {
    push("info", `The mix matches the ${styleName} profile for ${goal} (${yrs}). Untick an asset class to see how the plan rebalances.`);
  }
  const rank = { alert: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
