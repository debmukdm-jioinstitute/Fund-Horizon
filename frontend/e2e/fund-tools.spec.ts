import { expect, test, type Page, type Route } from "@playwright/test";

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const HIT = { code: "100471", name: "Franklin India Large Cap Fund - Regular Plan - Growth", cat_label: "Equity: Large Cap", amc: "Franklin Templeton Mutual Fund", plan: "Regular", aum_cr: 7368, ter: 2.15, ret_1y: -3.38, cagr_3y: 10.11, fh_score: 71 };
const HIT2 = { ...HIT, code: "101209", name: "Taurus Large Cap Fund - Regular Plan - Growth", aum_cr: 58, ret_1y: 6.86 };
const TABLE = { title: "SIP returns", as_of: "04-11-2026", note: "Month-end NAV is used for every date.", columns: [{ key: "scheme", label: "Fund Name", group: null, kind: null }, { key: "xirr", label: "XIRR (%)", group: null, kind: "ret" }], rows: [{ scheme: "Franklin India Large Cap Fund Reg Gr", xirr: 11.25 }] };

async function mockApi(page: Page, handlers: Record<string, (r: Route, url: URL) => unknown> = {}) {
  await page.route("**/api/auth/me", (r) => r.fulfill(json({ id: "1", name: "Staff", email: "s@x.in", mobile: "", role: "admin", is_staff: true })));
  await page.route("**/api/backoffice/**", (r) => {
    const u = new URL(r.request().url());
    for (const [k, h] of Object.entries(handlers)) if (u.pathname.includes(k)) return h(r, u);
    if (u.pathname.endsWith("/screener")) { const q = (u.searchParams.get("search") ?? "").toLowerCase(); return r.fulfill(json({ data: [HIT, HIT2].filter((h) => h.name.toLowerCase().includes(q)), total: 2 })); }
    return r.fulfill(json({ data: {} }));
  });
}

test("fund tools: rich fund dropdown, groups, validation, request and result", async ({ page }) => {
  const runs: string[] = [];
  await mockApi(page, {
    "/tools/spec": (r) => r.fulfill(json({ benchmarks: [], meta: { categories: ["Equity: Large Cap", "Equity: Mid Cap"], amcs: ["5 Largest Fund Houses", "SBI Mutual Fund"] }, tools: [
      { id: "sip-returns", group: "SIP / STP / SWP", title: "SIP returns", blurb: "Value and XIRR of a SIP.", fields: [{ key: "codes", label: "Funds", type: "funds", max: 5 }, { key: "amount", label: "SIP amount (Rs.)", type: "number", default: 3000 },
        { key: "frequency", label: "Frequency", type: "select", options: ["Monthly", "Quarterly"], default: "Monthly" }, { key: "start", label: "Start date", type: "date", default: "-3y" }, { key: "end", label: "End date", type: "date", default: "today" }] },
      { id: "rank-risk", group: "Ranking", title: "Risk adjusted returns ranking", blurb: "Sharpe and alpha.", fields: [{ key: "category", label: "Category", type: "category" }, { key: "plan", label: "Plan", type: "plan" }] },
    ] })),
    "/tools/run/": (r, u) => { runs.push(u.pathname.split("/").pop() + "?" + u.searchParams.toString()); return u.pathname.endsWith("rank-risk") ? r.fulfill(json({ detail: "Please select category" }, 422)) : r.fulfill(json(TABLE)); },
  });
  await page.goto("/backoffice/mutual-funds/tools");
  await expect(page.getByRole("heading", { name: "Fund tools" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "SIP / STP / SWP" })).toHaveAttribute("aria-selected", "true");
  // validation before anything is sent
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("please select at least one fund");
  expect(runs).toHaveLength(0);
  // the fund dropdown shows more than a name
  await page.getByPlaceholder(/Type a fund name/).fill("franklin");
  const opt = page.getByRole("option").first();
  await expect(opt).toContainText("Equity: Large Cap");
  await expect(opt).toContainText("Franklin Templeton Mutual Fund");
  await expect(opt).toContainText("AUM ₹7,368 Cr");
  await expect(opt).toContainText("TER 2.15%");
  await expect(opt).toContainText("1Y -3.38%");
  await expect(opt).toContainText("3Y 10.11%");
  await expect(opt).toContainText("FH score 71");
  await opt.click();
  await expect(page.getByText("Franklin India Large Cap Fund - Regular Plan - Growth").first()).toBeVisible();
  await page.getByLabel("SIP amount (Rs.)").fill("2500");
  await page.getByLabel("Frequency").selectOption("Quarterly");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("cell", { name: "11.25" })).toBeVisible();
  await expect(page.getByText("NAV as on 04-11-2026")).toBeVisible();
  const q = new URLSearchParams(runs[0].split("?")[1]);
  expect(runs[0].startsWith("sip-returns?")).toBe(true);
  expect([q.get("codes"), q.get("amount"), q.get("frequency")]).toEqual(["100471", "2500", "Quarterly"]);
  expect(q.get("start")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // another group: server errors are shown as a message, not a blank page
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.getByRole("button", { name: "Risk adjusted returns ranking" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("cell", { name: "11.25" })).toHaveCount(0); // the previous result is cleared
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Please select category");
  expect(new URLSearchParams(runs[1].split("?")[1]).get("category")).toBe("Equity: Large Cap");
});

test("fund performance: per-fund dates, market cap tab, PDF download, rows and groups", async ({ page }) => {
  const urls: string[] = [];
  let pdfBody = "";
  await mockApi(page, {
    "/performance/pdf": (r) => { pdfBody = r.request().postData() ?? ""; return r.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4 test" }); },
    "/performance/meta": (r) => r.fulfill(json({ categories: ["Equity: Large Cap"], amcs: ["5 Largest Fund Houses"], periods: [], as_of: "04-11-2026" })),
    "/performance/": (r, u) => { urls.push(u.pathname.split("/").pop() + "?" + u.searchParams.toString()); return r.fulfill(json({ title: "Returns comparison", as_of: "04-11-2026", note: "n", columns: [
      { key: "scheme", label: "Scheme Name", group: null, kind: null }, { key: "abs", label: "Abs Ret. (%)", group: "Growth over the period", kind: "ret" }, { key: "cagr", label: "CAGR (%)", group: "Growth over the period", kind: "ret" }],
      rows: [{ scheme: "Franklin", abs: -3.5, cagr: -3.4 }, { scheme: "Taurus", abs: 6.9, cagr: 6.9 }] })); },
  });
  await page.goto("/backoffice/mutual-funds/performance");
  await expect(page.getByRole("heading", { name: "Fund performance" })).toBeVisible();
  for (const t of ["Trailing returns", "Trailing returns with market cap", "Lumpsum returns, multiple funds", "Returns comparison", "Point to point returns"]) await expect(page.getByRole("tab", { name: t, exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Trailing returns with market cap", exact: true }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect.poll(() => urls.some((u) => u.startsWith("trailing-mcap?"))).toBe(true);
  await page.getByRole("tab", { name: "Returns comparison", exact: true }).click();
  for (const name of ["franklin", "taurus"]) { await page.getByPlaceholder(/Type a fund name/).fill(name); await page.getByRole("option").first().click(); }
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2); // both funds chosen as chips
  await page.getByLabel("Different dates for each fund").check();
  await page.getByLabel(/Start date for Franklin/).fill("2023-01-01");
  await page.getByLabel(/End date for Franklin/).fill("2024-01-01");
  await page.getByLabel(/Start date for Taurus/).fill("2020-01-01");
  await page.getByLabel(/End date for Taurus/).fill("2025-01-01");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("columnheader", { name: "Growth over the period" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "-3.50", exact: true })).toBeVisible();
  const q = new URLSearchParams(urls.find((u) => u.startsWith("compare?"))!.split("?")[1]);
  expect(q.get("codes")).toBe("100471,101209");
  expect(q.getAll("start")).toEqual(["2023-01-01", "2020-01-01"]);
  expect(q.getAll("end")).toEqual(["2024-01-01", "2025-01-01"]);
  // the end date must come after the start date
  await page.getByLabel(/End date for Taurus/).fill("2019-01-01");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("End date must be after the start date");
  // PDF of the table on screen
  await page.getByLabel(/End date for Taurus/).fill("2025-01-01");
  await page.getByRole("button", { name: "Submit" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF" }).click();
  expect((await dl).suggestedFilename()).toBe("Returns comparison.pdf");
  expect(JSON.parse(pdfBody)).toMatchObject({ title: "Returns comparison", as_of: "04-11-2026" });
  // sorting and search on the result table
  await page.getByRole("columnheader", { name: /CAGR/ }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("tau");
  await expect(page.getByRole("cell", { name: "Franklin" })).toHaveCount(0);
  await expect(page.getByText("Showing 1 to 1 of 1 entries")).toBeVisible();
});

test("category returns: select all periods, latest NAV date shown", async ({ page }) => {
  const periods: string[] = [];
  const all = [["ytd", "YTD"], ["1w", "1 Week"], ["1m", "1 Month"], ["3m", "3 Months"], ["6m", "6 Months"], ["1y", "1 Year"], ["3y", "3 Years"], ["5y", "5 Years"], ["10y", "10 Years"]];
  const stat = { count: 3, avg: 1.5, max: 2.5, min: 0.5, median: 1.4 };
  await mockApi(page, {
    "/category-returns": (r, u) => { const p = u.searchParams.get("period") ?? ""; periods.push(p); const ps = p.split(",");
      return r.fulfill(json({ fund_type: "Equity Schemes", plan: "Regular", nav_as_of: "04-11-2026", note: "n", fund_types: ["Equity Schemes"], all_periods: all.map(([key, label]) => ({ key, label })),
        periods: ps.map((key) => ({ key, label: all.find((a) => a[0] === key)![1] })), rows: [{ category: "Equity: Large Cap", funds: 33, ...Object.fromEntries(ps.map((k) => [k, stat])) }] })); },
  });
  await page.goto("/backoffice/mutual-funds/category-returns");
  await expect(page.getByText("NAV as on 04-11-2026")).toBeVisible();
  await page.getByText("Select all").click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect.poll(() => periods.at(-1)).toBe("ytd,1w,1m,3m,6m,1y,3y,5y,10y");
  await expect(page.getByRole("columnheader", { name: "10 Years" })).toBeVisible();
  expect(await page.locator("fieldset input[type=checkbox]:checked").count()).toBe(10); // nine periods plus "Select all"
  await page.getByText("Select all").click(); // clears everything
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Please select period");
});
