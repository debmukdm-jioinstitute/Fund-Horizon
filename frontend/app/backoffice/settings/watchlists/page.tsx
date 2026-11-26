"use client";

import React, { useEffect, useState } from "react";
import {
  getWatchlists,
  createWatchlist,
  deleteWatchlist,
  type WatchlistItem,
} from "@/lib/backoffice";

export default function WatchlistsSettingsPage() {
  const [watchlists, setWatchlists] = useState<WatchlistItem[]>([]);
  const [wlName, setWlName] = useState("");
  const [wlType, setWlType] = useState("scheme");
  const [wlId, setWlId] = useState("");
  const [savingWl, setSavingWl] = useState(false);

  useEffect(() => {
    loadWatchlists();
  }, []);

  async function loadWatchlists() {
    try {
      const data = await getWatchlists();
      setWatchlists(data);
    } catch {
      /* fallback */
    }
  }

  async function handleAddWatchlist(e: React.FormEvent) {
    e.preventDefault();
    if (!wlId.trim() || !wlName.trim()) return;
    try {
      setSavingWl(true);
      await createWatchlist({
        name: wlName.trim(),
        item_type: wlType,
        item_id: wlId.trim(),
      });
      setWlId("");
      await loadWatchlists();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to add watchlist item");
    } finally {
      setSavingWl(false);
    }
  }

  async function handleDeleteWatchlist(id: string | number) {
    try {
      await deleteWatchlist(String(id));
      await loadWatchlists();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove watchlist item");
    }
  }

  return (
    <div className="terminal-panel p-4 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div>
          <h2 className="text-[16px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
            Watchlist Items ({watchlists.length})
          </h2>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
            Monitored mutual fund schemes, issuers, and PMS strategies.
          </p>
        </div>
      </div>

      {/* Add Watchlist Form */}
      <form onSubmit={handleAddWatchlist} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Watchlist Group</label>
          <input
            type="text"
            value={wlName}
            onChange={(e) => setWlName(e.target.value)}
            placeholder="e.g. Core Equity"
            className="terminal-input w-full text-[12px] py-1.5 px-2.5"
            required
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Item Type</label>
          <select
            value={wlType}
            onChange={(e) => setWlType(e.target.value)}
            className="terminal-input w-full text-[12px] py-1.5 px-2.5"
          >
            <option value="scheme">Mutual Fund Scheme</option>
            <option value="issuer">Micro Issuer / Stock</option>
            <option value="strategy">PMS Strategy</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Identifier</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={wlId}
              onChange={(e) => setWlId(e.target.value)}
              placeholder="Scheme Code or Symbol"
              className="terminal-input w-full text-[12px] py-1.5 px-2.5 font-mono"
              required
            />
            <button
              type="submit"
              disabled={savingWl}
              className="terminal-btn text-[12px] py-1.5 px-4 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium shrink-0"
            >
              {savingWl ? "Adding…" : "+ Add"}
            </button>
          </div>
        </div>
      </form>

      {/* Watchlist Table */}
      <div className="terminal-panel overflow-hidden mt-3 max-h-96 overflow-y-auto">
        <table className="terminal-table">
          <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
            <tr>
              <th className="w-[30%]">Group Name</th>
              <th className="w-[30%]">Item Type</th>
              <th className="w-[25%]">Identifier</th>
              <th className="w-[15%] text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {watchlists.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                  No watchlists configured. Add an item above to track.
                </td>
              </tr>
            ) : (
              watchlists.map((w) => (
                <tr key={w.id}>
                  <td className="font-medium text-[#181818] dark:text-[#EDF2F7]">{w.name}</td>
                  <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{w.item_type}</td>
                  <td className="font-mono text-[12px] text-[#0176D3] dark:text-[#1B96FF] font-medium">{w.item_id}</td>
                  <td className="text-right">
                    <button
                      onClick={() => handleDeleteWatchlist(w.id)}
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
