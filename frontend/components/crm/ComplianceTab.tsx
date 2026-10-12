// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CONSENT_PURPOSES,
  Consent,
  DisclosureLog,
  KycRecord,
  Mandate,
  SuitabilityRecord,
  createDisclosure,
  createMandate,
  createSuitability,
  formatRupeesFromPaise,
  getConsents,
  getDisclosures,
  getKyc,
  getMandates,
  getSuitability,
  upsertConsent,
  upsertKyc,
} from "../../lib/crmProductsApi";
import { ApiError } from "../../lib/api";

type SubTab = "consents" | "suitability" | "disclosures" | "kyc" | "mandates";

const SUB_TABS: { value: SubTab; label: string }[] = [
  { value: "consents", label: "Consents" },
  { value: "suitability", label: "Suitability" },
  { value: "disclosures", label: "Disclosures" },
  { value: "kyc", label: "KYC" },
  { value: "mandates", label: "Mandates" },
];

function CustomerIdField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="text-xs font-semibold text-navy-800 space-y-1 block max-w-sm">
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste customer ID"
        className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal"
      />
    </label>
  );
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="bg-rose-100 border border-rose-600/30 text-rose-700 text-xs rounded-xl px-4 py-3">{message}</div>;
}

/* ---------------- Consents ---------------- */

function ConsentsPanel() {
  const [customerId, setCustomerId] = useState("");
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPurpose, setBusyPurpose] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = customerId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setConsents(await getConsents(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load consents.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setConsents([]);
  }, [customerId]);

  const setGrant = async (purpose: string, granted: boolean) => {
    const id = customerId.trim();
    if (!id) return;
    setBusyPurpose(purpose);
    setError(null);
    try {
      const updated = await upsertConsent({ customer_id: id, purpose, granted });
      setConsents((prev) => {
        const rest = prev.filter((c) => c.purpose !== purpose);
        return [...rest, updated].sort((a, b) => a.purpose.localeCompare(b.purpose));
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update consent.");
    } finally {
      setBusyPurpose(null);
    }
  };

  const byPurpose = new Map(consents.map((c) => [c.purpose, c]));

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <CustomerIdField value={customerId} onChange={setCustomerId} label="Customer ID" />
        <button
          onClick={load}
          disabled={loading || !customerId.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>
      <ErrorBox message={error} />
      {customerId.trim() && !loading && (
        <div className="bg-white border border-navy-200 rounded-2xl divide-y divide-navy-100 shadow-sm">
          {CONSENT_PURPOSES.map((p) => {
            const c = byPurpose.get(p.value);
            const granted = c ? c.granted === 1 : null;
            return (
              <div key={p.value} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-navy-950">{p.label}</p>
                  <p className="text-[10px] text-navy-500">
                    {granted === null
                      ? "No record yet"
                      : granted
                        ? `Granted ${c?.granted_at ? `on ${new Date(c.granted_at).toLocaleDateString("en-IN")}` : ""}`
                        : `Withdrawn ${c?.withdrawn_at ? `on ${new Date(c.withdrawn_at).toLocaleDateString("en-IN")}` : ""}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    disabled={busyPurpose === p.value || granted === true}
                    onClick={() => setGrant(p.value, true)}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
                  >
                    Grant
                  </button>
                  <button
                    disabled={busyPurpose === p.value || granted === false}
                    onClick={() => setGrant(p.value, false)}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-navy-400">
        Consent records are per customer and per purpose. Withdrawal is recorded with a timestamp; history is kept.
      </p>
    </div>
  );
}

/* ---------------- Suitability ---------------- */

function SuitabilityPanel() {
  const [customerId, setCustomerId] = useState("");
  const [records, setRecords] = useState<SuitabilityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [financialStatus, setFinancialStatus] = useState("");
  const [experience, setExperience] = useState("");
  const [objectives, setObjectives] = useState("");
  const [riskBand, setRiskBand] = useState("");

  const load = useCallback(async () => {
    const id = customerId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setRecords(await getSuitability(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load suitability records.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setRecords([]);
  }, [customerId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = customerId.trim();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createSuitability({
        customer_id: id,
        financial_status: financialStatus.trim() || undefined,
        investment_experience: experience.trim() || undefined,
        objectives: objectives.trim() || undefined,
        risk_band: riskBand.trim() || undefined,
      });
      setRecords((prev) => [created, ...prev]);
      setFinancialStatus("");
      setExperience("");
      setObjectives("");
      setRiskBand("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the suitability record.");
    } finally {
      setSaving(false);
    }
  };

  const latest = records[0];

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <CustomerIdField value={customerId} onChange={setCustomerId} label="Customer ID" />
        <button
          onClick={load}
          disabled={loading || !customerId.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>
      <ErrorBox message={error} />

      {latest && (
        <div className="bg-teal-50 border border-teal-600/20 rounded-2xl p-4">
          <p className="text-[10px] font-bold uppercase text-teal-700 mb-2">Current record</p>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div><dt className="text-navy-500">Risk band</dt><dd className="font-semibold text-navy-950">{latest.risk_band ?? "—"}</dd></div>
            <div><dt className="text-navy-500">Financial status</dt><dd className="font-semibold text-navy-950">{latest.financial_status ?? "—"}</dd></div>
            <div><dt className="text-navy-500">Investment experience</dt><dd className="font-semibold text-navy-950">{latest.investment_experience ?? "—"}</dd></div>
            <div><dt className="text-navy-500">Objectives</dt><dd className="font-semibold text-navy-950">{latest.objectives ?? "—"}</dd></div>
          </dl>
          <p className="text-[10px] text-navy-500 mt-2">
            Recorded {new Date(latest.recorded_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
      )}

      {records.length > 1 && (
        <div className="bg-white border border-navy-200 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-bold text-navy-950 mb-2">History ({records.length - 1} earlier)</p>
          <div className="space-y-2">
            {records.slice(1).map((r) => (
              <div key={r.id} className="text-[11px] text-navy-600 border-l-2 border-navy-100 pl-3">
                <span className="font-semibold text-navy-900">{r.risk_band ?? "No band"}</span>
                {" — "}
                {[r.financial_status, r.investment_experience, r.objectives].filter(Boolean).join(" · ")}
                <span className="text-navy-400"> ({new Date(r.recorded_at).toLocaleDateString("en-IN")})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={add} className="bg-white border border-navy-200 rounded-2xl p-4 space-y-3 shadow-sm">
        <p className="text-xs font-bold text-navy-950">New suitability record</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>Risk band</span>
            <select value={riskBand} onChange={(e) => setRiskBand(e.target.value)}
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal">
              <option value="">Select</option>
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="growth">Growth</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>Investment experience</span>
            <input value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="e.g. 5 years in mutual funds"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>Financial status</span>
            <input value={financialStatus} onChange={(e) => setFinancialStatus(e.target.value)} placeholder="e.g. salaried, stable income"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>Objectives</span>
            <input value={objectives} onChange={(e) => setObjectives(e.target.value)} placeholder="e.g. retirement corpus in 15 years"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving || !customerId.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save record"}
        </button>
      </form>
    </div>
  );
}

/* ---------------- Disclosures ---------------- */

function DisclosuresPanel() {
  const [customerId, setCustomerId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [logs, setLogs] = useState<DisclosureLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [schemesCompared, setSchemesCompared] = useState("");
  const [commissions, setCommissions] = useState("");
  const [regularNoted, setRegularNoted] = useState(false);

  const load = useCallback(async () => {
    const cid = customerId.trim();
    const oid = opportunityId.trim();
    if (!cid && !oid) return;
    setLoading(true);
    setError(null);
    try {
      setLogs(await getDisclosures({
        customer_id: cid || undefined,
        opportunity_id: oid || undefined,
      }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load disclosure logs.");
    } finally {
      setLoading(false);
    }
  }, [customerId, opportunityId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cid = customerId.trim();
    if (!cid) return;
    let schemesJson: string | undefined;
    const parts = schemesCompared.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) schemesJson = JSON.stringify(parts);
    setSaving(true);
    setError(null);
    try {
      const created = await createDisclosure({
        customer_id: cid,
        opportunity_id: opportunityId.trim() || undefined,
        schemes_compared: schemesJson,
        commissions_disclosed: commissions.trim() || undefined,
        regular_plan_noted: regularNoted,
      });
      setLogs((prev) => [created, ...prev]);
      setSchemesCompared("");
      setCommissions("");
      setRegularNoted(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the disclosure.");
    } finally {
      setSaving(false);
    }
  };

  const parseSchemes = (raw?: string | null): string[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map(String) : [raw];
    } catch {
      return [raw];
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <CustomerIdField value={customerId} onChange={setCustomerId} label="Customer ID" />
        <label className="text-xs font-semibold text-navy-800 space-y-1 block max-w-sm">
          <span>Opportunity ID (optional)</span>
          <input
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            placeholder="optional"
            className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal"
          />
        </label>
        <button
          onClick={load}
          disabled={loading || (!customerId.trim() && !opportunityId.trim())}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>
      <ErrorBox message={error} />

      <div className="space-y-2">
        {logs.length === 0 && !loading && (
          <p className="text-[11px] text-navy-400">No disclosure logs yet for this filter.</p>
        )}
        {logs.map((d) => (
          <div key={d.id} className="bg-white border border-navy-200 rounded-xl p-3 shadow-sm text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-navy-950">
                {parseSchemes(d.schemes_compared).join(", ") || "Disclosure logged"}
              </span>
              <span className="text-[10px] text-navy-500">
                {new Date(d.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
            {d.commissions_disclosed && <p className="text-navy-600">Commissions: {d.commissions_disclosed}</p>}
            <p className="text-[10px] text-navy-500">
              Regular plan noted: {d.regular_plan_noted === 1 ? "Yes" : "No"}
              {d.opportunity_id ? ` · Opportunity ${d.opportunity_id.slice(0, 8)}` : ""}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="bg-white border border-navy-200 rounded-2xl p-4 space-y-3 shadow-sm">
        <p className="text-xs font-bold text-navy-950">New disclosure log</p>
        <label className="text-xs font-semibold text-navy-800 space-y-1 block">
          <span>Schemes compared (comma separated)</span>
          <input value={schemesCompared} onChange={(e) => setSchemesCompared(e.target.value)}
            placeholder="e.g. HDFC Flexi Cap - Reg, Parag Parikh Flexi Cap - Reg"
            className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
        </label>
        <label className="text-xs font-semibold text-navy-800 space-y-1 block">
          <span>Commissions disclosed</span>
          <textarea value={commissions} onChange={(e) => setCommissions(e.target.value)} rows={2}
            placeholder="Exact commission figures shared with the customer"
            className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
        </label>
        <label className="text-xs text-navy-800 flex items-center gap-2">
          <input type="checkbox" checked={regularNoted} onChange={(e) => setRegularNoted(e.target.checked)} />
          <span>Customer was told these are regular-plan figures (not direct)</span>
        </label>
        <button
          type="submit"
          disabled={saving || !customerId.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Log disclosure"}
        </button>
      </form>
    </div>
  );
}

/* ---------------- KYC ---------------- */

function KycPanel() {
  const [customerId, setCustomerId] = useState("");
  const [record, setRecord] = useState<KycRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [panLast4, setPanLast4] = useState("");
  const [kraStatus, setKraStatus] = useState("unknown");
  const [ckycId, setCkycId] = useState("");

  const load = useCallback(async () => {
    const id = customerId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await getKyc(id);
      setRecord(r);
      setPanLast4(r.pan_last4 ?? "");
      setKraStatus(r.kra_status);
      setCkycId(r.ckyc_id ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setRecord(null);
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to load KYC record.");
      }
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = customerId.trim();
    if (!id) return;
    if (!/^[A-Za-z0-9]{4}$/.test(panLast4.trim())) {
      setError("PAN last-4 must be exactly 4 letters or digits.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await upsertKyc({
        customer_id: id,
        pan_last4: panLast4.trim().toUpperCase(),
        kra_status: kraStatus,
        ckyc_id: ckycId.trim() || undefined,
      });
      setRecord(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the KYC record.");
    } finally {
      setSaving(false);
    }
  };

  const kraChip = (s: string) =>
    s === "validated" ? "bg-teal-100 text-teal-700"
    : s === "registered" ? "bg-navy-100 text-navy-800"
    : s === "on_hold" ? "bg-amber-100 text-amber-600"
    : "bg-gray-100 text-gray-600";

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <CustomerIdField value={customerId} onChange={setCustomerId} label="Customer ID" />
        <button
          onClick={load}
          disabled={loading || !customerId.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>
      <ErrorBox message={error} />

      {record && (
        <div className="bg-white border border-navy-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${kraChip(record.kra_status)}`}>
              {record.kra_status.replaceAll("_", " ")}
            </span>
            <span className="text-xs font-mono font-semibold text-navy-950 tracking-widest">
              {record.pan_last4 ? `•••• ${record.pan_last4}` : "PAN not on file"}
            </span>
          </div>
          <p className="text-[10px] text-navy-500 mt-2">
            Only the last 4 characters of the PAN are stored. CKYC ID: {record.ckyc_id ?? "—"} ·
            Updated {new Date(record.updated_at).toLocaleDateString("en-IN")}
          </p>
        </div>
      )}

      <form onSubmit={save} className="bg-white border border-navy-200 rounded-2xl p-4 space-y-3 shadow-sm">
        <p className="text-xs font-bold text-navy-950">{record ? "Update KYC record" : "Add KYC record"}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>PAN last 4 (never the full PAN)</span>
            <input value={panLast4} onChange={(e) => setPanLast4(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="ABCD" maxLength={4}
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal font-mono tracking-widest" />
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>KRA status</span>
            <select value={kraStatus} onChange={(e) => setKraStatus(e.target.value)}
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal">
              <option value="validated">Validated</option>
              <option value="registered">Registered</option>
              <option value="on_hold">On hold</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>CKYC ID (optional)</span>
            <input value={ckycId} onChange={(e) => setCkycId(e.target.value)} placeholder="optional"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving || !customerId.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save KYC"}
        </button>
      </form>
    </div>
  );
}

/* ---------------- Mandates ---------------- */

function MandatesPanel() {
  const [customerId, setCustomerId] = useState("");
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [umrn, setUmrn] = useState("");
  const [bankName, setBankName] = useState("");
  const [amountCapRs, setAmountCapRs] = useState("");

  const load = useCallback(async () => {
    const id = customerId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setMandates(await getMandates(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load mandates.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setMandates([]);
  }, [customerId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = customerId.trim();
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const capRs = parseFloat(amountCapRs);
      const created = await createMandate({
        customer_id: id,
        umrn: umrn.trim() || undefined,
        bank_name: bankName.trim() || undefined,
        amount_cap: Number.isFinite(capRs) ? Math.round(capRs * 100) : undefined,
      });
      setMandates((prev) => [created, ...prev]);
      setUmrn("");
      setBankName("");
      setAmountCapRs("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the mandate.");
    } finally {
      setSaving(false);
    }
  };

  const statusChip = (s: string) =>
    s === "approved" ? "bg-teal-100 text-teal-700"
    : s === "registered" ? "bg-navy-100 text-navy-800"
    : s === "processing" ? "bg-amber-100 text-amber-600"
    : "bg-rose-100 text-rose-700";

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <CustomerIdField value={customerId} onChange={setCustomerId} label="Customer ID" />
        <button
          onClick={load}
          disabled={loading || !customerId.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>
      <ErrorBox message={error} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {mandates.map((m) => (
          <div key={m.id} className="bg-white border border-navy-200 rounded-xl p-3 shadow-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusChip(m.status)}`}>
                {m.status}
              </span>
              <span className="text-xs font-bold text-navy-950">{formatRupeesFromPaise(m.amount_cap)}</span>
            </div>
            <p className="text-xs font-semibold text-navy-900">{m.bank_name ?? "Bank not set"}</p>
            {m.umrn && <p className="text-[10px] text-navy-500 font-mono">UMRN {m.umrn}</p>}
            <p className="text-[10px] text-navy-400">
              Created {new Date(m.created_at).toLocaleDateString("en-IN")}
            </p>
          </div>
        ))}
        {mandates.length === 0 && !loading && customerId.trim() && (
          <p className="text-[11px] text-navy-400">No mandates on file for this customer.</p>
        )}
      </div>

      <form onSubmit={add} className="bg-white border border-navy-200 rounded-2xl p-4 space-y-3 shadow-sm">
        <p className="text-xs font-bold text-navy-950">Register mandate</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>UMRN (optional)</span>
            <input value={umrn} onChange={(e) => setUmrn(e.target.value)} placeholder="optional"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>Bank name</span>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
          <label className="text-xs font-semibold text-navy-800 space-y-1">
            <span>Amount cap (₹)</span>
            <input value={amountCapRs} onChange={(e) => setAmountCapRs(e.target.value)} placeholder="e.g. 50000"
              inputMode="decimal"
              className="w-full border border-navy-200 rounded-lg px-2 py-1.5 text-xs font-normal" />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving || !customerId.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Register mandate"}
        </button>
      </form>
    </div>
  );
}

/* ---------------- root ---------------- */

export default function ComplianceTab() {
  const [tab, setTab] = useState<SubTab>("consents");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              tab === t.value
                ? "bg-navy-900 text-white border-navy-900"
                : "bg-white text-navy-700 border-navy-200 hover:border-navy-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "consents" && <ConsentsPanel />}
      {tab === "suitability" && <SuitabilityPanel />}
      {tab === "disclosures" && <DisclosuresPanel />}
      {tab === "kyc" && <KycPanel />}
      {tab === "mandates" && <MandatesPanel />}
    </div>
  );
}
