// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { reportUrl } from "@/lib/api";

export default function PortalReportsPage({ params }: { params: { id: string } }) {
  const { id } = params;

  return (
    <main className="w-full space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-950">Reports</h1>
        <Link href={`/plan/${id}`} className="text-xs font-semibold text-teal-700 hover:underline">
          ← Back to plan
        </Link>
      </div>

      <section className="card space-y-4">
        <div>
          <h2 className="text-base font-bold text-navy-950">Financial plan report</h2>
          <p className="mt-1 text-sm text-navy-700">
            This downloads the same illustrative financial plan report generated for your plan — a
            summary of your goals, allocation, and projected outcomes.
          </p>
        </div>
        <a
          href={reportUrl(id)}
          download
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
        >
          <span aria-hidden="true">⤓</span> Download financial plan (PDF)
        </a>
        <p className="text-xs text-navy-500">
          The report is generated from your plan data at download time. Mutual fund investments are
          subject to market risks; read all scheme related documents carefully.
        </p>
      </section>
    </main>
  );
}
