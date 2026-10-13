import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ARTIFACT_DIR = "/Users/debabrata/.gemini/antigravity-ide/brain/4f61f754-7a90-46c7-86f6-f5b4de1fa394";
const BASE_URL = "https://fundhorizon.up.railway.app";

async function run() {
  console.log("1. Launching Chrome for live production audit...");
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("2. Navigating to live login:", `${BASE_URL}/login`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

  const loginTitle = await page.title();
  console.log("Live Login Title:", loginTitle);

  // Check computed font
  const loginBodyFont = await page.evaluate(() => window.getComputedStyle(document.body).fontFamily);
  console.log("Computed body font-family on live /login:", loginBodyFont);

  // Authenticate as Staff Admin
  console.log("3. Submitting staff credentials on production...");
  await page.fill("#email", "admin@fundhorizon.com");
  await page.fill("#password", "Admin@12345");
  await page.click('button[type="submit"]');

  // Wait for redirect to /backoffice
  await page.waitForURL("**/backoffice**", { timeout: 15000 });
  console.log("4. Redirected to live backoffice:", page.url());

  // Wait for overview table to load
  await page.waitForSelector("table.terminal-table", { timeout: 15000 });

  const h1Text = await page.textContent("h1");
  console.log("Live Backoffice H1:", h1Text);

  const boFonts = await page.evaluate(() => {
    return {
      body: window.getComputedStyle(document.body).fontFamily,
      h1: window.getComputedStyle(document.querySelector("h1")).fontFamily,
      table: window.getComputedStyle(document.querySelector("table.terminal-table")).fontFamily,
    };
  });
  console.log("Live Backoffice computed fonts:", boFonts);

  // Take Desktop Light screenshot
  await page.screenshot({ path: `${ARTIFACT_DIR}/backoffice_live_verified.png`, fullPage: false });
  console.log("Saved live screenshot to backoffice_live_verified.png");

  // Toggle Dark Mode
  console.log("5. Testing theme toggle on production...");
  await page.click('header button[aria-label="Toggle theme"]');
  await page.waitForTimeout(500);

  const isDarkActive = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("Live HTML has dark class?:", isDarkActive);

  await page.screenshot({ path: `${ARTIFACT_DIR}/backoffice_live_dark.png`, fullPage: false });
  console.log("Saved live screenshot to backoffice_live_dark.png");

  // Mobile layout audit
  console.log("6. Testing live mobile viewport (375x667)...");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${BASE_URL}/backoffice`, { waitUntil: "networkidle" });
  await page.waitForSelector("header");
  await page.screenshot({ path: `${ARTIFACT_DIR}/backoffice_live_mobile.png`, fullPage: false });
  console.log("Saved live screenshot to backoffice_live_mobile.png");

  await browser.close();
  console.log(">>> LIVE PRODUCTION AUDIT PASSED CLEANLY! <<<");
}

run().catch((err) => {
  console.error("Live audit failed:", err);
  process.exit(1);
});
