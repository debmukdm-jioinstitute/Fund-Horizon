"use client";

import React from "react";
import type { MfScreenerRow } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

type Row = MfScreenerRow & Record<string, unknown>;
interface Explain { what: string; how: string; read: string; inputs?: [string, string][] }

const n = (v: unknown, d = 2, suffix = "") => (typeof v === "number" && Number.isFinite(v) ? `${v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}${suffix}` : "not available");
const PERIOD = (k: string) => {
  const m = k.match(/_(\d+)([ym])$/);
  return m ? `${m[1]} ${m[2] === "y" ? "year" : "month"}${m[1] === "1" ? "" : "s"}` : k.endsWith("_si") ? "since launch" : k.endsWith("_all") ? "the fund's whole life" : "";
};

/** Layman glossary keyed by the metric's base name (period suffix stripped). */
const GLOSSARY: Record<string, Omit<Explain, "inputs">> = {
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

function pillar(key: string, r: Row): Explain {
  const pts = r[key] as number | undefined;
  const common = "Each pillar is out of 25. It is built from percentile ranks (0 to 1) against funds in the same category and plan, so 25 would be best in the peer group and 12 about average.";
  const defs: Record<string, Explain> = {
    perf: { what: "How well the fund's returns compare with its peers.", how: `Average of the fund's peer rank on 1-year, 3-year and 5-year returns, × 25. ${common}`, read: "19+ is Good Returns, 12–18 Average, below 12 Poor.", inputs: [["1Y return", n(r.ret_1y, 2, "%")], ["3Y CAGR", n(r.cagr_3y, 2, "%")], ["5Y CAGR", n(r.cagr_5y, 2, "%")], ["3Y category avg", n(r.cagr_3y_cat, 2, "%")]] },
    risk: { what: "Whether the fund paid you well for the risk it took.", how: `Average of the peer rank on 3-year Sharpe, Sortino, max drawdown and volatility (lower volatility ranks better), × 25. ${common}`, read: "19+ is Good Risk Reward, 12–18 Fair, below 12 Poor.", inputs: [["Sharpe 3Y", n(r.sharpe_3y)], ["Sortino 3Y", n(r.sortino_3y)], ["Max drawdown 3Y", n(r.max_dd_3y, 2, "%")], ["Volatility 3Y", n(r.vol_3y, 2, "%")]] },
    port: { what: "Size and skill signals for the fund's portfolio.", how: `We have no stock-level holdings data yet, so this is the average of the peer rank on fund size (AUM) and 3-year alpha, × 25. ${common}`, read: "19+ is High Rank, 12–18 Medium, below 12 Weak.", inputs: [["AUM", n(r.aum_cr, 0, " cr")], ["Alpha 3Y", n(r.alpha_3y, 2, "%")]] },
    ops: { what: "How cheaply and how maturely the fund is run.", how: `60% weight on cost (lower expense ratio ranks better; unknown cost is treated as average) and 40% on track record (age capped at 5 years), × 25. ${common}`, read: "19+ is High Rank, 12–18 Medium, below 12 Weak.", inputs: [["Expense ratio", n(r.ter, 2, "%")], ["Fund age", n(r.history_years, 1, " yrs")]] },
  };
  if (key !== "score") return { ...defs[key], inputs: [["Points", typeof pts === "number" ? `${pts} / 25` : "not available"], ...(defs[key].inputs ?? [])] };
  return {
    what: "Our overall 0 to 100 quality score for the fund.",
    how: "Performance + Portfolio + Operations + Risk vs Reward (25 each). If one pillar is missing, for example a young fund with no alpha, the rest are scaled up to 100. A score needs at least 3 pillars.",
    read: "Relative, not absolute: it ranks the fund among its own category and plan peers. It is a screening aid, not advice.",
    inputs: [["Performance", `${n(r.perf, 0)} / 25`], ["Portfolio", `${n(r.port, 0)} / 25`], ["Operations", `${n(r.ops, 0)} / 25`], ["Risk vs Reward", `${n(r.risk, 0)} / 25`]],
  };
}

function build(key: string, r: Row): Explain {
  if (["score", "perf", "port", "ops", "risk"].includes(key)) return pillar(key, r);
  if (key === "stars") {
    return {
      what: "Our own 1 to 5 star rating of risk-adjusted returns. It is not Morningstar's.",
      how: "Weighted Sharpe ratio (3Y 20%, 5Y 30%, 10Y 50%) ranked within category and plan: top 10% get 5 stars, next 25% get 4, middle 35% get 3, next 22.5% get 2, rest 1. Funds under 3 years old get a provisional rating from 1Y Sharpe (marked P). Needs 3+ peers; stale or flat-NAV funds stay unrated.",
      read: r.stars_provisional ? "This rating is provisional because the fund has under 3 years of history." : "More stars means better return per unit of risk versus peers.",
      inputs: [["Stars", typeof r.stars === "number" && r.stars ? `${r.stars} of 5` : "Not rated"], ["Sharpe 3Y", n(r.sharpe_3y)], ["Sharpe 5Y", n(r.sharpe_5y)], ["Sharpe 10Y", n(r.sharpe_10y)]],
    };
  }
  const g = GLOSSARY[baseKey(key)] ?? { what: "Metric computed from the fund's NAV history.", how: "See the column heading.", read: "Compare with peers in the same category." };
  const avg = r[`${key}_cat`];
  return { ...g, inputs: [["This fund", key === "cat_label" ? String(r.cat_label ?? "-") : n(r[key])], ...(typeof avg === "number" ? [["Category average", n(avg)] as [string, string]] : [])] };
}

export default function MfMetricExplain({ metric, row, onClose }: { metric: { key: string; label: string } | null; row: MfScreenerRow | null; onClose: () => void }) {
  if (!metric || !row) return null;
  const r = row as Row;
  const e = build(metric.key, r);
  const period = PERIOD(metric.key);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={`${metric.label} explained`} onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-[#10161D] border border-[#E5E5E5] dark:border-[#2B3644] p-4 space-y-3 text-[13px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">{metric.label}{period && ` (${period})`}</h2>
            <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{row.name} · {row.plan} · {String(r.cat_label ?? row.cat)}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="terminal-btn text-[12px] py-0.5 px-2">✕</button>
        </div>
        {([["What it is", e.what], ["How it is worked out", e.how], ["How to read it", e.read]] as const).map(([h, t]) => (
          <section key={h}><h3 className="font-semibold">{h}</h3><p>{t}</p></section>
        ))}
        {e.inputs && (
          <section>
            <h3 className="font-semibold">Why this fund got this value</h3>
            <dl className="mt-1 divide-y divide-[#E5E5E5] dark:divide-[#2B3644] border border-[#E5E5E5] dark:border-[#2B3644] rounded">
              {e.inputs.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-2 py-1"><dt className="text-[#706E6B] dark:text-[#A8B4C4]">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </section>
        )}
        <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
          Data as of NAV date {row.nav_date ? formatISTDate(String(row.nav_date)) : "not recorded"}. Compared only with {String(r.cat_label ?? row.cat)} funds in the {row.plan} plan. Past performance is not a guide to future returns; descriptive data, not investment advice.
        </p>
      </div>
    </div>
  );
}
