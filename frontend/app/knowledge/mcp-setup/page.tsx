import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Connect Fund Horizon to Claude",
  description: "Three steps to use Fund Horizon inside Claude: download, open, install.",
};

const h2 = "mt-10 text-[20px] font-semibold text-[#181818] dark:text-[#EDF2F7]";
const p = "mt-2 text-[16px] leading-relaxed text-[#374151] dark:text-[#C7D0DC]";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-4 rounded-xl border border-[#E5E5E5] bg-white p-4 dark:border-[#2B3644] dark:bg-[#10151C]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0B2545] text-[18px] font-bold text-white dark:bg-[#13A89E]">{n}</span>
      <div><div className="text-[18px] font-semibold text-[#181818] dark:text-[#EDF2F7]">{title}</div><div className={p}>{children}</div></div>
    </li>
  );
}

export default function McpSetup() {
  return (
    <article className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Link href="/knowledge" className="text-[13px] text-[#536176] underline dark:text-[#A8B4C4]">Knowledge base</Link>
      <h1 className="mt-2 text-3xl font-bold text-[#181818] dark:text-[#EDF2F7]">Use Fund Horizon inside Claude</h1>
      <p className={p}>
        Ask Claude in plain words: screen mutual funds, research PMS, build a client&apos;s consolidated valuation report, read a client statement, fill a form.
        It uses your own Fund Horizon login, so it sees only what you can see. It takes three steps and about one minute.
      </p>

      <ol className="mt-6 space-y-4">
        <Step n={1} title="Download your connector">
          Sign in to Fund Horizon, open <Link className="underline" href="/backoffice/settings/mcp">Settings, Claude connection</Link>, and click the green
          button <b>Download Fund Horizon for Claude</b>. The file is made just for you.
        </Step>
        <Step n={2} title="Open the file">
          Find <b>Fund-Horizon-for-Claude.mcpb</b> in your Downloads folder and double-click it. The Claude app opens
          (<a className="underline" href="https://claude.ai/download" target="_blank" rel="noreferrer">get Claude here</a> if you do not have it).
        </Step>
        <Step n={3} title="Click Install">
          Click <b>Install</b> in Claude. That is all. Start a new chat and type: <i>&quot;Show me Fund Horizon data health.&quot;</i>
        </Step>
      </ol>

      <h2 className={h2}>Things to ask</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li>&quot;Show the best Regular flexi cap funds by FH score, with 3-year returns and why each is rated that way.&quot;</li>
        <li>&quot;Compare our recommended PMS strategies on 1-year and 3-year returns.&quot;</li>
        <li>&quot;Here is my client&apos;s statement. Which funds are in our scored list?&quot; (attach the file in Claude)</li>
        <li>&quot;Make this month&apos;s consolidated valuation for Client X from these statements. Show me the totals first.&quot;</li>
        <li>&quot;Fill the CAMS change of address form for this client.&quot;</li>
      </ul>
      <p className={p}>Everything in Fund Horizon works this way, and new features we add appear in Claude by themselves. You never reinstall.</p>

      <h2 className={h2}>Stay safe and accurate</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li>Claude shows only real Fund Horizon figures with their dates. If something is empty, it says why instead of guessing.</li>
        <li>Claude cannot delete anything. Before it creates a household, client or report, it asks you. Approving a valuation is permanent, so it always waits for your clear yes.</li>
        <li>Your connector file contains your sign-in. Do not share it. If you lose a laptop or shared it by mistake, open Settings, Claude connection, click <b>Remove</b> on that connection, and download a new one.</li>
      </ul>

      <h2 className={h2}>If something does not work</h2>
      <ul className={`${p} list-disc space-y-1 pl-6`}>
        <li><b>Claude says the connector was rejected or expired:</b> download a new one (step 1). Connections last 90 days.</li>
        <li><b>Nothing opens when you double-click:</b> open the Claude app, then drag the file into its window.</li>
        <li><b>A fund has blank cells:</b> see <Link className="underline" href="/knowledge/data-guide">Reading the data</Link>.</li>
        <li>Developers using Claude Code get a one-click command on the same Settings page.</li>
      </ul>
      <p className={`${p} mt-8 text-[13px]`}>Fund Horizon data supports research and distribution operations. It is not investment advice.</p>
    </article>
  );
}
