// Staff & permissions: the role and page universe, kept in one place so the
// dedicated staff page, the Add staff wizard and the detail view can never
// drift apart. The hrefs below are exactly the backend's BACKOFFICE_PAGES
// (validated with a 422 on anything else) — never add a href here that the
// backend does not know, and never drop one: the four groups total 14 pages.

export interface RoleMeta {
  value: string;
  label: string;
  description: string;
}

export const ROLE_META: RoleMeta[] = [
  { value: "admin", label: "Administrator", description: "Admins have access to all pages." },
  { value: "analyst", label: "Analyst", description: "Research and terminal access." },
  { value: "rm", label: "Relationship Manager", description: "Client Portfolios" },
  { value: "operations", label: "Operations", description: "Data Management" },
  { value: "compliance", label: "Compliance", description: "Audit & Oversight" },
  { value: "read_only", label: "Read-only", description: "Academy / viewing" },
];

export const roleLabel = (role: string): string =>
  ROLE_META.find((r) => r.value === role)?.label ?? role;

export const roleDescription = (role: string): string =>
  ROLE_META.find((r) => r.value === role)?.description ?? "";

export interface PageOption {
  href: string;
  label: string;
}

export interface PageGroup {
  key: string;
  label: string;
  pages: PageOption[];
}

export const PAGE_GROUPS: PageGroup[] = [
  {
    key: "research",
    label: "Research & markets",
    pages: [
      { href: "/backoffice", label: "Overview" },
      { href: "/backoffice/pms", label: "PMS tracker" },
      { href: "/backoffice/mutual-funds", label: "Mutual funds" },
      { href: "/backoffice/macro", label: "Macro & yields" },
      { href: "/backoffice/derivatives", label: "Derivatives & PCR" },
      { href: "/backoffice/flows", label: "Institutional flows" },
      { href: "/backoffice/research", label: "Briefings" },
    ],
  },
  {
    key: "client",
    label: "Client management",
    pages: [
      { href: "/backoffice/crm", label: "CRM" },
      { href: "/backoffice/risk-profiling", label: "Risk profiling" },
    ],
  },
  {
    key: "operations",
    label: "Operations & system",
    pages: [
      { href: "/backoffice/operations", label: "Operations" },
      { href: "/backoffice/data-health", label: "Data health" },
      { href: "/backoffice/settings", label: "Settings" },
    ],
  },
  {
    key: "learning",
    label: "Learning",
    pages: [{ href: "/backoffice/learn", label: "Academy" }],
  },
];

export const ALL_PAGE_HREFS: string[] = PAGE_GROUPS.flatMap((g) => g.pages.map((p) => p.href));

export const pageLabel = (href: string): string => {
  for (const g of PAGE_GROUPS) {
    const found = g.pages.find((p) => p.href === href);
    if (found) return found.label;
  }
  return href;
};

/** Backend semantics: admins are unrestricted, and an empty pages list is also unrestricted. */
export const hasAllPages = (role: string, pages: string[] | undefined): boolean =>
  role === "admin" || !pages?.length;

/** Deterministic pastel avatar background from a name — no images, no invented photos. */
const PASTELS = [
  "#E8E4F8", "#E3F0FB", "#E0F2EC", "#FFF1D6", "#FDE8E8", "#EAF5FE", "#F3E8FD", "#E6F4EA",
];

export const avatarTone = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PASTELS[h % PASTELS.length];
};

export const initialsOf = (name: string): string => {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** A mobile the user actually typed: 10 digits starting 6–9 (an optional +91 prefix is stripped first). */
export const normaliseMobile = (raw: string): string | null => {
  const digits = raw.replace(/[\s-]/g, "").replace(/^\+91/, "");
  if (!digits) return "";
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};
