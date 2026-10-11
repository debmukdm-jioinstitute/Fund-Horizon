// Fails if banned compliance words appear in frontend source. Word-boundary, case-insensitive.
// Bare "suggested" / "recommend" are advice-tone; "recommendation" remains allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CORE_BANNED = /\b(best|guaranteed|advice|advisory|recommend you buy)\b/i;
const TONE_BANNED = /\b(suggested|recommend)\b/i;
// WS4 owns these surfaces and still has legacy "suggested" copy; they consume
// softened strings from /api/meta. CORE_BANNED still applies to them.
const TONE_DEFER = new Set([
  "components/Results.tsx",
  "app/plan/[id]/PlanView.tsx",
  "app/page.tsx",
]);
const ROOTS = ["app", "components", "lib"];
const bad = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(f)) {
      const rel = relative(".", p).replaceAll("\\", "/");
      const deferTone = TONE_DEFER.has(rel);
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (CORE_BANNED.test(line) || (!deferTone && TONE_BANNED.test(line))) {
          bad.push(`${p}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
};
ROOTS.forEach(walk);
if (bad.length) {
  console.error("Banned compliance wording found:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("check-copy: ok");
