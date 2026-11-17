"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EquityBasket, EquityHolding, EquityQuote, EquitySuggestion, createEquityBasket, deleteEquityBasket,
  getEquityBaskets, getEquityQuotes, saveEquityBasket, saveEquityHolding, searchEquities,
} from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

const LEGACY_KEY = "fh.equities.baskets.v1"; // pre-server storage; imported once then removed
const REFRESH_MS = 20_000;

const inr = (v?: number) => (v === undefined || v === null ? "—" : formatNumber(v, 2, { prefix: "₹" }));

function NumInput({ value, onSave, label }: { value: number | null; onSave: (v: number | null) => void; label: string }) {
  const [t, setT] = useState(value === null ? "" : String(value));
  useEffect(() => setT(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const v = t.trim() === "" ? null : Number(t);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return setT(value === null ? "" : String(value));
    if (v !== value) onSave(v);
  };
  return (
    <input inputMode="decimal" aria-label={label} value={t} onChange={(e) => setT(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm text-slate-900" />
  );
}

export default function EquitiesPage() {
  const [baskets, setBaskets] = useState<EquityBasket[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<EquitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, EquityQuote>>({});
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const names = useRef<Record<string, string>>({});

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "Request failed");

  // Baskets live in the server database. Any browser-only baskets from the old version are imported once.
  useEffect(() => {
    (async () => {
      try {
        let list = await getEquityBaskets();
        try {
          const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}");
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [name, v] of Object.entries(raw)) {
              if (!Array.isArray(v) || list.some((b) => b.name === name)) continue;
              const syms = v.filter((x): x is string => typeof x === "string").slice(0, 50);
              list = [...list, await createEquityBasket(name, syms)];
            }
          }
          localStorage.removeItem(LEGACY_KEY);
        } catch {}
        setBaskets(list);
        setActiveId(list[0]?.id ?? "");
      } catch (e) { fail(e); }
      setLoaded(true);
    })();
  }, []);

  // Typeahead (debounced).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSugg([]); return; }
    const ac = new AbortController();
    const t = setTimeout(() => {
      searchEquities(term, ac.signal).then((r) => { r.forEach((s) => (names.current[s.symbol] = s.name)); setSugg(r); }).catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q]);

  const basket = baskets.find((b) => b.id === activeId);
  const active = basket?.name ?? "";
  const symbols = useMemo(() => basket?.symbols ?? [], [basket]);
  const symKey = symbols.join(",");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!symKey) return;
    try {
      const rows = await getEquityQuotes(symKey.split(","), signal);
      setQuotes((p) => ({ ...p, ...Object.fromEntries(rows.map((r) => [r.symbol, r])) }));
      setUpdated(new Date());
      setErr(null);
    } catch (e) {
      if (!signal?.aborted) setErr(e instanceof Error ? e.message : "Quote fetch failed");
    }
  }, [symKey]);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    const id = setInterval(() => document.visibilityState === "visible" && refresh(ac.signal), REFRESH_MS);
    return () => { ac.abort(); clearInterval(id); };
  }, [refresh]);

  const createBasket = async () => {
    const n = newName.trim();
    if (!n) return;
    try {
      const b = await createEquityBasket(n);
      setBaskets((p) => [...p, b]); setActiveId(b.id); setNewName(""); setErr(null);
    } catch (e) { fail(e); }
  };
  const deleteBasket = async () => {
    if (!basket || !confirm(`Delete basket "${basket.name}"?`)) return;
    try {
      await deleteEquityBasket(basket.id);
      const rest = baskets.filter((b) => b.id !== basket.id);
      setBaskets(rest); setActiveId(rest[0]?.id ?? ""); setErr(null);
    } catch (e) { fail(e); }
  };
  const setSymbols = async (next: string[]) => {
    if (!basket) return;
    const prev = baskets;
    setBaskets(baskets.map((b) => (b.id === basket.id ? { ...b, symbols: next } : b)));
    try { await saveEquityBasket(basket.id, next); setErr(null); }
    catch (e) { setBaskets(prev); fail(e); }
  };
  const add = (s: EquitySuggestion) => {
    if (!basket || symbols.includes(s.symbol) || symbols.length >= 50) return;
    setSymbols([...symbols, s.symbol]);
    setQ(""); setSugg([]); setOpen(false);
  };
  const setHolding = async (sym: string, patch: Partial<EquityHolding>) => {
    if (!basket) return;
    const cur = basket.holdings[sym] ?? { qty: null, buy_price: null };
    const next = { ...cur, ...patch };
    const prev = baskets;
    setBaskets(baskets.map((b) => (b.id === basket.id ? { ...b, holdings: { ...b.holdings, [sym]: next } } : b)));
    try { await saveEquityHolding(basket.id, sym, next); setErr(null); }
    catch (e) { setBaskets(prev); fail(e); }
  };
  const remove = (sym: string) => setSymbols(symbols.filter((x) => x !== sym));

  const rows = symbols.map((s) => {
    const h = basket?.holdings[s], px = quotes[s]?.price;
    const invested = h?.qty != null && h.buy_price != null ? h.qty * h.buy_price : undefined;
    const value = h?.qty != null && px != null ? h.qty * px : undefined;
    return { s, h, invested, value, pnl: invested !== undefined && value !== undefined ? value - invested : undefined };
  });
  const sum = (k: "invested" | "value" | "pnl") => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const totInv = sum("invested"), totVal = sum("value"), totPnl = rows.reduce((a, r) => a + (r.invested !== undefined && r.value !== undefined ? r.pnl ?? 0 : 0), 0);
  const costBasisOfPriced = rows.reduce((a, r) => a + (r.pnl !== undefined ? r.invested ?? 0 : 0), 0);
  const tone = (v?: number) => (v === undefined ? "" : v >= 0 ? "text-emerald-600" : "text-red-600");
  const sgn = (v: number) => `${v >= 0 ? "+" : ""}${formatNumber(v, 2)}`;

  const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 w-full";
  const btn = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Equities</h1>
        <p className="text-sm text-slate-600">NSE stocks with live prices from Yahoo Finance. Build named baskets and track them.</p>
      </header>
      {err && !basket && <p className="text-sm text-red-600">{err}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={field} placeholder="New basket name (e.g. Banking leaders)" value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createBasket()} maxLength={60} />
          <button className={btn} onClick={createBasket} disabled={!newName.trim()}>Create basket</button>
        </div>
        {baskets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {baskets.map((b) => (
              <button key={b.id} onClick={() => setActiveId(b.id)}
                className={`rounded-full border px-3 py-1 text-sm ${b.id === activeId ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-700"}`}>
                {b.name} <span className="opacity-70">({b.symbols.length})</span>
              </button>
            ))}
            <button onClick={deleteBasket} className="ml-auto text-sm text-red-600">Delete basket</button>
          </div>
        )}
      </section>

      {basket ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 150)}>
            <input className={field} placeholder={`Add NSE stock to "${active}" — type name or symbol`} value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
            {open && sugg.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {sugg.map((s) => (
                  <li key={s.symbol}>
                    <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => add(s)}>
                      <span className="font-semibold text-slate-900">{s.symbol}</span>
                      <span className="truncate text-slate-600">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
          {symbols.length === 0 ? (
            <p className="text-sm text-slate-500">Basket is empty. Search above to add stocks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-2">Stock</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Buy price</th>
                    <th className="pr-2 text-right">Invested</th><th className="pr-2 text-right">LTP</th><th className="pr-2 text-right">Day chg</th>
                    <th className="pr-2 text-right">Value</th><th className="pr-2 text-right">P&amp;L</th><th className="pr-2 text-right">Weight</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ s, h, invested, value, pnl }) => {
                    const r = quotes[s];
                    return (
                      <tr key={s} className="border-b border-slate-100">
                        <td className="py-2 pr-2">
                          <div className="font-semibold text-slate-900">{s}</div>
                          <div className="max-w-[200px] truncate text-xs text-slate-500">{r?.name ?? names.current[s] ?? ""}</div>
                        </td>
                        <td className="pr-2 text-right"><NumInput label={`${s} quantity`} value={h?.qty ?? null} onSave={(v) => setHolding(s, { qty: v })} /></td>
                        <td className="pr-2 text-right"><NumInput label={`${s} buy price`} value={h?.buy_price ?? null} onSave={(v) => setHolding(s, { buy_price: v })} /></td>
                        <td className="pr-2 text-right">{inr(invested)}</td>
                        <td className="pr-2 text-right font-semibold">{r?.error ? <span className="text-slate-400">n/a</span> : inr(r?.price)}</td>
                        <td className={`pr-2 text-right ${tone(r?.change ?? undefined)}`}>
                          {r?.change == null ? "—" : `${sgn(r.change)} (${sgn(r.change_pct ?? 0)}%)`}
                        </td>
                        <td className="pr-2 text-right">{inr(value)}</td>
                        <td className={`pr-2 text-right ${tone(pnl)}`}>
                          {pnl === undefined ? "—" : `${sgn(pnl)} (${sgn((pnl / (invested || 1)) * 100)}%)`}
                        </td>
                        <td className="pr-2 text-right text-slate-600">{invested !== undefined && totInv > 0 ? `${formatNumber((invested / totInv) * 100, 2)}%` : "—"}</td>
                        <td className="text-right"><button onClick={() => remove(s)} aria-label={`Remove ${s}`} className="px-2 text-slate-400 hover:text-red-600">✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-slate-900">
                    <td className="pt-3" colSpan={3}>Total</td>
                    <td className="pt-3 pr-2 text-right">{inr(totInv)}</td><td /><td />
                    <td className="pt-3 pr-2 text-right">{inr(totVal)}</td>
                    <td className={`pt-3 pr-2 text-right ${tone(totPnl)}`}>
                      {costBasisOfPriced > 0 ? `${sgn(totPnl)} (${sgn((totPnl / costBasisOfPriced) * 100)}%)` : "—"}
                    </td>
                    <td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Source: Yahoo Finance (unofficial, may lag ~15 min). Auto-refreshes every {REFRESH_MS / 1000}s
            {updated ? ` · updated ${updated.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}. Research data, not advice.
          </p>
        </section>
      ) : loaded && <p className="text-sm text-slate-500">Create a basket to start adding stocks.</p>}
    </div>
  );
}
