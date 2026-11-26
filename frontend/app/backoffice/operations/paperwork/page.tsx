"use client";

import Link from "next/link";
import PaperworkReport from "@/components/operations/PaperworkReport";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";

export default function PaperworkPage() {
  return (
    <div className="space-y-4 pb-12">
      <div className={`${card} px-5 py-4`}>
        <div className="flex items-center gap-2">
          <Link href="/backoffice/operations" className="text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline">← Operations</Link>
          <span className="rounded bg-amber-100 dark:bg-amber-950/80 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
            Archived
          </span>
        </div>
        <h1 className={`mt-1 text-2xl font-bold tracking-tight ${ink}`}>Paperwork Processing</h1>
      </div>
      <PaperworkReport />
    </div>
  );
}
