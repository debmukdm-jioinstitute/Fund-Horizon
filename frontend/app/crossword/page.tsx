"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { resolveApiUrl, API_URL } from "@/lib/api";
import { buildPuzzle, cellsOf, PUZZLE_COUNT, type Entry } from "@/lib/crossword";

const GAME_SECONDS = 120;
const INPUT_CLS =
  "w-full text-sm px-3.5 py-3 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]";

type Phase = "intro" | "play" | "saving" | "done";

export default function CrosswordPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [puzzleId, setPuzzleId] = useState(0);
  const [solved, setSolved] = useState<number[]>([]);
  const [bad, setBad] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ word: string; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [left, setLeft] = useState(GAME_SECONDS);
  const [token, setToken] = useState("");
  const [result, setResult] = useState({ correct: 0, total: 0, used: 0 });
  const finishing = useRef(false);
  const solvedRef = useRef<number[]>([]);

  const puzzle = useMemo(() => buildPuzzle(puzzleId), [puzzleId]);

  const at = useCallback(
    (r: number, c: number): Entry[] => puzzle.entries.filter((e) => cellsOf(e).some(([rr, cc]) => rr === r && cc === c)),
    [puzzle],
  );
  const solvedKeys = new Set(puzzle.entries.filter((e) => solved.includes(e.id)).flatMap((e) => cellsOf(e).map(([r, c]) => `${r},${c}`)));
  const shown = sel ? at(sel[0], sel[1]).filter((e) => !solved.includes(e.id)) : [];
  const bank = useMemo(
    () => puzzle.entries.map((e) => ({ id: e.id, word: e.word })).sort((a, b) => a.word.localeCompare(b.word)),
    [puzzle],
  );

  const finish = useCallback(
    async (used: number) => {
      if (finishing.current) return;
      finishing.current = true;
      const correct = solvedRef.current.length;
      setResult({ correct, total: puzzle.entries.length, used });
      setPhase("saving");
      await save(correct, puzzle.entries.length, used);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, name, phone, puzzleId],
  );

  async function save(correct: number, total: number, used: number) {
    setError(null);
    try {
      const res = await fetch(resolveApiUrl(`${API_URL}/api/crm/public/crossword`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), phone: phone.replace(/[^\d+]/g, ""), puzzle_id: puzzleId,
          words_correct: correct, words_total: total, seconds_used: used,
        }),
      });
      if (!res.ok) throw new Error("Could not save your result.");
      setToken((await res.json()).token);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    }
  }

  useEffect(() => {
    if (phase !== "play") return;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "play" && left <= 0) void finish(GAME_SECONDS);
  }, [phase, left, finish]);

  function start(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Please enter a valid 10-digit mobile number.");
    setError(null);
    const id = Math.floor(Math.random() * PUZZLE_COUNT); // new random crossword for every scan/session
    setPuzzleId(id);
    setSolved([]);
    solvedRef.current = [];
    setPick(null);
    setLeft(GAME_SECONDS);
    finishing.current = false;
    setSel(null);
    setPhase("play");
  }

  // Try placing `word` on the slot(s) covering cell (r,c): correct = green + lock, wrong = red flash, nothing kept.
  function attempt(word: string, r: number, c: number) {
    const open = at(r, c).filter((e) => !solved.includes(e.id));
    if (!open.length) return;
    const hit = open.find((e) => e.word === word);
    setPick(null);
    if (hit) {
      solvedRef.current = [...solvedRef.current, hit.id];
      setSolved(solvedRef.current);
      if (solvedRef.current.length === puzzle.entries.length) void finish(GAME_SECONDS - left);
    } else {
      setBad(open.flatMap((e) => cellsOf(e).map(([rr, cc]) => `${rr},${cc}`)));
      setTimeout(() => setBad([]), 700);
    }
  }

  function tapCell(r: number, c: number) {
    if (pick) attempt(pick, r, c);
    else setSel([r, c]);
  }

  function chipDown(e: React.PointerEvent, word: string) {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
      moved = true;
      setDrag({ word, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) return setPick((p) => (p === word ? null : word));
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-cell]");
      const [r, c] = (el?.getAttribute("data-cell") ?? "").split(",").map(Number);
      if (el && !Number.isNaN(r)) attempt(word, r, c);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const mm = String(Math.floor(Math.max(left, 0) / 60));
  const ss = String(Math.max(left, 0) % 60).padStart(2, "0");

  return (
    <div
      className="min-h-[100dvh] bg-[#F7F9FB] dark:bg-[#0D1219] text-[#172033] dark:text-[#EDF2F7] px-4 py-5 flex flex-col items-center bg-cover bg-center"
      style={phase === "intro" ? { backgroundImage: "url(/photos/crossword-bg.webp)" } : undefined}
    >
      <div className={`w-full max-w-md space-y-4 ${phase === "intro" ? "my-auto" : ""}`}>
        <div className="flex justify-center">
          <div className={phase === "intro" ? "rounded-xl bg-white/90 px-4 py-2 shadow-md" : ""}>
            <Logo size="md" showSubtitle={phase === "intro"} href="/" />
          </div>
        </div>

        {phase === "intro" && (
          <form onSubmit={start} noValidate className="bg-white/95 dark:bg-[#171E27]/95 backdrop-blur-sm border border-white/60 dark:border-[#2B3644] rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="text-center space-y-1">
              <div className="text-3xl">🧩</div>
              <h1 className="text-xl font-semibold">Fund Horizon Cross₹word</h1>
              <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">
                Solve a basic financial-literacy crossword in 2 minutes and win a token. Enter your details to begin.
              </p>
            </div>
            {error && <div className="p-3 text-xs rounded-lg bg-[#FBE7EA] dark:bg-[#43181F] text-[#9B1C2E] dark:text-[#FFA9B5]">{error}</div>}
            <input aria-label="Full name" className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
            <input aria-label="Mobile number" className={INPUT_CLS} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" type="tel" inputMode="tel" autoComplete="tel" />
            <button type="submit" className="w-full py-3 rounded-lg bg-[#006F64] hover:bg-[#00574E] text-white font-semibold text-sm">Start game (2:00)</button>
          </form>
        )}

        {phase === "play" && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-xs text-[#536176] dark:text-[#A8B4C4]">Crossword #{puzzleId + 1} of {PUZZLE_COUNT}</div>
              <div className={`text-lg font-semibold tabular-nums px-3 py-0.5 rounded-full ${left <= 20 ? "bg-[#FBE7EA] text-[#9B1C2E]" : "bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]"}`}>
                ⏱ {mm}:{ss}
              </div>
            </div>

            <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">
              Drag a word onto its boxes (or tap the word, then tap its boxes). Green = correct and locked. Red = wrong, try again.
            </p>

            <div className="grid gap-[2px] w-full select-none" style={{ gridTemplateColumns: `repeat(${puzzle.cols}, minmax(0, 1fr))` }}>
              {puzzle.cells.flatMap((row, r) =>
                row.map((ch, c) => {
                  if (!ch) return <div key={`${r},${c}`} className="aspect-square" />;
                  const k = `${r},${c}`;
                  const state = bad.includes(k)
                    ? "bg-[#FBD5DA] border-[#D6293E] text-[#9B1C2E]"
                    : solvedKeys.has(k)
                      ? "bg-[#BFE8CD] border-[#1E8E4E] text-[#0F5A2F]"
                      : shown.some((e) => cellsOf(e).some(([rr, cc]) => rr === r && cc === c))
                        ? "bg-[#FFE9A8] border-[#C79200]"
                        : "bg-white dark:bg-[#171E27] border-[#B8C4CF] dark:border-[#3A485A]";
                  return (
                    <button
                      key={k}
                      type="button"
                      data-cell={k}
                      onClick={() => tapCell(r, c)}
                      aria-label={`Row ${r + 1} column ${c + 1}`}
                      className={`relative aspect-square rounded-[3px] border text-[clamp(11px,4vw,18px)] font-semibold flex items-center justify-center transition-colors ${state}`}
                    >
                      {puzzle.numbers[k] && <span className="absolute top-0 left-[2px] text-[7px] leading-none font-medium text-[#536176]">{puzzle.numbers[k]}</span>}
                      {solvedKeys.has(k) ? ch : ""}
                    </button>
                  );
                }),
              )}
            </div>

            <div className="rounded-lg bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-2 text-sm min-h-[3.2rem]">
              {shown.length ? shown.map((e) => (
                <div key={e.id}><b>{e.num} {e.dir === "A" ? "Across" : "Down"}</b> ({e.word.length}): {e.clue}</div>
              )) : "Tap a box to see its clue"}
            </div>

            <div>
              <div className="text-xs font-semibold mb-1.5">Word bank ({solved.length}/{puzzle.entries.length} placed)</div>
              <div className="flex flex-wrap gap-2">
                {bank.filter((b) => !solved.includes(b.id)).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onPointerDown={(e) => chipDown(e, b.word)}
                    style={{ touchAction: "none" }}
                    className={`min-h-[44px] px-3.5 rounded-lg border-2 text-sm font-bold tracking-wide select-none ${pick === b.word ? "bg-[#FFE9A8] border-[#C79200]" : "bg-white dark:bg-[#1E2734] border-[#006F64] text-[#006F64] dark:text-[#75E1CE]"}`}
                  >
                    {b.word}
                  </button>
                ))}
                {solved.length === puzzle.entries.length && <span className="text-sm text-[#1E8E4E] font-semibold">All words placed! 🎉</span>}
              </div>
            </div>

            {drag && (
              <div className="fixed z-50 pointer-events-none px-3.5 py-2 rounded-lg bg-[#006F64] text-white text-sm font-bold shadow-lg" style={{ left: drag.x, top: drag.y, transform: "translate(-50%, -140%)" }}>
                {drag.word}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs text-[#536176] dark:text-[#A8B4C4]">
              {(["A", "D"] as const).map((d) => (
                <div key={d}>
                  <div className="font-semibold text-[#172033] dark:text-[#EDF2F7] mb-0.5">{d === "A" ? "Across" : "Down"}</div>
                  {puzzle.entries.filter((e) => e.dir === d).map((e) => (
                    <div key={e.id} className={`py-0.5 ${solved.includes(e.id) ? "text-[#1E8E4E] line-through" : ""}`}>{e.num}. {e.clue}</div>
                  ))}
                </div>
              ))}
            </div>

            <button type="button" onClick={() => finish(GAME_SECONDS - left)} className="w-full py-3 rounded-lg bg-[#006F64] hover:bg-[#00574E] text-white font-semibold text-sm">Submit now</button>
          </>
        )}

        {(phase === "saving" || phase === "done") && (
          <div className="bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl p-5 text-center space-y-4">
            <h2 className="text-lg font-semibold">{phase === "done" ? "🏁 Game over!" : "Saving your result…"}</h2>
            <p className="text-sm">You solved <b>{result.correct}</b> of <b>{result.total}</b> words correctly.</p>
            {error && (
              <div className="space-y-2">
                <div className="p-3 text-xs rounded-lg bg-[#FBE7EA] text-[#9B1C2E]">{error}</div>
                <button type="button" onClick={() => save(result.correct, result.total, result.used)} className="px-4 py-2 rounded-lg bg-[#006F64] text-white text-sm font-semibold">Retry</button>
              </div>
            )}
            {phase === "done" && (
              <>
                <div className="rounded-xl bg-[#E7F5F2] dark:bg-[#1A3034] border-2 border-dashed border-[#006F64] py-5">
                  <div className="text-xs text-[#536176] dark:text-[#A8B4C4]">Your token number</div>
                  <div className="text-4xl font-bold tracking-widest tabular-nums text-[#006F64] dark:text-[#75E1CE]">{token}</div>
                </div>
                <p className="text-sm font-semibold text-[#9B1C2E] dark:text-[#FFA9B5]">📸 Take a screenshot of this token number and save it.</p>
                <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">Show it to the Fund Horizon team to claim your reward. Our advisor may also call you on {phone}.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
