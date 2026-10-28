"use client";

import React, { useEffect, useState } from "react";
import { getMfExplain, type MfExplain, type MfExplainPart, type MfScreenerRow } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

const n = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "not available");
const PERIOD = (k: string) => {
  const m = k.match(/_(\d+)([ym])$/);
  return m ? `${m[1]} ${m[2] === "y" ? "year" : "month"}${m[1] === "1" ? "" : "s"}` : k.endsWith("_si") ? "since launch" : k.endsWith("_all") ? "the fund's whole life" : "";
};

/** Plain meaning of each measure. Only definitions live here; every number, rank, weight and rule comes from the backend. */
const GLOSSARY: Record<string, { what: string; how: string; read: string }> = {
  ret: { what: "How much the fund's NAV (unit price) grew over this period.", how: "(Latest NAV ÷ NAV at the start of the period − 1) × 100. Not annualised.", read: "Higher is better, but compare with the category average shown under the number; a fund that beat its peers is more skilful than one that just rode a rising market." },
  cagr: { what: "The steady yearly growth rate that would turn the starting NAV into today's NAV.", how: "(Latest NAV ÷ starting NAV)^(1 ÷ years) − 1. It smooths out the ups and downs into one yearly number.", read: "Higher is better. Always compare with the category average; 12% a year is great in a weak market and poor in a strong one." },
  out: { what: "How much better or worse the fund did than the average of its peers.", how: "Fund return minus the average return of funds in the same category and plan (Direct/Regular), in percentage points.", read: "Positive means the fund beat its peers; negative means it lagged. There is no market-index series yet, so peers are the yardstick." },
  alpha: { what: "Extra return the fund earned over what its risk level alone would justify.", how: "Fund return minus the category median return, after adjusting for how much the fund moved with the category (beta).", read: "Positive alpha suggests the manager added value; negative means the fund gave away return. Measured against category median, not a market index." },
  beta: { what: "How strongly the fund moves when its category moves.", how: "Slope of the fund's returns against the category median's returns.", read: "1.0 moves in step with peers; above 1 swings more (higher risk and reward); below 1 swings less." },
  sharpe: { what: "Return earned for each unit of total risk taken.", how: "(Fund return − risk-free rate) ÷ volatility (standard deviation).", read: "Higher is better. Above 1 is good, 0.5–1 is acceptable, below 0.5 means you were poorly paid for the ups and downs." },
  sortino: { what: "Like Sharpe, but only punishes the bad (downside) swings.", how: "(Fund return − risk-free rate) ÷ downside deviation.", read: "Higher is better. A Sortino well above Sharpe means most of the volatility was upward, which is welcome." },
  treynor: { what: "Return earned for each unit of market-linked risk (beta).", how: "(Fund return − risk-free rate) ÷ beta.", read: "Higher is better. Useful for comparing funds held as one part of a larger portfolio." },
  vol: { what: "How much the fund's returns bounce around (standard deviation, annualised).", how: "Standard deviation of the fund's periodic returns over the window.", read: "Lower means a smoother ride. It is a measure of bumpiness, not of loss, so compare within the same category." },
  cap_up: { what: "How much of the market's rises the fund captured.", how: "Fund's average return in up-periods ÷ benchmark's average return in up-periods, × 100.", read: "Above 100% means it rose more than the market when the market rose. Higher is better." },
  cap_down: { what: "How much of the market's falls the fund suffered.", how: "Fund's average return in down-periods ÷ benchmark's average return in down-periods, × 100.", read: "Below 100% means it fell less than the market. Lower is better." },
  cap_ratio: { what: "Up capture divided by down capture in one number.", how: "Up capture ÷ down capture.", read: "Above 1 means the fund gains more in good times than it loses in bad times. Higher is better." },
  max_dd: { what: "The worst peak-to-bottom fall in the fund's NAV in the window.", how: "Largest percentage drop from a previous high to a later low.", read: "Closer to zero is better. It tells you the worst loss a holder would have sat through." },
  roll1y_pos: { what: "How often a random one-year holding made money.", how: "Share of all rolling 1-year windows with a positive return (compared with zero, not with peers).", read: "Higher is better; 90% means 9 in 10 one-year holding periods were profitable." },
  ter: { what: "The yearly fee the fund charges, taken from your money.", how: "Total expense ratio as a % of assets, for this plan (Direct or Regular), from the AMC's disclosure.", read: "Lower is better; every 1% in fees comes straight off your return each year." },
  aum_cr: { what: "Total money the fund manages, in crores of rupees.", how: "Latest AMFI quarterly average AUM, summed over the scheme's plans.", read: "Very small funds can be shut or merged; very large ones can struggle to trade. Mid-sized and growing is usually healthiest." },
  nav: { what: "The price of one unit of the fund.", how: "Fund's total assets minus liabilities, divided by units, published daily by the AMC.", read: "A high or low NAV says nothing about whether the fund is expensive; only the percentage change matters." },
  day_chg: { what: "Change in NAV since the previous trading day.", how: "(Latest NAV ÷ previous NAV − 1) × 100.", read: "Short-term noise; do not judge a fund on it." },
  week_chg: { what: "Change in NAV over the last week.", how: "(Latest NAV ÷ NAV a week ago − 1) × 100.", read: "Short-term noise; use the 3 to 5 year numbers to judge quality." },
  hi52: { what: "Highest NAV in the last 52 weeks.", how: "Maximum daily NAV over the past year.", read: "A NAV near its high means recent strength; far below means it has fallen back." },
  lo52: { what: "Lowest NAV in the last 52 weeks.", how: "Minimum daily NAV over the past year.", read: "Shows how deep the last year's dip was." },
  cat_label: { what: "The peer group this fund is judged against.", how: "SEBI category of the scheme, with the benchmark index used for the category.", read: "Scores and ranks compare a fund only with others in the same category and plan." },
};

const baseKey = (k: string) => {
  const s = k.replace(/_(\d+[ym]|si|all)$/, "");
  return s.startsWith("ret_") ? "ret" : s.startsWith("cagr_") ? "cagr" : s.startsWith("out_") ? "out" : s;
};

function PartRow({ p }: { p: MfExplainPart }) {
  const pct = p.percentile;
  return (
    <li className="px-2 py-1.5 space-y-0.5">
      <div className="flex justify-between gap-3">
        <span>{p.label}{p.weight != null ? ` (weight ${Math.round(p.weight * 100)}%)` : ""}</span>
        <span className="font-medium tabular-nums">{p.max != null ? `${n(p.value, 0)} / ${p.max} · ${p.label_text}` : n(p.value)}</span>
      </div>
      {pct != null && (
        <>
          <div className="h-1 rounded bg-[#E5E5E5] dark:bg-[#2B3644]" aria-hidden><div className="h-1 rounded bg-[#0176D3] dark:bg-[#1B96FF]" style={{ width: `${pct}%` }} /></div>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
            Rank {p.rank} of {p.peers_with_data} peers, better than {n(pct, 0)}% of them. Peer median {n(p.median)}, best {n(p.best)}.
          </p>
        </>
      )}
      {pct == null && p.median != null && <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Peer median {n(p.median)} across {p.peers_with_data} peers.</p>}
    </li>
  );
}

export default function MfMetricExplain({ metric, row, onClose }: { metric: { key: string; label: string } | null; row: MfScreenerRow | null; onClose: () => void }) {
  const [data, setData] = useState<MfExplain | null>(null);
  const [err, setErr] = useState("");
  const key = metric?.key, code = row?.code;
  useEffect(() => {
    if (!key || !code) return;
    const ac = new AbortController();
    setData(null); setErr("");
    getMfExplain(code, key, ac.signal).then(setData).catch((e) => { if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : "Could not load the explanation."); });
    return () => ac.abort();
  }, [key, code]);
  if (!metric || !row) return null;
  const g = GLOSSARY[baseKey(metric.key)];
  const period = PERIOD(metric.key);
  const pillar = data?.points != null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={`${metric.label} explained`} onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-[#10161D] border border-[#E5E5E5] dark:border-[#2B3644] p-4 space-y-3 text-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">{metric.label}{period && ` (${period})`}</h2>
            <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{row.name} · {row.plan}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="terminal-btn text-[12px] py-0.5 px-2">✕</button>
        </div>
        {err && <p role="alert" className="text-[#9B1C2E] dark:text-[#FFA9B5]">{err}</p>}
        {!data && !err && <p className="text-[#706E6B] dark:text-[#A8B4C4]">Computing live from the latest data…</p>}
        {data && (
          <>
            {pillar && (
              <section>
                <h3 className="font-semibold">Result</h3>
                <p>{n(data.points, 0)} out of {data.bands.max}: <strong>{data.label}</strong>. {data.bands.top}+ is the top band, {data.bands.mid}+ the middle, anything lower the weak band.</p>
              </section>
            )}
            {data.metric === "stars" && (
              <section>
                <h3 className="font-semibold">Result</h3>
                <p>{typeof data.value === "number" && data.value ? `${data.value} of 5 stars${data.provisional ? " (provisional: under 3 years of history)" : ""}.` : "Not rated: too little history or too few peers."}</p>
              </section>
            )}
            {g && <section><h3 className="font-semibold">What it is</h3><p>{g.what}</p><p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">{g.read}</p></section>}
            {data.rule && <section><h3 className="font-semibold">How this score is worked out</h3><p>{data.rule}</p></section>}
            {data.parts.length > 0 && (
              <section>
                <h3 className="font-semibold">Why this fund got this value</h3>
                <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Compared with {data.peers} {data.category} funds in the {data.plan} plan.</p>
                <ul className="mt-1 divide-y divide-[#E5E5E5] dark:divide-[#2B3644] border border-[#E5E5E5] dark:border-[#2B3644] rounded">
                  {data.parts.map((p) => <PartRow key={p.key} p={p} />)}
                </ul>
              </section>
            )}
            {data.category_avg != null && <p>Category-plan average: <strong>{n(data.category_avg)}</strong>.</p>}
            {typeof data.value === "string" && <p>{data.value}</p>}
          </>
        )}
        <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
          Computed live from the latest NAV data{data?.nav_date ? ` (NAV as of ${formatISTDate(String(data.nav_date))})` : ""}. Past performance is not a guide to future returns; descriptive data, not investment advice.
        </p>
      </div>
    </div>
  );
}
