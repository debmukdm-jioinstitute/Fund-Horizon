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

export interface Placed { word: string; cells: [number, number][] }
export interface Puzzle { id: number; size: number; grid: string[][]; words: Placed[] }

function rng(seed: number) {
  let a = (seed + 1) * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE = 10;
const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1]]; // right, down, diagonal: kept basic for mobile

// Word search: hide WORDS_PER_PUZZLE words in a 10x10 grid, fill the rest with seeded random letters.
export function buildPuzzle(id: number): Puzzle {
  const rand = rng(id);
  const pool = WORDS.map(([w]) => w).filter((w) => w.length <= SIZE).map((w) => ({ w, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.w);
  const grid: string[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(""));
  const words: Placed[] = [];
  for (const w of pool) {
    if (words.length >= WORDS_PER_PUZZLE) break;
    for (let t = 0; t < 60; t++) {
      const [dr, dc] = DIRS[Math.floor(rand() * DIRS.length)];
      const r = Math.floor(rand() * SIZE), c = Math.floor(rand() * SIZE);
      const er = r + dr * (w.length - 1), ec = c + dc * (w.length - 1);
      if (er >= SIZE || ec >= SIZE) continue;
      const cells = Array.from({ length: w.length }, (_, i) => [r + dr * i, c + dc * i] as [number, number]);
      if (cells.some(([rr, cc], i) => grid[rr][cc] && grid[rr][cc] !== w[i])) continue;
      cells.forEach(([rr, cc], i) => (grid[rr][cc] = w[i]));
      words.push({ word: w, cells });
      break;
    }
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!grid[r][c]) grid[r][c] = letters[Math.floor(rand() * 26)];
  return { id, size: SIZE, grid, words };
}
