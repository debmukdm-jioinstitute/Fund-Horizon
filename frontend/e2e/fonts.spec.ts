import { expect, test } from "@playwright/test";

// Site-wide rule: every rendered element uses Google Sans. No exceptions.
const PAGES = ["/", "/plan/new", "/tax", "/learn", "/funds/compare", "/funds/ask", "/cas", "/login", "/signup", "/admin"];

for (const path of PAGES) {
  test(`Google Sans only on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);

    const result = await page.evaluate(() => {
      const wanted = /^"?Google Sans( Variable)?"?$/i;
      const offenders: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body, body *"))) {
        const first = getComputedStyle(el).fontFamily.split(",")[0].trim();
        if (!wanted.test(first)) offenders.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}: ${first}`);
      }
      return {
        offenders: offenders.slice(0, 10),
        loaded: document.fonts.check('16px "Google Sans Variable"'),
      };
    });

    expect(result.offenders, "elements rendered in a non-Google-Sans family").toEqual([]);
    expect(result.loaded, "Google Sans must be loaded, not just named").toBe(true);
  });
}
