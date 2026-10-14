"use client";

import React, { useEffect, useState } from "react";
import { useAcademy } from "./AcademyContext";
import { academy, type Board } from "./api";
import { Spinner, accent, card, chip, muted } from "./ui";

export function Leaderboard() {
  const { refresh } = useAcademy();
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
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
              <li key={r.rank} className={`flex items-center justify-between px-4 py-3 text-[15px] ${r.you ? "bg-[#E7F5F2] dark:bg-[#1A3034] font-semibold" : ""}`}>
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
    </div>
  );
}
