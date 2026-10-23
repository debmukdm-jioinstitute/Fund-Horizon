"use client";

import React, { useEffect, useState } from "react";

interface DeleteConfirmDialogProps {
  title: string;
  description?: string;
  onConfirm: (code: string) => Promise<void>;
  onClose: () => void;
}

export default function DeleteConfirmDialog({
  title,
  description,
  onConfirm,
  onClose,
}: DeleteConfirmDialogProps) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (code !== "0000") {
      setErr("Wrong passcode. Enter 0000 to delete.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onConfirm(code);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete");
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-5 shadow-2xl">
        <h2 id="delete-dialog-title" className="text-base font-bold text-rose-700 dark:text-rose-400">
          {title}
        </h2>
        <p className="text-xs text-[#706E6B] dark:text-[#A8B4C4]">
          {description ?? "This permanently removes the record. To confirm, enter the passcode below."}
        </p>
        <div>
          <label htmlFor="delete-dialog-passcode" className="block text-xs font-semibold text-[#444444] dark:text-[#EDF2F7] mb-1">
            Passcode <span className="font-normal text-[#706E6B] dark:text-[#A8B4C4]">(hint: 0000)</span>
          </label>
          <input
            id="delete-dialog-passcode"
            autoFocus
            inputMode="numeric"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setErr("");
            }}
            onKeyDown={(e) => e.key === "Enter" && code === "0000" && void submit()}
            placeholder="Hint: 0000"
            aria-label="Passcode (hint: 0000)"
            className="w-full rounded-lg border border-[#8A94A3] dark:border-[#5B6B80] bg-white dark:bg-[#111722] px-3 py-2 text-sm text-[#181818] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>
        {err && <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] px-3 py-1.5 text-xs font-medium text-[#706E6B] dark:text-[#A8B4C4] hover:bg-[#F3F4F6] dark:hover:bg-[#202938]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={code !== "0000" || busy}
            onClick={() => void submit()}
            className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-40 transition"
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
