// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import { explainCas, explainFund, explainPlan, explainTax } from "@/lib/api";
import type { ExplainResponse } from "@/lib/types";

interface ExplainModalProps {
  buttonLabel?: string;
  kind: "plan" | "fund" | "cas" | "tax";
  planId?: string;
  nudgeId?: string;
  planData?: Record<string, unknown>;
  schemeCode?: string;
  casData?: Record<string, unknown>;
  className?: string;
}

export default function ExplainModal({
  buttonLabel = "Explain with AI",
  kind,
  planId,
  nudgeId,
  planData,
  schemeCode,
  casData,
  className = "",
}: ExplainModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainResponse | null>(null);

  async function handleOpen() {
    setOpen(true);
    if (!data) {
      setLoading(true);
      setError(null);
      try {
        let res: ExplainResponse;
        if (kind === "plan") {
          res = await explainPlan(planId, planData);
        } else if (kind === "tax") {
          if (!planId) throw new Error("Plan id is required");
          res = await explainTax(planId, nudgeId);
        } else if (kind === "fund") {
          if (!schemeCode) throw new Error("Scheme code is required");
          res = await explainFund(schemeCode);
        } else {
          if (!casData) throw new Error("CAS data is required");
          res = await explainCas(casData);
        }
        setData(res);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load explanation.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-teal-500 bg-teal-50/60 px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100 transition-colors ${className}`}
      >
        <svg className="h-4 w-4 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <span>{buttonLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-navy-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-navy-950">Educational Explanation</h3>
                  {data?.ai_generated ? (
                    <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
                      AI-Assisted
                    </span>
                  ) : (
                    <span className="rounded bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-800">
                      Rule-Based Summary
                    </span>
                  )}
                </div>
                <p className="text-xs text-navy-600">
                  Descriptive narrative verified against computed engine numbers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1.5 text-navy-400 hover:bg-navy-50 hover:text-navy-700"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Body */}
            {loading && (
              <div className="py-8 text-center text-sm text-navy-600">
                Synthesizing educational explanation...
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200">
                {error}
              </div>
            )}

            {data && (
              <div className="prose prose-navy max-w-none text-sm leading-relaxed text-navy-800 whitespace-pre-line">
                {data.explanation}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-navy-100 pt-3 flex items-center justify-between">
              <span className="text-xs text-navy-500">
                AMFI Registered Distributor · ARN 345439
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn bg-navy-100 text-navy-800 hover:bg-navy-200 text-xs py-1.5 px-3"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
