"use client";

import React, { useState } from "react";
import { useAcademy } from "./AcademyContext";
import type { ModuleContent } from "./api";
import { LEVEL_LABEL, btnGhost, card, muted, accent } from "./ui";

export function ModulePath({ content }: { content: ModuleContent }) {
  const { me, go } = useAcademy();
  const [src, setSrc] = useState(false);
  const m = content.module;
  const done = new Set(me?.completed_lessons ?? []);
  const current = (m.lessons ?? []).find((l) => !done.has(l.id))?.id;
  const cps = new Map((m.checkpoints ?? []).map((c, i) => [c.after, { id: c.id, n: i + 1 }]));
  const best = me?.quiz_best ?? {};
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
        <button className={`text-[15px] ${accent} underline`} onClick={() => go({})}>← Academy home</button>
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
      <ol aria-label={`${m.title} lessons`}>
        {(m.lessons ?? []).flatMap((l, i) => {
          const state = done.has(l.id) ? "done" : l.id === current ? "current" : "open";
          const out = [node(l.id, `${i + 1}. ${l.title}`, `🕒 ${l.minutes} min · ${LEVEL_LABEL[l.level] ?? l.level}`, () => go({ m: m.id, l: l.id, v: "read" }), state, state === "done" ? "✓" : String(i + 1))];
          const cp = cps.get(l.id);
          if (cp) {
            const b = best[cp.id];
            out.push(node(cp.id, `Checkpoint quiz ${cp.n}`, b ? `Best ${b.score}/${b.total}${b.passed ? " · passed" : ""}` : "Check the last 3 lessons", () => go({ m: m.id, v: "quiz", q: cp.id }), b?.passed ? "done" : "open", b?.passed ? "✓" : "?"));
          }
          return out;
        })}
        {node("final", m.final.title, `${m.final.questions} questions · pass ${m.final.pass_pct}%${best[m.final.id] ? ` · best ${best[m.final.id].score}/${best[m.final.id].total}` : ""}`, () => go({ m: m.id, v: "quiz", q: m.final.id }), best[m.final.id]?.passed ? "done" : "open", best[m.final.id]?.passed ? "✓" : "🎯")}
        {node("cert", "Certificate", me?.certificate ? "Ready to print on the Academy home page" : `Pass all ${Object.keys(me?.progress ?? {}).length} module final quizzes to unlock`, () => go({}), me?.certificate ? "done" : "open", "🏆")}
      </ol>
      <div className={`${card} p-4`}>
        <button className="text-[15px] font-medium" aria-expanded={src} onClick={() => setSrc(!src)}>{src ? "−" : "+"} Sources</button>
        {src && <ul className={`mt-2 list-disc pl-6 text-[15px] space-y-1 ${muted}`}>{(m.sources ?? []).map((s) => <li key={s}>{s}</li>)}<li>Check regulatory details against current rules before each training cycle.</li></ul>}
      </div>
    </div>
  );
}
