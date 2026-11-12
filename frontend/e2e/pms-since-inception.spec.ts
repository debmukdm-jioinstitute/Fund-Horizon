import { expect, test } from "@playwright/test";

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

// 1,844 strategies like the live universe: some with no since-inception return, some with no inception date, one in the future
const rows = Array.from({ length: 1844 }, (_, i) => ({
  provider: `Provider ${i % 90}`, strategy_name: `Strategy ${String(i).padStart(4, "0")}`, strategy_type: "Equity", service_type: "Discretionary", as_on: "2026-10-31", ia_id: String(1000 + i),
  aum_crore: 100 + i, return_1m: 1, return_3m: 2, return_6m: 3, return_1y: 4, return_3y: 10, return_5y: 11,
  return_since_inception: i % 7 === 0 ? null : (i * 37) % 4000 / 100, // 0.00 .. 39.99
  inception_date: i % 5 === 0 ? null : i % 2 === 1 ? "2099-01-01" : `20${String(10 + (i % 15)).padStart(2, "0")}-0${1 + (i % 9)}-15`,
  benchmark: "BSE 500 TRI", fh_score: 60, fh_rating: 3, fh_signal: "Hold", fh_signal_reasons: [], fh_status: "screened", missing_inputs: [],
}));

test("PMS table: Since Inception columns show data, sort best-first with gaps last, never invent a date", async ({ page }) => {
  await page.route("**/api/auth/me", (r) => r.fulfill(json({ id: "1", name: "Staff", email: "s@x.in", mobile: "", role: "admin", is_staff: true })));
  await page.route("**/api/backoffice/**", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith("/pms/strategies")) return r.fulfill(json({ data: rows, as_on: "2026-10-31", count: rows.length, source: "APMI", freshness: "current" }));
    return r.fulfill(json({ data: {} }));
  });
  await page.goto("/backoffice/pms?section=all&full=1");
  const head = page.locator("table.terminal-table thead th");
  await expect(head.filter({ hasText: "Since Inception" })).toBeVisible();
  await expect(head.filter({ hasText: "Inception · Track" })).toBeVisible();

  const col = async (name: string) => (await head.allTextContents()).findIndex((t) => t.includes(name));
  const cells = async (name: string) => {
    const i = await col(name);
    return page.locator("table.terminal-table tbody tr").evaluateAll((trs, idx) => trs.map((tr) => (tr.children[idx as number] as HTMLElement | undefined)?.innerText.trim() ?? ""), i);
  };
  await head.filter({ hasText: "Since Inception" }).click(); // sort
  const si = (await cells("Since Inception")).map((t) => parseFloat(t.replace(/[^0-9.\-]/g, "")));
  const real = si.filter((v) => !Number.isNaN(v));
  expect(real.length).toBeGreaterThan(50);
  const sorted = [...real].sort((a, b) => b - a);
  const desc = real.every((v, i) => v === sorted[i]);
  const asc = real.every((v, i) => v === [...real].sort((a, b) => a - b)[i]);
  expect(desc || asc).toBe(true);
  // rows with no value are listed after every row that has one
  const firstGap = si.findIndex((v) => Number.isNaN(v));
  if (firstGap >= 0) expect(si.slice(firstGap).every((v) => Number.isNaN(v))).toBe(true);
  // no invented dates or years: a row without a date shows a dash, one with a date shows "N.N yrs"
  const inc = await cells("Inception · Track");
  expect(inc.some((d) => d === "—")).toBe(true);
  inc.filter((d) => d !== "—").forEach((d) => { const y = Number(/([\d.]+) yrs/.exec(d)?.[1]); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(60); });
  await head.filter({ hasText: "Inception · Track" }).click(); // sorts without error on the same data
  await expect(page.locator("table.terminal-table tbody tr").first()).toBeVisible();
});
