// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CompareResponse } from "@/lib/types";
import { CATEGORY_LABELS, pct } from "@/lib/format";

interface Props {
  initialData: CompareResponse | null;
}

export function CompareView({ initialData }: Props) {
  const router = useRouter();
  const [data] = useState<CompareResponse | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");

  const funds = data?.funds ?? [];
  const correlation = data?.correlation;

  // Determine top metrics for highlighting
  const maxCagr3y = Math.max(...funds.map((f) => f.cagr_3y ?? -Infinity));
  const maxCagr5y = Math.max(...funds.map((f) => f.cagr_5y ?? -Infinity));
  const minVol = Math.min(...funds.map((f) => f.vol_3y ?? Infinity));
  const maxSharpe = Math.max(...funds.map((f) => f.sharpe_3y ?? -Infinity));
  const minDrawdown = Math.max(...funds.map((f) => f.max_drawdown_3y ?? -Infinity)); // drawdown is negative, so max is closest to 0

  const handleRemove = (codeToRemove: string) => {
    const remaining = funds.map((f) => f.scheme_code).filter((c) => c !== codeToRemove);
    if (remaining.length < 2) {
      setError("At least 2 schemes are required for side-by-side comparison.");
      return;
    }
    router.push(`/funds/compare?codes=${remaining.join(",")}`);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCode.trim();
    if (!trimmed) return;
    if (funds.some((f) => f.scheme_code === trimmed)) {
      setError("Scheme is already included in this comparison.");
      return;
    }
    if (funds.length >= 8) {
      setError("A maximum of 8 schemes can be compared simultaneously.");
      return;
    }
    const updated = [...funds.map((f) => f.scheme_code), trimmed];
    router.push(`/funds/compare?codes=${updated.join(",")}`);
    setNewCode("");
  };

  if (!data || funds.length < 2) {
    return (
      <div className="card space-y-2" data-testid="compare-empty">
        <h2 className="text-base font-bold text-navy-950">Need two schemes to compare</h2>
        <p className="text-sm text-navy-700">
          Comparison requires 2 to 8 scheme codes. Open a scheme page and use Compare Scheme,
          or add a second code below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add Scheme Form */}
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-navy-950">Add Scheme to Comparison</h2>
          <p className="text-xs text-navy-700" data-testid="compare-fund-count">
            Compare 2 to 8 schemes side-by-side. Currently comparing {funds.length} scheme(s).
          </p>
        </div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newCode}
            onChange={(e) => {
              setNewCode(e.target.value);
              setError(null);
            }}
            placeholder="Scheme code (e.g. 120503)"
            className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs text-navy-950 focus:border-teal-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={funds.length >= 8}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">
          {error}
        </div>
      )}

      {/* Side-by-side Comparison Table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[700px] text-left text-sm">
          <caption className="sr-only">Side-by-side scheme comparison</caption>
          <thead className="bg-navy-50 text-xs text-navy-700">
            <tr>
              <th scope="col" className="p-3">Metric</th>
              {funds.map((f) => (
                <th key={f.scheme_code} scope="col" className="p-3 font-semibold text-navy-950">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span>{f.scheme_name}</span>
                      <div className="mt-0.5 text-xs font-normal text-navy-700">
                        Code: {f.scheme_code}
                      </div>
                    </div>
                    {funds.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemove(f.scheme_code)}
                        className="rounded p-1 text-xs text-navy-400 hover:bg-navy-200 hover:text-rose-700"
                        title="Remove scheme"
                        aria-label={`Remove ${f.scheme_name}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            <tr>
              <td className="p-3 font-medium text-navy-700">Category</td>
              {funds.map((f) => (
                <td key={f.scheme_code} className="p-3 text-xs">
                  {CATEGORY_LABELS[f.category] ?? f.category}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">AMC</td>
              {funds.map((f) => (
                <td key={f.scheme_code} className="p-3 text-xs">{f.amc}</td>
              ))}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">3Y CAGR</td>
              {funds.map((f) => {
                const isTop = f.cagr_3y !== null && f.cagr_3y === maxCagr3y && funds.length > 1;
                return (
                  <td key={f.scheme_code} className="p-3">
                    <span
                      data-testid={`compare-cagr-3y-${f.scheme_code}`}
                      className={`inline-block rounded px-1.5 py-0.5 font-bold ${isTop ? "bg-teal-100 text-teal-800" : "text-navy-950"}`}
                    >
                      {f.cagr_3y !== null ? pct(f.cagr_3y) : "—"}
                    </span>
                    {isTop && <span className="ml-1 text-xs text-teal-700 font-semibold">(Highest)</span>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">5Y CAGR</td>
              {funds.map((f) => {
                const isTop = f.cagr_5y !== null && f.cagr_5y === maxCagr5y && funds.length > 1;
                return (
                  <td key={f.scheme_code} className="p-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-bold ${isTop ? "bg-teal-100 text-teal-800" : "text-navy-950"}`}>
                      {f.cagr_5y !== null ? pct(f.cagr_5y) : "—"}
                    </span>
                    {isTop && <span className="ml-1 text-xs text-teal-700 font-semibold">(Highest)</span>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">3Y Volatility</td>
              {funds.map((f) => {
                const isLowest = f.vol_3y !== null && f.vol_3y === minVol && funds.length > 1;
                return (
                  <td key={f.scheme_code} className="p-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-bold ${isLowest ? "bg-teal-100 text-teal-800" : "text-navy-950"}`}>
                      {f.vol_3y !== null ? pct(f.vol_3y) : "—"}
                    </span>
                    {isLowest && <span className="ml-1 text-xs text-teal-700 font-semibold">(Lowest)</span>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">3Y Sharpe Ratio</td>
              {funds.map((f) => {
                const isTop = f.sharpe_3y !== null && f.sharpe_3y === maxSharpe && funds.length > 1;
                return (
                  <td key={f.scheme_code} className="p-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-bold ${isTop ? "bg-teal-100 text-teal-800" : "text-navy-950"}`}>
                      {f.sharpe_3y !== null ? f.sharpe_3y.toFixed(2) : "—"}
                    </span>
                    {isTop && <span className="ml-1 text-xs text-teal-700 font-semibold">(Highest)</span>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">Max Drawdown (3Y)</td>
              {funds.map((f) => {
                const isLowest = f.max_drawdown_3y !== null && f.max_drawdown_3y === minDrawdown && funds.length > 1;
                return (
                  <td key={f.scheme_code} className="p-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-bold ${isLowest ? "bg-teal-100 text-teal-800" : "text-navy-950"}`}>
                      {f.max_drawdown_3y !== null ? pct(f.max_drawdown_3y) : "—"}
                    </span>
                    {isLowest && <span className="ml-1 text-xs text-teal-700 font-semibold">(Lowest drop)</span>}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className="p-3 font-medium text-navy-700">Details</td>
              {funds.map((f) => (
                <td key={f.scheme_code} className="p-3">
                  <Link
                    href={`/funds/${f.scheme_code}`}
                    className="text-xs font-semibold text-teal-700 hover:underline"
                  >
                    View Deep Analytics →
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Correlation Matrix and Overlap Proxy */}
      {correlation && (
        <section className="card space-y-4">
          <div>
            <h2 className="text-lg font-bold text-navy-950">Return Correlation & Overlap Proxy</h2>
            <div className="mt-1 rounded-md bg-amber-50 p-2.5 text-xs text-amber-900 border border-amber-200">
              <strong>Notice:</strong> {correlation.label}. High correlation indicates that historical returns move together in the market; it does not measure underlying security holdings overlap.
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-center text-xs">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th scope="col" className="p-2 text-left">Scheme</th>
                  {funds.map((f) => (
                    <th key={f.scheme_code} scope="col" className="p-2 font-semibold">
                      {f.scheme_code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {funds.map((rowFund) => (
                  <tr key={rowFund.scheme_code}>
                    <td className="p-2 text-left font-medium text-navy-900">
                      {rowFund.scheme_code} ({rowFund.scheme_name.slice(0, 20)}...)
                    </td>
                    {funds.map((colFund) => {
                      const i = correlation.codes.indexOf(rowFund.scheme_code);
                      const j = correlation.codes.indexOf(colFund.scheme_code);
                      const corrVal =
                        i >= 0 && j >= 0 && correlation.matrix[i]?.[j] !== undefined
                          ? correlation.matrix[i][j]
                          : 1.0;
                      const isHigh = corrVal >= 0.85 && rowFund.scheme_code !== colFund.scheme_code;
                      return (
                        <td
                          key={colFund.scheme_code}
                          className={`p-2 font-mono font-medium ${
                            rowFund.scheme_code === colFund.scheme_code
                              ? "bg-navy-50 text-navy-400"
                              : isHigh
                              ? "bg-amber-100 text-amber-900 font-bold"
                              : "text-navy-800"
                          }`}
                        >
                          {corrVal.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {correlation.flagged_pairs && correlation.flagged_pairs.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">High correlation alert (&ge; 0.85):</p>
              <ul className="mt-1 list-disc pl-5">
                {correlation.flagged_pairs.map((p) => (
                  <li key={`${p.scheme_1}-${p.scheme_2}`}>
                    Schemes {p.scheme_1} and {p.scheme_2} exhibit high return correlation ({p.correlation.toFixed(2)}), providing minimal diversification benefit.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Disclaimers */}
      <footer className="card bg-navy-50 text-xs text-navy-700 space-y-2">
        <p className="font-semibold text-navy-900">Important Disclosures</p>
        <p>{data?.disclaimer}</p>
        <p>
          Fund Horizon distributes Regular plans only under AMFI ARN 345439. Mutual fund investments are subject to market risks; read all scheme related documents carefully.
        </p>
      </footer>
    </div>
  );
}
