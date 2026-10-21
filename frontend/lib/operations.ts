// Operations page: the jobs people actually do, mapped onto the official forms catalogue (no forms are invented here).
import type { OfficialForm } from "./officialForms";

export interface Job {
  id: string;
  title: string;
  desc: string;
  icon: string;
  pick: string; // why the first form is the marked pick
  match: (f: OfficialForm) => boolean;
}

const inCat = (...cats: string[]) => (f: OfficialForm) => cats.includes(f.category);

export const JOBS: Job[] = [
  { id: "sip", icon: "M3 17l6-6 4 4 8-8M15 7h6v6", title: "New Purchase / SIP", desc: "Start a SIP, STP or a one-time purchase for a client.",
    pick: "One RTA form covers every AMC that RTA services; use a fund-house form only if the RTA rejects it.", match: inCat("SIP / STP / SWP", "Transactions") },
  { id: "bank", icon: "M3 21h18M4 18h16M6 18v-7M10 18v-7M14 18v-7M18 18v-7M2 11l10-6 10 6z", title: "Bank & NACH Change", desc: "Change the registered bank account or set up a new NACH mandate.",
    pick: "The RTA common form works for most AMCs it services. Use an AMC-specific form only if the RTA rejects it.", match: inCat("Bank mandate & payments") },
  { id: "nom", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5a3.5 3.5 0 0 1 0 7M21 20c0-2.8-1.9-4.7-4.5-5.3", title: "Nomination", desc: "Add, change or opt out of nomination on a folio.",
    pick: "One form per folio, not per AMC.", match: inCat("Nomination") },
  { id: "trans", icon: "M12 20.5C7 16.5 3.5 13.2 3.5 9.3 3.5 6.4 5.7 4.5 8.2 4.5c1.5 0 3 .8 3.8 2 .8-1.2 2.3-2 3.8-2 2.5 0 4.7 1.9 4.7 4.8 0 3.9-3.5 7.2-8.5 11.2z", title: "Transmission (Death Claim)", desc: "Transfer folios to the nominee or legal heir after a holder's death.",
    pick: "A transmission often spans CAMS and KFintech folios of the same household, so both RTAs are listed.", match: inCat("Transmission & incapacitation") },
  { id: "kyc", icon: "M12 3l7 2.5v5.5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V5.5zM9 12l2 2 4-4", title: "KYC & FATCA", desc: "Fix KYC status, re-KYC, or file FATCA / CRS declarations.",
    pick: "The RTA common declaration covers all that RTA's AMCs in one filing.", match: inCat("KYC & compliance") },
  { id: "contact", icon: "M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z", title: "Contact / Folio Update", desc: "Update mobile, email, address, or consolidate folios.",
    pick: "The RTA contact-update form changes mobile & email across that RTA's AMCs at once.", match: inCat("Contact & folio updates") },
  { id: "pms", icon: "M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18", title: "PMS Onboarding (Stallion)", desc: "Open a Stallion PMS account: agreement, risk profiler, suitability.",
    pick: "Suitability must be recorded before the account opening form is signed.", match: (f) => f.source === "Stallion" },
  { id: "dist", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.36.95a7 7 0 0 0-2.42-1.4L13.7 2.6h-3.4l-.38 2.54a7 7 0 0 0-2.42 1.4l-2.36-.95-2 3.46 2 1.55a7 7 0 0 0 0 2.8l-2 1.55 2 3.46 2.36-.95a7 7 0 0 0 2.42 1.4l.38 2.54h3.4l.38-2.54a7 7 0 0 0 2.42-1.4l2.36.95 2-3.46-2-1.55c.1-.45.14-.92.14-1.4z", title: "Distributor — Internal", desc: "ARN, empanelment and internal compliance forms. Staff only.",
    pick: "Internal forms are grouped here so they never clutter a client task.", match: inCat("Distributor") },
];

// Guides, web pages and the KFintech Shares business live apart from mutual-fund client work.
const REF_CATS = new Set(["Guides & circulars", "Forms page", "Corporate registry (shares)", "Tax & TDS (shares)", "Statements & other"]);
export const isReference = (f: OfficialForm) => f.kind === "Page" || REF_CATS.has(f.category);

const RANK: Record<string, number> = { CAMS: 0, KFintech: 1, Stallion: 0, AMC: 2 };
/** Forms for a job, filled PDFs only: CAMS first (the marked pick), then KFintech, then fund houses. */
export function jobForms(job: Job, forms: OfficialForm[]): OfficialForm[] {
  return forms.filter((f) => f.kind === "PDF" && !isReference(f) && job.match(f)).sort((a, b) => RANK[a.source] - RANK[b.source] || a.title.localeCompare(b.title));
}

export const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
