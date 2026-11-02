export const MARKET_HOME = "/backoffice/markets";
export const TERMINAL_HOME = "/backoffice";

export const MARKET_SECTIONS: { slug: string; href: string; label: string }[] = [
  { slug: "", href: MARKET_HOME, label: "Overview" },
  { slug: "indices", href: `${MARKET_HOME}/indices`, label: "Indices" },
  { slug: "trend", href: `${MARKET_HOME}/trend`, label: "Trend" },
  { slug: "markets", href: `${MARKET_HOME}/markets`, label: "Breadth" },
  { slug: "valuation", href: `${MARKET_HOME}/valuation`, label: "Valuation" },
  { slug: "activity", href: `${MARKET_HOME}/activity`, label: "Turnover" },
  { slug: "flows", href: `${MARKET_HOME}/flows`, label: "Flows" },
  { slug: "funds", href: `${MARKET_HOME}/funds`, label: "Funds" },
  { slug: "economy", href: `${MARKET_HOME}/economy`, label: "Economy" },
  { slug: "global", href: `${MARKET_HOME}/global`, label: "Global" },
  { slug: "models", href: `${MARKET_HOME}/models`, label: "Models" },
];

export function deskSegments(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

export function parentHref(path: string, onOverview: boolean): string | null {
  if (onOverview) return null;
  const segs = deskSegments(path);
  if (segs.length === 0) return TERMINAL_HOME;
  const parent = segs.slice(0, -1).join("/");
  return parent ? `${MARKET_HOME}/${parent}` : MARKET_HOME;
}

export function homeHref(path: string, onOverview: boolean): string {
  if (onOverview) return MARKET_HOME;
  return deskSegments(path).length === 0 ? TERMINAL_HOME : MARKET_HOME;
}

export function sectionIndex(path: string): number {
  const segs = deskSegments(path);
  if (segs.length === 0) return 0;
  return MARKET_SECTIONS.findIndex((s) => s.slug === segs[0]);
}
