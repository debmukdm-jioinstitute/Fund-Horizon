import React from "react";
import SettingsNav from "@/components/backoffice/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mb-1">Backoffice / Settings</div>
        <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">Settings</h1>
      </div>

      {/* Layout: sidebar + content */}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <SettingsNav />
        <div className="flex-1 min-w-0 w-full space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}
