"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAcademy } from "./AcademyContext";
import { accent, btnPrimary, card, muted } from "./ui";

interface ToolLinkProps {
  href: string;
  label: string;
  desc?: string;
}

function ToolBadge({ href, label }: ToolLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] border border-[#0176D3]/20 hover:border-[#0176D3] transition mr-1.5 mb-1"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px]">↗</span>
    </Link>
  );
}

export function ProcessNote() {
  const { go } = useAcademy();
  const [completedDays, setCompletedDays] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem("fh_onboarding_days");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleDay = (day: number) => {
    setCompletedDays((prev) => {
      const next = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      try {
        localStorage.setItem("fh_onboarding_days", JSON.stringify(next));
      } catch {
        /* storage disabled */
      }
      return next;
    });
  };

  return (
    <article className="space-y-8 max-w-5xl mx-auto pb-12 font-sans">
      {/* Header & Breadcrumb */}
      <div className="space-y-3 pb-6 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            <button className={`${accent} underline cursor-pointer`} onClick={() => go({})}>
              Academy
            </button>
            <span className={muted}>›</span>
            <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">New Joiner Process Note</span>
          </nav>
          <span className="text-xs px-2.5 py-1 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] font-semibold border border-[#0176D3]/30">
            Internal SOP &amp; Onboarding
          </span>
        </div>

        <div>
          <h1 className="text-3xl font-extrabold text-[#172033] dark:text-[#EDF2F7] tracking-tight">
            Fund Horizon – New Joiner Process Note
          </h1>
          <p className={`text-sm ${muted} mt-1.5 flex flex-wrap items-center gap-2`}>
            <span>Nov 24, 2026</span>
            <span>·</span>
            <span>Handover by <strong>@Fund Horizon</strong></span>
            <span>·</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">Standard Operating Procedure</span>
          </p>
        </div>

        <p className="text-base text-[#172033] dark:text-[#EDF2F7] leading-relaxed bg-[#F7F9FB] dark:bg-[#171E27] p-4 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644]">
          A short, plain-language guide to what Fund Horizon does, which tools you will use, and how each piece of work is done. <strong>No technical background needed.</strong>
        </p>
      </div>

      {/* Table of Contents Pill Bar */}
      <nav aria-label="Section shortcuts" className="flex flex-wrap gap-2 text-xs">
        {[
          ["#sec-1", "1. What is FH?"],
          ["#sec-2", "2. Work at a Glance"],
          ["#sec-3", "3. Research"],
          ["#sec-4", "4. Forms"],
          ["#sec-5", "5. Monthly Valuation"],
          ["#sec-6", "6. Portfolio Review"],
          ["#sec-7", "7. CRM"],
          ["#sec-8", "8. Recurring Tasks"],
          ["#sec-9", "9. Golden Rules"],
          ["#sec-10", "10. Suggested First Week"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="px-3 py-1.5 rounded-full border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C] text-[#536176] dark:text-[#A8B4C4] hover:text-[#0176D3] dark:hover:text-[#1B96FF] hover:border-[#0176D3] transition font-medium"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* 1. What is Fund Horizon? */}
      <section id="sec-1" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">1</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">What is Fund Horizon?</h2>
        </div>
        <p className="text-[15px] text-[#172033] dark:text-[#EDF2F7] leading-relaxed">
          Fund Horizon is our one-stop platform for <strong>mutual fund and PMS (portfolio management services) research</strong> and for the <strong>day-to-day client work</strong> around it: client records, forms, monthly valuations and reports. Data is pulled in automatically from public sources (AMFI for NAVs, APMI for PMS performance, news feeds, etc.), so you rarely type numbers by hand.
        </p>
        <div className="p-4 rounded-lg bg-[#EAF5FE]/60 dark:bg-[#11304F]/40 border border-[#0176D3]/20 text-[14.5px] leading-relaxed">
          <p className="font-medium text-[#0176D3] dark:text-[#1B96FF] mb-1">🤖 Claude AI Integration</p>
          <p className="text-[#172033] dark:text-[#EDF2F7]">
            You can work directly in the website (<strong>Backoffice</strong>), or simply <strong>ask Claude in plain English</strong>. Claude uses the Fund Horizon tools for you. Example: <em>&ldquo;Show me the top large-cap funds and compare the best two.&rdquo;</em>
          </p>
        </div>
      </section>

      {/* 2. The work at a glance */}
      <section id="sec-2" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">2</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">The work at a glance</h2>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644]">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-[#F7F9FB] dark:bg-[#171E27] border-b border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              <tr>
                <th className="py-3 px-4 font-semibold w-1/4">Job</th>
                <th className="py-3 px-4 font-semibold w-2/5">What it means</th>
                <th className="py-3 px-4 font-semibold">Where to start</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644] text-[#172033] dark:text-[#EDF2F7]">
              <tr>
                <td className="py-3.5 px-4 font-semibold">Research</td>
                <td className="py-3.5 px-4">Find, rank and compare mutual funds and PMS strategies</td>
                <td className="py-3.5 px-4">
                  <ToolBadge href="/backoffice/mutual-funds" label="Screener" />
                  <ToolBadge href="/backoffice/mutual-funds/research" label="FH Score" />
                  <ToolBadge href="/funds/compare" label="Compare" />
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Forms</td>
                <td className="py-3.5 px-4">Get the right CAMS / KFintech / AMC form, filled for a client</td>
                <td className="py-3.5 px-4">
                  <ToolBadge href="/backoffice/operations" label="Official Forms" />
                  <ToolBadge href="/backoffice/operations/paperwork" label="Form Fill" />
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Client monthly reports</td>
                <td className="py-3.5 px-4">Upload provider statements, check, approve, send PDF</td>
                <td className="py-3.5 px-4">
                  <ToolBadge href="/backoffice/operations/valuation" label="Valuation" />
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Portfolio review and risk profile</td>
                <td className="py-3.5 px-4">Check a client&apos;s holdings and match to their risk level</td>
                <td className="py-3.5 px-4">
                  <ToolBadge href="/backoffice/mutual-funds" label="Portfolio Screen" />
                  <ToolBadge href="/backoffice/risk-profiling" label="Risk Questionnaire" />
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-semibold">Client records (CRM)</td>
                <td className="py-3.5 px-4">Keep households and clients up to date</td>
                <td className="py-3.5 px-4">
                  <ToolBadge href="/backoffice/crm" label="CRM" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Research (mutual funds and PMS) */}
      <section id="sec-3" className={`${card} p-6 space-y-5`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">3</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Research (mutual funds and PMS)</h2>
        </div>

        <div className="space-y-3">
          <h3 className="text-base font-semibold text-[#172033] dark:text-[#EDF2F7] flex items-center gap-2">
            <span>Mutual Funds</span>
            <ToolBadge href="/backoffice/mutual-funds" label="Open MF Screener" />
          </h3>
          <ul className="list-disc list-outside pl-5 space-y-2 text-[14.5px] text-[#172033] dark:text-[#EDF2F7] leading-relaxed">
            <li><strong>Search:</strong> Search any fund, fund manager, AMC, PMS, news or form from one box.</li>
            <li><strong>Screener:</strong> Filter funds by category, returns, risk and more. Defaults to <em>Regular plans</em>.</li>
            <li>
              <strong>FH Score:</strong> Our proprietary 0–100 rating. It evaluates manager and fund history, quartile consistency, risk-adjusted returns (Sharpe, Sortino, capture ratios), benchmark outperformance and size of excess returns. <strong>A score of 80+ with good data coverage makes a fund &ldquo;recommended&rdquo;</strong>. The score is refreshed every weekday at midnight.
            </li>
            <li><strong>Compare &amp; Peers:</strong> Compare funds side by side, use <em>Peers</em> to see rivals in the same category, and <em>Performance</em> and <em>Quartile ranking</em> to examine consistency year by year.</li>
            <li><strong>Manager directory:</strong> Shows who runs each fund and their audited tenure history.</li>
            <li><strong>Recommended lists:</strong> Hold our current approved funds and PMS strategies.</li>
          </ul>
        </div>

        <div className="space-y-3 pt-3 border-t border-[#E4E9EF] dark:border-[#2B3644]">
          <h3 className="text-base font-semibold text-[#172033] dark:text-[#EDF2F7] flex items-center gap-2">
            <span>Portfolio Management Services (PMS)</span>
            <ToolBadge href="/backoffice/pms" label="Open PMS Tracker" />
          </h3>
          <p className="text-[14.5px] text-[#172033] dark:text-[#EDF2F7] leading-relaxed">
            Browse providers and strategies, inspect monthly performance disclosures (direct from APMI), dynamic benchmark alpha simulations, and compare strategies side by side.
          </p>
        </div>

        <div className="p-3.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-[14px] text-amber-950 dark:text-amber-200">
          <strong>⚠️ Always check:</strong> Use <Link href="/backoffice/data-health" className="underline font-bold">Data Health</Link> to verify how fresh each data source is before quoting any return or NAV number to a client.
        </div>
      </section>

      {/* 4. Forms */}
      <section id="sec-4" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">4</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Forms (CAMS, KFintech, AMCs, PMS)</h2>
        </div>
        <p className={`text-[14.5px] ${muted}`}>
          Follow this 4-step workflow to prepare official operational paperwork without lookalike templates:
        </p>

        <ol className="grid gap-3 sm:grid-cols-2 text-[14.5px]">
          <li className="p-4 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] space-y-1">
            <div className="font-bold text-[#0176D3] dark:text-[#1B96FF]">Step 1 · Search or Browse</div>
            <p className="text-[#172033] dark:text-[#EDF2F7]">
              Browse <strong>Official Forms</strong>. Hundreds of official publisher PDFs grouped by purpose: purchase, redemption, switch, SIP stop, bank mandate, nominee, KYC, FATCA, PAN, contact update, transmission (death claim), etc.
            </p>
          </li>
          <li className="p-4 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] space-y-1">
            <div className="font-bold text-[#0176D3] dark:text-[#1B96FF]">Step 2 · Pick Registrar</div>
            <p className="text-[#172033] dark:text-[#EDF2F7]">
              Pick the right form for the client&apos;s mutual fund registrar (<strong>CAMS</strong> or <strong>KFintech</strong>) or the AMC&apos;s own specialized slip.
            </p>
          </li>
          <li className="p-4 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] space-y-1">
            <div className="font-bold text-[#0176D3] dark:text-[#1B96FF]">Step 3 · Form Fields &amp; Auto-fill</div>
            <p className="text-[#172033] dark:text-[#EDF2F7]">
              Use <strong>Form Fields</strong> to inspect what the form requires, then launch <strong>Form Fill</strong> to auto-draw the client&apos;s details directly onto the publisher PDF from CRM.
            </p>
          </li>
          <li className="p-4 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] space-y-1">
            <div className="font-bold text-[#0176D3] dark:text-[#1B96FF]">Step 4 · Review &amp; Sign</div>
            <p className="text-[#172033] dark:text-[#EDF2F7]">
              Review the filled PDF, obtain the client&apos;s wet or digital signature, and submit to the RTA/AMC.
            </p>
          </li>
        </ol>
      </section>

      {/* 5. Client monthly reports (valuation) */}
      <section id="sec-5" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">5</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Client monthly reports (valuation)</h2>
        </div>
        <p className="text-[14.5px] text-[#172033] dark:text-[#EDF2F7]">
          Supported statement providers: <strong>FundsIndia</strong> (mutual funds), <strong>ProAffluence</strong> and <strong>Stallion</strong> (PMS). Typical monthly flow:
        </p>

        <ol className="list-decimal list-outside pl-5 space-y-2 text-[14.5px] text-[#172033] dark:text-[#EDF2F7]">
          <li><strong>Create a batch</strong> for the current billing month.</li>
          <li><strong>Upload</strong> each client&apos;s provider statements (PDF / Excel).</li>
          <li>Click <strong>Validate</strong>, then <strong>Process</strong>. The parsing engine reads holdings, units, NAVs, and cash flows.</li>
          <li><strong>Preview and Reconciliation:</strong> Verify holdings and valuation totals against the source statement.</li>
          <li><strong>Approve the batch:</strong> <span className="text-[#B42332] dark:text-[#FF7D86] font-semibold">This cannot be undone. Double-check first.</span></li>
          <li><strong>Generate the PDF report:</strong> Create single-client or consolidated family view reports and email them to the client.</li>
        </ol>

        <div className="p-3.5 rounded-lg bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[13.5px] space-y-1">
          <p><strong>Also available:</strong> Client history (past months) and client file storage.</p>
          <p className="text-amber-800 dark:text-amber-300 font-medium">
            ⚠️ Note: Statement readers should always have the first few outputs eye-checked against the raw statements.
          </p>
        </div>
      </section>

      {/* 6. Portfolio review and risk profiling */}
      <section id="sec-6" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">6</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Portfolio review and risk profiling</h2>
        </div>
        <ol className="list-decimal list-outside pl-5 space-y-2.5 text-[14.5px] text-[#172033] dark:text-[#EDF2F7]">
          <li>
            <strong>Risk questionnaire:</strong> Client answers questions; <strong>Risk evaluate</strong> computes capacity vs comfort and assigns their risk profile (lower score wins).
          </li>
          <li>
            <strong>Portfolio Screen:</strong> Upload the client&apos;s CAS statement or enter holdings to run them through our scoring framework and identify underperforming funds.
          </li>
          <li>
            <strong>Overlap:</strong> Determine portfolio concentration and how much client funds duplicate identical underlying stocks.
          </li>
          <li>
            <strong>Compare against recommended:</strong> Benchmark the portfolio against FH Recommended funds and suggest adjustments aligned with their risk profile.
          </li>
          <li>
            <strong>Write up review:</strong> Generate the formal portfolio review advisory deck for client presentation.
          </li>
        </ol>
      </section>

      {/* 7. Client records (CRM) */}
      <section id="sec-7" className={`${card} p-6 space-y-3`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">7</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Client records (CRM)</h2>
        </div>
        <p className="text-[14.5px] text-[#172033] dark:text-[#EDF2F7] leading-relaxed">
          Clients are structured into <strong>households (a family unit)</strong>. Always create the household first, then add individual client family members inside it.
        </p>
        <div className="p-3.5 rounded-lg bg-[#EAF5FE]/70 dark:bg-[#11304F]/50 border border-[#0176D3]/20 text-[14px]">
          <strong>💡 Keep records accurate:</strong> Official forms, monthly valuation batches, and consolidated portfolio reports pull identity, PAN, and bank details directly from CRM fields.
        </div>
      </section>

      {/* 8. Recurring tasks: what to do and when */}
      <section id="sec-8" className={`${card} p-6 space-y-5`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">8</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Recurring tasks: what to do and when</h2>
        </div>
        <p className="text-[14.5px] text-[#172033] dark:text-[#EDF2F7]">
          Everything below is done in the Fund Horizon terminal (website), or by asking Claude to do it through the same tools. <strong>Dates are deadlines to remember:</strong>
        </p>

        {/* Schedule Table */}
        <div className="overflow-x-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644]">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-[#F7F9FB] dark:bg-[#171E27] border-b border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              <tr>
                <th className="py-2.5 px-4 font-semibold w-1/4">How often</th>
                <th className="py-2.5 px-4 font-semibold">Task</th>
                <th className="py-2.5 px-4 font-semibold w-1/3">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644] text-[#172033] dark:text-[#EDF2F7]">
              <tr>
                <td className="py-3 px-4 font-semibold">Daily</td>
                <td className="py-3 px-4">Answer client service queries and log them in the Service Tracker</td>
                <td className="py-3 px-4 text-[#0176D3] dark:text-[#1B96FF] font-medium">Same day</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Daily</td>
                <td className="py-3 px-4">Fill forms needed for those queries</td>
                <td className="py-3 px-4 text-[#0176D3] dark:text-[#1B96FF] font-medium">Same day</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Weekly</td>
                <td className="py-3 px-4">Review client portfolios as valuation reports are uploaded</td>
                <td className="py-3 px-4 text-[#0176D3] dark:text-[#1B96FF] font-medium">Each week</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Monthly</td>
                <td className="py-3 px-4">Send monthly report to clients with more than 1 Cr AUM</td>
                <td className="py-3 px-4 text-[#0176D3] dark:text-[#1B96FF] font-medium">1st to 7th of the month</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Monthly</td>
                <td className="py-3 px-4">Update the PMS and mutual fund tracker</td>
                <td className="py-3 px-4 text-[#0176D3] dark:text-[#1B96FF] font-medium">On or before the 10th</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Monthly &amp; quarterly</td>
                <td className="py-3 px-4">Track FH recommended mutual funds and PMS</td>
                <td className="py-3 px-4 text-[#0176D3] dark:text-[#1B96FF] font-medium">Monthly check, quarterly review</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold">Every 6 months</td>
                <td className="py-3 px-4 text-[#706E6B] dark:text-[#A8B4C4]">Semi-annual compliance &amp; disclosures review</td>
                <td className="py-3 px-4 text-[#706E6B] dark:text-[#A8B4C4]">Per task schedule</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Deep dive per frequency */}
        <div className="space-y-4 pt-2">
          <div className="p-4 rounded-lg bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-2">
            <h4 className="font-bold text-[#172033] dark:text-[#EDF2F7]">Daily Routines</h4>
            <p className="text-[14px] leading-relaxed">
              <strong>1. Client service queries:</strong> Clients write in with requests such as email/mobile updates, investment queries, or redemption inquiries. Every query goes into the <Link href="/backoffice/service-desk" className="underline font-medium text-[#0176D3]">Service Tracker</Link>. Log it when it arrives, and update it when done.
            </p>
            <p className="text-[14px] leading-relaxed">
              <strong>2. Form filling:</strong> Many queries require a form (nominee update, change of bank mandate, KYC). Pick from <Link href="/backoffice/operations" className="underline font-medium text-[#0176D3]">Official Forms</Link> and generate it using <em>Form Fill</em>.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-1.5">
            <h4 className="font-bold text-[#172033] dark:text-[#EDF2F7]">Weekly Routines</h4>
            <p className="text-[14px] leading-relaxed">
              <strong>Portfolio review:</strong> Whenever a valuation report is uploaded, the platform screens the client&apos;s portfolio fund-by-fund on three criteria, assigning each a <strong>Buy, Hold or Sell</strong> signal. Read the result, sense-check it, and flag any <em>Sell</em> funds to the advisor.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-1.5">
            <h4 className="font-bold text-[#172033] dark:text-[#EDF2F7]">Monthly Routines</h4>
            <p className="text-[14px] leading-relaxed">
              <strong>1. Client monthly reports (1st to 7th):</strong> Send monthly reports to all clients with &gt; 1 Cr AUM. Upload statements, verify reconciliation, approve batch, and generate branded PDF reports.
            </p>
            <p className="text-[14px] leading-relaxed">
              <strong>2. PMS and mutual fund tracker (by 10th):</strong> Verify that the new month&apos;s APMI PMS disclosures and AMFI month-end metrics have settled. Check <em>Data Health</em> first.
            </p>
            <p className="text-[14px] leading-relaxed">
              <strong>3. FH recommended check:</strong> Review current recommended funds and strategies for any rating or quartile drops.
            </p>
          </div>
        </div>
      </section>

      {/* 9. Golden rules */}
      <section id="sec-9" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">9</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Golden rules</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 text-[14px]">
          <div className="p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]">
            <p className="font-bold text-[#172033] dark:text-[#EDF2F7] mb-1">1. Numbers come from platform</p>
            <p className={muted}>Never quote numbers from memory. Always record and verify the &ldquo;as on&rdquo; date.</p>
          </div>
          <div className="p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]">
            <p className="font-bold text-[#172033] dark:text-[#EDF2F7] mb-1">2. No guessing empty values</p>
            <p className={muted}>If a field is empty, it means not available (e.g., fund too young). Never fill gaps with guesses.</p>
          </div>
          <div className="p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]">
            <p className="font-bold text-[#172033] dark:text-[#EDF2F7] mb-1">3. Clear confirmation required</p>
            <p className={muted}>Anything that creates, edits or deletes displays a diff and waits for your confirmation.</p>
          </div>
          <div className="p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]">
            <p className="font-bold text-[#172033] dark:text-[#EDF2F7] mb-1">4. Full audit trail</p>
            <p className={muted}>Every change is logged in the permanent audit trail for accountability and compliance.</p>
          </div>
          <div className="p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]">
            <p className="font-bold text-[#172033] dark:text-[#EDF2F7] mb-1">5. Research, not financial advice</p>
            <p className={muted}>We are an AMFI mutual fund distributor (ARN 345439). Outputs are illustrative research.</p>
          </div>
          <div className="p-3.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]">
            <p className="font-bold text-[#172033] dark:text-[#EDF2F7] mb-1">6. Strict role permissions</p>
            <p className={muted}>Your view depends on your role (admin, analyst, operations, rm, or read-only).</p>
          </div>
        </div>
      </section>

      {/* 10. Suggested first week */}
      <section id="sec-10" className={`${card} p-6 space-y-4`}>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0176D3]/10 text-[#0176D3] dark:text-[#1B96FF] font-bold text-sm">10</span>
          <h2 className="text-xl font-bold text-[#172033] dark:text-[#EDF2F7]">Suggested first week (Onboarding Roadmap)</h2>
        </div>
        <p className={`text-[14px] ${muted}`}>
          Follow this 5-day hands-on curriculum. Click each day&apos;s checkmark as you complete it:
        </p>

        <div className="space-y-3">
          {[
            {
              day: 1,
              title: "Day 1: Platform Orientation",
              task: "Get your login and explore Search, Screener, and Data Health.",
              links: [
                { label: "Screener", href: "/backoffice/mutual-funds" },
                { label: "Data Health", href: "/backoffice/data-health" },
              ],
            },
            {
              day: 2,
              title: "Day 2: Scoring & Comparison",
              task: "Read how the FH Score works; compare three peer funds side-by-side.",
              links: [
                { label: "FH Score Guide", href: "/backoffice/learn" },
                { label: "Compare Funds", href: "/funds/compare" },
              ],
            },
            {
              day: 3,
              title: "Day 3: Paperwork & Forms",
              task: "Fill one CAMS/KFintech official form for a practice or dummy client.",
              links: [
                { label: "Official Forms", href: "/backoffice/operations" },
                { label: "Paperwork", href: "/backoffice/operations/paperwork" },
              ],
            },
            {
              day: 4,
              title: "Day 4: Valuation Shadowing",
              task: "Shadow a monthly valuation batch, stopping before final batch approval.",
              links: [{ label: "Valuation Batches", href: "/backoffice/operations/valuation" }],
            },
            {
              day: 5,
              title: "Day 5: Portfolio Review",
              task: "Conduct a practice portfolio review using the Risk Questionnaire and Portfolio Screen.",
              links: [
                { label: "Risk Questionnaire", href: "/backoffice/risk-profiling" },
                { label: "Portfolio Screen", href: "/backoffice/mutual-funds" },
              ],
            },
          ].map((item) => {
            const done = completedDays.includes(item.day);
            return (
              <div
                key={item.day}
                className={`p-4 rounded-lg border transition ${
                  done
                    ? "border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20"
                    : "border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleDay(item.day)}
                      className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center border text-xs font-bold transition cursor-pointer ${
                        done
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-[#A8B4C4] bg-white dark:bg-[#10151C] text-transparent hover:border-[#0176D3]"
                      }`}
                      aria-label={`Mark ${item.title} as ${done ? "incomplete" : "complete"}`}
                    >
                      ✓
                    </button>
                    <div>
                      <h3 className={`text-[15px] font-bold ${done ? "line-through text-emerald-800 dark:text-emerald-300" : "text-[#172033] dark:text-[#EDF2F7]"}`}>
                        {item.title}
                      </h3>
                      <p className="text-[14px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">{item.task}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.links.map((lnk) => (
                          <ToolBadge key={lnk.href} href={lnk.href} label={lnk.label} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-white dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
                    {done ? "Completed" : `Day ${item.day}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-[#E4E9EF] dark:border-[#2B3644] flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className={muted}>
            Questions? Ask the person handing this over, or ask <strong>Claude</strong>.
          </p>
          <button className={btnPrimary} onClick={() => go({})}>
            ← Return to Academy Hub
          </button>
        </div>
      </section>
    </article>
  );
}
