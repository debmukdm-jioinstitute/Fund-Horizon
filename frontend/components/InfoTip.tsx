"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { METRICS, type MetricDef } from "@/lib/metrics/registry";
import { SOURCES, type SourceKey } from "@/lib/metrics/sources";

export interface InfoTipMeta {
  source?: string;
  fetched_at?: string | null;
  source_url?: string | null;
  stale?: boolean;
}

export interface InfoTipProps {
  metric: string;
  meta?: InfoTipMeta | null;
  className?: string;
}

function formatIst(dateStr?: string | null): string {
  if (!dateStr || dateStr === "null" || dateStr === "None") {
    return "Not recorded";
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const parts = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const day = parts.find((p) => p.type === "day")?.value || "";
    const month = parts.find((p) => p.type === "month")?.value || "";
    const year = parts.find((p) => p.type === "year")?.value || "";
    const hour = parts.find((p) => p.type === "hour")?.value || "";
    const minute = parts.find((p) => p.type === "minute")?.value || "";
    return `${day} ${month} ${year}, ${hour}:${minute} IST`;
  } catch {
    return dateStr;
  }
}

export default function InfoTip({ metric, meta, className = "" }: InfoTipProps) {
  const instanceId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  const def: MetricDef | undefined = METRICS[metric];

  // Fixed + portaled so table/overflow ancestors never clip it; clamp into viewport.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    function place() {
      const btn = containerRef.current;
      const pop = popRef.current;
      if (!btn || !pop) return;
      const r = btn.getBoundingClientRect();
      const m = 8;
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(m, Math.min(r.left + r.width / 2 - w / 2, vw - w - m));
      const above = r.top - m;
      const below = vh - r.bottom - m;
      const top = h <= above || above >= below ? Math.max(m, r.top - m - Math.min(h, above)) : r.bottom + m;
      setPos({ top, left, maxH: Math.max(120, h <= above || above >= below ? above : below) - m });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleOtherOpen(e: Event) {
      const custom = e as CustomEvent<string>;
      if (custom.detail !== instanceId) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    function handleOutsideClick(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t) && !popRef.current?.contains(t)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("fh-infotip-opened", handleOtherOpen as EventListener);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      window.removeEventListener("fh-infotip-opened", handleOtherOpen as EventListener);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen, instanceId]);

  if (!def) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[InfoTip] Missing registry key: "${metric}"`);
    }
    return null;
  }

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!isOpen) {
      window.dispatchEvent(new CustomEvent("fh-infotip-opened", { detail: instanceId }));
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }

  // Source resolution
  const resolvedSourceKey = (meta?.source || def.sourceKey || "derived") as SourceKey;
  const sourceDef = SOURCES[resolvedSourceKey] ?? SOURCES.derived;
  const sourceName = sourceDef?.name || resolvedSourceKey.toUpperCase();
  const sourceUrl = meta?.source_url || sourceDef?.url || "";

  // Timestamp & staleness
  const fetchedText = formatIst(meta?.fetched_at);
  const isStale = Boolean(meta?.stale);

  const extra = (def.method || def.sources || def.refresh) && (
    <div className="space-y-2 border-t border-navy-100 dark:border-navy-800 pt-2 text-[11px] leading-relaxed text-navy-700 dark:text-navy-300">
      {def.method && (
        <div>
          <div className="mb-1 font-semibold text-navy-900 dark:text-white">How it is calculated</div>
          <ol className="list-decimal space-y-1 pl-4">
            {def.method.map((m) => <li key={m}>{m}</li>)}
          </ol>
        </div>
      )}
      {def.sources && (
        <div>
          <div className="mb-1 font-semibold text-navy-900 dark:text-white">Data sources</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {def.sources.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
      {def.refresh && (
        <div>
          <span className="font-semibold text-navy-900 dark:text-white">Refresh: </span>
          {def.refresh}
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className={`relative inline-flex items-center align-middle ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={`About ${def.label}`}
        aria-expanded={isOpen}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full text-navy-400 hover:text-navy-700 dark:text-navy-400 dark:hover:text-navy-200 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--terminal-accent)] cursor-pointer mx-1 select-none"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 bg-navy-950/40 backdrop-blur-xs sm:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Mobile bottom sheet (< sm) */}
          <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white dark:bg-navy-900 border-t border-navy-200 dark:border-navy-800 p-5 shadow-2xl space-y-3 sm:hidden max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-navy-100 dark:border-navy-800 pb-2">
              <div>
                <h4 className="text-sm font-bold text-navy-900 dark:text-white">
                  {def.label} {def.unit ? <span className="text-xs font-normal text-navy-500">({def.unit})</span> : null}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-navy-400 hover:text-navy-600 dark:hover:text-navy-200"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-navy-700 dark:text-navy-300 leading-relaxed">
              {def.what}
            </p>

            {def.formula && (
              <div className="rounded bg-navy-50 dark:bg-navy-950/80 p-2 border border-navy-100 dark:border-navy-800 font-mono text-[11px] text-navy-800 dark:text-navy-200 break-all">
                {def.formula}
              </div>
            )}

            <p className="text-xs text-navy-600 dark:text-navy-400 leading-relaxed">
              {def.meaning}
            </p>
            {extra}

            <div className="pt-1">
              {def.direction === "higher" && (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  ▲ Higher is better
                </span>
              )}
              {def.direction === "lower" && (
                <span className="inline-flex items-center gap-1 rounded bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                  ▼ Lower is better
                </span>
              )}
              {def.direction !== "higher" && def.direction !== "lower" && (
                <span className="inline-flex items-center gap-1 rounded bg-navy-50 dark:bg-navy-800 px-2 py-0.5 text-[11px] font-semibold text-navy-700 dark:text-navy-300 border border-navy-200 dark:border-navy-700">
                  ◆ Context-dependent
                </span>
              )}
            </div>

            <div className="border-t border-navy-100 dark:border-navy-800 pt-2 text-[11px] text-navy-500 dark:text-navy-400 space-y-1">
              <div>
                Source:{" "}
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[var(--terminal-accent)]  underline hover:opacity-80"
                  >
                    {sourceName}
                  </a>
                ) : (
                  <span className="font-medium text-navy-700 dark:text-navy-300">{sourceName}</span>
                )}
              </div>
              <div className="flex items-center">
                <span>Last fetched: {fetchedText}</span>
                {isStale && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400">
                    stale
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Desktop popover (>= sm) */}
          {createPortal(
          <div
            ref={popRef}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, maxHeight: pos?.maxH, visibility: pos ? "visible" : "hidden" }}
            className={`hidden sm:block fixed overflow-y-auto z-50 ${def.method ? "w-[26rem]" : "w-80"} rounded-xl bg-white dark:bg-navy-900 border border-navy-200 dark:border-navy-800 p-4 shadow-xl space-y-2.5 text-left text-xs leading-normal`}>
            {/* 1. Label (unit) */}
            <div className="flex items-center justify-between border-b border-navy-100 dark:border-navy-800 pb-1.5">
              <span className="font-bold text-navy-900 dark:text-white">
                {def.label} {def.unit ? <span className="text-navy-500 font-normal">({def.unit})</span> : null}
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-navy-400 hover:text-navy-600 dark:hover:text-navy-200 text-xs"
              >
                ✕
              </button>
            </div>

            {/* 2. What it is */}
            <p className="text-navy-700 dark:text-navy-300">
              {def.what}
            </p>

            {/* 3. How it's calculated */}
            {def.formula && (
              <div className="rounded bg-navy-50 dark:bg-navy-950 p-2 border border-navy-100 dark:border-navy-800 font-mono text-[11px] text-navy-800 dark:text-navy-200 break-all">
                {def.formula}
              </div>
            )}

            {/* 4. What it means */}
            <p className="text-navy-600 dark:text-navy-400">
              {def.meaning}
            </p>
            {extra}

            {/* 5. Direction Badge */}
            <div>
              {def.direction === "higher" && (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  ▲ Higher is better
                </span>
              )}
              {def.direction === "lower" && (
                <span className="inline-flex items-center gap-1 rounded bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                  ▼ Lower is better
                </span>
              )}
              {def.direction !== "higher" && def.direction !== "lower" && (
                <span className="inline-flex items-center gap-1 rounded bg-navy-50 dark:bg-navy-800 px-2 py-0.5 text-[11px] font-semibold text-navy-700 dark:text-navy-300 border border-navy-200 dark:border-navy-700">
                  ◆ Context-dependent
                </span>
              )}
            </div>

            {/* 6 & 7. Source & Last fetched */}
            <div className="border-t border-navy-100 dark:border-navy-800 pt-2 text-[11px] text-navy-500 dark:text-navy-400 space-y-1">
              <div>
                Source:{" "}
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[var(--terminal-accent)]  underline hover:opacity-80"
                  >
                    {sourceName}
                  </a>
                ) : (
                  <span className="font-medium text-navy-700 dark:text-navy-300">{sourceName}</span>
                )}
              </div>
              <div className="flex items-center">
                <span>Last fetched: {fetchedText}</span>
                {isStale && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400">
                    stale
                  </span>
                )}
              </div>
            </div>
          </div>,
          document.body
          )}
        </>
      )}
    </div>
  );
}
