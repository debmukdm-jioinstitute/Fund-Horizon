"use client";

// In-browser PDF form filler for the official RTA forms: fill the form's own fields, type anywhere, tick marks,
// signatures (draw / type / upload), images and whiteout, then download. The browser only renders and collects
// edits; the API draws them onto the original PDF in Google Sans (POST /operations/pdf-fill).
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SignaturePad from "./SignaturePad";

export type PdfSource = { kind: "url"; url: string; title: string } | { kind: "file"; file: File; title: string };

type Tool = "select" | "text" | "date" | "check" | "cross" | "dot" | "circle" | "signature" | "initials" | "image" | "whiteout";
type ItemType = "text" | "date" | "check" | "cross" | "dot" | "circle" | "signature" | "image" | "whiteout";
interface Item {
  id: number; page: number; type: ItemType; x: number; y: number; w: number; h: number;
  text?: string; size?: number; bold?: boolean; color?: string; dataUrl?: string;
}
interface Widget {
  page: number; name: string; kind: "text" | "check" | "radio" | "choice"; x: number; y: number; w: number; h: number;
  multiline: boolean; value: string; on?: string; options: { value: string; label: string }[];
}
type Values = Record<string, string | boolean>;
interface Snapshot { items: Item[]; values: Values }

const MAX_PAGES = 30;
const MARKS: { tool: Tool; label: string }[] = [
  { tool: "check", label: "✓" }, { tool: "cross", label: "✗" }, { tool: "dot", label: "●" }, { tool: "circle", label: "○" },
];
const COLORS = ["#0B2545", "#000000", "#B42332", "#006F64"];
const today = () => new Date().toLocaleDateString("en-GB").replace(/\//g, "-");
const btn = "px-2.5 py-1.5 rounded-lg border text-[12px] font-semibold transition disabled:opacity-40";
const idle = "border-[#E4E9EF] dark:border-[#2B3644] text-[#172033] dark:text-[#EDF2F7] hover:border-[#006F64]";
const active = "border-[#006F64] bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]";

function PageView({ doc, pageNo, zoom, children }: { doc: PDFDocumentProxy; pageNo: number; zoom: number; children: React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let task: RenderTask | null = null;
    let dead = false;
    doc.getPage(pageNo + 1).then((page) => {
      if (dead || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: zoom * dpr });
      const c = canvas.current;
      c.width = vp.width;
      c.height = vp.height;
      setBox({ width: base.width * zoom, height: base.height * zoom });
      task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      task.promise.catch(() => undefined);
    });
    return () => { dead = true; task?.cancel(); };
  }, [doc, pageNo, zoom]);
  return (
    <div className="relative mx-auto shadow-md bg-white" style={box ?? { width: 600, height: 800 }}>
      <canvas ref={canvas} style={box ?? undefined} className="absolute inset-0" />
      {children}
    </div>
  );
}

export default function PdfFormFiller({ source, onClose, onDownloaded }: { source: PdfSource; onClose: () => void; onDownloaded?: (title: string, client: string) => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<{ w: number; h: number; rotated: boolean }[]>([]);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [initial, setInitial] = useState<Values>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.25);
  const [tool, setTool] = useState<Tool>("select");
  const [items, setItems] = useState<Item[]>([]);
  const [values, setValues] = useState<Values>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(11);
  const [pending, setPending] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [initials, setInitials] = useState<string | null>(null);
  const [padFor, setPadFor] = useState<"signature" | "initials" | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [client, setClient] = useState({ name: "", pan: "", dob: "", mobile: "", email: "", folio: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number; w: number; h: number } | null>(null);
  const bytes = useRef<Blob | null>(null);
  const nextId = useRef(1);
  const imageInput = useRef<HTMLInputElement>(null);

  // ---- load -----------------------------------------------------------------------------------------------------
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const blob = source.kind === "file"
          ? source.file
          : await fetch(`/api/backoffice/operations/official-forms/pdf?url=${encodeURIComponent(source.url)}`, { credentials: "include" }).then(async (r) => {
              if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Could not load the form (${r.status})`);
              return r.blob();
            });
        bytes.current = blob;
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // copied into public/ by scripts/copy-pdf-worker.mjs
        const d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (d.numPages > MAX_PAGES) throw new Error(`This PDF has ${d.numPages} pages; the editor handles up to ${MAX_PAGES}.`);
        const sizes: { w: number; h: number; rotated: boolean }[] = [];
        const found: Widget[] = [];
        for (let n = 1; n <= d.numPages; n++) {
          const page = await d.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height, rotated: vp.rotation % 360 !== 0 });
          for (const a of await page.getAnnotations()) {
            if (a.subtype !== "Widget" || a.readOnly || a.pushButton || !a.fieldName || !["Tx", "Btn", "Ch"].includes(a.fieldType)) continue;
            const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
            const kind = a.fieldType === "Tx" ? "text" : a.fieldType === "Ch" ? "choice" : a.radioButton ? "radio" : "check";
            found.push({
              page: n - 1, name: a.fieldName, kind, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
              multiline: !!a.multiLine, value: Array.isArray(a.fieldValue) ? String(a.fieldValue[0] ?? "") : String(a.fieldValue ?? ""),
              on: kind === "radio" ? String(a.buttonValue) : String(a.exportValue ?? "Yes"),
              options: (a.options ?? []).map((o: { exportValue: string; displayValue: string }) => ({ value: o.exportValue, label: o.displayValue })),
            });
          }
        }
        if (dead) return;
        const init: Values = {};
        found.forEach((w) => { init[w.name] = w.kind === "check" ? w.value !== "" && w.value !== "Off" : w.value === "Off" ? "" : w.value; });
        setDoc(d); setPageSizes(sizes); setWidgets(found); setInitial(init); setValues(init);
      } catch (e) {
        if (!dead) setLoadError(e instanceof Error ? e.message : "Could not open this PDF.");
      }
    })();
    return () => { dead = true; };
  }, [source]);

  // ---- history --------------------------------------------------------------------------------------------------
  const commit = useCallback((next: Partial<Snapshot>) => {
    setPast((p) => [...p.slice(-49), { items, values }]);
    setFuture([]);
    if (next.items) setItems(next.items);
    if (next.values) setValues(next.values);
  }, [items, values]);
  const undo = useCallback(() => setPast((p) => {
    const s = p[p.length - 1];
    if (!s) return p;
    setFuture((f) => [{ items, values }, ...f]);
    setItems(s.items); setValues(s.values);
    return p.slice(0, -1);
  }), [items, values]);
  const redo = useCallback(() => setFuture((f) => {
    const s = f[0];
    if (!s) return f;
    setPast((p) => [...p, { items, values }]);
    setItems(s.items); setValues(s.values);
    return f.slice(1);
  }), [items, values]);

  const remove = useCallback(() => { if (selected != null) { commit({ items: items.filter((i) => i.id !== selected) }); setSelected(null); } }, [selected, items, commit]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.("input,textarea,select");
      if (e.key === "Escape") { setTool("select"); setPending(null); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !typing) remove();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, redo, remove]);

  // ---- placing and editing items --------------------------------------------------------------------------------
  const point = (e: React.PointerEvent, page: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { page, x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const place = (e: React.PointerEvent, page: number) => {
    if (pageSizes[page]?.rotated) { setError("Editing rotated pages is not supported."); return; }
    const p = point(e, page);
    const base = { id: nextId.current++, page, x: p.x, y: p.y, color, size };
    const add = (it: Omit<Item, "id" | "page" | "x" | "y">) => { commit({ items: [...items, { ...base, ...it }] }); setSelected(base.id); };
    if (tool === "text" || tool === "date") {
      const text = tool === "date" ? today() : pending ?? "";
      base.y -= size * 0.7; // the click lands mid-line, so text sits on the line you clicked
      add({ type: tool, text, w: Math.max(40, (text.length || 6) * size * 0.6), h: size * 1.4 });
      setPending(null); setTool("select");
    } else if (tool === "check" || tool === "cross" || tool === "dot" || tool === "circle") {
      const d = size + 3;
      base.x -= d / 2; base.y -= d / 2; // centre the mark on the click
      add({ type: tool, w: d, h: d });
    } else if (tool === "signature" || tool === "initials") {
      const url = tool === "signature" ? signature : initials;
      if (!url) { setPadFor(tool); return; }
      add({ type: "signature", dataUrl: url, w: tool === "signature" ? 140 : 60, h: tool === "signature" ? 48 : 30 });
      setTool("select");
    } else if (tool === "image" && imageUrl) {
      add({ type: "image", dataUrl: imageUrl, w: 120, h: 80 }); setTool("select");
    }
  };
  const startDrag = (e: React.PointerEvent, it: Item, mode: "move" | "resize") => {
    e.stopPropagation();
    setSelected(it.id);
    const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y, ow = it.w, oh = it.h;
    const before = items;
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / zoom, dy = (m.clientY - sy) / zoom;
      setItems((cur) => cur.map((c) => c.id !== it.id ? c : mode === "move" ? { ...c, x: ox + dx, y: oy + dy } : { ...c, w: Math.max(10, ow + dx), h: Math.max(8, oh + dy) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPast((p) => [...p.slice(-49), { items: before, values }]);
      setFuture([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const patch = (id: number, p: Partial<Item>) => setItems((cur) => cur.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const sel = items.find((i) => i.id === selected);

  const dragArea = (e: React.PointerEvent, page: number) => {
    if (tool !== "whiteout") return place(e, page);
    const a = point(e, page);
    const el = e.currentTarget as HTMLElement;
    const move = (m: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (m.clientX - r.left) / zoom, y = (m.clientY - r.top) / zoom;
      setDraft({ page, x: Math.min(a.x, x), y: Math.min(a.y, y), w: Math.abs(x - a.x), h: Math.abs(y - a.y) });
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const r = el.getBoundingClientRect();
      const x = (m.clientX - r.left) / zoom, y = (m.clientY - r.top) / zoom;
      const box = { x: Math.min(a.x, x), y: Math.min(a.y, y), w: Math.abs(x - a.x), h: Math.abs(y - a.y) };
      setDraft(null);
      if (box.w > 4 && box.h > 4) commit({ items: [...items, { id: nextId.current++, page, type: "whiteout", ...box }] });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  // ---- download -------------------------------------------------------------------------------------------------
  const changed = useMemo(() => widgets.filter((w) => values[w.name] !== initial[w.name]), [widgets, values, initial]);
  const download = async () => {
    if (!bytes.current) return;
    setBusy(true); setError(null);
    try {
      const fromFields: Omit<Item, "id">[] = [];
      for (const w of changed) {
        const v = values[w.name];
        if (w.kind === "check" && v) fromFields.push({ page: w.page, type: "check", x: w.x, y: w.y, w: w.w, h: w.h, color: "#0B2545" });
        else if (w.kind === "radio" && v === w.on) fromFields.push({ page: w.page, type: "dot", x: w.x, y: w.y, w: w.w, h: w.h, color: "#0B2545" });
        else if ((w.kind === "text" || w.kind === "choice") && v) {
          const sz = Math.min(11, Math.max(6, w.h * 0.7));
          fromFields.push({ page: w.page, type: "text", x: w.x + 2, y: w.y + (w.h - sz * 1.2) / 2, w: w.w, h: sz * 1.2, text: String(v), size: sz, color: "#0B2545" });
        }
      }
      const edits = [...fromFields, ...items.map((it) => ({ ...it, id: undefined }))]; // JSON drops the undefined id
      const form = new FormData();
      if (source.kind === "file") form.append("file", source.file); else form.append("url", source.url);
      form.append("edits", JSON.stringify(edits));
      form.append("drop_fields", JSON.stringify(changed.map((w) => w.name)));
      form.append("filename", `${source.title}_${client.name || "filled"}`.toLowerCase());
      const res = await fetch("/api/backoffice/operations/pdf-fill", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Could not build the PDF (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `${source.title.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_filled.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      onDownloaded?.(source.title, client.name || "—");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally { setBusy(false); }
  };

  const setValue = (name: string, v: string | boolean) => commit({ values: { ...values, [name]: v } });
  const tools: { tool: Tool; label: string }[] = [
    { tool: "select", label: "Select" }, { tool: "text", label: "Text" }, { tool: "date", label: "Date" }, ...MARKS,
    { tool: "signature", label: "Signature" }, { tool: "initials", label: "Initials" }, { tool: "image", label: "Image" }, { tool: "whiteout", label: "Whiteout" },
  ];
  const choose = (t: Tool) => {
    if (t === "image") { imageInput.current?.click(); return; }
    setTool(t); setSelected(null);
  };
  const details: [keyof typeof client, string][] = [["name", "Name"], ["pan", "PAN"], ["dob", "Date of birth"], ["mobile", "Mobile"], ["email", "Email"], ["folio", "Folio no."], ["address", "Address"]];

  return (
    <div className="fixed inset-0 z-50 bg-[#F1F5F9] dark:bg-[#0B1017] flex flex-col" role="dialog" aria-label={`Fill ${source.title}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C]">
        <h2 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7] truncate max-w-[26ch]" title={source.title}>{source.title}</h2>
        {tools.map((t) => (
          <button key={t.tool} type="button" onClick={() => choose(t.tool)} className={`${btn} ${tool === t.tool ? active : idle}`}>{t.label}</button>
        ))}
        <input ref={imageInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 2_000_000) { setError("Image is larger than 2 MB."); return; }
          const r = new FileReader();
          r.onload = () => { setImageUrl(String(r.result)); setTool("image"); };
          r.readAsDataURL(f);
        }} />
        <span className="mx-1 h-5 w-px bg-[#E4E9EF] dark:bg-[#2B3644]" />
        <button type="button" className={`${btn} ${idle}`} onClick={undo} disabled={!past.length}>Undo</button>
        <button type="button" className={`${btn} ${idle}`} onClick={redo} disabled={!future.length}>Redo</button>
        <button type="button" className={`${btn} ${idle}`} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}>−</button>
        <span className="text-[12px] text-[#536176] dark:text-[#A8B4C4] w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" className={`${btn} ${idle}`} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}>+</button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={`${btn} bg-[#006F64] border-[#006F64] text-white hover:bg-[#005a52]`} onClick={download} disabled={busy || !doc}>
            {busy ? "Building…" : "Download PDF"}
          </button>
          <button type="button" className={`${btn} ${idle}`} onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 border-b border-[#E4E9EF] dark:border-[#2B3644] bg-white/70 dark:bg-[#10151C]/70 text-[12px] text-[#536176] dark:text-[#A8B4C4]">
        <span>{tool === "select" ? "Click a form field to fill it, or pick a tool and click the page." : tool === "whiteout" ? "Drag on the page to cover an area." : "Click the page to place. Esc cancels."}</span>
        <label className="flex items-center gap-1">Size
          <input type="number" min={6} max={48} value={sel?.size ?? size} onChange={(e) => { const v = Math.min(48, Math.max(6, +e.target.value || 11)); if (sel && (sel.type === "text" || sel.type === "date")) patch(sel.id, { size: v }); else setSize(v); }} className="w-14 rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-transparent px-1 py-0.5" />
        </label>
        <span className="flex items-center gap-1">Colour
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => (sel ? patch(sel.id, { color: c }) : setColor(c))} className={`h-4 w-4 rounded-full border ${(sel?.color ?? color) === c ? "ring-2 ring-[#006F64]" : "border-[#E4E9EF]"}`} style={{ background: c }} />
          ))}
        </span>
        {sel && (sel.type === "text" || sel.type === "date") && (
          <label className="flex items-center gap-1"><input type="checkbox" checked={!!sel.bold} onChange={(e) => patch(sel.id, { bold: e.target.checked })} />Bold</label>
        )}
        {sel && <button type="button" className={`${btn} ${idle}`} onClick={remove}>Delete selected</button>}
        {widgets.length > 0 && <span>{widgets.length} fillable field{widgets.length > 1 ? "s" : ""}</span>}
        {error && <span className="text-[#B42332] dark:text-[#FF7D86] font-semibold">{error}</span>}
      </div>
      <div className="flex-1 min-h-0 flex">
        <aside className="hidden lg:block w-64 shrink-0 overflow-y-auto border-r border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-3 space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">Client details</h3>
          <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">Type once, then Place to drop a value onto the form.</p>
          {details.map(([k, label]) => (
            <div key={k} className="space-y-0.5">
              <label className="text-[11px] text-[#536176] dark:text-[#A8B4C4]" htmlFor={`cd-${k}`}>{label}</label>
              <div className="flex gap-1">
                <input id={`cd-${k}`} value={client[k]} onChange={(e) => setClient({ ...client, [k]: e.target.value })} className="min-w-0 flex-1 rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-transparent px-1.5 py-1 text-[12px]" />
                <button type="button" disabled={!client[k]} onClick={() => { setPending(client[k]); setTool("text"); }} className={`${btn} ${idle} px-2`}>Place</button>
              </div>
            </div>
          ))}
        </aside>
        <main className="flex-1 overflow-auto p-4 space-y-4" onPointerDown={() => setSelected(null)}>
          {loadError && <p className="text-center text-[13px] text-[#B42332] dark:text-[#FF7D86]">{loadError}</p>}
          {!doc && !loadError && <p className="text-center text-[13px] text-[#536176] dark:text-[#A8B4C4]">Loading the form…</p>}
          {doc && pageSizes.map((_, n) => (
            <PageView key={n} doc={doc} pageNo={n} zoom={zoom}>
              <div className="absolute inset-0" style={{ cursor: tool === "select" ? "default" : "crosshair" }} onPointerDown={(e) => { if (tool !== "select") { e.stopPropagation(); dragArea(e, n); } }}>
                {widgets.filter((w) => w.page === n).map((w, i) => {
                  const pos = { left: w.x * zoom, top: w.y * zoom, width: w.w * zoom, height: w.h * zoom };
                  const base = "absolute bg-[#BFDBFE]/50 hover:bg-[#BFDBFE]/80 focus:bg-[#BFDBFE]/90 outline-none border border-[#60A5FA]/60 text-[#0B2545]";
                  const v = values[w.name];
                  const font = { fontSize: Math.min(11, Math.max(6, w.h * 0.7)) * zoom };
                  if (w.kind === "check" || w.kind === "radio") {
                    const on = w.kind === "check" ? v === true : v === w.on;
                    return <button key={i} type="button" aria-label={w.name} aria-pressed={on} style={pos} className={base} onClick={() => setValue(w.name, w.kind === "check" ? !on : on ? "" : String(w.on))}>{on ? (w.kind === "check" ? "✓" : "●") : ""}</button>;
                  }
                  if (w.kind === "choice") {
                    return <select key={i} aria-label={w.name} style={{ ...pos, ...font }} className={base} value={String(v ?? "")} onChange={(e) => setValue(w.name, e.target.value)}><option value="" />{w.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
                  }
                  return w.multiline
                    ? <textarea key={i} aria-label={w.name} style={{ ...pos, ...font, resize: "none" }} className={base} value={String(v ?? "")} onChange={(e) => setValue(w.name, e.target.value)} />
                    : <input key={i} aria-label={w.name} style={{ ...pos, ...font }} className={base} value={String(v ?? "")} onChange={(e) => setValue(w.name, e.target.value)} />;
                })}
                {items.filter((it) => it.page === n).map((it) => {
                  const pos = { left: it.x * zoom, top: it.y * zoom, width: it.w * zoom, height: it.h * zoom };
                  const on = it.id === selected;
                  return (
                    <div key={it.id} style={pos} className={`absolute ${on ? "outline outline-2 outline-[#006F64]" : "hover:outline hover:outline-1 hover:outline-[#006F64]/60"}`} onPointerDown={(e) => tool === "select" && startDrag(e, it, "move")}>
                      {(it.type === "text" || it.type === "date") && (
                        <textarea
                          autoFocus={!it.text} value={it.text ?? ""} rows={Math.max(1, (it.text ?? "").split("\n").length)} wrap="off" aria-label="Text"
                          onPointerDown={(e) => { e.stopPropagation(); setSelected(it.id); }}
                          onChange={(e) => patch(it.id, { text: e.target.value, w: Math.max(40, Math.max(...e.target.value.split("\n").map((l) => l.length), 6) * (it.size ?? 11) * 0.6), h: (it.size ?? 11) * 1.2 * e.target.value.split("\n").length })}
                          style={{ fontSize: (it.size ?? 11) * zoom, lineHeight: 1.2, color: it.color, fontWeight: it.bold ? 700 : 400, width: "100%", height: "100%" }}
                          className="bg-transparent outline-none resize-none p-0 m-0 overflow-hidden"
                        />
                      )}
                      {it.type === "whiteout" && <div className="h-full w-full bg-white" />}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {(it.type === "image" || it.type === "signature") && <img src={it.dataUrl} alt={it.type} draggable={false} className="h-full w-full object-contain pointer-events-none" />}
                      {it.type === "check" && <svg viewBox="0 0 10 10" className="h-full w-full" fill="none" stroke={it.color} strokeWidth={1.2} strokeLinecap="round"><path d="M1.2 5 4 8 9 1.5" /></svg>}
                      {it.type === "cross" && <svg viewBox="0 0 10 10" className="h-full w-full" fill="none" stroke={it.color} strokeWidth={1.2} strokeLinecap="round"><path d="M1.5 1.5 8.5 8.5M1.5 8.5 8.5 1.5" /></svg>}
                      {it.type === "dot" && <svg viewBox="0 0 10 10" className="h-full w-full"><circle cx="5" cy="5" r="3" fill={it.color} /></svg>}
                      {it.type === "circle" && <svg viewBox="0 0 10 10" className="h-full w-full" fill="none" stroke={it.color} strokeWidth={0.9}><circle cx="5" cy="5" r="4.2" /></svg>}
                      {on && it.type !== "text" && it.type !== "date" && (
                        <span onPointerDown={(e) => startDrag(e, it, "resize")} className="absolute -right-1.5 -bottom-1.5 h-3 w-3 rounded-sm bg-[#006F64] cursor-nwse-resize" />
                      )}
                      {on && (it.type === "text" || it.type === "date") && (
                        <span onPointerDown={(e) => startDrag(e, it, "move")} className="absolute -left-1 -top-4 px-1 text-[10px] leading-4 rounded bg-[#006F64] text-white cursor-move select-none">Move</span>
                      )}
                    </div>
                  );
                })}
                {draft && draft.page === n && <div className="absolute border border-dashed border-[#006F64] bg-white/70" style={{ left: draft.x * zoom, top: draft.y * zoom, width: draft.w * zoom, height: draft.h * zoom }} />}
              </div>
            </PageView>
          ))}
        </main>
      </div>
      {padFor && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onPointerDown={() => setPadFor(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#10151C] p-4 space-y-3" onPointerDown={(e) => e.stopPropagation()}>
            <SignaturePad label={padFor === "signature" ? "Create your signature" : "Create your initials"} signatureData={padFor === "signature" ? signature : initials} onChange={(d) => (padFor === "signature" ? setSignature(d) : setInitials(d))} />
            <div className="flex justify-end gap-2">
              <button type="button" className={`${btn} ${idle}`} onClick={() => setPadFor(null)}>Cancel</button>
              <button type="button" className={`${btn} bg-[#006F64] border-[#006F64] text-white`} disabled={!(padFor === "signature" ? signature : initials)} onClick={() => setPadFor(null)}>Use it — then click the page</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
