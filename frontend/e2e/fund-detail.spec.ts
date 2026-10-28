import { expect, test } from "@playwright/test";

const SCHEME = { scheme_code: "101209", scheme_name: "Taurus Large Cap Fund - Regular Plan - Growth", amc_name: "Taurus Mutual Fund", category: "Large Cap", cat_key: "large_cap", plan: "Regular", option: "Growth", latest_nav: 165.58, nav_date: "27-Oct-2026", ter_pct: 2.73 };
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test("fund detail page: header, stat strip, tabs and NAV history", async ({ page }) => {
  // Staff session and fund data are mocked so the page renders without a login or a seeded database.
  await page.route("**/api/auth/me", (r) => r.fulfill(json({ id: "1", name: "Staff", email: "s@x.in", mobile: "", role: "admin", is_staff: true })));
  await page.route("**/api/backoffice/**", (r) => {
    const u = r.request().url();
    if (u.includes("/performance"))
      return r.fulfill(json({ data: { public_page: true, metrics: { ret_1m: -1.69, ret_1y: 1.66, cagr_3y: 13.67, vol_3y: 13.92, max_drawdown_3y: -17.68, sharpe_3y: 0.52, history_years: 20.5 }, history: [{ date: "2026-10-27", nav: 165.58, r1m: -0.19, r1y: 2.12, r3y: 13.74, r5y: 9.8 }, { date: "2026-09-30", nav: 165.9, r1m: -1.94, r1y: 7.3, r3y: 12.4, r5y: 9.92 }] }, as_of: "2026-10-27" }));
    if (u.includes("/manager")) return r.fulfill(json({ data: { manager_name: "Anuj Kapil", manager_start: "13 Jun 2023", tenure_years: 3.4 } }));
    return r.fulfill(json({ data: {} }));
  });
  await page.goto(`/backoffice/mutual-funds/101209?s=${encodeURIComponent(JSON.stringify(SCHEME))}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Taurus Large Cap Fund");
  await expect(page.getByText("Latest NAV")).toBeVisible();
  await expect(page.getByText("Expense ratio (TER)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Anuj Kapil" }).first()).toBeVisible();
  for (const t of ["Fund Price", "Performance", "Peer Comparison", "Calculator", "Asset Allocation", "Sector Allocation", "Holdings", "Overview", "About", "Compare Funds", "FAQs"]) await expect(page.getByRole("tab", { name: t })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Returns across horizons" })).toBeVisible();
  await page.getByRole("tab", { name: "Fund Price" }).click();
  await expect(page.getByRole("heading", { name: "NAV history" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "165.5800" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Identification & settlement" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Holdings" }).click();
  await expect(page.getByText("monthly portfolio file is not ingested").first()).toBeVisible();
});

test("fund detail page: a bare link (no ?s=) looks the fund up by code", async ({ page }) => {
  await page.route("**/api/auth/me", (r) => r.fulfill(json({ id: "1", name: "Staff", email: "s@x.in", mobile: "", role: "admin", is_staff: true })));
  await page.route("**/api/backoffice/**", (r) => {
    if (r.request().url().includes("/screener"))
      return r.fulfill(json({ data: [{ code: "101209", name: "Taurus Large Cap Fund - Regular Plan - Growth", amc: "Taurus Mutual Fund", plan: "Regular", cat: "large_cap", nav: 165.58, nav_date: "27-Oct-2026", ter: 2.73 }], total: 1, groups: [] }));
    return r.fulfill(json({ data: {} }));
  });
  await page.goto("/backoffice/mutual-funds/101209");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Taurus Large Cap Fund");
  await expect(page.getByText("2.73%").first()).toBeVisible();
});
