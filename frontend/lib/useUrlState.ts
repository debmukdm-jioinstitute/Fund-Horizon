"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

// Several sets in one event handler are merged into a single history write.
let pending: { q: URLSearchParams; push: boolean } | null = null;

function write(key: string, value: string, push: boolean) {
  if (!pending) {
    pending = { q: new URLSearchParams(window.location.search), push };
    queueMicrotask(() => {
      const { q, push: p } = pending!;
      pending = null;
      const s = q.toString();
      // history API is picked up by useSearchParams (Next 14.1+) with no server round trip
      window.history[p ? "pushState" : "replaceState"](null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
    });
  }
  pending.push ||= push;
  if (value === "") pending.q.delete(key); else pending.q.set(key, value);
}

/**
 * useState-like value kept in the URL query (?key=value) so every tab, selection
 * and filter has a shareable, refreshable link. Default value = no param.
 * push=true adds a history entry (back button works); false replaces; text typed
 * with push=false is debounced into the URL while the local value updates at once.
 * Value must be a plain string, not an updater function.
 */
export function useUrlState<T extends string = string>(
  key: string,
  def: T,
  opts: { allowed?: readonly T[]; push?: boolean } = {},
): [T, (v: T) => void] {
  const sp = useSearchParams();
  const raw = sp.get(key);
  const fromUrl = (raw !== null && (!opts.allowed || opts.allowed.includes(raw as T)) ? raw : def) as T;
  const [local, setLocal] = useState<T>(fromUrl);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = !!opts.push;
  // external navigation (back/forward, links) changes the URL: follow it unless a write of ours is in flight
  useEffect(() => { if (!timer.current) setLocal(fromUrl); }, [fromUrl]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const set = useCallback(
    (n: T) => {
      setLocal(n);
      const out = n === def ? "" : n;
      if (timer.current) clearTimeout(timer.current);
      if (push) { timer.current = null; write(key, out, true); return; }
      timer.current = setTimeout(() => { timer.current = null; write(key, out, false); }, 250);
    },
    [key, def, push],
  );
  return [local, set];
}

/** Nullable variant for "selected id" state: null = param absent. */
export function useUrlId(key: string, opts: { push?: boolean } = {}): [string | null, (v: string | null) => void] {
  const [v, set] = useUrlState<string>(key, "", opts);
  return [v || null, (n) => set(n ?? "")];
}

/** Boolean variant for open/closed dialogs: ?key=1 when open. */
export function useUrlFlag(key: string, opts: { push?: boolean } = { push: true }): [boolean, (v: boolean) => void] {
  const [v, set] = useUrlState<string>(key, "", opts);
  return [v === "1", (b) => set(b ? "1" : "")];
}
