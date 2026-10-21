import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

/* Typed client for /api/learn/* (FH Academy). Cookie auth; every progress write happens on the server. */

export interface BadgeDef { id: string; name: string; icon: string; hint: string }
export interface ModuleProgress {
  code: string;
  title: string;
  blurb: string;
  done: number;
  total: number;
  minutes_left: number;
  next: { lesson_id: string; title: string; minutes: number } | null;
}
export interface QuizBest { score: number; total: number; passed: boolean; finished_at: string }
export interface Me {
  xp: number; level: number; level_name: string; level_floor_xp: number; next_level_xp: number;
  streak: number; freezes: number; week_xp: number; week_rank: number | null; due_count: number;
  badges: { id: string; earned_at: string }[]; badge_defs: BadgeDef[];
  completed_lessons: string[]; progress: Record<string, ModuleProgress>; quiz_best: Record<string, QuizBest>;
  certificate: Record<string, { title: string; score: number; total: number; date: string }> | null;
  next_lesson: { module: string; lesson_id: string; title: string; minutes: number } | null;
  new_here: boolean; leaderboard_optout: boolean; migrated: boolean; name: string;
}
export interface Mcq { id: string; q: string; o: string[] }
export interface Lesson {
  id: string; module: string; title: string; minutes: number; level: string; stage: string;
  objectives: string[]; body_md: string; key_terms: string[]; example: string; say: string[]; never: string[];
  talk_track: { n: number; title: string; text: string }[]; check: Mcq[]; card_ids: string[];
}
export interface Card { id: string; q: string; a: string[] }
export interface GlossaryEntry { term: string; aliases: string[]; definition: string }
export interface ModuleHead {
  id: string; title: string; code: string; blurb: string; sources: string[];
  overview: { rows: string[][]; outcomes: string[] };
  lessons: { id: string; title: string; minutes: number; level: string; stage: string }[];
  checkpoints: { id: string; after: string }[];
  final: { id: string; title: string; questions: number; pass_pct: number };
  mock: { id: string; questions: number; minutes: number; pass_pct: number };
}
export interface ModuleContent { module: ModuleHead; lessons: Lesson[]; cards: Card[]; glossary: GlossaryEntry[] }
export interface Reward { xp_awarded: number; xp?: number; level_up?: boolean; new_badges?: string[] }
export interface QuizStart {
  attempt_id: string; quiz_id: string; title: string; mode: "practice" | "exam"; pass_pct: number; time_limit_s: number | null;
  questions: (Mcq & { sec: string })[];
}
export interface AnswerResult extends Reward { correct: boolean; locked_choice: number; correct_choice: number; why: string; lesson_id: string | null }
export interface Missed { id: string; q: string; options: string[]; correct: number; chosen: number | null; why: string; lesson_id: string | null }
export interface QuizResult extends Reward {
  score: number; total: number; passed: boolean; timed_out: boolean; pass_pct: number; perfect: boolean; missed: Missed[]; attempt_id: string;
}
export interface DueCard { id: string; fsrs: Record<string, unknown> | null; due: string | null }
export interface Board {
  period: "week" | "all"; top: { rank: number; name: string; xp: number; you: boolean }[];
  you: { rank: number; xp: number } | null; hidden: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/learn${path}`), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}
const post = <T,>(path: string, body?: unknown) => req<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const academy = {
  me: () => req<Me>("/me"),
  content: (m: string) => req<ModuleContent>(`/content/${m}`),
  completeLesson: (id: string) => post<Reward>(`/lessons/${id}/complete`),
  quizStart: (id: string, mode: "practice" | "exam", only?: string[]) => post<QuizStart>(`/quiz/${encodeURIComponent(id)}/start`, { mode, only }),
  quizAnswer: (attempt: string, qid: string, choice: number) => post<AnswerResult>(`/quiz/attempts/${attempt}/answer`, { qid, choice }),
  quizSubmit: (id: string, attempt: string, answers: Record<string, number>) =>
    post<QuizResult>(`/quiz/${encodeURIComponent(id)}/submit`, { attempt_id: attempt, answers }),
  addMissed: (attempt: string) => post<{ cards_added: number }>(`/quiz/attempts/${attempt}/add-missed-to-cards`),
  cards: (m: string, deck: string, lesson?: string) =>
    req<{ cards: DueCard[]; reviewed_today: number }>(`/cards/due?module=${m}&deck=${deck}${lesson ? `&lesson=${lesson}` : ""}`),
  reviewCard: (id: string, rating: number, fsrs: unknown, due: string) => post<Reward>(`/cards/${id}/review`, { rating, fsrs, due }),
  leaderboard: (period: "week" | "all") => req<Board>(`/leaderboard?period=${period}`),
  setOptOut: (v: boolean) => req<{ leaderboard_optout: boolean }>("/prefs", { method: "PUT", body: JSON.stringify({ leaderboard_optout: v }) }),
  migrate: (body: unknown) => post<{ migrated: boolean }>("/migrate-local", body),
};
