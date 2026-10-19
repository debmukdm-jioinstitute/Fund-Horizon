// Copy the pdf.js worker into public/ so Next serves it as a static file.
// Bundling it through `new URL(..., import.meta.url)` makes webpack emit an ESM
// asset that Terser cannot parse ("'import' and 'export' cannot be used outside
// of module code"), which fails `next build`. Served from /pdf.worker.min.mjs
// the worker stays a module worker and is never minified.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const source = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
const target = resolve(scriptDir, "..", "public", "pdf.worker.min.mjs");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`pdf worker: ${target}`);
