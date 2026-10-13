"use client";

import React, { useEffect } from "react";

export default function BackofficeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Backoffice render error:", error);
  }, [error]);

  return (
    <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 space-y-3">
      <div className="font-semibold">This section failed to render</div>
      <div className="font-mono break-words">{error.message || "Unexpected client-side error"}</div>
      <button
        onClick={reset}
        className="px-3 py-1.5 bg-red-700 text-white rounded-xl font-semibold hover:bg-red-800 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
