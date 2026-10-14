"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MAX = 4;
const STORAGE_PREFIX = "fh-compare-";

export function pmsCompareId(item: { ia_id?: string; provider_name: string; strategy_name: string }): string {
  if (item.ia_id) return item.ia_id;
  return `${item.provider_name}::${item.strategy_name}`;
}

export function mfCompareId(item: { scheme_code: string }): string {
  return String(item.scheme_code);
}

type CompareKind = "mf" | "pms";

export function useCompareSelection(kind: CompareKind) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const storageKey = `${STORAGE_PREFIX}${kind}`;

  const [labels, setLabels] = useState<Record<string, string>>({});

  const selectedIds = useMemo(() => {
    const raw = searchParams.get("compare");
    if (!raw) return [] as string[];
    return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX);
  }, [searchParams]);

  const compareOpen = searchParams.get("view") === "compare";

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) setLabels(JSON.parse(stored) as Record<string, string>);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const persistLabels = useCallback(
    (next: Record<string, string>) => {
      setLabels(next);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const setQuery = useCallback(
    (compare: string[], viewCompare: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (compare.length) params.set("compare", compare.join(","));
      else params.delete("compare");
      if (viewCompare) params.set("view", "compare");
      else params.delete("view");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const toggle = useCallback(
    (id: string, name: string) => {
      const has = selectedIds.includes(id);
      let next: string[];
      if (has) {
        next = selectedIds.filter((x) => x !== id);
      } else {
        if (selectedIds.length >= MAX) return;
        next = [...selectedIds, id];
      }
      const nextLabels = { ...labels, [id]: name };
      if (!has) persistLabels(nextLabels);
      else {
        const rest = { ...labels };
        delete rest[id];
        persistLabels(rest);
      }
      setQuery(next, compareOpen && next.length >= 2);
    },
    [compareOpen, labels, persistLabels, selectedIds, setQuery],
  );

  const remove = useCallback(
    (id: string) => {
      const next = selectedIds.filter((x) => x !== id);
      const rest = { ...labels };
      delete rest[id];
      persistLabels(rest);
      setQuery(next, compareOpen && next.length >= 2);
    },
    [compareOpen, labels, persistLabels, selectedIds, setQuery],
  );

  const clear = useCallback(() => {
    persistLabels({});
    setQuery([], false);
  }, [persistLabels, setQuery]);

  const openCompare = useCallback(() => {
    if (selectedIds.length >= 2) setQuery(selectedIds, true);
  }, [selectedIds, setQuery]);

  const closeCompare = useCallback(() => {
    setQuery(selectedIds, false);
  }, [selectedIds, setQuery]);

  const resolveLabel = useCallback(
    (id: string) => labels[id] || id,
    [labels],
  );

  return {
    selectedIds,
    toggle,
    remove,
    clear,
    openCompare,
    closeCompare,
    compareOpen,
    maxSelected: selectedIds.length >= MAX,
    resolveLabel,
  };
}
