"use client";

import UniversalSearch, { type SearchModule } from "@/components/backoffice/UniversalSearch";

export type PaletteModule = SearchModule;

/** ⌘K overlay around the universal search. */
export default function CommandPalette({ open, onClose, modules }: { open: boolean; onClose: () => void; modules: PaletteModule[] }) {
  if (!open) return null;
  return (
    <div
      role="dialog" aria-modal="true" aria-label="Search the workspace"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16" onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="w-full max-w-3xl rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-[#F7FAFD] dark:bg-[#171E27] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <UniversalSearch modules={modules} onDone={onClose} autoFocus />
      </div>
    </div>
  );
}
