// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Link from "next/link";
import FundRagSearch from "@/components/FundRagSearch";

export const metadata: Metadata = {
  title: "Ask About Any Fund · Knowledge Base · Fund Horizon",
  description:
    "Search historical returns, volatility, Sharpe ratios, and category medians across 3,600+ mutual fund schemes. Regular plans distributed under ARN 345439.",
};

export default function FundAskPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-xs text-navy-700">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/funds/compare" className="hover:underline">
              Funds
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <span className="font-medium text-navy-900">Ask Knowledge Base</span>
          </li>
        </ol>
      </nav>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-navy-950">Mutual Fund Scheme Knowledge Base</h1>
        <p className="text-navy-700">
          Ask questions or look up historical data across 3,600+ schemes. Answers are synthesized directly from
          AMFI scheme metrics and monthly NAV records with cited sources.
        </p>
      </div>

      <FundRagSearch />
    </div>
  );
}
