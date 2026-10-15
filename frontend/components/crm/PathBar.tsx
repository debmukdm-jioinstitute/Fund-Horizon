"use client";

/** Chevron stage path: completed stages tinted, current highlighted, click to move. */
const TIP = 14; // chevron depth in px
const GAP = 3; // visible gap between chevrons
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
    <ol className="flex w-full overflow-x-auto pb-0.5" aria-label="Stage path">
      {stages.map((s, i) => {
        const state = s === current ? "current" : idx >= 0 && i < idx ? "done" : "todo";
        const tone =
          state === "current"
            ? current === "lost" ? "bg-rose-600 text-white" : "bg-[#006F64] text-white"
            : state === "done"
              ? "bg-[#CBE9E4] dark:bg-[#17433D] text-[#0B4F47] dark:text-[#CFF5EE]"
              : "bg-[#EEF2F6] dark:bg-[#24303E] text-[#536176] dark:text-[#A8B4C4]";
        const first = i === 0, last = i === stages.length - 1;
        const clipPath = `polygon(0 0, ${last ? "100%" : `calc(100% - ${TIP}px)`} 0, ${last ? "100% 100%" : `100% 50%, calc(100% - ${TIP}px) 100%`}, 0 100%${first ? "" : `, ${TIP}px 50%`})`;
        return (
          <li key={s} className="flex-1 min-w-[84px]" style={{ marginLeft: first ? 0 : TIP * -1 + GAP }}>
            <button
              type="button"
              disabled={closed || state === "current" || !onSelect}
              aria-current={state === "current" ? "step" : undefined}
              onClick={() => onSelect?.(s)}
              style={{ clipPath }}
              className={`w-full h-9 whitespace-nowrap text-xs font-semibold ${first ? "rounded-l-full pl-4 pr-5" : last ? "rounded-r-full pl-7 pr-4" : "pl-7 pr-5"} ${tone} ${
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
