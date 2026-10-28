import { expect, test } from "@playwright/test";

test("risk profiling: unticking an asset class rebalances, nudges and updates the plan", async ({ page }) => {
  await page.goto("/backoffice/risk-profiling");
  await page.getByRole("button", { name: /Moderate/ }).first().click();
  const legend = page.locator("#allocLegend");
  await expect(legend).toContainText("Debt");
  const sip = () => page.locator("#sipValue").innerText();
  await expect.poll(sip).toMatch(/\d/);
  const before = await sip();
  await expect(page.locator("#allocNudges")).toContainText("matches the Moderate profile");

  await page.getByLabel("Include Debt").uncheck();
  await expect(legend.locator("li.off")).toHaveCount(1);
  await expect(page.locator("#allocNudges")).toContainText("Debt unticked");
  await expect(page.locator("#allocReset")).toBeVisible();
  await expect.poll(sip).not.toBe(before); // assumed return moved, so the SIP moved
  const pcs = await legend.locator(".pc").allInnerTexts();
  expect(pcs.map((t) => parseInt(t)).reduce((a, b) => a + b, 0)).toBe(100);

  // Cannot untick the last asset class.
  await page.getByLabel("Include Gold").uncheck();
  await page.getByLabel("Include Liquid").uncheck();
  await expect(page.getByLabel("Include Equity")).toBeDisabled();
  await expect(page.locator("#allocNudges")).toContainText("diversification");

  await page.locator("#allocReset").click();
  await expect(legend.locator("li.off")).toHaveCount(0);
  await expect(page.locator("#allocNudges")).toContainText("matches the Moderate profile");
  await page.screenshot({ path: "/tmp/rp-reset.png", fullPage: false });
});
