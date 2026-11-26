"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SettingsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "ai") {
      router.replace("/backoffice/settings/ai");
    } else if (tab === "staff") {
      router.replace("/backoffice/settings/staff");
    } else if (tab === "recommended") {
      router.replace("/backoffice/settings/recommended");
    } else if (tab === "watchlists") {
      router.replace("/backoffice/settings/watchlists");
    } else if (tab === "mcp") {
      router.replace("/backoffice/settings/mcp");
    } else if (tab === "health") {
      router.replace("/backoffice/data-health");
    } else {
      router.replace("/backoffice/settings/lead");
    }
  }, [router, searchParams]);

  return null;
}

export default function SettingsIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[#706E6B] dark:text-[#A8B4C4] text-[13px]">
          Loading settings module…
        </div>
      }
    >
      <SettingsRedirect />
      <div className="p-8 text-center text-[#706E6B] dark:text-[#A8B4C4] text-[13px]">
        Loading settings module…
      </div>
    </Suspense>
  );
}
