"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CALCULATORS } from "@/lib/calculators";
import EmailDialog, { type Recipient } from "@/components/crm/EmailDialog";
import UpdatesFeed from "@/components/operations/UpdatesFeed";
import ClientReport from "@/components/operations/ClientReport";
import PdfFormFiller, { type ClientDetails, type FillContext, type PdfSource } from "@/components/operations/PdfFormFiller";
import { FILING_STATUSES, type Filing, getFilings, getOfficialForms, setFilingStatus } from "@/lib/backoffice";
import { fetchHouseholdDetail, fetchHouseholds, type Household, type HouseholdDetail } from "@/lib/crmApi";
import { getKyc } from "@/lib/crmProductsApi";
import type { OfficialForm } from "@/lib/officialForms";
import { startDownload, type DownloadResult } from "@/lib/api";
import { domain, isReference, JOBS, type Job, jobForms } from "@/lib/operations";

type Tab = "updates" | "tasks" | "library" | "register" | "report";
interface Filling { source: PdfSource; prefill?: Partial<ClientDetails>; context?: FillContext }
interface Filters { q: string; sources: Set<string>; amc: string; cat: string; amcQ: string }

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const soft = "bg-[#F8FAFB] dark:bg-[#1B2432]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const teal = "text-[#006F64] dark:text-[#75E1CE]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#006F64] hover:text-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D]";
const STATUS_TONE = ["text-[#175CD3] bg-[#EAF1FE] dark:bg-[#16294D]", "text-[#9A6700] bg-[#FFF6E0] dark:bg-[#332A10]", "text-[#147A3D] bg-[#E7F5EB] dark:bg-[#12301D]"];
const FALLBACK_QUICK = ["Bank mandate & payments", "Nomination", "KYC & compliance", "Transactions", "Contact & folio updates"];

const ampKey = (f: OfficialForm) => (f.source === "AMC" ? f.amc ?? "Other" : f.source === "CAMS" ? "Common (CAMS)" : f.source === "KFintech" ? "Common (KFintech)" : "Stallion");
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const emptyFilters = (): Filters => ({ q: "", sources: new Set(["CAMS", "KFintech", "AMC", "Stallion"]), amc: "All", cat: "All", amcQ: "" });

function FormFilling() {
  const [forms, setForms] = useState<OfficialForm[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("updates");
  const [filling, setFilling] = useState<Filling | null>(null);
  const [filings, setFilings] = useState<Filing[]>([]);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clientSelect = useRef<HTMLSelectElement>(null);

  // client / household context
  const [households, setHouseholds] = useState<Household[]>([]);
  const [hhId, setHhId] = useState("");
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [pan4, setPan4] = useState<string | null>(null);
  const [folio, setFolio] = useState("");

  const say = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  const loadFilings = useCallback(() => getFilings().then((r) => { setFilings(r); setRegisterError(null); }).catch(() => setRegisterError("Could not load the filings register.")), []);

  useEffect(() => { getOfficialForms().then(setForms).catch(() => setLoadError(true)); loadFilings(); fetchHouseholds().then(setHouseholds).catch(() => undefined); }, [loadFilings]);
  useEffect(() => {
    let live = true;
    setDetail(null); setPan4(null);
    if (!hhId) return;
    fetchHouseholdDetail(hhId).then((d) => {
      if (!live) return;
      setDetail(d);
      const m = d.members.find((x) => x.role === "primary") ?? d.members[0];
      if (m) getKyc(m.customer_id).then((k) => live && setPan4(k.pan_last4 ?? null)).catch(() => undefined);
    }).catch(() => live && say("Could not load that household."));
    return () => { live = false; };
  }, [hhId, say]);

  const member = detail ? detail.members.find((x) => x.role === "primary") ?? detail.members[0] : undefined;
  const hhName = detail?.household.name;
  const short = hhName ? hhName.split(" ")[0] : "";
  const fillLabel = hhName ? `Fill & Sign — pre-filled for ${short}` : "Fill & Sign";
  const startFill = (source: PdfSource) =>
    setFilling({
      source,
      prefill: member ? { name: member.name, mobile: member.mobile ?? "", email: member.email ?? "", folio } : folio ? { folio } : undefined,
      context: hhId ? { householdId: hhId, householdName: hhName } : undefined,
    });
  const fillForm = (f: OfficialForm) => startFill({ kind: "url", url: f.url, title: f.title });

  const openCount = filings.filter((f) => f.status < 2).length;
  const mfForms = useMemo(() => forms.filter((f) => !isReference(f)), [forms]);

  const openLibrary = (cat: string) => { setFilters({ ...emptyFilters(), cat }); setTab("library"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div className="space-y-5 pb-12">
      {/* header + client bar + tabs */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-5 pt-4">
          <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>Operations</h1>
          <p className={`mt-1 max-w-xl text-[14px] ${muted}`}>Start from the client and the job — the right form, pre-filled, in two clicks.</p>
        </div>
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-t-xl border border-b-0 border-[#E4E9EF] dark:border-[#2B3644] bg-[#E6F2F0] dark:bg-[#0C2B28] px-3.5 py-3">
          <label htmlFor="clientSel" className={`text-[12px] font-bold uppercase tracking-wider ${teal}`}>Client / Household</label>
          <select
            id="clientSel" ref={clientSelect} value={hhId} onChange={(e) => { setHhId(e.target.value); say(e.target.value ? "Client selected — forms pre-fill automatically." : "Client cleared — forms will open blank."); }}
            className="min-w-[220px] flex-1 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-2 text-[14px] font-semibold text-[#172033] dark:text-[#EDF1F6]"
          >
            <option value="">No client selected — browse forms only</option>
            {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <div className={`text-[13.5px] ${ink}`}>
            {hhName ? (
              <>Filling for: <b>{hhName}</b>{member ? <> · {member.name}</> : null}{pan4 ? <> · PAN ••••{pan4}</> : null}</>
            ) : "No client selected — forms open blank. Pick a household to pre-fill name, mobile & email."}
          </div>
          <input
            value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Folio no. (optional)" aria-label="Folio number"
            className="w-40 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-2 text-[13px]"
          />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#006F64] bg-white dark:bg-[#171E2A] px-3.5 py-2 text-[13.5px] font-bold text-[#006F64] dark:text-[#75E1CE] hover:bg-[#E6F2F0] dark:hover:bg-[#0C2B28]">
            ⬆ Upload your own PDF — Fill &amp; Sign
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) startFill({ kind: "file", file, title: file.name.replace(/\.pdf$/i, "") }); }} />
          </label>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto border-t border-[#E4E9EF] dark:border-[#2B3644]" role="tablist" aria-label="Operations sections">
          {([["updates", "Updates", null], ["tasks", "Start a task", null], ["library", "Forms library", forms.length || null], ["register", "Filings register", openCount ? `${openCount} open` : null], ["report", "Client report", null]] as [Tab, string, string | number | null][]).map(([t, label, cnt]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`whitespace-nowrap border-b-[3px] px-4 py-3 text-[14.5px] font-semibold ${tab === t ? "border-[#006F64] text-[#006F64] dark:text-[#75E1CE]" : `border-transparent ${muted}`}`}>
              {label}{cnt !== null && <span className={`ml-1.5 rounded-full border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-px text-[11.5px] ${soft}`}>{cnt}</span>}
            </button>
          ))}
        </nav>
      </div>

      {loadError && <p className="text-[13px] text-[#B42318] dark:text-[#FF7D86]">Could not load the forms catalogue.</p>}

      {tab === "updates" && <UpdatesFeed />}
      {tab === "report" && <ClientReport customerId={member?.customer_id} customerName={hhName} />}
      {tab === "tasks" && (
        <TasksTab forms={mfForms} filings={filings} jobId={jobId} setJobId={setJobId} hhName={hhName} member={member} pan4={pan4} fillLabel={fillLabel}
          fillForm={fillForm} changeClient={() => { clientSelect.current?.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }} openLibrary={openLibrary} />
      )}
      {tab === "library" && <LibraryTab forms={forms} filters={filters} setFilters={setFilters} fillLabel={fillLabel} fillForm={fillForm} />}
      {tab === "register" && (
        <RegisterTab filings={filings} error={registerError} onMove={async (f) => {
          try { await setFilingStatus(f.id, Math.min(f.status + 1, 2)); say(`“${f.form_title}” → ${FILING_STATUSES[Math.min(f.status + 1, 2)]}. Logged to the client's CRM activity.`); await loadFilings(); } catch (e) { say(e instanceof Error ? e.message : "Could not update the status."); }
        }} />
      )}

      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[99] max-w-[92vw] -translate-x-1/2 rounded-lg bg-[#172033] px-4 py-2.5 text-center text-[14px] font-semibold text-white shadow-lg">{toast}</div>}

      {filling && (
        <PdfFormFiller
          source={filling.source} prefill={filling.prefill} context={filling.context} onClose={() => setFilling(null)}
          onDownloaded={(title, client) => { say(`Saved “${title}” for ${client} to the Filings register.`); loadFilings(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ rows */
function FormRow({ f, pick, label, onFill }: { f: OfficialForm; pick?: boolean; label: string; onFill: (f: OfficialForm) => void }) {
  return (
    <div className={`mb-2 flex flex-wrap items-start gap-3 rounded-[9px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3.5 py-3`}>
      <div className="min-w-[220px] flex-1 basis-[300px]">
        <h4 className={`text-[14.5px] font-semibold leading-snug ${ink}`}>
          <span className={`mr-1.5 inline-block rounded-full border px-2 py-0.5 align-[2px] text-[11px] font-extrabold uppercase tracking-wide ${f.source === "CAMS" ? "border-[#006F64] text-[#006F64] dark:text-[#75E1CE]" : `border-[#E4E9EF] dark:border-[#2B3644] ${muted}`} ${soft}`}>{f.amc ?? f.source}</span>
          {pick && <span className="mr-1.5 inline-block rounded-full bg-[#006F64] px-2 py-0.5 align-[2px] text-[11px] font-extrabold uppercase tracking-wide text-white">Marked pick</span>}
          {f.title}
        </h4>
        <div className={`text-[12.5px] ${muted}`}>{f.kind === "PDF" ? "PDF" : "Web page"} · {f.category} · {domain(f.url)}</div>
      </div>
      <div className="flex flex-none flex-wrap gap-2">
        {f.kind === "PDF" && <button type="button" className={btnPrimary} onClick={() => onFill(f)}>{label}</button>}
        <a href={f.url} target="_blank" rel="noopener noreferrer" className={btn}>{f.kind === "PDF" ? "Original" : "Open page"}</a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tab 1 */
function TasksTab({ forms, filings, jobId, setJobId, hhName, member, pan4, fillLabel, fillForm, changeClient, openLibrary }: {
  forms: OfficialForm[]; filings: Filing[]; jobId: string | null; setJobId: (id: string) => void; hhName?: string;
  member?: { name: string }; pan4: string | null; fillLabel: string; fillForm: (f: OfficialForm) => void; changeClient: () => void; openLibrary: (cat: string) => void;
}) {
  const byTitle = useMemo(() => new Map(forms.map((f) => [f.title, f])), [forms]);
  const quick = useMemo(() => {
    const n = new Map<string, number>();
    filings.forEach((f) => n.set(f.form_title, (n.get(f.form_title) ?? 0) + 1));
    const top = Array.from(n.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => byTitle.get(t)).filter((f): f is OfficialForm => !!f && f.kind === "PDF");
    const fallback = FALLBACK_QUICK.map((c) => forms.find((f) => f.source === "CAMS" && f.kind === "PDF" && f.category === c)).filter((f): f is OfficialForm => !!f);
    return [...top, ...fallback.filter((f) => !top.includes(f))].slice(0, 5);
  }, [filings, byTitle, forms]);
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return filings.filter((f) => (seen.has(f.form_title) ? false : (seen.add(f.form_title), true))).slice(0, 3);
  }, [filings]);
  const job: Job | undefined = JOBS.find((j) => j.id === jobId);
  const jf = job ? jobForms(job, forms) : [];

  return (
    <section className="space-y-6">
      <div className="grid gap-3.5 md:grid-cols-[1.4fr_1fr]">
        <div className={`${card} p-4`}>
          <h3 className={`mb-2.5 text-[13px] font-bold uppercase tracking-wider ${muted}`}>★ Most used by your team</h3>
          <ul className="grid gap-1.5">
            {quick.map((f) => (
              <li key={f.url} className={`flex items-center gap-2.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] ${soft} px-2.5 py-1.5 text-[14px]`}>
                <span className="min-w-0 flex-1"><b className={`block font-semibold leading-snug ${ink}`}>{f.title}</b><span className={`text-[12px] ${muted}`}>{f.source} · {f.category}</span></span>
                <button type="button" className={btn} onClick={() => fillForm(f)}>Fill &amp; Sign</button>
              </li>
            ))}
            {quick.length === 0 && <li className={`text-[13px] ${muted}`}>Loading forms…</li>}
          </ul>
        </div>
        <div className={`${card} p-4`}>
          <h3 className={`mb-2.5 text-[13px] font-bold uppercase tracking-wider ${muted}`}>Recently used</h3>
          <ul className="grid gap-1.5">
            {recent.map((r) => {
              const f = r.form_url ? forms.find((x) => x.url === r.form_url) ?? byTitle.get(r.form_title) : byTitle.get(r.form_title);
              return (
                <li key={r.id} className={`flex items-center gap-2.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] ${soft} px-2.5 py-1.5 text-[14px]`}>
                  <span className="min-w-0 flex-1"><b className={`block font-semibold leading-snug ${ink}`}>{r.form_title}</b><span className={`text-[12px] ${muted}`}>{r.client_name ?? "No client"} · {fmtDate(r.created_at)}</span></span>
                  {f && <button type="button" className={btn} onClick={() => fillForm(f)}>Fill &amp; Sign</button>}
                </li>
              );
            })}
            {recent.length === 0 && <li className={`text-[13px] ${muted}`}>Nothing filed yet. Filings you complete appear here and in the register.</li>}
          </ul>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
          <h2 className={`text-[19px] font-bold tracking-tight ${ink}`}>What are you doing today?</h2>
          <p className={`text-[13.5px] ${muted}`}>Pick a job — we show the forms it needs, the RTA common form first.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-4">
          {JOBS.map((j) => (
            <button key={j.id} type="button" onClick={() => setJobId(j.id)}
              className={`flex flex-col gap-1.5 rounded-[10px] border bg-white dark:bg-[#171E2A] p-4 text-left hover:border-[#006F64] ${jobId === j.id ? "border-[#006F64] ring-2 ring-[#E6F2F0] dark:ring-[#0C2B28]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
              <span className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-[#E6F2F0] dark:bg-[#0C2B28] text-[#006F64] dark:text-[#75E1CE]">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={j.icon} /></svg>
              </span>
              <h3 className={`text-[15.5px] font-bold leading-tight ${ink}`}>{j.title}</h3>
              <p className={`flex-1 text-[13px] ${muted}`}>{j.desc}</p>
              <span className={`text-[12px] font-bold ${teal}`}>{forms.filter(j.match).length} forms →</span>
            </button>
          ))}
        </div>
      </div>

      {job && (
        <div className={`${card} p-5`} aria-live="polite">
          <h2 className={`text-lg font-bold ${ink}`}>{job.title}</h2>
          <ol className="my-4 flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
            <li className={teal}>✓ 1 · Client</li><li className={muted}>—</li><li className={teal}>✓ 2 · RTA / AMC</li><li className={muted}>—</li><li className={ink}>3 · Forms</li>
          </ol>
          <div className={`mb-3.5 grid gap-2 text-[14px] ${ink}`}>
            <div><b>Step 1 — Client:</b> {hhName ? `${hhName}${member ? ` — ${member.name}` : ""}${pan4 ? ` · PAN ••••${pan4}` : ""}` : "No client selected — pick a household in the bar above to pre-fill."} <button type="button" className={`ml-1 text-[12.5px] font-semibold ${teal} hover:underline`} onClick={changeClient}>Change</button></div>
            <div><b>Step 2 — RTA / AMC:</b> CAMS and KFintech common forms lead; fund-house forms follow only where an AMC insists on its own.</div>
          </div>
          {jf.length > 0 && <div className="mb-3 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#E6F2F0] dark:bg-[#0C2B28] px-3.5 py-2.5 text-[13.5px]">★ <b className={teal}>Marked pick:</b> {job.pick}</div>}
          <b className={`text-[14px] ${ink}`}>Step 3 — Forms for this job</b>
          <div className="mt-2.5">
            {jf.slice(0, 4).map((f, i) => <FormRow key={f.url} f={f} pick={i === 0 && job.id !== "dist"} label={fillLabel} onFill={fillForm} />)}
            {jf.length === 0 && <p className={`text-[13px] ${muted}`}>No fillable forms in the catalogue for this job.</p>}
          </div>
          {jf.length > 4 && job.id !== "pms" && (
            <button type="button" className={`${btn} mt-1`} onClick={() => openLibrary(job.id === "sip" ? "SIP / STP / SWP" : jf[0].category)}>See all {jf.length} forms in the library →</button>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ tab 2 */
function LibraryTab({ forms, filters, setFilters, fillLabel, fillForm }: {
  forms: OfficialForm[]; filters: Filters; setFilters: (f: Filters) => void; fillLabel: string; fillForm: (f: OfficialForm) => void;
}) {
  const f = filters;
  const set = (p: Partial<Filters>) => setFilters({ ...f, ...p });
  const counts = useMemo(() => {
    const src: Record<string, number> = {}, amc: Record<string, number> = {}, cat: Record<string, number> = {};
    forms.forEach((x) => { src[x.source] = (src[x.source] ?? 0) + 1; amc[ampKey(x)] = (amc[ampKey(x)] ?? 0) + 1; cat[x.category] = (cat[x.category] ?? 0) + 1; });
    return { src, amc, cat };
  }, [forms]);
  const match = useCallback((x: OfficialForm) => {
    if (!f.sources.has(x.source)) return false;
    if (f.amc !== "All" && ampKey(x) !== f.amc) return false;
    if (f.cat !== "All" && x.category !== f.cat) return false;
    const hay = `${x.title} ${x.source} ${x.amc ?? ""} ${x.category} ${x.keywords} ${x.source === "KFintech" ? "karvy" : ""}`.toLowerCase();
    return f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }, [f]);
  const shown = useMemo(() => forms.filter(match), [forms, match]);
  const main = shown.filter((x) => !isReference(x)), ref = shown.filter(isReference);
  const filtering = !!f.q || f.amc !== "All" || f.cat !== "All" || f.sources.size < 4;
  const amcList = Object.entries(counts.amc).filter(([k]) => k.toLowerCase().includes(f.amcQ.toLowerCase())).sort((a, b) => b[1] - a[1]);
  const cats = Object.entries(counts.cat).sort(([a], [b]) => a.localeCompare(b));

  const groups = (list: OfficialForm[]) => {
    const g = new Map<string, OfficialForm[]>();
    list.forEach((x) => g.set(x.category, [...(g.get(x.category) ?? []), x]));
    return Array.from(g.entries()).map(([cat, items]) => (
      <details key={cat} open={filtering} className="mb-2.5 overflow-hidden rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]">
        <summary className={`flex cursor-pointer list-none items-center gap-2.5 px-4 py-3.5 text-[15px] font-bold ${ink}`}>
          <span className={teal}>▸</span> {cat} <span className={`ml-auto text-[12.5px] font-semibold ${muted}`}>{items.length} form{items.length > 1 ? "s" : ""}</span>
        </summary>
        <div className="px-3 pb-2.5">{items.map((x) => <FormRow key={x.url} f={x} label={fillLabel} onFill={fillForm} />)}</div>
      </details>
    ));
  };
  const fitem = (on: boolean) => `flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[14px] ${on ? "bg-[#E6F2F0] dark:bg-[#0C2B28] font-bold text-[#006F64] dark:text-[#75E1CE]" : `${ink} hover:bg-[#F8FAFB] dark:hover:bg-[#1B2432]`}`;
  const input = "w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-2 text-[14px]";
  const h3 = `mb-2 mt-4 text-[12.5px] font-bold uppercase tracking-wider ${muted}`;

  return (
    <section className="grid items-start gap-4 lg:grid-cols-[264px_1fr]">
      <aside className={`${card} p-4 lg:sticky lg:top-4`} aria-label="Library filters">
        <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={`Search ${forms.length} forms…`} aria-label="Search forms" className={input} />
        <h3 className={h3}>Source</h3>
        {["CAMS", "KFintech", "AMC", "Stallion"].map((s) => (
          <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[14px] hover:bg-[#F8FAFB] dark:hover:bg-[#1B2432]">
            <input type="checkbox" className="h-4 w-4 accent-[#006F64]" checked={f.sources.has(s)} onChange={(e) => { const n = new Set(f.sources); if (e.target.checked) n.add(s); else n.delete(s); set({ sources: n }); }} />
            <span className={ink}>{s}</span><span className={`ml-auto text-[12px] ${muted}`}>{counts.src[s] ?? 0}</span>
          </label>
        ))}
        <h3 className={h3}>AMC / Fund house</h3>
        <input type="search" value={f.amcQ} onChange={(e) => set({ amcQ: e.target.value })} placeholder="Search AMCs…" aria-label="Search AMCs" className={`${input} mb-1.5`} />
        <div className="max-h-64 overflow-y-auto">
          <button type="button" className={fitem(f.amc === "All")} onClick={() => set({ amc: "All" })}>All AMCs<span className={`ml-auto text-[12px] font-normal ${muted}`}>{forms.length}</span></button>
          {amcList.map(([k, n]) => <button key={k} type="button" className={fitem(f.amc === k)} onClick={() => set({ amc: k })}>{k}<span className={`ml-auto text-[12px] font-normal ${muted}`}>{n}</span></button>)}
        </div>
        <h3 className={h3}>Category</h3>
        <button type="button" className={fitem(f.cat === "All")} onClick={() => set({ cat: "All" })}>All categories<span className={`ml-auto text-[12px] font-normal ${muted}`}>{forms.length}</span></button>
        {cats.map(([k, n]) => <button key={k} type="button" className={fitem(f.cat === k)} onClick={() => set({ cat: k })}>{k}<span className={`ml-auto text-[12px] font-normal ${muted}`}>{n}</span></button>)}
        <button type="button" className={`${btn} mt-4 w-full justify-center`} onClick={() => setFilters(emptyFilters())}>Clear all filters</button>
      </aside>
      <div>
        <div className={`mb-3 text-[14px] ${muted}`}>Showing <b className={ink}>{shown.length}</b> of {forms.length} forms</div>
        {groups(main)}
        {shown.length === 0 && (
          <div className={`${card} p-6 text-center ${muted}`}>No forms match those filters. <button type="button" className={`font-semibold ${teal}`} onClick={() => setFilters(emptyFilters())}>Clear all</button></div>
        )}
        {ref.length > 0 && (
          <>
            <h2 className={`mb-1 mt-8 text-[19px] font-bold ${ink}`}>Reference — separate from MF operations</h2>
            <p className={`mb-3 text-[13px] ${muted}`}>Guides, circulars, web pages and the KFintech Shares business (corporate registry, tax &amp; TDS) live here, not mixed into mutual-fund client work.</p>
            {groups(ref)}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ tab 3 */
function RegisterTab({ filings, error, onMove }: { filings: Filing[]; error: string | null; onMove: (f: Filing) => void }) {
  const [mail, setMail] = useState<{ filing: Filing; to: Recipient[] } | null>(null);
  const [mailErr, setMailErr] = useState<string | null>(null);
  const emailFiling = async (f: Filing) => {
    setMailErr(null);
    try {
      const d = await fetchHouseholdDetail(f.household_id as string);
      setMail({ filing: f, to: d.members.map((m) => ({ customer_id: m.customer_id, name: m.name, email: m.email })) });
    } catch (e) { setMailErr(e instanceof Error ? e.message : "Could not load the household."); }
  };
  return (
    <section>
      <div className="mb-4 rounded-[9px] border border-[#E4E9EF] dark:border-[#2B3644] bg-[#E6F2F0] dark:bg-[#0C2B28] px-4 py-3 text-[14px]">
        📋 <b className={teal}>Auto-logged, always.</b> Every Fill &amp; Sign is recorded here <b className={teal}>and</b> in the household&apos;s CRM activity, so any team member can pick a filing up where it was left.
      </div>
      {(error || mailErr) && <p role="alert" className="mb-3 text-[13px] text-[#B42318] dark:text-[#FF7D86]">{error ?? mailErr}</p>}
      {mail && <EmailDialog recipients={mail.to} filing={{ id: mail.filing.id, title: mail.filing.form_title }} onClose={() => setMail(null)} />}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full border-collapse text-[14px]" aria-label="Filings register">
          <thead>
            <tr>{["Date", "Form", "Client / Folio", "Filled by", "Status", "Actions"].map((h) => <th key={h} className={`border-b border-[#E4E9EF] dark:border-[#2B3644] ${soft} px-3.5 py-2.5 text-left text-[12px] font-bold uppercase tracking-wider ${muted}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filings.map((r) => (
              <tr key={r.id} className="border-b border-[#E4E9EF] last:border-0 dark:border-[#2B3644] align-top">
                <td className="whitespace-nowrap px-3.5 py-3">{fmtDate(r.created_at)}</td>
                <td className={`px-3.5 py-3 font-semibold ${ink}`}>{r.form_title}</td>
                <td className="px-3.5 py-3">{r.client_name ?? "—"}{r.folio && <div className={`text-[13px] ${muted}`}>Folio {r.folio}</div>}</td>
                <td className="px-3.5 py-3">{r.filled_by_name ?? "—"}</td>
                <td className="px-3.5 py-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-extrabold ${STATUS_TONE[r.status]}`}>{FILING_STATUSES[r.status]}</span></td>
                <td className="whitespace-nowrap px-3.5 py-3">
                  <a href={`/api/backoffice/operations/filings/${r.id}/pdf`} download className={`${btn} mr-1.5`}>Re-download</a>
                  <button type="button" className={`${btn} mr-1.5`} disabled={!r.household_id} title={r.household_id ? "Email the filled form to the household" : "This filing is not linked to a household"} onClick={() => emailFiling(r)}>Email client</button>
                  <button type="button" className={btn} disabled={r.status >= 2} onClick={() => onMove(r)}>Update status</button>
                </td>
              </tr>
            ))}
            {filings.length === 0 && <tr><td colSpan={6} className={`px-3.5 py-8 text-center ${muted}`}>No filings yet. Use Fill &amp; Sign on any form and it is logged here.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={`mt-3 text-[13px] ${muted}`}>Use “Update status” to move a filing along: Downloaded → Submitted to RTA → Ack received.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ landing */
export default function OperationsPage() {
  const [view, setView] = useState<"home" | "forms" | "download">("home");
  if (view === "forms") return <div><button type="button" className={`${btn} mb-3`} onClick={() => setView("home")}>← Operations</button><FormFilling /></div>;
  if (view === "download") return <div className="space-y-4"><button type="button" className={btn} onClick={() => setView("home")}>← Operations</button><DownloadContent /></div>;
  return (
    <div className="space-y-5 pb-12">
      <div>
        <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>Operations</h1>
        <p className={`mt-1 text-[14px] ${muted}`}>Choose what you want to do.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {([["forms", "Form filling", "Start a task, forms library, pre-filled CAMS, KFintech, AMC and PMS forms, upload your own PDF, and the filings register."], ["download", "Download Content", "Paste a link to save a video, audio or image file."]] as const).map(([v, title, text]) => (
          <button key={v} type="button" onClick={() => setView(v)} className={`${card} p-6 text-left hover:border-[#006F64]`}>
            <div className={`text-lg font-bold ${ink}`}>{title}</div>
            <p className={`mt-1.5 text-[13.5px] ${muted}`}>{text}</p>
          </button>
        ))}
        <Link href="/backoffice/operations/calculators" className={`${card} p-6 text-left hover:border-[#006F64]`}>
          <div className={`text-lg font-bold ${ink}`}>Calculators</div>
          <p className={`mt-1.5 text-[13.5px] ${muted}`}>{CALCULATORS.length} calculators: SIP, goal, retirement, SWP, CAGR, rebalancing and term cover.</p>
        </Link>
        <Link href="/backoffice/operations/emails" className={`${card} p-6 text-left hover:border-[#006F64]`}>
          <div className={`text-lg font-bold ${ink}`}>Sent emails</div>
          <p className={`mt-1.5 text-[13.5px] ${muted}`}>Everything emailed to clients from the CRM: who, when, and what was attached.</p>
        </Link>
      </div>
    </div>
  );
}

function DownloadContent() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("auto");
  const [quality, setQuality] = useState("1080");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<DownloadResult | null>(null);
  const field = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-2 text-[14px]";

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await startDownload({ url: url.trim(), mode, quality })); } catch (x) { setErr(x instanceof Error ? x.message : "Could not fetch this link."); }
    setBusy(false);
  }

  return (
    <div className={`${card} p-6 space-y-4`}>
      <div>
        <h1 className={`text-xl font-bold ${ink}`}>Download Content</h1>
        <p className={`mt-1 text-[13px] ${muted}`}>Only download content you own or have permission to use.</p>
      </div>
      <form onSubmit={go} className="space-y-3">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link" aria-label="Link" className={`${field} w-full`} />
        <div className="flex flex-wrap gap-3">
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Type" className={field}>
            <option value="auto">Video</option><option value="audio">Audio only</option><option value="mute">Video without sound</option>
          </select>
          <select value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Quality" className={field}>
            {["max", "2160", "1440", "1080", "720", "480", "360"].map((q) => <option key={q} value={q}>{q === "max" ? "Best quality" : `${q}p`}</option>)}
          </select>
          <button type="submit" disabled={busy || !url.trim()} className={btnPrimary}>{busy ? "Fetching…" : "Get file"}</button>
        </div>
      </form>
      {err && <p role="alert" className="text-[13px] text-[#B42318] dark:text-[#FF7D86]">{err}</p>}
      {res && res.status !== "picker" && <a href={res.file} download={res.filename} className={btnPrimary}>Save {res.filename}</a>}
      {res && res.status === "picker" && (
        <ul className="space-y-1.5 text-[13px]">{res.items.map((i, n) => <li key={n}><a className={teal} href={i.url} target="_blank" rel="noreferrer">{i.type} {n + 1}</a></li>)}</ul>
      )}
    </div>
  );
}
