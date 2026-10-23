// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPage } from "../../lib/crmListApi";
import {
  createHolding,
  deleteHolding,
  fetchContactHoldings,
  fetchHouseholdAum,
  importHoldings,
  uploadHoldingsFile,
  type AumPayload,
} from "../../lib/crmPhase3Api";
import { cardCls, errCls, headCls, inputCls, mutedCls, rupees, tdCls, thCls, tierTone } from "./ui";
import { useCanWrite } from "./useCanWrite";

const POPULAR_FUNDS = [
  { code: "118834", name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" },
  { code: "118989", name: "HDFC Top 100 Fund - Direct Plan - Growth" },
  { code: "120503", name: "Mirae Asset Large & Midcap Fund - Direct Plan - Growth" },
  { code: "125354", name: "Quant Active Fund - Direct Plan - Growth" },
  { code: "120828", name: "ICICI Prudential Bluechip Fund - Direct Plan - Growth" },
  { code: "120716", name: "SBI Small Cap Fund - Direct Plan - Growth" },
  { code: "120465", name: "Nippon India Small Cap Fund - Direct Plan - Growth" },
];

/** AUM roll-up (units × latest AMFI NAV) with positions, tier, and direct add/delete/import controls (PDF, Excel, CSV). */
export default function HoldingsCard({
  householdId,
  contactId,
  title = "Holdings & AUM",
}: {
  householdId?: string;
  contactId?: string;
  title?: string;
}) {
  const canWrite = useCanWrite();
  const [data, setData] = useState<AumPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Household contacts for holder assignment
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  // Dialog states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add form fields
  const [selectedContact, setSelectedContact] = useState(contactId ?? "");
  const [schemeCode, setSchemeCode] = useState("");
  const [schemeName, setSchemeName] = useState("");
  const [folio, setFolio] = useState("");
  const [units, setUnits] = useState("");
  const [cost, setCost] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // File import form fields (PDF, Excel, CSV)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const loadHoldings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = contactId ? await fetchContactHoldings(contactId) : await fetchHouseholdAum(householdId!);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load holdings");
    } finally {
      setLoading(false);
    }
  }, [householdId, contactId]);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

  // Load household members for the contact selector dropdown
  useEffect(() => {
    if (!householdId) return;
    fetchPage<{ id: string; name: string }>("contacts", { limit: 200, offset: 0, filters: { household_id: householdId } })
      .then((r) => {
        setMembers(r.rows);
        if (!selectedContact && r.rows.length > 0) {
          setSelectedContact(r.rows[0].id);
        }
      })
      .catch(() => setMembers([]));
  }, [householdId, selectedContact]);

  const handleQuickFund = (code: string, name: string) => {
    setSchemeCode(code);
    setSchemeName(name);
  };

  const handleSaveHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const targetContactId = contactId ?? selectedContact;
    if (!targetContactId) {
      setFormError("Please select a contact / account holder");
      return;
    }
    if (!schemeCode.trim()) {
      setFormError("Scheme code is required");
      return;
    }
    if (!folio.trim()) {
      setFormError("Folio number is required");
      return;
    }
    const parsedUnits = parseFloat(units);
    if (isNaN(parsedUnits) || parsedUnits <= 0) {
      setFormError("Units must be a positive number");
      return;
    }
    const parsedCost = cost.trim() ? parseFloat(cost) : 0;
    if (isNaN(parsedCost) || parsedCost < 0) {
      setFormError("Invested cost cannot be negative");
      return;
    }

    try {
      setSaving(true);
      await createHolding({
        contact_id: targetContactId,
        scheme_code: schemeCode.trim(),
        scheme_name: schemeName.trim() || null,
        folio: folio.trim(),
        units: parsedUnits,
        cost: parsedCost,
        as_of: asOf || undefined,
        source: "manual",
      });
      setShowAddModal(false);
      setSchemeCode("");
      setSchemeName("");
      setFolio("");
      setUnits("");
      setCost("");
      await loadHoldings();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save holding");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHolding = async (id: string) => {
    try {
      await deleteHolding(id);
      setDeletingId(null);
      await loadHoldings();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete holding");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setImportError(null);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    setImportSuccess(null);

    const targetContactId = contactId || (selectedContact.trim() ? selectedContact : undefined);

    if (!selectedFile && !csvText.trim()) {
      setImportError("Please upload a file (.pdf, .xlsx, .xls, .csv) or paste CSV text");
      return;
    }

    try {
      setImporting(true);
      if (selectedFile) {
        const res = await uploadHoldingsFile(selectedFile, {
          password: pdfPassword.trim() || undefined,
          contact_id: targetContactId,
          as_of: asOf || undefined,
        });
        setImportSuccess(
          `Successfully processed ${res.filename}: ${res.matched_rows} position(s) across ${res.contacts} contact(s).`
        );
      } else {
        const res = await importHoldings(csvText, asOf || undefined, false);
        setImportSuccess(`Imported ${res.matched_rows} position(s) across ${res.contacts} contact(s).`);
      }

      setSelectedFile(null);
      setPdfPassword("");
      setCsvText("");
      setTimeout(() => {
        setShowImportModal(false);
        setImportSuccess(null);
      }, 1500);
      await loadHoldings();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to process statement file");
    } finally {
      setImporting(false);
    }
  };

  if (error) return <p role="alert" className={errCls}>{error}</p>;
  if (!data && loading) return <div role="status" aria-busy="true" aria-label="Loading" className="h-20 rounded bg-[#E5E5E5]/70 dark:bg-[#2B3644]/70 animate-pulse" />;
  if (!data) return null;

  const direct = data.direct_plan_holdings.length;
  const isPdfSelected = selectedFile?.name?.toLowerCase().endsWith(".pdf");

  return (
    <section className={cardCls} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className={headCls}>{title}</h2>
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold capitalize ${tierTone[data.tier] ?? tierTone.standard}`}>{data.tier}</span>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAddModal(true);
                setFormError(null);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-[#0176D3] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#015db0] transition-colors shadow-sm"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add holding
            </button>
            <button
              type="button"
              onClick={() => {
                setShowImportModal(true);
                setSelectedFile(null);
                setPdfPassword("");
                setImportError(null);
                setImportSuccess(null);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[#D8DDE6] dark:border-[#3E4F63] bg-white dark:bg-[#171E27] px-2.5 py-1 text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F3F4F6] dark:hover:bg-[#202936] transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import CAS / Statement
            </button>
          </div>
        )}
      </div>

      <p className="mt-1 text-2xl font-bold text-[#181818] dark:text-[#EDF2F7]" aria-label="Assets under management">{rupees(data.aum_paise)}</p>
      <p className={`text-xs ${mutedCls}`}>
        Cost {rupees(data.cost_paise)} · {data.holdings.length} position{data.holdings.length === 1 ? "" : "s"}
        {data.unvalued > 0 && ` · ${data.unvalued} without a NAV (not counted)`}
      </p>

      {direct > 0 && (
        <p role="note" className="mt-2 rounded border border-amber-300 bg-amber-50 dark:bg-[#40300E] dark:border-[#6B5216] px-3 py-2 text-xs font-medium text-amber-900 dark:text-[#FFD27A]">
          {direct} Direct-plan holding{direct === 1 ? "" : "s"} found. A Regular-plan distributor earns no trail on these; check the client&apos;s intent.
        </p>
      )}

      {data.holdings.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[#E5E5E5] dark:border-[#2B3644] p-5 text-center">
          <p className="text-xs font-semibold text-[#181818] dark:text-[#EDF2F7]">No holdings recorded yet</p>
          <p className={`text-xs mt-1 mb-3 ${mutedCls}`}>Add positions directly from the CRM or upload a PDF, Excel, or CAS file.</p>
          {canWrite && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(true);
                  setFormError(null);
                }}
                className="inline-flex items-center gap-1 rounded bg-[#0176D3] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#015db0] transition-colors shadow-sm"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add holding directly
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(true);
                  setSelectedFile(null);
                  setPdfPassword("");
                  setImportError(null);
                  setImportSuccess(null);
                }}
                className="inline-flex items-center gap-1 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-3 py-1.5 text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F3F4F6] dark:hover:bg-[#202936] transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import CAS / Statement
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E5E5E5] dark:border-[#2B3644]">
                <th className={thCls}>Scheme</th>
                {householdId && <th className={thCls}>Holder</th>}
                <th className={thCls}>Folio</th>
                <th className={`${thCls} text-right`}>Units</th>
                <th className={`${thCls} text-right`}>Value</th>
                <th className={`${thCls} text-right`}>Gain</th>
                {canWrite && <th className={`${thCls} text-right`}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.id} className="border-b border-[#E5E5E5]/60 dark:border-[#2B3644]/60 hover:bg-[#F8FAFC] dark:hover:bg-[#151D27]/50 transition-colors">
                  <td className={tdCls}>
                    <div className="font-medium text-[#181818] dark:text-[#EDF2F7]">
                      {h.scheme_name ?? h.scheme_code}
                      {h.is_direct && <span className="ml-1 rounded bg-[#FFF1D6] dark:bg-[#40300E] px-1 text-[10px] font-semibold text-[#8A5A00] dark:text-[#FFD27A]">Direct</span>}
                    </div>
                    <div className={`text-[10px] ${mutedCls}`}>Code: {h.scheme_code}</div>
                  </td>
                  {householdId && <td className={tdCls}>{h.contact_name ?? "–"}</td>}
                  <td className={tdCls}>{h.folio}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{h.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                  <td className={`${tdCls} text-right tabular-nums font-semibold`}>{rupees(h.value_paise)}</td>
                  <td className={`${tdCls} text-right tabular-nums ${h.gain_paise != null && h.gain_paise < 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {rupees(h.gain_paise)}
                  </td>
                  {canWrite && (
                    <td className={`${tdCls} text-right`}>
                      {deletingId === h.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold">Delete?</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteHolding(h.id)}
                            className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-700"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="rounded bg-[#ECEBEA] dark:bg-[#24303E] px-1.5 py-0.5 text-[10px] text-[#181818] dark:text-[#EDF2F7]"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Delete holding position"
                          onClick={() => setDeletingId(h.id)}
                          className="text-[#9CA3AF] hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded transition-colors"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Holding Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-[#181818]/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add holding directly">
          <div className="bg-white dark:bg-[#10151C] rounded-2xl border border-[#E5E5E5] dark:border-[#2B3644] shadow-2xl w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#181818] dark:text-[#EDF2F7]">Add Holding Directly</h3>
                <p className={`text-xs ${mutedCls}`}>Create or update a position in this client&apos;s book</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded p-1 text-[#706E6B] dark:text-[#A8B4C4] hover:bg-[#F3F4F6] dark:hover:bg-[#202936]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {formError && (
              <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-300 rounded bg-rose-50 dark:bg-rose-950/40 p-2.5 border border-rose-200 dark:border-rose-900">
                {formError}
              </p>
            )}

            <form onSubmit={handleSaveHolding} className="space-y-3">
              {householdId && (
                <div>
                  <label htmlFor="holding-holder" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Account Holder *
                  </label>
                  <select
                    id="holding-holder"
                    required
                    value={selectedContact}
                    onChange={(e) => setSelectedContact(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select household member...</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quick fund chips */}
              <div>
                <label className={`block text-[11px] font-semibold ${mutedCls} mb-1`}>
                  Popular funds (click to auto-fill)
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 border border-[#E5E5E5] dark:border-[#2B3644] rounded-lg">
                  {POPULAR_FUNDS.map((f) => (
                    <button
                      key={f.code}
                      type="button"
                      onClick={() => handleQuickFund(f.code, f.name)}
                      className="rounded bg-[#F0F4F8] dark:bg-[#1D2733] hover:bg-[#E2ECF7] dark:hover:bg-[#283749] px-2 py-1 text-[11px] font-medium text-[#181818] dark:text-[#EDF2F7] transition-colors text-left truncate max-w-full"
                    >
                      {f.name.split(" - ")[0]} ({f.code})
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="holding-scheme-code" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Scheme / AMFI Code *
                  </label>
                  <input
                    id="holding-scheme-code"
                    required
                    placeholder="e.g. 118834 or 100001"
                    value={schemeCode}
                    onChange={(e) => setSchemeCode(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="holding-scheme-name" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Scheme Name (optional)
                  </label>
                  <input
                    id="holding-scheme-name"
                    placeholder="e.g. Parag Parikh Flexi Cap Fund"
                    value={schemeName}
                    onChange={(e) => setSchemeName(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="holding-folio" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Folio Number *
                  </label>
                  <input
                    id="holding-folio"
                    required
                    placeholder="e.g. 1234567/89"
                    value={folio}
                    onChange={(e) => setFolio(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="holding-units" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Units *
                  </label>
                  <input
                    id="holding-units"
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    placeholder="e.g. 150.250"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="holding-cost" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Invested Cost (₹)
                  </label>
                  <input
                    id="holding-cost"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 25000"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="holding-asof" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                  As Of Date
                </label>
                <input
                  id="holding-asof"
                  type="date"
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#0176D3] text-white hover:bg-[#015db0] transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? "Saving holding..." : "Save holding"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CAS / PDF / Excel Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-[#181818]/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Import Statement or File">
          <div className="bg-white dark:bg-[#10151C] rounded-2xl border border-[#E5E5E5] dark:border-[#2B3644] shadow-2xl w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#181818] dark:text-[#EDF2F7]">Import Holdings Statement</h3>
                <p className={`text-xs ${mutedCls}`}>Upload PDF, Excel, or CSV statement to import positions</p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded p-1 text-[#706E6B] dark:text-[#A8B4C4] hover:bg-[#F3F4F6] dark:hover:bg-[#202936]"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {importError && (
              <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-300 rounded bg-rose-50 dark:bg-rose-950/40 p-2.5 border border-rose-200 dark:border-rose-900">
                {importError}
              </p>
            )}

            {importSuccess && (
              <p role="status" className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 rounded bg-emerald-50 dark:bg-emerald-950/40 p-2.5 border border-emerald-200 dark:border-emerald-900">
                {importSuccess}
              </p>
            )}

            <form onSubmit={handleImportSubmit} className="space-y-3.5">
              {householdId && (
                <div>
                  <label htmlFor="import-holder" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                    Assign To Member (Optional)
                  </label>
                  <select
                    id="import-holder"
                    value={selectedContact}
                    onChange={(e) => setSelectedContact(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Auto-match from statement (PAN / Email / Name)</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Supported formats pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-[#706E6B] dark:text-[#A8B4C4]">Supported:</span>
                <span className="rounded bg-[#EAF5FE] dark:bg-[#102B47] px-2 py-0.5 font-medium text-[#0176D3] dark:text-[#1B96FF]">PDF (CAMS / KFin CAS)</span>
                <span className="rounded bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">Excel (.xlsx, .xls)</span>
                <span className="rounded bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-400">CSV</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                  Select Statement File (PDF / Excel / CSV)
                </label>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleFileChange}
                  className="block w-full text-xs text-[#706E6B] dark:text-[#A8B4C4] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#0176D3]/10 file:text-[#0176D3] hover:file:bg-[#0176D3]/20"
                />
                {selectedFile && (
                  <p className="mt-1 text-[11px] text-[#0176D3] dark:text-[#1B96FF] font-medium">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {/* If PDF, show password input */}
              {isPdfSelected && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-[#40300E]/40 p-3 space-y-1">
                  <label htmlFor="pdf-pass" className="block text-xs font-semibold text-amber-900 dark:text-[#FFD27A]">
                    PDF Password (if password protected)
                  </label>
                  <p className="text-[11px] text-amber-800/80 dark:text-[#FFD27A]/80">
                    CAMS/KFintech CAS PDFs are usually locked with PAN in UPPERCASE or Date of Birth.
                  </p>
                  <input
                    id="pdf-pass"
                    type="password"
                    placeholder="e.g. ABCDE1234F"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    className={inputCls}
                  />
                </div>
              )}

              <div>
                <label htmlFor="import-csv-text" className="block text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] mb-1">
                  Or Paste CSV Text (Optional)
                </label>
                <textarea
                  id="import-csv-text"
                  rows={4}
                  placeholder="folio,scheme_code,units,cost,as_of&#10;12345/67,118834,150.25,25000,2026-10-13"
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    if (e.target.value.trim()) setSelectedFile(null);
                  }}
                  className={`${inputCls} font-mono text-[11px]`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644]">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#0176D3] text-white hover:bg-[#015db0] transition-colors shadow-sm disabled:opacity-50"
                >
                  {importing ? "Processing file..." : "Import Statement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
