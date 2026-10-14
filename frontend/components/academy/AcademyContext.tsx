"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { academy, type GlossaryEntry, type Me, type ModuleContent, type Reward } from "./api";
import { celebrate } from "./confetti";
import { card, muted } from "./ui";

export type Go = (params: Record<string, string | undefined>, replace?: boolean) => void;

interface Ctx {
  me: Me | null;
  refresh: () => Promise<Me | null>;
  reward: (r: Reward, extra?: string) => void;
  loadModule: (id: string) => Promise<ModuleContent>;
  glossary: GlossaryEntry[];
  openGlossary: (term?: string) => void;
  go: Go;
}

const AcademyCtx = createContext<Ctx | null>(null);
export const useAcademy = () => {
  const c = useContext(AcademyCtx);
  if (!c) throw new Error("useAcademy outside provider");
  return c;
};

export function AcademyProvider({ go, children }: { go: Go; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [toast, setToast] = useState("");
  const [drawer, setDrawer] = useState<string | null>(null);
  const cache = useRef<Record<string, Promise<ModuleContent>>>({});

  const refresh = useCallback(async () => {
    try {
      const m = await academy.me();
      setMe(m);
      return m;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const loadModule = useCallback((id: string) => {
    cache.current[id] ??= academy.content(id).then((c) => {
      setGlossary((g) => (g.length ? g : c.glossary));
      return c;
    });
    cache.current[id].catch(() => delete cache.current[id]);
    return cache.current[id];
  }, []);

  const reward = useCallback((r: Reward, extra?: string) => {
    const parts = [r.xp_awarded > 0 ? `+${r.xp_awarded} XP` : "", r.level_up ? "Level up!" : "", ...(r.new_badges ?? []).map((b) => `Badge: ${b.replaceAll("_", " ")}`), extra ?? ""].filter(Boolean);
    if (parts.length) {
      setToast(parts.join(" · "));
      window.setTimeout(() => setToast(""), 4000);
    }
    if (r.level_up || (r.new_badges?.length ?? 0) > 0) void celebrate();
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, refresh, reward, loadModule, glossary, openGlossary: (t?: string) => { if (!glossary.length) void loadModule("mf"); setDrawer(t ?? ""); }, go }), [me, refresh, reward, loadModule, glossary, go]);

  return (
    <AcademyCtx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="fixed bottom-4 right-4 z-50 pointer-events-none">
        {toast && <div className={`${card} px-4 py-2 text-[15px] font-medium shadow-lg`}>{toast}</div>}
      </div>
      {drawer !== null && <GlossaryDrawer initial={drawer} onClose={() => setDrawer(null)} />}
    </AcademyCtx.Provider>
  );
}

function GlossaryDrawer({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { glossary } = useAcademy();
  const [q, setQ] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); prev?.focus(); };
  }, [onClose]);
  const list = glossary.filter((g) => !q.trim() || `${g.term} ${g.aliases.join(" ")} ${g.definition}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Glossary" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full overflow-y-auto bg-[#FFFFFF] dark:bg-[#10151C] border-l border-[#E4E9EF] dark:border-[#2B3644] p-6 space-y-4 animate-[slidein_.2s_ease-out] motion-reduce:animate-none">
        <style>{`@keyframes slidein{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}`}</style>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Glossary</h2>
          <button onClick={onClose} className="text-[15px] underline">Close</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms" aria-label="Search glossary"
          className="w-full min-h-10 px-3 rounded-md border border-[#E4E9EF] dark:border-[#2B3644] bg-transparent text-[15px]" />
        <dl className="space-y-4">
          {list.map((g) => (
            <div key={g.term}>
              <dt className="font-semibold text-[15px]">{g.term}</dt>
              <dd className={`text-[15px] leading-relaxed ${muted}`}>{g.definition}</dd>
            </div>
          ))}
          {!list.length && <p className={muted}>No matching term.</p>}
        </dl>
      </div>
    </div>
  );
}
