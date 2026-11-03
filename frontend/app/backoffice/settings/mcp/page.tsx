"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import McpCapabilities from "@/components/McpCapabilities";
import { MCP_URL, createMcpToken, downloadConnector, listMcpTokens, revokeMcpToken, type McpToken } from "@/lib/mcp";
import { formatISTDate } from "@/lib/terminal-format";

const card = "rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-5";
const muted = "text-[#706E6B] dark:text-[#A8B4C4]";
const big = "rounded-lg bg-[#006F64] px-6 py-3 text-[16px] font-semibold text-white hover:bg-[#005a52] disabled:opacity-50";
const small = "terminal-btn text-[13px] py-1.5 px-3";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0B2545] text-[15px] font-bold text-white dark:bg-[#13A89E]">{n}</span>
      <span className="pt-1 text-[16px] text-[#181818] dark:text-[#EDF2F7]">{children}</span>
    </li>
  );
}

export default function McpSettingsPage() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [tools, setTools] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => listMcpTokens().then((r) => { setTokens(r.data); setTools(r.tools); }).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);

  const run = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ ok: true, text: t }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(""); load();
  };

  const desktop = () => run("desktop", async () => { await downloadConnector(); return "Downloaded. Now open the file Fund-Horizon-for-Claude.mcpb from your Downloads folder."; });
  const claudeCode = () => run("code", async () => {
    const t = await createMcpToken("Claude Code (one-click)", 90);
    await navigator.clipboard.writeText(`claude mcp add --transport http fund-horizon ${MCP_URL} --header "Authorization: Bearer ${t.token}"`);
    return "Copied. Paste it into your terminal and press Enter.";
  });

  return (
    <div className="mx-auto max-w-[760px] space-y-5 p-4">
      <div>
        <h1 className="text-2xl font-bold text-[#181818] dark:text-[#EDF2F7]">Use Fund Horizon inside Claude</h1>
        <p className={`mt-1 text-[15px] ${muted}`}>
          Ask Claude to screen funds, research PMS, build valuation reports and fill forms. Everything in Fund Horizon{tools ? ` (${tools} tools)` : ""} and anything we add later works automatically. No setup, no passwords to type.
        </p>
      </div>

      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-[15px] ${msg.ok ? "border-[#2E844A] text-[#1B5E20] dark:text-[#A5D6A7]" : "border-[#B42332] text-[#B42332] dark:text-[#FF7D86]"}`}>{msg.text}</p>}

      <section className={`${card} space-y-4`}>
        <h2 className="text-[18px] font-semibold">Claude Desktop (the Claude app on your computer)</h2>
        <ol className="space-y-3">
          <Step n={1}><button className={big} disabled={!!busy} onClick={desktop}>{busy === "desktop" ? "Preparing…" : "Download Fund Horizon for Claude"}</button></Step>
          <Step n={2}>Open the downloaded file <b>Fund-Horizon-for-Claude.mcpb</b> (double-click it). Claude opens.</Step>
          <Step n={3}>Click <b>Install</b>. Done. Start a new chat and ask: &quot;Show me Fund Horizon data health&quot;.</Step>
        </ol>
        <p className={`text-[13px] ${muted}`}>The file is made just for you and already contains your sign-in. Do not share it. Need Claude? <a className="underline" href="https://claude.ai/download" target="_blank" rel="noreferrer">Download the Claude app</a>.</p>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-[18px] font-semibold">Claude Code (for developers)</h2>
        <button className={big} disabled={!!busy} onClick={claudeCode}>{busy === "code" ? "Preparing…" : "Copy the connect command"}</button>
        <p className={`text-[13px] ${muted}`}>Paste it into your terminal and press Enter. That is all.</p>
      </section>

      <section className={card}>
        <h2 className="mb-3 text-[18px] font-semibold">What Claude can and cannot do</h2>
        <McpCapabilities />
      </section>

      <details className={card}>
        <summary className="cursor-pointer text-[15px] font-semibold">My connections ({tokens.length})</summary>
        <div className="mt-3">
          {tokens.length === 0 ? <p className={`text-[13px] ${muted}`}>None yet.</p> : (
            <table className="terminal-table w-full text-[13px]">
              <thead><tr><th className="text-left">Name</th><th className="text-left">Created</th><th className="text-left">Expires</th><th className="text-left">Last used</th><th /></tr></thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}><td>{t.label}</td><td>{formatISTDate(t.created_at)}</td><td>{formatISTDate(t.expires_at)}</td><td>{t.last_used_at ? formatISTDate(t.last_used_at) : "Never"}</td>
                    <td className="text-right"><button className={small} disabled={!!busy} onClick={() => run("revoke", async () => { await revokeMcpToken(t.id); return "Connection removed. It stopped working immediately."; })}>Remove</button></td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={`mt-2 text-[12px] ${muted}`}>Lost a laptop or shared a file by mistake? Remove the connection here and download a new one. <Link className="underline" href="/knowledge/mcp-setup">Help</Link></p>
        </div>
      </details>
    </div>
  );
}
