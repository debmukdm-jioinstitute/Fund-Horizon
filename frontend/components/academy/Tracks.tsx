"use client";

import React from "react";
import { useAcademy } from "./AcademyContext";
import type { ModuleProgress, Track } from "./api";
import { Bar, Ring, Spinner, accent, btnGhost, btnPrimary, card, muted } from "./ui";

const PATH = ["Beginner", "Intermediate", "Expert"];

export function ModuleCard({ mid, p }: { mid: string; p: ModuleProgress }) {
  const { me, go } = useAcademy();
  const frac = p.total ? p.done / p.total : 0;
  const stage = frac < 1 / 3 ? 0 : frac < 2 / 3 ? 1 : 2;
  const pre = (me?.nav?.[mid]?.prereq ?? []).filter((x) => me?.progress[x]);
  return (
    <div className={`${card} p-6 space-y-4`}>
      <div className="flex items-center gap-4">
        <Ring value={frac} size={64} label={`${p.title} progress`} />
        <div>
          <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{p.code}</p>
          <h3 className="text-lg font-semibold">{p.title}</h3>
          <p className={`text-[15px] ${muted}`}>{p.done}/{p.total} lessons{p.minutes_left ? ` · about ${p.minutes_left} min left` : ""}</p>
        </div>
      </div>
      <p className={`text-[15px] ${muted}`}>{p.blurb}</p>
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Path">
        {PATH.map((s, i) => (
          <li key={s} aria-current={i === stage ? "step" : undefined} className={`flex items-center gap-2 ${i === stage ? `${accent} font-semibold` : muted}`}>
            {i > 0 && <span aria-hidden="true">→</span>}{s}
          </li>
        ))}
      </ol>
      {pre.length > 0 && !p.done && (
        <p className={`text-sm ${muted}`}>Best after:{" "}
          {pre.map((x, i) => <React.Fragment key={x}>{i > 0 && ", "}<button className={`${accent} underline`} onClick={() => go({ m: x })}>{me!.progress[x].title}</button></React.Fragment>)}
        </p>
      )}
      {p.next && <p className="text-[15px]"><span className={muted}>Next: </span>{p.next.title} <span className={muted}>({p.next.minutes} min)</span></p>}
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={() => go({ m: mid })}>{p.done ? "Open path" : "Start path"}</button>
        <button className={btnGhost} onClick={() => go({ m: mid, v: "cards" })}>Flashcards</button>
        <button className={btnGhost} onClick={() => go({ m: mid, v: "quiz" })}>Quizzes</button>
      </div>
    </div>
  );
}

function sums(track: Track, progress: Record<string, ModuleProgress>) {
  const ms = track.modules.filter((id) => progress[id]);
  const done = ms.reduce((a, id) => a + progress[id].done, 0);
  const total = ms.reduce((a, id) => a + progress[id].total, 0);
  return { ms, done, total };
}

/** Home: one section per track, each a heading with progress and its module cards. */
export function TrackSection({ track }: { track: Track }) {
  const { me, go } = useAcademy();
  if (!me) return null;
  const { ms, done, total } = sums(track, me.progress);
  if (!ms.length) return null;
  return (
    <section id={`track-${track.id}`} aria-label={track.title} className="space-y-4 scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold">{track.title}</h2>
          <p className={`text-[15px] ${muted}`}>{track.blurb}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${muted}`}>{done}/{total} lessons · {ms.length} modules</span>
          <button className={btnGhost} onClick={() => go({ t: track.id })}>Open track →</button>
        </div>
      </div>
      <Bar value={total ? done / total : 0} label={`${track.title} progress`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{ms.map((id) => <ModuleCard key={id} mid={id} p={me.progress[id]} />)}</div>
    </section>
  );
}

/** Page for one track: recommended order with prerequisites and links onward. */
export function TrackPage({ id }: { id: string }) {
  const { me, go } = useAcademy();
  if (!me) return <Spinner label="Loading track" />;
  const track = me.tracks.find((t) => t.id === id);
  if (!track) return <p className={muted}>Track not found. <button className="underline" onClick={() => go({})}>Back to Academy home</button></p>;
  const { ms, done, total } = sums(track, me.progress);
  const exam = track.id === "nism";
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-[15px]">
        <button className={`${accent} underline`} onClick={() => go({})}>Academy</button> <span className={muted}>›</span> <span>{track.title}</span>
      </nav>
      <header className="space-y-2 max-w-3xl">
        <h2 className="text-2xl font-semibold">{track.title}</h2>
        <p className={`text-[15px] ${muted}`}>{track.blurb}</p>
        <p className={`text-sm ${muted}`}>{done}/{total} lessons done across {ms.length} modules.{exam ? " Final quizzes here are practice for the NISM exam and do not count towards the certificate." : " Suggested order is top to bottom."}</p>
        <Bar value={total ? done / total : 0} label={`${track.title} progress`} />
      </header>
      <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={`${track.title} modules in order`}>
        {ms.map((mid, i) => (
          <li key={mid} className="space-y-2">
            <p className={`text-sm font-semibold ${muted}`}>Step {i + 1}</p>
            <ModuleCard mid={mid} p={me.progress[mid]} />
          </li>
        ))}
      </ol>
      {me.tracks.length > 1 && (
        <p className={`text-[15px] ${muted}`}>Other tracks:{" "}
          {me.tracks.filter((t) => t.id !== id).map((t, i) => <React.Fragment key={t.id}>{i > 0 && " · "}<button className={`${accent} underline`} onClick={() => go({ t: t.id })}>{t.title}</button></React.Fragment>)}
        </p>
      )}
    </div>
  );
}
