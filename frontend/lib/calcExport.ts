// Branded client report: A4-proportioned canvases, saved as PNG (first page)
// or wrapped in a multi-page PDF. No dependencies.
// Text uses whatever family the page resolves (Google Sans), so exports match the site typeface.
//
// Parity rule: the PDF must carry everything the on-screen result shows —
// hero + metrics, notes, charts, assumptions, the "How it was calculated"
// steps, and the result table — in the same values. The old single-page
// builder dropped notes, steps and tables entirely, and its fixed footer
// overlapped the assumptions on long calculators (Retirement, Term).
// Content now flows across pages instead, and the footer is drawn last,
// after the content height is known.
import type { Viz } from "./calcViz";
import type { Table } from "./calculators";

export interface CardData {
  title: string; client?: string; inputs: [string, string][];
  metrics: { label: string; text: string; words?: string }[];
  notes?: string[]; steps?: string[]; table?: Table; viz: Viz;
}

const W = 1240, H = 1754, TEAL = "#006F64", INK = "#172033", MUTED = "#667085", LINE = "#E4E9EF";
const FOOTER_TOP = H - 170; // content must end above this; the footer is drawn here last
export const PALETTE = ["#1A73E8", "#F9AB00", "#8AB4F8", "#1E8E3E"]; // glass theme: blue, amber, light blue, green

function image(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);
const inrCell = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

class Flow {
  pages: HTMLCanvasElement[] = [];
  g!: CanvasRenderingContext2D;
  y = 0;
  private fam: string; private logo: HTMLImageElement | null; private d: CardData; private dateStr: string;
  constructor(fam: string, logo: HTMLImageElement | null, d: CardData, dateStr: string) {
    this.fam = fam; this.logo = logo; this.d = d; this.dateStr = dateStr; this.newPage();
  }

  private txt(t: string, x: number, y: number, col: string, w = 400, s = 24, align: CanvasTextAlign = "left") {
    this.g.font = `${w} ${s}px ${this.fam}`; this.g.fillStyle = col; this.g.textAlign = align; this.g.fillText(t, x, y);
  }
  private measure(t: string, w: number, s: number) { this.g.font = `${w} ${s}px ${this.fam}`; return this.g.measureText(t).width; }
  /** Word-wrap to maxWidth; returns lines without the prefix on continuations. */
  private wrap(t: string, maxWidth: number, w: number, s: number): string[] {
    const words = t.split(" "), lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (this.measure(next, w, s) > maxWidth && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  newPage() {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    this.g = c.getContext("2d")!;
    this.g.fillStyle = "#fff"; this.g.fillRect(0, 0, W, H);
    this.g.fillStyle = TEAL; this.g.fillRect(0, 0, W, 10);
    if (this.logo) this.g.drawImage(this.logo, 60, 44, (this.logo.width / this.logo.height) * 70, 70);
    else this.txt("Fund Horizon", 60, 90, TEAL, 700, 40);
    this.txt("Planning report", W - 60, 70, TEAL, 700, 26, "right");
    this.txt(this.dateStr, W - 60, 104, MUTED, 400, 22, "right");
    this.g.fillStyle = LINE; this.g.fillRect(60, 140, W - 120, 2);
    this.txt(this.d.title, 60, 210, INK, 700, 48);
    if (this.d.client) this.txt(`Prepared for ${this.d.client}`, 60, 252, MUTED, 400, 26);
    this.y = 290;
    this.pages.push(c);
  }
  ensure(space: number) { if (this.y + space > FOOTER_TOP) this.newPage(); }
  section(title: string) {
    this.ensure(56);
    this.txt(title, 60, this.y + 26, INK, 700, 26);
    this.y += 44;
  }
  /** Fit a single-line value into maxWidth by shrinking from size down to minSize. */
  private fitSize(t: string, size: number, minSize: number, maxWidth: number) {
    let s = size;
    while (s > minSize && this.measure(t, 700, s) > maxWidth) s -= 4;
    return s;
  }

  heroAndMetrics() {
    const [hero, ...rest] = this.d.metrics;
    if (!hero) return;
    const boxH = hero.words ? 185 : 150;
    this.ensure(boxH + 20);
    const y0 = this.y;
    this.g.fillStyle = "#E6F2F0"; this.g.beginPath(); this.g.roundRect(60, y0, W - 120, boxH, 20); this.g.fill();
    this.txt(hero.label.toUpperCase(), 90, y0 + 45, MUTED, 700, 22);
    const size = this.fitSize(hero.text, 64, 30, W - 180);
    this.txt(hero.text, 90, y0 + 110, TEAL, 700, size);
    if (hero.words) this.txt(hero.words, 90, y0 + 152, MUTED, 400, 24);
    this.y += boxH + 20;
    for (let r = 0; r < rest.length; r += 2) {
      this.ensure(82);
      const row = rest.slice(r, r + 2);
      row.forEach((m, k) => {
        const x = 60 + k * ((W - 120) / 2 + 10), boxW = (W - 120) / 2 - 10;
        this.g.strokeStyle = LINE; this.g.lineWidth = 2; this.g.beginPath(); this.g.roundRect(x, this.y, boxW, 68, 12); this.g.stroke();
        this.txt(m.label, x + 20, this.y + 29, MUTED, 400, 20);
        const size = this.fitSize(m.text, 26, 18, boxW - 40);
        this.txt(m.text, x + 20, this.y + 57, INK, 700, size);
        if (m.words) {
          const vw = this.measure(m.text, 700, size), ww = this.measure(m.words, 400, 20);
          if (vw + 10 + ww <= boxW - 40) this.txt(m.words, x + 20 + vw + 10, this.y + 57, MUTED, 400, 20);
        }
      });
      this.y += 82;
    }
    this.y += 16;
  }

  notes() {
    for (const n of this.d.notes ?? []) {
      const lines = this.wrap(`ⓘ ${n}`, W - 120, 400, 22);
      this.ensure(lines.length * 30 + 12);
      lines.forEach((l, k) => this.txt(l, 60, this.y + 24 + k * 30, INK, 400, 22));
      this.y += lines.length * 30 + 12;
    }
  }

  charts() {
    const { donut, growth, bars } = this.d.viz;
    const slices = (donut ?? []).filter((s) => s.value > 0);
    const tot = slices.reduce((s, x) => s + x.value, 0);
    if (slices.length > 0 && tot > 0) {
      this.ensure(350);
      const y0 = this.y;
      this.txt(this.d.viz.donutTitle ?? "", 60, y0 + 10, INK, 700, 26);
      const cx = 240, cy = y0 + 170;
      let a0 = -Math.PI / 2;
      slices.forEach((s, k) => {
        const a1 = a0 + (s.value / tot) * Math.PI * 2;
        this.g.beginPath(); this.g.moveTo(cx, cy); this.g.arc(cx, cy, 130, a0, a1); this.g.closePath();
        this.g.fillStyle = PALETTE[k % 4]; this.g.fill(); a0 = a1;
      });
      this.g.beginPath(); this.g.arc(cx, cy, 78, 0, Math.PI * 2); this.g.fillStyle = "#fff"; this.g.fill();
      slices.forEach((s, k) => {
        const ly = y0 + 70 + k * 44;
        this.g.fillStyle = PALETTE[k % 4]; this.g.fillRect(420, ly - 18, 20, 20);
        this.txt(`${s.name}  ${Math.round((s.value / tot) * 100)}%`, 452, ly, INK, 400, 22);
      });
      this.y += 350;
    }
    if (growth || bars) {
      this.ensure(420);
      const y0 = this.y, title = growth?.title ?? bars!.title;
      this.txt(title, 60, y0 + 14, INK, 700, 26);
      const names = growth ? growth.names : bars!.names;
      names.filter(Boolean).forEach((n, k) => {
        this.g.fillStyle = PALETTE[k]; this.g.fillRect(W - 60 - 260 + k * 130, y0 - 4, 18, 18);
        this.txt(n, W - 60 - 236 + k * 130, y0 + 12, INK, 400, 20);
      });
      const x0 = 60 + 90, x1 = W - 60, yb = y0 + 350, yt = y0 + 40;
      const pts = growth?.pts ?? [];
      const cols = growth ? pts.length : bars!.cats.length;
      const top = growth ? Math.max(...pts.map((p) => (growth.kind === "stack" ? p.a + p.b : p.a)), 1) : Math.max(...bars!.a, ...bars!.b, 1);
      const hy = (v: number) => yb - (v / top) * (yb - yt);
      for (let t = 0; t <= 4; t++) {
        const v = (top * t) / 4;
        this.g.strokeStyle = LINE; this.g.lineWidth = 1; this.g.beginPath(); this.g.moveTo(x0, hy(v)); this.g.lineTo(x1, hy(v)); this.g.stroke();
        this.txt(bars && !growth && bars.unit !== "₹" ? `${Math.round(v)}%` : compact(v), x0 - 12, hy(v) + 7, MUTED, 400, 18, "right");
      }
      const slot = (x1 - x0) / Math.max(cols, 1);
      if (growth?.kind === "area") {
        this.g.beginPath(); this.g.moveTo(x0, yb);
        pts.forEach((p, k) => this.g.lineTo(x0 + (k / Math.max(cols - 1, 1)) * (x1 - x0), hy(p.a)));
        this.g.lineTo(x1, yb); this.g.closePath(); this.g.fillStyle = "#006F6433"; this.g.fill();
        this.g.beginPath();
        pts.forEach((p, k) => {
          const px = x0 + (k / Math.max(cols - 1, 1)) * (x1 - x0);
          if (k) this.g.lineTo(px, hy(p.a)); else this.g.moveTo(px, hy(p.a));
        });
        this.g.strokeStyle = TEAL; this.g.lineWidth = 4; this.g.stroke();
      } else if (growth) {
        pts.forEach((p, k) => {
          const bw = Math.min(slot * 0.7, 36), bx = x0 + k * slot + (slot - bw) / 2;
          this.g.fillStyle = PALETTE[0]; this.g.fillRect(bx, hy(p.a), bw, yb - hy(p.a));
          this.g.fillStyle = PALETTE[1]; this.g.fillRect(bx, hy(p.a + p.b), bw, hy(p.a) - hy(p.a + p.b));
        });
      } else if (bars) {
        bars.cats.forEach((cat, k) => {
          const bw = Math.min(slot * 0.3, 90), bx = x0 + k * slot + slot / 2;
          [bars.a[k], bars.b[k]].forEach((v, j) => { this.g.fillStyle = PALETTE[j]; this.g.fillRect(bx + (j - 1) * bw, hy(v), bw - 6, yb - hy(v)); });
          this.txt(cat, bx, yb + 28, MUTED, 400, 20, "center");
        });
      }
      if (growth) {
        const step = Math.ceil(cols / 10);
        pts.forEach((p, k) => {
          if (k % step !== 0) return;
          const px = growth.kind === "area" ? x0 + (k / Math.max(cols - 1, 1)) * (x1 - x0) : x0 + k * slot + slot / 2;
          this.txt(`${p.x}`, px, yb + 28, MUTED, 400, 18, "center");
        });
        this.txt("Years", (x0 + x1) / 2, yb + 56, MUTED, 400, 18, "center");
      }
      this.y += 420;
    }
  }

  inputs() {
    if (this.d.inputs.length === 0) return;
    this.section("Assumptions used");
    for (const [l, v] of this.d.inputs) {
      const vw = this.measure(v, 700, 20);
      const labelLines = this.wrap(l, W - 120 - vw - 30, 400, 20);
      const rowH = Math.max(40, labelLines.length * 28);
      this.ensure(rowH);
      labelLines.forEach((line, k) => this.txt(line, 60, this.y + 24 + k * 28, MUTED, 400, 20));
      this.txt(v, W - 60, this.y + 24 + Math.floor((labelLines.length - 1) / 2) * 28, INK, 700, 20, "right");
      this.y += rowH;
    }
    this.y += 20;
  }

  steps() {
    const steps = this.d.steps ?? [];
    if (steps.length === 0) return;
    this.section(`How ${this.d.title} was calculated`);
    steps.forEach((s, i) => {
      const prefix = `${i + 1}. `;
      const indent = this.measure(prefix, 400, 20);
      const lines = this.wrap(`${prefix}${s}`, W - 120, 400, 20);
      this.ensure(lines.length * 28 + 8);
      lines.forEach((line, k) => this.txt(line, k === 0 ? 60 : 60 + indent, this.y + 22 + k * 28, MUTED, 400, 20));
      this.y += lines.length * 28 + 8;
    });
    this.y += 12;
  }

  table() {
    const t = this.d.table;
    if (!t || t.rows.length === 0) return;
    this.section("Breakdown");
    const colW = (W - 120) / t.cols.length;
    const header = () => {
      t.cols.forEach((c, k) => {
        const x = 60 + k * colW;
        this.txt(c, t.money?.includes(k) ? x + colW - 12 : x, this.y + 22, MUTED, 700, 20, t.money?.includes(k) ? "right" : "left");
      });
      this.g.fillStyle = LINE; this.g.fillRect(60, this.y + 32, W - 120, 2);
      this.y += 40;
    };
    this.ensure(80); header();
    for (const row of t.rows) {
      if (this.y + 36 > FOOTER_TOP) { this.newPage(); header(); }
      row.forEach((c, k) => {
        const x = 60 + k * colW;
        const cell = typeof c === "number" && t.money?.includes(k) ? inrCell(c) : String(c);
        this.txt(cell, t.money?.includes(k) ? x + colW - 12 : x, this.y + 24, INK, 400, 20, t.money?.includes(k) ? "right" : "left");
      });
      this.g.fillStyle = LINE; this.g.fillRect(60, this.y + 32, W - 120, 1);
      this.y += 36;
    }
    this.y += 20;
  }

  finish() {
    const note = "Illustration based on the assumptions above. Estimates only, not guaranteed returns, and not investment advice. Mutual fund investments are subject to market risks; read all scheme-related documents carefully.";
    this.pages.forEach((c, i) => {
      const g = c.getContext("2d")!;
      g.fillStyle = LINE; g.fillRect(60, H - 150, W - 120, 2);
      g.font = `400 18px ${this.fam}`; g.fillStyle = MUTED; g.textAlign = "left";
      let line = "", ly = H - 110;
      for (const w of note.split(" ")) {
        if (g.measureText(line + w).width > W - 120) { g.fillText(line, 60, ly); ly += 26; line = ""; }
        line += w + " ";
      }
      g.fillText(line, 60, ly);
      g.font = `400 20px ${this.fam}`; g.fillStyle = MUTED; g.textAlign = "left";
      g.fillText(`Page ${i + 1} of ${this.pages.length}`, 60, H - 40);
      g.font = `700 20px ${this.fam}`; g.fillStyle = TEAL; g.textAlign = "right";
      g.fillText("fundhorizon.website", W - 60, H - 40);
    });
  }
}

/** Full multi-page report: every section the screen shows, in the same values. */
export async function renderReport(d: CardData): Promise<HTMLCanvasElement[]> {
  const fam = getComputedStyle(document.body).fontFamily;
  await Promise.all([document.fonts.load(`400 20px ${fam}`), document.fonts.load(`700 20px ${fam}`)]);
  const logo = await image("/images/logo-horizontal.png");
  const dateStr = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const f = new Flow(fam, logo, d, dateStr);
  f.heroAndMetrics();
  f.notes();
  f.charts();
  f.inputs();
  f.steps();
  f.table();
  f.finish();
  return f.pages;
}

/** First page only, for the PNG image and Share. The PDF uses renderReport. */
export async function renderCard(d: CardData): Promise<HTMLCanvasElement> {
  return (await renderReport(d))[0];
}

export const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not create the file"))), type, q));

/** A4 PDF holding one canvas page per JPEG image. Accepts one page or many. */
export async function pdfBlob(pages: HTMLCanvasElement | HTMLCanvasElement[]): Promise<Blob> {
  const list = Array.isArray(pages) ? pages : [pages];
  if (list.length === 0) throw new Error("No pages to export");
  const jpgs: Uint8Array[] = [];
  for (const c of list) jpgs.push(new Uint8Array(await (await toBlob(c, "image/jpeg", 0.92)).arrayBuffer()));
  const enc = new TextEncoder(), parts: Uint8Array[] = [], offs: number[] = [];
  let size = 0;
  const put = (b: Uint8Array | string) => { const u = typeof b === "string" ? enc.encode(b) : b; parts.push(u); size += u.length; };
  const obj = (n: number, body: string, stream?: Uint8Array) => { offs[n] = size; put(`${n} 0 obj\n${body}`); if (stream) { put("\nstream\n"); put(stream); put("\nendstream"); } put("\nendobj\n"); };
  // Objects: 1 = catalog, 2 = pages, then per page: page, image, contents.
  let next = 3;
  const pageIds: number[] = [], imageIds: number[] = [], contentIds: number[] = [];
  for (let i = 0; i < list.length; i++) { pageIds.push(next++); imageIds.push(next++); contentIds.push(next++); }
  const total = next - 1;
  put("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${list.length} >>`);
  list.forEach((c, i) => {
    obj(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im ${imageIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`);
    obj(imageIds[i], `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgs[i].length} >>`, jpgs[i]);
    const content = "q 595 0 0 842 0 0 cm /Im Do Q";
    obj(contentIds[i], `<< /Length ${content.length} >>`, enc.encode(content));
  });
  const xref = size;
  const entries = ["0000000000 65535 f "];
  for (let n = 1; n <= total; n++) entries.push(`${String(offs[n]).padStart(10, "0")} 00000 n `);
  put(`xref\n0 ${total + 1}\n${entries.join("\n")}\ntrailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export function download(b: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
