"use client";

import React, { useEffect, useMemo, useState } from "react";
import data from "@/lib/learn-data.json";

type Block = { t: "p"; text: string } | { t: "ul"; items: string[] } | { t: "table"; rows: string[][] };
type Track = (typeof data)[number];
type Kind = "manual" | "slides" | "script" | "flash" | "quiz";

const KINDS: { id: Kind; label: string }[] = [
  { id: "manual", label: "Manual" },
  { id: "slides", label: "Slides" },
  { id: "script", label: "Video script" },
  { id: "flash", label: "Flash cards" },
  { id: "quiz", label: "Quiz" },
];
// manual embeds its own quiz table; the interactive Quiz tab replaces it
const manualSections = (t: Track) => t.manual.sections.filter((s) => !s.title.startsWith("Quiz"));

const card = "border border-[#E4E9EF] dark:border-[#2B3644] rounded bg-[#FFFFFF] dark:bg-[#10151C]";
const muted = "text-[#536176] dark:text-[#A8B4C4]";
const accent = "text-[#006F64] dark:text-[#75E1CE]";
const chip = (on: boolean) =>
  `px-2 py-1 rounded text-[12px] border transition-colors ${
    on
      ? "bg-[#E7F5F2] dark:bg-[#1A3034] border-transparent font-medium " + accent
      : `border-[#E4E9EF] dark:border-[#2B3644] ${muted} hover:text-[#172033] dark:hover:text-[#EDF2F7]`
  }`;

function useStore<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s) setV(JSON.parse(s));
    } catch {}
  }, [key]);
  return [v, (n) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch {} }];
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.t === "p" ? (
          <p key={i} className="text-[13px] leading-relaxed">{b.text}</p>
        ) : b.t === "ul" ? (
          <ul key={i} className="list-disc pl-5 space-y-1 text-[13px] leading-relaxed">
            {b.items.map((x, j) => <li key={j}>{x}</li>)}
          </ul>
        ) : (
          <div key={i} className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>{b.rows[0].map((h, j) => (
                  <th key={j} className={`text-left font-medium p-2 border-b border-[#E4E9EF] dark:border-[#2B3644] ${muted}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {b.rows.slice(1).map((r, j) => (
                  <tr key={j} className="align-top">{r.map((c, k) => (
                    <td key={k} className="p-2 border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">{c}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}

function Manual({ t }: { t: Track }) {
  const secs = manualSections(t);
  const [open, setOpen] = useState(1);
  return (
    <div className="space-y-2">
      {t.manual.intro.map((x, i) => <p key={i} className={`text-[12px] ${muted}`}>{x}</p>)}
      {secs.map((s, i) => (
        <div key={s.title} className={card}>
          <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}
            className="w-full flex items-center justify-between p-3 text-left text-[13px] font-medium">
            <span>{s.title}</span><span className={muted}>{open === i ? "−" : "+"}</span>
          </button>
          {open === i && (
            <div className="px-3 pb-3 space-y-3">
              {s.subs.map((sub, j) => (
                <div key={j} className="space-y-2">
                  {sub.title && <h4 className={`text-[12px] font-semibold uppercase tracking-wide ${accent}`}>{sub.title}</h4>}
                  <Blocks blocks={sub.blocks as Block[]} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Slides({ t }: { t: Track }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {t.slides.map((lines, i) => (
        <div key={i} className={`${card} p-3`}>
          <div className={`text-[10px] font-mono ${muted}`}>SLIDE {i + 1}</div>
          <div className={`text-[11px] uppercase tracking-wide ${accent}`}>{lines[0]}</div>
          <div className="text-[14px] font-medium mb-1">{lines[1]}</div>
          <ul className={`text-[12px] space-y-0.5 ${muted}`}>{lines.slice(2).map((l, j) => <li key={j}>{l}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function Script({ t }: { t: Track }) {
  return (
    <div className="space-y-2">
      {t.script.map((s) => (
        <div key={s.n} className={`${card} p-3`}>
          <div className={`text-[11px] font-mono ${muted}`}>SLIDE {s.n} · {s.stage} · ~{s.time}</div>
          <div className="text-[13px] font-medium mb-1">{s.title}</div>
          <p className="text-[13px] leading-relaxed">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

function Flash({ t }: { t: Track }) {
  const secs = useMemo(() => Array.from(new Set(t.flash.map((c) => c.sec))), [t]);
  const [sec, setSec] = useState("all");
  const [known, setKnown] = useStore<number[]>(`learn.${t.id}.known`, []);
  const [shown, setShown] = useState<number | null>(null);
  const cards = t.flash.filter((c) => sec === "all" || c.sec === sec);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {["all", ...secs].map((s) => <button key={s} onClick={() => setSec(s)} className={chip(sec === s)}>{s === "all" ? "All" : s}</button>)}
      </div>
      <div className={`text-[12px] ${muted}`}>{known.filter((n) => t.flash.some((c) => c.n === n)).length} of {t.flash.length} marked known · click a card to reveal</div>
      <div className="grid gap-2 md:grid-cols-2">
        {cards.map((c) => {
          const isK = known.includes(c.n), open = shown === c.n;
          return (
            <div key={c.n} className={`${card} p-3 ${isK ? "opacity-70" : ""}`}>
              <button onClick={() => setShown(open ? null : c.n)} className="w-full text-left">
                <div className={`text-[10px] font-mono ${muted}`}>CARD {c.n} · {c.sec}</div>
                <div className="text-[13px] font-medium">{c.q}</div>
              </button>
              {open && (
                <div className="mt-2 pt-2 border-t border-[#E4E9EF] dark:border-[#2B3644] space-y-1 text-[12px]">
                  {c.a.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              )}
              <button onClick={() => setKnown(isK ? known.filter((n) => n !== c.n) : [...known, c.n])}
                className={`mt-2 text-[11px] ${isK ? accent : muted} hover:underline`}>
                {isK ? "✓ Known" : "Mark known"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Quiz({ t }: { t: Track }) {
  const [ans, setAns] = useState<Record<number, number>>({});
  const [done, setDone] = useState(false);
  const [best, setBest] = useStore<number>(`learn.${t.id}.best`, -1);
  const score = t.quiz.filter((q) => ans[q.n] === q.a).length;
  const pass = Math.ceil(t.quiz.length * 0.8);
  let last = "";
  return (
    <div className="space-y-3">
      <div className={`text-[12px] ${muted}`}>
        {t.quiz.length} questions · pass mark {pass}/{t.quiz.length}{best >= 0 && ` · best ${best}/${t.quiz.length}`}
      </div>
      {t.quiz.map((q) => {
        const head = q.sec !== last ? q.sec : "";
        last = q.sec;
        return (
          <div key={q.n}>
            {head && <h4 className={`text-[12px] font-semibold uppercase tracking-wide mt-3 mb-1 ${accent}`}>{head}</h4>}
            <div className={`${card} p-3 space-y-1.5`}>
              <div className="text-[13px] font-medium">{q.n}. {q.q}</div>
              {q.o.map((o, i) => {
                const picked = ans[q.n] === i;
                const tone = done ? (i === q.a ? "border-[#006F64] dark:border-[#75E1CE]" : picked ? "border-[#B42332] dark:border-[#FF7D86]" : "border-transparent") : picked ? "border-[#006F64] dark:border-[#75E1CE]" : "border-transparent";
                return (
                  <button key={i} disabled={done} onClick={() => setAns({ ...ans, [q.n]: i })}
                    className={`w-full text-left text-[12px] px-2 py-1.5 rounded border ${tone} bg-[#F7F9FB] dark:bg-[#171E27]`}>
                    <span className="font-mono mr-2">{"ABCD"[i]}</span>{o}
                  </button>
                );
              })}
              {done && <div className={`text-[12px] ${muted}`}>{ans[q.n] === q.a ? "Correct. " : `Answer: ${"ABCD"[q.a]}. `}{q.why}</div>}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        {!done ? (
          <button disabled={Object.keys(ans).length < t.quiz.length}
            onClick={() => { setDone(true); if (score > best) setBest(score); }}
            className="px-3 py-1.5 rounded text-[13px] bg-[#006F64] text-white disabled:opacity-40">
            Submit ({Object.keys(ans).length}/{t.quiz.length})
          </button>
        ) : (
          <>
            <span className={`text-[13px] font-medium ${score >= pass ? accent : "text-[#B42332] dark:text-[#FF7D86]"}`}>
              {score}/{t.quiz.length} · {score >= pass ? "Pass" : "Below pass mark: repeat the module"}
            </span>
            <button onClick={() => { setAns({}); setDone(false); }} className={chip(false)}>Retake</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function LearnPage() {
  const [tid, setTid] = useState(data[0].id);
  const [kind, setKind] = useState<Kind>("manual");
  const t = data.find((x) => x.id === tid)!;
  const counts: Record<Kind, string> = {
    manual: `${manualSections(t).length} sections`, slides: `${t.slides.length} slides`,
    script: `${t.script.length} scenes`, flash: `${t.flash.length} cards`, quiz: `${t.quiz.length} questions`,
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold">Learn</h1>
        <p className={`text-[12px] ${muted}`}>L.E.A.R.N. distributor training: Learn the basics, Evaluate the client, Act right, Review &amp; rebalance, Navigate behaviour.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[230px_1fr]">
        <nav aria-label="Learning tracks" className="space-y-3">
          {data.map((tr) => (
            <div key={tr.id}>
              <button onClick={() => setTid(tr.id)} className="w-full text-left">
                <div className={`text-[10px] font-mono uppercase ${muted}`}>{tr.code}</div>
                <div className={`text-[13px] font-semibold ${tr.id === tid ? accent : ""}`}>{tr.title} track</div>
              </button>
              {tr.id === tid && (
                <ul className="mt-1 ml-1 pl-2 border-l border-[#E4E9EF] dark:border-[#2B3644] space-y-0.5">
                  {KINDS.map((k) => (
                    <li key={k.id}>
                      <button onClick={() => setKind(k.id)}
                        className={`w-full flex justify-between px-2 py-1 rounded text-[12px] ${kind === k.id ? "bg-[#E7F5F2] dark:bg-[#1A3034] " + accent + " font-medium" : muted + " hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]"}`}>
                        <span>{k.label}</span><span className="text-[10px]">{counts[k.id]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
        <section key={tid + kind} className="min-w-0">
          <div className={`text-[12px] mb-2 ${muted}`}>{t.title} track · {KINDS.find((k) => k.id === kind)!.label} — {t.blurb}</div>
          {kind === "manual" && <Manual t={t} />}
          {kind === "slides" && <Slides t={t} />}
          {kind === "script" && <Script t={t} />}
          {kind === "flash" && <Flash t={t} />}
          {kind === "quiz" && <Quiz t={t} />}
        </section>
      </div>
    </div>
  );
}
