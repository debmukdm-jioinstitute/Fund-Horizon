/** Public web origin for sitemap, robots, and Open Graph. */
export const DEFAULT_SITE_URL = "https://fundhorizon.up.railway.app";

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  return raw.replace(/\/$/, "");
}
