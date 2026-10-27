/** Display-only fund/AMC name normalisation. Never applied to stored names, search matching, or scheme codes. */

const ACRONYMS = new Set([
  "HDFC", "ICICI", "ABSL", "SBI", "UTI", "HSBC", "DSP", "IDFC", "LIC", "IIFL", "PPFAS",
  "JM", "BNP", "PGIM", "ETF", "NFO", "AMC", "MF", "IDCW", "SIP", "STP", "SWP", "ELSS",
  "NSE", "BSE", "SEBI", "AMFI", "RBI", "PSU", "MNC", "FOF",
]);

const SMALL_WORDS = new Set(["and", "of", "for", "the", "a", "an", "in", "on", "to", "with"]);

function fixWord(raw: string, first: boolean): string {
  const m = raw.match(/^([^A-Za-z0-9]*)([A-Za-z0-9]+)(.*)$/);
  if (!m) return raw;
  const [, pre, core, rest] = m;
  const upper = core.toUpperCase();
  if (ACRONYMS.has(upper)) return `${pre}${upper}${rest}`;
  if (/^\d+$/.test(core)) return raw;
  const lowered = core.toLowerCase();
  // Mixed-case anomalies such as "FranklIn" or "CapitalMInD" collapse to a single title-cased word.
  if (!first && SMALL_WORDS.has(lowered)) return `${pre}${lowered}${rest}`;
  return `${pre}${lowered.charAt(0).toUpperCase()}${lowered.slice(1)}${rest}`;
}

/** Title-case a display name, keeping genuine acronyms upper-case. Input is never mutated elsewhere. */
export function normalizeDisplayName(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => fixWord(w, i === 0))
    .join(" ");
}

/** Short display name: the screener's existing " - Direct/Regular Plan - Growth" strip, then normalisation. */
export function shortDisplayName(name: string | null | undefined): string {
  if (!name) return "—";
  return normalizeDisplayName(name.replace(/ - (Direct|Regular) Plan - Growth$/i, ""));
}
