import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Fixture persona: young, aggressive (same as backend/tests/fixtures/personas.json)
const ANSWERS = [3, 4, 4, 4, 3, 3, 4, 3, 1, 3]; // option index per question q1..q10

test("complete the wizard and download the PDF", async ({ page }) => {
  await page.goto("/plan/new");

  // 1 About you
  await page.getByLabel("First name").fill("Rohan");
  await page.getByLabel("Age", { exact: true }).fill("26");
  await page.getByLabel("Source of income").selectOption("salaried_private");
  await page.getByRole("button", { name: "Continue" }).click();

  // 2 Finances
  await page.getByLabel("Monthly take-home income").fill("120000");
  await page.getByLabel("Monthly household expenses").fill("40000");
  await page.getByLabel("Savings and liquid funds").fill("600000");
  await page.getByLabel("Investments", { exact: true }).fill("300000");
  await page.getByLabel("Term life cover").fill("10000000");
  await page.getByLabel("Family health cover").fill("500000");
  await page.getByRole("button", { name: "Continue" }).click();

  // 3 Goals: validation first
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Give this goal a name.")).toBeVisible();
  await page.getByLabel("Type").first().selectOption("retirement");
  await expect(page.getByLabel("Years to goal")).toHaveValue("34");
  await page.getByRole("button", { name: "Add another goal" }).click();
  await page.getByLabel("Type").nth(1).selectOption("home");
  await page.getByLabel("Cost in today's rupees").fill("2500000");
  await page.getByLabel("Years to goal").nth(1).fill("8");
  await page.getByLabel("Priority").nth(1).selectOption("1");
  await page.getByRole("button", { name: "Continue" }).click();

  // 4 Questionnaire, one per screen
  for (const idx of ANSWERS) {
    await page.getByRole("button", { name: "Continue" }).click(); // must answer first
    await expect(page.getByText("Please choose an option to continue.")).toBeVisible();
    await page.getByRole("radio").nth(idx).check();
    await page.getByRole("button", { name: "Continue" }).click();
  }

  // 5 Review + consent
  await page.getByRole("button", { name: "Show my plan" }).click();
  await expect(page.getByText("Please tick the consent box to continue.")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Show my plan" }).click();

  await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Your illustrative plan" })).toBeVisible();
  await expect(page.getByText("Illustrative shortlist (ranked by past-performance composite; not a recommendation)")).toBeVisible();
  await expect(page.getByText("ARN 345439").first()).toBeVisible();
  await expect(page.getByText("Aggressive", { exact: false }).first()).toBeVisible();

  // Step-up toggle recalculates
  await page.getByRole("button", { name: "10%" }).click();
  await expect(page.getByRole("button", { name: "10%" })).toHaveAttribute("aria-pressed", "true");

  // PDF download
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download PDF report" }).click(),
  ]);
  const path = await download.path();
  const bytes = readFileSync(path!);
  expect(bytes.length).toBeGreaterThan(20_000);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
});

test("unknown plan renders real 404 page", async ({ page }) => {
  const response = await page.goto("/plan/00000000-0000-0000-0000-000000000000");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Plan not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a new plan" })).toBeVisible();
});

test("home page renders exactly one disclosure block in the footer", async ({ page }) => {
  await page.goto("/");
  const footerDisclosures = page.getByRole("list", { name: "Important disclosures" });
  await expect(footerDisclosures).toBeVisible();
  await expect(page.getByRole("heading", { name: "Please note" })).toHaveCount(0);
  await expect(page.getByText("ARN 345439")).toHaveCount(1);
});

test("security headers are present on responses", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.headers()["x-frame-options"]).toBe("DENY");
  expect(res?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res?.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(res?.headers()["permissions-policy"]).toContain("camera=()");
  expect(res?.headers()["x-powered-by"]).toBeUndefined();
});

test("fund analytics deep page renders metrics, rolling returns, and capture chart", async ({ page }) => {
  await page.goto("/funds/128628");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("NAV History")).toBeVisible();
  await expect(page.getByText("Rolling Returns Consistency")).toBeVisible();
  await expect(page.getByText("Risk & Volatility Profile")).toBeVisible();
  await expect(page.getByText("Market Capture vs Category")).toBeVisible();
  await expect(page.getByText("ARN 345439").first()).toBeVisible();
});

test("fund comparison page renders side-by-side comparison and correlation matrix", async ({ page }) => {
  await page.goto("/funds/compare?codes=128628,148535");
  await expect(page.getByRole("heading", { name: "Side-by-Side Scheme Comparison" })).toBeVisible();
  await expect(page.getByText("3Y CAGR")).toBeVisible();
  await expect(page.getByText("3Y Volatility")).toBeVisible();
  await expect(page.getByText("Return Correlation & Overlap Proxy")).toBeVisible();
  await expect(page.getByText("return-correlation overlap, not holdings overlap")).toBeVisible();
});

test("cas upload page renders upload form, consent, and privacy notice", async ({ page }) => {
  await page.goto("/cas");
  await expect(page.getByRole("heading", { name: "Consolidated Account Statement (CAS) Analysis" })).toBeVisible();
  await expect(page.getByText("Statutory Privacy & In-Memory Processing Guarantee")).toBeVisible();
  await expect(page.getByLabel("CAS PDF Document")).toBeVisible();
  await expect(page.getByLabel(/PDF Password/i)).toBeVisible();
  await expect(page.getByLabel(/Target Asset Allocation Profile/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze Portfolio" })).toBeVisible();
  await expect(page.getByText("ARN 345439").first()).toBeVisible();
});

test("fund ask knowledge base page renders search input, suggestions, and disclaimers", async ({ page }) => {
  await page.goto("/funds/ask");
  await expect(page.getByRole("heading", { name: "Mutual Fund Scheme Knowledge Base" })).toBeVisible();
  await expect(page.getByLabel("Ask or Search Knowledge Base")).toBeVisible();
  await expect(page.getByLabel("Plan Option")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "HDFC Banking and PSU Debt" })).toBeVisible();
  await expect(page.getByText("ARN 345439").first()).toBeVisible();
});

test("admin control center renders overview, tabs, metrics, and catalog", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
  await expect(page.getByText("Mutual Fund Schemes").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Client Plans").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Executive Overview/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Client Plans/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fund Catalog/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Assumptions & Rules/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Operations & Sync/i })).toBeVisible();

  // Switch to Fund Catalog tab
  await page.getByRole("button", { name: /Fund Catalog/i }).click();
  await expect(page.getByRole("heading", { name: "Mutual Fund Master Catalog" })).toBeVisible();
  await expect(page.getByPlaceholder("Search scheme name or code...")).toBeVisible();

  // Switch to Assumptions tab
  await page.getByRole("button", { name: /Assumptions & Rules/i }).click();
  await expect(page.getByRole("heading", { name: /Deterministic Model Assumptions/i })).toBeVisible();
  await expect(page.getByText("Asset Class Expected Returns")).toBeVisible();
});



