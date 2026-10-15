import Link from "next/link";

export interface Crumb { label: string; href?: string }

/** Site-wide breadcrumb: icon tile, linked parents separated by chevrons, current page as a filled pill. */
export default function Breadcrumb({ items }: { items: Crumb[] }) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-[#C2E9E0] dark:border-[#234542] border-l-4 border-l-[#006F64] bg-[#E7F5F2] dark:bg-[#12292B] py-1.5 pl-2 pr-2 text-xs font-semibold">
        <li aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#006F64] text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
          </svg>
        </li>
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className={`flex min-w-0 items-center gap-2 ${i === last ? "" : "shrink-0"}`}>
            {i > 0 && (
              <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[#8C9BB0]" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            )}
            {i === last ? (
              <span aria-current="page" className="truncate rounded-md bg-[#006F64] px-2.5 py-1 text-white">{c.label}</span>
            ) : (
              <Link href={c.href ?? "/"} className="text-[#006F64] dark:text-[#75E1CE] hover:underline">{c.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
