// Fails if banned compliance words appear in frontend source. Word-boundary, case-insensitive.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = /\b(best|guaranteed|advice|advisory|recommend you buy)\b/i;
const ROOTS = ["app", "components", "lib"];
const bad = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(f)) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (BANNED.test(line)) bad.push(`${p}:${i + 1}: ${line.trim()}`);
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
