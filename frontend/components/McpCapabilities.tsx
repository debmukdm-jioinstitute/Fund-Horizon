const ROWS: [string, string, string][] = [
  ["Research: mutual funds", "mf_screener (FH score, returns, risk, capture ratios, quartiles), mf_research_detail, mf_performance, mf_peers, mf_manager, mf_managers_directory, mf_fh_score_breakdown, mf_fh_methodology, mf_quartile_ranking, mf_quartile_annual, mf_overlap, compare.", "Invent or estimate a figure. Fill an empty cell. Give investment advice. Show Direct-plan quartiles (the source publishes Regular only)."],
  ["Research: PMS and markets", "pms_providers, pms_strategies, pms_strategy_detail, pms_matrix, pms_accounts, pms_account_tracker (XIRR, cash flows, high-water-mark fees), recommended_lists, market_overview, daily_briefing, data_health, search, list_search_scopes.", "Quote a number without its as-on date. Treat a partial month as complete."],
  ["Risk profiling and screening", "risk_questionnaire, risk_evaluate, portfolio_screen (check a client statement against the scored fund list).", "Decide a client's risk profile for them or recommend a product."],
  ["CRM", "crm_households, crm_household, crm_create_household, crm_create_client; read, add, change and delete households, clients and their holdings (mutual fund, PMS, stocks, anything else) through api_catalog and api_call.", "Do more than your role allows. Change or delete before showing you the change and getting your clear yes."],
  ["Client personal finance", "finance_summary: a customer's self-entered finance and what is computed from it: income, spending by category, EMIs, left-over, net worth (with their Fund Horizon holdings and SIPs), yearly interest, emergency-fund months, upcoming payments, loan payoff plan (with the 10%-more-EMI saving), goal SIPs, limits used, insurance cover, warnings, and the questions still to ask them. Claude answers from these figures and asks the missing ones first.", "Link a bank, guess a figure the customer has not entered, or give investment advice. Customers cannot connect Claude themselves; it is a staff tool."],
  ["Valuation", "valuation_providers, valuation_batches, valuation_create_batch, valuation_upload (FundsIndia, ProAffluence, Stallion and more), valuation_process, valuation_validate, valuation_preview, valuation_reconciliation, valuation_consolidated, valuation_report_pdf, valuation_client_history, valuation_client_files, valuation_email_report; fix or add a holding, discard an unapproved batch.", "Edit an approved valuation (it is frozen). Approve without your yes (valuation_approve asks twice). Hide a mismatch: it must be fixed first."],
  ["Forms", "official_forms, form_fields, form_fill, filings_register: fill the official CAMS, KFintech and PMS PDFs for a client.", "Make a lookalike form, invent a form code, or sign for you."],
  ["Everything else", "api_catalog finds any other Fund Horizon screen or API and api_call runs it, including features added later, with no reinstall. mcp_audit_log shows every change with its old values: ask \"show my recent changes\".", "Touch logins, passwords, connection tokens or staff accounts. Those stay inside Fund Horizon."],
  ["You", "Ask in plain words. Check the as-on date Claude quotes. Remove a lost connection in Settings and download a new one.", "Share your connector file (it holds your sign-in). Say yes before you have read the change."],
];

export default function McpCapabilities() {
  return (
    <div className="overflow-x-auto">
      <table className="terminal-table w-full text-[14px] leading-snug">
        <thead><tr><th className="text-left">Area</th><th className="text-left text-[#1B5E20] dark:text-[#A5D6A7]">Do</th><th className="text-left text-[#B42332] dark:text-[#FF7D86]">Do not</th></tr></thead>
        <tbody>
          {ROWS.map(([area, yes, no]) => (
            <tr key={area} className="align-top"><td className="whitespace-nowrap font-semibold">{area}</td><td>{yes}</td><td>{no}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
