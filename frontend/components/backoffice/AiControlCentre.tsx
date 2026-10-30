"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getAiConfig, getAiStatus, resetAiConfig, saveAiConfig, testAiProvider,
  type AiConfig, type AiProvider, type AiStat,
} from "@/lib/backoffice";

const MUTED = "text-[#706E6B] dark:text-[#A8B4C4]";
const CARD = "rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] p-3 space-y-2";
const INPUT = "terminal-btn py-1 px-2 text-[12px]";
const ist = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + " IST" : "never");

function health(s: AiStat | undefined, keyOk: boolean, enabled: boolean): { label: string; cls: string } {
  if (!enabled) return { label: "Off", cls: "bg-[#EEF1F5] dark:bg-[#202936]" };
  if (!keyOk) return { label: "No API key", cls: "bg-[#FDE7E9] text-[#9B1C2E] dark:bg-[#3A1519] dark:text-[#FFA9B5]" };
  if (s && s.cooldown_remaining_s > 0) return { label: `Cooling down ${s.cooldown_remaining_s}s`, cls: "bg-[#FFF4D6] text-[#7A5600] dark:bg-[#3A2E0A] dark:text-[#FBBF24]" };
  if (s && s.consecutive_failures > 0) return { label: "Failing", cls: "bg-[#FDE7E9] text-[#9B1C2E] dark:bg-[#3A1519] dark:text-[#FFA9B5]" };
  if (s && s.ok > 0) return { label: "Healthy", cls: "bg-[#E3F6E8] text-[#1E6B3A] dark:bg-[#0F2A1B] dark:text-[#7EE2A0]" };
  return { label: "Not used yet", cls: "bg-[#EEF1F5] dark:bg-[#202936]" };
}

export default function AiControlCentre() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState({ name: "", model: "", api_url: "", env_key: "" });
  const editing = useRef(false);
  const version = useRef(0);

  const load = useCallback(async () => {
    try { const c = await getAiConfig(); setCfg(c); version.current = c.version; setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Could not load AI settings."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Live: poll health every 3s; if another admin changed the config, reload it (unless this admin is mid-edit).
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = await getAiStatus();
        setCfg((c) => (c ? { ...c, ...s } : c));
        if (s.version !== version.current && !editing.current) void load();
      } catch { /* keep the last good view */ }
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Every control applies at once: build the full desired document from the view, send it, show what the server stored.
  const apply = async (mut: (d: ReturnType<typeof toDoc>) => void) => {
    if (!cfg) return;
    const doc = toDoc(cfg);
    mut(doc);
    setBusy(true);
    try { const c = await saveAiConfig(doc); setCfg(c); version.current = c.version; setSaved(`Applied ${ist(c.updated_at)}`); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Save failed."); await load(); } finally { setBusy(false); editing.current = false; }
  };

  if (!cfg) return <p className={`text-[12px] ${MUTED}`}>{err ?? "Loading AI settings…"}</p>;
  const byName = Object.fromEntries(cfg.providers.map((p) => [p.name, p]));

  const move = (chain: string, i: number, d: number) => apply((doc) => { const a = doc.chains[chain]; const j = i + d; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; });
  const remove = (chain: string, i: number) => apply((doc) => { if (doc.chains[chain].length > 1) doc.chains[chain].splice(i, 1); });
  const add = (chain: string, name: string) => name && apply((doc) => { if (!doc.chains[chain].includes(name)) doc.chains[chain].push(name); });
  const test = async (name: string) => {
    setTests((t) => ({ ...t, [name]: "testing…" }));
    try { const r = await testAiProvider(name); setTests((t) => ({ ...t, [name]: r.ok ? `OK in ${r.ms} ms (${r.model})` : `Failed: ${r.error}` })); } catch (e) { setTests((t) => ({ ...t, [name]: e instanceof Error ? e.message : "Test failed" })); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[18px] font-semibold text-[#181818] dark:text-[#EDF2F7]">AI control centre</h2>
          <p className={`text-[12px] ${MUTED}`}>Pick the model used first, set fallbacks and tune behaviour. Changes apply to the next request, on every server.</p>
        </div>
        <div className={`text-[11px] ${MUTED}`}>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2E844A] mr-1" />Live · v{cfg.version} · last change {ist(cfg.updated_at)}{cfg.updated_by ? ` by ${cfg.updated_by}` : ""}
          {busy ? " · saving…" : saved ? ` · ${saved}` : ""}
        </div>
      </div>
      {err && <p className="text-[12px] text-[#B42332]" role="alert">{err}</p>}
      {cfg.mock_active && <p className="text-[12px] text-[#7A5600]">A test override (FH_MOCK_LLM_RESPONSE) is set on the server: every call returns the canned text.</p>}

      {Object.entries(cfg.chain_labels).map(([chain, label]) => (
        <section key={chain} className={CARD}>
          <h3 className="font-semibold text-[13px]">{label}</h3>
          <ol className="space-y-1">
            {cfg.chains[chain].map((n, i) => {
              const p = byName[n]; const h = health(cfg.stats[n], p?.key_present ?? false, p?.enabled ?? false);
              return (
                <li key={n} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${i === 0 ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C]" : "bg-[#EEF1F5] dark:bg-[#202936]"}`}>{i === 0 ? "Primary" : `Fallback ${i}`}</span>
                  <strong>{n}</strong><span className={MUTED}>{p?.model}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${h.cls}`}>{h.label}</span>
                  <span className="ml-auto flex gap-1">
                    <button type="button" className={INPUT} disabled={i === 0 || busy} onClick={() => move(chain, i, -1)} aria-label={`Move ${n} up`}>↑</button>
                    <button type="button" className={INPUT} disabled={i === cfg.chains[chain].length - 1 || busy} onClick={() => move(chain, i, 1)} aria-label={`Move ${n} down`}>↓</button>
                    <button type="button" className={INPUT} disabled={cfg.chains[chain].length < 2 || busy} onClick={() => remove(chain, i)} aria-label={`Remove ${n}`}>✕</button>
                  </span>
                </li>
              );
            })}
          </ol>
          <select className={INPUT} value="" onChange={(e) => add(chain, e.target.value)} aria-label={`Add a model to ${label}`}>
            <option value="">+ add fallback…</option>
            {cfg.providers.filter((p) => !cfg.chains[chain].includes(p.name)).map((p) => <option key={p.name} value={p.name}>{p.name} · {p.model}</option>)}
          </select>
        </section>
      ))}

      <section className={CARD}>
        <h3 className="font-semibold text-[13px]">Models and health</h3>
        <ul className="space-y-3">
          {cfg.providers.map((p: AiProvider) => {
            const s = cfg.stats[p.name]; const h = health(s, p.key_present, p.enabled);
            return (
              <li key={p.name} className="space-y-1 text-[12px] border-t border-[#E5E5E5] dark:border-[#2B3644] pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={p.enabled} disabled={busy} onChange={(e) => apply((d) => { d.providers[p.name] = { ...d.providers[p.name], enabled: e.target.checked }; })} /><strong>{p.name}</strong></label>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${h.cls}`}>{h.label}</span>
                  {!p.key_present && p.env_key && <span className={MUTED}>set {p.env_key} on the server</span>}
                  <button type="button" className={`${INPUT} ml-auto`} onClick={() => test(p.name)}>Test</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input className={`${INPUT} flex-1 min-w-[12rem]`} defaultValue={p.model} key={`${p.name}-${p.model}`} aria-label={`${p.name} model`}
                    onFocus={() => { editing.current = true; }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.model) void apply((d) => { d.providers[p.name] = { ...d.providers[p.name], model: v }; }); else editing.current = false; }} />
                  <select className={INPUT} value={p.reasoning_effort} disabled={busy} aria-label={`${p.name} reasoning effort`}
                    onChange={(e) => apply((d) => { d.providers[p.name] = { ...d.providers[p.name], reasoning_effort: e.target.value }; })}>
                    {cfg.efforts.map((x) => <option key={x} value={x}>{x ? `effort: ${x}` : "effort: default"}</option>)}
                  </select>
                  {p.model !== p.base_model && !p.custom && <button type="button" className={INPUT} onClick={() => apply((d) => { d.providers[p.name] = { ...d.providers[p.name], model: p.base_model }; })}>Reset model</button>}
                </div>
                <div className={MUTED}>
                  {s ? `${s.ok} ok / ${s.fail} failed · last answer ${s.last_latency_ms ?? "n/a"} ms · last success ${ist(s.last_ok_at)}` : "no calls yet"}
                  {s?.last_error ? ` · last error: ${s.last_error}` : ""}{tests[p.name] ? ` · test: ${tests[p.name]}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={CARD}>
        <h3 className="font-semibold text-[13px]">Behaviour</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
          {Object.entries(cfg.settings).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between gap-2">{k.replace(/_/g, " ")}
              <input type="number" className={`${INPUT} w-24`} defaultValue={v} key={`${k}-${v}`} step={k === "temperature" ? 0.1 : 1} min={cfg.limits[k][0]} max={cfg.limits[k][1]}
                onFocus={() => { editing.current = true; }}
                onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== v) void apply((d) => { d.settings[k] = n; }); else editing.current = false; }} />
            </label>
          ))}
        </div>
        <p className={`text-[11px] ${MUTED}`}>A model that fails repeatedly is skipped for the cooldown period, then tried again.</p>
      </section>

      <section className={CARD}>
        <h3 className="font-semibold text-[13px]">Fund picks (OpenAI)</h3>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.picks.enabled} onChange={(e) => apply((d) => { d.picks = { ...d.picks, enabled: e.target.checked }; })} />Use AI for plan picks (off = fixed rule)</label>
          <input className={`${INPUT} min-w-[10rem]`} defaultValue={cfg.picks.model} key={cfg.picks.model} aria-label="Picks model" onFocus={() => { editing.current = true; }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== cfg.picks.model) void apply((d) => { d.picks = { ...d.picks, model: v }; }); else editing.current = false; }} />
          <select className={INPUT} value={cfg.picks.effort} onChange={(e) => apply((d) => { d.picks = { ...d.picks, effort: e.target.value }; })} aria-label="Picks reasoning effort">
            {cfg.efforts.map((x) => <option key={x} value={x}>{x ? `effort: ${x}` : "effort: default"}</option>)}
          </select>
        </div>
      </section>

      <details className={CARD}>
        <summary className="cursor-pointer font-semibold text-[13px]">System prompt and custom models</summary>
        <textarea className={`${INPUT} w-full h-40 mt-2`} defaultValue={cfg.system_prompt} key={`sp-${cfg.version}`} onFocus={() => { editing.current = true; }}
          onBlur={(e) => { const v = e.target.value; if (v.trim() !== cfg.system_prompt.trim()) void apply((d) => { d.system_prompt = v; }); else editing.current = false; }} aria-label="System prompt" />
        <p className={`text-[11px] ${MUTED}`}>Wording and number checks (banned words, figures must come from the data) are enforced in code and cannot be switched off here.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
          {(["name", "model", "api_url", "env_key"] as const).map((k) => (
            <input key={k} className={INPUT} placeholder={{ name: "name (e.g. mymodel)", model: "model id", api_url: "https://…/v1/chat/completions", env_key: "API key env var (e.g. MY_API_KEY)" }[k]} value={newName[k]} onChange={(e) => setNewName({ ...newName, [k]: e.target.value })} aria-label={k} />
          ))}
        </div>
        <button type="button" className="terminal-btn mt-2 py-1 px-2 text-[12px]" disabled={busy || !newName.name || !newName.model || !newName.api_url}
          onClick={() => apply((d) => { d.custom_providers.push({ ...newName, enabled: true }); }).then(() => setNewName({ name: "", model: "", api_url: "", env_key: "" }))}>Add OpenAI-compatible model</button>
        <p className={`text-[11px] ${MUTED}`}>API keys are never entered or stored here. Add the key to the server environment under the variable name you give.</p>
      </details>

      <button type="button" className="terminal-btn py-1 px-2.5 text-[12px]" disabled={busy} onClick={async () => { if (window.confirm("Reset all AI settings to the shipped defaults?")) { const c = await resetAiConfig(); setCfg(c); version.current = c.version; setSaved("Reset to defaults"); } }}>Reset to defaults</button>
    </div>
  );
}

function toDoc(c: AiConfig) {
  const providers: Record<string, { enabled?: boolean; model?: string; reasoning_effort?: string }> = {};
  const custom: Record<string, unknown>[] = [];
  for (const p of c.providers) {
    if (p.custom) custom.push({ name: p.name, model: p.model, api_url: p.api_url, env_key: p.env_key, enabled: p.enabled, reasoning_effort: p.reasoning_effort });
    else providers[p.name] = { enabled: p.enabled, model: p.model, reasoning_effort: p.reasoning_effort };
  }
  return { providers, custom_providers: custom, chains: structuredClone(c.chains) as Record<string, string[]>, settings: { ...c.settings } as Record<string, number>, picks: { ...c.picks }, system_prompt: c.system_prompt };
}
