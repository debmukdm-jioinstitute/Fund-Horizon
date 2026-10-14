"use client";

import { useState } from "react";

type Props = {
  label: string;
  value: string | null | undefined;
  /** What the user sees when not editing (defaults to the raw value). */
  display?: React.ReactNode;
  onSave?: (next: string) => Promise<void>;
  type?: "text" | "textarea" | "date" | "number" | "select";
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  /** Return an error message to block the save. */
  validate?: (next: string) => string | null;
};

const input =
  "w-full px-2 py-1 text-xs rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]";

/** Click-to-edit field: Enter saves, Escape cancels; errors stay on the field. */
export default function InlineField({ label, value, display, onSave, type = "text", options, readOnly, validate }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const msg = validate?.(draft) ?? null;
    if (msg) {
      setError(msg);
      return;
    }
    if (draft === (value ?? "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave?.(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Enter" && (type !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  const id = `if-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-x-3 gap-y-1 py-1.5 text-xs border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60 last:border-0">
      <label htmlFor={id} className="font-semibold text-[#536176] dark:text-[#A8B4C4]">{label}</label>
      {editing ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            {type === "textarea" ? (
              <textarea id={id} autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} className={input} />
            ) : type === "select" ? (
              <select id={id} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} className={input}>
                {options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input id={id} autoFocus type={type} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} className={input} />
            )}
            <button type="button" onClick={save} disabled={busy} className="px-2 rounded bg-[#006F64] text-white font-semibold disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="px-2 rounded border border-[#E4E9EF] dark:border-[#2B3644]">Cancel</button>
          </div>
          {error && <p role="alert" className="text-rose-700 dark:text-rose-300">{error}</p>}
        </div>
      ) : readOnly || !onSave ? (
        <span id={id} className="text-[#172033] dark:text-[#EDF2F7] break-words">{display ?? (value || "–")}</span>
      ) : (
        <button
          type="button" id={id} onClick={start} title="Click to edit" aria-label={`Edit ${label}`}
          className="text-left text-[#172033] dark:text-[#EDF2F7] break-words rounded hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733] px-1 -mx-1"
        >
          {display ?? (value || <span className="text-[#536176] dark:text-[#A8B4C4]">Add {label.toLowerCase()}</span>)}
        </button>
      )}
    </div>
  );
}
