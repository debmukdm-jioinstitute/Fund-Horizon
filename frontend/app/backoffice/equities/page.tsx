"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EquityBasket, EquityQuote, EquitySuggestion, createEquityBasket, deleteEquityBasket,
  getEquityBaskets, getEquityQuotes, saveEquityBasket, searchEquities,
} from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

const LEGACY_KEY = "fh.equities.baskets.v1"; // pre-server storage; imported once then removed
const REFRESH_MS = 20_000;

const inr = (v?: number) => (v === undefined || v === null ? "—" : formatNumber(v, 2, { prefix: "₹" }));

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
  const remove = (sym: string) => setSymbols(symbols.filter((x) => x !== sym));

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
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-2">Stock</th><th className="pr-2 text-right">Price</th><th className="pr-2 text-right">Change</th>
                    <th className="pr-2 text-right">Day range</th><th className="pr-2 text-right">52w range</th><th />
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((s) => {
                    const r = quotes[s];
                    const up = (r?.change ?? 0) >= 0;
                    return (
                      <tr key={s} className="border-b border-slate-100">
                        <td className="py-2 pr-2">
                          <div className="font-semibold text-slate-900">{s}</div>
                          <div className="max-w-[220px] truncate text-xs text-slate-500">{r?.name ?? names.current[s] ?? ""}</div>
                        </td>
                        {r?.error ? <td colSpan={4} className="text-right text-slate-400">price unavailable</td> : (<>
                          <td className="pr-2 text-right font-semibold">{inr(r?.price)}</td>
                          <td className={`pr-2 text-right ${r ? (up ? "text-emerald-600" : "text-red-600") : ""}`}>
                            {r?.change === undefined || r?.change === null ? "—" : `${up ? "+" : ""}${formatNumber(r.change, 2)} (${up ? "+" : ""}${formatNumber(r.change_pct ?? 0, 2)}%)`}
                          </td>
                          <td className="pr-2 text-right text-slate-600">{inr(r?.day_low)} – {inr(r?.day_high)}</td>
                          <td className="pr-2 text-right text-slate-600">{inr(r?.low_52w)} – {inr(r?.high_52w)}</td>
                        </>)}
                        <td className="text-right"><button onClick={() => remove(s)} aria-label={`Remove ${s}`} className="px-2 text-slate-400 hover:text-red-600">✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
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
