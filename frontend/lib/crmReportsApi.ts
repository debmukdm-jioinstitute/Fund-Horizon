// Phase 4 dashboard payload. Every widget carries `link` = the CRM tab + list filters that reproduce its number.
import { crmRaw } from "./crmApi";

export interface WidgetLink {
  tab: string;
  params: Record<string, string>;
}

export interface Dashboard {
  as_of: string;
  aum_by_tier: { tier: string; households: number; aum_paise: number; count: number; link: WidgetLink }[];
  aum_total_paise: number;
  sip_book: { count: number; monthly_paise: number; link: WidgetLink };
  pipeline_by_stage: { stage: string; count: number; value: number; link: WidgetLink }[];
  pipeline_by_rm: { rm_id: string | null; rm_name: string; count: number; value: number; link: WidgetLink | null }[];
  pipeline_open: { count: number; value: number };
  won_this_month: { count: number; value: number; link: WidgetLink };
  overdue_tasks: { count: number; link: WidgetLink };
  sla_breaching: { count: number; link: WidgetLink };
  gaps: { count: number; by_kind: Record<string, number>; link: WidgetLink };
  renewals: { count: number; days: number; link: WidgetLink };
  maturities: { count: number; days: number; link: WidgetLink };
  top_trail: { month: string | null; rows: { household_id: string; household_name: string | null; amount_paise: number }[]; link: WidgetLink };
}

export const fetchReportsDashboard = () => crmRaw<Dashboard>("/reports/dashboard");

/** CRM URL for a widget link. Opportunities open as a table so the filtered rows are what the number counts. */
export function linkHref(link: WidgetLink): string {
  const q = new URLSearchParams({ tab: link.tab, ...link.params });
  if (link.tab === "opportunities") q.set("view", "table");
  return `/backoffice/crm?${q}`;
}
