// Interactive mindmaps for Varsity. Built with real <button>/<a> elements
// and SVG branch lines — never canvas-only drawing and never divs with
// click handlers alone, so every node is keyboard-navigable. The maps sit
// inside a scrolling container, so they cannot overflow a narrow screen.

import React, { useState } from "react";
import { btnGhost, muted } from "./ui";

export interface MindNode {
  slug: string;
  title: string;
  count: number;
  blurb: string;
  /** Called when the node is activated (keyboard or click). */
  onOpen: () => void;
}

export function VarsityMindmap({ nodes, onOpenList, branchContent }: { nodes: MindNode[]; onOpenList: () => void; branchContent?: (slug: string) => React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ROW = 36;
  const TOP = 16;
  const innerW = 1020;
  const innerH = TOP * 2 + nodes.length * ROW + 10;
  const center = { x: 150, y: innerH / 2 };
  const nodeX = 420;
  const focused = nodes.find((n) => n.slug === focusSlug) ?? null;

  const toggleExpand = (slug: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mindmap controls">
        <button className={btnGhost} onClick={() => setZoom((z) => Math.min(1.75, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">＋ Zoom in</button>
        <button className={btnGhost} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">－ Zoom out</button>
        <button className={btnGhost} onClick={() => setZoom(1)}>Reset zoom</button>
        <button className={btnGhost} onClick={() => setExpanded(new Set(nodes.map((n) => n.slug)))}>Expand all branches</button>
        <button className={btnGhost} onClick={() => setExpanded(new Set())}>Collapse all</button>
        <button className={btnGhost} onClick={onOpenList}>Show as list instead</button>
        <span className={`text-sm ${muted}`}>Zoom: {Math.round(zoom * 100)}% · Tab through the nodes; Enter opens a module.</span>
      </div>

      <div className="overflow-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C]" style={{ maxHeight: 660 }}>
        <div style={{ width: innerW, height: innerH, transform: `scale(${zoom})`, transformOrigin: "top left" }} className="relative">
          <svg width={innerW} height={innerH} className="absolute inset-0" aria-hidden="true">
            {nodes.map((n, i) => {
              const y = TOP + i * ROW + ROW / 2;
              return <line key={n.slug} x1={center.x + 95} y1={center.y} x2={nodeX} y2={y} stroke="#94A3B8" strokeWidth="1.5" />;
            })}
          </svg>
          <div
            className="absolute flex items-center justify-center rounded-lg bg-[#0176D3] px-3 py-2 text-center text-[15px] font-semibold text-white"
            style={{ left: center.x - 95, top: center.y - 26, width: 190, minHeight: 52 }}
            role="img"
            aria-label="Varsity, the external learning library, branching to 17 modules"
          >
            📚 Varsity · Academy
          </div>
          {nodes.map((n, i) => {
            const y = TOP + i * ROW;
            const isOpen = expanded.has(n.slug);
            return (
              <div key={n.slug} className="absolute flex items-center gap-1" style={{ left: nodeX, top: y, width: 580 }}>
                <button
                  type="button"
                  className="min-h-8 max-w-[430px] truncate rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-1 text-left text-sm font-medium hover:border-[#0176D3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0176D3] dark:border-[#2B3644] dark:bg-[#171E27] dark:hover:border-[#1B96FF]"
                  aria-label={`${n.title}, ${n.count} chapters. ${n.blurb}`}
                  title={`${n.count} chapters · ${n.blurb}`}
                  onMouseEnter={() => setFocusSlug(n.slug)}
                  onFocus={() => setFocusSlug(n.slug)}
                  onClick={n.onOpen}
                >
                  {n.title} <span className={muted}>({n.count})</span>
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  style={{ minHeight: 32, padding: "0 10px" }}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} branch for ${n.title}`}
                  onClick={() => toggleExpand(n.slug)}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {focused && (
        <div className="rounded-lg border border-[#E4E9EF] p-4 dark:border-[#2B3644]" aria-live="polite">
          <p className="font-semibold">{focused.title} · {focused.count} chapters</p>
          <p className={`text-[15px] ${muted}`}>{focused.blurb}</p>
          <button className={btnGhost} onClick={focused.onOpen}>Open {focused.title} →</button>
        </div>
      )}

      {branchContent && Array.from(expanded).map((slug) => {
        const node = nodes.find((n) => n.slug === slug);
        if (!node) return null;
        return (
          <div key={slug} className="rounded-lg border border-[#E4E9EF] p-4 dark:border-[#2B3644]">
            <p className="font-semibold">{node.title} — branch chapters</p>
            {branchContent(slug)}
          </div>
        );
      })}
    </div>
  );
}

export interface ConceptTopic {
  label: string;
  href: string;
  external: boolean;
  ariaLabel: string;
}

export function VarsityConceptMap({ moduleTitle, topics }: { moduleTitle: string; topics: ConceptTopic[] }) {
  const ROW = 44;
  const TOP = 12;
  const innerW = 780;
  const innerH = TOP * 2 + topics.length * ROW;
  const center = { x: 130, y: innerH / 2 };
  const nodeX = 330;
  return (
    <div className="overflow-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C]" style={{ maxHeight: 460 }}>
      <div style={{ width: innerW, height: innerH }} className="relative">
        <svg width={innerW} height={innerH} className="absolute inset-0" aria-hidden="true">
          {topics.map((t, i) => (
            <line key={t.label} x1={center.x + 105} y1={center.y} x2={nodeX} y2={TOP + i * ROW + ROW / 2} stroke="#94A3B8" strokeWidth="1.5" />
          ))}
        </svg>
        <div
          className="absolute flex items-center justify-center rounded-lg bg-[#0176D3] px-3 py-2 text-center text-sm font-semibold text-white"
          style={{ left: center.x - 105, top: center.y - 26, width: 210, minHeight: 52 }}
          role="img"
          aria-label={`Concept map for ${moduleTitle}`}
        >
          {moduleTitle}
        </div>
        {topics.map((t, i) => (
          <a
            key={t.label}
            href={t.href}
            {...(t.external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="absolute flex min-h-8 max-w-[420px] items-center truncate rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-1 text-left text-sm font-medium hover:border-[#0176D3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0176D3] dark:border-[#2B3644] dark:bg-[#171E27] dark:hover:border-[#1B96FF]"
            style={{ left: nodeX, top: TOP + i * ROW }}
            aria-label={t.ariaLabel}
          >
            {t.label}{t.external ? " ↗" : ""}
          </a>
        ))}
      </div>
    </div>
  );
}
