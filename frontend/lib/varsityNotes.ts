// FH-original notes for the Zerodha Varsity catalogue. Nothing here is copied
// from Zerodha: blurbs, topic labels and mapping notes are written for Fund
// Horizon staff in plain English. Topic chapter numbers refer to the stored
// chapter lists in varsityCatalogue.ts; a topic with chapter: null links to
// the module's chapter list (or, where no list is stored, to the module page).
// Words the repo compliance scan flags (such as "recommend") do not appear here.

export interface VarsityTopic {
  label: string;
  /** Chapter number within the module, or null when no single chapter fits. */
  chapter: number | null;
}

export interface VarsityNote {
  blurb: string;
  relates: string | null;
  topics: VarsityTopic[];
}

export const VARSITY_NOTES: Record<string, VarsityNote> = {
  "introduction-to-stock-markets": {
    blurb:
      "The starting point for anyone new to markets: why people invest, who takes part, how shares are bought and sold, and how indices work. Read it first if market words still feel unfamiliar.",
    relates: "Background reading before the FH Academy MF Distributor module.",
    topics: [
      { label: "Why people invest", chapter: null },
      { label: "Market participants", chapter: null },
      { label: "IPOs", chapter: null },
      { label: "Indices", chapter: null },
      { label: "Trading and settlement", chapter: null },
    ],
  },  "fundamental-analysis": {
    blurb:
      "How to look at a company through its annual report and accounts: profit, balance sheet, cash flow, ratios, and how those figures feed into a value view.",
    relates: "Pairs with the FH Academy work on reading funds and portfolios.",
    topics: [
      { label: "Reading an annual report", chapter: 3 },
      { label: "Profit and loss", chapter: 4 },
      { label: "Balance sheet", chapter: 6 },
      { label: "Cash flow", chapter: 8 },
      { label: "Ratios", chapter: 9 },
      { label: "Valuing a company", chapter: 14 },
    ],
  },  "markets-and-taxation": {
    blurb:
      "How market income is taxed in India: investor versus trader treatment, turnover, balance sheet and profit-and-loss statements, and the return forms.",
    relates: "Useful context for the tax conversations in FH client reviews.",
    topics: [
      { label: "Setting the context", chapter: 1 },
      { label: "Investor taxation", chapter: 4 },
      { label: "Trader taxation", chapter: 5 },
      { label: "Turnover and P&L", chapter: 6 },
      { label: "Return forms", chapter: 7 },
      { label: "Foreign stocks", chapter: 8 },
    ],
  },  "personal-finance-mutual-funds": {
    blurb:
      "Personal finance from the ground up: retirement maths, what a fund and its NAV are, debt and equity funds, costs, and how to read a fund's record.",
    relates: "Pairs directly with the FH Academy MF Distributor module.",
    topics: [
      { label: "Background and orientation", chapter: 1 },
      { label: "The retirement problem", chapter: 4 },
      { label: "Fund and NAV", chapter: 7 },
      { label: "The fund fact-sheet", chapter: 8 },
      { label: "Debt funds", chapter: 11 },
      { label: "Costs and plan types", chapter: 20 },
      { label: "Analysing an equity fund", chapter: 24 },
      { label: "Asset allocation", chapter: 28 },
    ],
  },  "integrated-financial-modelling": {
    blurb:
      "Building a company model in a spreadsheet: history, assumptions, revenue, assets, debt, cash flow, and a value built from discounted cash flows.",
    relates: "Background reading for the FH Academy work on reading companies.",
    topics: [
      { label: "Introduction", chapter: 1 },
      { label: "Assumptions", chapter: 4 },
      { label: "Revenue model", chapter: 6 },
      { label: "Asset schedule", chapter: 7 },
      { label: "Debt schedule", chapter: 9 },
      { label: "Valuation overview", chapter: 14 },
      { label: "Discounted cash flow", chapter: 18 },
    ],
  },  "personal-finance-insurance": {
    blurb:
      "Short notes on insurance and the thinking traps around it: incentives, nudges, and how to tell a solid cover from a gimmick.",
    relates: "Background for protection conversations; FH Academy covers behaviour and goals in its psych and goals modules.",
    topics: [
      { label: "Introduction", chapter: 1 },
      { label: "Incentives", chapter: 2 },
      { label: "Nudges", chapter: 3 },
      { label: "A solid defence", chapter: 6 },
      { label: "Gimmick or not", chapter: 8 },
    ],
  },  "sector-analysis": {
    blurb:
      "What to look for sector by sector — banking, IT, autos, cement, hotels, retail, real estate and more — and why the same market news hits each one differently.",
    relates: "Background reading for the FH Academy work on portfolios.",
    topics: [
      { label: "Sector overview", chapter: 1 },
      { label: "Banking", chapter: 8 },
      { label: "Information technology", chapter: 5 },
      { label: "Automobiles", chapter: 6 },
      { label: "Cement", chapter: 2 },
      { label: "Real estate", chapter: 16 },
    ],
  },  "nps-national-pension-system": {
    blurb:
      "The National Pension System in full: how it compares with other retirement plans, investment choices, exit and withdrawal rules, tax rules, and corporate NPS.",
    relates: "Useful context for retirement planning in FH client reviews.",
    topics: [
      { label: "Introduction", chapter: 1 },
      { label: "NPS versus other plans", chapter: 2 },
      { label: "Investment options", chapter: 3 },
      { label: "Exit and withdrawals", chapter: 4 },
      { label: "Tax rules", chapter: 6 },
      { label: "Corporate NPS", chapter: 9 },
    ],
  },
};
