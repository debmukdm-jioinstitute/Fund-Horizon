import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

/** GET JSON from the API with the session cookie; one retry on a dropped connection, readable errors. */
export async function apiGet<T>(path: string): Promise<T> {
  const go = () => fetch(resolveApiUrl(`${API_URL}${path}`), { credentials: "include" });
  let res: Response;
  try { res = await go(); } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try { res = await go(); } catch { throw new ApiError("Could not reach the server (it may be restarting). Wait a few seconds and try again.", 0); }
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

/** POST JSON and get a file back (PDF); same retry and error handling as apiGet. */
export async function apiBlob(path: string, body: unknown): Promise<Blob> {
  const go = () => fetch(resolveApiUrl(`${API_URL}${path}`), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let res: Response;
  try { res = await go(); } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try { res = await go(); } catch { throw new ApiError("Could not reach the server (it may be restarting). Wait a few seconds and try again.", 0); }
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return res.blob();
}
