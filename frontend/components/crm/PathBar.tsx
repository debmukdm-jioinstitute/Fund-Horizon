"use client";

/** Salesforce-style stage path: completed stages filled, current highlighted, click to move. */
export default function PathBar({
  stages, current, labels, closed, onSelect,
}: {
  stages: string[];
  current: string;
  labels?: Record<string, string>;
  /** When true the path is read-only (won/lost/converted are final). */
  closed?: boolean;
  onSelect?: (stage: string) => void;
}) {
  const idx = stages.indexOf(current);
  const name = (s: string) => labels?.[s] ?? s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Stage path">
      {stages.map((s, i) => {
        const state = s === current ? "current" : idx >= 0 && i < idx ? "done" : "todo";
        const tone =
          state === "current"
            ? current === "lost" ? "bg-rose-600 text-white" : "bg-[#006F64] text-white"
            : state === "done"
              ? "bg-[#CBE9E4] dark:bg-[#17433D] text-[#0B4F47] dark:text-[#CFF5EE]"
              : "bg-[#EEF2F6] dark:bg-[#24303E] text-[#536176] dark:text-[#A8B4C4]";
        return (
          <li key={s}>
            <button
              type="button"
              disabled={closed || state === "current" || !onSelect}
              aria-current={state === "current" ? "step" : undefined}
              onClick={() => onSelect?.(s)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full ${tone} ${
                closed || state === "current" || !onSelect ? "cursor-default" : "hover:opacity-80"
              }`}
            >
              {name(s)}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
