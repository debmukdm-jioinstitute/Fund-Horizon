"use client";

// Finance Desk runs as its own hosted app; this embeds it live (via the same-origin /finance-desk-app proxy).
export default function FinanceDeskPage() {
  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[480px] flex-col">
      <iframe src="/finance-desk-app" title="Finance Desk" className="w-full flex-1 rounded border border-[#E8EBED] bg-white" />
      <a href="/finance-desk-app" target="_blank" rel="noopener noreferrer" className="mt-2 text-xs text-[#1F7AE0]">Open Finance Desk in a new tab</a>
    </div>
  );
}
