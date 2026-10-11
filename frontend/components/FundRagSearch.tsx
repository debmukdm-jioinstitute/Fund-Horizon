// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import Link from "next/link";
import { askFundRag } from "@/lib/api";
import type { RagAnswerResult } from "@/lib/types";

const SAMPLE_QUERIES = [
  "HDFC Banking and PSU Debt",
  "Large Cap Funds",
  "Parag Parikh Flexi Cap",
  "SBI Small Cap",
  "Nippon India Growth",
];

export default function FundRagSearch() {
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<string>("Regular");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RagAnswerResult | null>(null);

  async function handleSearch(qToSearch?: string) {
    const q = (qToSearch || query).trim();
    if (!q) {
      setError("Please enter a fund name, category, or query.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await askFundRag(q, { plan: plan || undefined });
      setResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to search mutual fund knowledge base.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Search Bar & Controls */}
      <div className="card space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label htmlFor="rag-query" className="block text-sm font-semibold text-navy-900">
              Ask or Search Knowledge Base
            </label>
            <input
              id="rag-query"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="e.g. HDFC Banking and PSU Debt, Large Cap Funds..."
              className="input mt-1"
            />
          </div>

          <div className="w-full md:w-44">
            <label htmlFor="rag-plan" className="block text-sm font-semibold text-navy-900">
              Plan Option
            </label>
            <select
              id="rag-plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="input mt-1"
            >
              <option value="">All Plans</option>
              <option value="Regular">Regular Plan</option>
              <option value="Direct">Direct Plan</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => handleSearch()}
            disabled={loading}
            className="btn bg-teal-500 text-navy-950 hover:bg-teal-400 disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {/* Example Queries */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-navy-700">
          <span className="font-semibold text-navy-800">Examples:</span>
          {SAMPLE_QUERIES.map((sq) => (
            <button
              key={sq}
              type="button"
              onClick={() => {
                setQuery(sq);
                handleSearch(sq);
              }}
              className="rounded-full bg-navy-100 px-2.5 py-1 text-navy-800 hover:bg-teal-100 hover:text-teal-900 transition-colors"
            >
              {sq}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}
      </div>

      {/* Answer View */}
      {result && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-100 pb-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                  Descriptive Scheme Metrics
                </span>
                <h2 className="text-xl font-bold text-navy-950">Knowledge Base Response</h2>
              </div>
              <span className="rounded bg-navy-100 px-2.5 py-1 text-xs font-medium text-navy-800">
                Data as of {result.as_of}
              </span>
            </div>

            {/* Answer Content */}
            <div className="prose prose-navy max-w-none text-navy-900 text-sm leading-relaxed whitespace-pre-line">
              {result.answer}
            </div>

            {/* Sources List */}
            {result.sources.length > 0 && (
              <div className="border-t border-navy-100 pt-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-navy-600">
                  Referenced Scheme Sources
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {result.sources.map((s) => (
                    <div
                      key={s.scheme_code}
                      className="flex items-center justify-between rounded-lg border border-navy-200 p-2.5 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-navy-900">{s.scheme_name}</p>
                        <p className="text-navy-600">
                          Code: {s.scheme_code} · {s.amc}
                        </p>
                      </div>
                      <Link
                        href={`/funds/${s.scheme_code}`}
                        className="ml-2 font-semibold text-teal-700 hover:underline shrink-0"
                      >
                        View Details →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Statutory Disclaimer */}
            <p className="border-t border-navy-100 pt-3 text-xs text-navy-600">
              {result.disclaimer}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
