"use client";

import React from "react";
import { useAcademy } from "./AcademyContext";
import { Certificate } from "./Certificate";
import { Bar, Ring, Spinner, accent, btnGhost, btnPrimary, card, muted } from "./ui";

const PATH = ["Beginner", "Intermediate", "Expert"];

export function Home() {
  const { me, go } = useAcademy();
  if (!me) return <Spinner label="Loading your Academy" />;
  const span = Math.max(1, me.next_level_xp - me.level_floor_xp);
  const earned = new Set(me.badges.map((b) => b.id));
  const nl = me.next_lesson;
  // module order and titles come from the server (/me), so a new module needs no UI change
  const mods = Object.entries(me.progress);
  const [firstMid, firstP] = mods[0] ?? ["mf", null];
  const heroMid = nl?.module ?? firstMid;
  const heroLesson = nl?.lesson_id ?? "";
  return (
    <div className="space-y-6">
      <section className={`${card} p-6 flex flex-wrap items-center justify-between gap-4`}>
        <div>
          {me.new_here ? (
            <>
              <h2 className="text-xl font-semibold">👋 New here? Start with {firstP?.title ?? "Module 1"} → Lesson 1</h2>
              <p className={`text-[15px] ${muted}`}>Short lessons, flashcards and quizzes. Your first lesson takes about 5 minutes.</p>
            </>
          ) : nl ? (
            <>
              <h2 className="text-xl font-semibold">Continue: {nl.title}</h2>
              <p className={`text-[15px] ${muted}`}>About {nl.minutes} min left in this lesson.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">All lessons complete 🎉</h2>
              <p className={`text-[15px] ${muted}`}>Take a final quiz or review your flashcards to keep your streak.</p>
            </>
          )}
        </div>
        <button className={btnPrimary} onClick={() => go({ m: heroMid, l: heroLesson, v: "read" })}>
          {me.new_here ? "Start Lesson 1" : nl ? "Continue lesson" : `Open ${firstP?.title ?? "Module 1"}`}
        </button>
      </section>

      <section aria-label="Your stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${card} p-4`}>
          <div className={`text-sm ${muted}`}>🔥 Streak</div>
          <div className="text-2xl font-semibold">{me.streak} day{me.streak === 1 ? "" : "s"}</div>
          <div className={`text-sm ${muted}`}>{me.freezes} freeze{me.freezes === 1 ? "" : "s"} saved</div>
        </div>
        <div className={`${card} p-4 space-y-1`}>
          <div className={`text-sm ${muted}`}>⭐ Level {me.level} · {me.level_name}</div>
          <div className="text-2xl font-semibold">{me.xp} XP</div>
          <Bar value={(me.xp - me.level_floor_xp) / span} label="Progress to next level" />
          <div className={`text-sm ${muted}`}>{Math.max(0, me.next_level_xp - me.xp)} XP to level {me.level + 1}</div>
        </div>
        <button className={`${card} p-4 text-left hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]`} onClick={() => go({ m: heroMid, v: "cards" })}>
          <div className={`text-sm ${muted}`}>🃏 Cards due today</div>
          <div className="text-2xl font-semibold">{me.due_count}</div>
          <div className={`text-sm ${accent}`}>Review now →</div>
        </button>
        <button className={`${card} p-4 text-left hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]`} onClick={() => go({ v: "board" })}>
          <div className={`text-sm ${muted}`}>🏆 Rank this week</div>
          <div className="text-2xl font-semibold">{me.week_rank ? `#${me.week_rank}` : "—"}</div>
          <div className={`text-sm ${accent}`}>{me.week_xp} XP this week →</div>
        </button>
      </section>

      <section aria-label="Modules" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {mods.map(([mid, p]) => {
          const frac = p.total ? p.done / p.total : 0;
          const stage = frac < 1 / 3 ? 0 : frac < 2 / 3 ? 1 : 2;
          return (
            <div key={mid} className={`${card} p-6 space-y-4`}>
              <div className="flex items-center gap-4">
                <Ring value={frac} size={64} label={`${p.title} progress`} />
                <div>
                  <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{p.code}</p>
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className={`text-[15px] ${muted}`}>{p.done}/{p.total} lessons{p.minutes_left ? ` · about ${p.minutes_left} min left` : ""}</p>
                </div>
              </div>
              <p className={`text-[15px] ${muted}`}>{p.blurb}</p>
              <ol className="flex items-center gap-2 text-sm" aria-label="Path">
                {PATH.map((s, i) => (
                  <li key={s} aria-current={i === stage ? "step" : undefined} className={`flex items-center gap-2 ${i === stage ? `${accent} font-semibold` : muted}`}>
                    {i > 0 && <span aria-hidden="true">→</span>}{s}
                  </li>
                ))}
              </ol>
              {p.next && <p className="text-[15px]"><span className={muted}>Next: </span>{p.next.title} <span className={muted}>({p.next.minutes} min)</span></p>}
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} onClick={() => go({ m: mid })}>{p.done ? "Open path" : "Start path"}</button>
                <button className={btnGhost} onClick={() => go({ m: mid, v: "cards" })}>Flashcards</button>
                <button className={btnGhost} onClick={() => go({ m: mid, v: "quiz" })}>Quizzes</button>
              </div>
            </div>
          );
        })}
      </section>

      {me.certificate && <Certificate />}

      <section aria-label="Taxation guide" className={`${card} p-6 space-y-3`}>
        <p className="text-xs font-bold uppercase tracking-wider text-[#0176D3]">Fund Horizon material</p>
        <h3 className="text-lg font-semibold">Taxation guide — PMS, mutual funds, equity and F&O</h3>
        <p className={`text-[15px] ${muted}`}>
          Four plain-English guides with rates for FY 2026-27, worked examples and return forms. Reading material only — it tracks nothing and earns no XP.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={() => go({ tax: "1" })}>Open taxation guides →</button>
        </div>
      </section>

      <section aria-label="Varsity external learning" className={`${card} border-dashed p-6 space-y-3`}>
        <p className="text-xs font-bold uppercase tracking-wider text-[#B45309]">External learning · Not FH training</p>
        <h3 className="text-lg font-semibold">Zerodha Varsity library</h3>
        <p className={`text-[15px] ${muted}`}>
          Eight focus modules listed in full, with chapters linked to the original pages on zerodha.com; seven more modules are shown in a “Later” section and
          come in a later release. Reading Varsity chapters tracks progress but does not earn XP.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={() => go({ varsity: "1" })}>Open Varsity library →</button>
        </div>
      </section>

      <section aria-label="Badges" className={`${card} p-6 space-y-4`}>
        <h3 className="text-lg font-semibold">Badges</h3>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {me.badge_defs.map((b) => {
            const on = earned.has(b.id);
            return (
              <li key={b.id} className={`flex items-center gap-4 rounded-md border border-[#E4E9EF] dark:border-[#2B3644] p-4 ${on ? "" : "opacity-70"}`}>
                <span aria-hidden="true" className={`text-2xl ${on ? "" : "grayscale"}`}>{on ? b.icon : "🔒"}</span>
                <div>
                  <div className="text-[15px] font-semibold">{b.name}</div>
                  <div className={`text-sm ${muted}`}>{on ? "Earned" : b.hint}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
