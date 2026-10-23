"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EmailDialog from "@/components/crm/EmailDialog";
import { fetchOutbox, type OutboxRow } from "@/lib/crmEmail";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const PAGE = 50;

export default function SentEmailsPage() {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = (offset: number) => {
    setLoading(true);
    fetchOutbox(offset, PAGE)
      .then((r) => { setRows((cur) => (offset ? [...cur, ...r.rows] : r.rows)); setTotal(r.total); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load sent emails."))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(0), []);

  return (
    <div className="space-y-4 pb-12">
      <div className={`${card} px-5 py-4`}>
        <Link href="/backoffice/operations" className="text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline">← Operations</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>Sent emails</h1>
          <button type="button" onClick={() => setComposing(true)} className="rounded-lg bg-[#006F64] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#00554D]">Compose email</button>
        </div>
        <p className={`mt-1 text-[14px] ${muted}`}>Email any client or any address, with attachments. Everything sent from the CRM is listed here, newest first. Scheduled emails show their send time in the message.</p>
      </div>
      {composing && <EmailDialog onClose={() => setComposing(false)} onSent={() => load(0)} />}
      {error && <p role="alert" className="text-[13px] text-[#B42318] dark:text-[#FF7D86]">{error}</p>}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[560px] text-left text-[13.5px]" aria-label="Sent emails">
          <thead><tr>{["Sent", "Client", "Subject", "Details"].map((h) => <th key={h} className={`px-3.5 py-2.5 text-[12px] font-bold uppercase tracking-wider ${muted}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#E4E9EF] dark:border-[#2B3644] align-top">
                <td className={`whitespace-nowrap px-3.5 py-2.5 ${ink}`}>{new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</td>
                <td className={`px-3.5 py-2.5 ${ink}`}>{r.customer_name ?? "—"}</td>
                <td className={`px-3.5 py-2.5 font-semibold ${ink}`}>{r.subject}</td>
                <td className={`px-3.5 py-2.5 ${muted}`}>{(r.body ?? "").split("\n\n").filter((p) => p.startsWith("Attachments:") || p.startsWith("Scheduled for")).join(" · ") || "—"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={4} className={`px-3.5 py-8 text-center ${muted}`}>No emails sent yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length < total && <button type="button" disabled={loading} onClick={() => load(rows.length)} className="rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64]">{loading ? "Loading…" : "Load more"}</button>}
    </div>
  );
}
