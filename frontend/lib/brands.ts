// Original brand logos (insurers and fund houses), stored in /public/brands.
// Logos belong to their owners and are shown only to identify the company.
const INSURERS: Record<string, string> = {
  "axis max life": "axis-max-life.png",
  "hdfc life": "hdfc-life.png",
  "tata aia": "tata-aia.png",
  "icici prudential": "icici-prudential.png",
  "aditya birla health": "aditya-birla-health.png",
  "care health": "care-health.png",
  "hdfc ergo": "hdfc-ergo.png",
  "niva bupa": "niva-bupa.png",
};

const AMCS: Record<string, string> = {
  abakkus: "abakkus.png",
  alphagrep: "alphagrep.png",
  ask: "ask.svg",
  capitalmind: "capitalmind.png",
  choice: "choice.png",
  "jm financial": "jm-financial.png",
  lakshya: "lakshya.png",
  "motilal oswal": "motilal-oswal.png",
  nj: "nj.png",
  "the wealth company": "the-wealth-company.png",
  "aditya birla sun life": "aditya-birla-sun-life.png",
  "bank of india": "bank-of-india.png",
  "franklin templeton": "franklin-templeton.png",
  navi: "navi.svg",
  sbi: "sbi.svg",
  shriram: "shriram.webp",
  sundaram: "sundaram.svg",
  tata: "tata.svg",
  trust: "trust.svg",
  unifi: "unifi.svg",
  uti: "uti.webp",
  "360 one": "360-one.png",
  axis: "axis.png",
  bandhan: "bandhan.png",
  "baroda bnp paribas": "baroda-bnp-paribas.png",
  "bajaj finserv": "bajaj-finserv.png",
  "angel one": "angel-one.png",
  "canara robeco": "canara-robeco.png",
  dsp: "dsp.png",
  edelweiss: "edelweiss.png",
  groww: "groww.png",
  hdfc: "hdfc.svg",
  helios: "helios.png",
  hsbc: "hsbc.png",
  "icici prudential": "icici-prudential-amc.svg",
  invesco: "invesco.png",
  iti: "iti.png",
  "jio blackrock": "jio-blackrock.png",
  kotak: "kotak.png",
  "kotak mahindra": "kotak.png",
  lic: "lic.png",
  "mahindra manulife": "mahindra-manulife.png",
  "mirae asset": "mirae-asset.png",
  "nippon india": "nippon-india.png",
  "old bridge": "old-bridge.png",
  "pgim india": "pgim-india.png",
  ppfas: "ppfas.png",
  quant: "quant.png",
  quantum: "quantum.png",
  samco: "samco.png",
  taurus: "taurus.png",
  union: "union.png",
  whiteoak: "whiteoak.png",
  "whiteoak capital": "whiteoak.png",
  zerodha: "zerodha.png",
};

function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/mutual\s*fund/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function insurerLogoSrc(name: string): string | null {
  const n = norm(name);
  const hit = INSURERS[n] ?? Object.entries(INSURERS).find(([k]) => n.includes(k) || k.includes(n))?.[1];
  return hit ? `/brands/${hit}` : null;
}

export function amcLogoSrc(name: string): string | null {
  const hit = AMCS[norm(name)];
  return hit ? `/brands/${hit}` : null;
}

// PMS firms. Many are the PMS arm of a fund house (reuse that fund house's logo); the rest have their own file
// in /public/brands/pms. Keys are matched as whole words inside the normalised firm name.
const PMS_OWN: Record<string, string> = {
  alchemy: "alchemy.png", "amara capital": "amara.png", arihant: "arihant.png", bonanza: "bonanza.png",
  buoyant: "buoyant.png", equirus: "equirus.png", equitree: "equitree.png", iifl: "iifl.png", incred: "incred.png",
  "julius baer": "julius-baer.png", kamayakya: "kamayakya.png", nuvama: "nuvama.png", "piper serica": "piper-serica.png",
  prabhudas: "prabhudas-lilladher.png", renaissance: "renaissance.png", "right horizons": "right-horizons.png",
  sameeksha: "sameeksha.png", sanctum: "sanctum.png", sharekhan: "sharekhan.png", stallion: "stallion.png",
  valentis: "valentis.png", wallfort: "wallfort.png",
  agreya: "agreya.png", alfaccurate: "alfaccurate.png", "anand rathi": "anand-rathi.png", "banyan tree": "banyan-tree.png",
  barclays: "barclays.png", "dalal broacha": "dalal-broacha.png", "equity intelligence": "equity-intelligence.png",
  itus: "itus.png", lgt: "lgt.png", "neo asset": "neo.png",
};

// PMS firm names that differ from the fund house name we hold a logo under.
const PMS_ALIASES: Record<string, string> = {
  "nippon life india": "nippon india", "j m financial": "jm financial", "hongkong and shanghai banking": "hsbc",
};

const hasWords = (name: string, key: string) => new RegExp(`(^| )${key}( |$)`).test(name);

export function normFirm(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(private|pvt|limited|ltd|llp|llc|inc|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pmsLogoSrc(name: string): string | null {
  const n = normFirm(name);
  const own = Object.entries(PMS_OWN).find(([k]) => hasWords(n, k));
  if (own) return `/brands/pms/${own[1]}`;
  const alias = Object.entries(PMS_ALIASES).find(([k]) => n.includes(k));
  const amc = alias
    ? ([alias[1], AMCS[alias[1]]] as [string, string])
    : Object.entries(AMCS)
        .sort((a, b) => b[0].length - a[0].length)
        .find(([k]) => hasWords(n, k));
  return amc ? `/brands/${amc[1]}` : null;
}
