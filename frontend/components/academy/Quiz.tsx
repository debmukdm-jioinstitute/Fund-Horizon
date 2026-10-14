"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { academy, type AnswerResult, type ModuleContent, type QuizResult, type QuizStart } from "./api";
import { celebrate } from "./confetti";
import { Ring, Spinner, accent, btnGhost, btnPrimary, card, muted } from "./ui";

type Mode = "practice" | "exam";
const bad = "text-[#B42332] dark:text-[#FF7D86]";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Hub({ content }: { content: ModuleContent }) {
  const { me, go } = useAcademy();
  const m = content.module;
  const rows = [
    { id: m.final.id, title: m.final.title, sub: `${m.final.questions} questions · pass ${m.final.pass_pct}%` },
    { id: m.mock.id, title: "Practice exam (NISM V-A style)", sub: `${m.mock.questions} questions · ${m.mock.minutes} min · pass ${m.mock.pass_pct}%. Practice only: check the current NISM format before the real exam.` },
    ...m.checkpoints.map((c, i) => ({ id: c.id, title: `Checkpoint quiz ${i + 1}`, sub: "The checks from three lessons" })),
  ];
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <button className={`text-[15px] ${accent} underline`} onClick={() => go({ m: m.id })}>← {m.title} path</button>
        <h2 className="text-xl font-semibold mt-2">Quizzes</h2>
        <p className={`text-[15px] ${muted}`}>Practice mode gives feedback after each answer. Exam mode is timed and shows results at the end. Scores are checked on the server.</p>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const b = me?.quiz_best[r.id];
          return (
            <li key={r.id} className={`${card} p-4 flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <div className="text-[15px] font-semibold">{r.title}{b?.passed && <span className={`ml-2 ${accent}`}>✓ passed</span>}</div>
                <div className={`text-sm ${muted}`}>{r.sub}{b ? ` · best ${b.score}/${b.total}` : ""}</div>
              </div>
              <div className="flex gap-2">
                <button className={btnPrimary} onClick={() => go({ m: m.id, v: "quiz", q: r.id, mode: "practice" })}>Practice</button>
                <button className={btnGhost} onClick={() => go({ m: m.id, v: "quiz", q: r.id, mode: "exam" })}>Exam</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Runner({ content, quizId, mode, only, onExit, onRetry, onRetake }: {
  content: ModuleContent; quizId: string; mode: Mode; only?: string[]; onExit: () => void; onRetry: (ids: string[]) => void; onRetake: () => void;
}) {
  const { go, reward } = useAcademy();
  const [att, setAtt] = useState<QuizStart | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [fb, setFb] = useState<Record<string, AnswerResult>>({});
  const [combo, setCombo] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<number | null>(null);
  const deadline = useRef(0);
  const submitted = useRef(false);

  useEffect(() => {
    let live = true;
    academy.quizStart(quizId, mode, only).then((a) => {
      if (!live) return;
      setAtt(a);
      if (a.time_limit_s) { deadline.current = Date.now() + a.time_limit_s * 1000; setLeft(a.time_limit_s); }
    }).catch((e: Error) => setErr(e.message));
    return () => { live = false; };
  }, [quizId, mode, only]);

  const submit = useCallback(async () => {
    if (!att || submitted.current) return;
    submitted.current = true;
    try {
      const r = await academy.quizSubmit(quizId, att.attempt_id, answers);
      setResult(r);
      reward(r);
      if (r.passed) void celebrate();
    } catch (e) { submitted.current = false; setErr((e as Error).message); }
  }, [att, quizId, answers, reward]);

  useEffect(() => {
    if (left === null || result) return;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) void submit();
    }, 1000);
    return () => window.clearInterval(t);
  }, [left === null, result, submit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !att) return <p role="alert" className={bad}>{err} <button className="underline" onClick={onExit}>Back</button></p>;
  if (!att) return <Spinner label="Preparing your quiz" />;

  if (result) {
    const lessonLink = (id: string | null) => id && go({ m: content.module.id, l: id, v: "read" });
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div aria-live="polite" role="status" className={`${card} p-6 flex flex-wrap items-center gap-6`}>
          <Ring value={result.score / result.total} size={96} label="Score">{result.score}/{result.total}</Ring>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{result.timed_out ? "Time ran out" : result.passed ? "✓ Passed" : "✗ Not passed yet"}</h2>
            <p className="text-[15px]">{att.title}: {result.score} of {result.total} correct. Pass mark {result.pass_pct}%.</p>
            <p className={`text-[15px] ${accent} font-medium`}>{result.xp_awarded > 0 ? `+${result.xp_awarded} XP earned` : only ? "Retry rounds do not earn XP." : "No new XP this time."}</p>
          </div>
        </div>
        {result.missed.length > 0 && (
          <section aria-label="Missed questions" className="space-y-3">
            <h3 className="text-lg font-semibold">Review what you missed ({result.missed.length})</h3>
            {result.missed.map((m) => (
              <div key={m.id} className={`${card} p-4 space-y-2 text-[15px]`}>
                <p className="font-medium">{m.q}</p>
                <p className={bad}>✗ Your answer: {m.chosen === null ? "no answer" : m.options[m.chosen]}</p>
                <p className={accent}>✓ Correct answer: {m.options[m.correct]}</p>
                <p className={muted}>{m.why}</p>
                {m.lesson_id && <button className={`${accent} underline`} onClick={() => lessonLink(m.lesson_id)}>Review in lesson →</button>}
              </div>
            ))}
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {result.missed.length > 0 && <button className={btnPrimary} onClick={() => onRetry(result.missed.map((m) => m.id))}>Retry wrong only</button>}
          {result.missed.length > 0 && (
            <button className={btnGhost} disabled={added !== null} onClick={async () => setAdded((await academy.addMissed(result.attempt_id)).cards_added)}>
              {added === null ? "Add missed to flashcards" : `${added} flashcards added`}
            </button>
          )}
          <button className={btnGhost} onClick={onRetake}>Retake</button>
          <button className={btnGhost} onClick={onExit}>All quizzes</button>
        </div>
      </div>
    );
  }

  const q = att.questions[idx];
  const r = fb[q.id];
  const answered = Object.keys(answers).length;
  const choose = async (i: number) => {
    if (r) return;
    setAnswers((a) => ({ ...a, [q.id]: i }));
    if (mode === "practice") {
      try {
        const res = await academy.quizAnswer(att.attempt_id, q.id, i);
        setFb((f) => ({ ...f, [q.id]: res }));
        setCombo((c) => (res.correct ? c + 1 : 0));
        reward(res);
      } catch (e) { setErr((e as Error).message); }
    }
  };
  const last = idx === att.questions.length - 1;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <button className={`text-[15px] ${accent} underline`} onClick={onExit}>← Quit quiz</button>
        <div className="flex items-center gap-4 text-[15px]">
          {mode === "practice" && combo >= 3 && <span aria-label={`Combo ${combo}`} className="font-semibold">🔥×{combo}</span>}
          {left !== null && <span role="timer" className={`font-mono ${left < 60 ? bad : ""}`}>⏱ {mmss(left)}</span>}
        </div>
      </div>
      <h2 className="text-lg font-semibold">{att.title} · {mode === "exam" ? "Exam" : "Practice"}</h2>
      <ol className="flex flex-wrap gap-1" aria-label="Progress">
        {att.questions.map((x, i) => (
          <li key={x.id}>
            <button aria-label={`Question ${i + 1} of ${att.questions.length}${answers[x.id] !== undefined ? ", answered" : ""}`} aria-current={i === idx ? "step" : undefined}
              onClick={() => (mode === "exam" || answers[x.id] !== undefined || i <= idx) && setIdx(i)}
              className={`h-3 w-3 rounded-full border ${i === idx ? "border-[#006F64] dark:border-[#75E1CE] scale-125" : "border-[#536176] dark:border-[#A8B4C4]"} ${answers[x.id] !== undefined ? "bg-[#006F64] dark:bg-[#75E1CE]" : ""}`} />
          </li>
        ))}
      </ol>
      <fieldset className={`${card} p-6 space-y-3`}>
        <legend className="text-base font-semibold px-1">{idx + 1}. {q.q}</legend>
        {q.o.map((o, i) => {
          const picked = answers[q.id] === i;
          const right = r && r.correct_choice === i;
          const wrong = r && picked && !right;
          return (
            <label key={i} className={`flex items-start gap-3 rounded-md border p-3 text-[15px] ${r ? "" : "cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]"} ${right ? "border-[#006F64] dark:border-[#75E1CE]" : wrong ? "border-[#B42332] dark:border-[#FF7D86]" : picked ? "border-[#006F64] dark:border-[#75E1CE]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
              <input type="radio" name={q.id} className="mt-1 h-4 w-4" checked={picked} disabled={!!r} onChange={() => void choose(i)} />
              <span>{o}{right && <strong className={`ml-2 ${accent}`}>✓ Correct</strong>}{wrong && <strong className={`ml-2 ${bad}`}>✗ Incorrect</strong>}</span>
            </label>
          );
        })}
      </fieldset>
      <div aria-live="polite" className="text-[15px] min-h-6">
        {r && <p><strong className={r.correct ? accent : bad}>{r.correct ? "Correct." : "Not quite."}</strong> <span className={muted}>{r.why}</span>{r.lesson_id && !r.correct && <> <button className={`${accent} underline`} onClick={() => go({ m: content.module.id, l: r.lesson_id!, v: "read" })}>Review in lesson</button></>}</p>}
      </div>
      {err && <p role="alert" className={bad}>{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <button className={btnGhost} disabled={idx === 0 || mode === "practice"} onClick={() => setIdx(idx - 1)}>← Back</button>
        {last ? (
          <button className={btnPrimary} disabled={mode === "practice" ? !r : false} onClick={() => void submit()}>{mode === "exam" ? `Submit exam (${answered}/${att.questions.length} answered)` : "Finish"}</button>
        ) : (
          <button className={btnPrimary} disabled={mode === "practice" && !r} onClick={() => setIdx(idx + 1)}>Next →</button>
        )}
      </div>
    </div>
  );
}

export function Quiz({ content, quizId, mode }: { content: ModuleContent; quizId?: string; mode: Mode }) {
  const { go } = useAcademy();
  const [nonce, setNonce] = useState(0);
  const [only, setOnly] = useState<string[] | undefined>(undefined);
  const exit = () => { setOnly(undefined); go({ m: content.module.id, v: "quiz" }); };
  if (!quizId) return <Hub content={content} />;
  return (
    <Runner key={`${quizId}:${mode}:${nonce}`} content={content} quizId={quizId} mode={mode} only={only} onExit={exit}
      onRetry={(ids) => { setOnly(ids); setNonce((n) => n + 1); }} onRetake={() => { setOnly(undefined); setNonce((n) => n + 1); }} />
  );
}
