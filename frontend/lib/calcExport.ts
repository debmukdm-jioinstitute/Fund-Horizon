// Branded client report: one A4-proportioned canvas, saved as PNG or wrapped in a single-page PDF. No dependencies.
// Text uses whatever family the page resolves (Google Sans), so exports match the site typeface.
import type { Viz } from "./calcViz";

export interface CardData {
  title: string; client?: string; inputs: [string, string][];
  metrics: { label: string; text: string }[]; notes?: string[]; viz: Viz;
}

const W = 1240, H = 1754, TEAL = "#006F64", INK = "#172033", MUTED = "#667085", LINE = "#E4E9EF";
export const PALETTE = ["#006F64", "#F2A33A", "#4C7BD9", "#9AA6B8"];

function image(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);

export async function renderCard(d: CardData): Promise<HTMLCanvasElement> {
  const fam = getComputedStyle(document.body).fontFamily;
  await Promise.all([document.fonts.load(`400 20px ${fam}`), document.fonts.load(`700 20px ${fam}`)]);
  const logo = await image("/images/logo-horizontal.png");
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const font = (w: number, s: number) => (g.font = `${w} ${s}px ${fam}`);
  const text = (t: string, x: number, y: number, col: string, w = 400, s = 24, align: CanvasTextAlign = "left") => { font(w, s); g.fillStyle = col; g.textAlign = align; g.fillText(t, x, y); };
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);

  // header
  g.fillStyle = TEAL; g.fillRect(0, 0, W, 10);
  if (logo) g.drawImage(logo, 60, 44, (logo.width / logo.height) * 70, 70);
  else text("Fund Horizon", 60, 90, TEAL, 700, 40);
  text("Planning report", W - 60, 70, TEAL, 700, 26, "right");
  text(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), W - 60, 104, MUTED, 400, 22, "right");
  g.fillStyle = LINE; g.fillRect(60, 140, W - 120, 2);

  text(d.title, 60, 210, INK, 700, 48);
  if (d.client) text(`Prepared for ${d.client}`, 60, 252, MUTED, 400, 26);

  // hero + metrics
  const [hero, ...rest] = d.metrics;
  g.fillStyle = "#E6F2F0"; g.beginPath(); g.roundRect(60, 290, W - 120, 150, 20); g.fill();
  text(hero.label.toUpperCase(), 90, 340, MUTED, 700, 22);
  text(hero.text, 90, 410, TEAL, 700, 64);
  rest.slice(0, 8).forEach((m, k) => {
    const x = 60 + (k % 2) * ((W - 120) / 2 + 10), y = 470 + Math.floor(k / 2) * 82, w = (W - 120) / 2 - 10;
    g.strokeStyle = LINE; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, w, 68, 12); g.stroke();
    text(m.label, x + 20, y + 29, MUTED, 400, 20);
    text(m.text, x + 20, y + 57, INK, 700, 26);
  });
  let y = 470 + Math.ceil(Math.min(rest.length, 8) / 2) * 82 + 30;

  // charts
  const { donut, growth, bars } = d.viz;
  if (donut && donut.some((s) => s.value > 0)) {
    const tot = donut.reduce((s, x) => s + x.value, 0), cx = 240, cy = y + 170;
    text(d.viz.donutTitle ?? "", 60, y + 10, INK, 700, 26);
    let a0 = -Math.PI / 2;
    donut.forEach((s, k) => { const a1 = a0 + (s.value / tot) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 130, a0, a1); g.closePath(); g.fillStyle = PALETTE[k % 4]; g.fill(); a0 = a1; });
    g.beginPath(); g.arc(cx, cy, 78, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
    donut.forEach((s, k) => { const ly = y + 70 + k * 44; g.fillStyle = PALETTE[k % 4]; g.fillRect(420, ly - 18, 20, 20); text(`${s.name}  ${Math.round((s.value / tot) * 100)}%`, 452, ly, INK, 400, 22); });
  }
  const gx = 60, gy = y + 340;
  if (growth || bars) {
    const title = growth?.title ?? bars!.title;
    text(title, gx, gy - 12, INK, 700, 26);
    const x0 = gx + 90, x1 = W - 60, yb = gy + 330, yt = gy + 20;
    const pts = growth?.pts ?? [];
    const cols = growth ? pts.length : bars!.cats.length;
    const top = growth ? Math.max(...pts.map((p) => (growth.kind === "stack" ? p.a + p.b : p.a)), 1) : Math.max(...bars!.a, ...bars!.b, 1);
    const hy = (v: number) => yb - (v / top) * (yb - yt);
    for (let t = 0; t <= 4; t++) { const v = (top * t) / 4; g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, hy(v)); g.lineTo(x1, hy(v)); g.stroke(); text(growth ? compact(v) : `${Math.round(v)}`, x0 - 12, hy(v) + 7, MUTED, 400, 18, "right"); }
    const slot = (x1 - x0) / cols;
    if (growth?.kind === "area") {
      g.beginPath(); g.moveTo(x0, yb);
      pts.forEach((p, k) => g.lineTo(x0 + (k / Math.max(cols - 1, 1)) * (x1 - x0), hy(p.a)));
      g.lineTo(x1, yb); g.closePath(); g.fillStyle = "#006F6433"; g.fill();
      g.beginPath(); pts.forEach((p, k) => { const px = x0 + (k / Math.max(cols - 1, 1)) * (x1 - x0); if (k) g.lineTo(px, hy(p.a)); else g.moveTo(px, hy(p.a)); }); g.strokeStyle = TEAL; g.lineWidth = 4; g.stroke();
    } else if (growth) {
      pts.forEach((p, k) => { const bw = Math.min(slot * 0.7, 36), bx = x0 + k * slot + (slot - bw) / 2; g.fillStyle = PALETTE[0]; g.fillRect(bx, hy(p.a), bw, yb - hy(p.a)); g.fillStyle = PALETTE[1]; g.fillRect(bx, hy(p.a + p.b), bw, hy(p.a) - hy(p.a + p.b)); });
    } else if (bars) {
      bars.cats.forEach((cat, k) => { const bw = Math.min(slot * 0.3, 90), bx = x0 + k * slot + slot / 2; [bars.a[k], bars.b[k]].forEach((v, j) => { g.fillStyle = PALETTE[j]; g.fillRect(bx + (j - 1) * bw, hy(v), bw - 6, yb - hy(v)); }); text(cat, bx, yb + 28, MUTED, 400, 20, "center"); });
    }
    if (growth) {
      const step = Math.ceil(cols / 10);
      pts.forEach((p, k) => { if (k % step === 0) text(`${p.x}`, x0 + k * slot + slot / 2, yb + 28, MUTED, 400, 18, "center"); });
      text("Years", (x0 + x1) / 2, yb + 56, MUTED, 400, 18, "center");
    }
    const names = growth ? growth.names : bars!.names;
    names.filter(Boolean).forEach((n, k) => { g.fillStyle = PALETTE[k]; g.fillRect(x1 - 260 + k * 130, gy - 30, 18, 18); text(n, x1 - 236 + k * 130, gy - 14, INK, 400, 20); });
  }
  y = gy + 400;

  // inputs
  text("Assumptions used", 60, y, INK, 700, 26);
  d.inputs.slice(0, 12).forEach(([l, v], k) => { const row = y + 40 + Math.floor(k / 2) * 40, x = 60 + (k % 2) * 560; text(l, x, row, MUTED, 400, 20); text(v, x + 540, row, INK, 700, 20, "right"); });

  // footer
  g.fillStyle = LINE; g.fillRect(60, H - 150, W - 120, 2);
  const note = "Illustration based on the assumptions above. Estimates only, not guaranteed returns, and not investment advice. Mutual fund investments are subject to market risks; read all scheme-related documents carefully.";
  font(400, 18); g.fillStyle = MUTED; g.textAlign = "left";
  let line = "", ly = H - 110;
  for (const w of note.split(" ")) { if (g.measureText(line + w).width > W - 120) { g.fillText(line, 60, ly); ly += 26; line = ""; } line += w + " "; }
  g.fillText(line, 60, ly);
  text("fundhorizon.website", W - 60, H - 40, TEAL, 700, 20, "right");
  return c;
}

export const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not create the file"))), type, q));

/** Single-page A4 PDF holding the canvas as a JPEG. */
export async function pdfBlob(c: HTMLCanvasElement): Promise<Blob> {
  const jpg = new Uint8Array(await (await toBlob(c, "image/jpeg", 0.92)).arrayBuffer());
  const enc = new TextEncoder(), parts: Uint8Array[] = [], offs: number[] = [];
  let size = 0;
  const put = (b: Uint8Array | string) => { const u = typeof b === "string" ? enc.encode(b) : b; parts.push(u); size += u.length; };
  const obj = (n: number, body: string, stream?: Uint8Array) => { offs[n] = size; put(`${n} 0 obj\n${body}`); if (stream) { put("\nstream\n"); put(stream); put("\nendstream"); } put("\nendobj\n"); };
  put("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>");
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  const content = "q 595 0 0 842 0 0 cm /Im Do Q";
  obj(5, `<< /Length ${content.length} >>`, enc.encode(content));
  const xref = size;
  put(`xref\n0 6\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export function download(b: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
