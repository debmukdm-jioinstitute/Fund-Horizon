"use client";

// Operations "Updates" tab: what changed lately (new records, forms filled, risk profiling, saved calculations)
// and the SIPs due in the next 30 days. Read-only; every source is an existing endpoint.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getFilings, FILING_STATUSES } from "@/lib/backoffice";
import { fetchActivities, fetchHouseholds, fetchLeads } from "@/lib/crmApi";
import { fetchPage } from "@/lib/crmListApi";
import { fetchSips, type Sip } from "@/lib/crmPhase3Api";

type Kind = "Record" | "Form" | "Risk profile" | "Calculation";
interface Item { id: string; kind: Kind; at: string; title: string; detail: string; href?: string }
interface Due { id: string; date: Date; name: string; scheme: string; amount: number }

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const TONE: Record<Kind, string> = {
  Record: "text-[#175CD3] bg-[#EAF1FE] dark:bg-[#16294D]", Form: "text-[#9A6700] bg-[#FFF6E0] dark:bg-[#332A10]",
  "Risk profile": "text-[#147A3D] bg-[#E7F5EB] dark:bg-[#12301D]", Calculation: "text-[#6941C6] bg-[#F4EBFF] dark:bg-[#2A1B4D]",
};
const DAY = 86400000;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** Next debit date on or after today inside the SIP's start/end window, else null. Day 31 falls back to month end. */
export function nextDebit(s: Pick<Sip, "day" | "start_date" | "end_date">, today = new Date()): Date | null {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let m = 0; m < 2; m++) {
    const last = new Date(t.getFullYear(), t.getMonth() + m + 1, 0).getDate();
    const d = new Date(t.getFullYear(), t.getMonth() + m, Math.min(s.day, last));
    if (d < t || d < new Date(s.start_date)) continue;
    return s.end_date && d > new Date(s.end_date) ? null : d;
  }
  return null;
}

export default function UpdatesFeed() {
  const [items, setItems] = useState<Item[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [filter, setFilter] = useState<Kind | "All">("All");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const bad: string[] = [];
    const safe = <T,>(name: string, p: Promise<T>, empty: T) => p.catch(() => { bad.push(name); return empty; });
    Promise.all([
      safe("leads", fetchLeads(), []), safe("households", fetchHouseholds(), []), safe("forms", getFilings(), []),
      safe("activities", fetchActivities(), []), safe("SIPs", fetchSips({ status: "active" }), []),
      safe("contacts", fetchPage<{ id: string; name: string }>("contacts", { limit: 200, offset: 0 }).then((r) => r.rows), []),
    ]).then(([leads, hhs, filings, acts, sips, contacts]) => {
      if (!live) return;
      const out: Item[] = [
        ...leads.map((l) => ({ id: `l${l.id}`, kind: "Record" as Kind, at: l.created_at, title: `New lead: ${l.name}`, detail: `Source: ${l.source}`, href: "/backoffice/crm" })),
        ...hhs.map((h) => ({ id: `h${h.id}`, kind: "Record" as Kind, at: h.created_at, title: `New household: ${h.name}`, detail: `${h.member_count} member${h.member_count === 1 ? "" : "s"}`, href: `/backoffice/crm/households/${h.id}` })),
        ...filings.map((f) => ({ id: `f${f.id}`, kind: "Form" as Kind, at: f.created_at, title: f.form_title, detail: `${f.client_name ?? "No client"} · ${FILING_STATUSES[f.status] ?? ""}` })),
        ...acts.filter((a) => /^Risk profiling:/.test(a.subject)).map((a) => ({ id: `a${a.id}`, kind: "Risk profile" as Kind, at: a.created_at, title: a.subject, detail: a.body ?? "", href: "/backoffice/crm" })),
        ...acts.filter((a) => /^Calculator:/.test(a.subject)).map((a) => ({ id: `a${a.id}`, kind: "Calculation" as Kind, at: a.created_at, title: a.subject.replace(/^Calculator: /, "Calculation saved: "), detail: a.body?.split("\n")[0] ?? "" })),
      ].sort((x, y) => y.at.localeCompare(x.at));
      const names = new Map(contacts.map((c) => [c.id, c.name]));
      const today = new Date(), horizon = today.getTime() + 30 * DAY;
      const upcoming = sips.flatMap((s) => {
        const d = nextDebit(s, today);
        return d && d.getTime() <= horizon ? [{ id: s.id, date: d, name: names.get(s.contact_id) ?? "Client", scheme: s.scheme_name ?? s.scheme_code, amount: s.amount_paise }] : [];
      }).sort((x, y) => x.date.getTime() - y.date.getTime());
      setItems(out); setDues(upcoming); setFailed(bad); setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const week = useMemo(() => {
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const n = (k: Kind) => items.filter((i) => i.kind === k && i.at >= since).length;
    return [["New records", n("Record")], ["Forms filled", n("Form")], ["Risk profiles done", n("Risk profile")], ["SIPs due (30 days)", dues.length]] as [string, number][];
  }, [items, dues]);
  const shown = (filter === "All" ? items : items.filter((i) => i.kind === filter)).slice(0, 60);
  const monthly = dues.reduce((t, d) => t + d.amount, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {week.map(([label, n], k) => (
          <div key={label} className={`${card} px-4 py-3`}>
            <div className={`text-[12px] font-bold uppercase tracking-wider ${muted}`}>{label}</div>
            <div className="text-2xl font-bold tabular-nums text-[#006F64] dark:text-[#75E1CE]">{loading ? "…" : n}</div>
            <div className={`text-[11.5px] ${muted}`}>{k < 3 ? "last 7 days" : monthly ? inr(monthly) : ""}</div>
          </div>
        ))}
      </div>
      {failed.length > 0 && <p role="alert" className="text-[13px] text-[#B42318] dark:text-[#FF7D86]">Could not load: {failed.join(", ")}. Showing the rest.</p>}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className={`${card} p-4`} aria-labelledby="upd-h">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="upd-h" className={`mr-auto text-[15px] font-bold ${ink}`}>Recent updates</h2>
            {(["All", "Record", "Form", "Risk profile", "Calculation"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${filter === k ? "border-[#006F64] bg-[#E6F2F0] dark:bg-[#0C2B28] text-[#006F64] dark:text-[#75E1CE]" : `border-[#E4E9EF] dark:border-[#2B3644] ${muted}`}`}>{k}</button>
            ))}
          </div>
          {loading ? <p className={`text-[13px] ${muted}`}>Loading…</p> : shown.length === 0 ? <p className={`text-[13px] ${muted}`}>Nothing yet.</p> : (
            <ul className="space-y-1.5">
              {shown.map((i) => (
                <li key={i.id} className="flex items-start gap-2.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-2">
                  <span className={`mt-0.5 flex-none rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${TONE[i.kind]}`}>{i.kind}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[13.5px] font-semibold ${ink}`}>{i.href ? <Link href={i.href} className="hover:underline">{i.title}</Link> : i.title}</div>
                    {i.detail && <div className={`truncate text-[12.5px] ${muted}`}>{i.detail}</div>}
                  </div>
                  <time dateTime={i.at} className={`flex-none text-[12px] tabular-nums ${muted}`}>{when(i.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${card} p-4 lg:self-start`} aria-labelledby="sip-h">
          <h2 id="sip-h" className={`mb-3 text-[15px] font-bold ${ink}`}>Upcoming SIPs · next 30 days</h2>
          {loading ? <p className={`text-[13px] ${muted}`}>Loading…</p> : dues.length === 0 ? <p className={`text-[13px] ${muted}`}>No SIPs due.</p> : (
            <ul className="space-y-1.5">
              {dues.slice(0, 40).map((d) => (
                <li key={d.id} className="flex items-center gap-2.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-2">
                  <div className="w-12 flex-none rounded-md bg-[#E6F2F0] dark:bg-[#0C2B28] py-1 text-center text-[#006F64] dark:text-[#75E1CE]">
                    <div className="text-[15px] font-bold leading-none">{d.date.getDate()}</div>
                    <div className="text-[10.5px] font-bold uppercase">{d.date.toLocaleString("en-GB", { month: "short" })}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[13.5px] font-semibold ${ink}`}>{d.name}</div>
                    <div className={`truncate text-[12px] ${muted}`}>{d.scheme}</div>
                  </div>
                  <div className={`flex-none text-[13px] font-bold tabular-nums ${ink}`}>{inr(d.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
