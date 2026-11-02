/** Build a real Office Open XML .xlsx (ZIP) in the browser. No extra packages. */

export type Sheet = { title: string; rows: string[][] };

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const local = concat([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const eocd = concat([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, central, eocd]);
}

function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(n: number): string {
  let s = "";
  let i = n;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const PCT = /^([+\-−–])?(\d+(?:\.\d+)?)\s*%$/;
const NUM = /^([+\-−–])?(\d+(?:\.\d+)?)$/;

function coerce(raw: string, header: boolean): { kind: "str" | "num" | "pct"; text: string; value?: number } {
  if (header) return { kind: "str", text: raw };
  const text = raw.trim().replace(/,/g, "");
  if (!text) return { kind: "str", text: "" };
  const pct = PCT.exec(text);
  if (pct) {
    const sign = pct[1] === "-" || pct[1] === "−" || pct[1] === "–" ? -1 : 1;
    return { kind: "pct", text: raw, value: (sign * Number(pct[2])) / 100 };
  }
  const num = NUM.exec(text);
  if (num && text.length <= 16) {
    const sign = num[1] === "-" || num[1] === "−" || num[1] === "–" ? -1 : 1;
    const n = sign * Number(num[2]);
    if (Number.isFinite(n)) return { kind: "num", text: raw, value: n };
  }
  return { kind: "str", text: raw };
}

function sheetName(raw: string, used: Set<string>): string {
  let name = (raw || "Sheet").replace(/[\[\]:*?/\\]/g, "").trim() || "Sheet";
  name = name.slice(0, 31);
  const base = name;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n}`;
    name = (base.slice(0, 31 - suffix.length) + suffix).trim();
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function worksheetXml(rows: string[][]): string {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const last = `${colLetter(Math.max(width, 1))}${Math.max(rows.length, 1)}`;
  const body: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells: string[] = [];
    const row = rows[r] || [];
    for (let c = 0; c < width; c++) {
      const ref = `${colLetter(c + 1)}${r + 1}`;
      const cell = coerce(row[c] ?? "", r === 0);
      if (cell.kind === "pct" && cell.value != null) {
        cells.push(`<c r="${ref}" s="2"><v>${cell.value}</v></c>`);
      } else if (cell.kind === "num" && cell.value != null) {
        cells.push(`<c r="${ref}" s="${r === 0 ? 1 : 0}"><v>${cell.value}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`);
      }
    }
    body.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  }
  const cols = Array.from({ length: width }, (_, i) => {
    const w = Math.min(48, Math.max(10, ...rows.map((row) => Math.min((row[i] || "").length + 2, 48))));
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  }).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${body.join("")}</sheetData>` +
    `<autoFilter ref="A1:${last}"/></worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Google Sans"/></font>` +
  `<font><b/><sz val="11"/><name val="Google Sans"/></font>` +
  `</fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  if (!sheets.length) throw new Error("No tables on this page.");
  const enc = new TextEncoder();
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.title, used));
  const files: { name: string; data: Uint8Array }[] = [];
  const sheetOverrides = names
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  files.push({
    name: "[Content_Types].xml",
    data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheetOverrides +
        `</Types>`,
    ),
  });
  files.push({
    name: "_rels/.rels",
    data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
  });
  const sheetRels = names
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");
  files.push({
    name: "xl/_rels/workbook.xml.rels",
    data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheetRels +
        `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
  });
  const sheetRefs = names
    .map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  files.push({
    name: "xl/workbook.xml",
    data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheetRefs}</sheets></workbook>`,
    ),
  });
  files.push({ name: "xl/styles.xml", data: enc.encode(STYLES) });
  sheets.forEach((sheet, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(worksheetXml(sheet.rows)) });
  });
  return zipStore(files);
}

function headingFor(table: Element): string {
  const cap = table.querySelector("caption");
  if (cap?.textContent?.trim()) return cap.textContent.trim();
  let node: Element | null = table;
  for (let i = 0; i < 12 && node; i++) {
    const prev: Element | null = node.previousElementSibling;
    if (prev) {
      if (/^H[1-4]$/.test(prev.tagName) && prev.textContent?.trim()) return prev.textContent.trim();
      const inner = prev.querySelector("h1,h2,h3,h4");
      if (inner?.textContent?.trim()) return inner.textContent.trim();
      node = prev;
      continue;
    }
    node = node.parentElement;
  }
  return "";
}

function cellText(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  copy.querySelectorAll("svg,img,button,script,style").forEach((n) => n.remove());
  return (copy.textContent || "").replace(/\s+/g, " ").trim();
}

export function sheetsFromRoot(root: ParentNode): Sheet[] {
  const tables = Array.from(root.querySelectorAll("table")).filter((table) => {
    if (table.closest(".tableview")) return false;
    if (table.parentElement?.closest("table")) return false;
    return table.querySelectorAll("tr").length >= 2;
  });
  const sheets: Sheet[] = [];
  tables.forEach((table, i) => {
    const rows: string[][] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      if (tr.closest("table") !== table) return;
      let cells = Array.from(tr.children).filter((c) => c.tagName === "TH" || c.tagName === "TD");
      if (!cells.length) cells = Array.from(tr.querySelectorAll("th,td"));
      const vals = cells.map(cellText);
      if (vals.some((v) => v)) rows.push(vals);
    });
    if (rows.length < 2) return;
    sheets.push({ title: headingFor(table) || `Table ${i + 1}`, rows });
  });
  return sheets;
}

export function xlsxFilename(path: string): string {
  const slug = (path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "overview").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "overview";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
  return `markets-${slug}-${day}.xlsx`;
}
