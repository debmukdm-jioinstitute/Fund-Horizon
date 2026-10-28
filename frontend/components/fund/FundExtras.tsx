"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FundPeers, FundPortfolio } from "@/lib/types";
import { pct } from "@/lib/format";

/** Bar whose width animates from 0 when it scrolls into view. */
function Bar({ value, max, tone = "bg-teal-600" }: { value: number; max: number; tone?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="h-2 w-full rounded bg-black/10 dark:bg-white/15">
      <div className={`h-2 rounded ${tone} transition-[width] duration-700 ease-out motion-reduce:transition-none`} style={{ width: on ? `${Math.min(100, (value / max) * 100)}%` : "0%" }} />
    </div>
  );
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** SIP / lumpsum what-if using the fund's own trailing CAGR. Illustrative, not a forecast. */
export function ReturnsCalculator({ cagr }: { cagr: { "3Y": number | null; "5Y": number | null } }) {
  const [mode, setMode] = useState<"sip" | "lump">("sip");
  const [amount, setAmount] = useState(10000);
  const [years, setYears] = useState(5);
  const [basis, setBasis] = useState<"3Y" | "5Y">(cagr["5Y"] != null ? "5Y" : "3Y");
  const rate = cagr[basis];
  if (rate == null) return <p className="text-sm opacity-70">Not enough history to illustrate returns for this fund.</p>;
  const r = rate; // API CAGRs are fractions (0.0526), same unit pct() expects
  const invested = mode === "sip" ? amount * 12 * years : amount;
  const mr = Math.pow(1 + r, 1 / 12) - 1;
  const value = mode === "sip" ? (mr === 0 ? invested : amount * ((Math.pow(1 + mr, years * 12) - 1) / mr) * (1 + mr)) : amount * Math.pow(1 + r, years);
  const gain = value - invested;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3 text-sm">
        <div className="inline-flex rounded border border-black/10 dark:border-white/10 p-0.5" role="group" aria-label="Investment type">
          {(["sip", "lump"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`rounded px-3 py-1 text-xs transition-colors ${mode === m ? "bg-teal-600 text-white" : "opacity-70"}`}>
              {m === "sip" ? "Monthly SIP" : "One-time"}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="flex justify-between text-xs opacity-70"><span>{mode === "sip" ? "Monthly amount" : "Amount"}</span><b className="text-navy-950">{inr(amount)}</b></span>
          <input type="range" min={mode === "sip" ? 500 : 5000} max={mode === "sip" ? 100000 : 5000000} step={mode === "sip" ? 500 : 5000} value={amount} onChange={(e) => setAmount(+e.target.value)} className="w-full accent-teal-600" />
        </label>
        <label className="block">
          <span className="flex justify-between text-xs opacity-70"><span>Period</span><b className="text-navy-950">{years} yrs</b></span>
          <input type="range" min={1} max={30} value={years} onChange={(e) => setYears(+e.target.value)} className="w-full accent-teal-600" />
        </label>
        <div className="flex items-center gap-2 text-xs opacity-70">
          Rate used:
          {(["3Y", "5Y"] as const).map((b) => cagr[b] != null && (
            <button key={b} type="button" onClick={() => setBasis(b)} aria-pressed={basis === b} className={`rounded border px-2 py-0.5 transition-colors ${basis === b ? "border-teal-600 text-teal-700 dark:text-teal-300" : "border-black/10 dark:border-white/10"}`}>{b} CAGR {pct(cagr[b]!)}</button>
          ))}
        </div>
      </div>
      <div className="rounded-lg bg-black/5 dark:bg-white/5 p-4 text-sm">
        <p className="text-xs opacity-70">Illustrative value after {years} years</p>
        <p className="mt-1 text-2xl font-bold" data-testid="calc-value">{inr(value)}</p>
        <dl className="mt-3 space-y-1">
          <div className="flex justify-between"><dt className="opacity-70">Invested</dt><dd className="font-medium">{inr(invested)}</dd></div>
          <div className="flex justify-between"><dt className="opacity-70">Est. gain</dt><dd className="font-medium text-teal-800 dark:text-teal-300">{inr(gain)}</dd></div>
        </dl>
        <p className="mt-3 text-[11px] opacity-70">Assumes the fund repeats its past {basis} CAGR every year. Past performance is not a guide to future returns; this is not a forecast.</p>
      </div>
    </div>
  );
}

export function PeerTable({ data, code, hrefBase = "/funds" }: { data: FundPeers; code: string; hrefBase?: string }) {
  return (
    <div className="space-y-2">
      {data.rank && <p className="text-sm opacity-70">Ranks <b className="text-navy-950">#{data.rank}</b> of {data.count} funds in its category by 3Y CAGR.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-black/10 dark:border-white/10 text-left text-xs opacity-70"><th className="py-1.5 pr-2">Fund</th><th className="px-2 text-right">1Y</th><th className="px-2 text-right">3Y CAGR</th><th className="px-2 text-right">5Y CAGR</th><th className="px-2 text-right">Sharpe 3Y</th></tr></thead>
          <tbody>
            {data.peers.map((p) => (
              <tr key={p.scheme_code} className={`border-b border-black/10 dark:border-white/10 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${p.scheme_code === code ? "bg-teal-500/10 font-medium" : ""}`}>
                <td className="py-1.5 pr-2"><Link href={`${hrefBase}/${p.scheme_code}`} className="hover:underline">{p.scheme_name}</Link></td>
                <td className="px-2 text-right tabular-nums">{p.ret_1y != null ? pct(p.ret_1y) : "—"}</td>
                <td className="px-2 text-right tabular-nums">{p.cagr_3y != null ? pct(p.cagr_3y) : "—"}</td>
                <td className="px-2 text-right tabular-nums">{p.cagr_5y != null ? pct(p.cagr_5y) : "—"}</td>
                <td className="px-2 text-right tabular-nums">{p.sharpe_3y != null ? p.sharpe_3y.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Unavailable = ({ what }: { what: string }) => (
  <p className="text-sm opacity-70">{what} is not available for this fund yet: its monthly portfolio file is not ingested. Shown as unavailable, never estimated.</p>
);

const Meta = ({ p }: { p: FundPortfolio }) => (
  <p className="text-[11px] opacity-70">
    As of {p.as_of ?? "—"}{p.amc ? ` · ${p.amc} monthly disclosure` : ""}
    {p.coverage_pct != null && p.coverage_pct < 99 ? ` · covers ${p.coverage_pct.toFixed(0)}% of the portfolio (equity only)` : ""}
  </p>
);

export function AssetAllocation({ p }: { p: FundPortfolio | null }) {
  if (!p) return <Unavailable what="Asset allocation" />;
  const eq = p.holdings.filter((h) => h.instrument_type === "equity").reduce((a, h) => a + (h.weight_pct ?? 0), 0);
  const cash = p.summary.cash_pct ?? 0;
  const other = Math.max(0, p.total_weight_pct - eq - cash);
  const rows: [string, number, string][] = [["Equity", eq, "bg-teal-600"], ["Cash & equivalents", cash, "bg-slate-500"], ["Debt / other", other, "bg-amber-500"]];
  return (
    <div className="space-y-3">
      {rows.filter(([, v]) => v > 0.005).map(([l, v, tone]) => (
        <div key={l}><div className="mb-1 flex justify-between text-sm"><span>{l}</span><b className="tabular-nums">{v.toFixed(2)}%</b></div><Bar value={v} max={100} tone={tone} /></div>
      ))}
      <Meta p={p} />
    </div>
  );
}

export function SectorAllocation({ p }: { p: FundPortfolio | null }) {
  if (!p || p.sectors.length === 0) return <Unavailable what="Sector allocation" />;
  const max = p.sectors[0].weight_pct;
  return (
    <div className="space-y-2.5">
      {p.sectors.slice(0, 12).map((s) => (
        <div key={s.sector}><div className="mb-1 flex justify-between text-sm"><span>{s.sector}</span><b className="tabular-nums">{s.weight_pct.toFixed(2)}%</b></div><Bar value={s.weight_pct} max={max} /></div>
      ))}
      {p.unclassified_pct > 0 && <p className="text-xs opacity-70">Unclassified (cash, debt, other): {p.unclassified_pct.toFixed(2)}%</p>}
      <Meta p={p} />
    </div>
  );
}

export function HoldingsTable({ p }: { p: FundPortfolio | null }) {
  const [all, setAll] = useState(false);
  if (!p || p.holdings.length === 0) return <Unavailable what="Holdings" />;
  const rows = [...p.holdings].sort((a, b) => (b.weight_pct ?? 0) - (a.weight_pct ?? 0));
  const shown = all ? rows : rows.slice(0, 10);
  const max = rows[0].weight_pct ?? 1;
  return (
    <div className="space-y-2">
      <p className="text-sm opacity-70">{p.summary.holdings_count} holdings · top 10 are {p.summary.top10_concentration_pct?.toFixed(1)}% of the portfolio.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="border-b border-black/10 dark:border-white/10 text-left text-xs opacity-70"><th className="py-1.5 pr-2">Company</th><th className="px-2">Sector</th><th className="w-40 px-2 text-right">Weight</th></tr></thead>
          <tbody>
            {shown.map((h, i) => (
              <tr key={`${h.isin ?? h.name}-${i}`} className="border-b border-black/10 dark:border-white/10 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                <td className="py-1.5 pr-2">{h.name}</td>
                <td className="px-2 opacity-70">{h.sector ?? "—"}</td>
                <td className="px-2"><div className="flex items-center gap-2"><div className="flex-1"><Bar value={h.weight_pct ?? 0} max={max} /></div><span className="w-12 text-right tabular-nums">{(h.weight_pct ?? 0).toFixed(2)}%</span></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && <button type="button" onClick={() => setAll(!all)} className="text-sm text-teal-700 dark:text-teal-300 hover:underline">{all ? "Show top 10" : `Show all ${rows.length}`}</button>}
      <Meta p={p} />
    </div>
  );
}
