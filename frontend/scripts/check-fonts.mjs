// Enforces the site-wide typeface rule: GOOGLE SANS ONLY. Fails (exit 1) if source introduces any other font.
//
// Allowed: the `--font-google-sans` variable, the "Google Sans" / "Google Sans Variable" family names, `inherit`,
// and the generic `sans-serif` fallback inside the single canonical stack. Everything else is rejected, including
// next/font imports, @font-face for other families, font-family/fontFamily literals, and other font packages.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components", "lib", "public"];
const EXTRA_FILES = ["tailwind.config.ts", "package.json"];
const SCAN = /\.(tsx?|jsx?|css|mjs|html|svg)$/;
// Vendored third-party runtime copied in at build time (see scripts/copy-pdf-worker.mjs). It renders
// nothing on the site: pdf.js only uses these strings for form-field text in the PDF editor.
const VENDOR = new Set(["public/pdf.worker.min.mjs"]);

const problems = [];
const report = (file, line, msg, text) => problems.push(`${file}:${line}: ${msg}: ${text.trim().slice(0, 140)}`);

const ALLOWED_FAMILY_TOKEN = /^(var\(--font-google-sans\)|["']?Google Sans( Variable)?["']?|sans-serif|inherit)$/i;

function checkFamilyList(file, n, list, text) {
  for (const raw of list.split(",")) {
    const token = raw.trim().replace(/\s*!important$/, "");
    if (token && !ALLOWED_FAMILY_TOKEN.test(token)) report(file, n, `font family "${token}" is not allowed (Google Sans only)`, text);
  }
}

function checkFile(path) {
  const rel = relative(".", path).replaceAll("\\", "/");
  const src = readFileSync(path, "utf8");
  src.split("\n").forEach((text, i) => {
    const n = i + 1;
    const isComment = /^\s*(\/\/|\/\*|\*)/.test(text);
    if (rel === "package.json") {
      const m = text.match(/"((?:@fontsource[^"]*|fontsource[^"]*|typeface-[^"]*|@typefaces-[^"]*|@next\/font|webfontloader|font-awesome|@fortawesome[^"]*))"\s*:/i);
      if (m && m[1] !== "@fontsource-variable/google-sans") report(rel, n, "font package is not allowed", text);
      return;
    }
    if (/next\/font/.test(text) && !/^\s*(\/\/|\*)/.test(text)) report(rel, n, "next/font is not allowed (Google Sans is self-hosted)", text);
    if (!isComment && /@fontsource/.test(text) && !/@fontsource-variable\/google-sans["']/.test(text)) report(rel, n, "only @fontsource-variable/google-sans may be imported", text);
    if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|cdnjs.*font/i.test(text)) report(rel, n, "external font CDN is not allowed", text);
    if (/@font-face/.test(text)) report(rel, n, "custom @font-face is not allowed", text);

    // CSS declarations: `font-family: a, b` (ignore commented-out lines)
    const css = text.match(/(^|[;{\s])font-family\s*:\s*([^;}]+)/i);
    if (css && !/^\s*(\/\/|\/\*|\*)/.test(text)) checkFamilyList(rel, n, css[2], text);

    // JS/JSX: fontFamily: "..."  or style={{ fontFamily: ... }}
    const js = text.match(/fontFamily\s*[:=]\s*(["'`])([^"'`]+)\1/);
    if (js) checkFamilyList(rel, n, js[2], text);
    if (/fontFamily\s*[:=]\s*[^"'`\s{]/.test(text) && !js && !/var\(--font-google-sans\)/.test(text)) report(rel, n, "dynamic fontFamily is not allowed", text);

    // The shorthand `font:` with a family
    const short = text.match(/(^|[;{\s])font\s*:\s*([^;}]+)/i);
    if (short && /[a-z]{3,}/i.test(short[2].replace(/var\([^)]*\)|inherit|\d+(\.\d+)?(px|rem|em|%)?|\/|bold|normal|italic|[1-9]00/gi, ""))) {
      report(rel, n, "font shorthand with a family name is not allowed", text);
    }

    // Banned font names anywhere in quotes
    const named = text.match(/["'](Inter|Roboto|Arial|Helvetica( Neue)?|Georgia|Times( New Roman)?|Courier( New)?|Menlo|Monaco|Consolas|SF Pro[^"']*|Segoe UI|Open Sans|Lato|Poppins|Montserrat|Outfit|Plus Jakarta Sans|IBM Plex[^"']*|JetBrains Mono|Fira[^"']*|ui-[a-z-]+|system-ui|-apple-system|monospace|serif)["']/i);
    if (named && !/^\s*(\/\/|\*)/.test(text)) report(rel, n, `banned font name ${named[0]}`, text);
  });
}

const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (SCAN.test(f) && !VENDOR.has(relative(".", p).replaceAll("\\", "/"))) checkFile(p);
  }
};

for (const r of ROOTS) {
  try {
    walk(r);
  } catch {
    /* optional root */
  }
}
for (const f of EXTRA_FILES) checkFile(f);

// The lock itself must stay in place.
const css = readFileSync("app/globals.css", "utf8");
if (!/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*font-family:\s*var\(--font-google-sans\)\s*!important/.test(css)) {
  problems.push("app/globals.css: the global Google Sans lock (*, *::before, *::after { font-family: var(--font-google-sans) !important }) is missing");
}
const layout = readFileSync("app/layout.tsx", "utf8");
if (!/import\s+["']@fontsource-variable\/google-sans["']/.test(layout)) problems.push("app/layout.tsx: must import @fontsource-variable/google-sans");
const tw = readFileSync("tailwind.config.ts", "utf8");
for (const k of ["sans", "display", "mono", "serif"]) {
  if (!new RegExp(`\\b${k}:\\s*googleSans\\b`).test(tw)) problems.push(`tailwind.config.ts: fontFamily.${k} must be googleSans`);
}

if (problems.length) {
  console.error("Font check failed: the site must use Google Sans only.\n" + problems.join("\n"));
  process.exit(1);
}
console.log("Font check passed: Google Sans only.");
