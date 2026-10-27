"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Old chats URL: chats now live inside CRM, so send everyone there instead of 404ing. */
export default function StaffChatsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/backoffice/crm?tab=chats");
  }, [router]);
  return (
    <div className="p-4 text-[13px] text-[#536176]">
      Customer chats moved into CRM.{" "}
      <Link href="/backoffice/crm?tab=chats" className="underline">Open chats in CRM</Link>
    </div>
  );
}
