"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getDerivatives, DerivativesData, BackofficeEnvelope } from "@/lib/backoffice";
import { formatNumber, formatISTDate } from "@/lib/terminal-format";

const INDICES = [
  { id: "NIFTY", name: "NIFTY 50", type: "index_fno" },
  { id: "BANKNIFTY", name: "NIFTY Bank", type: "index_fno" },
  { id: "FINNIFTY", name: "NIFTY Financial", type: "index_fno" },
  { id: "MIDCPNIFTY", name: "NIFTY Midcap", type: "index_fno" },
  { id: "SENSEX", name: "BSE SENSEX", type: "index_fno" },
  { id: "NIFTYNXT50", name: "NIFTY Next 50", type: "cash_only" },
];

type Contract = DerivativesData["contracts"][number];

// One row per strike with its call and put side by side (the API returns one record per contract).
function chainByStrike(contracts: Contract[]) {
  const rows = new Map<number, { strike: number; ce?: Contract; pe?: Contract }>();
  for (const c of contracts) {
    const row = rows.get(c.strike_price) ?? { strike: c.strike_price };
    if (c.option_type === "CE") row.ce = c;
    else row.pe = c;
    rows.set(c.strike_price, row);
  }
  return Array.from(rows.values()).sort((x, y) => x.strike - y.strike);
}

/** Whole contracts / strikes: Indian grouping, no decimals. */
function formatWhole(val?: number | null): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(val);
}

function formatIV(iv?: number | null): { text: string; warn: string | null } {
  if (iv === null || iv === undefined || Number.isNaN(iv)) return { text: "—", warn: null };
  const warn = iv > 100 ? "IV above 100% — treat as unreliable (thin or distressed quote)" : null;
  return { text: `${iv.toFixed(2)}%`, warn };
}

/** Session status derived from data freshness — never hardcoded. */
function sessionStatus(d: DerivativesData): { label: string; tone: "ok" | "warn" | "na" } {
  if (d.contracts.length === 0) return { label: "N/A", tone: "na" };
  const today = new Date().toISOString().slice(0, 10);
  if (d.expiry_date && d.expiry_date < today) return { label: "Expired", tone: "warn" };
  if (d.live_status === "live") return { label: "Active Session", tone: "ok" };
  if (d.live_status === "stale") return { label: "Stale", tone: "warn" };
  return { label: "N/A", tone: "na" };
}

function pcrLabel(pcr?: number | null): string {
  if (pcr === null || pcr === undefined || Number.isNaN(pcr)) return "N/A";
  if (pcr > 1.2) return "Bullish lean";
  if (pcr < 0.8) return "Bearish lean";
  return "Neutral";
}

export default function DerivativesPage() {
  const [selectedIndex, setSelectedIndex] = useState("NIFTY");
  const [data, setData] = useState<BackofficeEnvelope<DerivativesData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let stale = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await getDerivatives(selectedIndex, undefined, controller.signal);
        if (stale) return;
        setData(res);
      } catch (err: unknown) {
        if (controller.signal.aborted || stale) return;
        setError(err instanceof Error ? err.message : "Failed to load derivatives data");
      } finally {
        if (!stale) setLoading(false);
      }
    }
    load();
    return () => {
      stale = true;
      controller.abort();
    };
  }, [selectedIndex]);

  const currentIndexMeta = INDICES.find((i) => i.id === selectedIndex);
  const d = data?.data ?? null;
  const hasContracts = !!d && d.contracts.length > 0;
  const status = d ? sessionStatus(d) : null;
  const chain = useMemo(() => (d ? chainByStrike(d.contracts) : []), [d]);

  const statusTone =
    status?.tone === "ok"
      ? "text-[#087744] dark:text-[#58D6A0]"
      : status?.tone === "warn"
        ? "text-[#B45309] dark:text-[#FBBF24]"
        : "text-[#536176] dark:text-[#A8B4C4]";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Index Derivatives, Open Interest & PCR Analytics
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              NSE / BSE F&amp;O
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Option chain contracts, Put-Call Ratio (PCR) by OI and volume, and max pain distribution
          </p>
        </div>

        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono text-right">
          {d?.snapshot_timestamp && (
            <div>Last updated: {formatISTDate(d.snapshot_timestamp.slice(0, 10))} {d.snapshot_timestamp.slice(11, 16)} IST</div>
          )}
          <div>
            Feed:{" "}
            <a href="https://www.nseindia.com" target="_blank" rel="noreferrer" className="underline hover:text-[#172033] dark:hover:text-[#EDF2F7]">
              NSE Official F&amp;O Reports
            </a>
          </div>
        </div>
      </div>

      {/* Index Selector Bar */}
      <div className="terminal-panel p-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4] mr-2">
          Underlying:
        </span>
        {INDICES.map((idx) => {
          const isSelected = selectedIndex === idx.id;
          return (
            <button
              key={idx.id}
              onClick={() => setSelectedIndex(idx.id)}
              className={isSelected ? "terminal-btn-accent text-[12px] py-1 px-2.5" : "terminal-btn text-[12px] py-1 px-2.5"}
              aria-pressed={isSelected}
            >
              <span>{idx.name}</span>
              {idx.type === "cash_only" && (
                <span className="ml-1 text-[10px] opacity-75 font-mono">(Cash)</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Cash-Only Notice */}
      {currentIndexMeta?.type === "cash_only" && (
        <div className="terminal-panel p-3 border border-[#E4E9EF] dark:border-[#2B3644] text-[12px] text-[#536176] dark:text-[#A8B4C4]">
          <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">Cash Index Notice: </span>
          Cash index levels do not have intrinsic traded open interest. Traded volume is available strictly for listed derivative contracts.
        </div>
      )}

      {/* Feed notice (e.g. BSE blocking automated access) */}
      {!loading && d?.notice && (
        <div className="terminal-panel p-3 border border-[#B45309]/30 bg-[#B45309]/5 text-[12px] text-[#B45309] dark:text-[#FBBF24]">
          {d.notice}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading {currentIndexMeta?.name ?? selectedIndex} option chain…
        </div>
      ) : error || !d ? (
        <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
          <div className="font-medium mb-1">Error fetching derivatives</div>
          <div>{error}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Key Analytics Flat Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
              Index PCR &amp; Key Analytics Summary ({selectedIndex})
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[30%]">Derivative Metric</th>
                  <th className="w-[20%] text-right">Value</th>
                  <th className="w-[30%]">Analytical Breakdown</th>
                  <th className="w-[20%]">Status / Expiry</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Put-Call Ratio (Open Interest)</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {hasContracts && d.pcr_oi != null ? d.pcr_oi.toFixed(2) : "N/A"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                    {hasContracts
                      ? (d.pcr_oi_reason || `Total Call OI: ${formatWhole(d.total_call_oi)} | Total Put OI: ${formatWhole(d.total_put_oi)}`)
                      : "No contracts for this underlying"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]" title="PCR > 1.20 leans bullish · 0.80–1.20 neutral · < 0.80 leans bearish">
                    {hasContracts ? pcrLabel(d.pcr_oi) : "N/A"}
                  </td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Put-Call Ratio (Traded Volume)</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {hasContracts && d.pcr_volume != null ? d.pcr_volume.toFixed(2) : "N/A"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Put Traded Volume ÷ Call Traded Volume</td>
                  <td className={`text-[12px] font-medium ${statusTone}`}>{status?.label ?? "N/A"}</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Max Pain Strike</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {hasContracts && d.max_pain_strike ? formatWhole(d.max_pain_strike) : "N/A"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Minimum aggregate option payoff level</td>
                  <td
                    className="text-[12px] text-[#536176] dark:text-[#A8B4C4]"
                    title={hasContracts && d.expiry_date ? `Strike where option writers lose least, computed from OI across all strikes for expiry ${formatISTDate(d.expiry_date)}` : undefined}
                  >
                    {hasContracts ? "Calculated" : "N/A"}
                  </td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Underlying Spot / Future Price</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {d.underlying_price ? `₹${formatNumber(d.underlying_price)}` : "N/A"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Index underlying reference price</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                    Expiry: {d.expiry_date ? formatISTDate(d.expiry_date) : "N/A"}
                    {d.expiry_date && d.expiry_date < new Date().toISOString().slice(0, 10) && (
                      <span className="ml-1 text-[#B45309] dark:text-[#FBBF24] font-medium">(expired)</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="px-2.5 py-2 border-t border-[#E4E9EF] dark:border-[#2B3644] text-[10px] text-[#536176] dark:text-[#A8B4C4] font-mono">
              PCR legend: &gt;1.20 bullish lean · 0.80–1.20 neutral · &lt;0.80 bearish lean · OI &amp; volume in contracts
            </div>
          </div>

          {/* Option Chain Dense Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
              Dense Option Chain Matrix
              {d.expiry_date && <span className="normal-case font-normal"> · Expiry {formatISTDate(d.expiry_date)}</span>}
            </div>

            {!hasContracts ? (
              <div className="p-8 text-center text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                <div className="font-medium mb-1 text-[#172033] dark:text-[#EDF2F7]">No option chain available</div>
                <p className="max-w-md mx-auto">
                  {selectedIndex === "SENSEX"
                    ? "SENSEX options trade on BSE, whose API blocks automated access — no feed is available."
                    : selectedIndex === "NIFTYNXT50"
                      ? "NIFTY Next 50 is a cash index without listed index options."
                      : "No contracts were returned for this underlying. The feed may be temporarily unavailable."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="terminal-table text-center">
                  <thead>
                    <tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]">
                      <th colSpan={3} className="text-center font-semibold bg-[#F7F9FB] dark:bg-[#171E27] border-r border-[#E4E9EF] dark:border-[#2B3644]">
                        CALLS (CE)
                      </th>
                      <th className="text-center font-semibold bg-[#E4E9EF]/50 dark:bg-[#2B3644]/50">
                        STRIKE
                      </th>
                      <th colSpan={3} className="text-center font-semibold bg-[#F7F9FB] dark:bg-[#171E27] border-l border-[#E4E9EF] dark:border-[#2B3644]">
                        PUTS (PE)
                      </th>
                    </tr>
                    <tr className="text-[11px]">
                      <th className="text-right" title="Open interest in contracts">Call OI (contracts)</th>
                      <th className="text-right" title="Traded volume in contracts">Volume (contracts)</th>
                      <th className="text-right border-r border-[#E4E9EF] dark:border-[#2B3644]" title="Implied volatility as reported by NSE">IV (%)</th>
                      <th className="text-center font-semibold bg-[#E4E9EF]/20 dark:bg-[#2B3644]/20" title="Strike price in rupees">Strike (₹)</th>
                      <th className="text-right border-l border-[#E4E9EF] dark:border-[#2B3644]" title="Implied volatility as reported by NSE">IV (%)</th>
                      <th className="text-right" title="Traded volume in contracts">Volume (contracts)</th>
                      <th className="text-right" title="Open interest in contracts">Put OI (contracts)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.map(({ strike, ce, pe }) => {
                      const ceIV = formatIV(ce?.implied_volatility);
                      const peIV = formatIV(pe?.implied_volatility);
                      return (
                        <tr key={strike}>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">{ce ? formatWhole(ce.oi) : "—"}</td>
                          <td className="text-right text-[#536176] dark:text-[#A8B4C4]">{ce ? formatWhole(ce.volume) : "—"}</td>
                          <td className="text-right text-[#536176] dark:text-[#A8B4C4] border-r border-[#E4E9EF] dark:border-[#2B3644]" title={ceIV.warn ?? undefined}>
                            {ceIV.text}
                            {ceIV.warn && <span className="ml-1 text-[#B45309] dark:text-[#FBBF24]">⚠</span>}
                          </td>
                          <td className="text-center font-medium text-[#172033] dark:text-[#EDF2F7] bg-[#F7F9FB] dark:bg-[#171E27]">
                            {formatWhole(strike)}
                          </td>
                          <td className="text-right text-[#536176] dark:text-[#A8B4C4] border-l border-[#E4E9EF] dark:border-[#2B3644]" title={peIV.warn ?? undefined}>
                            {peIV.text}
                            {peIV.warn && <span className="ml-1 text-[#B45309] dark:text-[#FBBF24]">⚠</span>}
                          </td>
                          <td className="text-right text-[#536176] dark:text-[#A8B4C4]">{pe ? formatWhole(pe.volume) : "—"}</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">{pe ? formatWhole(pe.oi) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
