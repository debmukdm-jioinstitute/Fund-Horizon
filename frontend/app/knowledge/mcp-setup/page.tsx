import type { Metadata } from "next";
import Link from "next/link";
import { MCP_URL } from "@/lib/mcp";

export const metadata: Metadata = {
  title: "Connect Fund Horizon to Claude (MCP)",
  description: "Step-by-step setup of the Fund Horizon MCP server in Claude Code and Claude Desktop.",
};

const h2 = "mt-10 text-[19px] font-semibold text-[#181818] dark:text-[#EDF2F7]";
const p = "mt-2 text-[14px] leading-relaxed text-[#374151] dark:text-[#C7D0DC]";
const code = "mt-2 block overflow-x-auto whitespace-pre rounded-lg bg-[#F3F4F6] p-3 text-[12.5px] text-[#111827] dark:bg-[#171E27] dark:text-[#EDF2F7]";

const GROUPS: [string, string][] = [
  ["Research and market", "search, market_overview, daily_briefing, data_health, recommended_lists"],
  ["Mutual funds", "mf_screener, mf_research_detail, mf_performance, mf_peers, mf_manager, mf_fh_score_breakdown, mf_fh_methodology, mf_quartile_ranking, mf_quartile_annual, mf_managers_directory, mf_overlap, compare"],
  ["PMS", "pms_strategies, pms_strategy_detail, pms_providers, pms_matrix, pms_accounts, pms_account_tracker"],
  ["Client portfolios", "portfolio_screen (read any statement: PDF, Excel, CSV, Word, image), risk_questionnaire, risk_evaluate"],
  ["Consolidated valuation reports", "valuation_create_batch, valuation_upload, valuation_process, valuation_preview, valuation_reconciliation, valuation_validate, valuation_consolidated, valuation_approve, valuation_report_pdf, valuation_client_history"],
  ["Forms", "official_forms, form_fields, form_fill, filings_register"],
  ["Households and clients", "crm_households, crm_household, crm_create_household, crm_create_client"],
];

export default function McpSetup() {
  const cmd = `claude mcp add --transport http fund-horizon ${MCP_URL} \\\n  --header "Authorization: Bearer <your-token>"`;
  const desktop = `{
  "mcpServers": {
    "fund-horizon": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}", "--header", "Authorization: Bearer \${FH_TOKEN}"],
      "env": { "FH_TOKEN": "<your-token>" }
    }
  }
}`;
  return (
    <article className="mx-auto max-w-[800px] px-4 py-10 sm:px-6">
      <Link href="/knowledge" className="text-[12px] text-[#536176] underline dark:text-[#A8B4C4]">Knowledge base</Link>
      <h1 className="mt-2 text-2xl font-bold text-[#181818] dark:text-[#EDF2F7]">Connect Fund Horizon to Claude (MCP)</h1>
      <p className={p}>
        Once connected, you can ask Claude to screen mutual funds, research PMS strategies, build consolidated valuation reports from FundsIndia, ProAffluence and Stallion
        statements, read client portfolios, and fill official forms, all from a chat. Claude works through your own Fund Horizon login, so it sees only what you can see.
      </p>

      <h2 className={h2}>Before you start</h2>
      <ul className={`${p} list-disc space-y-1 pl-5`}>
        <li>You need a Fund Horizon staff login.</li>
        <li>Claude Code, or Claude Desktop with Node.js installed (Desktop uses a small bridge, <code>mcp-remote</code>).</li>
        <li>Server address: <code>{MCP_URL}</code></li>
      </ul>

      <h2 className={h2}>Step 1. Create your token</h2>
      <ol className={`${p} list-decimal space-y-1 pl-5`}>
        <li>Sign in to the backoffice, open <b>Settings</b>, then <b>Claude connection (MCP)</b> (<Link className="underline" href="/backoffice/settings/mcp">/backoffice/settings/mcp</Link>).</li>
        <li>Type a name (for example, &quot;My laptop&quot;), choose how long it stays valid, and select <b>Create token</b>.</li>
        <li>Copy the token immediately. It is shown once. If you lose it, revoke it and create another.</li>
      </ol>

      <h2 className={h2}>Step 2a. Claude Code</h2>
      <p className={p}>Run this once in a terminal, replacing the token:</p>
      <code className={code}>{cmd}</code>
      <p className={p}>Then start <code>claude</code> and type <code>/mcp</code> to confirm that <b>fund-horizon</b> shows as connected.</p>

      <h2 className={h2}>Step 2b. Claude Desktop</h2>
      <ol className={`${p} list-decimal space-y-1 pl-5`}>
        <li>Open Claude Desktop, then <b>Settings</b>, <b>Developer</b>, <b>Edit Config</b>.</li>
        <li>Add this to <code>claude_desktop_config.json</code> (merge it with any servers you already have) and save:</li>
      </ol>
      <code className={code}>{desktop}</code>
      <p className={p}>Quit and reopen Claude Desktop. The Fund Horizon tools appear under the tools icon in a new chat.</p>
      <p className={p}>
        <b>claude.ai in the browser:</b> custom connectors there need a sign-in screen (OAuth), which Fund Horizon does not offer yet. Use Claude Code or Claude Desktop for now.
      </p>

      <h2 className={h2}>Step 3. Check it works</h2>
      <p className={p}>Ask: <i>&quot;Using Fund Horizon, show me data health and say how current each source is.&quot;</i> Claude should call <code>data_health</code> and quote the as-on dates.</p>

      <h2 className={h2}>What you can ask</h2>
      <ul className={`${p} list-disc space-y-1 pl-5`}>
        <li>&quot;Screen Regular-plan flexi cap funds by FH score and show the top 10 with 3-year returns and why each is rated that way.&quot;</li>
        <li>&quot;Compare our recommended PMS strategies on 1-year and 3-year returns and list any that have no disclosed return.&quot;</li>
        <li>&quot;Here is a client statement (PDF). Which holdings are in our scored universe, which are not, and what overlaps?&quot;</li>
        <li>&quot;Create this month&apos;s consolidated valuation for Client X from these three statements, show reconciliation, and wait for my OK before approving.&quot;</li>
        <li>&quot;Fill the CAMS change-of-address form for this client and log it against the household.&quot;</li>
      </ul>

      <h2 className={h2}>Tools</h2>
      <div className="mt-2 space-y-3">
        {GROUPS.map(([g, t]) => (
          <div key={g}><div className="text-[13px] font-semibold text-[#181818] dark:text-[#EDF2F7]">{g}</div><div className="text-[12.5px] text-[#536176] dark:text-[#A8B4C4]">{t}</div></div>
        ))}
      </div>

      <h2 className={h2}>How accuracy and safety are protected</h2>
      <ul className={`${p} list-disc space-y-1 pl-5`}>
        <li>Every tool reads the same data and rules as the website, with your own permissions. Nothing is recalculated or estimated for Claude.</li>
        <li>Each answer carries its source, retrieval time and the data&apos;s as-on date. Claude is instructed to quote them and to say so when a value is unavailable.</li>
        <li>Large results are trimmed with an explicit &quot;truncated&quot; notice (shown versus total), never silently.</li>
        <li>Writes are additive only: create households, clients and valuation batches, upload statements, fill forms. Nothing is deleted, and the recommended lists cannot be edited through Claude.</li>
        <li>Approving a valuation is permanent. Claude must ask you first and pass an explicit confirmation.</li>
        <li>Revoke a token in <Link className="underline" href="/backoffice/settings/mcp">Settings</Link> at any time. It stops working immediately.</li>
      </ul>

      <h2 className={h2}>Troubleshooting</h2>
      <ul className={`${p} list-disc space-y-1 pl-5`}>
        <li><b>401 / not connected:</b> the token is wrong, expired or revoked. Create a new one.</li>
        <li><b>403:</b> your login is not staff, or it is suspended.</li>
        <li><b>Results say &quot;truncated&quot;:</b> ask for a narrower filter or the next page.</li>
        <li><b>A fund has blanks:</b> see <Link className="underline" href="/knowledge/data-guide">Reading the data</Link>.</li>
      </ul>
      <p className={`${p} mt-8 text-[12px]`}>Fund Horizon data supports research and distribution operations. It is not investment advice.</p>
    </article>
  );
}
