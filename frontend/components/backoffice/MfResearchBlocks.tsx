"use client";

import React from "react";
import type { MfResearchDetail } from "@/lib/backoffice";

/** Research coverage blocks shared by the fund detail page: consistency, peer percentiles, managers, operations, benchmark. */
export default function MfResearchBlocks({ researchDetail }: { researchDetail: MfResearchDetail | null }) {
  return (
    <>
            {/* MF Research blocks (additive): consistency, peer percentiles, computed quartile history. */}
            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Consistency — how steady the fund has been</div>
              {researchDetail ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Rolling 1Y win % (vs category median, last 5Y, monthly windows)", researchDetail.roll_win_pct, "%"],
                    ["Calendar years in top quartile (completed years)", researchDetail.cal_topq_years, ""],
                    ["Calendar win % (vs category median, completed years)", researchDetail.cal_win_pct, "%"],
                    ["Downside deviation 3Y (annualised, returns below 0)", researchDetail.downside_dev_3y, "%"],
                    ["SIP CAGR 3Y (monthly instalment, month-end NAV)", researchDetail.sip_cagr_3y, "%"],
                    ["SIP CAGR 5Y (monthly instalment, month-end NAV)", researchDetail.sip_cagr_5y, "%"],
                    ["Calmar 3Y (3Y CAGR divided by 3Y max drawdown)", researchDetail.calmar_3y, ""],
                  ] as const).map(([label, v, unit]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? `${v.toFixed(2)}${unit}` : "Not reported"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Consistency data is not available for this scheme.</div>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Peer percentiles — better than X% of category + plan peers</div>
              {researchDetail ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Sharpe 3Y", researchDetail.pct_sharpe_3y],
                    ["Sortino 3Y", researchDetail.pct_sortino_3y],
                    ["Alpha 3Y (vs category median)", researchDetail.pct_alpha_3y],
                    ["Volatility 3Y", researchDetail.pct_vol_3y],
                    ["Max drawdown 3Y", researchDetail.pct_max_dd_3y],
                    ["1Y return", researchDetail.pct_ret_1y],
                    ["3Y CAGR", researchDetail.pct_cagr_3y],
                    ["5Y CAGR", researchDetail.pct_cagr_5y],
                  ] as const).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? `Better than ${v.toFixed(0)}% of category + plan peers` : "Not reported"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Peer percentiles are not available for this scheme.</div>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Quartile history (computed, in-house)</div>
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                Computed quartiles rank the fund against its category + plan peers. This is separate from the Advisorkhoj quartile section above, which uses Advisorkhoj figures.
              </p>
              {researchDetail ? (
                <div className="flex flex-wrap gap-2 text-[12px]">
                  {([
                    ["1Y", researchDetail.quartile_1y],
                    ["2Y", researchDetail.quartile_2y],
                    ["3Y", researchDetail.quartile_3y],
                    ["5Y", researchDetail.quartile_5y],
                  ] as const).map(([label, v]) => (
                    <span key={label} className="rounded border border-[#E5E5E5] dark:border-[#2B3644] px-2 py-1">
                      {label}: <span className="font-mono font-medium">{typeof v === "number" ? `Q${v} (computed)` : "Not reported"}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Computed quartile history is not available for this scheme.</div>
              )}
              {researchDetail?.reason && (
                <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{researchDetail.reason}</p>
              )}
            </div>

            {/* MF Research V2 blocks: co-managers + changes + bio, operations, portfolio, vs-index. */}
            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Managers — everyone managing this scheme</div>
              {researchDetail?.co_managers ? (
                <div className="space-y-1.5 text-[12px]">
                  {researchDetail.co_managers.managers.length === 0 && (
                    <div className="text-[#706E6B] dark:text-[#A8B4C4]">No manager roster on file in the AMFI/SEBI reference snapshot for this scheme.</div>
                  )}
                  {researchDetail.co_managers.managers.map((m) => (
                    <div key={m.manager_id ?? m.name ?? "unknown"}>
                      <span className="font-medium">{m.name ?? "Not reported"}</span>
                      {m.designation ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {m.designation}</span> : null}
                      {m.role_as_stated ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {m.role_as_stated}</span> : null}
                      {m.start_date ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · since {m.start_date}</span> : null}
                      {typeof m.tenure_years === "number" ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {m.tenure_years.toFixed(1)} yrs</span> : null}
                    </div>
                  ))}
                  {researchDetail.co_managers.shared_record_note && (
                    <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{researchDetail.co_managers.shared_record_note}</p>
                  )}
                  {researchDetail.manager_changes && researchDetail.manager_changes.length > 0 && (
                    <div>
                      <div className="font-medium mt-1">Manager changes on file</div>
                      {researchDetail.manager_changes.map((c, i) => (
                        <div key={i} className="text-[#706E6B] dark:text-[#A8B4C4]">
                          {c.effective_date ?? "Not reported"}: {c.old_manager ?? "Not reported"} → {c.new_manager ?? "Not reported"}
                          {c.notice_url ? <> · <a href={c.notice_url} target="_blank" rel="noreferrer" className="text-[#0176D3] dark:text-[#1B96FF] hover:underline">AMC notice</a></> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {researchDetail.manager_bio && (
                    <div className="text-[#706E6B] dark:text-[#A8B4C4]">
                      {researchDetail.manager_bio.education ? <div>Education: {researchDetail.manager_bio.education}</div> : null}
                      {researchDetail.manager_bio.bio_summary ? <div>{researchDetail.manager_bio.bio_summary}</div> : null}
                      {researchDetail.manager_bio.sources && researchDetail.manager_bio.sources.length > 0 && (
                        <div>Sources: {researchDetail.manager_bio.sources.map((s) => s.label ?? s.url).filter(Boolean).join(" · ")}</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Manager roster is not available for this scheme.</div>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Operations — what it costs and how it works</div>
              {researchDetail?.operations?.available ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Launch date", researchDetail.operations.launch_date],
                    ["Exit load", researchDetail.operations.exit_load],
                    ["Minimum investment (Rs)", researchDetail.operations.minimum_investment_inr],
                    ["Riskometer", researchDetail.operations.riskometer],
                    ["Benchmark (total-return index, as named in the scheme document)", researchDetail.operations.benchmark_tri],
                    ["Expense ratio, Regular %", researchDetail.operations.ter_regular_pct],
                    ["Expense ratio, Direct %", researchDetail.operations.ter_direct_pct],
                    ["Expense ratio as of", researchDetail.operations.ter_date],
                  ] as const).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{v ?? "Not reported"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{researchDetail?.operations?.reason ?? "Operations data is not available for this scheme."}</div>
              )}
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                AUM history, investor flows, folio counts and expense-ratio history are not in the reference snapshot, so they are shown as unavailable rather than estimated.
                Past performance is not a guide to future returns.
              </p>
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Benchmark — vs the real total-return index</div>
              {researchDetail?.index && researchDetail.index.alpha_3y_pct != null ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Index", researchDetail.index.index_name],
                    ["Alpha 3Y % (vs index)", researchDetail.index.alpha_3y_pct],
                    ["Beta 3Y (vs index)", researchDetail.index.beta_3y],
                    ["Tracking error 3Y % (vs index)", researchDetail.index.tracking_error_3y_pct],
                    ["Information ratio 3Y (vs index)", researchDetail.index.information_ratio_3y],
                    ["Index 3Y return %", researchDetail.index.index_ret_3y_pct],
                    ["Fund 3Y return %", researchDetail.index.fund_ret_3y_pct],
                  ] as const).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? v.toFixed(2) : (v ?? "Not reported")}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                  {researchDetail?.index?.reason ?? "No real total-return index series is stored for this fund's benchmark yet, so vs-index figures are empty. The one-pager's tracker-fund proxy line is kept with its disclosure until a real series is ingested."}
                </div>
              )}
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">These columns are kept separate from the vs-category-median columns above. Past performance is not a guide to future returns.</p>
            </div>
    </>
  );
}
