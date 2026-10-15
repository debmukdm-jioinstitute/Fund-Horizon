import { API_URL, ApiError, resolveApiUrl } from "./api";

export interface SearchHit {
  scope: string;
  type: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  external?: boolean;
  amc?: string | null;
  pms?: string | null;
}
export interface SearchScope { key: string; label: string }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/backoffice${path}`), { credentials: "include" });
  if (!res.ok) throw new ApiError(`Search failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

/** Scopes come from the backend registry, so a data set added there shows up here with no frontend change. */
export const fetchSearchScopes = () => get<{ scopes: SearchScope[] }>("/search/scopes").then((r) => r.scopes);
export const universalSearch = (q: string, scope: string) =>
  get<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`).then((r) => r.results);
