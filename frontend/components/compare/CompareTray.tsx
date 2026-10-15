"use client";

import React from "react";

interface CompareTrayProps {
  labels: { id: string; name: string }[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
}

export default function CompareTray({ labels, onRemove, onClear, onCompare }: CompareTrayProps) {
  if (labels.length === 0) return null;

  return (
    <div
      className="sticky bottom-4 z-40 mx-6 flex flex-wrap items-center gap-2 rounded-xl border border-[#E4E9EF] bg-[#FFFFFF]/95 p-3 shadow-lg backdrop-blur dark:border-[#2B3644] dark:bg-[#10151C]/95"
      style={{ marginLeft: 24, marginRight: 24 }}
    >
      {labels.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex max-w-[200px] items-center gap-1 truncate rounded-lg border border-[#E4E9EF] bg-[#F7F9FB] px-2 py-1 text-[12px] font-medium text-[#172033] dark:border-[#2B3644] dark:bg-[#171E27] dark:text-[#EDF2F7]"
        >
          <span className="truncate">{chip.name}</span>
          <button
            type="button"
            className="shrink-0 text-[#536176] hover:text-[#172033] dark:text-[#A8B4C4] dark:hover:text-[#EDF2F7]"
            aria-label={`Remove ${chip.name}`}
            onClick={() => onRemove(chip.id)}
          >
            ✕
          </button>
        </span>
      ))}
      <button type="button" className="terminal-btn text-[12px] py-1 px-3" onClick={onClear}>
        Clear
      </button>
      <button
        type="button"
        disabled={labels.length < 2}
        className="terminal-btn text-[12px] py-1 px-3 bg-[#0176D3] text-white border-[#0176D3] disabled:opacity-40 dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
        onClick={onCompare}
      >
        Compare ({labels.length})
      </button>
    </div>
  );
}
