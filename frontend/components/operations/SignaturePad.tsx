"use client";

import React, { useRef, useState, useEffect } from "react";

interface SignaturePadProps {
  label: string;
  subLabel?: string;
  signatureData: string | null;
  onChange: (dataUrl: string | null) => void;
  required?: boolean;
}

export default function SignaturePad({
  label,
  subLabel = "Draw with mouse/touch or type signature below",
  signatureData,
  onChange,
  required = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(Boolean(signatureData));
  const [mode, setMode] = useState<"draw" | "type" | "upload">("draw");
  const [typedName, setTypedName] = useState("");
  const [history, setHistory] = useState<ImageData[]>([]);

  // Setup canvas resolution and styling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI canvas
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#0B2545"; // Dark navy archival ink
    }

    if (signatureData) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        setHasContent(true);
      };
      img.src = signatureData;
    }
  }, [signatureData]);

  const saveHistoryState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((prev) => [...prev.slice(-10), state]);
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    saveHistoryState();
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
    setHasContent(true);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasContent(false);
    setTypedName("");
    setHistory([]);
    onChange(null);
  };

  const handleUndo = () => {
    if (history.length === 0) {
      handleClear();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const newHistory = [...history];
    const previousState = newHistory.pop();
    setHistory(newHistory);
    if (previousState) {
      ctx.putImageData(previousState, 0, 0);
      onChange(canvas.toDataURL("image/png"));
      setHasContent(true);
    }
  };

  const renderTypedSignature = (text: string) => {
    setTypedName(text);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!text.trim()) {
      setHasContent(false);
      onChange(null);
      return;
    }

    // Google Sans italic signature styling (strict font compliance)
    ctx.save();
    ctx.fillStyle = "#0B2545";
    ctx.font = "italic 26px var(--font-google-sans)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rect.width / 2, rect.height / 2);

    // Decorative baseline flourish line
    ctx.strokeStyle = "#006F64";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(rect.width * 0.2, rect.height * 0.72);
    ctx.bezierCurveTo(
      rect.width * 0.4,
      rect.height * 0.78,
      rect.width * 0.6,
      rect.height * 0.68,
      rect.width * 0.8,
      rect.height * 0.74
    );
    ctx.stroke();
    ctx.restore();

    setHasContent(true);
    onChange(canvas.toDataURL("image/png"));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        // Center image
        const aspect = img.height / img.width;
        let w = rect.width * 0.8;
        let h = w * aspect;
        if (h > rect.height * 0.8) {
          h = rect.height * 0.8;
          w = h / aspect;
        }
        const x = (rect.width - w) / 2;
        const y = (rect.height - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        setHasContent(true);
        onChange(canvas.toDataURL("image/png"));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-[12px] font-semibold text-[#172033] dark:text-[#EDF2F7] flex items-center gap-1.5">
            {label}
            {required && <span className="text-[#B42332]">*</span>}
          </label>
          <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">{subLabel}</p>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1 bg-[#F1F5F9] dark:bg-[#1A232E] p-0.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] text-[11px]">
          <button
            type="button"
            onClick={() => setMode("draw")}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              mode === "draw"
                ? "bg-[#FFFFFF] dark:bg-[#10151C] text-[#006F64] dark:text-[#75E1CE] shadow-xs"
                : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            Draw
          </button>
          <button
            type="button"
            onClick={() => setMode("type")}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              mode === "type"
                ? "bg-[#FFFFFF] dark:bg-[#10151C] text-[#006F64] dark:text-[#75E1CE] shadow-xs"
                : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            Type
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              mode === "upload"
                ? "bg-[#FFFFFF] dark:bg-[#10151C] text-[#006F64] dark:text-[#75E1CE] shadow-xs"
                : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033]"
            }`}
          >
            Upload
          </button>
        </div>
      </div>

      {mode === "type" && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Type investor full name to sign..."
            value={typedName}
            onChange={(e) => renderTypedSignature(e.target.value)}
            className="flex-1 h-8 px-2.5 text-[12px] bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg focus:outline-none focus:border-[#006F64] dark:focus:border-[#75E1CE] text-[#172033] dark:text-[#EDF2F7]"
          />
        </div>
      )}

      {mode === "upload" && (
        <div className="flex gap-2 items-center">
          <label className="cursor-pointer text-[11px] font-medium text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-3 py-1.5 rounded-lg border border-transparent hover:border-[#006F64] transition">
            Choose Signature Image (PNG/JPEG)
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>
        </div>
      )}

      {/* Canvas Box */}
      <div className="relative rounded-xl border border-dashed border-[#CBD5E1] dark:border-[#334155] bg-[#FFFFFF] dark:bg-[#0D1219] overflow-hidden shadow-inner">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-[120px] cursor-crosshair touch-none"
        />

        {/* Watermark Guide Line */}
        <div className="absolute inset-x-8 bottom-6 border-b border-dashed border-[#CBD5E1]/60 dark:border-[#334155]/60 pointer-events-none flex justify-between text-[9px] text-[#94A3B8]">
          <span>Sign above the line</span>
          <span>Verified AMFI Signature Block</span>
        </div>

        {/* Clear and Undo buttons */}
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!hasContent}
            title="Undo stroke"
            className="p-1 rounded bg-[#F1F5F9]/90 dark:bg-[#1A232E]/90 text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-white disabled:opacity-30 text-[10px] font-medium border border-[#E4E9EF] dark:border-[#2B3644]"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasContent}
            title="Clear signature"
            className="p-1 px-2 rounded bg-[#FEE2E2]/90 dark:bg-[#3D1418]/90 text-[#B42332] dark:text-[#FF7D86] hover:bg-[#FEE2E2] disabled:opacity-30 text-[10px] font-medium border border-[#FCA5A5] dark:border-[#7F1D1D]"
          >
            Clear
          </button>
        </div>

        {/* Live applied indicator */}
        {hasContent && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] font-medium text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2]/90 dark:bg-[#1A3034]/90 px-2 py-0.5 rounded pointer-events-none">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Signature Applied
          </div>
        )}
      </div>
    </div>
  );
}
