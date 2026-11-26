"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

export default function LeadSettingsPage() {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [gameQr, setGameQr] = useState<string>("");
  const [gameUrl, setGameUrl] = useState<string>("https://fundhorizon.up.railway.app/crossword");
  const [copiedGame, setCopiedGame] = useState(false);
  const [leadUrl, setLeadUrl] = useState<string>("https://fundhorizon.up.railway.app/lead");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const url = `${window.location.origin}/lead`;
      setLeadUrl(url);
      const game = `${window.location.origin}/crossword`;
      setGameUrl(game);
      import("qrcode").then((QRCode) => {
        const opts = { width: 320, margin: 2, color: { dark: "#0176D3", light: "#FFFFFF" } };
        QRCode.toDataURL(url, opts).then(setQrDataUrl).catch(console.error);
        QRCode.toDataURL(game, opts).then(setGameQr).catch(console.error);
      });
    }
  }, []);

  const copyLeadUrl = () => {
    navigator.clipboard.writeText(leadUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyGameUrl = () => {
    navigator.clipboard.writeText(gameUrl);
    setCopiedGame(true);
    setTimeout(() => setCopiedGame(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div>
          <h2 className="text-[18px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Lead generation</h2>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">Two ways to bring new enquiries into your CRM.</p>
        </div>
        <Link
          href="/backoffice/crm?tab=leads"
          className="px-3 py-1.5 rounded-lg border border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F] text-[12px] font-medium flex items-center gap-1 transition"
        >
          View CRM ↗
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Client intake */}
        <div className="bg-white dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Client intake</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] border border-[#C5DDF7] dark:border-[#1F4A74]">CRM sync</span>
              </div>
              <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Collect contact details and investment interests.</p>
            </div>
          </div>

          {/* QR Preview box with corner viewfinder brackets */}
          <div className="flex flex-col items-center justify-center py-2">
            <div className="relative w-32 h-32 flex items-center justify-center p-3">
              <span className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
              <span className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />
              <span className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />

              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="Client intake QR" className="w-full h-full object-contain" />
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[#94A3B8]">
                  <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                  <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                  <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                  <div className="w-4 h-4 flex flex-wrap gap-1 p-0.5"><div className="w-1 h-1 bg-current" /><div className="w-1 h-1 bg-current" /></div>
                </div>
              )}
            </div>

            <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mt-2">QR preview</div>
            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Use original QR when implementing</div>

            <div className="flex items-center gap-3 mt-3">
              <a
                href={qrDataUrl || "#"}
                download="fund-horizon-intake-qr.png"
                className="px-3 py-1.5 rounded-lg border border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F] text-[12px] font-medium flex items-center gap-1.5 transition"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download QR
              </a>
              <button
                type="button"
                onClick={copyLeadUrl}
                className="px-3 py-1.5 rounded-lg bg-[#0176D3] hover:bg-[#015fb0] dark:bg-[#1B96FF] dark:hover:bg-[#0080ea] text-white text-[12px] font-medium flex items-center gap-1.5 transition shadow-sm"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copiedLink ? "Copied!" : "Copy link"}
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-[#E5E5E5] dark:border-[#2B3644] flex items-center justify-between text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
            <span className="truncate max-w-[200px]">{leadUrl}</span>
            <a href={leadUrl} target="_blank" rel="noreferrer" className="text-[#0176D3] dark:text-[#1B96FF] hover:underline shrink-0">Open page ↗</a>
          </div>
        </div>

        {/* Card 2: Interactive Crossword */}
        <div className="bg-white dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Crossword game</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] border border-[#C5DDF7] dark:border-[#1F4A74]">Lead magnet</span>
              </div>
              <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Financial puzzle that captures prospect contact info.</p>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-2">
            <div className="relative w-32 h-32 flex items-center justify-center p-3">
              <span className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
              <span className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />
              <span className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />

              {gameQr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gameQr} alt="Crossword game QR" className="w-full h-full object-contain" />
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[#94A3B8]">
                  <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                  <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                  <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                  <div className="w-4 h-4 flex flex-wrap gap-1 p-0.5"><div className="w-1 h-1 bg-current" /><div className="w-1 h-1 bg-current" /></div>
                </div>
              )}
            </div>

            <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mt-2">QR preview</div>
            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Share at events or in social posts</div>

            <div className="flex items-center gap-3 mt-3">
              <a
                href={gameQr || "#"}
                download="fund-horizon-crossword-qr.png"
                className="px-3 py-1.5 rounded-lg border border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F] text-[12px] font-medium flex items-center gap-1.5 transition"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download QR
              </a>
              <button
                type="button"
                onClick={copyGameUrl}
                className="px-3 py-1.5 rounded-lg bg-[#0176D3] hover:bg-[#015fb0] dark:bg-[#1B96FF] dark:hover:bg-[#0080ea] text-white text-[12px] font-medium flex items-center gap-1.5 transition shadow-sm"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copiedGame ? "Copied!" : "Copy link"}
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-[#E5E5E5] dark:border-[#2B3644] flex items-center justify-between text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
            <span className="truncate max-w-[200px]">{gameUrl}</span>
            <a href={gameUrl} target="_blank" rel="noreferrer" className="text-[#0176D3] dark:text-[#1B96FF] hover:underline shrink-0">Play crossword ↗</a>
          </div>
        </div>
      </div>
    </div>
  );
}
