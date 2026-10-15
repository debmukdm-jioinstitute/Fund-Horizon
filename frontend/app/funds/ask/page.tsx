// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumb";
import FundRagSearch from "@/components/FundRagSearch";

export const metadata: Metadata = {
  title: "Ask About Any Fund · Knowledge Base · Fund Horizon",
  description:
    "Search historical returns, volatility, Sharpe ratios, and category medians across 3,600+ mutual fund schemes. Regular plans distributed under ARN 345439.",
};

export default function FundAskPage() {
  return (
    <div className="w-full space-y-6">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Funds", href: "/funds/compare" }, { label: "Ask Knowledge Base" }]} />

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
