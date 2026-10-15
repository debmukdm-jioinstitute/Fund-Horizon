"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { resolveApiUrl, API_URL } from "@/lib/api";
import { buildPuzzle, PUZZLE_COUNT } from "@/lib/crossword";

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
  const [found, setFound] = useState<string[]>([]);
  const [path, setPath] = useState<[number, number][]>([]);
  const [bad, setBad] = useState<string[]>([]);
  const [left, setLeft] = useState(GAME_SECONDS);
  const [token, setToken] = useState("");
  const [result, setResult] = useState({ correct: 0, total: 0, used: 0 });
  const finishing = useRef(false);
  const foundRef = useRef<string[]>([]);

  const puzzle = useMemo(() => buildPuzzle(puzzleId), [puzzleId]);

  const foundKeys = new Set(puzzle.words.filter((w) => found.includes(w.word)).flatMap((w) => w.cells.map(([r, c]) => `${r},${c}`)));
  const pathKeys = new Set(path.map(([r, c]) => `${r},${c}`));
  const startRef = useRef<[number, number] | null>(null);

  const finish = useCallback(
    async (used: number) => {
      if (finishing.current) return;
      finishing.current = true;
      const correct = foundRef.current.length;
      setResult({ correct, total: puzzle.words.length, used });
      setPhase("saving");
      await save(correct, puzzle.words.length, used);
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
    setFound([]);
    foundRef.current = [];
    setPath([]);
    setLeft(GAME_SECONDS);
    finishing.current = false;
    setPhase("play");
  }

  const cellAt = (x: number, y: number): [number, number] | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-cell]");
    const [r, c] = (el?.getAttribute("data-cell") ?? "").split(",").map(Number);
    return el && !Number.isNaN(r) ? [r, c] : null;
  };

  // Straight line (horizontal, vertical or diagonal) from the start cell to the finger; ignores off-line positions.
  function lineTo(end: [number, number]): [number, number][] | null {
    const [r0, c0] = startRef.current!;
    const dr = end[0] - r0, dc = end[1] - c0;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
    const n = Math.max(Math.abs(dr), Math.abs(dc));
    return Array.from({ length: n + 1 }, (_, i) => [r0 + Math.sign(dr) * i, c0 + Math.sign(dc) * i] as [number, number]);
  }

  function down(e: React.PointerEvent) {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    startRef.current = cell;
    setPath([cell]);
  }
  function move(e: React.PointerEvent) {
    if (!startRef.current) return;
    const cell = cellAt(e.clientX, e.clientY);
    const line = cell && lineTo(cell);
    if (line) setPath(line);
  }
  // Release: correct word turns green and locks; wrong selection flashes red and is discarded.
  function up() {
    if (!startRef.current) return;
    startRef.current = null;
    const sel = path.map(([r, c]) => puzzle.grid[r][c]).join("");
    setPath([]);
    if (path.length < 2) return;
    const hit = puzzle.words.find((w) => !foundRef.current.includes(w.word) && (w.word === sel || w.word === sel.split("").reverse().join("")));
    if (hit) {
      foundRef.current = [...foundRef.current, hit.word];
      setFound(foundRef.current);
      if (foundRef.current.length === puzzle.words.length) void finish(GAME_SECONDS - left);
    } else {
      setBad(path.map(([r, c]) => `${r},${c}`));
      setTimeout(() => setBad([]), 600);
    }
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
              <h1 className="text-xl font-semibold">Fund Horizon Word Hunt</h1>
              <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">
                Find hidden basic financial words in 2 minutes and win a token. Enter your details to begin.
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
              <div className="text-xs text-[#536176] dark:text-[#A8B4C4]">Puzzle #{puzzleId + 1} of {PUZZLE_COUNT}</div>
              <div className={`text-lg font-semibold tabular-nums px-3 py-0.5 rounded-full ${left <= 20 ? "bg-[#FBE7EA] text-[#9B1C2E]" : "bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]"}`}>
                ⏱ {mm}:{ss}
              </div>
            </div>

            <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">
              Find the hidden words: drag your finger across the letters in a straight line (across, down or diagonal). Green = found. Red = not a word.
            </p>

            <div
              className="grid gap-[2px] w-full select-none rounded-xl bg-white/60 dark:bg-[#171E27] p-1.5 border border-[#D8E3E0] dark:border-[#2B3644]"
              style={{ gridTemplateColumns: `repeat(${puzzle.size}, minmax(0, 1fr))`, touchAction: "none" }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            >
              {puzzle.grid.flatMap((row, r) =>
                row.map((ch, c) => {
                  const k = `${r},${c}`;
                  const cls = bad.includes(k)
                    ? "bg-[#FBD5DA] text-[#9B1C2E]"
                    : pathKeys.has(k)
                      ? "bg-[#FFE9A8]"
                      : foundKeys.has(k)
                        ? "bg-[#BFE8CD] text-[#0F5A2F]"
                        : "bg-transparent";
                  return (
                    <div key={k} data-cell={k} className={`aspect-square rounded-md flex items-center justify-center text-[clamp(14px,5vw,22px)] font-semibold transition-colors ${cls}`}>
                      {ch}
                    </div>
                  );
                }),
              )}
            </div>

            <div>
              <div className="text-xs font-semibold mb-1.5">Words to find ({found.length}/{puzzle.words.length})</div>
              <div className="flex flex-wrap gap-2">
                {[...puzzle.words].sort((a, b) => a.word.localeCompare(b.word)).map((w) => (
                  <span key={w.word} className={`px-3 py-1.5 rounded-lg border-2 text-sm font-bold tracking-wide ${found.includes(w.word) ? "bg-[#BFE8CD] border-[#1E8E4E] text-[#0F5A2F] line-through" : "bg-white dark:bg-[#1E2734] border-[#006F64] text-[#006F64] dark:text-[#75E1CE]"}`}>
                    {w.word}
                  </span>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => finish(GAME_SECONDS - left)} className="w-full py-3 rounded-lg bg-[#006F64] hover:bg-[#00574E] text-white font-semibold text-sm">Submit now</button>
          </>
        )}

        {(phase === "saving" || phase === "done") && (
          <div className="bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl p-5 text-center space-y-4">
            <h2 className="text-lg font-semibold">{phase === "done" ? "🏁 Game over!" : "Saving your result…"}</h2>
            <p className="text-sm">You found <b>{result.correct}</b> of <b>{result.total}</b> words.</p>
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
