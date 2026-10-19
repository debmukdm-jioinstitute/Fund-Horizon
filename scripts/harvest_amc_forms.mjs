// Collect form-like document links from each AMC's own forms pages with a real browser (the pages render their lists
// with JavaScript). Output: data/amc_forms_raw.json, merged and link-checked by backend/scripts/build_official_forms.py.
//   node scripts/harvest_amc_forms.mjs [amc-name ...]
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs";

export const AMCS = {
  "ICICI Prudential": ["https://www.icicipruamc.com/media-center/downloads", "https://www.icicipruamc.com/investor-services"],
  "DSP": ["https://www.dspim.com/downloads?category=Forms"],
  "WhiteOak Capital": ["https://mf.whiteoakamc.com/resources/downloads/forms", "https://mf.whiteoakamc.com/resources/downloads/forms/frequently-used-forms"],
  "Invesco India": ["https://www.invescomutualfund.com/literature-forms/forms/application"],
  "Bandhan": ["https://bandhanmutual.com/downloads/forms"],
  "Edelweiss": ["https://www.edelweissmf.com/downloads/forms"],
  "Helios": ["https://www.heliosmf.in/downloads"],
  "HSBC": ["https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources?Doc=forms"],
  "Mirae Asset": ["https://www.miraeassetmf.co.in/downloads/forms"],
  "Nippon India": ["https://mf.nipponindiaim.com/investor-service/downloads/forms"],
  "HDFC": ["https://www.hdfcfund.com/investor-services/forms"],
  "Kotak": ["https://www.kotakmf.com/Information/forms-and-downloads"],
};
// Index pages that link to sub-pages with more forms: follow these (same host, depth 1).
const FOLLOW = {
  DSP: /downloads\?category=Forms&sub_category=/,
  "Invesco India": /literature-forms\/forms\//,
  Bandhan: /downloads\/forms\//,
  Edelweiss: /downloads\/forms/,
  HSBC: /investor-resources.*Doc=forms|information-library/,
  "Nippon India": /downloads\/forms\//,
  HDFC: /investor-services\/forms/,
  Kotak: /forms/i,
};
// Pages whose list appears only after choosing each option of the first dropdown.
const ITERATE_SELECT = new Set(["Kotak"]);
const DOC = /\.(pdf|docx?|xlsx?)(\?|#|$)/i;
const FORMISH = /form|application|nomin|mandate|\bsip\b|\bstp\b|\bswp\b|transmission|kyc|fatca|crs|transaction|bank|minor|declaration|\bubo\b|redemption|consolidat|cancel|pause|indemnity|affidavit|annexure|slip|lien|joint holder|guardian|opt.?out|empanel|euin|broker/i;
const NOT = /\b(kim|sid|sai|ssd)\b|scheme.information|key.information|factsheet|addend|annual|notice|portfolio|disclosure|presentation|brochure|circular|holiday|newsletter|\bnav\b|risk.?o.?meter|aum|complaint|scores|policy|performance|product.note|dividend.declaration|\bdeck\b|leaflet|\bfaqs?\b|\bar[-_ ]?\d|market|infographic|ondc|quartile|goal.planning|corrections|hbpf|merger|letter.to.unit|roll.?over.consent|sample|calculation|ready.reckoner|investor.charter|feedback|information.ratio|timelines|calculator/i;

const slug = (u) => decodeURIComponent(new URL(u).pathname.split("/").pop()).replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ");
const wanted = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: false }); // headless Chrome is blocked by several AMC CDNs
const out = {};
for (const [amc, pages] of Object.entries(AMCS)) {
  if (wanted.length && !wanted.includes(amc)) continue;
  const seen = new Map();
  const page = await browser.newPage();
  const queue = [...pages];
  const done = new Set();
  while (queue.length && done.size < 25) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 4000); await page.waitForTimeout(500); }
      const links = await page.$$eval("a[href]", (as) => as.map((a) => [(a.innerText || a.title || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 140), a.href]));
      if (ITERATE_SELECT.has(amc)) {
        const n = await page.$eval("select", (sel) => sel.options.length).catch(() => 0);
        for (let i = 1; i < n; i++) {
          try {
            await page.selectOption("select >> nth=0", { index: i });
            await page.waitForTimeout(3500); // the choice may reload the page
            for (const [text, href] of await page.$$eval("a[href]", (as) => as.map((a) => [(a.innerText || a.title || "").trim().replace(/\s+/g, " ").slice(0, 140), a.href])))
              if (DOC.test(href) && !seen.has(href)) seen.set(href, { title: text, url: href, page: url });
          } catch { await page.goto(url, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3000); }
        }
      }
      const follow = FOLLOW[amc];
      for (const [text, href] of links) {
        if (DOC.test(href)) { if (!seen.has(href)) seen.set(href, { title: /^(read|download|view|click here|pdf)?$/i.test(text) ? slug(href) : text, url: href, page: url }); }
        else if (follow && follow.test(href) && new URL(href).host === new URL(url).host && !done.has(href) && !queue.includes(href)) queue.push(href);
      }
    } catch (e) { console.error(amc, url, String(e).slice(0, 100)); }
  }
  await page.close();
  out[amc] = [...seen.values()].filter((l) => FORMISH.test(`${l.title} ${l.url}`) && !NOT.test(`${l.title} ${l.url}`));
  console.log(amc, "docs kept:", out[amc].length, "of", seen.size);
}
await browser.close();
const file = new URL("../data/amc_forms_raw.json", import.meta.url);
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
fs.writeFileSync(file, JSON.stringify({ ...prev, ...out }, null, 1) + "\n");
