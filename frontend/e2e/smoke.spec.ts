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
