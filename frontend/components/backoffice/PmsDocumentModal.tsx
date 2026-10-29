"use client";

import React, { useState } from "react";
import { uploadPmsDocument, type PmsUploadResult } from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

interface Props {
  onUploaded?: (result: PmsUploadResult) => void;
  onClose: () => void;
}

export default function PmsDocumentModal({ onUploaded, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PmsUploadResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a PMS document (PDF).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await uploadPmsDocument(file, password);
      setResult(res);
      if (onUploaded) onUploaded(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to parse document.";
      if (msg.toLowerCase().includes("password")) {
        setNeedPassword(true);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 font-sans backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#131B26] border border-[#E5E5E5] dark:border-[#2B3644] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-3">
          <div>
            <h2 className="text-[18px] font-bold text-[#181818] dark:text-[#EDF2F7]">
              Upload PMS Document / Factsheet
            </h2>
            <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
              Supports Provider Factsheets, WealthSpectrum holding statements &amp; transaction exports. Processed in-memory.
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

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1.5">
                Select PMS PDF Statement
              </label>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    setError(null);
                  }
                }}
                className="w-full text-[13px] text-[#706E6B] dark:text-[#A8B4C4] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[12px] file:font-semibold file:bg-[#0176D3] file:text-white hover:file:opacity-90 cursor-pointer"
              />
            </div>

            {needPassword && (
              <div>
                <label className="block text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1.5">
                  PDF Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter PAN or statement password"
                  className="w-full rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] px-3 py-1.5 text-[13px]"
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-[#FEF3F2] dark:bg-[#331114] p-3 text-[12.5px] text-[#B42318] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] px-4 py-1.5 text-[13px] font-semibold text-[#706E6B] dark:text-[#A8B4C4] hover:bg-[#F4F6F8] dark:hover:bg-[#1D2733]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !file}
                className="rounded-lg bg-[#0176D3] px-4 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Analyzing Document…" : "Upload & Analyze"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#F8FAFC] dark:bg-[#111A24] border border-[#E5E5E5] dark:border-[#2B3644] p-4 text-[13px] space-y-2">
              <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-2">
                <span className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                  {result.document.strategy_name}
                </span>
                <span className="rounded bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] px-2 py-0.5 text-[11px] font-semibold uppercase">
                  {result.document.document_type.replace(/_/g, " ")}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                <div>Provider: <b className="text-[#181818] dark:text-[#EDF2F7]">{result.document.provider}</b></div>
                <div>Valuation Date: <b className="text-[#181818] dark:text-[#EDF2F7]">{result.document.valuation_date || "—"}</b></div>
                <div>Portfolio Value: <b className="text-[#181818] dark:text-[#EDF2F7]">{result.document.current_value ? `₹${formatNumber(result.document.current_value, 0)}` : "—"}</b></div>
              </div>
            </div>

            {result.contributions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[12px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                  Security Holdings &amp; Contribution Analysis ({result.contributions.length})
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-[#E5E5E5] dark:border-[#2B3644]">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-[#F8FAFC] dark:bg-[#131B26] text-[#706E6B] dark:text-[#A8B4C4]">
                      <tr>
                        <th className="p-2">Security</th>
                        <th className="p-2 text-right">Weight</th>
                        <th className="p-2 text-right">Return</th>
                        <th className="p-2 text-right">Contribution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E5E5] dark:divide-[#2B3644]">
                      {result.contributions.map((c, i) => (
                        <tr key={i} className="hover:bg-[#F8FAFC] dark:hover:bg-[#1B2432]/60">
                          <td className="p-2 font-medium">{c.security}</td>
                          <td className="p-2 text-right tabular-nums">{c.weight ? `${(c.weight * 100).toFixed(1)}%` : "—"}</td>
                          <td className="p-2 text-right tabular-nums">{c.return ? `${c.return.toFixed(1)}%` : "—"}</td>
                          <td className="p-2 text-right tabular-nums font-semibold text-[#027A48] dark:text-[#75E1CE]">
                            {c.contribution ? `${c.contribution > 0 ? "+" : ""}${c.contribution.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setResult(null)}
                className="rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] px-4 py-1.5 text-[13px] font-semibold text-[#706E6B] dark:text-[#A8B4C4]"
              >
                Upload Another
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-[#0176D3] px-4 py-1.5 text-[13px] font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
