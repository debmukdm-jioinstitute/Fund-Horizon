// Renders docs/images/*.svg to PNG (Chromium via Playwright). Needs frontend deps installed: node docs/illustrations/render.mjs
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const { chromium } = createRequire(resolve(import.meta.dirname, "../../frontend/package.json"))("@playwright/test");
const dir = resolve(import.meta.dirname, "../images");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const f of readdirSync(dir).filter((x) => x.endsWith(".svg"))) {
  await page.goto("file://" + resolve(dir, f));
  await page.screenshot({ path: resolve(dir, f.replace(".svg", ".png")) });
  console.log("rendered", f);
}
await browser.close();
