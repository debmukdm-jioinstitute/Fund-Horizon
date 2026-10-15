// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import type { DuplicateMatch } from "../../lib/crmListApi";

const REASON: Record<string, string> = {
  mobile: "same mobile number",
  email: "same email address",
  pan_last4: "same PAN (last 4)",
  name: "same name",
};

/** "Possible duplicates": open the existing record, or continue and create anyway. */
export default function DuplicateDialog({
  matches, blocking, onContinue, onCancel,
}: {
  matches: DuplicateMatch[]; blocking: boolean; onContinue: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[#181818]/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Possible duplicates">
      <div className="bg-white dark:bg-[#10151C] rounded-2xl border border-[#ECEBEA] dark:border-[#2B3644] shadow-xl w-full max-w-lg p-6 space-y-4 text-[#181818] dark:text-[#EDF2F7]">
        <div>
          <h3 className="text-base font-bold">Possible duplicates</h3>
          <p className="text-xs text-[#706E6B] dark:text-[#A8B4C4] mt-1">
            {blocking
              ? "A record with matching contact details already exists. Open it instead, or continue if this really is a different person."
              : "These records share the same name. Check before creating another."}
          </p>
        </div>
        <ul className="space-y-2">
          {matches.map((m, i) => (
            <li key={`${m.type}-${m.id ?? i}`} className="flex items-center justify-between gap-3 rounded-xl border border-[#ECEBEA] dark:border-[#2B3644] p-3 text-xs">
              <span>
                <span className="block font-semibold">
                  {m.visible ? m.name : "A record owned by another RM"}
                  <span className="ml-2 rounded bg-[#F3F3F3] dark:bg-[#24303E] px-1.5 py-0.5 text-[11px] font-medium capitalize">{m.type}</span>
                </span>
                <span className="block text-[#706E6B] dark:text-[#A8B4C4]">Match: {m.reasons.map((r) => REASON[r] ?? r).join(", ")}</span>
              </span>
              {m.visible && m.href && (
                <Link href={m.href} className="shrink-0 rounded-lg bg-[#181818] dark:bg-[#0176D3] px-3 py-1.5 font-semibold text-white">Open existing</Link>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 px-3 py-2 text-xs font-semibold bg-[#F3F3F3] dark:bg-[#24303E] hover:bg-[#ECEBEA] rounded-xl transition">Cancel</button>
          <button type="button" onClick={onContinue} className="flex-1 px-3 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition">Continue anyway</button>
        </div>
      </div>
    </div>
  );
}
