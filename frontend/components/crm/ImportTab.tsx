// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useRef, useState } from "react";
import { importClients, type ImportResult, type ImportRow } from "../../lib/crmApi";

const EXPECTED_COLUMNS = ["name", "email", "mobile", "household_name", "rm_email"];

/** Minimal CSV parsing: commas, quotes, escaped quotes, newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function rowsFromText(text: string): { rows: ImportRow[]; headerSkipped: boolean } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], headerSkipped: false };
  const first = grid[0].map((c) => c.trim().toLowerCase());
  const headerSkipped = EXPECTED_COLUMNS.every((c) => first.includes(c));
  const data = headerSkipped ? grid.slice(1) : grid;
  const idx = (col: string) => (headerSkipped ? first.indexOf(col) : EXPECTED_COLUMNS.indexOf(col));
  const rows: ImportRow[] = data.map((r) => {
    const get = (col: string) => {
      const i = idx(col);
      return i >= 0 && i < r.length ? r[i].trim() : "";
    };
    const row: ImportRow = { name: get("name"), email: get("email") };
    const mobile = get("mobile");
    const householdName = get("household_name");
    const rmEmail = get("rm_email");
    if (mobile) row.mobile = mobile;
    if (householdName) row.household_name = householdName;
    if (rmEmail) row.rm_email = rmEmail;
    return row;
  });
  return { rows, headerSkipped };
}

export default function ImportTab() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleParse = () => {
    setParseError(null);
    setResult(null);
    setImportError(null);
    try {
      const { rows } = rowsFromText(text);
      if (rows.length === 0) {
        setParseError("No rows found. Paste CSV with columns: " + EXPECTED_COLUMNS.join(", "));
        setPreview(null);
        return;
      }
      setPreview(rows);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not parse the CSV text");
      setPreview(null);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setParseError(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!preview || preview.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await importClients(preview);
      setResult(res);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const invalidCount = preview?.filter((r) => !r.name || !r.email).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm">
        <h2 className="text-lg font-bold text-navy-950 mb-1">Import clients</h2>
        <p className="text-xs text-navy-500 mb-4">
          Paste CSV rows or pick a file. Columns:{" "}
          <span className="font-mono text-[11px]">{EXPECTED_COLUMNS.join(", ")}</span>. A header
          row is optional. Rows with a duplicate email or missing name/email are skipped and
          reported — nothing is half-imported.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"name,email,mobile,household_name,rm_email\nAarav Sharma,aarav@example.com,98200XXXXX,Sharma family,rm@fundhorizon.in"}
          className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim()}
            className="px-4 py-2 text-xs font-bold bg-navy-900 hover:bg-navy-800 disabled:opacity-50 text-white rounded-xl transition"
          >
            Preview rows
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
          >
            Pick a CSV file
          </button>
        </div>

        {parseError && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
            {parseError}
          </div>
        )}
      </div>

      {preview && (
        <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-navy-950">
                Preview — {preview.length} row{preview.length === 1 ? "" : "s"}
              </h3>
              {invalidCount > 0 && (
                <p className="text-[11px] text-amber-700">
                  {invalidCount} row{invalidCount === 1 ? "" : "s"} missing a name or email — they
                  will be skipped.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || preview.length === 0}
              className="px-4 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition"
            >
              {importing ? "Importing…" : `Import ${preview.length} rows`}
            </button>
          </div>

          <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-xl border border-navy-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy-50/80 text-navy-700 uppercase tracking-wider font-semibold border-b border-navy-100 text-[11px] sticky top-0">
                <tr>
                  {EXPECTED_COLUMNS.map((c) => (
                    <th key={c} className="px-4 py-2.5 font-mono">
                      {c}
                    </th>
                  ))}
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 text-navy-800">
                {preview.slice(0, 100).map((r, i) => {
                  const bad = !r.name || !r.email;
                  return (
                    <tr key={i} className={bad ? "bg-amber-50/40" : "hover:bg-teal-50/20"}>
                      <td className="px-4 py-2 font-medium">{r.name || "–"}</td>
                      <td className="px-4 py-2">{r.email || "–"}</td>
                      <td className="px-4 py-2">{r.mobile || "–"}</td>
                      <td className="px-4 py-2">{r.household_name || "–"}</td>
                      <td className="px-4 py-2">{r.rm_email || "–"}</td>
                      <td className="px-4 py-2">
                        {bad ? (
                          <span className="text-[11px] font-semibold text-amber-700">
                            Will be skipped
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-teal-700">Ready</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.length > 100 && (
            <p className="text-[11px] text-navy-400 mt-2">
              Showing the first 100 rows of {preview.length}.
            </p>
          )}

          {importError && (
            <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
              {importError}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm">
          <h3 className="text-sm font-bold text-navy-950 mb-3">Import report</h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl bg-teal-50 border border-teal-200 p-4 text-center">
              <div className="text-2xl font-extrabold text-teal-800">{result.created}</div>
              <div className="text-[11px] font-semibold text-teal-700">Customers created</div>
            </div>
            <div className="rounded-xl bg-navy-50 border border-navy-200 p-4 text-center">
              <div className="text-2xl font-extrabold text-navy-900">{result.households_created}</div>
              <div className="text-[11px] font-semibold text-navy-600">Households created</div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-center">
              <div className="text-2xl font-extrabold text-amber-800">{result.skipped.length}</div>
              <div className="text-[11px] font-semibold text-amber-700">Rows skipped</div>
            </div>
          </div>
          {result.skipped.length > 0 && (
            <div className="rounded-xl border border-navy-100 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-navy-50/80 text-navy-700 uppercase tracking-wider font-semibold border-b border-navy-100 text-[11px]">
                  <tr>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100 text-navy-800">
                  {result.skipped.map((s, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 font-mono text-[11px]">{s.email || "–"}</td>
                      <td className="px-4 py-2">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
