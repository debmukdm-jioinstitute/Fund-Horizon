import { expect, test } from "@playwright/test";

test("risk profiling: back button on step 1 and back to styles on step 2", async ({ page }) => {
  await page.goto("/backoffice/risk-profiling");
  const back = page.getByRole("button", { name: /Back to backoffice/ });
  await expect(back).toBeVisible();
  await page.getByRole("button", { name: /Moderate/ }).first().click();
  await expect(page.getByRole("button", { name: /Back to styles/ })).toBeVisible();
  await page.getByRole("button", { name: /Back to styles/ }).click();
  await expect(page.getByRole("heading", { name: "How do you want your money to grow?" })).toBeVisible();
});
