"use client";

import React from "react";

interface StatusBadgeProps {
  availability?: "ready" | "unavailable" | "blocked" | "needs_key" | "manual_only" | "schema_error" | string;
  freshness?: "current" | "stale" | "market_closed" | string;
  frequency?: "intraday" | "daily" | "monthly" | "quarterly" | string;
  asOf?: string;
  sourceName?: string;
  sourceUrl?: string;
  units?: string;
  className?: string;
}

export function StatusBadge({
  availability = "ready",
  freshness = "current",
  frequency,
  asOf,
  sourceName,
  sourceUrl,
  units,
  className = "",
}: StatusBadgeProps) {
  const getAvailabilityColor = (status: string) => {
    switch (status) {
      case "ready":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "needs_key":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "manual_only":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "blocked":
      case "schema_error":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "unavailable":
      default:
        return "bg-sand-100 text-sand-600 border-sand-300";
    }
  };

  const getFreshnessColor = (fresh: string) => {
    switch (fresh) {
      case "current":
        return "text-emerald-600";
      case "market_closed":
        return "text-blue-600";
      case "stale":
      default:
        return "text-amber-600";
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs font-mono ${className}`}>
      {/* Availability */}
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium uppercase tracking-wider ${getAvailabilityColor(
          availability
        )}`}
      >
        <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-75" />
        {availability.replace("_", " ")}
      </span>

      {/* Freshness */}
      {freshness && (
        <span className={`inline-flex items-center text-[11px] font-medium ${getFreshnessColor(freshness)}`}>
          • {freshness.replace("_", " ")}
        </span>
      )}

      {/* Frequency */}
      {frequency && (
        <span className="px-1.5 py-0.5 rounded bg-sand-100 text-sand-700 text-[10px] uppercase font-semibold">
          {frequency}
        </span>
      )}

      {/* Units */}
      {units && (
        <span className="text-sand-500 text-[11px]">
          [{units}]
        </span>
      )}

      {/* Observation Time */}
      {asOf && (
        <span className="text-sand-500 text-[11px]" title="Source observation time">
          as-of: <span className="font-semibold text-sand-700">{asOf}</span>
        </span>
      )}

      {/* Source link */}
      {sourceName && (
        <span className="text-sand-400 text-[11px]">
          via{" "}
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-forest-700 underline hover:text-forest-900"
            >
              {sourceName}
            </a>
          ) : (
            <span className="text-sand-600">{sourceName}</span>
          )}
        </span>
      )}
    </div>
  );
}
