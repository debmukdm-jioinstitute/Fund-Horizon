// Basic financial-literacy crosswords. 20 fixed puzzles, built deterministically from a seed (puzzle id).

export const PUZZLE_COUNT = 20;
export const WORDS_PER_PUZZLE = 7;

const WORDS: [string, string][] = [
  ["SIP", "Fixed amount invested every month in a mutual fund"],
  ["NAV", "Price of one unit of a mutual fund"],
  ["EMI", "Fixed monthly loan repayment"],
  ["TAX", "Money paid to the government on income"],
  ["BOND", "Loan you give to a government or company for interest"],
  ["LOAN", "Money borrowed that must be repaid"],
  ["CASH", "Money in notes and coins"],
  ["FUND", "Pool of money collected from many investors"],
  ["RISK", "Chance that an investment loses value"],
  ["LOSS", "Opposite of profit"],
  ["DEBT", "Money you owe to someone"],
  ["GOLD", "Yellow metal often bought as a safe investment"],
  ["RUPEE", "Currency of India"],
  ["STOCK", "A small ownership piece of a company"],
  ["SHARE", "One unit of ownership in a company"],
  ["EQUITY", "Ownership in a company"],
  ["BROKER", "Agent who buys and sells shares for you"],
  ["MARKET", "Place where shares are traded"],
  ["PROFIT", "Money left after costs are paid"],
  ["INCOME", "Money you earn from work or business"],
  ["ASSET", "Something you own that has value"],
  ["BUDGET", "Plan for your income and spending"],
  ["SAVING", "Setting aside money for later"],
  ["CREDIT", "Borrowing power or money added to an account"],
  ["DEPOSIT", "Money you put into a bank account"],
  ["ACCOUNT", "Place at a bank where your money is kept"],
  ["PENSION", "Regular income after retirement"],
  ["PREMIUM", "Amount you pay for an insurance policy"],
  ["NOMINEE", "Person who receives your money if you pass away"],
  ["DEMAT", "Account that holds shares in electronic form"],
  ["INTEREST", "Extra money earned on a deposit or paid on a loan"],
  ["DIVIDEND", "Share of company profit paid to shareholders"],
  ["INFLATION", "General rise in prices over time"],
  ["INSURANCE", "Cover that protects against financial loss"],
  ["PORTFOLIO", "Your collection of investments"],
  ["COMPOUND", "Interest earned on interest"],
  ["PRINCIPAL", "Original amount invested or borrowed"],
  ["MATURITY", "Date when a deposit or bond is repaid"],
  ["EXPENSE", "Money you spend"],
  ["INVEST", "Put money to work to grow over time"],
  ["WEALTH", "Total value of what you own"],
  ["LIQUID", "Easy to convert into cash quickly"],
  ["REFUND", "Money paid back to you"],
  ["CHEQUE", "Paper order to pay money from your bank"],
  ["NIFTY", "Popular index of 50 large Indian companies"],
  ["SENSEX", "BSE index of 30 large Indian companies"],
  ["RETURN", "Gain or loss made on an investment"],
  ["DISCOUNT", "Reduction from the usual price"],
  ["FRAUD", "Cheating someone out of their money"],
  ["PIN", "Secret number used with a debit card"],
];

export type Dir = "A" | "D";
export interface Entry { id: number; num: number; word: string; clue: string; dir: Dir; r: number; c: number }
export interface Puzzle { id: number; rows: number; cols: number; cells: (string | null)[][]; numbers: Record<string, number>; entries: Entry[] }

function rng(seed: number) {
  let a = (seed + 1) * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 15;
type Placed = { word: string; clue: string; dir: Dir; r: number; c: number };

function fits(g: string[][], w: string, dir: Dir, r: number, c: number): boolean {
  const dr = dir === "D" ? 1 : 0, dc = dir === "A" ? 1 : 0;
  const er = r + dr * w.length, ec = c + dc * w.length;
  if (r < 0 || c < 0 || (dir === "D" ? er > N || c >= N : ec > N || r >= N)) return false;
  if ((r - dr >= 0 && c - dc >= 0 && g[r - dr][c - dc]) || (er < N && ec < N && g[er][ec])) return false;
  let cross = 0;
  for (let i = 0; i < w.length; i++) {
    const rr = r + dr * i, cc = c + dc * i, cur = g[rr][cc];
    if (cur) {
      if (cur !== w[i]) return false;
      cross++;
    } else {
      const a = rr + dc, b = cc + dr, x = rr - dc, y = cc - dr; // perpendicular neighbours must be empty
      if ((a < N && b < N && g[a][b]) || (x >= 0 && y >= 0 && g[x][y])) return false;
    }
  }
  return cross === 1;
}

export function buildPuzzle(id: number): Puzzle {
  const rand = rng(id);
  const pool = WORDS.map((w) => ({ w, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.w);
  const g: string[][] = Array.from({ length: N }, () => Array(N).fill(""));
  const placed: Placed[] = [];
  const put = (w: string, clue: string, dir: Dir, r: number, c: number) => {
    for (let i = 0; i < w.length; i++) g[dir === "D" ? r + i : r][dir === "A" ? c + i : c] = w[i];
    placed.push({ word: w, clue, dir, r, c });
  };
  // seed with the longest of the first few words so the grid has a spine
  const first = pool.slice(0, 4).sort((a, b) => b[0].length - a[0].length)[0];
  put(first[0], first[1], "A", 7, Math.floor((N - first[0].length) / 2));
  for (const [w, clue] of pool) {
    if (placed.length >= WORDS_PER_PUZZLE) break;
    if (placed.some((p) => p.word === w)) continue;
    const opts: [Dir, number, number][] = [];
    const want: Dir = placed[placed.length - 1].dir === "A" ? "D" : "A";
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (fits(g, w, want, r, c)) opts.push([want, r, c]);
    if (!opts.length) continue;
    const [d, r, c] = opts[Math.floor(rand() * opts.length)];
    put(w, clue, d, r, c);
  }
  const r0 = Math.min(...placed.map((p) => p.r)), c0 = Math.min(...placed.map((p) => p.c));
  const r1 = Math.max(...placed.map((p) => p.r + (p.dir === "D" ? p.word.length : 1)));
  const c1 = Math.max(...placed.map((p) => p.c + (p.dir === "A" ? p.word.length : 1)));
  const rows = r1 - r0, cols = c1 - c0;
  const cells: (string | null)[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => g[r + r0][c + c0] || null));
  const starts = placed.map((p) => ({ ...p, r: p.r - r0, c: p.c - c0 }));
  const numbers: Record<string, number> = {};
  [...starts].sort((a, b) => a.r - b.r || a.c - b.c).forEach((p) => {
    const k = `${p.r},${p.c}`;
    if (!numbers[k]) numbers[k] = Object.keys(numbers).length + 1;
  });
  const entries = starts
    .map((p, i) => ({ id: i, num: numbers[`${p.r},${p.c}`], ...p }))
    .sort((a, b) => a.num - b.num);
  return { id, rows, cols, cells, numbers, entries };
}

export function cellsOf(e: Entry): [number, number][] {
  return Array.from({ length: e.word.length }, (_, i) => (e.dir === "D" ? [e.r + i, e.c] : [e.r, e.c + i]));
}
