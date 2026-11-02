"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, resolveApiUrl } from "@/lib/api";
import { useTheme } from "@/components/terminal/ThemeContext";
import MarketDeskNav from "@/components/backoffice/MarketDeskNav";

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

function tableCount(root: ShadowRoot): number {
  return Array.from(root.querySelectorAll("table")).filter((t) => t.querySelectorAll("tr").length >= 2).length;
}

function tableToCsv(table: HTMLTableElement): string {
  return Array.from(table.querySelectorAll("tr"))
    .map((tr) =>
      Array.from(tr.querySelectorAll("th,td"))
        .map((c) => `"${(c.textContent || "").trim().replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function enhanceDesk(root: ShadowRoot) {
  if (!root.querySelector("style[data-fh-desk]")) {
    const st = document.createElement("style");
    st.setAttribute("data-fh-desk", "");
    st.textContent = `
      [data-screener][data-fh-view="risk"] .c-r_1d,
      [data-screener][data-fh-view="risk"] .c-r_1w,
      [data-screener][data-fh-view="risk"] .c-r_1m,
      [data-screener][data-fh-view="risk"] .c-r_3m,
      [data-screener][data-fh-view="risk"] .c-r_6m,
      [data-screener][data-fh-view="risk"] .c-r_ytd,
      [data-screener][data-fh-view="risk"] .c-r_3y,
      [data-screener][data-fh-view="risk"] .c-r_5y,
      [data-screener][data-fh-view="risk"] .c-r_10y { display:none !important; }
      [data-screener][data-fh-view="ret"] .c-off_high_pct,
      [data-screener][data-fh-view="ret"] .c-vs_200d_pct,
      [data-screener][data-fh-view="ret"] .c-above_50d,
      [data-screener][data-fh-view="ret"] .c-trend,
      [data-screener][data-fh-view="ret"] .c-mom12_1,
      [data-screener][data-fh-view="ret"] .c-vol_1y,
      [data-screener][data-fh-view="ret"] .c-maxdd_5y { display:none !important; }
      .tableview table { width:100%; font-size:12px; }
      .plot svg { width:100%; height:auto; display:block; }
    `;
    root.appendChild(st);
  }

  root.querySelectorAll("button[data-act='table']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fig = btn.closest("figure");
      const tv = fig?.querySelector(".tableview") as HTMLElement | null;
      if (!tv) return;
      const show = tv.hasAttribute("hidden");
      if (show) tv.removeAttribute("hidden");
      else tv.setAttribute("hidden", "");
      btn.setAttribute("aria-expanded", show ? "true" : "false");
    });
  });

  root.querySelectorAll("button[data-act='share']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fig = btn.closest("figure");
      const svg = fig?.querySelector(".plot svg");
      if (!svg) return;
      const name = (fig?.querySelector("h3")?.textContent || "chart").trim().replace(/\s+/g, "-").slice(0, 40);
      saveBlob(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${name || "chart"}.svg`);
    });
  });

  root.querySelectorAll("button[data-act='csv']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fig = btn.closest("figure");
      const table = fig?.querySelector(".tableview table") as HTMLTableElement | null;
      if (!table) return;
      const name = (fig?.querySelector("h3")?.textContent || "chart").trim().replace(/\s+/g, "-").slice(0, 40);
      saveBlob(new Blob([tableToCsv(table)], { type: "text/csv;charset=utf-8" }), `${name || "chart"}.csv`);
    });
  });

  root.querySelectorAll("[data-screener]").forEach((box) => {
    const host = box as HTMLElement;
    const rows = Array.from(host.querySelectorAll("tbody tr"));
    const input = host.querySelector<HTMLInputElement>("input[data-q], input[type='search']");
    const countEl = host.querySelector("[data-count]");
    const apply = () => {
      const q = (input?.value || "").trim().toLowerCase();
      const famBtn = host.querySelector("[data-fam][aria-pressed='true']");
      const fam = famBtn?.getAttribute("data-fam") || "";
      let n = 0;
      rows.forEach((tr) => {
        const name = (tr.getAttribute("data-name") || tr.textContent || "").toLowerCase();
        const group = tr.getAttribute("data-group") || "";
        const ok = (!fam || group === fam) && (!q || name.includes(q));
        (tr as HTMLElement).style.display = ok ? "" : "none";
        if (ok) n += 1;
      });
      if (countEl) countEl.textContent = String(n);
    };
    host.querySelectorAll("[data-fam]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        host.querySelectorAll("[data-fam]").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
        apply();
      });
    });
    host.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const view = btn.getAttribute("data-view") || "ret";
        host.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
        host.setAttribute("data-fh-view", view);
      });
    });
    if (!host.getAttribute("data-fh-view")) host.setAttribute("data-fh-view", "ret");
    input?.addEventListener("input", apply);
    apply();
  });
}

function attachExcelButtons(root: ShadowRoot, onDownload: () => void) {
  root.querySelectorAll("table").forEach((table) => {
    if (table.querySelectorAll("tr").length < 2) return;
    if (table.closest(".tableview")) return;
    if (table.parentElement?.getAttribute("data-fh-excel") === "wrap") return;
    const wrap = document.createElement("div");
    wrap.setAttribute("data-fh-excel", "wrap");
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin:10px 0 6px;";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Download Excel";
    btn.setAttribute("aria-label", "Download tables on this page as an Excel file");
    btn.style.cssText =
      "display:inline-flex;align-items:center;height:32px;padding:0 10px;border:1px solid #C9C7C5;border-radius:4px;background:#fff;color:#181818;font-size:12px;font-weight:600;cursor:pointer";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onDownload();
    });
    bar.appendChild(btn);
    const parent = table.parentNode;
    if (!parent) return;
    parent.insertBefore(wrap, table);
    wrap.appendChild(bar);
    wrap.appendChild(table);
  });
}

export default function MarketDesk({ path = "" }: { path?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [hasTables, setHasTables] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelErr, setExcelErr] = useState<string | null>(null);

  const downloadExcel = useCallback(() => {
    const suffix = path.replace(/^\/+|\/+$/g, "");
    const excelUrl = resolveApiUrl(`${API_URL}/api/backoffice/markets${suffix ? `/${suffix}` : ""}?format=xlsx`);
    setExcelBusy(true);
    setExcelErr(null);
    fetch(excelUrl, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "No tables on this page." : "Could not download Excel.");
        const blob = await r.blob();
        const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "markets.xlsx";
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch((e: unknown) => {
        setExcelErr(e instanceof Error ? e.message : "Could not download Excel.");
      })
      .finally(() => setExcelBusy(false));
  }, [path]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.dataset.theme = theme === "dark" ? "dark" : "light";
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const ctl = new AbortController();
    setBusy(true);
    setErr(null);
    setHasTables(false);
    const suffix = path.replace(/^\/+|\/+$/g, "");
    const qs = new URLSearchParams(window.location.search);
    qs.set("theme", theme === "dark" ? "dark" : "light");
    qs.delete("format");
    const url = resolveApiUrl(`${API_URL}/api/backoffice/markets${suffix ? `/${suffix}` : ""}?${qs}`);

    const onNav = (e: Event) => {
      const mouse = e as MouseEvent;
      if (mouse.button !== undefined && mouse.button !== 0 && mouse.button !== 1) return;
      const node = e.target as Node | null;
      const from = node instanceof Element ? node : node?.parentElement;
      const a = from?.closest("a");
      if (!a) return;
      if (a.hasAttribute("download") || a.hasAttribute("data-json")) return;
      const href = a.getAttribute("href") || "";
      if (/[?&]format=(csv|xlsx)\b/i.test(href)) return;
      const next = deskPath(href);
      if (!next) return;
      e.preventDefault();
      const newTab = mouse.button === 1 || mouse.metaKey || mouse.ctrlKey || a.target === "_blank";
      if (newTab) window.open(next, "_blank", "noopener,noreferrer");
      else window.location.assign(next);
    };

    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      const next = deskPath(form.getAttribute("action") || window.location.pathname);
      if (!next) return;
      e.preventDefault();
      const qs = new URLSearchParams();
      new FormData(form).forEach((value, key) => {
        if (typeof value === "string") qs.set(key, value);
      });
      const url = `${next.split("?")[0]}${qs.toString() ? `?${qs}` : ""}`;
      window.location.assign(url);
    };

    root.addEventListener("click", onNav);
    root.addEventListener("auxclick", onNav);
    root.addEventListener("submit", onSubmit);

    fetch(url, { credentials: "include", signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "Sign in required." : "Market page unavailable.");
        return r.json() as Promise<Payload>;
      })
      .then((data) => {
        root.innerHTML = `<style>${data.css}</style><div class="wrap">${data.html}</div>`;
        enhanceDesk(root);
        attachExcelButtons(root, downloadExcel);
        setHasTables(tableCount(root) > 0);
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
      root.removeEventListener("submit", onSubmit);
    };
  }, [path, theme, downloadExcel]);

  return (
    <div className="relative min-h-[70vh] overflow-hidden rounded-xl border border-[#E5E5E5] bg-white dark:border-[#2B3644] dark:bg-[#151515]">
      <MarketDeskNav path={path} placement="top" onExcel={hasTables ? downloadExcel : undefined} excelBusy={excelBusy} />
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
      {excelErr && !busy && !err && (
        <div className="px-3 py-2 text-[12px] text-[#B42332] dark:text-[#FF7D86]">{excelErr}</div>
      )}
      <div ref={host} className={busy || err ? "hidden" : "block"} />
      <MarketDeskNav path={path} placement="footer" onExcel={hasTables ? downloadExcel : undefined} excelBusy={excelBusy} />
    </div>
  );
}
