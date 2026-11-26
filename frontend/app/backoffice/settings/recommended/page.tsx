"use client";

import React, { useMemo, useState } from "react";
import { useRecommended } from "@/lib/recommended";

export default function RecommendedSettingsPage() {
  const rec = useRecommended();
  const [recKind, setRecKind] = useState<"mf" | "pms">("mf");
  const [recId, setRecId] = useState("");
  const [recName, setRecName] = useState("");
  const [savingRec, setSavingRec] = useState(false);
  const [recSuccess, setRecSuccess] = useState<string | null>(null);

  const currentRecList = useMemo(() => {
    const map = recKind === "mf" ? rec.mfMap : rec.pmsMap;
    return Object.entries(map).map(([id, name]) => ({ id, name }));
  }, [recKind, rec.mfMap, rec.pmsMap]);

  async function handleAddRecommended(e: React.FormEvent) {
    e.preventDefault();
    if (!recId.trim()) return;
    try {
      setSavingRec(true);
      if (recKind === "mf") {
        await rec.addMf(recId.trim(), recName.trim() || undefined);
      } else {
        await rec.addPms(recId.trim(), recName.trim() || undefined);
      }
      setRecSuccess(`Added ${recId.trim()} to FH Recommended ${recKind === "mf" ? "Mutual Funds" : "PMS"}`);
      setRecId("");
      setRecName("");
      setTimeout(() => setRecSuccess(null), 3000);
    } catch {
      /* ignore */
    } finally {
      setSavingRec(false);
    }
  }

  async function handleRemoveRecommended(id: string) {
    try {
      if (recKind === "mf") {
        await rec.removeMf(id);
      } else {
        await rec.removePms(id);
      }
      setRecSuccess(`Removed ${id} from FH Recommended`);
      setTimeout(() => setRecSuccess(null), 3000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="terminal-panel p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div>
          <div className="text-[16px] font-semibold text-[#181818] dark:text-[#EDF2F7] flex items-center gap-1.5">
            <span>★</span>
            <span>FH Recommended Picks ({currentRecList.length} {recKind === "mf" ? "Funds" : "Strategies"})</span>
          </div>
          <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
            Curated shortlist of top-performing Mutual Funds and PMS strategies highlighted across the terminal.
          </div>
        </div>

        {/* Toggle MF vs PMS */}
        <div className="inline-flex rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] p-0.5 bg-[#F3F3F3] dark:bg-[#111722] shrink-0">
          <button
            type="button"
            onClick={() => setRecKind("mf")}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition ${
              recKind === "mf"
                ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] shadow-sm"
                : "text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
            }`}
          >
            Mutual Funds ({Object.keys(rec.mfMap).length})
          </button>
          <button
            type="button"
            onClick={() => setRecKind("pms")}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition ${
              recKind === "pms"
                ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] shadow-sm"
                : "text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
            }`}
          >
            PMS Strategies ({Object.keys(rec.pmsMap).length})
          </button>
        </div>
      </div>

      {recSuccess && (
        <div className="text-[12px] p-2.5 rounded-lg bg-[#EAF5FE] dark:bg-[#10372A] text-[#0176D3] dark:text-[#7FE0B5] border border-[#C5DDF7] dark:border-[#1F4A74]">
          {recSuccess}
        </div>
      )}

      {/* Add Recommended Form */}
      <form onSubmit={handleAddRecommended} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
            {recKind === "mf" ? "AMFI Scheme Code" : "APMI Strategy ID"}
          </label>
          <input
            type="text"
            value={recId}
            onChange={(e) => setRecId(e.target.value)}
            placeholder={recKind === "mf" ? "e.g. 108466" : "e.g. 174"}
            className="terminal-input w-full text-[12px] py-1.5 px-2.5 font-mono"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
            {recKind === "mf" ? "Fund / Scheme Name" : "PMS Strategy Name"}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={recName}
              onChange={(e) => setRecName(e.target.value)}
              placeholder={recKind === "mf" ? "e.g. ICICI Prudential Large Cap Fund" : "e.g. Stallion Asset Core Fund"}
              className="terminal-input w-full text-[12px] py-1.5 px-2.5"
            />
            <button
              type="submit"
              disabled={savingRec}
              className="terminal-btn text-[12px] py-1.5 px-4 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium shrink-0"
            >
              {savingRec ? "Saving…" : "+ Add Recommended"}
            </button>
          </div>
        </div>
      </form>

      {/* Table of Recommended Picks */}
      <div className="terminal-panel overflow-hidden mt-3 max-h-96 overflow-y-auto">
        <table className="terminal-table">
          <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
            <tr>
              <th className="w-[20%]">{recKind === "mf" ? "Code" : "APMI ID"}</th>
              <th className="w-[60%]">{recKind === "mf" ? "Fund Name" : "Strategy Name"}</th>
              <th className="w-[20%] text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {currentRecList.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                  No {recKind === "mf" ? "mutual funds" : "PMS strategies"} marked as recommended.
                </td>
              </tr>
            ) : (
              currentRecList.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono text-[12px] text-[#0176D3] dark:text-[#1B96FF] font-medium">{item.id}</td>
                  <td className="font-medium text-[#181818] dark:text-[#EDF2F7]">{item.name}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => handleRemoveRecommended(item.id)}
                      className="text-[12px] text-[#B42332] dark:text-[#FF7D86] hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
