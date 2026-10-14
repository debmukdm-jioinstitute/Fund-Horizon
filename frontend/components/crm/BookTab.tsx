// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import {
  createCampaign, fetchCampaign, fetchCampaigns, fetchCommissionSummary, fetchContactGaps, fetchSipAlerts, fetchSipBook, fetchSips,
  fetchTeams, generateSipAlerts, importCommissions, importHoldings, patchCampaign, populateCampaign, previewCampaign, setMemberStatus,
  setTeamLead, TIERS, TAX_STATUSES,
  type Campaign, type CommissionSummary, type ImportResult, type Segment, type Sip, type SipAlert,
} from "../../lib/crmPhase3Api";
import { fmtDate } from "./EntityLists";
import { useOwners } from "./OwnerAvatar";
import { btnCls, cardCls, errCls, ghostBtnCls, headCls, inputCls, mutedCls, rupees, tdCls, thCls } from "./ui";
import { useCanWrite } from "./useCanWrite";

const SECTIONS = [
  ["holdings", "Holdings import"], ["sips", "SIP book"], ["commissions", "Trail commission"],
  ["campaigns", "Campaigns"], ["gaps", "Data gaps"], ["teams", "Teams"],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsText(file);
  });
}

/* ---------------------------- upload (holdings + brokerage) ---------------------------- */
function UploadSection({ kind }: { kind: "holdings" | "commissions" }) {
  const canWrite = useCanWrite();
  const { customer } = useAuth();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [asOf, setAsOf] = useState("");
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adminOnly = kind === "commissions" && customer?.role !== "admin";

  const run = async (dry: boolean) => {
    if (!csv.trim()) return setError("Choose a CSV file first.");
    setBusy(true);
    setError(null);
    try {
      setRes(kind === "holdings" ? await importHoldings(csv, asOf, dry, "cas") : await importCommissions(csv, dry, fileName || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const help = kind === "holdings"
    ? "Columns: folio, scheme_code (AMFI), units, cost, plus any of PAN, mobile, email, investor name to match each row to a contact in your book. CAMS and KFin headers such as “Closing Units” and “Folio No” are recognised."
    : "Columns: folio, scheme_code, month (2026-09 or Sep-2026) and amount in ₹. Re-uploading a month replaces those lines. Lines whose folio and scheme are not in the holdings are listed as unmatched.";
  if (adminOnly) return <p className={`text-xs ${mutedCls}`}>Only an admin can upload brokerage files. The summary below shows your own book.</p>;
  return (
    <div className="space-y-3">
      <p className={`text-xs ${mutedCls}`}>{help}</p>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label>CSV file
            <input type="file" accept=".csv,text/csv,text/plain" className={inputCls}
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setCsv(await readFile(f)); setRes(null); } }} />
          </label>
          {kind === "holdings" && <label>Statement date<input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} /></label>}
          <button type="button" className={ghostBtnCls} disabled={busy || !csv} onClick={() => run(true)}>Preview</button>
          <button type="button" className={btnCls} disabled={busy || !csv} onClick={() => run(false)}>{busy ? "Working…" : "Import"}</button>
        </div>
      )}
      {error && <p role="alert" className={errCls}>{error}</p>}
      {res && (
        <div className="space-y-2 text-xs" role="status">
          <p className="font-semibold text-[#172033] dark:text-[#EDF2F7]">
            {res.dry_run ? "Preview (nothing saved): " : "Imported: "}
            {kind === "holdings"
              ? `${res.matched_rows} of ${res.rows} rows matched to ${res.contacts ?? 0} contact(s)${res.dry_run ? "" : `; ${res.created} added, ${res.updated} updated`}. Valued at ${rupees(res.aum_paise)}.`
              : `${res.lines} line(s), ${rupees(res.total_paise)} in total${res.dry_run ? "" : `; ${res.created} added, ${res.updated} replaced`}.`}
          </p>
          {!!res.unvalued_schemes?.length && <p className="text-amber-800 dark:text-[#FFD27A]">No NAV for scheme code(s): {res.unvalued_schemes.join(", ")}. These positions are kept but not valued.</p>}
          {!!res.unmatched?.length && (
            <p className="text-amber-800 dark:text-[#FFD27A]">{res.unmatched.length} line(s) have no matching holding ({rupees(res.unmatched.reduce((a, u) => a + u.amount_paise, 0))}): {res.unmatched.slice(0, 6).map((u) => u.folio).join(", ")}{res.unmatched.length > 6 ? "…" : ""}</p>
          )}
          {res.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-rose-700 dark:text-rose-300">{res.skipped.length} row(s) skipped</summary>
              <ul className="mt-1 list-disc pl-5">{res.skipped.slice(0, 50).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------- SIP book ------------------------------------- */
function SipSection() {
  const canWrite = useCanWrite();
  const [book, setBook] = useState<{ count: number; monthly_paise: number } | null>(null);
  const [alerts, setAlerts] = useState<SipAlert[]>([]);
  const [sips, setSips] = useState<Sip[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [b, a, s] = await Promise.all([fetchSipBook(), fetchSipAlerts(), fetchSips({})]);
      setBook(b); setAlerts(a); setSips(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the SIP book");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const gen = async () => {
    try {
      const r = await generateSipAlerts();
      setNotice(r.created ? `Created ${r.created} follow-up task${r.created === 1 ? "" : "s"}.` : "No new tasks: every alert already has an open follow-up.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create tasks");
    }
  };
  const KIND: Record<string, string> = { ending_soon: "Ending soon", bounce: "Bounced", mandate_expiring: "Mandate expiring" };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <div><p className={`text-xs ${mutedCls}`}>Active SIPs</p><p className="text-2xl font-bold">{book?.count ?? "–"}</p></div>
        <div><p className={`text-xs ${mutedCls}`}>Monthly SIP book</p><p className="text-2xl font-bold">{book ? rupees(book.monthly_paise) : "–"}</p></div>
      </div>
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <h3 className={headCls}>Alerts (next 30 days)</h3>
          {canWrite && alerts.length > 0 && <button type="button" className={btnCls} onClick={gen}>Create follow-up tasks</button>}
        </div>
        {notice && <p role="status" className="text-xs font-medium text-[#006F64] dark:text-[#75E1CE] mt-1">{notice}</p>}
        {alerts.length === 0 ? <p className={`text-xs mt-2 ${mutedCls}`}>Nothing needs attention.</p> : (
          <ul className="mt-2 space-y-1 text-xs">
            {alerts.map((a) => (
              <li key={`${a.sip_id}-${a.kind}`} className="flex flex-wrap justify-between gap-2">
                <span><span className="font-semibold">{KIND[a.kind]}</span> · {a.message} {a.contact_name && <>· {a.contact_name}</>}</span>
                <span className={mutedCls}>{fmtDate(a.due)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p role="alert" className={errCls}>{error}</p>}
      <div className={`${cardCls} overflow-x-auto`}>
        <h3 className={`${headCls} mb-2`}>All schedules</h3>
        {sips.length === 0 ? <p className={`text-xs ${mutedCls}`}>None yet. Add them from a contact&apos;s page.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]"><th className={thCls}>Scheme</th><th className={thCls}>Type</th><th className={`${thCls} text-right`}>Amount</th><th className={thCls}>Ends</th><th className={thCls}>Status</th><th className={thCls}>Contact</th></tr></thead>
            <tbody>
              {sips.map((s) => (
                <tr key={s.id} className="border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">
                  <td className={tdCls}>{s.scheme_name ?? s.scheme_code}</td><td className={`${tdCls} uppercase`}>{s.type}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{rupees(s.amount_paise)}</td><td className={tdCls}>{fmtDate(s.end_date)}</td>
                  <td className={`${tdCls} capitalize`}>{s.status}</td>
                  <td className={tdCls}><Link className="underline text-[#006F64] dark:text-[#75E1CE]" href={`/backoffice/crm/contacts/${s.contact_id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- trail commission --------------------------------- */
function CommissionSection() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sum, setSum] = useState<CommissionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    fetchCommissionSummary(from || undefined, to || undefined).then((s) => { setSum(s); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [from, to, version]);
  return (
    <div className="space-y-4">
      <div className={cardCls}><h3 className={`${headCls} mb-2`}>Upload brokerage</h3><UploadSection kind="commissions" /></div>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>From<input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></label>
        <label>To<input type="month" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></label>
        <button type="button" className={ghostBtnCls} onClick={() => setVersion((v) => v + 1)}>Refresh</button>
      </div>
      {error && <p role="alert" className={errCls}>{error}</p>}
      {sum && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className={cardCls}>
            <p className={`text-xs ${mutedCls}`}>Total trail</p><p className="text-2xl font-bold">{rupees(sum.total_paise)}</p>
            {sum.unmatched_paise !== 0 && <p className="text-xs text-amber-800 dark:text-[#FFD27A] mt-1">{rupees(sum.unmatched_paise)} could not be matched to a household.</p>}
            <ul className="mt-2 text-xs space-y-0.5">{sum.by_month.map((m) => <li key={m.month} className="flex justify-between"><span>{m.month}</span><span className="tabular-nums">{rupees(m.amount_paise)}</span></li>)}</ul>
          </div>
          <div className={cardCls}>
            <h3 className={`${headCls} mb-2`}>By household</h3>
            {sum.by_household.length === 0 ? <p className={`text-xs ${mutedCls}`}>No data.</p> : <ul className="text-xs space-y-0.5">{sum.by_household.slice(0, 15).map((h) => <li key={h.household_id} className="flex justify-between gap-2"><Link className="underline" href={`/backoffice/crm/households/${h.household_id}`}>{h.household_name}</Link><span className="tabular-nums">{rupees(h.amount_paise)}</span></li>)}</ul>}
          </div>
          <div className={cardCls}>
            <h3 className={`${headCls} mb-2`}>By RM</h3>
            {sum.by_rm.length === 0 ? <p className={`text-xs ${mutedCls}`}>No data.</p> : <ul className="text-xs space-y-0.5">{sum.by_rm.map((r) => <li key={r.rm_id} className="flex justify-between gap-2"><span>{r.rm_name ?? "Unassigned"}</span><span className="tabular-nums">{rupees(r.amount_paise)}</span></li>)}</ul>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------- campaigns ---------------------------------------- */
const MEMBER_STATUS = ["targeted", "contacted", "responded", "converted", "declined"];

function CampaignSection() {
  const canWrite = useCanWrite();
  const [list, setList] = useState<Campaign[]>([]);
  const [open, setOpen] = useState<Campaign | null>(null);
  const [name, setName] = useState("");
  const [seg, setSeg] = useState<{ aum_min: string; aum_max: string; tier: string[]; tax_status: string[]; sip_status: string; direct: boolean }>({ aum_min: "", aum_max: "", tier: [], tax_status: [], sip_status: "", direct: false });
  const [preview, setPreview] = useState<{ count: number; households: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toSegment = (): Segment => ({
    ...(seg.aum_min ? { aum_min: Number(seg.aum_min) } : {}), ...(seg.aum_max ? { aum_max: Number(seg.aum_max) } : {}),
    ...(seg.tier.length ? { tier: seg.tier } : {}), ...(seg.tax_status.length ? { tax_status: seg.tax_status } : {}),
    ...(seg.sip_status ? { sip_status: seg.sip_status } : {}), ...(seg.direct ? { has_direct_plan: true } : {}),
  });
  const load = useCallback(() => fetchCampaigns().then(setList).catch((e) => setError(e instanceof Error ? e.message : "Could not load campaigns")), []);
  useEffect(() => { load(); }, [load]);
  const toggle = (k: "tier" | "tax_status", v: string) => setSeg((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));
  const wrap = async (fn: () => Promise<void>) => { setError(null); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); } };

  return (
    <div className="space-y-4">
      {canWrite && (
        <form className={`${cardCls} space-y-3 text-xs`} aria-label="New campaign" onSubmit={(e) => { e.preventDefault(); void wrap(async () => { if (!name.trim()) throw new Error("Name the campaign."); const c = await createCampaign(name.trim(), undefined, toSegment()); setName(""); setNotice(`Created “${c.name}”. Open it to add the matching contacts.`); await load(); }); }}>
          <h3 className={headCls}>New campaign</h3>
          <div className="grid gap-2 md:grid-cols-4">
            <label className="md:col-span-2">Name<input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></label>
            <label>AUM from (₹)<input inputMode="decimal" value={seg.aum_min} onChange={(e) => setSeg({ ...seg, aum_min: e.target.value })} className={inputCls} /></label>
            <label>AUM up to (₹)<input inputMode="decimal" value={seg.aum_max} onChange={(e) => setSeg({ ...seg, aum_max: e.target.value })} className={inputCls} /></label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <fieldset className="flex gap-3"><legend className="font-semibold mb-1">Tier</legend>{TIERS.map((t) => <label key={t} className="capitalize inline-flex items-center gap-1"><input type="checkbox" checked={seg.tier.includes(t)} onChange={() => toggle("tier", t)} />{t}</label>)}</fieldset>
            <fieldset className="flex gap-3"><legend className="font-semibold mb-1">Tax status</legend>{TAX_STATUSES.map((t) => <label key={t} className="uppercase inline-flex items-center gap-1"><input type="checkbox" checked={seg.tax_status.includes(t)} onChange={() => toggle("tax_status", t)} />{t}</label>)}</fieldset>
            <label>SIP status<select value={seg.sip_status} onChange={(e) => setSeg({ ...seg, sip_status: e.target.value })} className={inputCls}><option value="">Any</option><option value="active">Has an active SIP</option><option value="none">No SIP</option><option value="ended">All SIPs ended</option></select></label>
            <label className="inline-flex items-center gap-1 self-end"><input type="checkbox" checked={seg.direct} onChange={(e) => setSeg({ ...seg, direct: e.target.checked })} />Holds a Direct plan</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghostBtnCls} onClick={() => wrap(async () => setPreview(await previewCampaign(toSegment())))}>Preview audience</button>
            {preview && <span role="status">{preview.count} contact(s) in {preview.households} household(s)</span>}
            <button type="submit" className={`${btnCls} ml-auto`}>Create campaign</button>
          </div>
        </form>
      )}
      {notice && <p role="status" className="text-xs font-medium text-[#006F64] dark:text-[#75E1CE]">{notice}</p>}
      {error && <p role="alert" className={errCls}>{error}</p>}
      <div className={`${cardCls} overflow-x-auto`}>
        <h3 className={`${headCls} mb-2`}>Campaigns</h3>
        {list.length === 0 ? <p className={`text-xs ${mutedCls}`}>No campaigns yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]"><th className={thCls}>Name</th><th className={thCls}>Status</th><th className={thCls}>Members</th><th className={thCls}>Responded</th><th className={thCls} /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">
                  <td className={`${tdCls} font-semibold`}>{c.name}</td><td className={`${tdCls} capitalize`}>{c.status}</td>
                  <td className={tdCls}>{c.member_total}</td>
                  <td className={tdCls}>{(c.member_counts.responded ?? 0) + (c.member_counts.converted ?? 0)}</td>
                  <td className={tdCls}><button type="button" className="underline text-[#006F64] dark:text-[#75E1CE]" onClick={() => wrap(async () => setOpen(await fetchCampaign(c.id)))}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <div className={`${cardCls} space-y-3`} aria-label={`Campaign ${open.name}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={headCls}>{open.name}</h3>
            {canWrite && (
              <span className="flex gap-2">
                <button type="button" className={ghostBtnCls} onClick={() => wrap(async () => { const r = await populateCampaign(open.id); setNotice(`Matched ${r.matched}, added ${r.added} new member(s).`); setOpen(await fetchCampaign(open.id)); await load(); })}>Add matching contacts</button>
                <select aria-label="Campaign status" value={open.status} className={inputCls} onChange={(e) => wrap(async () => { await patchCampaign(open.id, { status: e.target.value }); setOpen(await fetchCampaign(open.id)); await load(); })}>
                  <option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option>
                </select>
              </span>
            )}
          </div>
          {(open.members ?? []).length === 0 ? <p className={`text-xs ${mutedCls}`}>No members yet.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]"><th className={thCls}>Contact</th><th className={thCls}>Household</th><th className={thCls}>Response</th></tr></thead>
              <tbody>
                {(open.members ?? []).map((m) => (
                  <tr key={m.contact_id} className="border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">
                    <td className={tdCls}><Link className="underline" href={`/backoffice/crm/contacts/${m.contact_id}`}>{m.name}</Link></td>
                    <td className={tdCls}>{m.household_name}</td>
                    <td className={tdCls}>
                      <select aria-label={`Response for ${m.name}`} disabled={!canWrite} value={m.status} className={inputCls} onChange={(e) => wrap(async () => { await setMemberStatus(open.id, m.contact_id, e.target.value); setOpen(await fetchCampaign(open.id)); await load(); })}>
                        {MEMBER_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------ gaps and teams ------------------------------------ */
const GAP_LABEL: Record<string, string> = { nominee: "No nominee", kyc: "KYC incomplete", kyc_expired: "KYC expired", fatca_crs: "FATCA/CRS missing" };

function GapsSection() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchContactGaps>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchContactGaps().then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Could not load")); }, []);
  if (error) return <p role="alert" className={errCls}>{error}</p>;
  if (!rows) return <p className={`text-xs ${mutedCls}`}>Loading…</p>;
  return (
    <div className={`${cardCls} overflow-x-auto`}>
      <h3 className={`${headCls} mb-2`}>Contacts with a nominee, KYC or FATCA/CRS gap ({rows.length})</h3>
      {rows.length === 0 ? <p className={`text-xs ${mutedCls}`}>No gaps.</p> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]"><th className={thCls}>Contact</th><th className={thCls}>Household</th><th className={thCls}>Missing</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">
                <td className={tdCls}><Link className="font-semibold underline text-[#006F64] dark:text-[#75E1CE]" href={`/backoffice/crm/contacts/${r.id}`}>{r.name}</Link></td>
                <td className={tdCls}>{r.household_name}</td>
                <td className={tdCls}>{r.gaps.map((g) => GAP_LABEL[g] ?? g).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TeamsSection() {
  const { customer } = useAuth();
  const owners = useOwners();
  const [links, setLinks] = useState<{ rm_id: string; lead_id: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetchTeams().then((t) => setLinks(t.links)).catch((e) => setError(e instanceof Error ? e.message : "Could not load teams")), []);
  useEffect(() => { load(); }, [load]);
  const isAdmin = customer?.role === "admin";
  const rms = owners.filter((o) => o.role === "rm");
  return (
    <div className={cardCls}>
      <h3 className={`${headCls} mb-1`}>Reporting lines</h3>
      <p className={`text-xs mb-2 ${mutedCls}`}>A team lead sees and works the books of everyone who reports to them, directly or indirectly. {isAdmin ? "" : "Only an admin can change these."}</p>
      {error && <p role="alert" className={errCls}>{error}</p>}
      <ul className="space-y-1.5 text-xs">
        {rms.map((o) => {
          const lead = links.find((l) => l.rm_id === o.id)?.lead_id ?? "";
          return (
            <li key={o.id} className="flex items-center justify-between gap-2">
              <span>{o.name}</span>
              <label className="inline-flex items-center gap-2"><span className={mutedCls}>Reports to</span>
                <select disabled={!isAdmin} value={lead} aria-label={`Team lead for ${o.name}`} className={inputCls + " w-44"}
                  onChange={async (e) => { setError(null); try { await setTeamLead(o.id, e.target.value || null); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save"); } }}>
                  <option value="">Nobody</option>
                  {rms.filter((x) => x.id !== o.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            </li>
          );
        })}
        {rms.length === 0 && <li className={mutedCls}>No RM accounts.</li>}
      </ul>
    </div>
  );
}

/* --------------------------------------- the tab --------------------------------------- */
export default function BookTab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("section");
  const section: SectionId = SECTIONS.some(([id]) => id === raw) ? (raw as SectionId) : "holdings";
  const go = (id: SectionId) => {
    const next = new URLSearchParams(params.toString());
    next.set("section", id);
    router.push(`${pathname}?${next}`);
  };
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Book sections" className="flex flex-wrap gap-1">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => go(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${section === id ? "bg-[#006F64] text-white" : "bg-[#EEF2F6] dark:bg-[#24303E] text-[#536176] dark:text-[#A8B4C4]"}`}>
            {label}
          </button>
        ))}
      </div>
      {section === "holdings" && <div className={cardCls}><h2 className={`${headCls} mb-2`}>Import holdings (CAMS / KFin CAS)</h2><UploadSection kind="holdings" /></div>}
      {section === "sips" && <SipSection />}
      {section === "commissions" && <CommissionSection />}
      {section === "campaigns" && <CampaignSection />}
      {section === "gaps" && <GapsSection />}
      {section === "teams" && <TeamsSection />}
    </div>
  );
}
