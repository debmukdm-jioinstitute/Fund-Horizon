// FH Academy Taxation section — Fund Horizon material, NOT Zerodha content.
// Read-only guide: it tracks nothing and earns no XP. Every rate below is
// stated for FY 2026-27 and was checked against the sources listed on each
// page on 28 October 2026. Where a rule could not be verified cleanly, the
// page says "verify" instead of guessing. The disclaimer wording is the one
// the team requires; it is the only place the word "advice" appears in new
// Academy copy (the repo compliance scan covers backend Python, not this file).

import React, { useState } from "react";
import { useAcademy } from "./AcademyContext";
import { btnGhost, btnPrimary, card, muted } from "./ui";
import { VARSITY_MODULES_INDEX } from "@/lib/varsityCatalogue";
import { FO_BACKGROUND } from "@/lib/varsityFoBackground";

export const TAX_FY = "FY 2026-27";
export const TAX_CHECKED = "28 October 2026";
export const TAX_DISCLAIMER =
  "General education only — this is not tax advice for any individual. Rates and rules change; check the current law or speak to a tax professional before acting on anything here.";
export const TAX_SOURCES =
  "Sources checked 28 October 2026 for FY 2026-27: Income-tax Act provisions as in force for FY 2026-27 (the Income-tax Act, 2025 applies from 1 April 2026, so section numbers below use the 1961 Act numbering most references still carry), Finance Act 2023 (Section 50AA), Finance (No. 2) Act 2024 (12.5% / 20% capital-gains rates from 23 July 2024), Union Budget 2026 (slabs unchanged for FY 2026-27), ICAI Guidance Note on Tax Audit under Section 44AB (Revised 2023) for F&O turnover, and the Income Tax Department's ITR form guidance (ITR-2 for capital gains without business income, ITR-3 for business income).";

function TaxIllustration() {
  return (
    <svg viewBox="0 0 200 120" width="200" height="120" role="img" aria-label="Sketch: a ledger book with a calculator, for taxation" style={{ display: "block", maxWidth: "100%", height: "auto" }}>
      <rect x="25" y="20" width="90" height="80" rx="6" fill="none" stroke="#334155" strokeWidth="3" />
      <line x1="25" y1="40" x2="115" y2="40" stroke="#334155" strokeWidth="1.5" opacity="0.6" />
      <line x1="35" y1="55" x2="105" y2="55" stroke="#2563eb" strokeWidth="2" />
      <line x1="35" y1="70" x2="105" y2="70" stroke="#2563eb" strokeWidth="2" opacity="0.6" />
      <line x1="35" y1="85" x2="85" y2="85" stroke="#16a34a" strokeWidth="2" />
      <rect x="130" y="35" width="50" height="65" rx="6" fill="none" stroke="#334155" strokeWidth="3" />
      <rect x="138" y="43" width="34" height="14" fill="#2563eb" opacity="0.2" />
      <rect x="138" y="64" width="12" height="10" fill="#334155" opacity="0.5" />
      <rect x="154" y="64" width="12" height="10" fill="#334155" opacity="0.5" />
      <rect x="138" y="80" width="12" height="10" fill="#334155" opacity="0.5" />
      <rect x="154" y="80" width="12" height="10" fill="#16a34a" />
    </svg>
  );
}

interface TaxSection {
  h: string;
  bullets: string[];
}
interface TaxProduct {
  id: string;
  title: string;
  short: string;
  chain: [string, string, string, string];
  sections: TaxSection[];
  exampleTitle: string;
  exampleLines: string[];
  exampleResult: string;
  itr: string;
  varsityChapters: string[];
  cross: "mf" | "fo" | null;
}

const VARSITY_TAX_CHAPTERS: Record<string, string> = {
  classifying: "3. Classifying Your Market Activity",
  investors: "4. Taxation for Investors",
  traders: "5. Taxation for Traders",
  turnover: "6. Turnover, Balance Sheet, and P&L",
  itr: "7. ITR Forms (The Finale)",
};

const TAX_PRODUCTS: TaxProduct[] = [
  {
    id: "equity",
    title: "Equity — listed shares",
    short: "Shares you buy and sell on an exchange, with STT paid.",
    chain: ["Listed shares", "Up to 12 months → short-term; over 12 months → long-term", "Capital gains", "STCG 20% · LTCG 12.5% above ₹1.25 lakh a year"],
    sections: [
      {
        h: "How it is taxed",
        bullets: [
          "Under the head “Capital gains”. The gain is sale price minus purchase price minus transfer costs.",
          "STT (Securities Transaction Tax) must be paid for the concessional rates: for shares, STT is generally needed on both purchase and sale, with notified exceptions for some acquisition modes.",
          "Dividends on the shares are taxed separately, under “Income from other sources”, at your slab rate.",
        ],
      },
      {
        h: "Holding period and rates",
        bullets: [
          "Held 12 months or less: short-term. STCG is taxed at 20% (Section 111A) for transfers on or after 23 July 2024.",
          "Held more than 12 months: long-term. LTCG is taxed at 12.5% on the total eligible LTCG above ₹1.25 lakh in the financial year (Section 112A). No indexation for inflation is allowed.",
          "The ₹1.25 lakh exemption is per person per year across all Section 112A gains (shares plus equity mutual funds together), not per share or per fund.",
          "No Section 87A rebate is available against tax on Section 112A LTCG.",
          "Grandfathering: for holdings bought before 1 February 2018, the purchase cost is taken as the higher of the actual cost and the market value on 31 January 2018, capped at the sale price — so gains up to that date are not taxed.",
        ],
      },
      {
        h: "Loss set-off and carry-forward",
        bullets: [
          "In the same year, a short-term capital loss can be set off against short-term or long-term gains; a long-term capital loss can be set off only against long-term gains.",
          "Unabsorbed capital losses can be carried forward for 8 assessment years, against capital gains only — and only if the return for the loss year was filed by the due date.",
        ],
      },
    ],
    exampleTitle: "Worked example — long-term sale",
    exampleLines: [
      "Buy shares for ₹2,00,000 in January 2025. Sell them for ₹4,00,000 in October 2026 (held more than 12 months).",
      "Long-term gain = ₹4,00,000 − ₹2,00,000 = ₹2,00,000.",
      "Minus the ₹1.25 lakh annual exemption = ₹75,000 taxable.",
      "Tax = 12.5% × ₹75,000 = ₹9,375, before cess and surcharge.",
      "If the same shares were sold within 12 months instead, a ₹50,000 short-term gain would be taxed at 20% = ₹10,000, before cess and surcharge.",
    ],
    exampleResult: "Basic tax on the long-term sale: ₹9,375 (before cess and surcharge).",
    itr: "Normally ITR-2 (capital gains, no business income).",
    varsityChapters: [VARSITY_TAX_CHAPTERS.classifying, VARSITY_TAX_CHAPTERS.investors],
    cross: null,
  },
  {
    id: "mf",
    title: "Mutual funds",
    short: "Taxed only when you redeem or switch units — not on churn inside the fund.",
    chain: ["Fund units", "Equity funds: 12-month split · Debt funds from 1 Apr 2023: always short-term", "Capital gains", "Equity: 20% / 12.5% · Debt (new): slab rate"],
    sections: [
      {
        h: "How it is taxed",
        bullets: [
          "Tax arises when you redeem or switch units. Buying and selling inside the scheme by the fund manager is not a taxable event for you.",
          "Each SIP instalment is a separate purchase with its own holding-period clock.",
          "Dividends (now called IDCW payouts) are taxed under “Income from other sources” at your slab rate.",
        ],
      },
      {
        h: "Equity-oriented funds (more than 65% in domestic equity)",
        bullets: [
          "Same treatment as listed shares: units held 12 months or less → STCG at 20%; held more than 12 months → LTCG at 12.5% on gains above ₹1.25 lakh a year (shared pot with direct equity LTCG). No indexation.",
        ],
      },
      {
        h: "Debt and other “specified” funds — the 1 April 2023 change",
        bullets: [
          "A “specified mutual fund” (broadly, a fund with 35% or less in domestic equity — that is, more than 65% in debt and money-market instruments) bought on or after 1 April 2023 is always treated as short-term, however long you hold it (Section 50AA, Finance Act 2023). The whole gain is added to your income and taxed at your slab rate. No indexation, no long-term rate.",
          "This covers pure debt funds, gold funds, international fund-of-funds and conservative hybrid funds in the same band.",
          "Funds in the middle band (35–65% domestic equity): held 24 months or less → slab rate; held more than 24 months → 12.5% with no indexation.",
          "Units bought before 1 April 2023 are NOT under Section 50AA, but their long-term treatment changed in July 2024 (indexation removed). The exact rate for an old lot depends on its transfer date — verify for the specific lot before quoting a figure.",
        ],
      },
      {
        h: "Loss set-off and carry-forward",
        bullets: [
          "Same capital-gains rules as equity: short-term loss against any capital gain; long-term loss against long-term gains only; carry forward up to 8 years if the return was filed on time.",
        ],
      },
    ],
    exampleTitle: "Worked examples",
    exampleLines: [
      "Equity fund, long-term: gain ₹1,50,000 in the year, no other Section 112A gains. Taxable = ₹1,50,000 − ₹1,25,000 = ₹25,000. Tax = 12.5% × ₹25,000 = ₹3,125, before cess and surcharge.",
      "Debt fund bought after 1 April 2023, any holding period: gain ₹80,000. It is deemed short-term and taxed at your slab rate — at an assumed 30% slab, tax = ₹24,000, before cess and surcharge. (The slab used here is an assumption for illustration, not your rate.)",
    ],
    exampleResult: "Equity-fund example basic tax: ₹3,125. Debt-fund example at an assumed 30% slab: ₹24,000.",
    itr: "Normally ITR-2 (capital gains, no business income).",
    varsityChapters: [VARSITY_TAX_CHAPTERS.investors],
    cross: "mf",
  },
  {
    id: "pms",
    title: "PMS — portfolio management services",
    short: "You own the securities directly, so every sale by the manager is your tax event.",
    chain: ["Securities in your demat", "Per security: 12-month split for listed equity", "Capital gains, per transaction", "STCG 20% · LTCG 12.5% above ₹1.25 lakh a year"],
    sections: [
      {
        h: "How it is taxed",
        bullets: [
          "In a PMS the securities sit in your own demat account, so gains, dividends and interest are taxed in your hands — unlike a mutual fund, where tax waits until you redeem units.",
          "Every sale the manager makes is a taxable event for you in that year, even if you withdrew nothing.",
          "The holding period is counted per security, not per PMS account: a share the manager held 8 months gives a short-term gain; one held 2 years gives a long-term gain.",
          "Listed equity in the portfolio follows the equity rates: STCG 20% up to 12 months, LTCG 12.5% above the shared ₹1.25 lakh annual exemption. Debt securities in the portfolio follow their own capital-gains rules — verify for the security.",
          "Dividends from portfolio shares are taxed under “Income from other sources” at your slab rate.",
          "Whether PMS management fees can be deducted when computing a gain is not settled in this guide — do not assume they reduce the taxable gain; verify with a tax professional.",
          "If trading in the account is frequent enough to be treated as business income rather than capital gains, the head of income changes — that classification depends on the facts, so verify before filing.",
        ],
      },
      {
        h: "Loss set-off and carry-forward",
        bullets: [
          "Same capital-gains rules as equity, applied per transaction: short-term loss against any capital gain; long-term loss against long-term gains only; carry forward up to 8 years if the return was filed on time.",
        ],
      },
    ],
    exampleTitle: "Worked example — two sales in one year",
    exampleLines: [
      "The manager sells Share A after 8 months: gain ₹60,000 → short-term, 20% = ₹12,000.",
      "The manager sells Share B after 2 years: gain ₹2,00,000 → long-term. Assuming no other Section 112A gains that year, taxable = ₹2,00,000 − ₹1,25,000 = ₹75,000 → 12.5% = ₹9,375.",
      "Note the shared pot: the ₹1.25 lakh exemption covers direct equity, equity-fund and PMS long-term gains together in one year.",
    ],
    exampleResult: "Basic tax on the two sales: ₹12,000 + ₹9,375 = ₹21,375 (before cess and surcharge).",
    itr: "Normally ITR-2 if the only income is capital gains; ITR-3 if there is also business income.",
    varsityChapters: [VARSITY_TAX_CHAPTERS.classifying, VARSITY_TAX_CHAPTERS.investors],
    cross: null,
  },
  {
    id: "fo",
    title: "F&O — futures and options",
    short: "Business income, not capital gains — with its own turnover and audit rules.",
    chain: ["Futures & options trades", "No holding-period split — yearly profit or loss", "Business income (non-speculative)", "Slab rates on the net profit"],
    sections: [
      {
        h: "How it is taxed",
        bullets: [
          "F&O on a recognised exchange is treated as non-speculative business income (eligible derivative transactions are excluded from the “speculative” definition). The head is “Profits and gains of business or profession”, not capital gains.",
          "That is different from intraday equity trading, which is generally speculative business income with tighter loss rules.",
          "Profit is taxed at your slab rate. New-regime slabs for FY 2026-27: up to ₹4 lakh nil; ₹4–8 lakh 5%; ₹8–12 lakh 10%; ₹12–16 lakh 15%; ₹16–20 lakh 20%; ₹20–24 lakh 25%; above ₹24 lakh 30%. Health and Education Cess of 4% applies on tax plus surcharge. A rebate of up to ₹60,000 makes slab-rate tax nil where total income is up to ₹12 lakh — it does not apply to tax charged at special capital-gains rates.",
          "Brokerage and exchange charges are generally deductible business costs. Whether STT is deductible as a business cost — verify before claiming it.",
        ],
      },
      {
        h: "Turnover — what counts (for the audit test, not the tax bill)",
        bullets: [
          "Turnover is NOT the contract value. Per the ICAI Guidance Note on Tax Audit (Revised 2023): add the absolute values of all favourable and unfavourable differences on squared-off trades, plus premium received on options sold (not counted twice if it is already inside the profit figure), plus differences on reverse trades.",
          "Open positions at year-end do not count until they are squared off in a later year.",
          "Example: futures profits ₹4,00,000 and futures losses ₹6,00,000 give turnover of ₹10,00,000, while the net F&O result is a loss of ₹2,00,000 before expenses.",
        ],
      },
      {
        h: "Tax audit and presumptive taxation",
        bullets: [
          "Tax audit (Section 44AB) is needed if turnover exceeds ₹10 crore where cash receipts and cash payments are each within 5% of totals, otherwise ₹1 crore.",
          "Presumptive taxation (Section 44AD) lets an eligible business declare 6% of turnover as profit for digital receipts (8% for cash), up to the turnover limit — check the current limit before using it. It is only attractive if your real margin is above the deemed rate.",
          "If you used 44AD in any of the previous five years and now declare profit below the deemed rate while your total income is above the basic exemption, an audit is likely needed — speak to a tax professional about that switch. A first-time trader reporting a loss does not automatically need an audit if turnover is within the limit.",
        ],
      },
      {
        h: "Loss set-off, carry-forward and advance tax",
        bullets: [
          "A non-speculative business loss can be set off in the same year against any income head except salary. Unabsorbed business loss can be carried forward for 8 years, against business income only, and only if the return for the loss year was filed by the due date.",
          "Advance tax applies where the year's net tax (after TDS) is ₹10,000 or more: pay cumulatively 15% by 15 June, 45% by 15 September, 75% by 15 December and 100% by 15 March. Presumptive taxpayers may pay the whole amount by 15 March.",
        ],
      },
    ],
    exampleTitle: "Worked example — tax on an F&O profit",
    exampleLines: [
      "Total income for the year is ₹15,00,000, all from F&O profit (new regime, no deductions claimed).",
      "Slab tax: 5% on ₹4–8 lakh = ₹20,000; 10% on ₹8–12 lakh = ₹40,000; 15% on ₹12–15 lakh = ₹45,000. Total = ₹1,05,000.",
      "Plus 4% cess = ₹4,200. Total = ₹1,09,200. No 87A rebate applies because total income is above ₹12 lakh.",
    ],
    exampleResult: "Tax on a ₹15,00,000 F&O profit (new regime): ₹1,09,200 including cess, before any surcharge.",
    itr: "Normally ITR-3 (business income). F&O turnover and profit are reported segment-wise from the broker's statement.",
    varsityChapters: [VARSITY_TAX_CHAPTERS.traders, VARSITY_TAX_CHAPTERS.turnover, VARSITY_TAX_CHAPTERS.itr],
    cross: "fo",
  },
];

function DisclaimerBox() {
  return (
    <p role="note" className="rounded-md border border-[#F5C97B] bg-[#FFF8E6] p-4 text-[15px] dark:border-[#7A5B12] dark:bg-[#2B2308]">
      {TAX_DISCLAIMER}
    </p>
  );
}

function SourcesLine() {
  return <p className={`text-sm ${muted}`}>Rates as per {TAX_FY}, checked {TAX_CHECKED}. {TAX_SOURCES}</p>;
}

function VarsityTaxLinks({ chapters }: { chapters: string[] }) {
  return (
    <div className={`${card} p-5 space-y-3`}>
      <h3 className="text-lg font-semibold">Background reading on Zerodha Varsity</h3>
      <p className={`text-[15px] ${muted}`}>
        Varsity&apos;s Markets and Taxation module covers the general background. The chapters below are the ones that match this product; chapter links open the
        module on Zerodha (direct chapter links for this module were not collected).
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[15px]">
        {chapters.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <a href={VARSITY_MODULES_INDEX} target="_blank" rel="noreferrer" className={btnGhost}>
        Open Markets and Taxation on Zerodha ↗
      </a>
      <p className={`text-sm ${muted}`}>Content by Zerodha Varsity — read on zerodha.com, not hosted by Fund Horizon.</p>
    </div>
  );
}

export function TaxationHub() {
  const { go } = useAcademy();
  const [selected, setSelected] = useState(TAX_PRODUCTS[0]);
  return (
    <div className="space-y-6">
      <section className={`${card} p-6 space-y-3`} aria-label="Taxation guide overview">
        <TaxIllustration />
        <p className="text-xs font-bold uppercase tracking-wider text-[#0176D3]">Fund Horizon material · Not Zerodha content</p>
        <h2 className="text-xl font-semibold">Taxation guide — PMS, mutual funds, equity and F&O</h2>
        <p className={`text-[15px] ${muted}`}>
          Four plain-English guides: how each product is taxed, the holding-period split, the rates, turnover where it matters, loss rules, the return form
          normally used, and a worked example. This guide is reading material only — it tracks nothing and earns no XP, and it is not an Academy lesson or quiz.
        </p>
        <SourcesLine />
        <DisclaimerBox />
      </section>

      <section className={`${card} p-5 space-y-4`} aria-label="Decision map">
        <h3 className="text-lg font-semibold">Decision map — pick a product, follow its path</h3>
        <p className={`text-[15px] ${muted}`}>Product → holding period or computation → tax head → rate. Tap a product to see its path.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a product">
          {TAX_PRODUCTS.map((p) => (
            <button key={p.id} className={selected.id === p.id ? btnPrimary : btnGhost} aria-pressed={selected.id === p.id} onClick={() => setSelected(p)}>
              {p.title}
            </button>
          ))}
        </div>
        <ol className="flex flex-wrap items-center gap-2" aria-label={`${selected.title} tax path`}>
          {selected.chain.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">→</span>}
              <span className="rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-sm font-medium dark:border-[#2B3644] dark:bg-[#171E27]">{step}</span>
            </li>
          ))}
        </ol>
        <button className={btnPrimary} onClick={() => go({ tax: "1", tp: selected.id })}>Open the {selected.title} guide →</button>
      </section>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Taxation guides">
        {TAX_PRODUCTS.map((p) => (
          <article key={p.id} className={`${card} p-5 space-y-3`}>
            <h3 className="text-lg font-semibold">{p.title}</h3>
            <p className={`text-[15px] ${muted}`}>{p.short}</p>
            <button className={btnPrimary} onClick={() => go({ tax: "1", tp: p.id })}>Open guide →</button>
          </article>
        ))}
      </section>
    </div>
  );
}

export function TaxationPage({ productId }: { productId: string }) {
  const { go } = useAcademy();
  const p = TAX_PRODUCTS.find((x) => x.id === productId);
  if (!p)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-[#B42332] dark:text-[#FF7D86]">That taxation guide was not found.</p>
        <button className={btnGhost} onClick={() => go({ tax: "1" })}>← Back to taxation guides</button>
      </div>
    );
  return (
    <div className="space-y-6">
      <button className={btnGhost} onClick={() => go({ tax: "1" })}>← Back to taxation guides</button>
      <section className={`${card} p-6 space-y-3`} aria-label={`${p.title} overview`}>
        <p className="text-xs font-bold uppercase tracking-wider text-[#0176D3]">Fund Horizon material · Not Zerodha content</p>
        <h2 className="text-xl font-semibold">{p.title}</h2>
        <p className={`text-[15px] ${muted}`}>{p.short}</p>
        <p className={`text-[15px] ${muted}`}>This guide is reading material only — it tracks nothing and earns no XP.</p>
        <SourcesLine />
        <DisclaimerBox />
      </section>

      {p.sections.map((s) => (
        <section key={s.h} className={`${card} p-5 space-y-2`} aria-label={s.h}>
          <h3 className="text-lg font-semibold">{s.h}</h3>
          <ul className="list-disc space-y-2 pl-5 text-[15px]">
            {s.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      ))}

      <section className={`${card} p-5 space-y-2`} aria-label="Worked example">
        <h3 className="text-lg font-semibold">{p.exampleTitle}</h3>
        <ul className="list-disc space-y-2 pl-5 text-[15px]">
          {p.exampleLines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="text-[15px] font-semibold">{p.exampleResult}</p>
      </section>

      <section className={`${card} p-5 space-y-2`} aria-label="Return form">
        <h3 className="text-lg font-semibold">Which return form is normally used</h3>
        <p className="text-[15px]">{p.itr}</p>
      </section>

      <VarsityTaxLinks chapters={p.varsityChapters} />

      {p.cross === "mf" && (
        <section className={`${card} p-5 space-y-3`} aria-label="Related Academy module">
          <h3 className="text-lg font-semibold">Related FH Academy module</h3>
          <p className={`text-[15px] ${muted}`}>The MF Distributor module covers how funds work; this guide covers how their gains are taxed.</p>
          <button className={btnPrimary} onClick={() => go({ m: "mf" })}>Open MF Distributor module →</button>
        </section>
      )}

      {p.cross === "fo" && (
        <section className={`${card} p-5 space-y-3`} aria-label="F&O background chapters on Varsity">
          <h3 className="text-lg font-semibold">F&O background chapters on Zerodha Varsity</h3>
          <p className={`text-[15px] ${muted}`}>
            Futures and options background, listed by chapter title. Direct chapter links for these modules were not collected, so the buttons below open the
            module page on Zerodha — Options Theory opens its verified module page, and Futures Trading opens the Varsity modules index. These lists are background reading inside this taxation guide — they are not Academy modules and they earn no XP.
          </p>
          {FO_BACKGROUND.map((mod) => (
            <div key={mod.slug} className="space-y-2">
              <h4 className="font-semibold">{mod.title} · {mod.chapters.length} chapters</h4>
              <ol className="list-decimal space-y-1 pl-5 text-[15px]">
                {mod.chapters.map((c) => (
                  <li key={c.n}>{c.title}</li>
                ))}
              </ol>
              <a href={mod.moduleUrl ?? VARSITY_MODULES_INDEX} target="_blank" rel="noreferrer" className={btnGhost}>
                Open {mod.title} on Zerodha ↗
              </a>
            </div>
          ))}
          <p className={`text-sm ${muted}`}>Content by Zerodha Varsity — read on zerodha.com, not hosted by Fund Horizon.</p>
        </section>
      )}
    </div>
  );
}
