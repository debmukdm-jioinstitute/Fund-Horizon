"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { AmcLogo } from "@/components/BrandLogo";
import InfoTip from "@/components/InfoTip";
import {
  screenPortfolioPdf,
  resolvePortfolioHolding,
  askAiAboutFund,
  type AskAiResult,
  type PortfolioHolding,
  type PortfolioScreenResponse,
  type PortfolioHoldingCandidate,
} from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

interface Props {
  onBackToScreener: () => void;
}

const formatCurrency = (val: number | null | undefined): string => {
  if (val === null || val === undefined || isNaN(val)) return "—";
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`;
  return `₹${formatNumber(val, 0)}`;
};

export default function MfPortfolioScreen({ onBackToScreener }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PortfolioScreenResponse | null>(null);

  // Filters
  const [signalFilter, setSignalFilter] = useState<string>("all");
  const [reviewFilter, setReviewFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [ai, setAi] = useState<Record<string, { loading: boolean; error?: string; result?: AskAiResult }>>({});

  const askAi = async (h: PortfolioHolding) => {
    if (!h.amfi_code) return;
    setAi((m) => ({ ...m, [h.id]: { loading: true } }));
    try {
      const result = await askAiAboutFund(h.amfi_code, h.portfolio_weight_pct);
      setAi((m) => ({ ...m, [h.id]: { loading: false, result } }));
    } catch (e) {
      setAi((m) => ({ ...m, [h.id]: { loading: false, error: e instanceof Error ? e.message : "AI analysis failed" } }));
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a valid PDF portfolio statement.");
      return;
    }
    setFile(selectedFile);
    setError(null);
    setData(null);
    setNeedPassword(false);
  };

  const handleUploadAndScreen = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!file) {
      setError("Please choose a portfolio statement PDF first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await screenPortfolioPdf(file, password);
      setData(res);
      setNeedPassword(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to parse and screen portfolio.";
      if (msg.toLowerCase().includes("password")) {
        setNeedPassword(true);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCandidateResolve = async (holding: PortfolioHolding, candidate: PortfolioHoldingCandidate) => {
    setResolvingId(holding.id);
    try {
      const resolved = await resolvePortfolioHolding({
        code: candidate.code,
        raw_name: holding.raw_name,
        statement_value: holding.statement_value,
        total_value: data?.summary?.total_value,
      });

      if (data) {
        const updatedHoldings = data.holdings.map((h) => (h.id === holding.id ? { ...h, ...resolved } : h));
        const matchedCnt = updatedHoldings.filter((h) => h.match_type !== "unmatched" && h.match_type !== "ambiguous").length;
        const reviewCnt = updatedHoldings.filter((h) => h.fh_signal === "Needs review").length;
        const buyCnt = updatedHoldings.filter((h) => h.fh_signal === "Buy").length;
        const holdCnt = updatedHoldings.filter((h) => h.fh_signal === "Hold").length;
        const sellCnt = updatedHoldings.filter((h) => h.fh_signal === "Sell").length;

        setData({
          ...data,
          holdings: updatedHoldings,
          summary: {
            ...data.summary,
            matched_count: matchedCnt,
            needs_review_count: reviewCnt,
            buy_count: buyCnt,
            hold_count: holdCnt,
            sell_count: sellCnt,
          },
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to resolve holding.");
    } finally {
      setResolvingId(null);
    }
  };

  // Filtered holdings list
  const holdings = data?.holdings || [];
  const filteredHoldings = holdings.filter((h) => {
    if (signalFilter !== "all" && h.fh_signal !== signalFilter) return false;
    if (reviewFilter === "matched" && (h.match_type === "unmatched" || h.match_type === "ambiguous")) return false;
    if (reviewFilter === "needs_review" && h.fh_signal !== "Needs review") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (h.canonical_name || "").toLowerCase().includes(q) || h.raw_name.toLowerCase().includes(q);
      const matchCode = (h.amfi_code || "").includes(q) || (h.isin || "").toLowerCase().includes(q);
      if (!matchName && !matchCode) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 pb-12 font-sans">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E5E5] dark:border-[#2B3644] pb-4">
        <div>
          <button
            type="button"
            onClick={onBackToScreener}
            className="text-[13px] font-semibold text-[#0176D3] dark:text-[#1B96FF] hover:underline flex items-center gap-1 mb-1.5"
          >
            ← Back to Mutual Fund Screener
          </button>
          <h1 className="text-[26px] font-bold text-[#181818] dark:text-[#EDF2F7] tracking-tight">
            Portfolio Screening
          </h1>
          <p className="text-[14px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
            Upload client statement (CAMS, KFintech, CDSL, NSDL CAS) for instant FH scores, stars, Buy/Hold/Sell signals &amp; reasons.
          </p>
        </div>
        {data && (
          <button
            type="button"
            onClick={() => {
              setData(null);
              setFile(null);
              setPassword("");
            }}
            className="self-start rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-3.5 py-2 text-[13px] font-semibold text-[#181818] dark:text-[#EDF2F7] hover:border-[#0176D3]"
          >
            Upload Another Statement
          </button>
        )}
      </div>

      {/* Upload Zone when no data */}
      {!data && (
        <div className="rounded-2xl border border-dashed border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#131B26] p-6 sm:p-10 text-center max-w-2xl mx-auto shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] mb-4">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>

          <h2 className="text-[18px] font-bold text-[#181818] dark:text-[#EDF2F7]">
            Upload client portfolio statement
          </h2>
          <p className="text-[13.5px] text-[#706E6B] dark:text-[#A8B4C4] mt-1 max-w-md mx-auto">
            Supports CAS statements (CAMS, KFintech, CDSL, NSDL) and distributor/broker portfolio reports. Statements are processed strictly in memory and never stored.
          </p>

          <form onSubmit={handleUploadAndScreen} className="mt-6 space-y-4 max-w-md mx-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />

            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border border-[#0176D3] bg-[#EAF5FE] dark:bg-[#11304F] py-3 text-[14px] font-bold text-[#0176D3] dark:text-[#1B96FF] hover:bg-[#D5EBFE] transition"
              >
                Choose PDF Statement
              </button>
            ) : (
              <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-[#F8FAFC] dark:bg-[#171E27] p-3 text-left flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="block text-[13.5px] font-bold text-[#181818] dark:text-[#EDF2F7] truncate">
                    {file.name}
                  </span>
                  <span className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setError(null);
                  }}
                  className="text-[12px] font-semibold text-[#B42332] dark:text-[#FF7D86] hover:underline"
                >
                  Change
                </button>
              </div>
            )}

            {(needPassword || file) && (
              <div className="text-left space-y-1">
                <label className="text-[12px] font-bold text-[#706E6B] dark:text-[#A8B4C4] uppercase tracking-wider">
                  PDF Password {needPassword && <span className="text-[#B42332]">* Required</span>}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter PAN or statement password (if encrypted)"
                  className="w-full rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-3 py-2 text-[13.5px] text-[#181818] dark:text-[#EDF2F7]"
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-[#FEF3F2] dark:bg-[#331114] border border-[#FECDCA] dark:border-[#7A271A] p-3 text-[13px] text-[#B42318] dark:text-[#FDA29B] text-left">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !file}
              className="w-full rounded-xl bg-[#0176D3] hover:bg-[#014486] py-3 text-[14px] font-bold text-white transition disabled:opacity-50 shadow-sm"
            >
              {loading ? "Analyzing and Screening Portfolio..." : "Screen Portfolio Holdings"}
            </button>
          </form>
        </div>
      )}

      {/* Screened Results View */}
      {data && (
        <div className="space-y-6">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                Statement Value
              </div>
              <div className="text-[19px] font-bold text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                {formatCurrency(data.summary.total_value)}
              </div>
              {data.summary.statement_date && (
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                  As of {data.summary.statement_date}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                Total Holdings
              </div>
              <div className="text-[19px] font-bold text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                {data.summary.holdings_count}
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                {data.summary.matched_count} matched
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#027A48] dark:text-[#75E1CE]">
                Buy Signal
              </div>
              <div className="text-[19px] font-bold text-[#027A48] dark:text-[#75E1CE] mt-0.5">
                {data.summary.buy_count}
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                4-5 star rated
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#B54708] dark:text-[#FDB022]">
                Hold Signal
              </div>
              <div className="text-[19px] font-bold text-[#B54708] dark:text-[#FDB022] mt-0.5">
                {data.summary.hold_count}
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                3 star rated
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#B42318] dark:text-[#FDA29B]">
                Sell Signal
              </div>
              <div className="text-[19px] font-bold text-[#B42318] dark:text-[#FDA29B] mt-0.5">
                {data.summary.sell_count}
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                1-2 star rated
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#475467] dark:text-[#98A2B3]">
                Needs Review
              </div>
              <div className="text-[19px] font-bold text-[#475467] dark:text-[#98A2B3] mt-0.5">
                {data.summary.needs_review_count}
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                IDCW, ambiguous, unverified
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                Screening As Of
              </div>
              <div className="text-[15px] font-bold text-[#181818] dark:text-[#EDF2F7] mt-1.5 truncate">
                {data.summary.screening_date || "Latest NAV"}
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                AMFI / mfapi.in
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-bold text-[#706E6B] dark:text-[#A8B4C4] uppercase mr-1">
                Signal:
              </span>
              {[
                ["all", "All"],
                ["Buy", "Buy"],
                ["Hold", "Hold"],
                ["Sell", "Sell"],
                ["Needs review", "Needs review"],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSignalFilter(k)}
                  className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold transition ${
                    signalFilter === k
                      ? "bg-[#0176D3] text-white"
                      : "bg-[#F4F6F8] dark:bg-[#10151C] text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
                  }`}
                >
                  {lbl}
                </button>
              ))}

              <span className="text-[#E5E5E5] dark:text-[#2B3644] mx-1">|</span>

              <span className="text-[12px] font-bold text-[#706E6B] dark:text-[#A8B4C4] uppercase mr-1">
                Match:
              </span>
              {[
                ["all", "All"],
                ["matched", "Matched"],
                ["needs_review", "Unmatched / Review"],
              ].map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setReviewFilter(k)}
                  className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold transition ${
                    reviewFilter === k
                      ? "bg-[#0176D3] text-white"
                      : "bg-[#F4F6F8] dark:bg-[#10151C] text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="w-full sm:w-64">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search holding or ISIN..."
                className="w-full rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] px-3 py-1.5 text-[13px] text-[#181818] dark:text-[#EDF2F7]"
              />
            </div>
          </div>

          {/* Results Table */}
          <div className="rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] overflow-x-auto shadow-sm">
            <table className="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-[#E5E5E5] dark:border-[#2B3644] bg-[#F8FAFC] dark:bg-[#131B26]">
                  <th className="py-3 px-4 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Fund &amp; Scheme
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    <div className="flex items-center gap-1">
                      Category / Plan
                      <InfoTip metric="benchmark" />
                    </div>
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] text-right">
                    Statement Value
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] text-right">
                    Weight
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] text-center">
                    <div className="flex items-center justify-center gap-1">
                      FH Score / 100
                      <InfoTip metric="fh_score" />
                    </div>
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] text-center">
                    <div className="flex items-center justify-center gap-1">
                      FH Rating / 5★
                      <InfoTip metric="fh_rating" />
                    </div>
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    <div className="flex items-center gap-1">
                      FH Signal
                      <InfoTip metric="fh_signal" />
                    </div>
                  </th>
                  <th className="py-3 px-4 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Screening Evidence
                  </th>
                  <th className="py-3 px-3 font-bold text-[12px] uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E5] dark:divide-[#2B3644]">
                {filteredHoldings.map((h) => {
                  const isExpanded = expandedRow === h.id;
                  const signalStyle =
                    h.fh_signal === "Buy"
                      ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                      : h.fh_signal === "Hold"
                      ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                      : h.fh_signal === "Sell"
                      ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                      : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]";

                  return (
                    <React.Fragment key={h.id}>
                      <tr className="hover:bg-[#F8FAFC] dark:hover:bg-[#1B2432]/60 transition-colors">
                        {/* Scheme Name & Identification */}
                        <td className="py-3.5 px-4 align-top max-w-[320px]">
                          <div className="flex items-start gap-2.5">
                            {h.amc && <AmcLogo amc={h.amc} className="h-6 min-w-6 max-w-[2.5rem] mt-0.5 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-bold text-[#181818] dark:text-[#EDF2F7] leading-snug">
                                {h.canonical_name ? (
                                  <Link
                                    href={`/backoffice/mutual-funds/${h.amfi_code}`}
                                    className="hover:text-[#0176D3] dark:hover:text-[#1B96FF] hover:underline"
                                  >
                                    {h.canonical_name}
                                  </Link>
                                ) : (
                                  h.raw_name
                                )}
                              </div>
                              {h.canonical_name && h.canonical_name !== h.raw_name && (
                                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] truncate" title={`Statement: ${h.raw_name}`}>
                                  Stmt: {h.raw_name}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-1">
                                {h.isin && <span className="font-mono bg-[#F2F4F7] dark:bg-[#1B2432] px-1.5 py-0.5 rounded">{h.isin}</span>}
                                {h.folio && <span>Folio: {h.folio}</span>}
                                {h.units && <span>· {formatNumber(h.units, 2)} units</span>}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Category & Plan */}
                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <div className="font-semibold text-[#181818] dark:text-[#EDF2F7]">{h.category || "—"}</div>
                          <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                            {h.plan || "—"} · {h.option || "Growth"}
                          </div>
                          {h.benchmark && (
                            <div className="text-[11px] text-[#0176D3] dark:text-[#1B96FF] mt-0.5 truncate max-w-[200px]" title={`SEBI Benchmark: ${h.benchmark}`}>
                              Bench: {h.benchmark}
                            </div>
                          )}
                        </td>

                        {/* Statement Value */}
                        <td className="py-3.5 px-3 align-top text-right tabular-nums">
                          <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                            {formatCurrency(h.statement_value)}
                          </div>
                          {h.statement_nav && (
                            <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                              NAV ₹{h.statement_nav.toFixed(2)}
                            </div>
                          )}
                        </td>

                        {/* Portfolio Weight */}
                        <td className="py-3.5 px-3 align-top text-right tabular-nums font-semibold text-[#181818] dark:text-[#EDF2F7]">
                          {h.portfolio_weight_pct != null ? `${h.portfolio_weight_pct.toFixed(1)}%` : "—"}
                        </td>

                        {/* FH Score */}
                        <td className="py-3.5 px-3 align-top text-center tabular-nums">
                          {h.fh_score != null ? (
                            <div className="inline-flex flex-col items-center">
                              <span className="font-bold text-[14.5px] text-[#181818] dark:text-[#EDF2F7]">
                                {Math.round(h.fh_score)}
                                <span className="text-[11px] font-normal text-[#706E6B] dark:text-[#A8B4C4]"> / 100</span>
                              </span>
                            </div>
                          ) : (
                            <span className="text-[#98A2B3]">—</span>
                          )}
                        </td>

                        {/* FH Star Rating */}
                        <td className="py-3.5 px-3 align-top text-center">
                          {h.fh_rating != null ? (
                            <div className="inline-flex flex-col items-center">
                              <span className="font-bold text-[#D97706] text-[13.5px]">
                                {"★".repeat(Math.round(h.fh_rating))}
                              </span>
                              <span className="text-[11px] font-semibold text-[#706E6B] dark:text-[#A8B4C4]">
                                {Math.round(h.fh_rating)} / 5
                              </span>
                            </div>
                          ) : (
                            <span className="text-[#98A2B3]">—</span>
                          )}
                        </td>

                        {/* Signal Badge */}
                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold ${signalStyle}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {h.fh_signal}
                          </span>
                        </td>

                        {/* Concise Reasons */}
                        <td className="py-3.5 px-4 align-top max-w-[280px]">
                          <ul className="space-y-1 text-[12.5px] leading-tight text-[#344054] dark:text-[#D0D5DD]">
                            {h.fh_signal_reasons && h.fh_signal_reasons.length > 0 ? (
                              h.fh_signal_reasons.map((r, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <span className="text-[#0176D3] dark:text-[#1B96FF] mt-0.5">•</span>
                                  <span>{r}</span>
                                </li>
                              ))
                            ) : (
                              <li className="text-[#706E6B] dark:text-[#A8B4C4]">No screening reasons available</li>
                            )}
                          </ul>
                        </td>

                        {/* Action buttons */}
                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedRow(isExpanded ? null : h.id)}
                            className="text-[12px] font-semibold text-[#0176D3] dark:text-[#1B96FF] hover:underline block"
                          >
                            {isExpanded ? "Hide details" : "Why this signal?"}
                          </button>
                          {h.detail_path && (
                            <Link
                              href={h.detail_path}
                              className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] hover:underline block mt-1"
                            >
                              Fund detail →
                            </Link>
                          )}
                          {h.amfi_code && (
                            <button
                              type="button"
                              onClick={() => askAi(h)}
                              disabled={ai[h.id]?.loading}
                              className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#0176D3] px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#014486] disabled:opacity-60"
                            >
                              {ai[h.id]?.loading ? "Thinking…" : ai[h.id]?.result ? "Ask AI again" : "Ask AI"}
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Expandable detail row */}
                      {isExpanded && (
                        <tr className="bg-[#F8FAFC] dark:bg-[#131B26]">
                          <td colSpan={9} className="p-4 border-t border-dotted border-[#E5E5E5] dark:border-[#2B3644]">
                            <div className="space-y-3 max-w-4xl">
                              <div className="flex flex-wrap items-center justify-between text-[12px] text-[#706E6B] dark:text-[#A8B4C4] border-b border-[#E5E5E5] dark:border-[#2B3644] pb-2">
                                <div>
                                  <b>Identification:</b> Match type:{" "}
                                  <span className="font-semibold text-[#181818] dark:text-[#EDF2F7]">
                                    {h.match_type.replace("_", " ")}
                                  </span>{" "}
                                  · Statement valuation date:{" "}
                                  <span className="font-semibold text-[#181818] dark:text-[#EDF2F7]">
                                    {h.valuation_date || "Not recorded"}
                                  </span>
                                  {h.benchmark && (
                                    <span>
                                      {" "}· Category Benchmark:{" "}
                                      <span className="font-semibold text-[#0176D3] dark:text-[#1B96FF]">
                                        {h.benchmark}
                                      </span>
                                    </span>
                                  )}
                                </div>
                                <div>
                                  Screening metrics date:{" "}
                                  <span className="font-semibold text-[#181818] dark:text-[#EDF2F7]">
                                    {h.data_as_of || "Latest NAV"}
                                  </span>
                                </div>
                              </div>

                              {/* Underlying Metrics Grid */}
                              {h.underlying_metrics && (
                                <div>
                                  <div className="text-[11.5px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] mb-1.5 flex items-center gap-1.5">
                                    <span>Underlying Metric Contributions &amp; Calculations</span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-[12.5px]">
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>Sortino 3Y</span>
                                        <InfoTip metric="sortino_3y" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.sortino_3y != null ? h.underlying_metrics.sortino_3y.toFixed(2) : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>Sharpe 3Y</span>
                                        <InfoTip metric="sharpe_3y" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.sharpe_3y != null ? h.underlying_metrics.sharpe_3y.toFixed(2) : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>3Y vs Cat</span>
                                        <InfoTip metric="out_3y" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.out_3y != null ? `${h.underlying_metrics.out_3y > 0 ? "+" : ""}${h.underlying_metrics.out_3y.toFixed(1)}%` : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>1Y vs Cat</span>
                                        <InfoTip metric="out_1y" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.out_1y != null ? `${h.underlying_metrics.out_1y > 0 ? "+" : ""}${h.underlying_metrics.out_1y.toFixed(1)}%` : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>3Y CAGR</span>
                                        <InfoTip metric="cagr_3y" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.cagr_3y != null ? `${h.underlying_metrics.cagr_3y.toFixed(1)}%` : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>Tenure</span>
                                        <InfoTip metric="manager_tenure" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.manager_tenure_years != null ? `${h.underlying_metrics.manager_tenure_years.toFixed(1)}y` : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>Expense</span>
                                        <InfoTip metric="ter" />
                                      </div>
                                      <div className="font-bold text-[#181818] dark:text-[#EDF2F7]">
                                        {h.underlying_metrics.ter != null ? `${h.underlying_metrics.ter.toFixed(2)}%` : "—"}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white dark:bg-[#171E27] p-2 border border-[#E5E5E5] dark:border-[#2B3644]">
                                      <div className="flex items-center justify-center gap-1 text-[#706E6B] dark:text-[#A8B4C4] text-[11px]">
                                        <span>Benchmark</span>
                                        <InfoTip metric="benchmark" />
                                      </div>
                                      <div className="font-bold text-[11px] text-[#0176D3] dark:text-[#1B96FF] truncate" title={h.benchmark || "SEBI TRI"}>
                                        {h.benchmark ? h.benchmark.replace(" Total Return Index", " TRI") : "SEBI TRI"}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Candidate Resolution for Ambiguous Match */}
                              {h.candidates && h.candidates.length > 0 && (
                                <div className="rounded-xl border border-[#FEDF89] dark:border-[#7A541A] bg-[#FFFAEB] dark:bg-[#2D2006] p-3.5 space-y-2">
                                  <div className="text-[13px] font-bold text-[#B54708] dark:text-[#FDB022]">
                                    Staff Resolution Needed: Select the matching AMFI Scheme
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {h.candidates.map((c) => (
                                      <div
                                        key={c.code}
                                        className="rounded-lg bg-white dark:bg-[#171E27] p-2.5 border border-[#FEDF89] dark:border-[#7A541A] flex items-center justify-between gap-2"
                                      >
                                        <div className="min-w-0">
                                          <div className="font-bold text-[13px] text-[#181818] dark:text-[#EDF2F7] truncate">
                                            {c.name}
                                          </div>
                                          <div className="text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                                            {c.plan} · {c.cat_label} · Score: {c.fh_score ?? "—"} ({c.fh_signal ?? "No signal"})
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={resolvingId === h.id}
                                          onClick={() => handleCandidateResolve(h, c)}
                                          className="shrink-0 rounded bg-[#0176D3] hover:bg-[#014486] px-2.5 py-1 text-[11.5px] font-bold text-white transition disabled:opacity-50"
                                        >
                                          {resolvingId === h.id ? "Assigning..." : "Assign"}
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      {(ai[h.id]?.result || ai[h.id]?.error) && (
                        <tr className="bg-[#F8FAFC] dark:bg-[#131B26]">
                          <td colSpan={9} className="p-4 border-t border-dotted border-[#E5E5E5] dark:border-[#2B3644]">
                            {ai[h.id]?.error ? (
                              <div className="text-[13px] text-[#BA0517] dark:text-[#FF8A8A]">{ai[h.id]?.error}</div>
                            ) : (
                              ai[h.id]?.result && (
                                <div className="max-w-4xl space-y-2 text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11.5px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">AI view</span>
                                    <span className="rounded-full border border-[#0176D3] px-2.5 py-0.5 text-[12px] font-bold text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF]">
                                      {ai[h.id]!.result!.stance}
                                      {ai[h.id]!.result!.confidence ? ` · ${ai[h.id]!.result!.confidence} confidence` : ""}
                                    </span>
                                  </div>
                                  {ai[h.id]!.result!.summary && <p>{ai[h.id]!.result!.summary}</p>}
                                  {([["Reasons", ai[h.id]!.result!.reasons], ["Market context", ai[h.id]!.result!.market_context], ["Risks", ai[h.id]!.result!.risks]] as const).map(
                                    ([title, items]) =>
                                      items && items.length > 0 ? (
                                        <div key={title}>
                                          <div className="text-[11.5px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">{title}</div>
                                          <ul className="list-disc pl-5">
                                            {items.map((t, i) => (
                                              <li key={i}>{t}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : null,
                                  )}
                                  {ai[h.id]!.result!.what_would_change_view && (
                                    <p>
                                      <b>What would change this view:</b> {ai[h.id]!.result!.what_would_change_view}
                                    </p>
                                  )}
                                  <p className="text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">{ai[h.id]!.result!.disclaimer}</p>
                                </div>
                              )
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {filteredHoldings.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                      No holdings match the current signal or search filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

