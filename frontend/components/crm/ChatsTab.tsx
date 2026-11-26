"use client";

import { useCallback, useEffect, useState } from "react";
import ChatThread from "@/components/ChatThread";
import { deleteStaffChat, getStaffChats, getStaffThread, sendStaffReply, type ChatThread as Thread } from "@/lib/api";
import DeleteConfirmDialog from "./DeleteConfirmDialog";

/** Customer chats, shown as the CRM Chats tab. */
export default function ChatsTab() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sel, setSel] = useState<Thread | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadThreads = useCallback(() => {
    getStaffChats().then((r) => setThreads(r.threads)).catch(() => {});
  }, []);

  useEffect(() => {
    loadThreads();
    const t = setInterval(loadThreads, 10000);
    return () => clearInterval(t);
  }, [loadThreads]);

  const load = useCallback(() => getStaffThread(sel!.customer_id), [sel]);
  const send = useCallback((b: string) => sendStaffReply(sel!.customer_id, b), [sel]);

  const handleDelete = async () => {
    if (!sel) return;
    await deleteStaffChat(sel.customer_id);
    setSel(null);
    loadThreads();
  };

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
      <div className="space-y-3">
        {sel ? (
          <>
            <div className="flex items-center justify-between pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
              <div>
                <h3 className="text-sm font-bold text-[#181818] dark:text-[#EDF2F7]">{sel.name}</h3>
                <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">{sel.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition"
              >
                Delete conversation
              </button>
            </div>
            <ChatThread key={sel.customer_id} load={load} send={send} mine={1} />
          </>
        ) : (
          <p className="text-[13px] text-[#536176]">Select a conversation.</p>
        )}
      </div>

      {confirmDelete && sel && (
        <DeleteConfirmDialog
          title={`Delete conversation with ${sel.name}?`}
          description="This permanently deletes all messages in this conversation thread."
          onConfirm={async () => {
            await handleDelete();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
