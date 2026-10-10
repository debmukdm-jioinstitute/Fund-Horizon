// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Link from "next/link";
import { compareFundsServer } from "@/lib/api";
import { CompareView } from "./CompareView";

export const metadata: Metadata = {
  title: "Compare Mutual Funds · Fund Horizon",
  description:
    "Side-by-side historical performance comparison, risk metrics, and return correlation matrix. Regular plans distributed under ARN 345439.",
};

interface PageProps {
  searchParams: Promise<{ codes?: string }>;
}

export default async function ComparePage({ searchParams }: PageProps) {
  const { codes } = await searchParams;
  const codesList = codes
    ? codes.split(",").map((c) => c.trim()).filter(Boolean)
    : ["128628", "148535"];

  const data = await compareFundsServer(codesList);

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
            <span className="text-navy-900 font-medium">Scheme Comparison</span>
          </li>
        </ol>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
          Side-by-Side Scheme Comparison
        </h1>
        <p className="mt-1 text-sm text-navy-700">
          Analyze historical returns, volatility, and return correlation overlap across regular mutual fund schemes.
        </p>
      </div>

      <CompareView initialData={data} />
    </div>
  );
}
