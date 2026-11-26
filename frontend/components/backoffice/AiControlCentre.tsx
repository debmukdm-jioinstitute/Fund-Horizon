"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAiConfig,
  getAiStatus,
  resetAiConfig,
  saveAiConfig,
  testAiProvider,
  type AiConfig,
  type AiProvider,
  type AiStat,
} from "@/lib/backoffice";

const ist = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
      }) + " IST"
    : "—";

function renderAiStatusPill(s: AiStat | undefined, keyOk: boolean, enabled: boolean) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F8F9FA] text-[#475467] border border-[#E4E7EC] dark:bg-[#1E242F] dark:text-[#98A2B3] dark:border-[#344054]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#98A2B3]" />
        Off
      </span>
    );
  }
  if (!keyOk) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF] dark:bg-[#102A4C] dark:text-[#84CAFF] dark:border-[#1E4775]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2E90FA]" />
        Needs Key
      </span>
    );
  }
  if (s && s.cooldown_remaining_s > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFF4D6] text-[#7A5600] border border-[#FDE047] dark:bg-[#3A2E0A] dark:text-[#FBBF24] dark:border-[#713F12]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
        Cooling ({s.cooldown_remaining_s}s)
      </span>
    );
  }
  if (s && s.consecutive_failures > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FDE7E9] text-[#9B1C2E] border border-[#FCA5A5] dark:bg-[#3A1519] dark:text-[#FFA9B5] dark:border-[#7F1D1D]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#E11D48]" />
        Failing
      </span>
    );
  }
  if (s && s.ok > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#ECFDF3] text-[#027A48] border border-[#A6F4C5] dark:bg-[#0E3824] dark:text-[#6CE9A6] dark:border-[#1E5D3A]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A]" />
        Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F8F9FA] text-[#475467] border border-[#E4E7EC] dark:bg-[#1E242F] dark:text-[#98A2B3] dark:border-[#344054]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#98A2B3]" />
      Standby
    </span>
  );
}

function getProviderIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("gemini") || n.includes("google")) {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24Z" />
      </svg>
    );
  }
  if (n.includes("claude") || n.includes("anthropic")) {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.5 2H6.5L1 12l5.5 10h11L23 12 17.5 2zm-1.8 16H8.3L4.4 12l3.9-6h7.4l3.9 6-3.9 6z" />
      </svg>
    );
  }
  if (n.includes("open") || n.includes("gpt")) {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V18h-2v-1.07A6 6 0 0 1 6.07 12H7a5 5 0 0 0 4 4.9V13H9v-2h2V9a3 3 0 0 1 6 0v2h2v2h-2v3.9a5 5 0 0 0 4-4.9h.93A6 6 0 0 1 13 16.93z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

export default function AiControlCentre() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [newName, setNewName] = useState({ name: "", model: "", api_url: "", env_key: "" });
  const editing = useRef(false);
  const version = useRef(0);

  const load = useCallback(async () => {
    try {
      const c = await getAiConfig();
      setCfg(c);
      version.current = c.version;
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load AI settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: poll health every 3s
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = await getAiStatus();
        setCfg((c) => (c ? { ...c, ...s } : c));
        if (s.version !== version.current && !editing.current) void load();
      } catch {
        /* keep last good view */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  const apply = async (mut: (d: ReturnType<typeof toDoc>) => void) => {
    if (!cfg) return;
    const doc = toDoc(cfg);
    mut(doc);
    setBusy(true);
    try {
      const c = await saveAiConfig(doc);
      setCfg(c);
      version.current = c.version;
      setSaved(`Applied ${ist(c.updated_at)}`);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
      await load();
    } finally {
      setBusy(false);
      editing.current = false;
    }
  };

  const move = (chain: string, i: number, d: number) =>
    apply((doc) => {
      const a = doc.chains[chain];
      const j = i + d;
      if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]];
    });

  const remove = (chain: string, i: number) =>
    apply((doc) => {
      if (doc.chains[chain].length > 1) doc.chains[chain].splice(i, 1);
    });

  const add = (chain: string, name: string) =>
    name &&
    apply((doc) => {
      if (!doc.chains[chain].includes(name)) doc.chains[chain].push(name);
    });

  const test = async (name: string) => {
    setTests((t) => ({ ...t, [name]: "Testing…" }));
    try {
      const r = await testAiProvider(name);
      setTests((t) => ({
        ...t,
        [name]: r.ok ? `OK in ${r.ms} ms (${r.model})` : `Failed: ${r.error}`,
      }));
    } catch (e) {
      setTests((t) => ({
        ...t,
        [name]: e instanceof Error ? e.message : "Test failed",
      }));
    }
  };

  const filteredProviders = useMemo(() => {
    if (!cfg?.providers) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cfg.providers;
    return cfg.providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        (p.env_key && p.env_key.toLowerCase().includes(q))
    );
  }, [cfg?.providers, searchQuery]);

  if (!cfg) {
    return (
      <div className="p-8 text-center text-[#706E6B] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        {err ?? "Loading AI control centre…"}
      </div>
    );
  }

  const byName = Object.fromEntries(cfg.providers.map((p) => [p.name, p]));

  return (
    <div className="space-y-6">
      {/* Top Banner Alert if any */}
      {err && (
        <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 text-xs font-medium">
          {err}
        </div>
      )}
      {cfg.mock_active && (
        <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs font-medium">
          A test override (FH_MOCK_LLM_RESPONSE) is set on the server: every call returns canned text.
        </div>
      )}

      {/* CARD 1: Source Registry matching Data Health strictly */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-sm overflow-hidden">
        {/* Card Header with Icon + Title & Search input */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="text-[#1A73E8]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 7l11 5 11-5-11-5zM1 12l11 5 11-5-1.5-0.68L12 15.68 2.5 11.32 1 12zm0 5l11 5 11-5-1.5-0.68L12 20.68 2.5 16.32 1 17z" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                AI Models &amp; Provider Registry
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live v{cfg.version}
              </span>
              {busy && <span className="text-xs text-blue-600 animate-pulse">Saving…</span>}
              {saved && !busy && <span className="text-[11px] text-slate-400">{saved}</span>}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800/80 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-5">Provider &amp; Model</th>
                <th className="py-3 px-5">Status</th>
                <th className="py-3 px-5">Chain Roles</th>
                <th className="py-3 px-5">Last Latency &amp; Success</th>
                <th className="py-3 px-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {filteredProviders.map((p: AiProvider) => {
                const s = cfg.stats[p.name];
                // Check if primary or fallback in any chain
                const roles: string[] = [];
                for (const [ch, list] of Object.entries(cfg.chains)) {
                  const idx = list.indexOf(p.name);
                  if (idx === 0) roles.push(`${ch}: Primary`);
                  else if (idx > 0) roles.push(`${ch}: Fallback ${idx}`);
                }
                if (cfg.picks.model === p.model || cfg.picks.model === p.name) {
                  roles.push("Picks");
                }

                return (
                  <tr key={p.name} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#1A73E8] dark:text-[#8AB8FF] flex items-center justify-center shrink-0">
                          {getProviderIcon(p.name)}
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {p.name}
                            </span>
                            <label className="inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={p.enabled}
                                disabled={busy}
                                onChange={(e) =>
                                  apply((d) => {
                                    d.providers[p.name] = {
                                      ...d.providers[p.name],
                                      enabled: e.target.checked,
                                    };
                                  })
                                }
                                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            </label>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {p.model}
                            {!p.key_present && p.env_key && (
                              <span className="ml-2 text-rose-500">needs {p.env_key}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-5">
                      {renderAiStatusPill(s, p.key_present, p.enabled)}
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex flex-wrap gap-1">
                        {roles.length > 0 ? (
                          roles.map((r) => (
                            <span
                              key={r}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                r.includes("Primary")
                                  ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              }`}
                            >
                              {r}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400 text-[11px]">Standby</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 dark:text-slate-400 font-medium">
                      <div className="space-y-0.5">
                        <span className="inline-flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {s?.last_latency_ms ? `${s.last_latency_ms} ms` : "—"}
                        </span>
                        {s && (
                          <div className="text-[11px] text-slate-400">
                            {s.ok} ok / {s.fail} err · {ist(s.last_ok_at)}
                          </div>
                        )}
                        {tests[p.name] && (
                          <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                            {tests[p.name]}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => test(p.name)}
                        disabled={busy}
                        className="px-3.5 py-1 text-xs font-semibold rounded-full border border-blue-200 dark:border-blue-900/60 text-[#1A73E8] dark:text-[#8AB8FF] bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 transition-colors"
                      >
                        Test
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* CARD 2: Execution Chains & Fallbacks */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="text-[#1A73E8]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Execution Chains &amp; Fallbacks
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Primary model tried first; on failure or cooldown, traffic automatically fails over down the chain.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 divide-y divide-slate-100 dark:divide-slate-800/80 space-y-4">
          {Object.entries(cfg.chain_labels).map(([chain, label]) => (
            <div key={chain} className="pt-4 first:pt-0 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {label} ({chain})
                </span>
                <select
                  className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 py-1 px-2 text-slate-800 dark:text-slate-200"
                  value=""
                  onChange={(e) => add(chain, e.target.value)}
                  aria-label={`Add fallback to ${label}`}
                >
                  <option value="">+ Add fallback to chain…</option>
                  {cfg.providers
                    .filter((p) => !cfg.chains[chain].includes(p.name))
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.model})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {cfg.chains[chain].map((n, i) => {
                  const p = byName[n];
                  return (
                    <div
                      key={n}
                      className={`flex items-center justify-between p-3 rounded-xl border ${
                        i === 0
                          ? "border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20"
                          : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            i === 0
                              ? "bg-blue-600 text-white"
                              : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {i === 0 ? "Primary" : `Fallback ${i}`}
                        </span>
                        <div className="truncate">
                          <div className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {n}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                            {p?.model || "default"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                          type="button"
                          className="w-6 h-6 rounded flex items-center justify-center border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                          disabled={i === 0 || busy}
                          onClick={() => move(chain, i, -1)}
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="w-6 h-6 rounded flex items-center justify-center border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                          disabled={i === cfg.chains[chain].length - 1 || busy}
                          onClick={() => move(chain, i, 1)}
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="w-6 h-6 rounded flex items-center justify-center border border-slate-200 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-30"
                          disabled={cfg.chains[chain].length < 2 || busy}
                          onClick={() => remove(chain, i)}
                          title="Remove from chain"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CARD 3: Runtime Parameters & Behaviour */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-sm overflow-hidden p-5 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800/80">
          <div className="text-[#1A73E8]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Runtime Behaviour &amp; Cooldown Parameters
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tune temperature, token ceilings, and failover trigger thresholds.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(cfg.settings).map(([k, v]) => (
            <div key={k} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 space-y-1.5">
              <label className="text-xs font-semibold capitalize text-slate-700 dark:text-slate-300 block">
                {k.replace(/_/g, " ")}
              </label>
              <input
                type="number"
                className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5 px-2.5 font-mono text-slate-900 dark:text-slate-100"
                defaultValue={v}
                key={`${k}-${v}`}
                step={k === "temperature" ? 0.1 : 1}
                min={cfg.limits[k]?.[0] ?? 0}
                max={cfg.limits[k]?.[1] ?? 10000}
                onFocus={() => {
                  editing.current = true;
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n !== v) {
                    void apply((d) => {
                      d.settings[k] = n;
                    });
                  } else {
                    editing.current = false;
                  }
                }}
              />
              <span className="text-[10px] text-slate-400 block">
                Range: {cfg.limits[k]?.[0] ?? 0} – {cfg.limits[k]?.[1] ?? 10000}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* CARD 4: Plan Recommendations (AI Picks) */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-sm overflow-hidden p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="text-[#1A73E8]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                AI Fund Picks
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Dynamic portfolio plan selection using reasoned scoring.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={cfg.picks.enabled}
              onChange={(e) =>
                apply((d) => {
                  d.picks = { ...d.picks, enabled: e.target.checked };
                })
              }
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Enable AI Picks
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Picks Model
            </label>
            <input
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5 px-2.5 font-mono text-slate-900 dark:text-slate-100"
              defaultValue={cfg.picks.model}
              key={cfg.picks.model}
              aria-label="Picks model"
              onFocus={() => {
                editing.current = true;
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== cfg.picks.model) {
                  void apply((d) => {
                    d.picks = { ...d.picks, model: v };
                  });
                } else {
                  editing.current = false;
                }
              }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Reasoning Effort
            </label>
            <select
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1.5 px-2.5 text-slate-900 dark:text-slate-100"
              value={cfg.picks.effort}
              onChange={(e) =>
                apply((d) => {
                  d.picks = { ...d.picks, effort: e.target.value };
                })
              }
            >
              {cfg.efforts.map((x) => (
                <option key={x} value={x}>
                  {x ? `Effort: ${x}` : "Effort: Default"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* CARD 5: System Prompt & Custom Providers */}
      <details className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-sm overflow-hidden p-5">
        <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
          <span>System Prompt &amp; Custom OpenAI-Compatible Endpoints</span>
          <span className="text-xs font-normal text-blue-600 dark:text-blue-400">Expand / Collapse</span>
        </summary>
        <div className="mt-4 space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800/80">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Master System Prompt
            </label>
            <textarea
              className="w-full h-36 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/60 p-3 font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              defaultValue={cfg.system_prompt}
              key={`sp-${cfg.version}`}
              onFocus={() => {
                editing.current = true;
              }}
              onBlur={(e) => {
                const v = e.target.value;
                if (v.trim() !== cfg.system_prompt.trim()) {
                  void apply((d) => {
                    d.system_prompt = v;
                  });
                } else {
                  editing.current = false;
                }
              }}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Wording, banned words, and data integrity checks are enforced in code.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Register Custom Endpoint
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                placeholder="Provider name (e.g. vllm-local)"
                value={newName.name}
                onChange={(e) => setNewName({ ...newName, name: e.target.value })}
              />
              <input
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                placeholder="Model ID (e.g. meta-llama/Llama-3-70b)"
                value={newName.model}
                onChange={(e) => setNewName({ ...newName, model: e.target.value })}
              />
              <input
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                placeholder="API URL (https://…/v1/chat/completions)"
                value={newName.api_url}
                onChange={(e) => setNewName({ ...newName, api_url: e.target.value })}
              />
              <input
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                placeholder="API Key env var name (e.g. VLLM_API_KEY)"
                value={newName.env_key}
                onChange={(e) => setNewName({ ...newName, env_key: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors"
              disabled={busy || !newName.name || !newName.model || !newName.api_url}
              onClick={() =>
                apply((d) => {
                  d.custom_providers.push({ ...newName, enabled: true });
                }).then(() => setNewName({ name: "", model: "", api_url: "", env_key: "" }))
              }
            >
              Add Custom Model
            </button>
          </div>
        </div>
      </details>

      {/* Footer Reset */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
          disabled={busy}
          onClick={async () => {
            if (window.confirm("Reset all AI settings to the shipped defaults?")) {
              const c = await resetAiConfig();
              setCfg(c);
              version.current = c.version;
              setSaved("Reset to defaults");
            }
          }}
        >
          Reset to Factory Defaults
        </button>
      </div>
    </div>
  );
}

function toDoc(c: AiConfig) {
  const providers: Record<string, { enabled?: boolean; model?: string; reasoning_effort?: string }> = {};
  const custom: Record<string, unknown>[] = [];
  for (const p of c.providers) {
    if (p.custom) {
      custom.push({
        name: p.name,
        model: p.model,
        api_url: p.api_url,
        env_key: p.env_key,
        enabled: p.enabled,
        reasoning_effort: p.reasoning_effort,
      });
    } else {
      providers[p.name] = {
        enabled: p.enabled,
        model: p.model,
        reasoning_effort: p.reasoning_effort,
      };
    }
  }
  return {
    providers,
    custom_providers: custom,
    chains: structuredClone(c.chains) as Record<string, string[]>,
    settings: { ...c.settings } as Record<string, number>,
    picks: { ...c.picks },
    system_prompt: c.system_prompt,
  };
}
