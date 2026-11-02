"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MCP_URL, createMcpToken, listMcpTokens, revokeMcpToken, type McpToken } from "@/lib/mcp";
import { formatISTDate } from "@/lib/terminal-format";

const card = "rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-4";
const muted = "text-[#706E6B] dark:text-[#A8B4C4]";
const btn = "terminal-btn text-[13px] py-1.5 px-3";

export default function McpSettingsPage() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [tools, setTools] = useState(0);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => listMcpTokens().then((r) => { setTokens(r.data); setTools(r.tools); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const copy = (what: string, text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1500); }); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const create = () => run(async () => { const r = await createMcpToken(label.trim(), days); setFresh(r.token); setLabel(""); await load(); });
  const revoke = (id: string) => run(async () => { await revokeMcpToken(id); await load(); });

  const code = `claude mcp add --transport http fund-horizon ${MCP_URL} --header "Authorization: Bearer ${fresh ?? "<your-token>"}"`;

  return (
    <div className="mx-auto max-w-[900px] space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-[#181818] dark:text-[#EDF2F7]">Claude connection (MCP)</h1>
        <p className={`text-[13px] ${muted}`}>
          Use Fund Horizon inside Claude: research, screening, consolidated valuation reports, form filling and portfolio analysis{tools ? `, ${tools} tools` : ""}.
          Claude sees exactly what you can see here, nothing more. <Link className="underline" href="/knowledge/mcp-setup">Step-by-step setup guide</Link>
        </p>
      </div>
      {err && <p role="alert" className="rounded border border-[#B42332] p-2 text-[13px] text-[#B42332] dark:text-[#FF7D86]">{err}</p>}

      <section className={`${card} space-y-3`}>
        <h2 className="text-[15px] font-semibold">1. Create a personal token</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-semibold">Name
            <input className="terminal-input mt-1 block text-[13px]" placeholder="e.g. My laptop" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="text-[12px] font-semibold">Valid for
            <select className="terminal-input mt-1 block text-[13px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <button className={btn} disabled={busy || !label.trim()} onClick={create}>Create token</button>
        </div>
        {fresh && (
          <div className="rounded border border-[#0176D3] p-3 text-[13px]">
            <p className="font-semibold">Copy your token now. It is shown once and cannot be recovered.</p>
            <code className="mt-2 block break-all rounded bg-[#F3F3F3] p-2 dark:bg-[#171E27]">{fresh}</code>
            <button className={`${btn} mt-2`} onClick={() => copy("token", fresh)}>{copied === "token" ? "Copied" : "Copy token"}</button>
          </div>
        )}
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-[15px] font-semibold">2. Connect Claude</h2>
        <p className={`text-[13px] ${muted}`}>Server address</p>
        <code className="block break-all rounded bg-[#F3F3F3] p-2 text-[13px] dark:bg-[#171E27]">{MCP_URL}</code>
        <p className={`text-[13px] ${muted}`}>Claude Code, one command:</p>
        <code className="block break-all rounded bg-[#F3F3F3] p-2 text-[12px] dark:bg-[#171E27]">{code}</code>
        <button className={btn} onClick={() => copy("cmd", code)}>{copied === "cmd" ? "Copied" : "Copy command"}</button>
        <p className={`text-[12px] ${muted}`}>Claude Desktop and other apps: see the <Link className="underline" href="/knowledge/mcp-setup">setup guide</Link>.</p>
      </section>

      <section className={card}>
        <h2 className="mb-2 text-[15px] font-semibold">Your tokens</h2>
        {tokens.length === 0 ? <p className={`text-[13px] ${muted}`}>No tokens yet.</p> : (
          <table className="terminal-table w-full text-[13px]">
            <thead><tr><th className="text-left">Name</th><th className="text-left">Created</th><th className="text-left">Expires</th><th className="text-left">Last used</th><th /></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td><td>{formatISTDate(t.created_at)}</td><td>{formatISTDate(t.expires_at)}</td>
                  <td>{t.last_used_at ? formatISTDate(t.last_used_at) : "Never"}</td>
                  <td className="text-right"><button className={btn} disabled={busy} onClick={() => revoke(t.id)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={`mt-2 text-[12px] ${muted}`}>A token carries your access. Treat it like a password; revoke it if a laptop is lost.</p>
      </section>
    </div>
  );
}
