// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumb";
import { redirect } from "next/navigation";
import { compareFundsServer, getFundDetailServer } from "@/lib/api";
import { CompareView } from "./CompareView";

export const metadata: Metadata = {
  title: "Compare Mutual Funds · Fund Horizon",
  description:
    "Side-by-side historical performance comparison, risk metrics, and return correlation matrix. Regular plans distributed under ARN 345439.",
};

interface PageProps {
  searchParams: Promise<{ codes?: string }>;
}

const DEFAULT_CODES = ["128628", "148535"];
const API_BASE = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface RankingRow {
  scheme_code: string;
}

async function sameCategoryPeer(cat: string, code: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/categories/${encodeURIComponent(cat)}/ranking`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rankings?: RankingRow[] };
    const peer = (data.rankings ?? []).find((r) => r.scheme_code && r.scheme_code !== code);
    return peer?.scheme_code ?? null;
  } catch {
    return null;
  }
}

async function resolveCompareCodes(codesList: string[]): Promise<string[]> {
  const unique = Array.from(new Set(codesList)).slice(0, 8);
  if (unique.length >= 2) return unique;
  if (unique.length === 0) return DEFAULT_CODES;
  const code = unique[0];
  const detail = await getFundDetailServer(code);
  const peer = detail ? await sameCategoryPeer(detail.cat, code) : null;
  if (peer) return [code, peer];
  const fallback = DEFAULT_CODES.find((c) => c !== code) ?? DEFAULT_CODES[0];
  return [code, fallback];
}

export default async function ComparePage({ searchParams }: PageProps) {
  const { codes } = await searchParams;
  const requested = codes
    ? codes.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const codesList = await resolveCompareCodes(requested);
  if (requested.length === 1 && codesList.length >= 2) {
    redirect(`/funds/compare?codes=${codesList.join(",")}`);
  }

  const data = await compareFundsServer(codesList);

  return (
    <div className="w-full space-y-6">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Scheme Comparison" }]} />

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
