"use client";

import ChatsTab from "@/components/crm/ChatsTab";

/** Standalone chats page kept as a shortcut; it renders the same Chats tab that lives inside CRM. */
export default function StaffChatsPage() {
  return (
    <div className="p-4">
      <ChatsTab />
    </div>
  );
}
