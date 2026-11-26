"use client";

import ChatThread from "@/components/ChatThread";
import { getMyMessages, sendMyMessage } from "@/lib/api";

export default function MessagesPage() {
  return (
    <main className="w-full px-4 py-6 space-y-3">
      <h1 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7]">Messages</h1>
      <ChatThread load={getMyMessages} send={sendMyMessage} mine={0} />
    </main>
  );
}
