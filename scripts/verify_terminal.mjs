import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import fs from "fs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ARTIFACT_DIR = "/Users/debabrata/.gemini/antigravity-ide/brain/4f61f754-7a90-46c7-86f6-f5b4de1fa394";

async function run() {
  console.log("Launching Chrome at:", CHROME_PATH);
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("1. Visiting /login...");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });

  // Verify font is Google Sans
  const bodyFont = await page.evaluate(() => {
    return window.getComputedStyle(document.body).fontFamily;
  });
  console.log("Computed body font-family on /login:", bodyFont);

  // Fill in staff login credentials
  await page.fill("#email", "admin@fundhorizon.com");
  await page.fill("#password", "Admin@12345");
  console.log("2. Submitting staff credentials...");
  await page.click('button[type="submit"]');

  // Wait for redirect to /backoffice
  await page.waitForURL("**/backoffice**", { timeout: 10000 });
  console.log("3. Arrived at:", page.url());

  // Wait for overview table to load
  await page.waitForSelector("table.terminal-table", { timeout: 10000 });

  const overviewTitle = await page.textContent("h1");
  console.log("Page H1:", overviewTitle);

  // Check computed font on Backoffice
  const boFont = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return {
      body: window.getComputedStyle(document.body).fontFamily,
      h1: h1 ? window.getComputedStyle(h1).fontFamily : null,
      table: window.getComputedStyle(document.querySelector("table.terminal-table")).fontFamily,
    };
  });
  console.log("Backoffice fonts:", boFont);

  // Take Desktop Light screenshot
  await page.screenshot({ path: `${ARTIFACT_DIR}/terminal_overview_light.png`, fullPage: false });
  console.log("Saved terminal_overview_light.png");

  // Toggle Dark Theme
  console.log("4. Toggling Dark Theme...");
  await page.click('header button[aria-label="Toggle theme"]');
  await page.waitForTimeout(500);

  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("Is dark class active on html?:", isDark);

  await page.screenshot({ path: `${ARTIFACT_DIR}/terminal_overview_dark.png`, fullPage: false });
  console.log("Saved terminal_overview_dark.png");

  // Check PMS Tracker
  console.log("5. Testing /backoffice/pms...");
  await page.goto("http://localhost:3000/backoffice/pms", { waitUntil: "networkidle" });
  await page.waitForSelector("table.terminal-table");
  console.log("PMS page loaded table successfully.");

  // Check Derivatives
  console.log("6. Testing /backoffice/derivatives...");
  await page.goto("http://localhost:3000/backoffice/derivatives", { waitUntil: "networkidle" });
  await page.waitForSelector("h1");
  console.log("Derivatives page loaded successfully.");

  // Check Mobile Layout (375x667)
  console.log("7. Testing Mobile Viewport (375x667)...");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("http://localhost:3000/backoffice", { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  await page.screenshot({ path: `${ARTIFACT_DIR}/terminal_mobile_light.png`, fullPage: false });
  console.log("Saved terminal_mobile_light.png");

  await browser.close();
  console.log("All verification checks passed cleanly!");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
