"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { academy, type Card, type DueCard, type ModuleContent } from "./api";
import { celebrate } from "./confetti";
import { Bar, Spinner, accent, btnGhost, btnPrimary, card, chip, muted } from "./ui";

type Fsrs = typeof import("ts-fsrs");
const DECKS = [["due", "Due today"], ["lesson", "By lesson"], ["all", "Shuffle all"], ["unknown", "Unknown only"]] as const;
const RATINGS = [[1, "Again"], [2, "Hard"], [3, "Good"], [4, "Easy"]] as const;

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Rebuild an FSRS card from the JSON the server stored (dates come back as strings). */
export function restoreCard(f: Fsrs, s: Record<string, unknown> | null) {
  const base = f.createEmptyCard(new Date());
  if (!s) return base;
  const { _r, due, last_review, ...rest } = s as Record<string, unknown>;
  void _r;
  return { ...base, ...rest, due: new Date(due as string), ...(last_review ? { last_review: new Date(last_review as string) } : {}) } as typeof base;
}

export function Flashcards({ content, deck, lessonId }: { content: ModuleContent; deck: string; lessonId?: string }) {
  const { go, reward, refresh } = useAcademy();
  const mid = content.module.id;
  const byId = useRef(new Map<string, Card>(content.cards.map((c) => [c.id, c])));
  const fsrs = useRef<{ lib: Fsrs; f: ReturnType<Fsrs["fsrs"]> } | null>(null);
  const [queue, setQueue] = useState<DueCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [today, setToday] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [xp, setXp] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [err, setErr] = useState("");
  const [lesson, setLesson] = useState(lessonId ?? content.lessons.find((l) => l.card_ids.length)?.id ?? "");
  const kind = (DECKS.find((d) => d[0] === deck) ?? DECKS[0])[0];

  const load = useCallback(async () => {
    setQueue(null); setFlipped(false); setXp(0); setReviewed(0); setErr("");
    try {
      if (!fsrs.current) {
        const lib = await import("ts-fsrs");
        fsrs.current = { lib, f: lib.fsrs(lib.generatorParameters({ enable_fuzz: true })) };
      }
      const r = await academy.cards(mid, kind, kind === "lesson" ? lesson : undefined);
      const list = kind === "all" || kind === "unknown" ? shuffle(r.cards) : r.cards;
      setQueue(list); setTotal(list.length); setToday(r.reviewed_today);
    } catch (e) { setErr((e as Error).message); setQueue([]); }
  }, [mid, kind, lesson]);
  useEffect(() => { void load(); }, [load]);

  const current = queue?.[0];
  const rate = useCallback(async (rating: 1 | 2 | 3 | 4) => {
    if (!current || !fsrs.current) return;
    const { lib, f } = fsrs.current;
    const next = f.repeat(restoreCard(lib, current.fsrs), new Date())[rating as import("ts-fsrs").Grade].card;
    setFlipped(false);
    setQueue((q) => (q ? q.slice(1) : q));
    setReviewed((n) => n + 1);
    try {
      const r = await academy.reviewCard(current.id, rating, JSON.parse(JSON.stringify(next)), next.due.toISOString());
      setXp((x) => x + r.xp_awarded);
      setToday((n) => n + 1);
      reward(r);
    } catch (e) { setErr((e as Error).message); }
  }, [current, reward]);

  const finished = queue !== null && queue.length === 0 && reviewed > 0;
  useEffect(() => { if (finished) { void celebrate(); void refresh(); } }, [finished, refresh]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && t.tagName !== "BUTTON" && current) { e.preventDefault(); setFlipped((f) => !f); }
      if (flipped && ["1", "2", "3", "4"].includes(e.key)) void rate(Number(e.key) as 1 | 2 | 3 | 4);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [current, flipped, rate]);

  const c = current ? byId.current.get(current.id) : undefined;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <button className={`text-[15px] ${accent} underline`} onClick={() => go({ m: mid })}>← {content.module.title} path</button>
        <h2 className="text-xl font-semibold mt-2">Flashcards</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Deck">
        {DECKS.map(([k, label]) => <button key={k} className={chip(kind === k)} aria-pressed={kind === k} onClick={() => go({ m: mid, v: "cards", deck: k, l: k === "lesson" ? lesson : undefined })}>{label}</button>)}
        {kind === "lesson" && (
          <select aria-label="Lesson deck" value={lesson} onChange={(e) => { setLesson(e.target.value); go({ m: mid, v: "cards", deck: "lesson", l: e.target.value }, true); }}
            className="min-h-8 rounded-md border border-[#E4E9EF] dark:border-[#2B3644] bg-transparent px-2 text-sm">
            {content.lessons.filter((l) => l.card_ids.length).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        )}
      </div>
      {queue === null && !err && <Spinner label="Loading cards" />}
      {err && <p role="alert" className="text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
      {queue && total > 0 && (
        <div className="space-y-1">
          <Bar value={(total - queue.length) / total} label="Deck progress" />
          <p className={`text-sm ${muted}`}>{total - queue.length}/{total} this session · {today} reviewed today</p>
        </div>
      )}
      {queue && queue.length === 0 && !finished && !err && <p className={`${card} p-6 text-[15px]`}>No cards in this deck right now. Try “Shuffle all”, or come back when cards are due.</p>}
      {finished && (
        <div className={`${card} p-6 space-y-3 text-center`}>
          <h3 className="text-xl font-semibold">Session complete 🎉</h3>
          <p className="text-[15px]">{reviewed} card{reviewed === 1 ? "" : "s"} reviewed · <strong>+{xp} XP</strong></p>
          <div className="flex justify-center gap-2"><button className={btnPrimary} onClick={() => void load()}>Review more</button><button className={btnGhost} onClick={() => go({})}>Academy home</button></div>
        </div>
      )}
      {c && (
        <div className="space-y-4">
          <div className="[perspective:1200px]">
            <div className="grid min-h-[240px] transition-transform duration-500 motion-reduce:transition-none [transform-style:preserve-3d]" style={{ transform: flipped ? "rotateY(180deg)" : "none" }}>
              <div aria-hidden={flipped} className={`${card} [grid-area:1/1] p-6 flex flex-col items-center justify-center text-center gap-4 [backface-visibility:hidden]`}>
                <p className={`text-sm ${muted}`}>Question</p>
                <p className="text-lg font-medium">{c.q}</p>
              </div>
              <div aria-hidden={!flipped} className={`${card} [grid-area:1/1] p-6 flex flex-col items-center justify-center text-center gap-2 [backface-visibility:hidden] [transform:rotateY(180deg)]`}>
                <p className={`text-sm ${muted}`}>Answer</p>
                {c.a.map((l, i) => <p key={i} className="text-base">{l}</p>)}
              </div>
            </div>
          </div>
          {!flipped ? (
            <button className={`${btnPrimary} w-full`} aria-expanded={false} onClick={() => setFlipped(true)}>Show answer <span className="text-sm opacity-80">(Space)</span></button>
          ) : (
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
              {RATINGS.map(([n, label]) => <button key={n} className={btnGhost} onClick={() => void rate(n)}>{label} <span className={`text-sm ${muted}`}>({n})</span></button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
