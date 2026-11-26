"use client";

import React from "react";
import { useAcademy } from "./AcademyContext";
import { Certificate } from "./Certificate";
import { ModuleCard, TrackSection } from "./Tracks";
import { Bar, Collapse, Spinner, accent, btnGhost, btnPrimary, card, muted } from "./ui";

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
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnGhost} onClick={() => go({ guide: "1" })}>
            📋 Process Note
          </button>
          <button className={btnPrimary} onClick={() => go({ m: heroMid, l: heroLesson, v: "read" })}>
            {me.new_here ? "Start Lesson 1" : nl ? "Continue lesson" : `Open ${firstP?.title ?? "Module 1"}`}
          </button>
        </div>
      </section>

      {/* Intent-based Navigator: "Choose your path" */}
      <section aria-label="Learning Pathways by Need" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#172033] dark:text-[#EDF2F7]">Choose your learning path</h2>
            <p className={`text-sm ${muted}`}>Jump directly into what you need based on your role and daily goals.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Path 1: New Joiner & Operations SOP */}
          <div className={`${card} p-5 flex flex-col justify-between space-y-3 border-l-4 border-l-[#0176D3] dark:border-l-[#1B96FF] hover:shadow-md transition`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">📋</span>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-[#0176D3] dark:text-[#1B96FF] border border-[#0176D3]/20">
                  SOP &amp; Process
                </span>
              </div>
              <h3 className="text-base font-bold text-[#172033] dark:text-[#EDF2F7]">New Joiner Guide</h3>
              <p className={`text-[13px] ${muted} leading-relaxed`}>
                Process handover, recurring daily/monthly task deadlines, official forms, valuation, CRM, and 5-day roadmap.
              </p>
            </div>
            <button
              type="button"
              className={`${btnPrimary} w-full text-xs py-2`}
              onClick={() => go({ guide: "1" })}
            >
              Open Process Note →
            </button>
          </div>

          {/* Path 2: NISM Certification & Lessons */}
          <div className={`${card} p-5 flex flex-col justify-between space-y-3 border-l-4 border-l-emerald-600 hover:shadow-md transition`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🎓</span>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-600/20">
                  NISM &amp; Skills
                </span>
              </div>
              <h3 className="text-base font-bold text-[#172033] dark:text-[#EDF2F7]">Modules &amp; Certification</h3>
              <p className={`text-[13px] ${muted} leading-relaxed`}>
                Interactive study paths for NISM V-A distributor certification, flashcards, chapter quizzes, and streak XP.
              </p>
            </div>
            <a
              href="#tracks-section"
              className={`${btnGhost} w-full text-xs py-2 text-center`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById("tracks-section");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Explore Modules ({mods.length}) ↓
            </a>
          </div>

          {/* Path 3: Taxation Reference */}
          <div className={`${card} p-5 flex flex-col justify-between space-y-3 border-l-4 border-l-amber-600 hover:shadow-md transition`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">🧾</span>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-600/20">
                  FY 2026-27 Rates
                </span>
              </div>
              <h3 className="text-base font-bold text-[#172033] dark:text-[#EDF2F7]">Taxation Reference</h3>
              <p className={`text-[13px] ${muted} leading-relaxed`}>
                Plain-English client guides for PMS, Mutual Funds, Equity, and F&amp;O taxation with worked capital gains examples.
              </p>
            </div>
            <button
              type="button"
              className={`${btnGhost} w-full text-xs py-2`}
              onClick={() => go({ tax: "1" })}
            >
              Open Taxation Guide →
            </button>
          </div>

          {/* Path 4: Zerodha Varsity Library */}
          <div className={`${card} p-5 flex flex-col justify-between space-y-3 border-l-4 border-l-purple-600 hover:shadow-md transition`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xl" aria-hidden="true">📚</span>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-600/20">
                  External Reading
                </span>
              </div>
              <h3 className="text-base font-bold text-[#172033] dark:text-[#EDF2F7]">Zerodha Varsity</h3>
              <p className={`text-[13px] ${muted} leading-relaxed`}>
                Curated foundational reading on technical analysis, options, futures, currency, and macro economics.
              </p>
            </div>
            <button
              type="button"
              className={`${btnGhost} w-full text-xs py-2`}
              onClick={() => go({ varsity: "1" })}
            >
              Open Varsity Library →
            </button>
          </div>
        </div>
      </section>

      <Collapse id="home-stats" title="Your stats" meta={`${me.streak}-day streak · ${me.xp} XP`}>
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
      </Collapse>

      <div id="tracks-section" className="space-y-4">
        {me.tracks?.length > 0 ? (
          <>
            <nav aria-label="Tracks" className="flex flex-wrap gap-2">
              {me.tracks.map((t) => <a key={t.id} href={`#track-${t.id}`} className={`${btnGhost} min-h-8`}>{t.title}</a>)}
            </nav>
            {me.tracks.map((t) => <TrackSection key={t.id} track={t} />)}
          </>
        ) : (
          <section aria-label="Modules" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mods.map(([mid, p]) => <ModuleCard key={mid} mid={mid} p={p} />)}
          </section>
        )}
      </div>

      {me.certificate && <Certificate />}

      <Collapse id="home-tax" title="Taxation guide" defaultOpen={false}>
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
      </Collapse>

      <Collapse id="home-varsity" title="Zerodha Varsity library" defaultOpen={false}>
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
      </Collapse>

      <Collapse id="home-badges" title="Badges" meta={`${earned.size}/${me.badge_defs.length} earned`} defaultOpen={false}>
      <section aria-label="Badges" className={`${card} p-6 space-y-4`}>
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
      </Collapse>
    </div>
  );
}
