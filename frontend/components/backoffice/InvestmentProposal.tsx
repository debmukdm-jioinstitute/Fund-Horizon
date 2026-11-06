"use client";

import React, { useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";
import FundSearch, { type FundHit } from "@/components/backoffice/FundSearch";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

const RISKS = ["Conservative", "Moderately Conservative", "Moderate", "Moderately Aggressive", "Aggressive"];
const MIN_AMOUNT = 5000;
const MIN_SIP = 500;
const MODES = [["lumpsum", "Lumpsum"], ["lumpsum_custom", "Lumpsum Custom"], ["sip", "SIP"], ["sip_custom", "SIP Custom"], ["stp", "STP"], ["swp", "SWP"], ["lumpsum_sip", "Lumpsum + SIP"]] as const;
type Mode = (typeof MODES)[number][0];
const HAS_LUMP: Mode[] = ["lumpsum", "lumpsum_custom", "stp", "swp", "lumpsum_sip"];
const HAS_SIP: Mode[] = ["sip", "sip_custom", "lumpsum_sip"];
const field = "w-full rounded-lg border-2 border-[#C9D1DB] dark:border-[#3A4656] bg-white dark:bg-[#171E2A] px-3 py-2.5 text-[14px] outline-none focus:border-[#006F64]";
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2 py-1.5 text-[13px] tabular-nums";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const hint = "text-[11.5px] font-normal text-[#667085] dark:text-[#9AA3B2]";
const th = "px-2 py-1.5 text-left text-[11.5px] font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-[12.5px] tabular-nums";

interface Row { code: string; name: string; category: string; amount: string; sip: string; exp_ret: string }
interface Kpi { label: string; value: number | string; fmt: "inr" | "pct" | "yrs" | "text" }
interface Split { name: string; amount: number; pct: number }
interface Trailing { code: string; name: string; category: string; aum_cr: number | null; ter: number | null; peers: number; returns: Record<string, number | null>; avg: Record<string, number | null>; rank: Record<string, number | null> }
interface Rolling { code: string; name: string; category: string; average: number; median: number; maximum: number; minimum: number; distribution: Record<string, number> }
interface Named { name: string; pct: number }
interface Result {
  mode: Mode; title: string; sip: number; kpis: Kpi[]; source: { name: string } | null;
  amount: number; years: number; expected_return: number; future_value: number;
  schemes: { code: string; name: string; category: string; amount: number; sip: number; exp_ret: number; alloc_pct: number; ret_1y: number | null; ret_3y: number | null; ret_5y: number | null }[];
  trailing: Trailing[]; rolling: Rolling[]; amc: Split[]; category: Split[]; asset: Split[];
  holdings: { sector: Named[]; equity: Named[]; debt: Named[]; coverage_pct: number; as_of: string | null };
  notes: { nav_as_of: string; rolling: string; returns: string };
}

async function call<T>(path: string, init: RequestInit = {}, blob = false): Promise<T> {
  const go = () => fetch(resolveApiUrl(`${API_URL}${path}`), { credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, ...init });
  let res: Response;
  try { res = await go(); } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try { res = await go(); } catch { throw new ApiError("Could not reach the server (it may be restarting). Wait a few seconds and try again.", 0); }
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const f2 = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(2));
const digits = (s: string) => s.replace(/[^\d]/g, "");
const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? NaN : Number(s));

const kpiText = (k: Kpi) => (k.fmt === "inr" ? `Rs. ${inr(k.value as number)}` : k.fmt === "pct" ? `${(k.value as number).toFixed(2)}% p.a.` : k.fmt === "yrs" ? `${k.value} years` : String(k.value));

function Box({ label, addon, children }: { label: string; addon?: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute -top-2.5 left-3 z-10 bg-white px-1.5 text-[12px] font-medium text-[#006F64] dark:bg-[#171E2A] dark:text-[#4FD1C5]">{label}</span>
      <div className="flex">{children}{addon && <span className="flex items-center rounded-r-lg border-2 border-l-0 border-[#C9D1DB] bg-[#F5F7FB] px-3 text-[13px] font-semibold dark:border-[#3A4656] dark:bg-[#1B2433]">{addon}</span>}</div>
    </div>
  );
}

function Table({ head, rows, right = 1 }: { head: string[]; rows: React.ReactNode[][]; right?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr className="bg-[#183883] text-white">{head.map((h, i) => <th key={h + i} className={`${th} ${i >= right ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice(0, DEFAULT_PAGE_SIZE).map((r, i) => <tr key={i} className="border-b border-[#E4E9EF] dark:border-[#2B3644] odd:bg-[#F5F7FB] dark:odd:bg-[#1B2433]">{r.map((c, j) => <td key={j} className={`${td} ${j >= right ? "text-right" : ""}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const SplitTable = ({ title, rows }: { title: string; rows: Split[] }) => (
  <div>
    <h3 className="mb-1.5 text-[13.5px] font-bold">{title}</h3>
    <Table head={[title.replace(" Allocation", ""), "Amount (Rs.)", "Allocation (%)"]} rows={[...rows.map((r) => [r.name, inr(r.amount), r.pct.toFixed(2)]), [<b key="t">Grand Total</b>, <b key="a">{inr(rows.reduce((s, r) => s + r.amount, 0))}</b>, <b key="p">100.00</b>]]} />
  </div>
);

const Top10 = ({ title, rows, col }: { title: string; rows: Named[]; col: string }) => (
  <div>
    <h3 className="mb-1.5 text-[13.5px] font-bold">{title}</h3>
    {rows.length ? <Table head={[col, "Allocation (%)"]} rows={rows.map((r) => [r.name, r.pct.toFixed(2)])} /> : <p className={hint}>No disclosure data for these schemes.</p>}
  </div>
);

export default function InvestmentProposal() {
  const [client, setClient] = useState("");
  const [amount, setAmount] = useState("");
  const [years, setYears] = useState("");
  const [risk, setRisk] = useState("");
  const [mode, setMode] = useState<Mode>("lumpsum");
  const [sipAmt, setSipAmt] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [source, setSource] = useState<{ code: string; name: string } | null>(null);
  const [started, setStarted] = useState(false);
  const [custom, setCustom] = useState<"" | "1" | "2">("");
  const [purpose, setPurpose] = useState("");
  const [plan, setPlan] = useState<"Regular" | "Direct">("Regular");
  const [rows, setRows] = useState<Row[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [cover, setCover] = useState(true);
  const amt = num(amount.replace(/,/g, "")), yrs = num(years), sipV = num(sipAmt.replace(/,/g, "")), wdV = num(withdraw.replace(/,/g, ""));
  const hasLump = HAS_LUMP.includes(mode), hasSip = HAS_SIP.includes(mode), isCustom = mode.endsWith("_custom");
  const lumpLabel = mode === "swp" ? "Corpus amount" : mode === "stp" ? "STP amount" : "Lumpsum amount";
  const pickMode = (m: Mode) => { setMode(m); setRows([]); setStarted(false); setSource(null); setErr(""); stale(); };
  const stale = () => setRes(null); // any change to the inputs or the table invalidates the shown result

  const checkForm = (): string => {
    if (!client.trim()) return "Please enter the client name.";
    if (hasLump && !(amt >= MIN_AMOUNT)) return `${lumpLabel} minimum investment is Rs.${MIN_AMOUNT}.`;
    if (hasSip && !(sipV >= MIN_SIP)) return `SIP minimum monthly amount is Rs.${MIN_SIP}.`;
    if (mode === "swp" && !(wdV > 0 && wdV <= amt)) return "Enter a monthly withdrawal that is more than zero and not more than the corpus.";
    if (!(yrs > 0 && yrs <= 50)) return "Please enter a valid period (1 to 50 years).";
    if (!isCustom && !risk) return "Please select the risk profile.";
    if (!custom) return "Please select the expected returns option.";
    return "";
  };
  const wrap = async (label: string, fn: () => Promise<void>) => {
    setErr(""); setBusy(label);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(""); }
  };

  const submit = () => {
    const m = checkForm();
    if (m) return setErr(m);
    if (isCustom) { setRows([]); setRes(null); setStarted(true); return; } // custom: the adviser picks every scheme
    void wrap("suggest", async () => {
      const d = await call<{ rows: { code: string; name: string; category: string; amount: number; sip: number; exp_ret: number }[]; source: { code: string; name: string } | null }>("/api/backoffice/investment-proposal/suggest", { method: "POST", body: JSON.stringify({ mode, amount: hasLump ? amt : 0, sip: hasSip ? sipV : 0, years: yrs, risk, plan }) });
      setRows(d.rows.map((r) => ({ code: r.code, name: r.name, category: r.category, amount: r.amount ? inr(r.amount) : "", sip: r.sip ? inr(r.sip) : "", exp_ret: custom === "2" ? "8" : String(r.exp_ret) })));
      setSource(d.source); setStarted(true);
      setRes(null);
    });
  };

  const add = (h: FundHit) => {
    if (rows.some((r) => r.code === h.code)) return;
    void wrap("add", async () => {
      const s = await call<{ code: string; name: string; category: string; exp_ret: number }>(`/api/backoffice/investment-proposal/scheme/${h.code}`);
      setRows((r) => [...r, { code: s.code, name: s.name, category: s.category, amount: "", sip: "", exp_ret: custom === "2" ? "8" : String(s.exp_ret) }]);
      stale();
    });
  };

  const n = (v: string) => num(v.replace(/,/g, "")) || 0;
  const total = rows.reduce((s, r) => s + n(r.amount), 0), sipTotal = rows.reduce((s, r) => s + n(r.sip), 0);
  const body = () => ({ mode, years: yrs, amount: hasLump ? amt : undefined, sip: hasSip ? sipV : undefined, withdraw: mode === "swp" ? wdV : 0, source: mode === "stp" ? source?.code : undefined,
    client: client.trim(), risk, purpose: purpose.trim(), cover, rows: rows.map((r) => ({ code: r.code, amount: n(r.amount), sip: n(r.sip), exp_ret: num(r.exp_ret) })) });
  const checkRows = (): string => {
    const m = checkForm();
    if (m) return m;
    if (!rows.length) return "Please add at least one scheme.";
    for (const r of rows) {
      if (hasLump && !hasSip && !(n(r.amount) > 0)) return `Please enter the ${lumpLabel.toLowerCase()} for ${r.name}.`;
      if (hasSip && !hasLump && !(n(r.sip) > 0)) return `Please enter the monthly SIP for ${r.name}.`;
      if (hasLump && hasSip && !(n(r.amount) > 0 || n(r.sip) > 0)) return `Please enter a lumpsum or SIP for ${r.name}.`;
      if (isNaN(num(r.exp_ret))) return `Please enter the expected returns for ${r.name}.`;
    }
    if (hasLump && total > amt) return "Total Investment Amount exceeds the Proposal Amount!";
    if (hasSip && sipTotal > sipV) return "Total monthly SIP exceeds the Proposal SIP amount!";
    return "";
  };

  const show = () => {
    const m = checkRows();
    if (m) return setErr(m);
    void wrap("result", async () => setRes(await call<Result>("/api/backoffice/investment-proposal/result", { method: "POST", body: JSON.stringify(body()) })));
  };
  const pdf = () => {
    const m = checkRows();
    if (m) return setErr(m);
    void wrap("pdf", async () => {
      const blob = await call<Blob>("/api/backoffice/investment-proposal/pdf", { method: "POST", body: JSON.stringify(body()) }, true);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `Investment Proposal - ${client.trim()}.pdf`; a.click(); URL.revokeObjectURL(a.href);
    });
  };

  const setRow = (i: number, p: Partial<Row>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x))); stale(); };
  const left = amt - total, sipLeft = sipV - sipTotal;
  const hint2 = (l: number, unit: string) => (l === 0 ? "Matches the proposal amount" : l > 0 ? `${unit} ${inr(l)} left to allocate` : `${unit} ${inr(-l)} over the proposal amount`);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-5 p-5`}>
        <div>
          <h2 className="text-lg font-bold">Investment proposal — {MODES.find((m) => m[0] === mode)![1]}</h2>
          <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Pick the investment option, then enter the client&apos;s details. Fund Horizon suggests a category mix and the top-scored scheme in each category (custom options let you pick every scheme); change any scheme, amount or expected return, then show the result or download the client PDF.</p>
        </div>
        <div className="grid gap-x-4 gap-y-5 pt-1 sm:grid-cols-2 lg:grid-cols-4">
          <Box label="Select Investment Option:"><select className={field} value={mode} onChange={(e) => pickMode(e.target.value as Mode)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Box>
          <Box label="Client Name:"><input className={field} value={client} maxLength={120} placeholder="Enter Client Name" onChange={(e) => { setClient(e.target.value); stale(); }} /></Box>
          {hasLump && <Box label={`${lumpLabel} (Rs.):`} addon="₹"><input className={`${field} rounded-r-none`} inputMode="numeric" value={amount} placeholder="Enter Amount" onChange={(e) => { const d = digits(e.target.value); setAmount(d ? inr(Number(d)) : ""); stale(); }} /></Box>}
          {hasSip && <Box label="Monthly SIP Amount (Rs.):" addon="₹"><input className={`${field} rounded-r-none`} inputMode="numeric" value={sipAmt} placeholder="Enter SIP Amount" onChange={(e) => { const d = digits(e.target.value); setSipAmt(d ? inr(Number(d)) : ""); stale(); }} /></Box>}
          {mode === "swp" && <Box label="Monthly Withdrawal (Rs.):" addon="₹"><input className={`${field} rounded-r-none`} inputMode="numeric" value={withdraw} placeholder="Enter Withdrawal" onChange={(e) => { const d = digits(e.target.value); setWithdraw(d ? inr(Number(d)) : ""); stale(); }} /></Box>}
          <Box label={mode === "stp" ? "STP Period (Years):" : "Period (Years):"} addon="Yrs"><input className={`${field} rounded-r-none`} inputMode="decimal" value={years} placeholder="Enter years" onChange={(e) => { setYears(e.target.value.replace(/[^\d.]/g, "")); stale(); }} /></Box>
          {!isCustom && <Box label="Risk Profile:"><select className={field} value={risk} onChange={(e) => { setRisk(e.target.value); stale(); }}><option value="">Select Risk Profile</option>{RISKS.map((r) => <option key={r}>{r}</option>)}</select></Box>}
          <Box label="Expected Returns:"><select className={field} value={custom} onChange={(e) => { setCustom(e.target.value as "" | "1" | "2"); stale(); }}><option value="">Select Expected Returns</option><option value="1">Standard expected returns</option><option value="2">Custom expected returns</option></select></Box>
          <Box label="Plan:"><select className={field} value={plan} onChange={(e) => { setPlan(e.target.value as "Regular" | "Direct"); stale(); }}><option>Regular</option><option>Direct</option></select></Box>
          <Box label="Investment Purpose:"><input className={field} value={purpose} maxLength={300} placeholder="Enter Purpose" onChange={(e) => setPurpose(e.target.value)} /></Box>
          <div className="flex items-center gap-3"><button type="button" className={btnPrimary} onClick={submit} disabled={!!busy}>{busy === "suggest" ? "Suggesting…" : "Submit"}</button></div>
        </div>
        <p className={hint}>{isCustom ? "Submit opens an empty scheme table — add the schemes yourself." : "Submit replaces the scheme table below with a fresh suggestion."}</p>
        {err && <p role="alert" className="rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] font-medium text-[#B42318] dark:bg-[#3A1C1C] dark:text-[#FDA29B]">{err}</p>}
      </div>

      {(rows.length > 0 || started) && (
        <div className={`${card} space-y-3 p-5`}>
          <h3 className="text-[15px] font-bold">{isCustom ? "Your schemes" : "Suggested schemes"}</h3>
          {source && <p className={hint}>STP source fund (money moves monthly from here into the schemes below): <b>{source.name}</b></p>}
          <FundSearch id="proposal-hits" plan={plan} exclude={rows.map((r) => r.code)} placeholder={`Add another scheme: type a fund name or scheme code (${plan} plan)`} onPick={add} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-[#183883] text-white"><th className={th}>Scheme</th><th className={th}>Category</th>{hasLump && <th className={`${th} text-right`}>{mode === "swp" ? "Corpus (Rs.)" : "Amount (Rs.)"}</th>}{hasSip && <th className={`${th} text-right`}>SIP (Rs./month)</th>}<th className={`${th} text-right`}>Expected return (%)</th><th className={th}><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.code} className="border-b border-[#E4E9EF] dark:border-[#2B3644]">
                    <td className="px-2 py-1.5 text-[12.5px]">{r.name} <span className={hint}>· {r.code}</span></td>
                    <td className="px-2 py-1.5 text-[12.5px] whitespace-nowrap">{r.category}</td>
                    {hasLump && <td className="px-2 py-1.5"><input aria-label={`Amount for ${r.name}`} className={`${cell} w-32 text-right`} inputMode="numeric" value={r.amount} onChange={(e) => { const d = digits(e.target.value); setRow(i, { amount: d ? inr(Number(d)) : "" }); }} /></td>}
                    {hasSip && <td className="px-2 py-1.5"><input aria-label={`SIP for ${r.name}`} className={`${cell} w-32 text-right`} inputMode="numeric" value={r.sip} onChange={(e) => { const d = digits(e.target.value); setRow(i, { sip: d ? inr(Number(d)) : "" }); }} /></td>}
                    <td className="px-2 py-1.5"><input aria-label={`Expected return for ${r.name}`} className={`${cell} w-24 text-right`} inputMode="decimal" value={r.exp_ret} readOnly={custom === "1"} title={custom === "1" ? "Standard expected returns are fixed per category. Choose Custom expected returns to edit." : undefined} onChange={(e) => setRow(i, { exp_ret: e.target.value.replace(/[^\d.-]/g, "") })} /></td>
                    <td className="px-2 py-1.5"><button type="button" className={btn} aria-label={`Remove ${r.name}`} onClick={() => { setRows((x) => x.filter((_, j) => j !== i)); stale(); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td className={td} colSpan={2}>Total</td>
                {hasLump && <td className={`${td} text-right ${total > amt ? "text-[#B42318]" : ""}`}>{inr(total)}<div className={hint}>{hint2(left, "Rs.")}</div></td>}
                {hasSip && <td className={`${td} text-right ${sipTotal > sipV ? "text-[#B42318]" : ""}`}>{inr(sipTotal)}<div className={hint}>{hint2(sipLeft, "Rs.")}</div></td>}
                <td className={td} colSpan={2} /></tr></tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btnPrimary} onClick={show} disabled={!!busy}>{busy === "result" ? "Calculating…" : "Show result"}</button>
            <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} /> Include cover page in PDF</label>
            <button type="button" className={btn} onClick={pdf} disabled={!!busy}>{busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</button>
          </div>
        </div>
      )}

      {res && (
        <div className={`${card} space-y-5 p-5`}>
          <h3 className="text-[15px] font-bold">Investment proposal — {res.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {res.kpis.map((k) => (
              <div key={k.label} className="rounded-lg bg-[#F5F7FB] dark:bg-[#1B2433] p-3"><div className={hint}>{k.label}</div><div className="text-[18px] font-bold tabular-nums">{kpiText(k)}</div></div>
            ))}
          </div>
          <div>
            <h3 className="mb-1.5 text-[13.5px] font-bold">Suggested portfolio allocation</h3>
            <Table right={2} head={["Scheme", "Category", "1 Yr Ret (%)", "3 Yrs Ret (%)", "5 Yrs Ret (%)", "Expected Ret (%)", ...(res.amount ? ["Amount (Rs.)"] : []), ...(res.sip ? ["SIP (Rs./month)"] : []), "Allocation (%)"]}
              rows={[...res.schemes.map((s) => [s.name, s.category, f2(s.ret_1y), f2(s.ret_3y), f2(s.ret_5y), s.exp_ret.toFixed(2), ...(res.amount ? [inr(s.amount)] : []), ...(res.sip ? [inr(s.sip)] : []), s.alloc_pct.toFixed(2)]),
                [<b key="g">Grand Total</b>, "", "", "", "", <b key="r">{res.expected_return.toFixed(2)}</b>, ...(res.amount ? [<b key="a">{inr(res.amount)}</b>] : []), ...(res.sip ? [<b key="s">{inr(res.sip)}</b>] : []), <b key="p">100.00</b>]]} />
            <p className={`${hint} mt-1`}>{res.notes.returns} Net asset value (NAV) as on {res.notes.nav_as_of}.</p>
          </div>
          <div>
            <h3 className="mb-1.5 text-[13.5px] font-bold">Trailing returns</h3>
            <Table right={2} head={["Scheme", "Category", "AUM (Cr)", "TER (%)", "1 Yr Ret / Rank", "3 Yrs Ret / Rank", "5 Yrs Ret / Rank", "10 Yrs Ret / Rank"]}
              rows={res.trailing.flatMap((t) => [
                [t.name, t.category, t.aum_cr == null ? "-" : inr(t.aum_cr), f2(t.ter), ...["1y", "3y", "5y", "10y"].map((k) => `${f2(t.returns[k])} / ${t.rank[k] == null ? "-" : `${t.rank[k]} of ${t.rank[k + "_of"]}`}`)],
                [<i key="a">{`Category average (${t.peers} funds)`}</i>, "", "", "", ...["1y", "3y", "5y", "10y"].map((k) => <i key={k}>{f2(t.avg[k])}</i>)],
              ])} />
          </div>
          {res.rolling.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[13.5px] font-bold">Rolling return analysis (equity and hybrid schemes)</h3>
              <Table right={2} head={["Scheme", "Category", "Average", "Median", "Maximum", "Minimum", "Negative", "0 - 8%", "8 - 12%", "12 - 15%", "15 - 20%", "> 20%"]}
                rows={res.rolling.map((r) => [r.name, r.category, f2(r.average), f2(r.median), f2(r.maximum), f2(r.minimum), ...["negative", "0-8", "8-12", "12-15", "15-20", ">20"].map((k) => f2(r.distribution[k]))])} />
              <p className={`${hint} mt-1`}>{res.notes.rolling} Distribution is the share of rolling periods (%).</p>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-3"><SplitTable title="AMC Allocation" rows={res.amc} /><SplitTable title="Asset Allocation" rows={res.asset} /><SplitTable title="Category Allocation" rows={res.category} /></div>
          <div>
            <p className={`${hint} mb-2`}>Holdings are from the latest portfolio disclosures ({res.holdings.as_of ?? "date not available"}) and cover {res.holdings.coverage_pct}% of the amount.</p>
            <div className="grid gap-5 lg:grid-cols-3"><Top10 title="Top 10 sector allocation" rows={res.holdings.sector} col="Sector" /><Top10 title="Top 10 equity allocation" rows={res.holdings.equity} col="Company" /><Top10 title="Top 10 debt allocation" rows={res.holdings.debt} col="Company" /></div>
          </div>
        </div>
      )}
    </div>
  );
}
