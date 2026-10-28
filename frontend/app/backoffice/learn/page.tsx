"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AcademyProvider, useAcademy, type Go } from "@/components/academy/AcademyContext";
import type { ModuleContent } from "@/components/academy/api";
import { Flashcards } from "@/components/academy/Flashcards";
import { Home } from "@/components/academy/Home";
import { Leaderboard } from "@/components/academy/Leaderboard";
import { Lesson } from "@/components/academy/Lesson";
import { migrateLegacyProgress } from "@/components/academy/migrate";
import { ModulePath } from "@/components/academy/ModulePath";
import { Quiz } from "@/components/academy/Quiz";
import { Spinner, accent, btnGhost, muted } from "@/components/academy/ui";
import { VarsityDetail, VarsityHub } from "@/components/academy/Varsity";
import { TaxationHub, TaxationPage } from "@/components/academy/Taxation";

/* FH Academy. All navigation state lives in the URL: /backoffice/learn?m=mf&l=<lessonId>&v=read|cards|quiz
   (plus v=board, q=<quizId>, mode=practice|exam, deck=due|lesson|all|unknown). The read, cards and quiz views stay
   mounted once opened, so switching between them keeps half-finished answers. */

const VIEWS = ["read", "cards", "quiz"] as const;

/** A hidden view keeps the params it was last shown with, so the URL for another view cannot remount it. */
function useSticky<T>(value: T, active: boolean): T {
  const ref = useRef(value);
  if (active) ref.current = value;
  return ref.current;
}

function Shell() {
  const sp = useSearchParams();
  const { me, loadModule, openGlossary, go } = useAcademy();
  const m = sp.get("m");
  const varsity = sp.get("varsity");
  const vm = sp.get("vm");
  const tax = sp.get("tax");
  const tp = sp.get("tp");
  const v = sp.get("v") ?? (sp.get("l") ? "read" : "");
  const l = sp.get("l");
  const [content, setContent] = useState<ModuleContent | null>(null);
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState<string[]>([]);
  const migrated = useRef(false);

  useEffect(() => {
    setContent(null); setErr(""); setSeen([]);
    if (m) loadModule(m).then(setContent).catch((e: Error) => setErr(e.message));
  }, [m, loadModule]);
  useEffect(() => { if ((VIEWS as readonly string[]).includes(v)) setSeen((s) => (s.includes(v) ? s : [...s, v])); }, [v, m]);
  useEffect(() => {
    if (!me || migrated.current) return;
    migrated.current = true;
    migrateLegacyProgress(me).catch(() => undefined);
  }, [me]);

  const lessonId = l ?? content?.lessons.find((x) => !me?.completed_lessons.includes(x.id))?.id ?? content?.lessons[0]?.id ?? "";
  const board = v === "board";
  const varsityView = Boolean(varsity) && !m;
  const taxView = Boolean(tax) && !m && !varsityView;
  const home = !m && !board && !varsityView && !taxView;
  const show = (k: string) => seen.includes(k) || v === k;
  const lesson = useSticky(lessonId, v === "read");
  const cardsP = useSticky({ deck: sp.get("deck") ?? (l ? "lesson" : "due"), l: l ?? undefined }, v === "cards");
  const quizP = useSticky({ q: sp.get("q") ?? undefined, mode: (sp.get("mode") === "exam" ? "exam" : "practice") as "exam" | "practice" }, v === "quiz");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">FH Academy</h1>
          <p className={`text-[15px] ${muted}`}>L.E.A.R.N. training for the whole team: funds, behaviour, goals, debt, rebalancing and withdrawals.</p>
        </div>
        <nav aria-label="Academy" className="flex flex-wrap items-center gap-2">
          <button className={btnGhost} aria-current={home ? "page" : undefined} onClick={() => go({})}>Home</button>
          <button className={btnGhost} aria-current={varsityView ? "page" : undefined} onClick={() => go({ varsity: "1" })}>Varsity</button>
          <button className={btnGhost} aria-current={taxView ? "page" : undefined} onClick={() => go({ tax: "1" })}>Taxation</button>
          <button className={btnGhost} aria-current={board ? "page" : undefined} onClick={() => go({ v: "board" })}>Leaderboard</button>
          <button className={btnGhost} onClick={() => openGlossary()}>📖 Glossary</button>
          {me && <span className={`text-[15px] ${accent} font-medium`} aria-label={`Level ${me.level}, ${me.xp} XP, ${me.streak} day streak`}>⭐ L{me.level} · {me.xp} XP · 🔥 {me.streak}</span>}
        </nav>
      </header>

      {home && <Home />}
      {board && <Leaderboard />}
      {varsityView && !vm && <VarsityHub />}
      {varsityView && vm && <VarsityDetail slug={vm} ch={sp.get("ch")} />}
      {taxView && !tp && <TaxationHub />}
      {taxView && tp && <TaxationPage productId={tp} />}
      {m && err && <p role="alert" className="text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
      {m && !content && !err && <Spinner label="Loading module" />}
      {m && content && (
        <div key={m}>
          {!v && <ModulePath content={content} />}
          {show("read") && <div hidden={v !== "read"}><Lesson key={lesson} content={content} lessonId={lesson} /></div>}
          {show("cards") && <div hidden={v !== "cards"}><Flashcards content={content} deck={cardsP.deck} lessonId={cardsP.l} /></div>}
          {show("quiz") && <div hidden={v !== "quiz"}><Quiz content={content} quizId={quizP.q} mode={quizP.mode} /></div>}
        </div>
      )}
    </div>
  );
}

function Academy() {
  const router = useRouter();
  const go: Go = useCallback((params, replace) => {
    const u = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) if (val) u.set(k, val);
    const qs = u.toString();
    const url = `/backoffice/learn${qs ? `?${qs}` : ""}`;
    if (replace) router.replace(url);
    else router.push(url);
    window.scrollTo({ top: 0 });
  }, [router]);
  return <AcademyProvider go={go}><Shell /></AcademyProvider>;
}

export default function AcademyPage() {
  return <Suspense fallback={<Spinner label="Loading Academy" />}><Academy /></Suspense>;
}
