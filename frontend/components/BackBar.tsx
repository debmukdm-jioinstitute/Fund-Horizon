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
    <div className="sticky top-0 z-30 border-b border-[#DEE7E0] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[980px] items-center px-4 py-2">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-semibold text-[#0C6B4F] hover:bg-[#E7F3EC] focus:outline-none focus:ring-2 focus:ring-[#0C6B4F]">
          <span aria-hidden>←</span> {label}
        </button>
      </div>
    </div>
  );
}
