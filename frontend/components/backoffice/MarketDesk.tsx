"use client";

import React, { useEffect, useRef, useState } from "react";
import { API_URL, resolveApiUrl } from "@/lib/api";
import { useTheme } from "@/components/terminal/ThemeContext";

type Payload = { css: string; html: string };

function deskPath(href: string): string | null {
  if (!href || href.startsWith("#") || /^(mailto:|javascript:|data:|blob:|tel:)/i.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "tipsheet.markets" || host.endsWith(".tipsheet.markets")) {
    return `/backoffice/markets${url.pathname}${url.search}${url.hash}`;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname.startsWith("/backoffice") || url.pathname.startsWith("/api")) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return `/backoffice/markets${url.pathname}${url.search}${url.hash}`;
}

export default function MarketDesk({ path = "" }: { path?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.dataset.theme = theme === "dark" ? "dark" : "light";
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const ctl = new AbortController();
    setBusy(true);
    setErr(null);
    const suffix = path.replace(/^\/+|\/+$/g, "");
    const qs = new URLSearchParams({ theme: theme === "dark" ? "dark" : "light" });
    const url = resolveApiUrl(`${API_URL}/api/backoffice/markets${suffix ? `/${suffix}` : ""}?${qs}`);

    const onNav = (e: Event) => {
      const mouse = e as MouseEvent;
      if (mouse.button !== undefined && mouse.button !== 0 && mouse.button !== 1) return;
      const node = e.target as Node | null;
      const from = node instanceof Element ? node : node?.parentElement;
      const a = from?.closest("a");
      if (!a) return;
      const next = deskPath(a.getAttribute("href") || "");
      if (!next) return;
      e.preventDefault();
      const newTab = mouse.button === 1 || mouse.metaKey || mouse.ctrlKey || a.target === "_blank";
      if (newTab) window.open(next, "_blank", "noopener,noreferrer");
      else window.location.assign(next);
    };

    root.addEventListener("click", onNav);
    root.addEventListener("auxclick", onNav);

    fetch(url, { credentials: "include", signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "Sign in required." : "Market page unavailable.");
        return r.json() as Promise<Payload>;
      })
      .then((data) => {
        root.innerHTML = `<style>${data.css}</style><div class="wrap">${data.html}</div>`;
        setBusy(false);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "Market page unavailable.");
        setBusy(false);
      });
    return () => {
      ctl.abort();
      root.removeEventListener("click", onNav);
      root.removeEventListener("auxclick", onNav);
    };
  }, [path, theme]);

  return (
    <div className="relative min-h-[70vh] overflow-hidden rounded-xl border border-[#E5E5E5] bg-white dark:border-[#2B3644] dark:bg-[#151515]">
      {busy && (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">
          <svg className="h-4 w-4 animate-spin text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading markets…
        </div>
      )}
      {err && !busy && (
        <div className="p-4 text-[13px] text-[#B42332] dark:text-[#FF7D86]">{err}</div>
      )}
      <div ref={host} className={busy || err ? "hidden" : "block"} />
    </div>
  );
}
