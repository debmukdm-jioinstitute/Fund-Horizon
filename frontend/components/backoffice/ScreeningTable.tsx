"use client";

import React from "react";
import { MfScreeningRatioMeta, MfScreeningRow } from "@/lib/backoffice";
import { SignedValue } from "@/components/terminal/SignedValue";

interface ScreeningTableProps {
  rows: MfScreeningRow[];
  ratios: MfScreeningRatioMeta[];
  selectedColumns: string[];
  isRetainView?: boolean;
  onSelectScheme: (schemeCode: string) => void;
}

export default function ScreeningTable({
  rows,
  ratios,
  selectedColumns,
  isRetainView = false,
  onSelectScheme,
}: ScreeningTableProps) {
  const ratioMetaMap = new Map<string, MfScreeningRatioMeta>();
  ratios.forEach((r) => ratioMetaMap.set(r.key, r));

  function renderRatioValue(row: MfScreeningRow, colKey: string) {
    const val = (row as unknown as Record<string, number | null | undefined>)[colKey];
    if (val === null || val === undefined || isNaN(val)) {
      return <span className="text-[#536176] dark:text-[#A8B4C4]">—</span>;
    }

    const meta = ratioMetaMap.get(colKey);
    const unit = meta?.unit || "decimal";

    if (unit === "pct") {
      return <SignedValue value={val * 100} isPercent decimals={2} />;
    }
    if (unit === "ratio") {
      return (
        <span className="tabular-nums font-medium text-[#172033] dark:text-[#EDF2F7]">
          {val.toFixed(2)}x
        </span>
      );
    }
    return (
      <span className="tabular-nums text-[#172033] dark:text-[#EDF2F7]">
        {val.toFixed(2)}
      </span>
    );
  }

  return (
    <div className="terminal-panel overflow-hidden">
      <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
            {isRetainView ? "Q1 Retain Peers (Do Not Touch)" : "Screening Action Universe"} ({rows.length})
          </span>
          {isRetainView && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#006F64]/15 text-[#006F64] dark:text-[#75E1CE] font-mono">
              Excluded from action export by default
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#536176] dark:text-[#A8B4C4] font-mono">
          Click any row to open strategy inspection drawer
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="terminal-table">
          <thead>
            <tr>
              <th className="w-[8%]">Code</th>
              <th className="w-[24%]">Scheme Name &amp; Category</th>
              <th className="w-[12%]">Manager &amp; Tenure</th>
              <th className="w-[8%] text-center">2Y Quartile</th>
              <th className="w-[7%] text-right">Reg TER</th>
              {selectedColumns.map((colKey) => {
                const meta = ratioMetaMap.get(colKey);
                return (
                  <th key={colKey} className="text-right whitespace-nowrap">
                    {meta?.label || colKey}
                  </th>
                );
              })}
              <th className="w-[8%] text-right">1Y Return</th>
              <th className="w-[8%] text-right">3Y CAGR</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7 + selectedColumns.length}
                  className="py-12 text-center text-[#536176] dark:text-[#A8B4C4] text-[12px]"
                >
                  No funds match the current filter criteria and funnel thresholds.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const q = row.quartile_2y;
                return (
                  <tr
                    key={row.scheme_code}
                    onClick={() => onSelectScheme(row.scheme_code)}
                    className="cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition-colors"
                  >
                    {/* Scheme Code */}
                    <td className="font-mono text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                      {row.scheme_code}
                    </td>

                    {/* Scheme Name & Category */}
                    <td>
                      <div className="font-medium text-[#172033] dark:text-[#EDF2F7] leading-snug">
                        {row.scheme_name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[#536176] dark:text-[#A8B4C4]">
                        <span className="uppercase font-mono">{row.cat.replace(/_/g, " ")}</span>
                        {row.amc && <span>• {row.amc}</span>}
                        {row.pms_link && (
                          <span className="px-1 py-0.2 rounded bg-[#006F64]/10 text-[#006F64] dark:text-[#75E1CE] font-mono">
                            PMS Match
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Manager & Tenure */}
                    <td>
                      <div className="font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {row.manager_name || <span className="text-[#536176] dark:text-[#A8B4C4]">Unknown</span>}
                      </div>
                      <div className="text-[10px] text-[#536176] dark:text-[#A8B4C4] tabular-nums font-mono">
                        {row.manager_tenure_years !== null && row.manager_tenure_years !== undefined
                          ? `${row.manager_tenure_years.toFixed(1)} yrs`
                          : "No start date"}
                        {row.tenure_ratio !== null && row.tenure_ratio !== undefined && (
                          <span title="Tenure / 3Y Window"> ({row.tenure_ratio.toFixed(2)}x)</span>
                        )}
                      </div>
                    </td>

                    {/* 2Y Quartile Badge */}
                    <td className="text-center">
                      {q === 1 ? (
                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#006F64]/15 text-[#006F64] dark:text-[#75E1CE] font-medium">
                          Q1 Retain
                        </span>
                      ) : q === 2 || q === 3 ? (
                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#E4E9EF] dark:bg-[#2B3644] text-[#172033] dark:text-[#EDF2F7] font-medium">
                          Q{q} Review
                        </span>
                      ) : q === 4 ? (
                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#B42332]/10 text-[#B42332] dark:text-[#FF7D86]">
                          Q4 Dropped
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4] font-mono">
                          Unavail
                        </span>
                      )}
                    </td>

                    {/* Regular TER */}
                    <td className="text-right tabular-nums text-[12px] font-mono">
                      {row.expense_ratio !== null && row.expense_ratio !== undefined ? (
                        <span>{row.expense_ratio.toFixed(2)}%</span>
                      ) : (
                        <span className="text-[#536176] dark:text-[#A8B4C4]">—</span>
                      )}
                    </td>

                    {/* Dynamic Selected Ratio Columns */}
                    {selectedColumns.map((colKey) => (
                      <td key={colKey} className="text-right">
                        {renderRatioValue(row, colKey)}
                      </td>
                    ))}

                    {/* Trailing Returns */}
                    <td className="text-right">
                      {row.ret_1y !== null && row.ret_1y !== undefined ? (
                        <SignedValue value={row.ret_1y * 100} isPercent decimals={2} />
                      ) : (
                        <span className="text-[#536176] dark:text-[#A8B4C4]">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      {row.cagr_3y !== null && row.cagr_3y !== undefined ? (
                        <SignedValue value={row.cagr_3y * 100} isPercent decimals={2} />
                      ) : (
                        <span className="text-[#536176] dark:text-[#A8B4C4]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
