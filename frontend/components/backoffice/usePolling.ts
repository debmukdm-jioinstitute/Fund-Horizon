"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `load(false)` on mount (and when deps change), then `load(true)` every `intervalMs` while the tab is visible.
 * `silent` tells the loader to refresh data without flashing a spinner.
 */
export function usePolling(load: (silent: boolean) => Promise<void>, deps: unknown[], intervalMs = 60_000) {
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void loadRef.current(false);
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void loadRef.current(true);
      }
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);
}
