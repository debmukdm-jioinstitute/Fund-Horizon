"use client";

import React, { useEffect, useRef } from "react";

const STORAGE_KEY = "dark-mode-toggle"; // key used by the web component's `permanent` mode

/** Mirrors the chosen scheme onto <html> so global CSS (`html.dark`) can restyle the whole site. */
function applyScheme(scheme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", scheme === "dark");
  root.dataset.theme = scheme;
}

/**
 * Light/dark switch built on GoogleChromeLabs' <dark-mode-toggle> web component.
 * The choice is remembered (localStorage) and defaults to the visitor's system preference.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el) return;

    const onChange = (event: Event) => {
      const scheme = (event as CustomEvent<{ colorScheme: "light" | "dark" }>).detail?.colorScheme;
      if (scheme) applyScheme(scheme);
    };
    el.addEventListener("colorschemechange", onChange);

    // The component touches `window`/`localStorage` on import, so load it on the client only.
    import("dark-mode-toggle").catch(() => {
      // If the module fails to load, fall back to whatever the pre-paint script already applied.
      if (!cancelled) {
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved === "dark" || saved === "light") applyScheme(saved);
        } catch {
          /* storage blocked */
        }
      }
    });

    return () => {
      cancelled = true;
      el.removeEventListener("colorschemechange", onChange);
    };
  }, []);

  return React.createElement("dark-mode-toggle", {
    ref,
    class: `theme-toggle ${className}`.trim(),
    appearance: "switch",
    permanent: "",
    light: "Light",
    dark: "Dark",
    "aria-label": "Colour theme",
  });
}
