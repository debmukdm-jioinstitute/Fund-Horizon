"use client";

import React, { useState } from "react";
import { getNews, NewsItem } from "@/lib/backoffice";
import { usePolling } from "./usePolling";

const CATEGORIES = [
  { id: "", label: "All" },
  { id: "markets", label: "Markets" },
  { id: "regulator", label: "RBI / SEBI" },
  { id: "macro", label: "Govt / Macro" },
];

function ago(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (Number.isNaN(mins)) return "";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function NewsFeed({ limit = 25, compact = false, showFilters = true }: { limit?: number; compact?: boolean; showFilters?: boolean }) {
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePolling(async (silent) => {
    try {
      if (!silent) setLoading(true);
      setItems(await getNews({ limit, category: category || undefined }));
      setError(null);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [category, limit], 300_000);

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-3 py-1 rounded-xl text-xs font-medium border transition-colors ${
                category === c.id ? "bg-forest-700 text-white border-forest-700" : "bg-white text-sand-700 border-sand-300 hover:bg-sand-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>}
      {loading ? (
        <div className="text-xs text-sand-500 font-mono">Loading headlines…</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-xs text-sand-500 bg-white rounded-2xl border border-sand-200">
          No headlines collected yet. Open RSS feeds are fetched automatically every 10 minutes.
        </div>
      ) : (
        <ul className="divide-y divide-sand-100 bg-white rounded-2xl border border-sand-200 overflow-hidden">
          {items.map((n) => (
            <li key={n.id} className="p-3 hover:bg-sand-50/70">
              <a href={n.link} target="_blank" rel="noopener noreferrer" className="block">
                <div className="text-xs font-semibold text-sand-900 leading-snug">{n.title}</div>
                {!compact && n.summary && <p className="mt-1 text-[11px] text-sand-600 leading-relaxed line-clamp-2">{n.summary}</p>}
                <div className="mt-1 text-[10px] font-mono text-sand-500">
                  {n.source_name}
                  {n.published_at ? ` • ${ago(n.published_at)}` : ""}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
