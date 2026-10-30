// Self-check: the PMS fee engine reproduces the published fee illustration to the rupee. Run: node scripts/check-pms-calc.mjs
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const out = join(mkdtempSync(join(tmpdir(), "pms-")), "calc.mjs");
await build({ entryPoints: [fileURLToPath(new URL("../lib/calculators.ts", import.meta.url))], bundle: true, format: "esm", outfile: out, platform: "node", logLevel: "error" });
const { pmsFees, calculate, CALCULATORS } = await import(out);
const rows = pmsFees({ invest: 5000000, fixedPct: 1, perfPct: 20, hurdlePct: 10, otherPct: 0.2, gstPct: 0, returns: [12, -3, 18, 12, 12, 12] });
// Geojit published figures for this plan and inputs
const want = { fixed: [53000, 54462, 57748, 65338, 72296, 79958], other: [10547, 10838, 11492, 13002, 14387, 15912], hwm: [5536453, 5536453, 6182385, 6825259, 7552090, 8352546],
  perf: [7291, 0, 18457, 4927, 8861, 9050], close: [5529162, 5297987, 6163928, 6820332, 7543229, 8343497], fees: [70837.6, 65300.24, 87697.28, 83266.95, 95543.22, 104919.45] };
let bad = 0;
for (const k of Object.keys(want)) want[k].forEach((w, i) => { const g = rows[i][k]; const tol = k === "fees" ? 0.01 : 0.6; if (Math.abs(g - w) > tol) { bad++; console.log("MISMATCH", k, i + 1, g, w); } });
const c = CALCULATORS.find((x) => x.id === "pms-fees");
const r = calculate(c, { invest: 5000000, fixedPct: 3, perfPct: 0, hurdlePct: 0, otherPct: 0.2, years: 2, r1: 10, r2: 10 });
if (!r.ok || r.metrics.find((m) => m.label === "Performance fees").value !== 0) { bad++; console.log("fixed-only plan should have no performance fee"); }
const missing = calculate(c, { invest: 5000000, fixedPct: 1, perfPct: 20, hurdlePct: 10, otherPct: 0.2, years: 3, r1: 10, r2: 10 });
if (missing.ok) { bad++; console.log("missing year 3 return should fail"); }
console.log(bad ? `FAILED ${bad}` : "PMS fee engine matches the published illustration (6 years × 6 rows) and edge checks pass");
process.exit(bad ? 1 : 0);
