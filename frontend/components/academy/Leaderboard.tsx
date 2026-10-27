"use client";

import React, { useEffect, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { academy, type AdminUser, type Board } from "./api";
import { Spinner, accent, card, chip, muted } from "./ui";

export function Leaderboard() {
  const { refresh } = useAcademy();
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const open = (id: string) => academy.adminUser(id).then(setDetail).catch((e: Error) => setErr(e.message));
  useEffect(() => {
    setBoard(null);
    academy.leaderboard(period).then(setBoard).catch((e: Error) => setErr(e.message));
  }, [period]);
  const toggle = async (hide: boolean) => {
    await academy.setOptOut(hide);
    setBoard(await academy.leaderboard(period));
    void refresh();
  };
  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-xl font-semibold">Leaderboard</h2>
      <div className="flex gap-2" role="group" aria-label="Period">
        <button className={chip(period === "week")} aria-pressed={period === "week"} onClick={() => setPeriod("week")}>This week</button>
        <button className={chip(period === "all")} aria-pressed={period === "all"} onClick={() => setPeriod("all")}>All time</button>
      </div>
      {err && <p role="alert" className="text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
      {!board && !err && <Spinner />}
      {board && (
        <>
          <ol className={`${card} divide-y divide-[#E4E9EF] dark:divide-[#2B3644]`}>
            {board.top.map((r) => (
              <li key={r.rank} onClick={r.id ? () => void open(r.id!) : undefined} className={`flex items-center justify-between px-4 py-3 text-[15px] ${r.id ? "cursor-pointer hover:bg-[#F1F5F9] dark:hover:bg-[#1F2937]" : ""} ${r.you ? "bg-[#EAF5FE] dark:bg-[#11304F] font-semibold" : ""}`}>
                <span><span className={`inline-block w-8 ${muted}`}>#{r.rank}</span>{r.name}{r.you && " (you)"}</span>
                <span>{r.xp} XP</span>
              </li>
            ))}
            {!board.top.length && <li className={`px-4 py-6 text-[15px] ${muted}`}>No XP yet this period. Complete a lesson to get on the board.</li>}
          </ol>
          <p className="text-[15px]">
            {board.hidden ? <span className={muted}>You are hidden from the leaderboard.</span> : board.you ? <span className={accent}>You: #{board.you.rank} · {board.you.xp} XP</span> : <span className={muted}>You: not ranked yet.</span>}
          </p>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={board.hidden} onChange={(e) => void toggle(e.target.checked)} className="h-4 w-4" />
            Hide me from the leaderboard
          </label>
        </>
      )}
      {detail && <UserDetail u={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const fmt = (ts: string | null) => (ts ? new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" }) : "-");

function UserDetail({ u, onClose }: { u: AdminUser; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={`${u.name} details`} onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl overflow-y-auto bg-[#FFFFFF] dark:bg-[#171E27] p-4 sm:p-6 space-y-5 text-[15px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{u.name}</h3>
            <p className={muted}>{u.email} · {u.role}</p>
          </div>
          <button className={chip(false)} onClick={onClose}>Close</button>
        </div>
        <p>Level {u.level} ({u.level_name}) · {u.xp} XP · {u.week_xp} XP this week · {u.streak}-day streak · {u.badges.length} badges · {u.completed_lessons.length} lessons done · {u.cards_total} cards</p>
        {u.modules.map((m) => {
          const p = u.progress[m.id];
          return (
            <section key={m.id} className="space-y-1">
              <h4 className="font-semibold">{m.code}: {m.title} <span className={`font-normal ${muted}`}>{p.done}/{p.total} lessons</span></h4>
              <ul className={`${card} divide-y divide-[#E4E9EF] dark:divide-[#2B3644]`}>
                {m.tests.map((t) => (
                  <li key={t.quiz_id} className="flex flex-wrap items-center justify-between gap-x-3 px-3 py-2">
                    <span>{t.title}</span>
                    <span className={t.attempted ? (t.best?.passed ? accent : "") : muted}>
                      {t.attempted ? `${t.best ? `${t.best.score}/${t.best.total}${t.best.passed ? " passed" : ""}` : "no scored attempt"} · ${t.attempts} tries` : "Not attempted"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <section className="space-y-1">
          <h4 className="font-semibold">Recent attempts</h4>
          <ul className={`${card} divide-y divide-[#E4E9EF] dark:divide-[#2B3644]`}>
            {u.attempts.slice(0, 30).map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                <span>{a.quiz_id} · {a.mode}</span>
                <span className={muted}>{a.finished_at ? `${a.score}/${a.total}` : "unfinished"} · {fmt(a.finished_at ?? a.started_at)}</span>
              </li>
            ))}
            {!u.attempts.length && <li className={`px-3 py-2 ${muted}`}>No tests attempted yet.</li>}
          </ul>
        </section>
        <section className="space-y-1">
          <h4 className="font-semibold">Badges</h4>
          <p className={muted}>{u.badges.map((b) => u.badge_defs.find((d) => d.id === b.id)?.name ?? b.id).join(", ") || "None"}</p>
        </section>
      </aside>
    </div>
  );
}
