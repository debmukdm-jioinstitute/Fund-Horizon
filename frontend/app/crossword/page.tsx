"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { resolveApiUrl, API_URL } from "@/lib/api";
import { buildPuzzle, cellsOf, PUZZLE_COUNT, type Dir, type Entry } from "@/lib/crossword";

const GAME_SECONDS = 120;
const KEYS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const INPUT_CLS =
  "w-full text-sm px-3.5 py-3 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]";

type Phase = "intro" | "play" | "saving" | "done";

export default function CrosswordPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [puzzleId, setPuzzleId] = useState(0);
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [dir, setDir] = useState<Dir>("A");
  const [left, setLeft] = useState(GAME_SECONDS);
  const [token, setToken] = useState("");
  const [result, setResult] = useState({ correct: 0, total: 0, used: 0 });
  const finishing = useRef(false);

  const puzzle = useMemo(() => buildPuzzle(puzzleId), [puzzleId]);

  const entryAt = useCallback(
    (r: number, c: number, d: Dir): Entry | undefined =>
      puzzle.entries.find((e) => e.dir === d && cellsOf(e).some(([rr, cc]) => rr === r && cc === c)),
    [puzzle],
  );
  const active = sel ? entryAt(sel[0], sel[1], dir) ?? entryAt(sel[0], sel[1], dir === "A" ? "D" : "A") : undefined;
  const activeKeys = new Set(active ? cellsOf(active).map(([r, c]) => `${r},${c}`) : []);

  const finish = useCallback(
    async (used: number) => {
      if (finishing.current) return;
      finishing.current = true;
      const correct = puzzle.entries.filter((e) => cellsOf(e).every(([r, c], i) => letters[`${r},${c}`] === e.word[i])).length;
      setResult({ correct, total: puzzle.entries.length, used });
      setPhase("saving");
      await save(correct, puzzle.entries.length, used);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, letters, name, phone, puzzleId],
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
    const p = buildPuzzle(id);
    setPuzzleId(id);
    setLetters({});
    setLeft(GAME_SECONDS);
    finishing.current = false;
    const first = p.entries[0];
    setSel([first.r, first.c]);
    setDir(first.dir);
    setPhase("play");
  }

  function tap(r: number, c: number) {
    if (!puzzle.cells[r][c]) return;
    if (sel && sel[0] === r && sel[1] === c) {
      const other = dir === "A" ? "D" : "A";
      if (entryAt(r, c, other)) setDir(other);
    } else {
      setSel([r, c]);
      if (!entryAt(r, c, dir)) setDir(dir === "A" ? "D" : "A");
    }
  }

  function press(k: string) {
    if (!sel || !active) return;
    const key = `${sel[0]},${sel[1]}`;
    const cells = cellsOf(active);
    const i = cells.findIndex(([r, c]) => r === sel[0] && c === sel[1]);
    if (k === "⌫") {
      if (letters[key]) setLetters({ ...letters, [key]: "" });
      else if (i > 0) setSel(cells[i - 1]);
      return;
    }
    setLetters({ ...letters, [key]: k });
    if (i < cells.length - 1) setSel(cells[i + 1]);
  }

  const mm = String(Math.floor(Math.max(left, 0) / 60));
  const ss = String(Math.max(left, 0) % 60).padStart(2, "0");

  return (
    <div className="min-h-[100dvh] bg-[#F7F9FB] dark:bg-[#0D1219] text-[#172033] dark:text-[#EDF2F7] px-4 py-5 flex flex-col items-center">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center"><Logo size="md" showSubtitle={false} href="/" /></div>

        {phase === "intro" && (
          <form onSubmit={start} noValidate className="bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl p-5 space-y-4">
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

            <div className="grid gap-[2px] w-full select-none" style={{ gridTemplateColumns: `repeat(${puzzle.cols}, minmax(0, 1fr))` }}>
              {puzzle.cells.flatMap((row, r) =>
                row.map((ch, c) => {
                  if (!ch) return <div key={`${r},${c}`} className="aspect-square" />;
                  const k = `${r},${c}`;
                  const isSel = sel?.[0] === r && sel?.[1] === c;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => tap(r, c)}
                      aria-label={`Row ${r + 1} column ${c + 1}`}
                      className={`relative aspect-square rounded-[3px] border text-[clamp(11px,4vw,18px)] font-semibold flex items-center justify-center
                        ${isSel ? "bg-[#FFE9A8] border-[#C79200] text-[#172033]" : activeKeys.has(k) ? "bg-[#CFEDE6] border-[#006F64] text-[#172033]" : "bg-white dark:bg-[#171E27] border-[#B8C4CF] dark:border-[#3A485A]"}`}
                    >
                      {puzzle.numbers[k] && <span className="absolute top-0 left-[2px] text-[7px] leading-none font-medium text-[#536176]">{puzzle.numbers[k]}</span>}
                      {letters[k]}
                    </button>
                  );
                }),
              )}
            </div>

            <div className="rounded-lg bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-2 text-sm min-h-[3.2rem]">
              {active ? (<><b>{active.num} {active.dir === "A" ? "Across" : "Down"}</b> ({active.word.length}): {active.clue}</>) : "Tap a cell"}
            </div>

            <div className="space-y-1.5" role="group" aria-label="Keyboard">
              {KEYS.map((row, i) => (
                <div key={row} className="flex justify-center gap-1">
                  {row.split("").map((k) => (
                    <button key={k} type="button" onClick={() => press(k)} className="flex-1 max-w-[40px] h-11 rounded-md bg-white dark:bg-[#1E2734] border border-[#D5DDE5] dark:border-[#2B3644] text-sm font-semibold active:bg-[#CFEDE6]">{k}</button>
                  ))}
                  {i === 2 && <button type="button" onClick={() => press("⌫")} aria-label="Backspace" className="flex-[1.5] max-w-[60px] h-11 rounded-md bg-white dark:bg-[#1E2734] border border-[#D5DDE5] dark:border-[#2B3644] text-sm">⌫</button>}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-[#536176] dark:text-[#A8B4C4]">
              {(["A", "D"] as Dir[]).map((d) => (
                <div key={d}>
                  <div className="font-semibold text-[#172033] dark:text-[#EDF2F7] mb-0.5">{d === "A" ? "Across" : "Down"}</div>
                  {puzzle.entries.filter((e) => e.dir === d).map((e) => (
                    <button key={e.id} type="button" onClick={() => { setSel([e.r, e.c]); setDir(e.dir); }} className="block text-left py-0.5">{e.num}. {e.clue}</button>
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
