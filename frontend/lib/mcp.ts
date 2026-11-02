import { API_URL, resolveApiUrl } from "./api";

/** Public address of the Fund Horizon MCP server (the API origin plus /mcp). */
export const MCP_URL = `${API_URL}/mcp`;

export interface McpToken { id: string; label: string; created_at: string; expires_at: string; last_used_at: string | null }

async function mcpFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}${path}`), {
    ...init, credentials: "include", headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).detail ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const listMcpTokens = () => mcpFetch<{ data: McpToken[]; tools: number }>("/api/mcp/tokens");
export const createMcpToken = (label: string, days: number) =>
  mcpFetch<{ id: string; token: string; expires_at: string; note: string }>("/api/mcp/tokens", { method: "POST", body: JSON.stringify({ label, days }) });
export const revokeMcpToken = (id: string) => mcpFetch<void>(`/api/mcp/tokens/${id}`, { method: "DELETE" });
