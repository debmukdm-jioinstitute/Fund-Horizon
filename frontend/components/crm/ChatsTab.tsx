"use client";

import { useCallback, useEffect, useState } from "react";
import ChatThread from "@/components/ChatThread";
import { getStaffChats, getStaffThread, sendStaffReply, type ChatThread as Thread } from "@/lib/api";

/** Customer chats, shared by the CRM Chats tab and the standalone /backoffice/chats page. */
export default function ChatsTab() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sel, setSel] = useState<Thread | null>(null);

  useEffect(() => {
    const load = () => getStaffChats().then((r) => setThreads(r.threads)).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => getStaffThread(sel!.customer_id), [sel]);
  const send = useCallback((b: string) => sendStaffReply(sel!.customer_id, b), [sel]);

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <ul className="terminal-panel divide-y divide-[#E4E9EF] dark:divide-[#2B3644] max-h-[70vh] overflow-y-auto">
        {threads.length === 0 && <li className="p-3 text-[13px] text-[#536176]">No customer messages yet.</li>}
        {threads.map((t) => (
          <li key={t.customer_id}>
            <button type="button" onClick={() => setSel(t)} className={`w-full text-left p-3 ${sel?.customer_id === t.customer_id ? "bg-[#E7F5F2] dark:bg-[#1A3034]" : ""}`}>
              <div className="flex justify-between text-[13px] font-medium"><span>{t.name}</span>{t.unread > 0 && <span className="text-[11px] bg-[#B42332] text-white rounded px-1.5">{t.unread}</span>}</div>
              <div className="text-[12px] text-[#536176] truncate">{t.last_body}</div>
            </button>
          </li>
        ))}
      </ul>
      <div>
        {sel ? <ChatThread key={sel.customer_id} load={load} send={send} mine={1} /> : <p className="text-[13px] text-[#536176]">Select a conversation.</p>}
      </div>
    </div>
  );
}
