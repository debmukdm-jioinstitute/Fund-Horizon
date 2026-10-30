"use client";

import { useRouter } from "next/navigation";

/** "Back" control for pages that hide the site navigation. Goes to the previous page when the visitor came from this site, else to `fallback`. */
export default function BackBar({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  const back = () => {
    const sameSite = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
    if (sameSite && window.history.length > 1) router.back();
    else router.push(fallback);
  };
  return (
    <div className="sticky top-0 z-30 border-b border-white/70 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-[#0B1626]/70">
      <div className="mx-auto flex max-w-[980px] items-center px-4 py-2">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-semibold text-[#1A73E8] hover:bg-[#E3EEFF] dark:text-[#8AB8FF] dark:hover:bg-[#11304F] focus:outline-none focus:ring-2 focus:ring-[#0C6B4F]">
          <span aria-hidden>←</span> {label}
        </button>
      </div>
    </div>
  );
}
