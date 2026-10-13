"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getObservationSeries, SeriesPoint } from "@/lib/backoffice";

export interface IndicatorSpec {
  title: string;
  /** Series to show; a second id turns the view into (a - b) * scale, e.g. a yield spread in bps. */
  a: string;
  b?: string;
  scale?: number;
  unit: string;
  decimals?: number;
}

type View = "daily" | "weekly" | "monthly";

const day = (iso: string) => iso.slice(0, 10);

// Last observation of each ISO-ish bucket; the latest point is always kept.
function bucket(points: SeriesPoint[], view: View): SeriesPoint[] {
  if (view === "daily") return points;
  const key = (p: SeriesPoint) => {
    if (view === "monthly") return day(p.observed_at).slice(0, 7);
    const d = new Date(day(p.observed_at));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday of that week
    return d.toISOString().slice(0, 10);
  };
  const last = new Map<string, SeriesPoint>();
  for (const p of points) last.set(key(p), p);
  return Array.from(last.values());
}

export default function IndicatorDrawer({ spec, onClose }: { spec: IndicatorSpec | null; onClose: () => void }) {
  const [points, setPoints] = useState<SeriesPoint[] | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<View>("daily");

  useEffect(() => {
    setPoints(null);
    setError(false);
    if (!spec) return;
    let cancelled = false;
    const ids = spec.b ? [spec.a, spec.b] : [spec.a];
    Promise.all(ids.map(getObservationSeries))
      .then(([a, b]) => {
        if (cancelled) return;
        if (!b) return setPoints(a);
        const bByDay = new Map(b.map((p) => [day(p.observed_at), p.value]));
        setPoints(
          a.flatMap((p) => {
            const bv = bByDay.get(day(p.observed_at));
            return bv === undefined ? [] : [{ observed_at: p.observed_at, value: (p.value - bv) * (spec.scale ?? 1) }];
          })
        );
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [spec]);

  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "unset";
    };
  }, [spec, onClose]);

  // Newest first for the table; change is vs the previous row in the same view.
  const rows = useMemo(() => {
    const b = bucket(points ?? [], view);
    return b.map((p, i) => ({ ...p, change: i > 0 ? p.value - b[i - 1].value : undefined })).reverse();
  }, [points, view]);

  if (!spec) return null;
  const dec = spec.decimals ?? 2;
  const fmt = (v: number) => `${v.toFixed(dec)}${spec.unit}`;
  const series = rows.map((r) => r.value).reverse();
  const min = Math.min(...series);
  const max = Math.max(...series);
  const line = series
    .map((v, i) => `${(i / Math.max(series.length - 1, 1)) * 100},${40 - ((v - min) / (max - min || 1)) * 38 - 1}`)
    .join(" ");

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={spec.title} onClick={onClose}>
      <div className="absolute inset-0 flex">
        <div className="w-full h-full bg-[#FFFFFF] dark:bg-[#10151C] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="p-4 sm:p-5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-start justify-between gap-3 bg-[#F7F9FB] dark:bg-[#171E27]">
            <div>
              <div className="text-[10px] font-mono uppercase text-[#536176] dark:text-[#A8B4C4] mb-1">Indicator history</div>
              <h2 className="text-[19px] font-medium text-[#172033] dark:text-[#EDF2F7]">{spec.title}</h2>
              {rows[0] && (
                <p className="text-[13px] font-mono text-[#536176] dark:text-[#A8B4C4] mt-0.5">
                  Latest {fmt(rows[0].value)} · {day(rows[0].observed_at)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7] p-2.5 rounded-md hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition shrink-0"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl p-4 sm:p-8 space-y-4">
              {points === null && !error && <div className="text-[13px] text-[#536176] dark:text-[#A8B4C4]">Loading history…</div>}
              {error && <div className="text-[13px] text-[#B42332] dark:text-[#FF7D86]">Could not load history.</div>}
              {points && points.length === 0 && (
                <div className="text-[13px] text-[#536176] dark:text-[#A8B4C4]">No history stored yet; points accumulate as the feed refreshes.</div>
              )}
              {points && points.length > 0 && (
                <div className="terminal-panel overflow-hidden">
                  <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center justify-between gap-2">
                    <span>History ({rows.length})</span>
                    <div className="flex gap-1">
                      {(["daily", "weekly", "monthly"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setView(v)}
                          className={view === v ? "terminal-btn-accent text-[11px] py-0.5 px-2 capitalize" : "terminal-btn text-[11px] py-0.5 px-2 capitalize"}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  {series.length > 1 && (
                    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-24 text-[#006F64] dark:text-[#75E1CE] p-2">
                      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}
                  <div className="overflow-x-auto max-h-[55vh]">
                    <table className="terminal-table">
                      <thead>
                        <tr>
                          <th>As on</th>
                          <th className="text-right">Value</th>
                          <th className="text-right">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.observed_at}>
                            <td className="font-mono">{day(r.observed_at)}</td>
                            <td className="text-right font-mono">{fmt(r.value)}</td>
                            <td className={`text-right font-mono ${r.change === undefined ? "" : r.change >= 0 ? "text-[#087744] dark:text-[#58D6A0]" : "text-[#B42332] dark:text-[#FF7D86]"}`}>
                              {r.change === undefined ? "—" : `${r.change >= 0 ? "+" : ""}${r.change.toFixed(dec)}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
