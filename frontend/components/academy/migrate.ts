import { academy, type Me } from "./api";

/** One-time move of the old browser-only progress (`learn.<track>.known|best`) to the server, then clear it. */
export async function migrateLegacyProgress(me: Me): Promise<boolean> {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith("learn."));
  } catch {
    return false;
  }
  if (!keys.length) return false;
  const clear = () => keys.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  if (me.migrated) { clear(); return false; }

  const lib = await import("ts-fsrs");
  const f = lib.fsrs(lib.generatorParameters({ enable_fuzz: true }));
  const cards: { card_id: string; fsrs: unknown; due: string }[] = [];
  const best: Record<string, { score: number; total: number }> = {};
  for (const k of keys) {
    const m = /^learn\.(\w+)\.(known|best)$/.exec(k);
    if (!m) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      if (m[2] === "known" && Array.isArray(v)) {
        for (const n of v.filter((x) => Number.isInteger(x)).slice(0, 150)) {
          const next = f.repeat(lib.createEmptyCard(new Date()), new Date())[3].card;
          cards.push({ card_id: `${m[1]}-c${n}`, fsrs: JSON.parse(JSON.stringify(next)), due: next.due.toISOString() });
        }
      } else if (m[2] === "best" && Number.isInteger(v) && v >= 0 && v <= 30) best[`${m[1]}-final`] = { score: v, total: 30 };
    } catch { /* skip a corrupt key */ }
  }
  const res = await academy.migrate({ cards: cards.slice(0, 300), best });
  if (res.migrated || me.migrated) clear();
  return res.migrated;
}
