export interface SourceDef {
  name: string;
  url: string;
}

export const SOURCES = {
  amfi: { name: "AMFI", url: "https://www.amfiindia.com" },
  apmi: { name: "APMI", url: "https://www.apmiindia.org" },
  nse: { name: "NSE", url: "https://www.nseindia.com" },
  fbil: { name: "FBIL", url: "https://www.fbil.org.in" },
  fred: { name: "FRED", url: "https://fred.stlouisfed.org" },
  ecb: { name: "ECB", url: "https://data.ecb.europa.eu" },
  cboe: { name: "Cboe", url: "https://www.cboe.com" },
  mfapi: { name: "MFAPI", url: "https://www.mfapi.in" },
  advisorkhoj: { name: "AdvisorKhoj", url: "https://www.advisorkhoj.com" },
  treasury: { name: "US Treasury", url: "https://home.treasury.gov" },
  derived: { name: "FundHorizon calc", url: "" },
} as const;

export type SourceKey = keyof typeof SOURCES;
