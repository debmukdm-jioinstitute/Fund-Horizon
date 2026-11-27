"use client";

import React, { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { explain, type Box, type Ctx, type Explained } from "@/lib/report-methods";

type Tip = { e: Explained; x: number; y: number };

function Page({ doc, n, width, onTip, ctx }: { doc: PDFDocumentProxy; n: number; width: number; onTip: (t: Tip | null) => void; ctx?: Ctx }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const items = useRef<Box[]>([]);
  const [h, setH] = useState(Math.round(width * 0.707));
  const [hl, setHl] = useState<Box | null>(null);

  useEffect(() => {
    let dead = false;
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(async ([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      const page = await doc.getPage(n);
      const scale = width / page.getViewport({ scale: 1 }).width;
      const vp = page.getViewport({ scale });
      const c = cv.current;
      if (dead || !c) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = vp.width * dpr; c.height = vp.height * dpr;
      setH(vp.height);
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
      const t = vp.transform;
      items.current = (await page.getTextContent()).items.flatMap((it) => {
        if (!("str" in it) || !it.str.trim()) return [];
        const x = t[0] * it.transform[4] + t[2] * it.transform[5] + t[4];
        const y = t[1] * it.transform[4] + t[3] * it.transform[5] + t[5];
        const hh = Math.abs(it.height * scale) || 8;
        return [{ s: it.str.trim(), x, y: y - hh, w: it.width * scale, h: hh }];
      });
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => { dead = true; io.disconnect(); };
  }, [doc, n, width]);

  const at = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const hit = items.current.find((b) => px >= b.x - 2 && px <= b.x + b.w + 2 && py >= b.y - 2 && py <= b.y + b.h + 2);
    const ex = hit && explain(items.current, hit, ctx);
    setHl(ex ? hit! : null);
    onTip(ex ? { e: ex, x: e.clientX, y: e.clientY } : null);
  };

  return (
    <div ref={wrap} className="relative mb-3 bg-white shadow" style={{ width, height: h }} onPointerMove={at} onPointerDown={at} onPointerLeave={() => { setHl(null); onTip(null); }}>
      <canvas ref={cv} style={{ width, height: h }} />
      {hl && <div className="pointer-events-none absolute rounded-sm bg-[#006F64]/15 ring-1 ring-[#006F64]" style={{ left: hl.x - 2, top: hl.y - 2, width: hl.w + 4, height: hl.h + 4 }} />}
    </div>
  );
}

// Takes the PDF Blob itself: fetch() on a blob: URL is refused by the site's connect-src policy ("Failed to fetch").
export default function ExplainViewer({ blob, id, ctx }: { blob: Blob; id: string; ctx?: Ctx }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(el.clientWidth - 16))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let d: PDFDocumentProxy | null = null, dead = false;
    setErr(null);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // copied into public/ by scripts/copy-pdf-worker.mjs
        d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (!dead) setDoc(d); else void d.destroy();
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "Could not open the PDF."); }
    })();
    return () => { dead = true; void d?.destroy(); };
  }, [blob]);

  const W = 340;
  const left = tip ? Math.max(8, Math.min(tip.x + 14, window.innerWidth - W - 8)) : 0;
  const top = tip ? (tip.y + 200 > window.innerHeight ? Math.max(8, tip.y - 190) : tip.y + 16) : 0;

  return (
    <div ref={box} className="h-[78vh] w-full overflow-auto rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-[#EEF1F5] dark:bg-[#0F151F] p-2">
      {err && <p role="alert" className="text-[12.5px] text-[#B42318]">{err}</p>}
      {doc && width > 0 && Array.from({ length: doc.numPages }, (_, i) => <Page key={`${id}-${i}`} doc={doc} n={i + 1} width={width} onTip={setTip} ctx={ctx} />)}
      {!doc && !err && <p className="text-[13px]">Opening the report…</p>}
      {tip && (
        <div role="tooltip" className="pointer-events-none fixed z-50 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-3 text-[12.5px] leading-snug shadow-xl" style={{ left, top, width: W }}>
          <p className="text-[13px] font-bold text-[#006F64] dark:text-[#75E1CE]">{tip.e.title}</p>
          <p className="mt-0.5 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">{tip.e.row ? `${tip.e.row} · ` : ""}This box: {tip.e.value}</p>
          <p className="mt-1.5"><b>How it is worked out:</b> {tip.e.how}</p>
          {tip.e.calc && <p className="mt-1.5 rounded bg-[#F4FBF9] dark:bg-[#112220] px-2 py-1 font-semibold tabular-nums">This row: {tip.e.calc}</p>}
          <p className="mt-1.5 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]"><b>Data from:</b> {tip.e.src}</p>
        </div>
      )}
    </div>
  );
}
