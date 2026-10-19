"use client";

import React, { useState, useEffect } from "react";
import { OperationFormTemplate } from "@/lib/operationsForms";
import SignaturePad from "./SignaturePad";

interface FormEditorModalProps {
  form: OperationFormTemplate | null;
  onClose: () => void;
  onDownloadCompleted?: (formTitle: string, clientName: string) => void;
}

const PRESET_CLIENTS = [
  {
    label: "Rajesh Kumar (Resident Individual - Mumbai)",
    name: "Rajesh Kumar",
    pan: "ABCDE1234F",
    dob: "15/08/1985",
    mobile: "+91 98765 43210",
    email: "rajesh.kumar@example.com",
    taxStatus: "Resident Individual",
    address: "Flat 402, High Point Tower, Worli, Mumbai, Maharashtra 400018",
    ckyc: "10023456789012",
    folio: "1029384756",
    amc: "HDFC Mutual Fund",
    scheme: "HDFC Flexi Cap Fund - Growth",
  },
  {
    label: "Anita Sharma (NRI - Dubai, UAE)",
    name: "Anita Sharma",
    pan: "BNPKS8765M",
    dob: "24/11/1990",
    mobile: "+971 50 1234567",
    email: "anita.sharma@nri-invest.ae",
    taxStatus: "Non-Resident Indian (NRO)",
    address: "Villa 14, Palm Jumeirah, Dubai, United Arab Emirates",
    ckyc: "10098765432109",
    folio: "9081726354",
    amc: "ICICI Prudential Mutual Fund",
    scheme: "ICICI Prudential Bluechip Fund - Growth",
  },
  {
    label: "Vikram Mehta (HNI Client - Stallion PMS)",
    name: "Vikram Mehta",
    pan: "AAAPM9988K",
    dob: "05/03/1978",
    mobile: "+91 98200 11223",
    email: "vikram.mehta@enterprise.in",
    taxStatus: "Resident Individual",
    address: "Penthouse 32, Lodha Bellissimo, Mahalaxmi, Mumbai 400011",
    ckyc: "10045612378901",
    folio: "STALLION-PMS-8812",
    amc: "Stallion Asset Pvt Ltd",
    scheme: "Stallion Asset Core Fund (Multi-Cap PMS)",
  },
];

export default function FormEditorModal({ form, onClose, onDownloadCompleted }: FormEditorModalProps) {
  const [activeTab, setActiveTab] = useState<"client" | "details" | "signatures" | "preview">("client");
  const [downloading, setDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Common Client & Account Fields
  const [investorName, setInvestorName] = useState("Rajesh Kumar");
  const [pan, setPan] = useState("ABCDE1234F");
  const [dob, setDob] = useState("15/08/1985");
  const [mobile, setMobile] = useState("+91 98765 43210");
  const [email, setEmail] = useState("rajesh.kumar@example.com");
  const [taxStatus, setTaxStatus] = useState("Resident Individual");
  const [address, setAddress] = useState("Flat 402, High Point Tower, Worli, Mumbai 400018");
  const [ckyc, setCkyc] = useState("10023456789012");
  const [folioNumber, setFolioNumber] = useState("1029384756");
  const [amcName, setAmcName] = useState(form?.defaultAmc || "HDFC Mutual Fund");
  const [schemeName, setSchemeName] = useState(form?.defaultScheme || "HDFC Flexi Cap Fund - Growth");

  // Specific Dynamic Fields
  const [formDetails, setFormDetails] = useState<Record<string, string | boolean | number>>({});

  // Signatures
  const [signature1, setSignature1] = useState<string | null>(null);
  const [signature2, setSignature2] = useState<string | null>(null);
  const [includeJointSignature, setIncludeJointSignature] = useState(false);

  // Initialize specific fields from form template
  useEffect(() => {
    if (!form) return;
    const initial: Record<string, string | boolean | number> = {};
    form.specificFields.forEach((field) => {
      initial[field.id] = field.defaultValue !== undefined ? field.defaultValue : "";
    });
    setFormDetails(initial);
    if (form.defaultAmc) setAmcName(form.defaultAmc);
    if (form.defaultScheme) setSchemeName(form.defaultScheme);
  }, [form]);

  if (!form) return null;

  const handleApplyPreset = (index: number) => {
    const client = PRESET_CLIENTS[index];
    if (!client) return;
    setInvestorName(client.name);
    setPan(client.pan);
    setDob(client.dob);
    setMobile(client.mobile);
    setEmail(client.email);
    setTaxStatus(client.taxStatus);
    setAddress(client.address);
    setCkyc(client.ckyc);
    setFolioNumber(client.folio);
    setAmcName(client.amc);
    setSchemeName(client.scheme);
  };

  const handleFieldChange = (fieldId: string, value: string | boolean | number) => {
    setFormDetails((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  const handleDownloadVectorPdf = async () => {
    setDownloading(true);
    setErrorMessage(null);
    try {
      const payload = {
        form_id: form.id,
        title: form.title,
        repository: form.repository,
        category: form.category,
        form_code: form.formCode,
        investor_name: investorName,
        pan,
        dob,
        mobile,
        email,
        tax_status: taxStatus,
        ckyc,
        address,
        folio_number: folioNumber,
        amc_name: amcName,
        scheme_name: schemeName,
        details: formDetails,
        signature_base64: signature1,
        second_signature_base64: includeJointSignature ? signature2 : null,
      };

      const res = await fetch("/api/backoffice/operations/form-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Failed to generate PDF (Status ${res.status})`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = investorName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      a.download = `${form.repository.toLowerCase()}_${form.id}_${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      if (onDownloadCompleted) {
        onDownloadCompleted(form.title, investorName);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to download PDF. Try Direct Browser Print.";
      setErrorMessage(msg);
    } finally {
      setDownloading(false);
    }
  };

  const handleBrowserPrint = () => {
    window.print();
    if (onDownloadCompleted) {
      onDownloadCompleted(form.title, investorName);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-5xl h-[92vh] flex flex-col bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between bg-[#F7F9FB] dark:bg-[#171E27] shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-0.5 text-[11px] font-bold rounded uppercase tracking-wider ${
                form.repository === "CAMS"
                  ? "bg-[#E0F2FE] text-[#0369A1] dark:bg-[#075985]/30 dark:text-[#38BDF8]"
                  : form.repository === "Carvy"
                  ? "bg-[#FEF3C7] text-[#B45309] dark:bg-[#78350F]/30 dark:text-[#FBBF24]"
                  : "bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#581C87]/30 dark:text-[#C084FC]"
              }`}
            >
              {form.repository}
            </span>
            <div>
              <h2 className="text-[14px] font-bold text-[#172033] dark:text-[#EDF2F7] leading-tight">
                {form.title}
              </h2>
              <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                Form Code: <span className="font-mono text-[10px]">{form.formCode}</span> · ARN 345439 In-House Automated Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick CRM autofill selector */}
            <select
              aria-label="Autofill from CRM client preset"
              onChange={(e) => {
                const val = e.target.value;
                if (val !== "") handleApplyPreset(Number(val));
              }}
              defaultValue="0"
              className="text-[11px] font-medium h-7 px-2 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#006F64] dark:text-[#75E1CE] focus:outline-none"
            >
              <option value="" disabled>
                Autofill from CRM...
              </option>
              {PRESET_CLIENTS.map((c, i) => (
                <option key={c.label} value={i}>
                  CRM: {c.name} ({c.taxStatus})
                </option>
              ))}
            </select>

            <button
              onClick={onClose}
              className="p-1 rounded-lg text-[#536176] hover:text-[#172033] dark:text-[#A8B4C4] dark:hover:text-white hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Sub-Header Tabs */}
        <div className="px-5 border-b border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C] flex gap-2 shrink-0">
          <button
            onClick={() => setActiveTab("client")}
            className={`py-2 px-3 text-[12px] font-semibold border-b-2 transition-colors ${
              activeTab === "client"
                ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE]"
                : "border-transparent text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            1. Investor & Account
          </button>
          <button
            onClick={() => setActiveTab("details")}
            className={`py-2 px-3 text-[12px] font-semibold border-b-2 transition-colors ${
              activeTab === "details"
                ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE]"
                : "border-transparent text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            2. Request Specifics ({form.specificFields.length} fields)
          </button>
          <button
            onClick={() => setActiveTab("signatures")}
            className={`py-2 px-3 text-[12px] font-semibold border-b-2 transition-colors ${
              activeTab === "signatures"
                ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE]"
                : "border-transparent text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            3. Client Signatures
          </button>
          <button
            onClick={() => setActiveTab("preview")}
            className={`py-2 px-3 text-[12px] font-semibold border-b-2 transition-colors ${
              activeTab === "preview"
                ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE]"
                : "border-transparent text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            4. Live Document Preview & Download
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 bg-[#F8FAFC] dark:bg-[#0C1017]">
          {errorMessage && (
            <div className="mb-4 p-3 rounded-lg bg-[#FEE2E2] dark:bg-[#3D1418] border border-[#FCA5A5] dark:border-[#7F1D1D] text-[#991B1B] dark:text-[#FCA5A5] text-[12px]">
              {errorMessage}
            </div>
          )}

          {/* TAB 1: Client & Account Information */}
          {activeTab === "client" && (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div className="bg-[#FFFFFF] dark:bg-[#10151C] p-4 rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] space-y-4">
                <h3 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7] border-b border-[#E4E9EF] dark:border-[#2B3644] pb-2">
                  Primary Investor Identification (KYC / CKYC)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                      Investor Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={investorName}
                      onChange={(e) => setInvestorName(e.target.value)}
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                      Permanent Account Number (PAN) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())}
                      className="w-full h-8 px-2.5 uppercase font-mono bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">Date of Birth</label>
                    <input
                      type="text"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      placeholder="DD/MM/YYYY"
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">Tax Residency Status</label>
                    <select
                      value={taxStatus}
                      onChange={(e) => setTaxStatus(e.target.value)}
                      className="w-full h-8 px-2 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    >
                      <option value="Resident Individual">Resident Individual</option>
                      <option value="Non-Resident Indian (NRE)">Non-Resident Indian (NRE)</option>
                      <option value="Non-Resident Indian (NRO)">Non-Resident Indian (NRO)</option>
                      <option value="HUF">Hindu Undivided Family (HUF)</option>
                      <option value="Corporate / Partnership">Corporate / Partnership</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">Mobile Number</label>
                    <input
                      type="text"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">CKYC / KRA Number</label>
                    <input
                      type="text"
                      value={ckyc}
                      onChange={(e) => setCkyc(e.target.value)}
                      className="w-full h-8 px-2.5 font-mono bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">Registered Address</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                </div>
              </div>

              {/* Folio & Scheme Details */}
              <div className="bg-[#FFFFFF] dark:bg-[#10151C] p-4 rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] space-y-4">
                <h3 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7] border-b border-[#E4E9EF] dark:border-[#2B3644] pb-2">
                  Folio & Portfolio Strategy Details
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                      AMC / Strategy Provider
                    </label>
                    <input
                      type="text"
                      value={amcName}
                      onChange={(e) => setAmcName(e.target.value)}
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                      Folio / Demat / Custody Account No.
                    </label>
                    <input
                      type="text"
                      value={folioNumber}
                      onChange={(e) => setFolioNumber(e.target.value)}
                      className="w-full h-8 px-2.5 font-mono bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                      Scheme / Strategy Name
                    </label>
                    <input
                      type="text"
                      value={schemeName}
                      onChange={(e) => setSchemeName(e.target.value)}
                      className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                    />
                  </div>
                </div>
              </div>

              {/* ARN Stamp Box */}
              <div className="bg-[#E7F5F2] dark:bg-[#1A3034] p-3.5 rounded-xl border border-[#006F64]/30 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#006F64] dark:text-[#75E1CE]">Distributor Stamp:</span>
                  <span className="text-[#172033] dark:text-[#EDF2F7]">Fund Horizon (ARN 345439)</span>
                  <span className="text-[#536176] dark:text-[#A8B4C4]">· EUIN E482910</span>
                </div>
                <span className="text-[#006F64] dark:text-[#75E1CE] font-semibold text-[10px] uppercase bg-white dark:bg-[#10151C] px-2 py-0.5 rounded">
                  In-House Automated
                </span>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[#006F64] text-white hover:bg-[#005a52] transition"
                >
                  Proceed to Request Details →
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Specific Request Details */}
          {activeTab === "details" && (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div className="bg-[#FFFFFF] dark:bg-[#10151C] p-4 rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] space-y-4">
                <div className="border-b border-[#E4E9EF] dark:border-[#2B3644] pb-2">
                  <h3 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7]">
                    Specific Request Fields: {form.title}
                  </h3>
                  <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                    Customize the exact parameters for this automated {form.repository} filing.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[12px]">
                  {form.specificFields.map((field) => {
                    const val = formDetails[field.id];
                    return (
                      <div key={field.id} className={field.type === "textarea" ? "sm:col-span-2" : ""}>
                        <label className="block font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                          {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>

                        {field.type === "select" ? (
                          <select
                            value={String(val ?? "")}
                            onChange={(e) => handleFieldChange(field.id, e.target.value)}
                            className="w-full h-8 px-2 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                          >
                            {field.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : field.type === "textarea" ? (
                          <textarea
                            rows={3}
                            value={String(val ?? "")}
                            onChange={(e) => handleFieldChange(field.id, e.target.value)}
                            placeholder={field.placeholder}
                            className="w-full p-2 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                          />
                        ) : field.type === "checkbox" ? (
                          <label className="flex items-center gap-2 mt-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(val)}
                              onChange={(e) => handleFieldChange(field.id, e.target.checked)}
                              className="rounded text-[#006F64] focus:ring-0"
                            />
                            <span className="text-[#172033] dark:text-[#EDF2F7] text-[12px]">Confirm selection</span>
                          </label>
                        ) : (
                          <input
                            type={field.type}
                            value={typeof val === "boolean" ? "" : (val ?? "")}
                            onChange={(e) => handleFieldChange(field.id, e.target.value)}
                            placeholder={field.placeholder}
                            className="w-full h-8 px-2.5 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Declarations list */}
              <div className="bg-[#FFFFFF] dark:bg-[#10151C] p-4 rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] space-y-2">
                <h4 className="text-[12px] font-bold text-[#172033] dark:text-[#EDF2F7]">Regulatory Declarations</h4>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                  {form.declarations.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setActiveTab("client")}
                  className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium text-[#536176] dark:text-[#A8B4C4] hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition"
                >
                  ← Back to Investor
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("signatures")}
                  className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[#006F64] text-white hover:bg-[#005a52] transition"
                >
                  Proceed to Signatures →
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Signatures */}
          {activeTab === "signatures" && (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div className="bg-[#FFFFFF] dark:bg-[#10151C] p-4 rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] space-y-4">
                <div className="border-b border-[#E4E9EF] dark:border-[#2B3644] pb-2">
                  <h3 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7]">
                    In-House Client Digital Signature
                  </h3>
                  <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                    The client signature will be rendered directly onto the official {form.repository} filing document.
                  </p>
                </div>

                {/* Primary Holder Signature Pad */}
                <SignaturePad
                  label={`Sole / Primary Applicant Signature: ${investorName}`}
                  subLabel="Use touch/mouse to sign or switch to Type mode"
                  signatureData={signature1}
                  onChange={setSignature1}
                  required
                />

                {/* Joint Holder Toggle */}
                <div className="pt-2 border-t border-[#E4E9EF] dark:border-[#2B3644]">
                  <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-[#172033] dark:text-[#EDF2F7]">
                    <input
                      type="checkbox"
                      checked={includeJointSignature}
                      onChange={(e) => setIncludeJointSignature(e.target.checked)}
                      className="rounded text-[#006F64] focus:ring-0"
                    />
                    Add Second Holder / Joint Investor / Guardian Signature
                  </label>
                </div>

                {includeJointSignature && (
                  <SignaturePad
                    label="Joint Holder / Guardian Signature"
                    subLabel="Draw or type joint applicant signature"
                    signatureData={signature2}
                    onChange={setSignature2}
                  />
                )}
              </div>

              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium text-[#536176] dark:text-[#A8B4C4] hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition"
                >
                  ← Back to Details
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[#006F64] text-white hover:bg-[#005a52] transition"
                >
                  Generate Official Preview →
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: Live Document Preview & Direct Download */}
          {activeTab === "preview" && (
            <div className="space-y-4 max-w-4xl mx-auto">
              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[#FFFFFF] dark:bg-[#10151C] rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] shadow-xs">
                <div>
                  <div className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7]">
                    Document Ready for Direct Download
                  </div>
                  <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                    100% in-house vector PDF generation with ARN 345439 verification and client signature.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBrowserPrint}
                    className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] text-[#172033] dark:text-[#EDF2F7] hover:bg-[#F1F5F9] dark:hover:bg-[#1A232E] transition flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Browser Print
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadVectorPdf}
                    disabled={downloading}
                    className="px-4 py-1.5 text-[12px] font-semibold rounded-lg bg-[#006F64] text-white hover:bg-[#005a52] disabled:opacity-50 transition flex items-center gap-1.5 shadow-sm"
                  >
                    {downloading ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Rendering Vector PDF…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Direct Download PDF
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Exact In-House Form Document Sheet */}
              <div
                id="printable-operations-form"
                className="bg-white text-[#0B2545] p-8 rounded-xl border border-[#CBD5E1] shadow-md space-y-4 max-w-3xl mx-auto"
                style={{ minHeight: "800px" }}
              >
                {/* Official Document Top Banner */}
                <div className="border-b-2 border-[#006F64] pb-3 flex items-start justify-between">
                  <div>
                    <div className="text-[16px] font-extrabold tracking-tight text-[#0B2545]">
                      FUND HORIZON · OPERATIONS
                    </div>
                    <div className="text-[10px] text-[#536176]">
                      AMFI Registered Mutual Fund Distributor · ARN 345439 · EUIN E482910
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#E7F5F2] text-[#006F64] border border-[#006F64]/30">
                      RTA / Master: {form.repository}
                    </span>
                    <div className="text-[9px] text-[#64748B] mt-0.5">Ref: {form.formCode}</div>
                  </div>
                </div>

                {/* Form Title & Barcode Representation */}
                <div className="bg-[#F1F5F9] p-3 rounded-lg flex items-center justify-between border border-[#E2E8F0]">
                  <div>
                    <h1 className="text-[13px] font-bold text-[#0B2545] uppercase">{form.title}</h1>
                    <p className="text-[10px] text-[#64748B]">Category: {form.category.toUpperCase()} · Live Operational Record</p>
                  </div>
                  {/* Faux Barcode */}
                  <div className="flex flex-col items-end">
                    <div className="flex gap-[2px] h-6 items-end">
                      {[3, 1, 4, 1, 5, 2, 4, 1, 3, 2, 5, 1, 2, 4, 1, 3, 2, 4, 1].map((w, idx) => (
                        <div key={idx} className="bg-[#0B2545] h-full" style={{ width: `${w}px` }} />
                      ))}
                    </div>
                    <span className="text-[8px] font-mono text-[#64748B]">{form.formCode}-2026</span>
                  </div>
                </div>

                {/* Section 1: Investor Identification */}
                <div>
                  <div className="bg-[#0B2545] text-white px-2.5 py-1 text-[10px] font-bold uppercase rounded-t">
                    1. Investor Identification & KYC
                  </div>
                  <div className="border border-[#CBD5E1] border-t-0 p-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-[#64748B] block text-[9px]">Primary Investor Name:</span>
                      <strong className="text-[#0B2545] text-[11px]">{investorName}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[9px]">Permanent Account Number (PAN):</span>
                      <strong className="text-[#0B2545] font-mono text-[11px]">{pan}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[9px]">Date of Birth / Tax Status:</span>
                      <span>
                        {dob} · {taxStatus}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[9px]">Contact Details:</span>
                      <span>
                        {mobile} · {email}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[#64748B] block text-[9px]">Registered Address & CKYC:</span>
                      <span>
                        {address} (CKYC: {ckyc || "Pending"})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Account / Folio Information */}
                <div>
                  <div className="bg-[#0B2545] text-white px-2.5 py-1 text-[10px] font-bold uppercase rounded-t">
                    2. Folio & Portfolio Information
                  </div>
                  <div className="border border-[#CBD5E1] border-t-0 p-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-[#64748B] block text-[9px]">AMC / Strategy Manager:</span>
                      <strong className="text-[#0B2545]">{amcName}</strong>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[9px]">Folio / Demat Number:</span>
                      <strong className="text-[#0B2545] font-mono">{folioNumber}</strong>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[#64748B] block text-[9px]">Scheme / PMS Strategy:</span>
                      <span>{schemeName}</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Specific Changes / Parameters */}
                <div>
                  <div className="bg-[#0B2545] text-white px-2.5 py-1 text-[10px] font-bold uppercase rounded-t">
                    3. Request Particulars & Parameters
                  </div>
                  <div className="border border-[#CBD5E1] border-t-0 p-3 grid grid-cols-2 gap-2 text-[10px]">
                    {Object.entries(formDetails).map(([key, val]) => (
                      <div key={key}>
                        <span className="text-[#64748B] block text-[9px]">
                          {key.replace(/_+/g, " ").toUpperCase()}:
                        </span>
                        <strong className="text-[#0B2545]">{String(val || "-")}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 4: Investor Declaration */}
                <div className="bg-[#F8FAFC] border border-[#CBD5E1] p-2.5 rounded text-[9px] text-[#475569] leading-tight">
                  <div className="font-bold text-[#0B2545] mb-0.5">Investor Declaration:</div>
                  I/We confirm that the information furnished herein is complete and true. I authorize Fund Horizon (ARN 345439)
                  and {form.repository} to execute this transaction/service update in accordance with SEBI / AMFI guidelines.
                </div>

                {/* Section 5: Signature Blocks */}
                <div className="grid grid-cols-3 gap-3 pt-2">
                  {/* Primary Signature */}
                  <div className="border border-[#CBD5E1] rounded p-2 text-center flex flex-col justify-between h-28 bg-[#FFFFFF]">
                    <div className="text-[9px] font-bold text-[#0B2545]">Sole / First Applicant</div>
                    <div className="flex-1 flex items-center justify-center my-1">
                      {signature1 ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={signature1} alt="Signature 1" className="max-h-14 max-w-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-[#94A3B8] italic">[Sign Above]</span>
                      )}
                    </div>
                    <div className="text-[8px] text-[#64748B] border-t border-dashed border-[#CBD5E1] pt-1">
                      {investorName}
                    </div>
                  </div>

                  {/* Joint Signature */}
                  <div className="border border-[#CBD5E1] rounded p-2 text-center flex flex-col justify-between h-28 bg-[#FFFFFF]">
                    <div className="text-[9px] font-bold text-[#0B2545]">Joint Applicant / Guardian</div>
                    <div className="flex-1 flex items-center justify-center my-1">
                      {signature2 ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={signature2} alt="Signature 2" className="max-h-14 max-w-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-[#94A3B8] italic">[Single / N/A]</span>
                      )}
                    </div>
                    <div className="text-[8px] text-[#64748B] border-t border-dashed border-[#CBD5E1] pt-1">
                      Second Holder Signature
                    </div>
                  </div>

                  {/* Distributor ARN Verification Stamp */}
                  <div className="border border-[#006F64] rounded p-2 text-center flex flex-col justify-between h-28 bg-[#E7F5F2]/40">
                    <div className="text-[9px] font-bold text-[#006F64]">DISTRIBUTOR ARN STAMP</div>
                    <div className="my-auto text-[9px] text-[#0B2545] font-semibold space-y-0.5">
                      <div>FUND HORIZON</div>
                      <div className="font-mono text-[10px] text-[#006F64]">ARN-345439</div>
                      <div className="text-[8px] text-[#536176]">EUIN: E482910</div>
                    </div>
                    <div className="text-[8px] text-[#006F64] border-t border-[#006F64]/30 pt-1 font-semibold">
                      VERIFIED & AUTHORIZED
                    </div>
                  </div>
                </div>

                <div className="text-[8px] text-[#94A3B8] text-center pt-2">
                  System Generated Form by Fund Horizon Operations Engine · In-House Archival Copy
                </div>
              </div>

              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setActiveTab("signatures")}
                  className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium text-[#536176] dark:text-[#A8B4C4] hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition"
                >
                  ← Edit Signatures
                </button>
                <button
                  type="button"
                  onClick={handleDownloadVectorPdf}
                  disabled={downloading}
                  className="px-5 py-2 text-[13px] font-bold rounded-xl bg-[#006F64] text-white hover:bg-[#005a52] transition shadow-md flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Client-Ready PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
