"use client";

import Link from "next/link";
import PaperworkReport from "@/components/operations/PaperworkReport";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";

export default function PaperworkPage() {
  return (
    <div className="space-y-4 pb-12">
      <div className={`${card} px-5 py-4`}>
        <Link href="/backoffice/operations" className="text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline">← Operations</Link>
        <h1 className={`mt-1 text-2xl font-bold tracking-tight ${ink}`}>Paperwork Processing</h1>
        <p className={`mt-1 text-[14px] ${muted}`}>Build a client&apos;s monthly report from PMS factsheets and portfolio files, then download it, save it to the client CRM record, and email it.</p>
      </div>
      <PaperworkReport />
    </div>
  );
}
