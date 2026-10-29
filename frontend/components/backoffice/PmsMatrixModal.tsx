"use client";

import React, { useEffect, useState } from "react";
import { getPmsMatrix, type PmsMatrixItem } from "@/lib/backoffice";
import { formatCrore } from "@/lib/terminal-format";

export default function PmsMatrixModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<PmsMatrixItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOn, setAsOn] = useState<string | undefined>();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    getPmsMatrix()
      .then((res) => {
        setData(res.data || []);
        setAsOn(res.as_on);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCopySummary = (item: PmsMatrixItem) => {
    const text = `PMS Strategy: ${item.strategy_name} (${item.provider})\nSignal: ${item.signal} (Score: ${item.score != null ? `${item.score}/100` : "N/A"})\nBenchmark: ${item.benchmark}\nReporting Date: ${item.as_on || "Latest"}\nKey Reasons:\n${item.reasons.map((r) => `- ${r}`).join("\n")}\nLimitations: Internal screening policy only. Not a transaction or client suitability advice.`;
    navigator.clipboard.writeText(text);
    setCopiedId(item.ia_id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 font-sans backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-2xl bg-white dark:bg-[#131B26] border border-[#E5E5E5] dark:border-[#2B3644] p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-3 shrink-0">
          <div>
            <h2 className="text-[19px] font-bold text-[#181818] dark:text-[#EDF2F7] flex items-center gap-2">
              <span>9 PMS Strategies: Screening Matrix &amp; Data Provenance</span>
              <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-[#EEF1F5] dark:bg-[#202936] text-[#706E6B] dark:text-[#A8B4C4]">
                As of {asOn || "Latest APMI"}
              </span>
            </h2>
            <p className="text-[12.5px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
              Standardized APMI disclosure status, 3-tier analysis availability, and evidence-based screening signals.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] text-[#706E6B] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
          >
            ✕
          </button>
        </div>

        <div className="overflow-x-auto overflow-y-auto flex-1 rounded-xl border border-[#E5E5E5] dark:border-[#2B3644]">
          <table className="w-full text-left text-[12.5px] border-collapse">
            <thead className="sticky top-0 bg-[#F8FAFC] dark:bg-[#111A24] text-[#706E6B] dark:text-[#A8B4C4] border-b border-[#E5E5E5] dark:border-[#2B3644]">
              <tr>
                <th className="py-2.5 px-3">Strategy &amp; Provider</th>
                <th className="py-2.5 px-3 text-right">AUM (₹ Cr)</th>
                <th className="py-2.5 px-3">Benchmark</th>
                <th className="py-2.5 px-3 text-center">Data Level</th>
                <th className="py-2.5 px-3 text-center">Score / 100</th>
                <th className="py-2.5 px-3 text-center">Rating</th>
                <th className="py-2.5 px-3">Signal</th>
                <th className="py-2.5 px-3">Evidence-Based Reasons</th>
                <th className="py-2.5 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5] dark:divide-[#2B3644]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                    Loading 9 PMS strategies matrix…
                  </td>
                </tr>
              ) : (
                data.map((item) => {
                  const signalStyle =
                    item.signal === "Buy"
                      ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                      : item.signal === "Hold"
                      ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                      : item.signal === "Sell"
                      ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                      : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]";

                  return (
                    <tr key={item.ia_id} className="hover:bg-[#F8FAFC] dark:hover:bg-[#1B2432]/60">
                      <td className="py-3 px-3 align-top max-w-[220px]">
                        <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                          {item.strategy_name}
                        </div>
                        <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] truncate">
                          {item.provider}
                        </div>
                        <div className="text-[10px] text-[#0176D3] dark:text-[#1B96FF] font-mono mt-0.5">
                          APMI ID: #{item.ia_id}
                        </div>
                      </td>
                      <td className="py-3 px-3 align-top text-right tabular-nums font-mono">
                        {item.aum_crore ? formatCrore(item.aum_crore) : "—"}
                      </td>
                      <td className="py-3 px-3 align-top text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                        {item.benchmark}
                      </td>
                      <td className="py-3 px-3 align-top text-center">
                        <span className="rounded bg-[#EEF1F5] dark:bg-[#202936] px-1.5 py-0.5 text-[10px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
                          Level 1 (Public)
                        </span>
                      </td>
                      <td className="py-3 px-3 align-top text-center tabular-nums font-bold text-[#181818] dark:text-[#EDF2F7]">
                        {item.score != null ? `${item.score} / 100` : "—"}
                      </td>
                      <td className="py-3 px-3 align-top text-center font-bold text-[#D97706]">
                        {item.rating != null ? `★ ${item.rating}/5` : "—"}
                      </td>
                      <td className="py-3 px-3 align-top whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${signalStyle}`}>
                          <span className="h-1 w-1 rounded-full bg-current" />
                          {item.signal}
                        </span>
                      </td>
                      <td className="py-3 px-3 align-top max-w-[260px]">
                        <ul className="space-y-0.5 text-[11.5px] text-[#344054] dark:text-[#D0D5DD]">
                          {item.reasons.map((r, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span className="text-[#0176D3] dark:text-[#1B96FF] mt-0.5">•</span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-3 px-3 align-top text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleCopySummary(item)}
                          className="rounded border border-[#E5E5E5] dark:border-[#2B3644] px-2 py-1 text-[11px] font-semibold text-[#0176D3] dark:text-[#1B96FF] hover:bg-[#F4F6F8] dark:hover:bg-[#1D2733]"
                        >
                          {copiedId === item.ia_id ? "Copied ✓" : "Copy Summary"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center text-[11px] text-[#706E6B] dark:text-[#A8B4C4] pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644] shrink-0">
          <div>
            Scoring policy: Provisional 1.0.0 (Benchmark 40%, Consistency 30%, Downside 30%).
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#0176D3] px-4 py-1.5 text-[12.5px] font-semibold text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
