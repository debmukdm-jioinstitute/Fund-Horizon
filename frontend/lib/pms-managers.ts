/**
 * Fund-manager profiles for the PMS backoffice.
 *
 * Bio fields are compiled from free public sources (firm team pages, APMI
 * disclosures, reputable news interviews). Any field that could not be
 * verified is recorded as "Not publicly disclosed" — never guessed.
 * Strategy-level figures (AUM, returns) always come from the live PMS
 * dataset, not from this file.
 */

export interface PmsManagerCareerEntry {
  period: string;
  role: string;
  organization: string;
}

export interface PmsManagerSource {
  label: string;
  url: string;
}

export interface PmsManagerProfile {
  /** URL-safe key, e.g. "sunil-singhania" */
  id: string;
  /** Display name without honorifics, e.g. "Sunil Singhania" */
  name: string;
  /** Raw name variants as they appear in APMI data, e.g. "Mr Darshan Engineer" */
  aliases: string[];
  firm: string;
  current_title: string;
  /** Degrees / institutions, or "Not publicly disclosed" */
  education: string;
  years_experience: number | null;
  bio_summary: string;
  /** Only when stated in the manager's own public materials, else null */
  investment_philosophy: string | null;
  career_history: PmsManagerCareerEntry[];
  sources: PmsManagerSource[];
}

/** Minimal structural shape so this module never imports the backoffice lib. */
export interface PmsStrategyLike {
  principal_officer?: string;
  aum_crore?: number;
}

/** Strip honorifics and normalise for matching ("Mr. Amit Jeswani" -> "amit jeswani"). */
export function normalizeManagerName(raw: string): string {
  return raw
    .replace(/^(mr|mrs|ms|dr)\.?\s+/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findManagerProfile(principalOfficer: string | undefined | null): PmsManagerProfile | null {
  if (!principalOfficer) return null;
  const norm = normalizeManagerName(principalOfficer);
  if (!norm) return null;
  return (
    PMS_MANAGERS.find(
      (m) =>
        normalizeManagerName(m.name) === norm ||
        m.aliases.some((a) => normalizeManagerName(a) === norm)
    ) || null
  );
}

export function getManagerStrategies<T extends PmsStrategyLike>(
  principalOfficer: string | undefined | null,
  strategies: T[]
): T[] {
  if (!principalOfficer) return [];
  const norm = normalizeManagerName(principalOfficer);
  return strategies.filter(
    (s) => s.principal_officer && normalizeManagerName(s.principal_officer) === norm
  );
}

export function managerSlug(name: string): string {
  return normalizeManagerName(name).replace(/\s+/g, "-");
}

export const PMS_MANAGERS: PmsManagerProfile[] = [
  {
    id: "darshan-engineer",
    name: "Darshan Engineer",
    aliases: ["Mr Darshan Engineer"],
    firm: "Sundaram Alternate Assets",
    current_title: "Fund Manager, Sundaram Alternates",
    education: "MMS (Finance), Jamnalal Bajaj Institute of Management Studies; B.E. (Computer Engineering), Sardar Patel College of Engineering, Mumbai University",
    years_experience: 16,
    bio_summary: "Darshan Engineer is a Fund Manager at Sundaram Alternates, which he joined in June 2025 to manage strategies including Rising Stars, SISOP and SELF Portfolio. He has over 16 years of experience across financial markets, including 14 years in equities and 2 years in credit ratings. His earlier roles include Portfolio Manager at Karma Capital Advisors, Senior Vice President and Assistant Fund Manager at Valuequest Investment Advisors, and positions at Alchemy Capital and CRISIL. His coverage areas include consumer discretionary, auto and auto ancillaries, pharmaceuticals, chemicals and information technology.",
    investment_philosophy: null,
    career_history: [
      { period: "2025–present", role: "Fund Manager", organization: "Sundaram Alternates" },
      { period: "2024–2025", role: "Senior Vice President and Assistant Fund Manager", organization: "Valuequest Investment Advisors" },
      { period: "2021–2024", role: "Portfolio Manager", organization: "Karma Capital Advisors" },
      { period: "Not publicly disclosed", role: "Investment professional", organization: "Alchemy Capital Management" },
      { period: "Not publicly disclosed", role: "Credit research (leadership roles)", organization: "CRISIL" }
    ],
    sources: [
      { label: "Business Today — Sundaram Alternates SELF Portfolio manager profile", url: "https://www.businesstoday.in/pms/sundaram-alternates-self-portfolio-180" },
      { label: "Economic Times — Sundaram Alternates portfolio story (Jul 2026)", url: "https://economictimes.indiatimes.com/prime/money-and-markets/how-sundaram-alternates-bet-on-a-long-ignored-sector-returned-30/primearticleshow/132748223.cms" },
      { label: "Moneycontrol Daily Voice interview (Nov 2023)", url: "https://www.moneycontrol.com/news/business/markets/daily-voice-this-portfolio-manager-foresees-a-sustained-ipo-boom-for-years-not-just-this-quarter-11809371.html" },
      { label: "RocketReach professional profile", url: "https://rocketreach.co/darshan-engineer-email_31234201" }
    ],
  },
  {
    id: "sunil-singhania",
    name: "Sunil Singhania",
    aliases: ["Sunil Singhania"],
    firm: "Abakkus Asset Manager",
    current_title: "Founder, Abakkus Asset Manager",
    education: "Chartered Accountant; CFA charterholder",
    years_experience: 30,
    bio_summary: "Sunil Singhania founded Abakkus Asset Manager in 2018 after a long career in Indian asset management. He previously served as Global Head of Equities at Nippon Life India Asset Management (formerly Reliance Nippon Life Asset Management) from 2003 to 2017, where he oversaw India-focused equity assets of over USD 10 billion. He is a chartered accountant and CFA charterholder, and served on the global board of CFA Institute from 2013 to 2019.",
    investment_philosophy: null,
    career_history: [
      { period: "2018–present", role: "Founder", organization: "Abakkus Asset Manager" },
      { period: "2003–2017", role: "Global Head of Equities (CIO – Equities, Reliance Capital Group)", organization: "Nippon Life India Asset Management (formerly Reliance Nippon Life Asset Management)" }
    ],
    sources: [
      { label: "Financial Express — Abakkus DRHP filing story (Sep 2026)", url: "https://www.financialexpress.com/market/ipo-news-abakkus-ipo-sunil-singhania-owned-rs-41000-cr-asset-manager-files-drhp-who-is-selling-4345214/" },
      { label: "AngelOne — Abakkus founder background", url: "https://www.angelone.in/news/mutual-funds/abakkus-asset-manager-evaluates-fy27-ipo-may-finalise-bankers-soon" },
      { label: "The Hindu BusinessLine — Abakkus DRHP filing (Sep 2026)", url: "https://www.thehindubusinessline.com/markets/sunil-singhania-led-abakkus-asset-manager-limited-files-drhp-for-ipo/article71495690.ece/amp/" },
      { label: "Finnotes — Sunil Singhania profile", url: "https://www.finnotes.org/people/sunil-singhania" }
    ],
  },
  {
    id: "kunal-shah",
    name: "Kunal Shah",
    aliases: ["Kunal Shah"],
    firm: "Carnelian Asset Management and Advisors Pvt Ltd",
    current_title: "Principal Officer and Fund Manager, Carnelian Asset Management and Advisors",
    education: "Chartered Accountant with All India Rank",
    years_experience: 12,
    bio_summary: "Kunal Shah is Principal Officer and Fund Manager at Carnelian Asset Management and Advisors, where he sits on the fund management team and investment committee and has been with the firm since its inception in 2019. He is a chartered accountant with an All India Rank and has 12 years of professional experience, with research coverage across banking, insurance, consumer, autos, capital goods, chemicals and pharma. He is a different person from Kunal Shah, the founder of CRED.",
    investment_philosophy: null,
    career_history: [
      { period: "2019–present", role: "Fund management team and Investment Committee member", organization: "Carnelian Asset Management and Advisors (with the firm since inception)" }
    ],
    sources: [
      { label: "PMS Bazaar — Kunal Shah fund manager profile", url: "https://pmsbazaar.com/FundManager/Carnelian-Asset-Management-and--Advisors-Pvt-Ltd/Kunal-Shah" },
      { label: "Business Today — Carnelian strategy manager profile", url: "https://www.businesstoday.in/pms/carnelian-bespoke-strategy-263" },
      { label: "Finec — Carnelian PMS review", url: "https://finec.in/portfolio-management/carnelian-pms/" },
      { label: "Economic Times / Bloomberg — earnings revival story quoting Kunal Shah (Dec 2025)", url: "https://m.economictimes.com/markets/stocks/news/indian-investors-bet-on-earnings-revival-to-power-stock-gains/amp_articleshow/126132540.cms" }
    ],
  },
  {
    id: "satish-kothari",
    name: "Satish Kothari",
    aliases: ["Satish Kothari"],
    firm: "SageOne Investment Managers LLP",
    current_title: "Fund Manager, SageOne Investment Managers",
    education: "CFA charterholder; MBA, Symbiosis; Commerce graduate, St. Xavier's College, Kolkata",
    years_experience: 18,
    bio_summary: "Satish Kothari is a Fund Manager at SageOne Investment Managers LLP, where he manages the SageOne Large and Midcap Portfolio. He has 18 years of experience across sell-side and buy-side equity research, with deep coverage of BFSI and consumer sectors. Before joining SageOne, he worked in investment banking covering equity capital markets, spent over eight years in equity sales heading a professional-clients segment, and managed money for a large family office.",
    investment_philosophy: null,
    career_history: [
      { period: "Not publicly disclosed–present", role: "Fund Manager", organization: "SageOne Investment Managers LLP" },
      { period: "Not publicly disclosed", role: "Managed money for a large family office (proprietary stint)", organization: "Not publicly disclosed" },
      { period: "Not publicly disclosed", role: "Equity sales — built and headed professional-clients segment (family offices, proprietary funds, investment managers)", organization: "Not publicly disclosed" },
      { period: "Not publicly disclosed", role: "Investment banker, ECM coverage (IPOs, QIPs)", organization: "Not publicly disclosed" }
    ],
    sources: [
      { label: "PMS Bazaar — Satish Kothari fund manager profile", url: "https://pmsbazaar.com/FundManager/SageOne-Investment-Managers-LLP/Satish-Kothari-,-CFA" },
      { label: "Economic Times — ETMarkets Fund Manager Talk interview (Nov 2022)", url: "https://economictimes.indiatimes.com/markets/expert-view/etmarkets-fund-manager-talk-this-rs-3000-cr-money-manager-goes-bottom-up-to-pick-winners/articleshow/95808028.cms" },
      { label: "SageOne Investments — media page (SLMP fund manager)", url: "https://sageoneinvestments.com/media/" }
    ],
  },
  {
    id: "sachin-khivasara",
    name: "Sachin Khivasara",
    aliases: ["Sachin Khivasara"],
    firm: "Buoyant Capital Private Limited",
    current_title: "Director, Principal Officer and Fund Manager, Buoyant Capital",
    education: "Associate member, Institute of Chartered Accountants of India; Associate, Institute of Cost and Works Accountants of India",
    years_experience: 26,
    bio_summary: "Sachin Khivasara is a Director and the Principal Officer and Fund Manager at Buoyant Capital Private Limited, where he has served as director since 2014. He has over 26 years of equity research and investing experience, with sector coverage across automobiles and ancillaries, capital goods and engineering, and small and mid-cap companies. His earlier employers include Nippon Asset Management, Edelweiss and Enam Investments.",
    investment_philosophy: null,
    career_history: [
      { period: "2014–present", role: "Director (Principal Officer and Fund Manager)", organization: "Buoyant Capital Private Limited" },
      { period: "Not publicly disclosed", role: "Equity research and investing roles", organization: "Nippon Asset Management; Edelweiss; Enam Investments" }
    ],
    sources: [
      { label: "Altport — Sachin Khivasara fund manager profile", url: "https://www.altportfunds.com/fund-managers/sachin-khivasara/" },
      { label: "Buoyant Capital — PMS registration details (Principal Officer and Fund Manager)", url: "https://www.buoyantcap.com/blog/valuations-matter-but-stories-sell-better/" },
      { label: "PMS Bazaar — Sachin Khivasara fund manager profile", url: "https://pmsbazaar.com/FundManager/Buoyant-Capital-Pvt-Ltd/Sachin-Khivasara" },
      { label: "PMS AIF World — Buoyant Capital Opportunities fund page", url: "https://www.pmsaifworld.com/portfolio/buoyant-capital-opportunities-multi-cap-fund/" }
    ],
  },
  {
    id: "anand-shah",
    name: "Anand Shah",
    aliases: ["Anand Shah"],
    firm: "ICICI Prudential Asset Management Company",
    current_title: "CIO – PMS & AIF, ICICI Prudential AMC",
    education: "PGDM, IIM Lucknow; B.E., Regional Engineering College, Surat",
    years_experience: 20,
    bio_summary: "Anand Shah is CIO for PMS and AIF at ICICI Prudential AMC, a role he assumed in February 2021. He has over two decades of fund management experience, including stints as CEO of NJ Asset Management, Deputy CEO and Head of Investments at BNP Paribas Asset Management for nearly a decade, Head of Equities at Canara Robeco, and Vice President – Investments at Kotak Mutual Fund. He received the 'CIO of the Year Award 2014-15' from Asia Asset Management.",
    investment_philosophy: null,
    career_history: [
      { period: "2021–present", role: "Head / CIO – PMS & AIF Investments", organization: "ICICI Prudential Asset Management Company" },
      { period: "Not publicly disclosed–2021", role: "Chief Executive Officer", organization: "NJ Asset Management" },
      { period: "2011–2020", role: "Deputy CEO and Head of Investments", organization: "BNP Paribas Asset Management" },
      { period: "2008–2011", role: "Head of Equities", organization: "Canara Robeco Asset Management" },
      { period: "Not publicly disclosed", role: "Co-Head – Equities", organization: "ICICI Prudential Asset Management Company" },
      { period: "2000–2006", role: "Vice President – Investments", organization: "Kotak Mutual Fund" }
    ],
    sources: [
      { label: "ICICI Prudential PMS — strategy presentation (fund manager page)", url: "https://ivprodstorage.blob.core.windows.net/documents/icici_pru_pms_ace_strategy_presentation_march_1779168419802.pdf" },
      { label: "PMS Bazaar — Anand Shah fund manager profile", url: "https://my.pmsbazaar.com/FundManager/ICICI-Prudential-AMC-Ltd/Anand-Shah" },
      { label: "Economic Times — appointment as Head of PMS and AIF Investments (Feb 2021)", url: "https://m.economictimes.com/markets/stocks/news/icici-prudential-amc-appoints-anand-shah-as-head-of-pms-and-aif-investments/amp_articleshow/80749391.cms" },
      { label: "Zee Business — interview on IT sector and valuations", url: "https://www.zeebiz.com/companies/news-it-sectors-real-growth-a-few-quarters-away-valuation-risk-in-select-mid-and-small-cap-stocks-says-anand-shah-icici-prudential-amc-stock-market-today-general-elections-nifty-sensex-bse-nse-283581" }
    ],
  },
  {
    id: "sachin-shah",
    name: "Sachin Shah",
    aliases: ["Sachin Shah"],
    firm: "Emkay Investment Managers Ltd",
    current_title: "Executive Director and Fund Manager, Emkay Investment Managers",
    education: "Not publicly disclosed",
    years_experience: 20,
    bio_summary: "Sachin Shah is Executive Director and Fund Manager at Emkay Investment Managers Ltd, where he has managed the Emkay Capital Builder PMS strategy for over a decade. He has more than two decades of experience in Indian equity markets and created E-QUAL, the firm's proprietary governance assessment framework. In a 2023 interview he stated the strategy had compounded at 14.4% CAGR over ten years with portfolio turnover under 20%.",
    investment_philosophy: "Shah describes his approach as built on the 'power of compounding': owning quality businesses for long holding periods, assessing companies primarily on management quality and capital efficiency, and holding that avoiding mistakes matters more than chasing quick gains.",
    career_history: [
      { period: "Not publicly disclosed–present", role: "Executive Director and Fund Manager", organization: "Emkay Investment Managers Ltd" }
    ],
    sources: [
      { label: "Economic Times — ETMarkets PMS Talk interview (May 2023)", url: "https://m.economictimes.com/markets/expert-view/etmarkets-pms-talk-power-of-compounding-rs-50-lakh-invested-in-this-fund-could-have-turned-into-rs-2-cr-in-10-years-sachin-shah/amp_articleshow/100397127.cms" },
      { label: "Economic Times — The Golden Thumb Rule interview", url: "https://m.economictimes.com/markets/expert-view/the-golden-thumb-rule-how-emkays-sachin-shah-identifies-long-term-compounders/amp_articleshow/126352666.cms" },
      { label: "Moneycontrol — Daily Voice on manufacturing (2023)", url: "https://www.moneycontrol.com/news/business/markets/daily-voice-what-makes-this-fund-manager-bullish-on-indian-manufacturing-sector-11152271.html" }
    ],
  },
  {
    id: "amit-jeswani",
    name: "Amit Jeswani",
    aliases: ["Mr. Amit Jeswani"],
    firm: "Stallion Asset Private Ltd",
    current_title: "Founder and CIO, Stallion Asset",
    education: "BBA (Finance), Kingston University, London; CFA charterholder; CMT charterholder",
    years_experience: 14,
    bio_summary: "Amit Jeswani is the Founder and Chief Investment Officer of Stallion Asset, which he founded in 2013. He holds both CFA and CMT charters and has over 14 years of experience in Indian capital markets, having started investing at age 16 alongside his stock-broker father. Before founding Stallion Asset he worked as an equity research associate at Guggenheim Partners.",
    investment_philosophy: "His stated approach focuses on identifying long-term market leaders — high-growth, consumer-facing businesses with earnings growth potential of around 20% over one to three years — through a multicap portfolio benchmarked to the S&P BSE 500 TRI.",
    career_history: [
      { period: "2013–present", role: "Founder and Chief Investment Officer", organization: "Stallion Asset" },
      { period: "2010–2012", role: "Equity Research Associate", organization: "Guggenheim Partners" }
    ],
    sources: [
      { label: "Altport — Amit Jeswani fund manager profile", url: "https://www.altportfunds.com/fund-managers/amit-jeswani/" },
      { label: "PMS AIF World — Amit Jeswani team profile", url: "https://www.pmsaifworld.com/team_mf/amit-jeswani/" },
      { label: "Stallion Asset — PMS presentation (Jul 2025)", url: "https://www.stallionasset.com/regulatory/Stallion_Asset_PMS_Presentation_July_2025.pdf" },
      { label: "Moneycontrol — mutual fund launch plans (Oct 2026)", url: "https://www.moneycontrol.com/news/business/markets/amit-jeswani-s-stallion-asset-eyeing-mutual-fund-launch-within-next-year-and-half-14042063.html" }
    ],
  },
  {
    id: "nishant-vass",
    name: "Nishant Vass",
    aliases: ["Nishant Vass"],
    firm: "360 ONE Asset Management",
    current_title: "Executive Vice President and Fund Manager, Listed Equity, 360 ONE Asset",
    education: "MBA (Finance), IBS Hyderabad; B.E. (Electronics), College of Technology, Pantnagar",
    years_experience: 14,
    bio_summary: "Nishant Vass is Executive Vice President and Fund Manager for Listed Equity at 360 ONE Asset (formerly IIFL Asset Management), where he manages the Multicap PMS and Phoenix PMS strategies. He has around 14 years of experience in public equities. Before joining 360 ONE Asset, he spent over a decade with ICICI Securities' institutional equities team, where he headed the automotive sector research practice.",
    investment_philosophy: null,
    career_history: [
      { period: "Not publicly disclosed–present", role: "Executive Vice President and Fund Manager, Listed Equity", organization: "360 ONE Asset Management (formerly IIFL Asset Management)" },
      { period: "Not publicly disclosed", role: "Institutional Equities — headed automotive sector research practice", organization: "ICICI Securities Ltd" }
    ],
    sources: [
      { label: "PMS AIF World — interview with Nishant Vass", url: "https://www.pmsaifworld.com/qna/360-one-interview-with-nishant-vass-evp-fund-manager-listed-equity/" },
      { label: "360 ONE Asset — public equity team webinar slides (Jul 2025)", url: "https://herefordfunds.com/library/document/360-one-webinar-slides---july-2025.pdf" },
      { label: "Finec — 360 ONE PMS review", url: "https://finec.in/portfolio-management/360-one-pms/" }
    ],
  },
];

