"use client";

import React, { useState } from "react";
import { useAcademy } from "./AcademyContext";
import type { ModuleContent } from "./api";
import { LEVEL_LABEL, btnGhost, card, muted, accent } from "./ui";

export const STAGE_LABEL: Record<string, string> = { L: "Learn", E: "Explore the client", A: "Advise", R: "Review", N: "Navigate behaviour", Niche: "Niche topics", Practice: "Role-play practice", Compliance: "Compliance" };
export const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;

export function ModulePath({ content }: { content: ModuleContent }) {
  const { me, go } = useAcademy();
  const [src, setSrc] = useState(false);
  const [sylOpen, setSylOpen] = useState(false);
  const m = content.module;
  const done = new Set(me?.completed_lessons ?? []);
  const current = (m.lessons ?? []).find((l) => !done.has(l.id))?.id;
  const cps = new Map((m.checkpoints ?? []).map((c, i) => [c.after, { id: c.id, n: i + 1 }]));
  const best = me?.quiz_best ?? {};
  const track = me?.tracks?.find((t) => t.modules.includes(m.id));
  const nav = me?.nav?.[m.id] ?? m.nav;
  const title = (id: string) => me?.progress[id]?.title ?? id;
  const core = Object.values(me?.progress ?? {}).filter((p) => !p.track).length;
  const groups: { stage: string; items: { l: (typeof m.lessons)[number]; i: number }[] }[] = [];
  (m.lessons ?? []).forEach((l, i) => {
    const g = groups[groups.length - 1];
    if (g && g.stage === l.stage) g.items.push({ l, i }); else groups.push({ stage: l.stage, items: [{ l, i }] });
  });
  const curGroup = groups.findIndex((g) => g.items.some(({ l }) => l.id === current));
  const [openG, setOpenG] = useState<Record<number, boolean>>({});
  const isOpen = (gi: number) => openG[gi] ?? (gi === Math.max(0, curGroup));
  const node = (key: string, title: string, sub: string, onClick: () => void, state: "done" | "current" | "open", mark: string) => (
    <li key={key} className="relative pl-12 pb-6 last:pb-0">
      <span aria-hidden="true" className={`absolute left-0 top-0 h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${state === "done" ? "bg-[#0176D3] border-[#0176D3] text-white dark:bg-[#1B96FF] dark:border-[#1B96FF] dark:text-[#10151C]" : state === "current" ? "border-[#0176D3] dark:border-[#1B96FF] " + accent : "border-[#E4E9EF] dark:border-[#2B3644] " + muted}`}>{mark}</span>
      <span aria-hidden="true" className="absolute left-4 top-8 bottom-0 w-px bg-[#E4E9EF] dark:bg-[#2B3644] last:hidden" />
      <button onClick={onClick} aria-current={state === "current" ? "step" : undefined} className="text-left group">
        <span className="block text-[15px] font-medium group-hover:underline">{title}</span>
        <span className={`block text-sm ${muted}`}>{sub}</span>
      </button>
    </li>
  );
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <nav aria-label="Breadcrumb" className="text-[15px]">
          <button className={`${accent} underline`} onClick={() => go({})}>Academy</button>
          {track && <> <span className={muted}>›</span> <button className={`${accent} underline`} onClick={() => go({ t: track.id })}>{track.title}</button></>}
          {" "}<span className={muted}>›</span> <span>{m.code}</span>
        </nav>
        <h2 className="text-xl font-semibold mt-2">{m.title}</h2>
        <p className={`text-[15px] ${muted}`}>{m.blurb}</p>
      </div>
      {!!m.overview.outcomes?.length && (
        <div className={`${card} p-4 space-y-2`}>
          <h3 className="text-[15px] font-semibold">By the end you can</h3>
          <ul className="list-disc pl-6 text-[15px] space-y-1">{m.overview.outcomes.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} onClick={() => go({ m: m.id, v: "cards" })}>🃏 Flashcards</button>
        <button className={btnGhost} onClick={() => go({ m: m.id, v: "quiz" })}>📝 Quizzes and mock exam</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Lessons by stage</h3>
        <button className={`text-[15px] ${accent} underline`} onClick={() => setOpenG(Object.fromEntries(groups.map((_, gi) => [gi, !groups.every((__, k) => isOpen(k))])))}>
          {groups.every((_, gi) => isOpen(gi)) ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {groups.map((g, gi) => {
        const n = g.items.filter(({ l }) => done.has(l.id)).length;
        const open = isOpen(gi);
        return (
          <section key={gi} aria-label={stageLabel(g.stage)} className={`${card} p-4`}>
            <button className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpenG({ ...openG, [gi]: !open })}>
              <span className="text-[15px] font-semibold">{open ? "−" : "+"} {stageLabel(g.stage)}</span>
              <span className={`text-sm ${muted}`}>{n}/{g.items.length} done</span>
            </button>
            {open && (
              <ol className="mt-4" aria-label={`${stageLabel(g.stage)} lessons`}>
                {g.items.flatMap(({ l, i }) => {
                  const state = done.has(l.id) ? "done" : l.id === current ? "current" : "open";
                  const out = [node(l.id, `${i + 1}. ${l.title}`, `🕒 ${l.minutes} min · ${LEVEL_LABEL[l.level] ?? l.level}`, () => go({ m: m.id, l: l.id, v: "read" }), state, state === "done" ? "✓" : String(i + 1))];
                  const cp = cps.get(l.id);
                  if (cp) {
                    const b = best[cp.id];
                    out.push(node(cp.id, `Checkpoint quiz ${cp.n}`, b ? `Best ${b.score}/${b.total}${b.passed ? " · passed" : ""}` : "Check the last 3 lessons", () => go({ m: m.id, v: "quiz", q: cp.id }), b?.passed ? "done" : "open", b?.passed ? "✓" : "?"));
                  }
                  return out;
                })}
              </ol>
            )}
          </section>
        );
      })}
      <ol aria-label="Finish">
        {node("final", m.final.title, `${m.final.questions} questions · pass ${m.final.pass_pct}%${best[m.final.id] ? ` · best ${best[m.final.id].score}/${best[m.final.id].total}` : ""}`, () => go({ m: m.id, v: "quiz", q: m.final.id }), best[m.final.id]?.passed ? "done" : "open", best[m.final.id]?.passed ? "✓" : "🎯")}
        {m.track
          ? node("cert", "Exam-prep module", "Practice for the NISM exam; it is not part of the Academy certificate", () => go({ t: track?.id }), "open", "🎓")
          : node("cert", "Certificate", me?.certificate ? "Ready to print on the Academy home page" : `Pass all ${core} core module final quizzes to unlock`, () => go({}), me?.certificate ? "done" : "open", "🏆")}
      </ol>
      {!!m.syllabus?.length && (
        <div className={`${card} p-4`}>
          <button className="text-[15px] font-medium" aria-expanded={sylOpen} onClick={() => setSylOpen(!sylOpen)}>{sylOpen ? "−" : "+"} Syllabus coverage ({m.syllabus.length} topics, every lesson mapped)</button>
          {sylOpen && (
            <ul className="mt-3 space-y-3">
              {m.syllabus.map((s) => (
                <li key={s.topic}>
                  <p className="text-[15px] font-medium">{s.topic}</p>
                  <p className={`text-sm ${muted}`}>
                    {s.lessons.map((id, k) => {
                      const idx = (m.lessons ?? []).findIndex((l) => l.id === id);
                      return <React.Fragment key={id}>{k > 0 && " · "}<button className={`${accent} underline`} onClick={() => go({ m: m.id, l: id, v: "read" })}>Lesson {idx + 1}</button></React.Fragment>;
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!!(nav?.prereq?.length || nav?.related?.length) && (
        <div className={`${card} p-4 space-y-2`}>
          {!!nav?.prereq?.length && <p className="text-[15px]"><span className={muted}>Best taken after: </span>{nav.prereq.map((x, i) => <React.Fragment key={x}>{i > 0 && ", "}<button className={`${accent} underline`} onClick={() => go({ m: x })}>{title(x)}</button></React.Fragment>)}</p>}
          {!!nav?.related?.length && <p className="text-[15px]"><span className={muted}>Related modules: </span>{nav.related.map((x, i) => <React.Fragment key={x}>{i > 0 && ", "}<button className={`${accent} underline`} onClick={() => go({ m: x })}>{title(x)}</button></React.Fragment>)}</p>}
        </div>
      )}
      <div className={`${card} p-4`}>
        <button className="text-[15px] font-medium" aria-expanded={src} onClick={() => setSrc(!src)}>{src ? "−" : "+"} Sources</button>
        {src && <ul className={`mt-2 list-disc pl-6 text-[15px] space-y-1 ${muted}`}>{(m.sources ?? []).map((s) => <li key={s}>{s}</li>)}<li>Check regulatory details against current rules before each training cycle.</li></ul>}
      </div>
    </div>
  );
}
