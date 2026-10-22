"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/api";

/** Polling chat box. `mine` is 1 for staff bubbles when staff is viewing, 0 for the customer view. */
export default function ChatThread({
  load,
  send,
  mine,
}: {
  load: () => Promise<{ messages: ChatMessage[] }>;
  send: (body: string) => Promise<unknown>;
  mine: 0 | 1;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setMsgs((await load()).messages);
    } catch {
      /* keep the last good list; next poll retries */
    }
  }, [load]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setErr(null);
    try {
      await send(text.trim());
      setText("");
      await refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Message not sent.");
    }
  }

  return (
    <div className="flex flex-col h-[60vh] border border-[#E4E9EF] dark:border-[#2B3644] rounded">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {msgs.length === 0 && <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4]">No messages yet.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.from_staff === mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded px-3 py-1.5 text-[13px] whitespace-pre-wrap ${
                m.from_staff === mine
                  ? "bg-[#006F64] text-white dark:bg-[#75E1CE] dark:text-[#10151C]"
                  : "bg-[#F0F3F7] text-[#172033] dark:bg-[#171E27] dark:text-[#EDF2F7]"
              }`}
            >
              {m.body}
              <div className="text-[10px] opacity-70 mt-0.5">{new Date(m.created_at).toLocaleString("en-IN")}</div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="border-t border-[#E4E9EF] dark:border-[#2B3644] p-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Type a message"
          aria-label="Message"
          className="terminal-input flex-1 text-[13px] py-1.5 px-2.5"
        />
        <button type="submit" className="terminal-btn text-[13px] px-3">Send</button>
      </form>
      {err && <p role="alert" className="px-3 pb-2 text-[12px] text-[#B42332]">{err}</p>}
    </div>
  );
}
