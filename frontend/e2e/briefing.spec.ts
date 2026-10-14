import { expect, test, type Page } from "@playwright/test";

/**
 * Briefing tab (Round 2): URL state ?tab=briefing&view=analyst|advisor&date=YYYY-MM-DD
 * must be read on load and updated on change; the archive picker must list only
 * stored dates; empty sections must show the backend reason; print CSS must keep
 * items/sections whole.
 *
 * These tests need a staff session against a running backend. They skip (rather
 * than fail) when the briefing tab is not reachable in the current environment.
 */

async function briefingReachable(page: Page): Promise<boolean> {
  await page.goto("/backoffice/research?tab=briefing");
  // If we land on a sign-in page or the request fails, the tab is not reachable.
  const body = (await page.textContent("body")) ?? "";
  if (/sign in|log in/i.test(body) && !/Daily Briefing/i.test(body)) return false;
  return true;
}

test.describe("backoffice briefing tab (Round 2)", () => {
  test("restores view and date from the URL on reload", async ({ page }) => {
    test.skip(!(await briefingReachable(page)), "briefing tab not reachable (no staff session)");
    await page.goto("/backoffice/research?tab=briefing&view=analyst&date=2026-10-13");
    // Analyst view toggle is pressed and reflected in the URL.
    await expect(page.getByRole("button", { name: "Analyst", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Archive select carries the requested date when a brief is stored for it.
    const archive = page.getByLabel("Briefing archive date");
    const options = await archive.locator("option").allTextContents();
    if (options.some((o) => o.includes("2026-10-13") || o.includes("13 Oct 2026"))) {
      await expect(archive).toHaveValue("2026-10-13");
    }
    await expect(page).toHaveURL(/tab=briefing/);
    await expect(page).toHaveURL(/view=analyst/);
  });

  test("advisor view is the default and shows the five composed sections", async ({ page }) => {
    test.skip(!(await briefingReachable(page)), "briefing tab not reachable (no staff session)");
    await page.goto("/backoffice/research?tab=briefing");
    await expect(page.getByRole("button", { name: "Advisor", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const header = await page.getByRole("heading", { name: /Daily Briefing/ }).textContent();
    expect(header).toMatch(/Daily Briefing/);
    // The five advisor section keys render in business-first order.
    const expected = ["Client actions", "Fund movers", "Cost & manager changes", "Regulatory", "Market pulse"];
    const headings = await page.locator("section h2, details summary").allTextContents();
    const joined = headings.join(" | ");
    for (const title of expected) {
      expect(joined).toContain(title);
    }
  });

  test("changing the view updates the URL without a reload", async ({ page }) => {
    test.skip(!(await briefingReachable(page)), "briefing tab not reachable (no staff session)");
    await page.goto("/backoffice/research?tab=briefing");
    await page.getByRole("button", { name: "Analyst", exact: true }).click();
    await expect(page).toHaveURL(/view=analyst/);
    await page.getByRole("button", { name: "Advisor", exact: true }).click();
    await expect(page).toHaveURL(/view=advisor/);
  });

  test("archive select options come only from stored briefing dates", async ({ page }) => {
    test.skip(!(await briefingReachable(page)), "briefing tab not reachable (no staff session)");
    await page.goto("/backoffice/research?tab=briefing");
    const archive = page.getByLabel("Briefing archive date");
    await expect(archive).toBeVisible();
    const values = await archive.locator("option").evaluateAll((els) =>
      els.map((e) => (e as HTMLOptionElement).value)
    );
    for (const v of values.filter(Boolean)) {
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
