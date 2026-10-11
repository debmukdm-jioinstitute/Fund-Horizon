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
