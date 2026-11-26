"use client";
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Several sets in one event handler are merged into a single navigation.
let pending: { q: URLSearchParams; push: boolean } | null = null;

/**
 * useState-like value kept in the URL query (?key=value) so every tab, selection
 * and filter has a shareable, refreshable link. Default value = no param.
 * push=true adds a history entry (back button works); false replaces (typing/filters).
 * Value must be a plain string, not an updater function.
 */
export function useUrlState<T extends string = string>(
  key: string,
  def: T,
  opts: { allowed?: readonly T[]; push?: boolean } = {},
): [T, (v: T) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const raw = sp.get(key);
  const v = (raw !== null && (!opts.allowed || opts.allowed.includes(raw as T)) ? raw : def) as T;
  const push = !!opts.push;
  const set = useCallback(
    (n: T) => {
      if (!pending) {
        pending = { q: new URLSearchParams(window.location.search), push };
        queueMicrotask(() => {
          const { q, push: p } = pending!;
          pending = null;
          const s = q.toString();
          const url = s ? `${path}?${s}` : path;
          if (p) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
        });
      }
      pending.push ||= push;
      if (n === def || n === "") pending.q.delete(key); else pending.q.set(key, n);
    },
    [key, def, path, router, push],
  );
  return [v, set];
}

/** Nullable variant for "selected id" state: null = param absent. */
export function useUrlId(key: string, opts: { push?: boolean } = {}): [string | null, (v: string | null) => void] {
  const [v, set] = useUrlState<string>(key, "", opts);
  return [v || null, (n) => set(n ?? "")];
}
