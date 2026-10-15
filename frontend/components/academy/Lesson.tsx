"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { academy, type AnswerResult, type Lesson as LessonT, type ModuleContent, type QuizStart } from "./api";
import { Markdown } from "./Markdown";
import { LEVEL_LABEL, accent, btnGhost, btnPrimary, card, muted } from "./ui";

function useReadingProgress(ref: React.RefObject<HTMLElement>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      setP(total <= 0 ? 1 : Math.max(0, Math.min(1, -r.top / total)));
    };
    on();
    window.addEventListener("scroll", on, true); // capture: works whichever ancestor scrolls
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [ref]);
  return p;
}

function QuickCheck({ lesson }: { lesson: LessonT }) {
  const { reward } = useAcademy();
  const [attempt, setAttempt] = useState<QuizStart | null>(null);
  const [fb, setFb] = useState<Record<string, AnswerResult>>({});
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");
  const start = async () => {
    try { setAttempt(await academy.quizStart(`lesson:${lesson.id}`, "practice")); } catch (e) { setErr((e as Error).message); }
  };
  const answer = async (qid: string, i: number) => {
    if (!attempt || fb[qid]) return;
    setPicked((p) => ({ ...p, [qid]: i }));
    try {
      const r = await academy.quizAnswer(attempt.attempt_id, qid, i);
      setFb((f) => ({ ...f, [qid]: r }));
      reward(r);
    } catch (e) { setErr((e as Error).message); }
  };
  const done = attempt && Object.keys(fb).length === attempt.questions.length;
  const right = Object.values(fb).filter((x) => x.correct).length;
  return (
    <section aria-label="Quick check" className={`${card} p-6 space-y-4`}>
      <h3 className="text-lg font-semibold">Quick check</h3>
      {!attempt ? (
        <div className="space-y-2">
          <p className={`text-[15px] ${muted}`}>Three questions. +5 XP for each correct first answer.</p>
          <button className={btnGhost} onClick={start}>Start quick check</button>
        </div>
      ) : (
        attempt.questions.map((q, qi) => {
          const r = fb[q.id];
          return (
            <fieldset key={q.id} className="space-y-2">
              <legend className="text-[15px] font-medium mb-2">{qi + 1}. {q.q}</legend>
              {q.o.map((o, i) => {
                const isPick = picked[q.id] === i;
                const isRight = r && r.correct_choice === i;
                return (
                  <label key={i} className={`flex items-start gap-3 rounded-md border p-3 text-[15px] cursor-pointer ${isRight ? "border-[#0176D3] dark:border-[#1B96FF]" : r && isPick ? "border-[#B42332] dark:border-[#FF7D86]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
                    <input type="radio" name={q.id} checked={isPick} disabled={!!r} onChange={() => void answer(q.id, i)} className="mt-1 h-4 w-4" />
                    <span>{o}{isRight && <strong className={`ml-2 ${accent}`}>✓ Correct answer</strong>}{r && isPick && !isRight && <strong className="ml-2 text-[#B42332] dark:text-[#FF7D86]">✗ Not quite</strong>}</span>
                  </label>
                );
              })}
              {r && <p className={`text-[15px] ${muted}`}>{r.why}</p>}
            </fieldset>
          );
        })
      )}
      <div aria-live="polite" className="text-[15px] font-medium">{done ? `${right} of ${attempt!.questions.length} correct on the first try.` : ""}</div>
      {err && <p role="alert" className="text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
    </section>
  );
}

export function Lesson({ content, lessonId }: { content: ModuleContent; lessonId: string }) {
  const { me, go, reward, openGlossary } = useAcademy();
  const ref = useRef<HTMLElement>(null);
  const progress = useReadingProgress(ref);
  const idx = content.lessons.findIndex((l) => l.id === lessonId);
  const lesson = content.lessons[idx];
  const [busy, setBusy] = useState(false);
  const done = !!me?.completed_lessons.includes(lessonId);
  if (!lesson) return <p className={muted}>Lesson not found. <button className="underline" onClick={() => go({ m: content.module.id })}>Back to the path</button></p>;
  const prev = content.lessons[idx - 1];
  const next = content.lessons[idx + 1];
  const complete = async () => {
    setBusy(true);
    try { reward(await academy.completeLesson(lesson.id)); } finally { setBusy(false); }
  };
  return (
    <article ref={ref} className="mx-auto max-w-[720px] space-y-6">
      {/* fixed under the 52px top bar (the layout's <main> is overflow-y-auto, which would stop a sticky bar from sticking) */}
      <div role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="fixed top-[52px] left-0 right-0 md:left-[210px] z-20 h-1 bg-[#E4E9EF] dark:bg-[#2B3644]">
        <div className="h-full bg-[#0176D3] dark:bg-[#1B96FF]" style={{ width: `${progress * 100}%` }} />
      </div>
      <header className="space-y-2">
        <button className={`text-[15px] ${accent} underline`} onClick={() => go({ m: content.module.id })}>← {content.module.title} path</button>
        <p className={`text-sm ${muted}`}>Lesson {idx + 1} of {content.lessons.length} · 🕒 {lesson.minutes} min · {LEVEL_LABEL[lesson.level] ?? lesson.level}</p>
        <h2 className="text-2xl font-semibold leading-tight">{lesson.title}</h2>
        <button className={btnGhost} onClick={() => openGlossary()}>📖 Glossary</button>
      </header>

      <section aria-label="Objectives" className={`${card} p-4`}>
        <h3 className="text-[15px] font-semibold mb-2">After this lesson you can</h3>
        <ul className="list-disc pl-6 text-[15px] space-y-1">{lesson.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
      </section>

      <Markdown text={lesson.body_md} terms={lesson.key_terms} />

      <section aria-label="Worked example" className={`${card} p-4 border-l-4 border-l-[#0176D3] dark:border-l-[#1B96FF]`}>
        <h3 className="text-[15px] font-semibold mb-1">Worked example</h3>
        <p className="text-base leading-relaxed">{lesson.example}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-label="Say this to clients" className={`${card} p-4`}>
          <h3 className={`text-[15px] font-semibold mb-2 ${accent}`}>✓ Say this to clients</h3>
          <ul className="space-y-2 text-[15px]">{lesson.say.map((s) => <li key={s}>“{s}”</li>)}</ul>
        </section>
        <section aria-label="Never say" className={`${card} p-4`}>
          <h3 className="text-[15px] font-semibold mb-2 text-[#B42332] dark:text-[#FF7D86]">✗ Never say</h3>
          <ul className="space-y-2 text-[15px]">{lesson.never.map((s) => <li key={s}>“{s}”</li>)}</ul>
        </section>
      </div>

      {lesson.talk_track.length > 0 && (
        <details className={`${card} p-4`}>
          <summary className="cursor-pointer text-[15px] font-semibold">Talk track (video script)</summary>
          <div className="mt-3 space-y-3">
            {lesson.talk_track.map((t) => (
              <div key={t.n}><h4 className="text-[15px] font-medium">{t.title}</h4><p className={`text-[15px] leading-relaxed ${muted}`}>{t.text}</p></div>
            ))}
          </div>
        </details>
      )}

      <QuickCheck key={lesson.id} lesson={lesson} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className={btnGhost} disabled={!prev} onClick={() => prev && go({ m: content.module.id, l: prev.id, v: "read" })}>← Previous</button>
        {done ? <span className={`text-[15px] font-medium ${accent}`}>✓ Lesson complete</span> : <button className={btnPrimary} disabled={busy} onClick={complete}>Complete lesson (+10 XP)</button>}
        <button className={btnGhost} disabled={!next} onClick={() => next && go({ m: content.module.id, l: next.id, v: "read" })}>Next →</button>
      </div>
      {lesson.card_ids.length > 0 && (
        <p className="text-[15px]"><button className={`${accent} underline`} onClick={() => go({ m: content.module.id, l: lesson.id, v: "cards", deck: "lesson" })}>Practise this lesson’s {lesson.card_ids.length} flashcards →</button></p>
      )}
    </article>
  );
}
