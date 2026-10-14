// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { stageLabel } from "../../lib/crmProductsApi";
import { fetchReportsDashboard, linkHref, type Dashboard, type WidgetLink } from "../../lib/crmReportsApi";
import { shortInr } from "../../lib/format";
import { useTheme } from "../terminal/ThemeContext";
import { cardCls, errCls, headCls, mutedCls, rupees } from "./ui";

const TIER_LABEL: Record<string, string> = { platinum: "Platinum", gold: "Gold", silver: "Silver", standard: "Standard" };
const GAP_LABEL: Record<string, string> = { nominee: "No nominee", kyc: "KYC missing", kyc_expired: "KYC expired", fatca_crs: "FATCA/CRS" };

/** A number that opens the list it counts. */
function Kpi({ label, value, hint, link, tone }: { label: string; value: string; hint?: string; link: WidgetLink; tone?: "warn" }) {
  return (
    <Link
      href={linkHref(link)}
      className={`${cardCls} block hover:border-[#006F64] dark:hover:border-[#75E1CE] transition focus:outline-none focus:ring-2 focus:ring-[#006F64]`}
    >
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${mutedCls}`}>{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "warn" ? "text-amber-700 dark:text-amber-300" : "text-[#172033] dark:text-[#EDF2F7]"}`}>{value}</div>
      {hint && <div className={`mt-1 text-xs ${mutedCls}`}>{hint}</div>}
    </Link>
  );
}

interface Datum {
  name: string;
  value: number;
  count: number;
  link: WidgetLink | null;
}

/** Horizontal bars; clicking one opens its filtered list. */
function BarCard({ title, sub, data, money = true, colors }: { title: string; sub: string; data: Datum[]; money?: boolean; colors: { bar: string; grid: string; text: string; tip: string } }) {
  const router = useRouter();
  const empty = data.every((d) => d.value === 0 && d.count === 0);
  return (
    <section className={cardCls} aria-label={title}>
      <h3 className={headCls}>{title}</h3>
      <p className={`mb-2 text-xs ${mutedCls}`}>{sub}</p>
      {empty ? (
        <p className={`py-8 text-center text-xs ${mutedCls}`}>No data yet.</p>
      ) : (
        <div style={{ height: Math.max(160, data.length * 32 + 24) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid horizontal={false} stroke={colors.grid} />
              <XAxis type="number" tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} tickFormatter={(v: number) => (money ? shortInr(v / 100) : String(v))} />
              <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} />
              <Tooltip
                cursor={{ fill: colors.grid, opacity: 0.4 }}
                contentStyle={{ background: colors.tip, border: `1px solid ${colors.grid}`, borderRadius: 8, fontSize: 12, color: colors.text }}
                formatter={(v: number, _n, item) => [money ? `${rupees(v)} · ${(item.payload as Datum).count}` : String(v), ""]}
                separator=""
              />
              <Bar dataKey="value" isAnimationActive={false} radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => { const l = (d as unknown as Datum).link; if (l) router.push(linkHref(l)); }}>
                {data.map((d) => <Cell key={d.name} fill={colors.bar} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {/* Keyboard- and screen-reader-friendly mirror of the chart */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {data.filter((d) => d.link).map((d) => (
          <li key={d.name} className="text-xs">
            <Link href={linkHref(d.link!)} className="text-[#006F64] dark:text-[#75E1CE] hover:underline">{d.name}</Link>
            <span className={mutedCls}> · {d.count}{money ? ` · ${shortInr(d.value / 100)}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CrmHome() {
  const { theme } = useTheme();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReportsDashboard().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Could not load the dashboard"));
  }, []);

  if (error) return <p role="alert" className={errCls}>{error}</p>;
  if (!data) return <div aria-busy="true" className={`p-12 text-center text-xs ${mutedCls}`}>Loading the CRM overview…</div>;

  const dark = theme === "dark";
  const colors = dark
    ? { bar: "#75E1CE", grid: "#2B3644", text: "#A8B4C4", tip: "#171E27" }
    : { bar: "#006F64", grid: "#E4E9EF", text: "#536176", tip: "#FFFFFF" };

  const tiers: Datum[] = data.aum_by_tier.map((t) => ({ name: `${TIER_LABEL[t.tier] ?? t.tier} (${t.households})`, value: t.aum_paise, count: t.households, link: t.link }));
  const stages: Datum[] = data.pipeline_by_stage.filter((s) => s.count > 0).map((s) => ({ name: stageLabel(s.stage), value: s.value, count: s.count, link: s.link }));
  const rms: Datum[] = data.pipeline_by_rm.map((r) => ({ name: r.rm_name || "Unassigned", value: r.value, count: r.count, link: r.link }));
  const gapSummary = Object.entries(data.gaps.by_kind).map(([k, n]) => `${GAP_LABEL[k] ?? k} ${n}`).join(" · ");

  return (
    <div className="space-y-4">
      <div>
        <h2 className={headCls}>CRM overview</h2>
        <p className={`text-xs ${mutedCls}`}>Your book as of {data.as_of}. Every number opens the list it counts.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="SIP book" value={rupees(data.sip_book.monthly_paise)} hint={`${data.sip_book.count} active SIPs / month`} link={data.sip_book.link} />
        <Kpi label="Won this month" value={String(data.won_this_month.count)} hint={rupees(data.won_this_month.value)} link={data.won_this_month.link} />
        <Kpi label="Overdue tasks" value={String(data.overdue_tasks.count)} hint="Open, due before today" link={data.overdue_tasks.link} tone={data.overdue_tasks.count ? "warn" : undefined} />
        <Kpi label="Cases past SLA" value={String(data.sla_breaching.count)} hint="Open, SLA date passed" link={data.sla_breaching.link} tone={data.sla_breaching.count ? "warn" : undefined} />
        <Kpi label="KYC / nominee gaps" value={String(data.gaps.count)} hint={gapSummary || "No gaps"} link={data.gaps.link} tone={data.gaps.count ? "warn" : undefined} />
        <Kpi label="Policy renewals" value={String(data.renewals.count)} hint={`Next ${data.renewals.days} days`} link={data.renewals.link} />
        <Kpi label="FD maturities" value={String(data.maturities.count)} hint={`Next ${data.maturities.days} days`} link={data.maturities.link} />
        <Kpi label="Open pipeline" value={shortInr(data.pipeline_open.value / 100)} hint={`${data.pipeline_open.count} opportunities`} link={{ tab: "opportunities", params: { open: "true" } }} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <BarCard title="AUM by household tier" sub={`Total ${rupees(data.aum_total_paise)}. Platinum ≥ ₹1 Cr, Gold ≥ ₹25 L, Silver ≥ ₹5 L.`} data={tiers} colors={colors} />
        <BarCard title="Pipeline by stage" sub="Open opportunities only; stages with none are hidden, won and lost are excluded." data={stages} colors={colors} />
        <BarCard title="Pipeline by RM" sub="Open opportunity value per owner." data={rms} colors={colors} />
        <section className={cardCls} aria-label="Top trail earners">
          <div className="flex items-baseline justify-between">
            <h3 className={headCls}>Top trail earners</h3>
            <Link href={linkHref(data.top_trail.link)} className="text-xs text-[#006F64] dark:text-[#75E1CE] hover:underline">Trail report</Link>
          </div>
          <p className={`mb-2 text-xs ${mutedCls}`}>{data.top_trail.month ? `Households by brokerage in ${data.top_trail.month}.` : "Upload a brokerage file in Book → Trail commission."}</p>
          <ol className="space-y-1.5">
            {data.top_trail.rows.map((r, i) => (
              <li key={r.household_id} className="flex items-center justify-between text-xs">
                <Link href={`/backoffice/crm/households/${r.household_id}`} className="text-[#172033] dark:text-[#EDF2F7] hover:underline">
                  <span className={`mr-2 tabular-nums ${mutedCls}`}>{i + 1}.</span>{r.household_name ?? "Household"}
                </Link>
                <span className="font-semibold tabular-nums text-[#172033] dark:text-[#EDF2F7]">{rupees(r.amount_paise)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
