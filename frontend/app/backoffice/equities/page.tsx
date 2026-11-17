"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  EquityBasket, EquityHolding, EquityQuote, EquitySuggestion, createEquityBasket, deleteEquityBasket,
  getEquityBaskets, getEquityIndices, getEquityQuotes, saveEquityBasket, saveEquityHolding, searchEquities,
} from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

const LEGACY_KEY = "fh.equities.baskets.v1"; // pre-server storage; imported once then removed
const REFRESH_MS = 20_000;

const HOME = "home";

function stats(b: EquityBasket, quotes: Record<string, EquityQuote>) {
  let invested = 0, value = 0, pnl = 0, cost = 0, today = 0, priced = false;
  for (const sym of b.symbols) {
    const h = b.holdings[sym], r = quotes[sym];
    if (h?.qty == null) continue;
    const inv = h.buy_price != null ? h.qty * h.buy_price : 0;
    invested += inv;
    if (r?.price != null) {
      const v = h.qty * r.price;
      value += v; priced = true; today += h.qty * (r.change ?? 0);
      if (h.buy_price != null) { pnl += v - inv; cost += inv; }
    }
  }
  return { invested, value, pnl, cost, today, priced };
}

const inr = (v?: number) => (v === undefined || v === null ? "—" : formatNumber(v, 2, { prefix: "₹" }));

function NumInput({ value, onSave, label, className = "" }: { value: number | null; onSave: (v: number | null) => void; label: string; className?: string }) {
  const [t, setT] = useState(value === null ? "" : String(value));
  useEffect(() => setT(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const v = t.trim() === "" ? null : Number(t);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return setT(value === null ? "" : String(value));
    if (v !== value) onSave(v);
  };
  return (
    <input inputMode="decimal" aria-label={label} value={t} onChange={(e) => setT(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={`text-[#2F363F] outline-none focus:ring-1 focus:ring-[#1F7AE0] ${className}`} />
  );
}

// smallcase-style "− 22 +" share stepper
function Stepper({ value, onSave, label }: { value: number | null; onSave: (v: number | null) => void; label: string }) {
  const n = value ?? 0;
  const b = "flex h-9 w-8 items-center justify-center text-lg font-semibold text-[#1F7AE0] hover:bg-[#F2F7FD] disabled:text-[#C5CAD0]";
  return (
    <div className="inline-flex items-center rounded border border-[#D5D9DD] bg-white">
      <button type="button" aria-label={`Decrease ${label}`} className={b} disabled={n <= 0} onClick={() => onSave(Math.max(0, n - 1))}>−</button>
      <NumInput label={`${label} shares`} value={value} onSave={onSave} className="h-9 w-14 border-x border-[#D5D9DD] text-center text-[15px] font-medium" />
      <button type="button" aria-label={`Increase ${label}`} className={b} onClick={() => onSave(n + 1)}>+</button>
    </div>
  );
}

export default function EquitiesPage() {
  const [baskets, setBaskets] = useState<EquityBasket[]>([]);
  const [activeId, setActiveId] = useState(HOME);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<EquitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, EquityQuote>>({});
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const names = useRef<Record<string, string>>({});
  const [showNew, setShowNew] = useState(false);
  const [hideTip, setHideTip] = useState(true); // true until we know (avoids flash)
  useEffect(() => { try { setHideTip(localStorage.getItem("fh.equities.tip") === "1"); } catch { setHideTip(false); } }, []);

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
  // Locked by default. Edits go to a local draft and only persist on an explicit, confirmed Save.
  const [draft, setDraft] = useState<{ symbols: string[]; holdings: Record<string, EquityHolding> } | null>(null);
  const editing = draft !== null;
  const cur = draft ?? { symbols: basket?.symbols ?? [], holdings: basket?.holdings ?? {} };
  const symbols = cur.symbols;
  const dirty = !!basket && !!draft && JSON.stringify(draft) !== JSON.stringify({ symbols: basket.symbols, holdings: basket.holdings });
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const isHome = activeId === HOME;
  const [indices, setIndices] = useState<EquityQuote[]>([]);
  const symKey = (isHome ? Array.from(new Set(baskets.flatMap((b) => b.symbols))) : symbols).join(",");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      if (isHome) setIndices(await getEquityIndices(signal));
      if (!symKey) return;
      const rows = await getEquityQuotes(symKey.split(","), signal);
      setQuotes((p) => ({ ...p, ...Object.fromEntries(rows.map((r) => [r.symbol, r])) }));
      setUpdated(new Date());
      setErr(null);
    } catch (e) {
      if (!signal?.aborted) setErr(e instanceof Error ? e.message : "Quote fetch failed");
    }
  }, [symKey, isHome]);

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
      setBaskets((p) => [...p, b]); setActiveId(b.id); setNewName(""); setShowNew(false); setErr(null);
    } catch (e) { fail(e); }
  };
  const guardDiscard = () => !dirty || confirm("You have unsaved changes. Discard them?");
  const selectBasket = (id: string) => { if (id === activeId || !guardDiscard()) return; setDraft(null); setActiveId(id); };
  const startEdit = () => basket && setDraft({ symbols: [...basket.symbols], holdings: structuredClone(basket.holdings) });
  const cancelEdit = () => { if (guardDiscard()) setDraft(null); };

  const deleteBasket = async () => {
    if (!basket) return;
    const typed = prompt(`This permanently deletes "${basket.name}" and all its quantities and buy prices.\nType the basket name to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== basket.name) { setErr("Name did not match — basket not deleted."); return; }
    try {
      await deleteEquityBasket(basket.id);
      const rest = baskets.filter((b) => b.id !== basket.id);
      setBaskets(rest); setActiveId(HOME); setDraft(null); setErr(null);
    } catch (e) { fail(e); }
  };

  const add = (x: EquitySuggestion) => {
    if (!draft || symbols.includes(x.symbol) || symbols.length >= 50) return;
    setDraft({ ...draft, symbols: [...symbols, x.symbol] });
    setQ(""); setSugg([]); setOpen(false);
  };
  const setHolding = (sym: string, patch: Partial<EquityHolding>) => {
    if (!draft) return;
    const c = draft.holdings[sym] ?? { qty: null, buy_price: null };
    setDraft({ ...draft, holdings: { ...draft.holdings, [sym]: { ...c, ...patch } } });
  };
  const remove = (sym: string) => {
    if (!draft) return;
    const rest = { ...draft.holdings };
    delete rest[sym];
    setDraft({ symbols: symbols.filter((x) => x !== sym), holdings: rest });
  };

  const saveChanges = async () => {
    if (!basket || !draft || !dirty) return;
    const lines: string[] = [];
    const old = basket.holdings;
    for (const s of basket.symbols) if (!draft.symbols.includes(s)) lines.push(`− remove ${s}`);
    for (const s of draft.symbols) {
      const o = old[s], n = draft.holdings[s];
      if (!basket.symbols.includes(s)) lines.push(`+ add ${s}${n?.qty != null ? `: ${n.qty} @ ${n.buy_price ?? "?"}` : ""}`);
      else if (o?.qty !== n?.qty || o?.buy_price !== n?.buy_price)
        lines.push(`${s}: qty ${o?.qty ?? "—"} → ${n?.qty ?? "—"}, buy ${o?.buy_price ?? "—"} → ${n?.buy_price ?? "—"}`);
    }
    if (!confirm(`Save ${lines.length} change${lines.length === 1 ? "" : "s"} to "${basket.name}"?\n\n${lines.join("\n")}`)) return;
    try {
      if (JSON.stringify(draft.symbols) !== JSON.stringify(basket.symbols)) await saveEquityBasket(basket.id, draft.symbols);
      for (const s of draft.symbols) {
        const o = old[s], n = draft.holdings[s];
        if (n && (o?.qty !== n.qty || o?.buy_price !== n.buy_price)) await saveEquityHolding(basket.id, s, n);
      }
      setBaskets(baskets.map((b) => (b.id === basket.id ? { ...b, symbols: draft.symbols, holdings: draft.holdings } : b)));
      setDraft(null); setErr(null);
    } catch (e) { fail(e); }  // draft is kept so nothing typed is lost
  };

  const rows = symbols.map((s) => {
    const h = cur.holdings[s], r = quotes[s], px = r?.price;
    const invested = h?.qty != null && h.buy_price != null ? h.qty * h.buy_price : undefined;
    const value = h?.qty != null && px != null ? h.qty * px : undefined;
    const today = h?.qty != null && r?.change != null ? h.qty * r.change : undefined;
    return { s, h, invested, value, today, pnl: invested !== undefined && value !== undefined ? value - invested : undefined };
  });
  const totInv = rows.reduce((a, r) => a + (r.invested ?? 0), 0);
  const totVal = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const priced = rows.filter((r) => r.pnl !== undefined);
  const totPnl = priced.reduce((a, r) => a + (r.pnl ?? 0), 0);
  const pricedCost = priced.reduce((a, r) => a + (r.invested ?? 0), 0);
  const totToday = rows.reduce((a, r) => a + (r.today ?? 0), 0);
  const tone = (v?: number) => (v === undefined ? "text-[#81878C]" : v >= 0 ? "text-[#1EA672]" : "text-[#E5484D]");
  const sgn = (v: number) => `${v >= 0 ? "+" : ""}${formatNumber(v, 2)}`;
  const pct = (a: number, b: number) => (b > 0 ? ` (${sgn((a / b) * 100)}%)` : "");

  const th = "pb-3 pr-3 text-right text-[13px] font-normal text-[#81878C]";
  const outlineBtn = "rounded border border-[#1F7AE0] bg-white px-4 py-2 text-sm font-medium text-[#1F7AE0] hover:bg-[#F2F7FD]";
  const primaryBtn = "w-full rounded bg-[#17408B] px-4 py-3 text-base font-semibold text-white hover:bg-[#12336f]";

  return (
    <div className="mx-auto max-w-[1200px] p-4 text-[#2F363F] sm:p-6">
      <h1 className="text-[28px] font-medium leading-tight">{basket ? basket.name : "Equities"}</h1>
      <p className="mt-1 text-[13px] text-[#81878C]">Build baskets of NSE stocks, record your shares and buy prices, and track live returns.</p>

      {!hideTip && (
        <div className="mt-5 flex items-center gap-3 rounded border border-[#E8EBED] bg-white px-4 py-3 text-sm">
          <span aria-hidden className="text-[#1F7AE0]">◆</span>
          <span className="flex-1"><b className="font-medium">Track your ideas</b> <span className="text-[#81878C]">— add stocks, set shares and buy prices; invested amount, value and P&amp;L update live.</span></span>
          <button className="text-sm font-medium text-[#81878C]" onClick={() => { setHideTip(true); try { localStorage.setItem("fh.equities.tip", "1"); } catch {} }}>Got it</button>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-[#E5484D]">{err}</p>}

      {/* Basket tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[#E8EBED]">
        <button onClick={() => selectBasket(HOME)}
          className={`-mb-px border-b-2 pb-3 text-[15px] ${isHome ? "border-[#1F7AE0] font-medium text-[#1F7AE0]" : "border-transparent text-[#535B62]"}`}>Home</button>
        {baskets.map((b) => (
          <button key={b.id} onClick={() => selectBasket(b.id)}
            className={`-mb-px border-b-2 pb-3 text-[15px] ${b.id === activeId ? "border-[#1F7AE0] font-medium text-[#1F7AE0]" : "border-transparent text-[#535B62]"}`}>
            {b.name} <span className="text-[#81878C]">{b.symbols.length}</span>
          </button>
        ))}
        {showNew ? (
          <div className="mb-2 flex items-center gap-2">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="Basket name"
              onKeyDown={(e) => { if (e.key === "Enter") createBasket(); if (e.key === "Escape") setShowNew(false); }}
              className="rounded border border-[#D5D9DD] px-3 py-1.5 text-sm outline-none focus:border-[#1F7AE0]" />
            <button className={outlineBtn} onClick={createBasket} disabled={!newName.trim()}>Create</button>
          </div>
        ) : (
          <button className={`${outlineBtn} mb-2 py-1.5`} disabled={editing} onClick={() => setShowNew(true)}>+ New basket</button>
        )}
      </div>

      {isHome ? (() => {
        const all = baskets.map((b) => ({ b, st: stats(b, quotes) }));
        const tot = all.reduce((a, { st }) => ({ invested: a.invested + st.invested, value: a.value + st.value, pnl: a.pnl + st.pnl, cost: a.cost + st.cost, today: a.today + st.today }), { invested: 0, value: 0, pnl: 0, cost: 0, today: 0 });
        const movers = Array.from(new Set(baskets.flatMap((b) => b.symbols))).map((x) => quotes[x]).filter((r) => r?.change_pct != null).sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
        const Mover = ({ r }: { r: EquityQuote }) => (
          <li className="flex items-center justify-between border-b border-[#E8EBED] py-2 text-sm">
            <span className="min-w-0 truncate pr-2"><a href={`https://www.screener.in/company/${encodeURIComponent(r.symbol)}/`} target="_blank" rel="noopener noreferrer" className="text-[#1F7AE0] hover:underline">{r.name ?? r.symbol}</a> <span className="text-xs text-[#81878C]">{r.symbol}</span></span>
            <span className={tone(r.change_pct ?? undefined)}>{sgn(r.change_pct ?? 0)}%</span>
          </li>
        );
        return (
          <div className="mt-6 space-y-8">
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(indices.length ? indices : [{ symbol: "NIFTY 50" }, { symbol: "BANK NIFTY" }, { symbol: "SENSEX" }] as EquityQuote[]).map((i) => (
                <div key={i.symbol} className="rounded border border-[#E8EBED] bg-white p-4">
                  <div className="text-sm text-[#81878C]">{i.name ?? i.symbol}</div>
                  <div className="mt-1 text-xl font-medium">{i.price != null ? formatNumber(i.price, 2) : "—"}</div>
                  <div className={`text-sm ${tone(i.change ?? undefined)}`}>{i.change != null ? `${sgn(i.change)} (${sgn(i.change_pct ?? 0)}%)` : ""}</div>
                </div>
              ))}
            </section>

            <section>
              <div className="text-sm text-[#81878C]">Total invested across baskets</div>
              <div className="mt-1 text-[28px] font-medium leading-none">{inr(tot.invested)}</div>
              <dl className="mt-4 grid max-w-xl grid-cols-3 gap-4 text-sm">
                <div><dt className="text-[#81878C]">Current value</dt><dd className="mt-0.5 text-base font-medium">{tot.value > 0 ? inr(tot.value) : "—"}</dd></div>
                <div><dt className="text-[#81878C]">Returns</dt><dd className={`mt-0.5 text-base font-medium ${tone(tot.cost > 0 ? tot.pnl : undefined)}`}>{tot.cost > 0 ? `${sgn(tot.pnl)} (${sgn((tot.pnl / tot.cost) * 100)}%)` : "—"}</dd></div>
                <div><dt className="text-[#81878C]">Today</dt><dd className={`mt-0.5 text-base font-medium ${tone(tot.value > 0 ? tot.today : undefined)}`}>{tot.value > 0 ? sgn(tot.today) : "—"}</dd></div>
              </dl>
            </section>

            <section>
              <div className="mb-2 text-sm text-[#81878C]">Your baskets</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {all.map(({ b, st }) => (
                  <button key={b.id} onClick={() => selectBasket(b.id)} className="rounded border border-[#E8EBED] bg-white p-4 text-left hover:border-[#1F7AE0]">
                    <div className="text-[15px] font-medium text-[#1F7AE0]">{b.name}</div>
                    <div className="text-xs text-[#81878C]">{b.symbols.length} stocks</div>
                    <div className="mt-3 flex justify-between text-sm"><span className="text-[#81878C]">Invested</span><span>{inr(st.invested)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-[#81878C]">Value</span><span>{st.priced ? inr(st.value) : "—"}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-[#81878C]">Returns</span>
                      <span className={tone(st.cost > 0 ? st.pnl : undefined)}>{st.cost > 0 ? `${sgn(st.pnl)} (${sgn((st.pnl / st.cost) * 100)}%)` : "—"}</span></div>
                  </button>
                ))}
                <button onClick={() => setShowNew(true)} className="flex min-h-[120px] items-center justify-center rounded border border-dashed border-[#1F7AE0] text-sm font-medium text-[#1F7AE0] hover:bg-[#F2F7FD]">+ New basket</button>
              </div>
              {loaded && baskets.length === 0 && <p className="mt-3 text-sm text-[#81878C]">No baskets yet. Create one to start adding stocks.</p>}
            </section>

            {movers.length > 0 && (
              <section className="grid gap-8 sm:grid-cols-2">
                <div><div className="mb-1 text-sm text-[#81878C]">Top gainers today</div><ul>{movers.slice(0, 3).filter((r) => (r.change_pct ?? 0) > 0).map((r) => <Mover key={r.symbol} r={r} />)}</ul></div>
                <div><div className="mb-1 text-sm text-[#81878C]">Top losers today</div><ul>{movers.slice(-3).reverse().filter((r) => (r.change_pct ?? 0) < 0).map((r) => <Mover key={r.symbol} r={r} />)}</ul></div>
              </section>
            )}
            <p className="text-xs text-[#81878C]">Yahoo Finance (unofficial, may lag ~15 min). Auto-refresh {REFRESH_MS / 1000}s{updated ? ` · ${updated.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}. Research data, not advice.</p>
          </div>
        );
      })() : basket ? (
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Summary panel (first on mobile, right column on desktop) */}
          <aside className="lg:col-start-2 lg:row-start-1">
            <div className="space-y-4 lg:sticky lg:top-4">
              <div>
                <div className="text-sm text-[#81878C]">Invested amount</div>
                <div className="mt-1 text-[28px] font-medium leading-none">{inr(totInv)}</div>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-[#81878C]">Current value</dt><dd className="mt-0.5 text-base font-medium">{inr(totVal)}</dd></div>
                <div><dt className="text-[#81878C]">Returns</dt>
                  <dd className={`mt-0.5 text-base font-medium ${tone(pricedCost > 0 ? totPnl : undefined)}`}>{pricedCost > 0 ? `${sgn(totPnl)}${pct(totPnl, pricedCost)}` : "—"}</dd></div>
                <div><dt className="text-[#81878C]">Today</dt>
                  <dd className={`mt-0.5 text-base font-medium ${tone(totVal > 0 ? totToday : undefined)}`}>{totVal > 0 ? sgn(totToday) : "—"}</dd></div>
                <div><dt className="text-[#81878C]">Stocks</dt><dd className="mt-0.5 text-base font-medium">{symbols.length}</dd></div>
              </dl>
              {editing ? (<>
                <p className="rounded border border-[#F5D58A] bg-[#FFF9E6] px-3 py-2 text-xs text-[#7A5B00]">Editing — nothing is saved until you press Save changes.</p>
                <button className={`${primaryBtn} disabled:opacity-40`} disabled={!dirty} onClick={saveChanges}>Save changes</button>
                <button className={`${outlineBtn} w-full py-3`} onClick={cancelEdit}>Cancel</button>
                <button className="w-full text-sm font-medium text-[#E5484D]" onClick={deleteBasket}>Delete basket…</button>
              </>) : (<>
                <button className={primaryBtn} onClick={startEdit}>Edit holdings</button>
                <button className={`${outlineBtn} w-full py-3`} onClick={() => refresh()}>Refresh prices</button>
              </>)}
              <p className="text-xs text-[#81878C]">
                Yahoo Finance (unofficial, may lag ~15 min). Auto-refresh {REFRESH_MS / 1000}s
                {updated ? ` · ${updated.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}. Research data, not advice.
              </p>
            </div>
          </aside>

          {/* Stocks */}
          <section className="min-w-0 lg:col-start-1 lg:row-start-1">
            {editing && <div className="mb-1 text-sm text-[#81878C]">Add &amp; organize stocks</div>}
            <div className={`relative mb-4 ${editing ? "" : "hidden"}`} onBlur={() => setTimeout(() => setOpen(false), 150)}>
              <svg aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#81878C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
                placeholder="Search by name or ticker" className="w-full rounded border border-[#D5D9DD] bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#1F7AE0]" />
              {open && sugg.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-[#E8EBED] bg-white shadow-lg">
                  {sugg.map((x) => (
                    <li key={x.symbol}>
                      <button className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-[#F2F7FD]" onClick={() => add(x)}>
                        <span className="truncate text-[#1F7AE0]">{x.name}</span>
                        <span className="text-xs text-[#81878C]">{x.symbol}{symbols.includes(x.symbol) ? " · added" : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {symbols.length === 0 ? (
              <p className="rounded border border-dashed border-[#D5D9DD] p-8 text-center text-sm text-[#81878C]">No stocks yet. Press Edit holdings to add your first pick.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E8EBED]">
                      <th className="pb-3 pr-3 text-left text-[13px] font-normal text-[#81878C]">Stock</th>
                      <th className={th}>CMP (₹)</th><th className={th}>Shares</th><th className={th}>Buy price (₹)</th>
                      <th className={th}>Invested</th><th className={th}>Value</th><th className={th}>P&amp;L</th><th className={th}>Weight</th><th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ s, h, invested, value, pnl }) => {
                      const r = quotes[s];
                      return (
                        <tr key={s} className="border-b border-[#E8EBED]">
                          <td className="py-3 pr-3">
                            <div><a href={`https://www.screener.in/company/${encodeURIComponent(s)}/`} target="_blank" rel="noopener noreferrer" title="Open on Screener.in" className="text-[15px] font-medium text-[#1F7AE0] hover:underline">{r?.name ?? names.current[s] ?? s}</a></div>
                            <div className="text-xs text-[#81878C]">{s}</div>
                          </td>
                          <td className="pr-3 text-right">
                            {r?.error ? <button className="text-xs text-[#1F7AE0]" onClick={() => refresh()}>retry</button> : (<>
                              <div className="font-medium">{r?.price != null ? formatNumber(r.price, 2) : "—"}</div>
                              <div className={`text-xs ${tone(r?.change ?? undefined)}`}>{r?.change == null ? "" : `${sgn(r.change)} (${sgn(r.change_pct ?? 0)}%)`}</div>
                            </>)}
                          </td>
                          <td className="pr-3 text-right">
                            {editing ? <Stepper label={s} value={h?.qty ?? null} onSave={(v) => setHolding(s, { qty: v })} /> : <span className="text-[15px] font-medium">{h?.qty ?? "—"}</span>}
                          </td>
                          <td className="pr-3 text-right">
                            {editing ? <NumInput label={`${s} buy price`} value={h?.buy_price ?? null} onSave={(v) => setHolding(s, { buy_price: v })} className="w-24 rounded border border-[#D5D9DD] px-2 py-2 text-right" /> : (h?.buy_price != null ? formatNumber(h.buy_price, 2) : "—")}
                          </td>
                          <td className="pr-3 text-right">{inr(invested)}</td>
                          <td className="pr-3 text-right">{inr(value)}</td>
                          <td className={`pr-3 text-right ${tone(pnl)}`}>
                            {pnl === undefined ? "—" : <><div>{sgn(pnl)}</div><div className="text-xs">{`${sgn((pnl / (invested || 1)) * 100)}%`}</div></>}
                          </td>
                          <td className="pr-3 text-right text-[#535B62]">{invested !== undefined && totInv > 0 ? `${formatNumber((invested / totInv) * 100, 2)}%` : "—"}</td>
                          <td className="text-right">{editing && <button onClick={() => remove(s)} aria-label={`Remove ${s}`} className="px-2 text-lg leading-none text-[#81878C] hover:text-[#E5484D]">×</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td className="pt-4" colSpan={4}>Total</td>
                      <td className="pt-4 pr-3 text-right">{inr(totInv)}</td>
                      <td className="pt-4 pr-3 text-right">{inr(totVal)}</td>
                      <td className={`pt-4 pr-3 text-right ${tone(pricedCost > 0 ? totPnl : undefined)}`}>{pricedCost > 0 ? sgn(totPnl) : "—"}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
