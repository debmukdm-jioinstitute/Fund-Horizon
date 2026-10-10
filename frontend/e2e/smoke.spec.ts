import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Fixture persona: young, aggressive (same as backend/tests/fixtures/personas.json)
const ANSWERS = [3, 4, 4, 4, 3, 3, 4, 3, 1, 3]; // option index per question q1..q10
const Q_GROUPS = [4, 3, 3];

async function fillAbout(page: Page, name = "Rohan", age = "26") {
  await page.getByLabel("First name").fill(name);
  await page.getByLabel("Age", { exact: true }).fill(age);
  await page.getByLabel("Source of income").selectOption("salaried_private");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function fillFinances(page: Page, opts?: { income?: string; expenses?: string; emi?: string }) {
  await page.getByLabel("Monthly take-home income").fill(opts?.income ?? "120000");
  await page.getByLabel("Monthly household expenses").fill(opts?.expenses ?? "40000");
  if (opts?.emi) await page.getByLabel("Monthly EMIs").fill(opts.emi);
  await page.getByLabel("Savings and liquid funds").fill("600000");
  await page.getByLabel("Investments", { exact: true }).fill("300000");
  await page.getByLabel("Term life cover").fill("10000000");
  await page.getByLabel("Family health cover").fill("500000");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function answerRiskPages(page: Page) {
  let offset = 0;
  for (const count of Q_GROUPS) {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Please answer every question on this page.")).toBeVisible();
    for (let i = 0; i < count; i++) {
      await page.locator(`input[name="q${offset + i + 1}"]`).nth(ANSWERS[offset + i]).check();
    }
    offset += count;
    await page.getByRole("button", { name: "Continue" }).click();
  }
}

test("complete the wizard and download the PDF", async ({ page }) => {
  await page.goto("/plan/new");

  // 1 About you
  await fillAbout(page);

  // 2 Finances
  await fillFinances(page);

  // 3 Goals: validation first; retirement years locked to 60 − 26
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Give this goal a name.")).toBeVisible();
  await page.getByLabel("Type").first().selectOption("retirement");
  await expect(page.getByLabel("Years to goal")).toHaveValue("34");
  await expect(page.getByLabel("Years to goal")).toBeDisabled();
  await expect(page.getByText(/Locked to planned retirement age/)).toBeVisible();
  await page.getByRole("button", { name: "Add another goal" }).click();
  await page.getByLabel("Type").nth(1).selectOption("home");
  await page.getByLabel("Cost in today's rupees").fill("2500000");
  await page.getByLabel("Years to goal").nth(1).fill("8");
  await page.getByLabel("Priority").nth(1).selectOption("1");
  await page.getByRole("button", { name: "Continue" }).click();

  // 4 Questionnaire, three grouped screens
  await answerRiskPages(page);

  // 5 Review lists the fields the old checklist omitted
  await expect(page.getByText("Dependents")).toBeVisible();
  await expect(page.getByText("Source of income")).toBeVisible();
  await expect(page.getByText("Monthly EMIs")).toBeVisible();
  await expect(page.getByText("Outstanding loans")).toBeVisible();
  await expect(page.getByText("Term life cover")).toBeVisible();
  await expect(page.getByText("Family health cover")).toBeVisible();
  await expect(page.getByText("Planned retirement age")).toBeVisible();
  await expect(page.getByText(/Q1\./)).toBeVisible();
  await expect(page.getByText(/Q10\./)).toBeVisible();

  await page.getByRole("button", { name: "Show my plan" }).click();
  await expect(page.getByText("Please tick the consent box to continue.")).toBeVisible();
  await page.getByRole("checkbox").check();
  const createReq = page.waitForRequest((r) => r.url().includes("/api/plans") && r.method() === "POST");
  await page.getByRole("button", { name: "Show my plan" }).click();
  const posted = await createReq;
  expect(posted.postDataJSON().consent).toBe(true);

  await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Your illustrative plan" })).toBeVisible();
  await expect(page.getByText("Illustrative shortlist (ranked by past-performance composite; not a recommendation)")).toBeVisible();
  await expect(page.getByText("ARN 345439").first()).toBeVisible();
  await expect(page.getByText("Aggressive", { exact: false }).first()).toBeVisible();

  // Finding 4 / 10 / 15 / retrieval / sequenced actions
  await expect(page.getByText(/Sized.*(central path)/).first()).toBeVisible();
  await expect(page.getByText(/P\(success\)/).first()).toBeVisible();
  await expect(page.getByText(/SIP for ~80%/).first()).toBeVisible();
  await expect(page.getByText("Funded", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/historical consistency and downside protection/)).toHaveCount(0);
  await expect(page.getByText(/past-performance composite \(return, rolling median/)).toBeVisible();
  await expect(page.getByText("Swipe sideways to see every column in the shortlist.")).toBeVisible();
  await expect(page.getByText("What to do first")).toBeVisible();
  await expect(page.locator("ol").getByText(/Then goals/)).toBeVisible();
  await expect(page.getByText(/Unused surplus/)).toBeVisible();
  await expect(page.getByText("Save this plan link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy plan link" })).toBeVisible();
  await expect(page.getByText(/constant-mix/).first()).toBeVisible();
  await expect(page.getByText(/Pre-tax illustration/).first()).toBeVisible();
  await expect(page.getByText(/SID and KIM/).first()).toBeVisible();

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

test("wizard warns on huge targets and does not persist money fields", async ({ page }) => {
  await page.goto("/plan/new");
  await fillAbout(page);
  await page.getByLabel("Monthly take-home income").fill("120000");
  await page.reload();
  await expect(page.getByLabel("Monthly take-home income")).toHaveValue("");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("First name")).toHaveValue("Rohan");
  await page.getByRole("button", { name: "Continue" }).click();
  await fillFinances(page);
  await page.getByLabel("Type").first().selectOption("home");
  await page.getByLabel("Goal name").fill("Palace");
  await page.getByLabel("Cost in today's rupees").fill("10000000000");
  await page.getByLabel("Years to goal").fill("10");
  await expect(page.getByText(/over ₹100 Cr/)).toBeVisible();
});

test("home page offers plan retrieval and execution-only wording", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/execution-only/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Already have a plan?" })).toBeVisible();
  await page.getByLabel("Plan link or ID").fill("not-a-plan");
  await page.getByRole("button", { name: "Open plan" }).click();
  await expect(page.getByText(/did not look like a plan link/)).toBeVisible();
  await page.getByLabel("Plan link or ID").fill("00000000-0000-0000-0000-000000000000");
  await page.getByRole("button", { name: "Open plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan not found" })).toBeVisible();
});

test("negative surplus hides the buy-list and leads with cashflow", async ({ page }) => {
  await page.goto("/plan/new");
  await fillAbout(page, "Meera", "32");
  await fillFinances(page, { income: "40000", expenses: "50000", emi: "15000" });
  await page.getByLabel("Type").first().selectOption("retirement");
  await expect(page.getByLabel("Years to goal")).toHaveValue("28");
  await page.getByRole("button", { name: "Continue" }).click();
  await answerRiskPages(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Show my plan" }).click();
  await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Cashflow first" })).toBeVisible();
  await expect(page.getByText(/no monthly surplus/i)).toBeVisible();
  await expect(page.getByText(/fund shortlist is hidden/i)).toBeVisible();
  await expect(page.getByText("Swipe sideways to see every column in the shortlist.")).toHaveCount(0);
  await expect(page.getByText("What to do first")).toBeVisible();
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

