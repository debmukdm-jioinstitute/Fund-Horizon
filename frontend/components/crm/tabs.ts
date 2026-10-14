// CRM tab ids live in the URL (?tab=leads). Shared by the CRM page and the record pages' breadcrumbs.
export const CRM_TABS = [
  ["home", "Home"],
  ["households", "Households"],
  ["contacts", "Contacts"],
  ["leads", "Leads"],
  ["opportunities", "Opportunities"],
  ["activities", "Tasks"],
  ["cases", "Grievances"],
  ["book", "Book"],
  ["compliance", "Compliance"],
  ["import", "Import"],
] as const;

export type CrmTabId = (typeof CRM_TABS)[number][0];

/** Names the Home cards use for their jump links, mapped to real tab ids. */
const TAB_ALIASES: Record<string, CrmTabId> = {
  "crm-home": "home",
  pipeline: "opportunities",
  pipelines: "opportunities",
  renewals: "activities",
  maturities: "activities",
};

export function resolveTab(raw: string | null | undefined): CrmTabId {
  const id = TAB_ALIASES[raw ?? ""] ?? raw;
  return CRM_TABS.some(([t]) => t === id) ? (id as CrmTabId) : "home";
}

export const tabHref = (id: string): string => `/backoffice/crm?tab=${resolveTab(id)}`;
